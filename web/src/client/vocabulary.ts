/**
 * @file web/src/client/vocabulary.ts
 *
 * 文件职责：FluentRead Web 客户端词书模块的打包入口，把扩展的词书领域层原样暴露给
 * 学习工作台（study.html）与学习中心（learn.html）等轻量页面使用。
 * 主要内容：以 ES Module 形式再导出 src/features/vocabulary 的词书仓库单例
 * （IndexedDB/Dexie 存储、upsert 合并、复习调度、导入导出）与复习会话状态机、
 * 挖空句、Anki TSV 构建等纯函数；web/vite.config.client.ts 将其打包为
 * web/public/assets/vendor/fr-vocabulary.js。
 * 模块边界：只做转发导出，不包含任何页面 DOM 或网络逻辑；与扩展共享同一套领域实现，
 * 导出 JSON / Anki TSV 与扩展互通。
 */

export {
    vocabularyBook,
    vocabularyBookDb,
    VocabularyBookError,
    VOCABULARY_REVIEW_AGAIN_DELAY_MS,
    VOCABULARY_REVIEW_GOOD_INTERVALS_MS,
} from '@/src/features/vocabulary/repository';
export * from '@/src/features/vocabulary/learningModel';
