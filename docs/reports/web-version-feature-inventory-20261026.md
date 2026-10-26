# FluentRead 全功能整理与 Web 版改造分析（2026-10-26）

> 目的：盘点 FluentRead 当前全部用户可见功能，评估将主要功能做成纯网页版本（接入自有服务）时哪些可以直接复用、哪些必须改造、哪些无法迁移。依据为对 `src/features/`、`src/providers/translation/`、`src/platform/`、`entrypoints/`、`userscript/` 的全量代码勘查。

## 一、产品概览与现有发布形态

FluentRead 是"全文双语翻译 + 划词翻译 + 多翻译服务"的浏览器扩展，技术栈 WXT 0.20 + Vue 3 + TypeScript，当前有三种发布形态：

| 形态 | 运行方式 | 对 Web 版改造的意义 |
| --- | --- | --- |
| Chrome/Edge MV3 扩展 | content script 注入任意站点 + background service worker + offscreen | 功能最全的基准形态 |
| Firefox MV2 扩展 | 后台页面内隐藏 iframe 替代原生 offscreen | 证明 offscreen 层可替换 |
| 油猴脚本（userscript/） | 无扩展 background，`GM_xmlhttpRequest` 跨域 + GM 存储配置 | **已经完成过一次"去扩展化"**，核心翻译链路（features→services→providers）被证明可以脱离扩展后台运行 |

userscript 版是 Web 版改造最重要的参照：它把 HTTP 边界（`src/platform/http/runtime.ts` 的 `setRuntimeFetch`）和配置存储都做成了可替换端口，共享同一套 provider 与编排代码。

## 二、完整功能清单（src/features/ 28 个模块）

### A. 核心翻译功能（产品主干）

| 功能 | 模块 | 用户价值 | 扩展依赖 |
| --- | --- | --- | --- |
| 全文翻译 | `full-page-translation` | 整页双语对照/仅译文；视口优先级调度、AI 多段合并、逐句高亮、标题翻译、进度面板、跨域 iframe 中继（QQ/网易邮箱、Kaggle、HF Spaces） | content 注入 + Shadow UI + 跨 frame 消息 |
| 划词翻译 | `selection-translation` | 选词弹卡：翻译 + 本地词典（ECDICT）+ 免费 AI 讲解 + 三级 TTS 朗读（Edge 在线/Kokoro 本地/页面合成）+ 收藏进单词本 | content + Shadow UI + offscreen TTS + 右键菜单 |
| 悬浮翻译 | `hover-translation` | 按住快捷键移动鼠标，段落即时悬浮译文 | content 键鼠监听（页面级快捷键，非浏览器 commands） |
| 局部翻译 | `section-translation` | 点选页面某块区域只翻译该块；CSS 路径存为站点规则，下次自动翻译 | content + Shadow UI + 本地规则存储 |
| 文档翻译 | `document-translation` | 独立工作台：PDF/EPUB/DOCX/HTML/MD/TXT/在线 PDF 导入、版面分析、原版回填/左右对照阅读、扫描件 OCR、双语 PDF/DOCX/ZIP 导出、历史续读 | 独立扩展页 + offscreen OCR + IndexedDB，**几乎不依赖 content** |
| 图片/漫画翻译 | `image-translation` | 单图原图/译图切换；漫画整章连翻：PaddleOCR 气泡识别 + LaMa 修复 + 译文排版回填；Tesseract.js 多语言 OCR | content + offscreen 推理（mangaInferenceWorker）+ DNR 改防盗链 Referer |
| 视频字幕 | `video-subtitle` | YouTube/X 双语字幕：原生字幕拦截翻译、本地 Whisper 生成字幕、KTV 逐字高亮、日/泰/印/俄读音标注、单句循环学习、SRT 导出 | **MAIN world 桥**（youtubeBridge/xVideoBridge 拦截 fetch/XHR）+ offscreen 转写 |

### B. 入口与交互形态

| 功能 | 模块 | 说明 | 扩展依赖 |
| --- | --- | --- | --- |
| 悬浮球 | `floating-ball` | 网页边缘可拖动工具球，聚合全文翻译开关与快捷面板（内嵌扩展 popup，一次性票据防伪造） | content + popup 作为 web_accessible iframe |
| 快捷翻译方案 | `quick-translation` | 为悬停/全文/局部各配多套键位方案，每套独立服务、模型、语言、展示策略 | content 手势层 |
| 圈选翻译 | `area-translation` | 拖矩形对**屏幕截图** OCR 翻译，可翻译任何屏幕内容（含视频/Canvas） | **background `tabs.captureVisibleTab` 截图** + offscreen OCR |
| 输入框翻译 | `input-translation` | 输入框内三连击触发符，把母语输入替换为目标语言译文；支持 Lexical/ProseMirror/Draft/Slate/Quill 富文本 | content DOM 监听 |
| 段落复制 | `paragraph-copy` | 快捷键复制鼠标所指整段（可含译文） | content + clipboard |

### C. 学习与阅读增强

| 功能 | 模块 | 说明 |
| --- | --- | --- |
| 单词本/学习中心 | `vocabulary` | 收藏词/表达/句 + 复习调度 + 阅读时"再次遇见"高亮 + 学习材料库（网页/文档/视频出处定位续读）；Dexie 本地持久化 |
| 阅读助手 | `reading-assistant` | 划词卡"讲解"页签：AI 流式讲解、句法分析、追问、引文回锚；30 天历史 + 长期学习笔记 |
| 写作助手 | `writing-assistant` | Gmail/GitHub 回复框旁 AI 起草，按长度/风格/语气偏好，核对后插回编辑器 |
| 智能信息高亮 | `information-highlight` | 本地小语言模型对关键词句按"意外度"高亮（wllama WASM Worker，无模型退化为词频规则） |
| 个人校订 | `personal-corrections` | 手动校订网页译文，形成个人译法库，后续翻译优先采用 |
| 术语库 | `glossary` | 多套术语词库（源词→固定译名），限语言方向与站点，AI 提示词注入/结果约束 |
| 分享卡片 | `share-card` | 双语摘录生成 PNG 分享图，八套主题，Canvas 纯前端 |

### D. 本地模型基础设施（离线能力）

- 本地翻译模型 `local-translation`：OPUS / 混元 Hy-MT2，offscreen + 专用 Worker，模型分块下载缓存。
- 本地 TTS `local-tts`：Kokoro v1.1（含中文音色）。
- 本地转写：Whisper q4/q8（在 video-subtitle 内，滑窗流式或整片识别）。

### E. 管理与统计

- 设置中心 `settings`：服务与密钥、快捷键、界面风格、网站名单与正文适配、各功能子设置、缓存管理、备份恢复（本地全量备份 + Google Drive OAuth / WebDAV 云备份）、设置历史。
- 翻译中心 `translation-center`：同一段输入并发多服务横向对比。
- 翻译统计 `translation-stats` / 模型用量 `model-usage`：请求规模、耗时、失败分布、token 明细。
- 站点规则 `site-rules`、页面通知 `page-notice`、自助诊断 `self-help`。

## 三、翻译服务全清单（src/providers/translation，40+）

**免费（无需 key）**：免费翻译服务 `freeTranslation`（默认，后台聚合 16 条免费线路自动均衡换线：微软网页、B 站、腾讯交互 Transmart、火山、豆包网页、谷歌网页、有道、金山词霸、Yandex、MyMemory、Reverso、Apertium、阿里、ModernMT、Lara、Lingvanex）；另可单选 B 站 `bilibili`、MyMemory、微软网页端、谷歌网页端、DeepLX（公共/自建端点）。

**传统 MT（需 key）**：DeepL、小牛、有道（token 制）；腾讯云、谷歌云、Azure、阿里云、百度、火山引擎（云厂商控制台密钥，均有免费额度）。

**AI/LLM（需 key，选模型）**：国内——DeepSeek、千问、豆包、Kimi、智谱 GLM、混元模型、混元翻译、文心、MiniMax、MiMo、阶跃、百川、零一、无问芯穹；海外——OpenAI、ChatGPT 套餐（本机 OAuth）、Azure OpenAI、Gemini、Claude、Grok；聚合——硅基流动、New API、OpenRouter、Groq、Mistral、Cohere、Cerebras、Together、Fireworks、DeepInfra、Perplexity、自定义 OpenAI 兼容接口（含动态注册 `custom-*`）。

**本地/内置**：Chrome 内置翻译 `chromeTranslator`（Chrome Translator API）、本地模型翻译（OPUS/混元/wllama）、Ollama（本机运行时）。

实现机制：大部分 AI 服务复用共享 OpenAI 兼容 transport（Vercel AI SDK），注册于 `registry.ts`；调用链 `feature → services/translation/client → broker（缓存/去重/凭据校验）→ provider → platform/http`。

## 四、Web 版改造分析

### 4.1 扩展的三大特权（Web 版全部没有）

1. **任意站点注入**：`<all_urls>` host 权限 + content script —— 全文/划词/悬浮/局部/视频/图片悬浮等功能的存在前提。
2. **绕过 CORS**：background fetch 对任意域不受页面 CORS 约束；个别服务再叠加 declarativeNetRequest 改请求头（B 站移除 Origin、Pixiv 补 Referer、豆包访客改头）。
3. **offscreen + 专用 Worker**：MV3 service worker 不能跑 WASM 推理，本地翻译/TTS/Whisper/OCR 全走 offscreen 文档。

### 4.2 分级改造清单

**第一级：直接复用（改造量极小）**

- `src/core/**` 全部纯算法（语言检测、DOM 候选发现、热键、槽序列化、站点规则匹配）——零浏览器依赖。
- `src/providers/translation/**`——纯 HTTP 协议适配代码，与运行环境无关。
- **文档翻译工作台**（document-translation）——本来就是独立 Vue 页面 + IndexedDB，去掉扩展页外壳即是 Web 应用；OCR 可直接在页面 Worker 跑。
- **翻译中心、翻译统计、模型用量、设置中心、术语库**——本质都是扩展页面（Vue + 消息代理），改为直连服务层即可。
- 单词本（IndexedDB → 保留本地或换服务端账号体系）、分享卡片（纯 Canvas）。
- `src/ui/**`、`src/shared/**`。

**第二级：需要改造**

| 改造点 | 现状 | Web 版方案 |
| --- | --- | --- |
| 网络层 / CORS | background fetch + host 权限；userscript 用 `GM_xmlhttpRequest`（普通网页不可用） | **自建服务端翻译代理**：统一转发 40+ provider 请求，兼管密钥；DNR 请求头改写逻辑（B 站 Origin、Pixiv Referer）移到代理层。这是 Web 版最大的新增工程 |
| 编排层 | `services/translation/broker.ts`（缓存、pending 去重、fallback、免费池换线） | 缓存去重可保留在前端；免费池换线、限流建议随代理下沉到服务端 |
| 配置与密钥存储 | 后台加密 IndexedDB（Dexie + AES-GCM）权威 + 消息代理 | 密钥存服务端（用户账号）或 localStorage；`services/config` 的编辑会话/editor 纯逻辑可复用 |
| 消息中枢 | background typed message router 连接 content/popup/options/offscreen | 自家页面内改直连服务层（同进程函数调用），删去消息层 |
| 本地 AI（翻译/TTS/Whisper/OCR） | offscreen + 专用 Worker + Cache Storage 模型下载 | 标准 Web Worker + WASM + Cache API，**改造是简化**（去掉 offscreen 握手/重建协议） |
| popup / 悬浮球 | popup 为扩展特有页面；悬浮球内嵌 popup iframe | popup → 网页内设置抽屉/侧边栏；悬浮球在自家页面可直接复用 Shadow UI 实现 |
| 右键菜单 | browser.contextMenus | 自定义浮层菜单 |
| 圈选翻译 | `tabs.captureVisibleTab` | `getDisplayMedia` 屏幕共享截图（需用户授权），或只支持页面内区域 |
| 快捷键 | 已是页面级键鼠手势（hotkeyRuntime），不走 browser.commands | 直接复用 |

**第三级：无法迁移 / 需重新设计**

- **任意站点注入类**（全文/划词/悬浮/局部/输入框/图片悬浮/写作助手注入 Gmail、GitHub）：Web 版不能注入别人的网站。若业务是"翻译任意网页"，需改为 **URL → 服务端抓取 → 代理域名下重渲染（重写链接/资源）→ 前端跑全文翻译引擎** 的模式（类 Google 翻译网页版）；若业务是自家站点内容，content feature registry 可直接挂载到自有页面。
- **跨域 iframe 中继**（QQ/网易邮箱、Kaggle、HF Spaces）：纯扩展能力，放弃。
- **MAIN world 视频桥**（YouTube timedtext 拦截、X 视频解析）：放弃；替代方案是服务端抓取字幕（YouTube timedtext 公开端点）+ 自有播放器渲染双语字幕。
- Chrome 内置翻译 `chromeTranslator`：浏览器 API，放弃（服务清单里仍有 40+ 替代）。
- Google Drive 云备份的 `chrome.identity` OAuth：改标准 Web OAuth 流程即可保留；WebDAV 备份可直接保留。

### 4.3 两种可行的 Web 版产品形态

**形态 A：翻译工作台（改造小，1:1 复用）**
现成雏形 = 文档翻译 + 翻译中心 + 设置中心。功能：上传/粘贴文档与文本 → 多服务翻译 → 双语阅读/导出 → 单词本/术语库/统计。全部落在"第一级 + 第二级"改造内。

**形态 B：整页翻译服务（类 Google Translate 网页版，改造大）**
用户输入 URL → 服务端抓取 HTML → 代理域名重渲染 → 前端复用全文翻译引擎（候选发现/双语渲染/样式这套核心资产在 Web 上完全可用，因为它操作的是 DOM，不关心 DOM 来自注入还是自有页面）→ 图片 OCR、本地模型照常在浏览器跑。

## 五、建议的实施顺序（MVP → 完整）

1. **MVP**：服务端翻译代理（复用 provider 适配层）+ 文档翻译工作台 + 文本/多服务对比翻译 + 服务与密钥管理。
2. **二期**：单词本/学习中心（账号化）、术语库与个人校订、翻译统计、分享卡片、Edge TTS 朗读。
3. **三期**：本地模型（Worker + WASM）、图片 OCR、URL 整页翻译（形态 B）、字幕文件（SRT/ASS）翻译导出。

## 六、关键决策点（接入自有服务前需明确）

1. 业务形态选 A（工作台）还是 B（整页翻译）——决定是否要做服务端页面抓取与重渲染。
2. 翻译密钥归属：用户各自填 key（代理仅转发）还是平台统一 key 计费——决定账号与计费设计。
3. 免费池线路（依赖网页端非公开接口 + 请求头改写）是否在 Web 版保留——保留则全部流量必须走服务端代理。
