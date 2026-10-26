/**
 * @file web/server.ts
 *
 * 文件职责：FluentRead Web 真站服务入口——Node HTTP 服务器，托管 web/public 静态页面并提供真实 API：
 * 免费翻译由本服务直接转发到免费翻译上游，复用 src/providers/translation 的供应商适配层
 * （与扩展、userscript 同一套协议代码）；OpenAI 兼容的 AI 服务（聊天补全与模型列表）由本服务
 * 按请求转发到用户在页面里配置的 Base URL。运行时 fetch 使用 Node 原生全局实现。
 * 主要内容：静态文件服务；POST /api/translate 单服务与多服务并发对比翻译；GET /api/services
 * 服务目录；POST /api/ai 聊天补全转发；POST /api/ai/models 模型列表拉取；
 * 每请求独立超时与取消；结果含真实耗时与失败原因。
 * 模块边界：只做 HTTP 编排与静态转发；不实现页面 DOM；API 密钥仅随请求使用，不落盘、
 * 不写入日志、不参与缓存；不缓存翻译与 AI 结果。
 */

import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {translateMyMemoryText} from '@/src/providers/translation/mymemory';
import {translateGoogleTexts} from '@/src/providers/translation/google';
import {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';
import {translateFreeWebText} from '@/src/providers/translation/free-web';
import {translateOfficialFreeWebText} from '@/src/providers/translation/free-official-web';
import {createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import {TRANSLATION_PROVIDER_CONFIG,
    type TranslationProviderRequestContext} from '@/src/services/translation/types';

const DIST_DIR = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(DIST_DIR, '../public');
const PORT = Number(process.env.FR_WEB_PORT || 8787);
const REQUEST_TIMEOUT_MS = 20_000;
const AI_TIMEOUT_MS = 120_000;
const MAX_BODY_LENGTH = 200_000;
const MAX_TEXT_LENGTH = 5000;

/** 真站首批接入的免密钥服务；标签同时用于前端展示。 */
const SERVICES: Record<string, {label: string}> = {
    microsoft: {label: '微软翻译（网页接口）'},
    transmart: {label: '腾讯交互翻译'},
    alibaba: {label: '阿里翻译（网页接口）'},
    mymemory: {label: 'MyMemory（官方免费 API）'},
    google: {label: 'Google 翻译（网页接口）'},
};

const LANGUAGES: Record<string, string> = {
    auto: '自动检测',
    en: 'English',
    'zh-Hans': '简体中文',
    'zh-Hant': '繁體中文',
    ja: '日本語',
    ko: '한국어',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
    ru: 'Русский',
};

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

/** MyMemory 适配器要求请求携带冻结配置快照与语言覆盖；免费链路只需语言对与服务名。 */
function myMemoryContext(from: string, to: string, signal: AbortSignal): TranslationProviderRequestContext {
    return {
        [TRANSLATION_PROVIDER_CONFIG]: createTranslationProviderConfigSnapshot({
            service: 'mymemory',
            from,
            to,
            useCache: false,
            enableAIContext: false,
            model: {},
            customModel: {},
            proxy: {},
            custom: '',
            deeplx: '',
            newApiUrl: '',
            minimaxBillingPlan: '',
            minimaxRegion: '',
            mimoBillingPlan: '',
            mimoRegion: '',
            azureOpenaiEndpoint: '',
            customBody: {},
            system_role: {},
            user_role: {},
            deepseekApiType: '',
            deepseekThinkingMode: '',
        }),
        abortSignal: signal,
    };
}

async function runService(service: string, text: string, from: string, to: string, signal: AbortSignal): Promise<string> {
    if (service === 'google') {
        const results = await translateGoogleTexts([text], from, to, signal, REQUEST_TIMEOUT_MS);
        return results[0] ?? '';
    }
    if (service === 'microsoft') {
        const results = await translateMicrosoftTexts([text], from, to, signal);
        return results[0] ?? '';
    }
    if (service === 'transmart') {
        return translateFreeWebText('transmart', text, from, to, signal);
    }
    if (service === 'alibaba') {
        return translateOfficialFreeWebText('alibabaFree', text, from, to, signal);
    }
    if (service === 'mymemory') {
        return translateMyMemoryText(text, {sourceLanguage: from, targetLanguage: to, abortSignal: signal, ...myMemoryContext(from, to, signal)});
    }
    throw Object.assign(new Error('未知服务'), {statusCode: 400});
}

interface TranslateResult {
    service: string;
    label: string;
    ok: boolean;
    text?: string;
    error?: string;
    ms: number;
}

async function translateWithTiming(service: string, text: string, from: string, to: string): Promise<TranslateResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('请求超时')), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
        const text2 = await runService(service, text, from, to, controller.signal);
        return {service, label: SERVICES[service]!.label, ok: true, text: text2, ms: Date.now() - startedAt};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {service, label: SERVICES[service]!.label, ok: false, error: message, ms: Date.now() - startedAt};
    } finally {
        clearTimeout(timer);
    }
}

function readJsonBody(raw: string): {text: string; from: string; to: string; services: string[]} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw Object.assign(new Error('请求体不是有效 JSON'), {statusCode: 400});
    }
    const body = parsed as {text?: unknown; from?: unknown; to?: unknown; services?: unknown};
    if (typeof body.text !== 'string' || !body.text.trim()) {
        throw Object.assign(new Error('缺少要翻译的文本'), {statusCode: 400});
    }
    if (body.text.length > MAX_TEXT_LENGTH) {
        throw Object.assign(new Error(`文本超出 ${MAX_TEXT_LENGTH} 字上限`), {statusCode: 400});
    }
    const from = typeof body.from === 'string' && body.from in LANGUAGES ? body.from : 'auto';
    const to = typeof body.to === 'string' && body.to in LANGUAGES ? body.to : 'zh-Hans';
    const requested = Array.isArray(body.services) ? body.services : [];
    const services = requested.filter((item): item is string => typeof item === 'string' && item in SERVICES);
    if (!services.length) throw Object.assign(new Error('至少选择一个翻译服务'), {statusCode: 400});
    if (to !== 'auto' && to === from && from !== 'auto') {
        throw Object.assign(new Error('源语言与目标语言相同'), {statusCode: 400});
    }
    return {text: body.text, from, to, services};
}

function sendJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(body);
}

/* ===================== AI 转发（OpenAI 兼容） =====================
 * 密钥仅存在于请求生命周期内：随浏览器请求带来、转发给用户指定的上游后即丢弃，
 * 不写文件、不写日志、不做任何持久化。 */

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
    return new Promise((resolveBody, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_LENGTH) {
                reject(Object.assign(new Error('请求体过大'), {statusCode: 413}));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

/** 归一化 Base URL：去尾部斜杠并校验协议，防止把请求发到非 http(s) 目标。 */
function normalizeBaseUrl(raw: unknown): string {
    const trimmed = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\//.test(trimmed)) {
        throw Object.assign(new Error('Base URL 必须以 http:// 或 https:// 开头'), {statusCode: 400});
    }
    return trimmed;
}

interface AiEndpointInput {
    baseURL: string;
    apiKey?: string;
}

function readAiEndpoint(raw: string): AiEndpointInput {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw Object.assign(new Error('请求体不是有效 JSON'), {statusCode: 400});
    }
    const body = parsed as {baseURL?: unknown; apiKey?: unknown};
    return {baseURL: normalizeBaseUrl(body.baseURL), apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined};
}

/** 调用 OpenAI 兼容 /chat/completions；返回统一的结果结构（含真实耗时）。 */
async function aiChat(input: AiEndpointInput & {model: string; messages: Array<{role: string; content: string}>;
    temperature?: number; maxTokens?: number;}): Promise<{ok: boolean; text?: string; error?: string; ms: number}> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('请求超时')), AI_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
        const headers: Record<string, string> = {'content-type': 'application/json'};
        if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
        const response = await fetch(`${input.baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                model: input.model,
                messages: input.messages,
                temperature: input.temperature ?? 0.3,
                stream: false,
                ...(input.maxTokens ? {max_tokens: input.maxTokens} : {}),
            }),
        });
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 300);
            return {ok: false, error: `上游返回 ${response.status}${detail ? `：${detail}` : ''}`, ms: Date.now() - startedAt};
        }
        const payload = await response.json() as {choices?: Array<{message?: {content?: unknown}}>};
        const text = payload.choices?.[0]?.message?.content;
        if (typeof text !== 'string') {
            return {ok: false, error: '上游响应缺少 choices[0].message.content', ms: Date.now() - startedAt};
        }
        return {ok: true, text, ms: Date.now() - startedAt};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {ok: false, error: message, ms: Date.now() - startedAt};
    } finally {
        clearTimeout(timer);
    }
}

interface AiChatRequestBody extends AiEndpointInput {
    model: string;
    messages: Array<{role: string; content: string}>;
    temperature?: number;
    maxTokens?: number;
}

function readAiChatBody(raw: string): AiChatRequestBody {
    const base = readAiEndpoint(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw Object.assign(new Error('请求体不是有效 JSON'), {statusCode: 400});
    }
    const body = parsed as {model?: unknown; messages?: unknown; temperature?: unknown; maxTokens?: unknown};
    if (typeof body.model !== 'string' || !body.model.trim()) {
        throw Object.assign(new Error('缺少模型名'), {statusCode: 400});
    }
    const messages = Array.isArray(body.messages)
        ? body.messages
            .map((item) => {
                const message = item as {role?: unknown; content?: unknown};
                return {role: String(message.role ?? ''), content: String(message.content ?? '')};
            })
            .filter((message) => message.content && (message.role === 'system' || message.role === 'user' || message.role === 'assistant'))
        : [];
    if (!messages.length) throw Object.assign(new Error('缺少对话消息'), {statusCode: 400});
    return {
        ...base,
        model: body.model.trim(),
        messages,
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        maxTokens: typeof body.maxTokens === 'number' ? Math.min(Math.round(body.maxTokens), 8192) : undefined,
    };
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    try {
        if (url.pathname === '/api/services') {
            sendJson(res, 200, {
                languages: LANGUAGES,
                services: Object.entries(SERVICES).map(([id, meta]) => ({id, label: meta.label})),
            });
            return;
        }
        if (url.pathname === '/api/ai' && req.method === 'POST') {
            const raw = await readBody(req);
            try {
                const body = readAiChatBody(raw);
                sendJson(res, 200, await aiChat(body));
            } catch (error) {
                sendJson(res, (error as {statusCode?: number}).statusCode ?? 400, {error: (error as Error).message});
            }
            return;
        }
        if (url.pathname === '/api/ai/models' && req.method === 'POST') {
            const raw = await readBody(req);
            try {
                const input = readAiEndpoint(raw);
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(new Error('请求超时')), REQUEST_TIMEOUT_MS);
                try {
                    const headers: Record<string, string> = {};
                    if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
                    const response = await fetch(`${input.baseURL}/models`, {headers, signal: controller.signal});
                    if (!response.ok) {
                        const detail = (await response.text().catch(() => '')).slice(0, 200);
                        sendJson(res, 200, {ok: false, error: `上游返回 ${response.status}${detail ? `：${detail}` : ''}`});
                        return;
                    }
                    const payload = await response.json() as {data?: Array<{id?: unknown}>};
                    const models = (payload.data ?? [])
                        .map((item) => (typeof item?.id === 'string' ? item.id : ''))
                        .filter(Boolean)
                        .sort();
                    sendJson(res, 200, {ok: true, models});
                } catch (error) {
                    sendJson(res, 200, {ok: false, error: error instanceof Error ? error.message : String(error)});
                } finally {
                    clearTimeout(timer);
                }
            } catch (error) {
                sendJson(res, (error as {statusCode?: number}).statusCode ?? 400, {error: (error as Error).message});
            }
            return;
        }
        if (url.pathname === '/api/translate' && req.method === 'POST') {
            const raw = await readBody(req);
            let body: {text: string; from: string; to: string; services: string[]};
            try {
                body = readJsonBody(raw);
            } catch (error) {
                sendJson(res, (error as {statusCode?: number}).statusCode ?? 400, {error: (error as Error).message});
                return;
            }
            const results = await Promise.all(
                body.services.map((service) => translateWithTiming(service, body.text, body.from, body.to)),
            );
            sendJson(res, 200, {from: body.from, to: body.to, results});
            return;
        }

        const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
        const target = resolve(PUBLIC_DIR, '.' + pathname);
        if (!target.startsWith(PUBLIC_DIR + sep)) {
            sendJson(res, 403, {error: '禁止访问'});
            return;
        }
        try {
            const info = await stat(target);
            const file = info.isDirectory() ? join(target, 'index.html') : target;
            const content = await readFile(file);
            res.writeHead(200, {'content-type': MIME[extname(file)] ?? 'application/octet-stream'});
            res.end(content);
        } catch {
            res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
            res.end('404 Not Found');
        }
    } catch (error) {
        sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)});
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[fluentread-web] 真站已启动: http://127.0.0.1:${PORT}`);
});
