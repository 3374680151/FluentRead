/**
 * @file web/wordDictionary.ts
 *
 * 文件职责：FluentRead Web 服务端的单词词典查询模块，为 /api/word 提供本地 ECDICT 优先、
 * 机器翻译兜底的查词能力（学习工作台点词、词卡浮层的数据来源）。
 * 主要内容：启动后惰性加载仓库自带的 public/ecdict-core.json（[词, 音标, 英文释义, 中文释义] 四元组），
 * 构建小写词 -> 行索引；对查询词做词形还原（复数/动词变形规则表）逐形回退；按词性配对英文释义与
 * 中文释义输出 senses；词典未命中或源语言非英语时回退免费机器翻译并如实标注来源。
 * 模块边界：只做查词与释义清洗，不做页面渲染；翻译兜底复用 src/providers/translation 的微软适配器；
 * 不引入扩展运行时依赖（无 browser/chrome API），可在 Node 服务直接运行。
 */

import {createHash} from 'node:crypto';
import {readFile, access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';

/** ECDICT 紧凑行：[单词, 音标, 英文释义(\\n 分隔、含词性前缀), 中文释义(\\n 分隔、含词性前缀)]。 */
type EcdictRow = readonly [string, string, string, string];

/** 单条释义：词性 + 中文释义 + 可选英文原文释义。 */
export interface WordSense {
    pos: string;
    zh?: string;
    en?: string;
}

export interface WordLookupResult {
    term: string;
    /** 词典是否命中（false 表示 translation 来自机器翻译兜底）。 */
    found: boolean;
    source: 'ecdict' | 'mt-fallback';
    /** 查询词经过词形还原后命中的原形（与查询词相同时省略）。 */
    lemma?: string;
    phonetic?: string;
    pos?: string;
    senses: WordSense[];
    /** 首选中文释义；词典未命中时为机器翻译结果。 */
    translation: string;
    ms: number;
}

const MAX_TERM_LENGTH = 64;
const MAX_SENSES = 6;
const LOOKUP_TIMEOUT_MS = 6_000;

/** 词性前缀（如 "n. " / "adj. " / "v.t. "）；不匹配时按无词性处理。 */
const POS_PREFIX = /^\s*([a-zA-Z]{1,8}\.)\s*(.+)$/u;

let indexPromise: Promise<Map<string, EcdictRow>> | null = null;

/**
 * ECDICT 词库候选位置（按优先级）：
 * 1. web/.cache/ecdict-full.json —— 完整词库（3.9MB，可选资产），使用前按扩展 ecdictAsset.ts
 *    同一 SHA-256 校验，防止被替换的缓存文件注入伪造释义；
 * 2. 仓库 public/ecdict-core.json —— 扩展自带的 3000 词精简核心库。
 */
const FULL_DICT_SHA256 = 'b0f0768e6730dfd07b895527ff56169f4d44904c58532b4cdd750aa97374071a';
const ECDICT_CANDIDATES: ReadonlyArray<{file: string; verifySha?: string}> = [
    {file: '../../.cache/ecdict-full.json', verifySha: FULL_DICT_SHA256},
    {file: '../.cache/ecdict-full.json', verifySha: FULL_DICT_SHA256},
    {file: './.cache/ecdict-full.json', verifySha: FULL_DICT_SHA256},
    {file: '../../public/ecdict-core.json'},
    {file: '../public/ecdict-core.json'},
    {file: './public/ecdict-core.json'},
];

async function locateEcdictFile(): Promise<string> {
    const moduleDir = fileURLToPath(new URL('.', import.meta.url));
    for (const candidate of ECDICT_CANDIDATES) {
        const file = resolve(moduleDir, candidate.file);
        try {
            await access(file);
        } catch {
            continue; // 尝试下一个候选位置
        }
        if (candidate.verifySha) {
            try {
                const digest = createHash('sha256').update(await readFile(file)).digest('hex');
                if (digest !== candidate.verifySha) continue; // 缓存校验失败，回退核心库
            } catch {
                continue;
            }
        }
        return file;
    }
    throw new Error('未找到 ECDICT 词库（可选完整词库放 web/.cache/ecdict-full.json，或使用仓库自带核心库）');
}

/** 惰性加载并解析 ECDICT 核心词库；失败时清空缓存 Promise，下次查询可重试。 */
function loadEcdictIndex(): Promise<Map<string, EcdictRow>> {
    if (!indexPromise) {
        indexPromise = locateEcdictFile().then((file) => readFile(file, 'utf8')).then((raw) => {
            const entries: unknown = JSON.parse(raw);
            if (!Array.isArray(entries)) throw new Error('ecdict-core.json 不是数组');
            const index = new Map<string, EcdictRow>();
            for (const entry of entries) {
                if (!Array.isArray(entry) || entry.length !== 4) continue;
                const [rawWord, rawPhonetic, rawEn, rawZh] = entry as unknown[];
                if (typeof rawWord !== 'string' || !rawWord) continue;
                const phonetic = typeof rawPhonetic === 'string' ? rawPhonetic : '';
                const en = typeof rawEn === 'string' ? rawEn : '';
                const zh = typeof rawZh === 'string' ? rawZh : '';
                index.set(rawWord.toLowerCase(), [rawWord, phonetic, en, zh] as const);
            }
            if (!index.size) throw new Error('ecdict-core.json 无有效词条');
            return index;
        }).catch((error) => {
            indexPromise = null;
            throw error;
        });
    }
    return indexPromise;
}

/** 把 ECDICT 的 "\\n"/换行分隔释义行拆成 {词性, 文本} 列表。 */
function parseDefinitionLines(value: string): Array<{pos?: string; text: string}> {
    return value.replace(/\\n/gu, '\n')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = POS_PREFIX.exec(line);
            return match ? {pos: match[1]!.toLowerCase(), text: match[2]!.trim()} : {text: line};
        });
}

/**
 * 词形还原候选序列：原形优先，其后是规则变形（复数、动词 -ed/-ing、比较级等）。
 * 只覆盖英语高频规则，不规则变形（went/went）不在服务端处理范围，未命中自然回退机器翻译。
 */
export function wordFormCandidates(term: string): string[] {
    const word = term.toLowerCase();
    const forms = [word];
    const push = (value?: string) => {
        if (value && !forms.includes(value)) forms.push(value);
    };
    if (word.endsWith('ies')) push(`${word.slice(0, -3)}y`);
    if (word.endsWith('ves')) push(`${word.slice(0, -3)}f`);
    if (word.endsWith('es')) push(word.slice(0, -2));
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) push(word.slice(0, -1));
    if (word.endsWith('ing')) {
        const stem = word.slice(0, -3);
        push(stem);
        push(`${stem}e`);
        push(`${stem}${stem.slice(-1)}`);
    }
    if (word.endsWith('ied')) push(`${word.slice(0, -3)}y`);
    if (word.endsWith('ed')) {
        const stem = word.slice(0, -2);
        push(stem);
        push(word.slice(0, -1));
        push(word.slice(0, -3));
    }
    if (word.endsWith('er')) push(word.slice(0, -2));
    if (word.endsWith('est')) push(word.slice(0, -3));
    return forms;
}

/** 查询词清洗：去首尾标点与空白，保留内部撇号/连字符。 */
function normalizeQueryTerm(raw: string): string {
    return raw.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** 按词性把中文释义与英文释义配对成 senses；无中文行时直接输出英文释义。 */
function buildSenses(enBlock: string, zhBlock: string): WordSense[] {
    const enLines = parseDefinitionLines(enBlock);
    const zhLines = parseDefinitionLines(zhBlock);
    const senses: WordSense[] = [];
    const usedEn = new Set<number>();
    for (const zh of zhLines) {
        if (senses.length >= MAX_SENSES) break;
        const enIndex = zh.pos ? enLines.findIndex((en, i) => !usedEn.has(i) && en.pos === zh.pos) : -1;
        if (enIndex >= 0) usedEn.add(enIndex);
        senses.push({pos: zh.pos ?? '', zh: zh.text, en: enIndex >= 0 ? enLines[enIndex]!.text : undefined});
    }
    if (!senses.length) {
        for (const en of enLines.slice(0, MAX_SENSES)) senses.push({pos: en.pos ?? '', en: en.text});
    }
    return senses;
}

/** 机器翻译兜底：复用微软免费网页接口，保证点词在任何词条上都有可用释义。 */
async function translateFallback(term: string, from: string, to: string, signal: AbortSignal): Promise<string> {
    const results = await translateMicrosoftTexts([term], from, to, signal);
    return results[0] ?? '';
}

/** 词典查询主入口：ECDICT 词形还原逐形匹配 -> 未命中走机器翻译兜底。 */
export async function lookupWord(rawTerm: string, from: string, to: string): Promise<WordLookupResult> {
    const startedAt = Date.now();
    const term = normalizeQueryTerm(rawTerm);
    if (!term) throw Object.assign(new Error('缺少要查询的单词'), {statusCode: 400});
    if (term.length > MAX_TERM_LENGTH) throw Object.assign(new Error('查询单词过长'), {statusCode: 400});
    if (!/\p{L}/u.test(term)) throw Object.assign(new Error('查询内容需包含字母'), {statusCode: 400});

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('查询超时')), LOOKUP_TIMEOUT_MS);
    try {
        // ECDICT 只覆盖英语：源语言明确非英语时直接机器翻译，不做词典查询。
        const dictionaryEligible = from === 'auto' || from === 'en';
        if (dictionaryEligible) {
            const index = await loadEcdictIndex();
            for (const form of wordFormCandidates(term)) {
                const row = index.get(form);
                if (!row) continue;
                const senses = buildSenses(row[2]!, row[3]!);
                const translation = senses.find((sense) => sense.zh)?.zh ?? '';
                return {
                    term,
                    found: true,
                    source: 'ecdict',
                    lemma: form === term.toLowerCase() ? undefined : row[0],
                    phonetic: row[1] ? `/${row[1]}/` : undefined,
                    pos: senses[0]?.pos || undefined,
                    senses,
                    translation: translation || row[3]!.replace(/\\n/gu, '；').trim() || row[2]!.replace(/\\n/gu, ' ').trim(),
                    ms: Date.now() - startedAt,
                };
            }
        }
        const translation = await translateFallback(term, from === 'auto' ? 'en' : from, to, controller.signal);
        if (!translation) throw new Error('机器翻译兜底未返回结果');
        return {
            term,
            found: false,
            source: 'mt-fallback',
            senses: [],
            translation,
            ms: Date.now() - startedAt,
        };
    } finally {
        clearTimeout(timer);
    }
}
