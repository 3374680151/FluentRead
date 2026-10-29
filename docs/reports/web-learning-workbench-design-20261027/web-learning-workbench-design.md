# FluentRead Web 学习工作台设计：词书集成与点词翻译（2026-10-27）

> 本文承接 [web-version-design-20261026](../web-version-design-20261026/web-version-design.md) 的网页版整体方案，聚焦四件事：
> 1. 盘点扩展里已有的"单词本"（词书）功能，明确哪些可以直接搬上网页版；
> 2. 设计词书集成进网页真站（`web/`）的架构与数据层选型；
> 3. 设计核心新页面"学习工作台"的完整链路：旁侧输入句子 → 翻译 → 点词出卡 → 收藏 → 复习；
> 4. 收敛网页版系统配置清单（该支持哪些、明确不做哪些）与页面按钮优化。

## 一、结论速览

- **扩展已有完整词书能力，网页版不新造、只搬运**：收藏（单词/表达/句子三类）、6 级掌握度 + 固定间隔复习（1/3/7/14/30 天，"忘了"10 分钟后重考）、AI 定向学习与造句练习、Anki TSV 导出、页面重遇高亮、学习材料聚合。数据存 IndexedDB（Dexie），领域层 `learningModel.ts` / `repository.ts` / `expressionMatcher.ts` 无扩展平台依赖，可原样打包进网页客户端。
- **集成路线**：MVP 词书数据放浏览器 IndexedDB（与扩展同 schema，导入导出互通），词典查词走服务端新增 `GET /api/word`，句子翻译走已有 `POST /api/translate`；M3 再账号化迁到服务端。
- **新增页面"学习工作台"**（`study.html`）：左栏输入句子、中栏双语对照 + 点词、右栏本次生词托盘；词卡浮层作为全站复用组件（文本/网页/文档/媒体页都能点词）。
- **配置收敛**：扩展 200+ 项配置中网页版只保留约 30 项（翻译、显示、点词与学习、朗读、数据、服务凭据六组）；扩展特有的注入类配置（popup 模块排序、悬浮球、右键菜单、7 种划词触发方式、站点名单）明确不做。

## 二、扩展词书能力盘点

### 2.1 数据模型

词条 `VocabularyEntry`（`src/features/vocabulary/learningModel.ts`）核心字段：

| 字段 | 说明 |
| --- | --- |
| `identityKey` | 唯一身份 = 源语言 + 归一化词条（NFKC/小写/标点归一），词与句子共用 |
| `kind` | `'word'`（单词）\| `'expression'`（表达）\| `'sentence'`（句子） |
| `term` / `sourceLanguage` / `normalizedTerm` | 原文与可比对词形 |
| `translations` | `Record<目标语言, {text, updatedAt}>`，多语种译文快照 |
| `phonetic` / `partOfSpeech` | 音标、词性（来自词典卡） |
| `note` | 用户或 AI 保存的简短解释（≤2000 字符） |
| `contexts` | 收藏语境数组，最多 8 条：原句文本、来源 URL、页面标题、视频起止时间 |
| `masteryLevel` 0–5 / `status` | 记忆状态：new / learning / familiar / mastered |
| `nextReviewAt` / `reviewCount` / `lapseCount` | 复习调度与统计 |
| `encounterCount` | 重复收藏同一词只合并语境并计数，不重复建条 |

存储为 Dexie IndexedDB 库 `FluentReadVocabularyBook`（表 `entries` + `reviewLogs`），词书上限 5000 条，复习日志每词最多 100 条。另有独立的"学习材料库"（`FluentReadMaterials`，上限 10000 条）把收藏、问答、笔记按材料（网页/文档/视频）聚合。

### 2.2 能力清单与网页版复用方式

| 能力 | 扩展内位置 | 网页版处置 |
| --- | --- | --- |
| 收藏词条（词/表达/句） | 划词弹窗星形按钮、阅读面板、视频字幕 | 学习工作台点词收藏，`upsert` 合并逻辑复用 |
| 复习会话（到期队列 → 翻卡 → 忘了/记得） | `VocabularyBook.vue` + `createVocabularyReviewSession` 纯状态机 | 复用状态机，`learn.html` 复习页落地 |
| 复习算法（Leitner 6 级 + 固定间隔表） | `scheduleVocabularyReview`（1/3/7/14/30 天；忘了归 0 + 10 分钟） | 直接复用，保证与扩展数据互通 |
| 单条定向学习（AI 讲解 + 造句） | `VocabularyStudy.vue` + `vocabularyStudyPrompt` | M2 接入（需 AI 服务，先做免费链路之外的第二个 API） |
| 搜索 / 筛选 / 分页 / 掌握度管理 | `VocabularyBook.vue`、`CollectionEntry.vue` | `learn.html` 单词本页按原交互重写 |
| 导出 JSON / Anki TSV、导入 | `exportData` / `importData` / `buildAnkiTsv` | 直接复用：与扩展互相导入，这是"网页版先用、扩展接力"的关键通路 |
| 页面重遇高亮（Aho-Corasick + Highlight API） | `content/scanner.ts`、`expressionMatcher.ts` | 匹配器复用：工作台输入历史中高亮已收藏词（M2） |
| 学习材料聚合与续读 | `material*` 系列、`MaterialWorkspace.vue` | M2 起做简化版：材料身份 + 收藏引用聚合 |
| 功能开关 | `config.vocabularyBookEnabled`、`vocabularyReencounterEnabled` | 网页版默认开启词书，无需开关（见第六节） |

### 2.3 词典能力（点词出卡的数据源）

扩展划词词卡的数据来自 `src/features/selection-translation/services/wordDictionary.ts`：本地 ECDICT 词典优先（固定版本 JSON 资产，3.9MB，SHA-256 校验，CacheStorage 缓存），未命中并发查询五个在线词典（有道网页、free-dictionary、wiktapi、wiktionary-rest、datamuse），含释义清洗、发音选择与缓存。词形归一在 `wordNormalization.ts`（纯函数，无依赖）。

网页版处置：该模块 import 了 `platform/http/runtime`（扩展 fetch 适配），**不直接打包进浏览器客户端**；在 Node 服务端新增 `GET /api/word`，复用其查询编排、清洗与发音选择逻辑，HTTP 换 Node 原生 fetch（与 `web/server.ts` 复用 provider 层同一先例）。ECDICT 资产由服务端持有一份，客户端零下载。

## 三、集成架构

### 3.1 分层复用矩阵

| 层 | 扩展现状 | Web 集成方式 |
| --- | --- | --- |
| 领域模型 | `learningModel.ts`（类型、复习状态机、挖空句、Anki TSV） | 纯函数，直接打包复用 |
| 匹配器 | `domain/expressionMatcher.ts`（Aho-Corasick，归一 + 词界规则） | 纯函数，直接打包复用 |
| 存储 | `repository.ts`（Dexie，仅依赖 dexie + 本地模块） | MVP 直接打包；定义 `VocabularyBookStore` 接口（= `protocol.ts` 的 action 联合），M3 增加服务端实现替换 |
| 词典 | `wordDictionary.ts` + `ecdictAsset.ts` | 服务端 `/api/word`（Node fetch 薄适配），ECDICT 服务端持有 |
| 翻译 | `src/providers/translation` | 已接入 `POST /api/translate` |
| 消息协议 | `protocol.ts`（`fluentReadVocabularyBook` 消息 + action 联合） | action 联合类型在 web 端复用为本地 store 接口，动作语义与后台 handler 一致 |
| UI 组件 | Vue 组件（`VocabularyBook.vue` 等） | 不直接复用（web 客户端为轻量页）；按 `learn.html` 原型重写，交互与数据语义严格对齐 |

### 3.2 数据层选型

- **MVP（本设计主线）：浏览器 IndexedDB，与扩展同 schema。** `web/` 客户端打包 `repository.ts` + `learningModel.ts`，Dexie 在任意网页 origin 可用。优点：零后端依赖、离线可用、导入导出与扩展完全互通；代价：数据不跨设备。
- **M3（账号化后）：服务端持久化。** 新增 `/api/vocabulary/*`，客户端把 `VocabularyBookStore` 的实现从 Dexie 换成 API 客户端，页面代码不变。冲突合并沿用现有语义（`translations` 按 `updatedAt` 合并、contexts 按 `capturedAt` 去重、note 按 `noteUpdatedAt` 防旧备份覆盖）。
- 网页 origin（如 `127.0.0.1:8787`）与扩展的 IndexedDB 天然隔离，互不影响；互通只走"导出 JSON → 导入 JSON"这一条明确通路。

### 3.3 构建方案

`web/vite.config.ts` 已把仓库根注册为 `@` 别名（服务端打包先例）。新增一个客户端库构建入口：`web/src/client/*.ts` → 打包为 `web/public/assets/vendor/fluentread-*.js`（ESM，无框架依赖），页面原生 `<script type="module">` 引用。包含：词书 store（Dexie + repository）、复习状态机、Anki TSV、表达匹配器、词形归一。UI 仍用各页面自己的 vanilla JS 调用这些模块。

### 3.4 服务端新增 API

| API | 说明 |
| --- | --- |
| `GET /api/word?term=&from=&to=&ctx=` | 词典查词：ECDICT 本地优先 → 在线词典并发补充 → 免费机器翻译兜底；返回音标、词性、释义、译文 |
| `POST /api/translate` | 已有，句子翻译（多服务并发对比可选） |
| `GET /api/services` | 已有 |
| `/api/vocabulary/*`（M3） | 词书 CRUD、复习提交、导入导出、账号体系 |

TTS 不建服务端：词卡与复习卡朗读用浏览器 `speechSynthesis`（免费、离线），与扩展"本地优先"策略一致。

## 四、学习工作台设计（核心页面）

### 4.1 定位

解决"读一句学一句"的场景：用户在左栏贴/敲一个句子，中栏给出双语对照，**点击句中任意单词立即弹出词卡**，看懂了收藏进词书，攒到一定量去复习。它是语言学习的主入口，也是词卡浮层的第一个宿主页面。

### 4.2 三栏布局

```text
┌──────────────┬──────────────────────────────┬───────────────┐
│ 输入侧（旁侧） │  译文侧（双语对照 + 点词）      │ 学习侧（托盘） │
│              │                              │               │
│ [句子 1]     │  原文（分词，可点击下划线）      │  本次收藏       │
│ [句子 2]     │  ─ delve  /delv/ v. 深入探究   │  · delve      │
│ [句子 3]     │  译文（整句，服务可选）          │  · hallucin-  │
│ ＋ 添加句子   │  ────────────────────────    │    ation      │
│              │  词卡浮层（点击词后弹出）        │  · get out of │
│ 源语言：自动 ▾ │                              │    your way   │
│ 目标：中文 ▾  │  服务：微软 ▾  [翻译] [朗读]     │  [去复习 →]   │
│ Ctrl+Enter   │                              │  [导出 Anki]  │
└──────────────┴──────────────────────────────┴───────────────┘
```

- 左栏：多句输入列表（每句一条，可删可重排），粘贴自动拆句；`Ctrl+Enter` 触发翻译；历史会话存 IndexedDB。
- 中栏：原文按词界分词渲染（词与词之间保留原文空格样式，悬停微高亮），译文在下方；每句一行工具（复制 / 朗读 / 整句收藏 / 多服务对比入口）。
- 右栏：本次会话收藏的生词托盘（词条 + 释义一行），支持移除；底部快捷动作"去复习"（跳 `learn.html` 复习页签）与"导出 Anki TSV"。

### 4.3 六条设计链路

**L1 句子翻译链路**
输入句子 → `POST /api/translate`（单服务默认 + 可选并发对比）→ 中栏双语对照渲染 → 原文分词标注（L2 前置）。失败时该句标红并保留原文可重试；超长句（>5000 字）提示拆分。

**L2 点词链路**
点击原文单词 → 词形还原（见 4.5）→ `GET /api/word` → 词卡浮层展示（词、音标、词性、释义、本句语境义、朗读）。加载中词卡骨架态；词典与在线源都未命中时回退为"整句译文摘录 + 机器翻译释义"并如实标注来源。选中多个连续词 → 按 `expression`（表达）出卡；选中整句 → 按 `sentence` 出卡。

**L3 收藏链路**
词卡"收藏"按钮 → 客户端词书 store `upsert`（`identityKey` 合并、重复收藏只加语境并 `encounterCount+1`）→ context 记录 `{text: 当前输入句, sourceUrl: 'web:study', pageTitle: 会话标题}` → 右栏托盘与 `learn.html` 列表实时更新（同页广播，复用 `VocabularyBookChangedMessage` 语义）。已收藏词在文中显示已藏标记，词卡按钮变为"已收藏 · 查看详情"。

**L4 复习链路**
`learn.html` 复习页签 → 到期队列（复用 `createVocabularyReviewSession`：到期老词优先 + 最多 10 个新词，批次 20）→ 翻卡（正面词 + 挖空句，`vocabularyReviewCloze` 复用）→ "忘了"（归 0，10 分钟后重考）/ "记得"（level+1，间隔 1/3/7/14/30 天）→ `review` 事务写词条 + 复习日志 → 队列推进。评分只保留两键，与扩展语义一致（不做"模糊"第三键，保证数据互通）。

**L5 材料聚合链路（M2）**
手动输入会话按内容指纹聚合为一条"学习材料"（`identityKey = fingerprint:<文本指纹>`，kind 用现有三分类中最贴近的 `article` 语义或扩展 `article` 枚举时以 fingerprint 来源区分）；收藏引用挂到材料；网页翻译（`webpage.html`）与文档翻译的材料分别按规范 URL / 内容指纹聚合，续读链接复用 `materialResumeLink` 思路。

**L6 数据互通链路**
`learn.html` 导出 JSON（全量词书 + 复习日志）与 Anki TSV（复用 `buildAnkiTsv`，默认不含隐私语境）→ 可导入回扩展；反向亦然。M3 服务端存储上线后，导出导入继续保留作为备份通路。

### 4.4 词卡浮层组件（全站复用）

一个独立浮层组件 `fr-word-popup`，宿主页面只提供"点击目标 + 上下文句子"，其余自包含：

- 触发：单击单词（默认）/ 选中片段（表达与句子）；Esc 或点击外部关闭；全键盘可达。
- 内容：词条 + 音标 + 发音按钮；词性 + 释义列表（ECDICT，含例句）；"本句含义"（来自整句译文的语境义，标注为机器翻译）；AI 讲解入口（M2，流式）。
- 动作：朗读（`speechSynthesis`）、收藏 / 已收藏（跳详情）、复制。
- 状态：加载骨架 / 未命中回退 / 网络失败重试 / 私密模式同常规模式（无扩展无痕约束）。
- 宿主：学习工作台（输入句 + 译文）、`text.html` 词典条升级为词卡、`webpage.html` 阅读视图内点词（M2）、`document.html` 阅读区（M2）。

### 4.5 分词与词形还原规则

- 词界语言（英/法/德/西等）：按 Unicode 词界切分（`\p{L}[\p{L}\p{M}\p{N}'-]*`），保留连字符与撇号词（`state-of-the-art`、`don't`）。
- 词形还原 MVP：规则表（-s/-es/-ed/-ing/-d 等）+ 词典命中校验（还原后查 ECDICT，未命中再试原形/规则变体），复用 `normalizeEnglishWord` 的归一逻辑。
- 中文 / 日文：MVP 不做点词（分词需引入分词器），点击整句出句子卡，卡内提供"AI 拆解"入口（M2，流式讲解分词与语法）。界面上对 CJK 文本隐藏词下划线，避免"点了没反应"的误导。
- 多词表达：用户选中片段即表达卡，不做自动搭配识别（避免误报）。

### 4.6 边界与失败态

| 场景 | 行为 |
| --- | --- |
| 词典全未命中 | 词卡降级为机器翻译释义，如实标注"词典未收录，来自机器翻译" |
| `/api/word` 服务失败 | 词卡显示重试按钮与失败原因；翻译不受影响 |
| 重复收藏 | 合并语境 + 计数，词卡提示"已收藏 N 次" |
| 收藏数达上限（5000） | 提示清理或导出归档，与扩展同一上限语义 |
| 离线 | 翻译/查词不可用并明确提示；词书列表、复习、导出全部本地可用 |
| 页面刷新/关闭 | 输入草稿与历史存 IndexedDB，未完成的翻译请求随页面终止（AbortController） |

## 五、页面按钮优化

| 页面 | 现状 | 优化 |
| --- | --- | --- |
| `index.html` 工作台 | 四入口卡 + 概览（演示数据） | 新增第五入口"学习工作台"；"继续阅读"卡接材料库（M2）；概览接真实词书统计（待复习数、收藏总数） |
| `study.html` 学习工作台 | 新增页 | 三栏布局 + 词卡浮层；按钮集：翻译 / 朗读 / 复制 / 整句收藏 / 对比 / 添加句子 |
| `text.html` 文本·写作 | 译文工具栏演示按钮 | 词典条升级为统一词卡浮层；译文工具栏收敛为：复制 / 朗读 / **收藏到单词本** / 分享卡 / 对比 |
| `learn.html` 学习中心 | 单词本行内只有朗读、删除；复习卡为"忘记/模糊/认识"三键 | 行内补齐：**学习**（定向学习页）、编辑释义、标记掌握；筛选 chips 对齐扩展（词/表达/句 × 掌握状态 × 排序）+ 分页；复习改两键"忘了 / 记得"（对齐扩展评分语义）；顶部统计接真实数据 |
| 全站 | — | 词卡浮层统一组件；危险操作（删除词条）统一二次确认 + toast 撤销（复用扩展 `removeWithSnapshot` 撤销语义） |

## 六、系统配置收敛

### 6.1 原则

扩展配置为"向任意网页注入能力"而生（触发方式、悬浮球、站点名单、popup 排序）。网页版是自有站点，交互形态固定，配置只保留四类：**翻译质量、显示偏好、学习行为、数据与服务凭据**。目标是让 `settings.html` 一屏能看完，而不是平移扩展的设置树。

### 6.2 网页版应支持的配置（约 30 项）

| 分组 | 配置项 |
| --- | --- |
| 通用 | 主题（亮/暗/跟随系统，已有）、界面语言（中/英） |
| 翻译 | 默认语言对、自动检测开关、默认服务、对比服务集合（多选）、译文自动朗读开关 |
| 显示 | 译文字号、双语排列（上下/左右）、译文样式预设（颜色/下划线/背景，实时预览） |
| 点词与词卡（新增） | 触发方式（单击/仅选中）、自动发音开关、词典来源偏好（本地优先/仅在线）、是否显示"本句含义" |
| 学习偏好（新增） | 每日新词上限（默认 10，与复习批次语义一致）、复习批次大小、再次遇见高亮开关（工作台内）、收藏时需确认开关 |
| 朗读 | 引擎（浏览器内置语音）、音色、语速 |
| 数据 | 导出 JSON / Anki TSV、导入、清空词书（二次确认）、翻译历史容量 |
| 服务凭据 | 归 `services.html`：密钥、模型、连接测试、限流（M3 账号化后入账号） |

### 6.3 明确不支持的扩展配置（及理由）

| 扩展配置 | 不做理由 |
| --- | --- |
| Popup 模块/快捷功能排序（`popupModuleOrder`、`popupQuickFeatureOrder`） | 网页无 popup，站点 IA 固定 |
| 悬浮球全套（位置/透明度/点击行为/热键/折叠名单） | 无 content script 注入场景；`webpage.html` 阅读面板用固定形态 |
| 右键菜单（`contextMenuEntries`） | 浏览器扩展特有 |
| 划词触发 7 种方式（direct/icon/dot/hover/contextMenu/修饰键/自定义热键） | 网页版统一为"单击/选中"两种，配置只留开关 |
| 站点名单（始终翻译/禁用扩展/悬浮球禁用名单） | 无按站点注入范畴 |
| 全局快捷键配置 | 仅保留编辑器内固定键（`Ctrl+Enter` 翻译），不做键位表 |
| 14 套皮肤、扩展字体下载 | 亮/暗主题 + 单主色，字体用系统栈 |
| 翻译加载动画 12 种、进度面板 | 统一一种加载态 |
| 本地模型管理（WASM/Kokoro/Whisper 下载） | M3 后按需单独立项 |
| MAIN world 桥、offscreen、MV2/MV3 差异 | 浏览器扩展特有 |

## 七、功能清单与里程碑

| 编号 | 功能 | 优先级 | 里程碑 |
| --- | --- | --- | --- |
| F1 | 学习工作台：多句输入、`/api/translate`、双语对照、会话历史 | P0 | M1 |
| F2 | 点词分词与词形还原（词界语言） | P0 | M1 |
| F3 | 词卡浮层 + `GET /api/word`（ECDICT 服务端 + 在线回退） | P0 | M1 |
| F4 | 收藏到词书（客户端 Dexie store + 托盘） | P0 | M1 |
| F5 | `learn.html` 单词本：列表/筛选/搜索/分页/编辑/删除/撤销 | P0 | M1 |
| F6 | 导入导出 JSON + Anki TSV（与扩展互通） | P0 | M1 |
| F7 | 复习会话（状态机复用、翻卡、两键评分、到期队列） | P1 | M2 |
| F8 | 学习工作台内"再次遇见"高亮（expressionMatcher 复用） | P1 | M2 |
| F9 | 学习材料聚合（会话/网页/文档）与续读 | P1 | M2 |
| F10 | 定向学习页（AI 讲解 + 造句，`vocabularyStudyPrompt` 复用，需 AI 服务接入） | P1 | M2 |
| F11 | `webpage.html` / `document.html` 阅读视图内点词与词卡 | P1 | M2 |
| F12 | CJK 点词（分词器 + AI 拆解） | P2 | M3 |
| F13 | `/api/vocabulary/*` 服务端存储 + 账号 + 多设备同步 | P2 | M3 |
| F14 | `stats.html` 接真实统计数据（收藏/复习/翻译用量） | P2 | M3 |
| F15 | 分享卡、`text.html` 写作页签真站化 | P2 | M3 |

里程碑验收口径：M1 = 贴一句英文 → 翻译 → 点词 → 收藏 → 导出 Anki 全链路真实可用，无演示数据；M2 = 收藏的词能在复习页完成一轮"忘了/记得"并正确调度下次复习；M3 = 换设备登录后词书一致。

## 八、API 契约草案

```text
GET /api/word?term=delve&from=en&to=zh-Hans&ctx=<可选整句>
200 {
  "term": "delve",
  "phonetic": "/delv/",
  "partOfSpeech": "v.",
  "senses": [{"definition": "to dig; to investigate deeply", "translated": "深入探究，钻研", "example": "..."}],
  "translation": "深入探究",        // 机器翻译兜底
  "source": "ecdict" | "youdao-web" | "mt-fallback",
  "ms": 120
}
404 {"error": "未收录"}             // 客户端降级为整句语境义
```

词书客户端 store 接口 = `src/features/vocabulary/protocol.ts` 的 action 联合（`list/get/getByTerm/upsert/updateNote/review/setMastery/relearn/remove/removeWithSnapshot/clear/exportData/importData` + 变更通知），MVP 为本地 Dexie 实现，M3 增加同接口的 API 实现，页面无感切换。

## 九、工程与验证约束

- 复用优先：领域层、复习算法、词典编排、匹配器一律复用 `src/` 既有实现，网页端不复制第二套逻辑；确需适配的只有 HTTP 边界（Node fetch）与 UI 重写。
- `web/` 下新增 TS 文件沿用"文件头中文长注释"规范；客户端 bundle 不引入 Vue/React，保持现有轻量页形态。
- 验证按 [测试与回归](../../testing.md) 执行：M1 交付前跑 `pnpm compile`、`pnpm web:build && pnpm web:start` 真实走通 L1–L3 链路，`pnpm test:unit` 覆盖复用的纯函数不回归；`pnpm docs:build` 验证本文档。
- 与扩展互通是硬性验收项：同一条导出 JSON 必须能被扩展 `importData` 接受，反之亦然（字段与 schema 版本对齐 `schemaVersion`）。
