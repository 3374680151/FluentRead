/**
 * @file userscript/languageData.ts
 * 文件职责：无损编码脚本本地内嵌的中英文语言数据，让新增多语文案继续满足既有单文件预算。
 * 主要内容：目录按键和值分列，模板按正则、译文和可选捕获组分列；standalone 英文仅在键列与默认中文完全同序时省略该列。解码验证列长与字符串类型，恢复字典和模板次序，保留合法旧完整列及对象格式。
 * 模块边界：只转换静态数据表示，不执行模板、不加载完整词典、不压缩可执行逻辑。
 */
import type {LegacyPatternEntry, MessageCatalog, UiLanguageBundle} from '@/src/core/i18n/types';

export type CatalogColumns = readonly [readonly string[], readonly string[]];
type PatternColumns = readonly [readonly string[], readonly string[], readonly (readonly number[] | null)[]];
type LanguageColumns = readonly [keys: readonly [readonly string[] | null, readonly string[]], early: PatternColumns, late: PatternColumns, texts: CatalogColumns];

/** 构建期稳定排序；中英同序目录可共用已经内嵌的中文键列。 */
export function packMessageCatalog(value: MessageCatalog): CatalogColumns {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1);
    return [entries.map(([key]) => key), entries.map(([, text]) => text)];
}

/** 验证后按原列次序恢复；重复键和特殊键沿用 Object.fromEntries 的行为。 */
export function unpackMessageCatalog(value: unknown): MessageCatalog {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Array.isArray)
        || value[0].length !== value[1].length || !value.every(column => Array.from(column).every(item => typeof item === 'string'))) {
        throw new TypeError('Invalid UI message columns');
    }
    return Object.fromEntries(value[0].map((key: string, index: number) => [key, value[1][index]]));
}

/** 只供构建使用；按键排序使输出不受导入和对象展开次序影响。 */
export function packUiLanguageBundle(bundle: UiLanguageBundle, sharedMessageKeys?: readonly string[]): LanguageColumns {
    const patterns = (entries: readonly LegacyPatternEntry[]): PatternColumns => [
        entries.map(([source]) => source), entries.map(([, text]) => text), entries.map(([, , captures]) => captures ?? null),
    ];
    const messages = packMessageCatalog(bundle.messages), legacy = packMessageCatalog(bundle.legacyText);
    const shared = sharedMessageKeys?.length === messages[0].length && messages[0].every((key, index) => key === sharedMessageKeys[index]);
    // 资源键与模板相邻，完整译文集中在末尾，减少模板和目录中的相同片段超出 gzip 窗口。
    return [[shared ? null : messages[0], legacy[0]], patterns(bundle.legacyPatterns.early), patterns(bundle.legacyPatterns.late), [messages[1], legacy[1]]];
}

/** 恢复并验证本地目录列；原始对象格式保持兼容，完整 bundle 形状继续由加载器统一校验。 */
export function unpackUiLanguageBundle(value: UiLanguageBundle | LanguageColumns, sharedMessageKeys?: readonly string[]): UiLanguageBundle {
    if (!Array.isArray(value)) return value as UiLanguageBundle;
    const patterns = ([sources, texts, captures]: PatternColumns): LegacyPatternEntry[] => sources.map((source, index) =>
        captures[index] === null ? [source, texts[index]] : [source, texts[index], captures[index]!]);
    return {messages: unpackMessageCatalog([value[0][0] === null ? sharedMessageKeys : value[0][0], value[3][0]]), legacyText: unpackMessageCatalog([value[0][1], value[3][1]]),
        legacyPatterns: {early: patterns(value[1]), late: patterns(value[2])}};
}
