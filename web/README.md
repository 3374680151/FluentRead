# FluentRead Web 真站（全功能真实版 + 学习工作台）

网页版：页面发出的请求由本地 Node 服务转发到免费翻译上游
（复用 `src/providers/translation/` 的供应商适配层，与扩展、userscript 同一套协议代码），
AI 能力经本地服务转发到任意 OpenAI 兼容端点；学习链路（点词查词 → 收藏 → 复习 → 导入导出）
复用 `src/features/vocabulary` 的词书领域层。没有任何演示假数据。

## 页面与真实能力

- 全站悬浮翻译小组件（`assets/widget.js`，参考扩展右下角悬浮球与划词翻译）
  - 悬浮球：右下角常驻、可拖拽（位置记忆）、双击复位、方向键微调；点按打开快捷面板
    （快速翻译输入框 + 划词翻译开关 + 服务/设置入口）
  - 划词/点词弹窗：页面里选中文字（双击选词同理）自动弹出气泡——单词走 AI 词典
    （音标/义项/例句），句子走真实翻译，附复制/朗读，Esc 或点击空白关闭；偏好设置可关
- `index.html` 文本翻译（首页）
  - 翻译：微软 / 腾讯交互翻译 / 阿里 / MyMemory / Google 免费上游 + 已配置的 AI 服务；失败自动换线（按偏好顺序）
  - 输入框行末 `///` 即用当前服务直译；Ctrl+Enter 翻译、Ctrl+Shift+S 交换语言、Alt+R 朗读/停止
  - 译文朗读（浏览器 Web Speech API，语速/音色来自偏好设置）与复制
  - AI 词典：结合原文上下文查词，输出音标、义项、例句（需配置 AI 服务）
  - 最近翻译历史：仅存本机 localStorage，点击行恢复
  - 学习卡：工作台底部的词书真实统计（收藏总数/待复习/已掌握/今日新学）与学习入口
- `study.html` 学习工作台（语言学习主入口）
  - 多句输入 → 双语对照翻译；点击句中任意单词弹出词卡（`GET /api/word`：ECDICT 本地词典
    优先 + 机器翻译兜底，音标/词性/双语释义/原形还原）；选中多个词查表达，整句可收藏
  - 收藏写入本机词书（Dexie/IndexedDB，复用扩展 `src/features/vocabulary` 仓库与合并语义），
    本次生词托盘一键导出 Anki TSV、直达复习
- `learn.html` 学习中心
  - 单词本：类型/掌握状态/排序/搜索筛选、分页、编辑解释、标记掌握/重新学习、删除带 10 秒撤销
  - 复习：到期队列（到期老词优先 + 每批最多 10 个新词）+ 挖空翻卡 + "忘了（10 分钟）/
    记得（1/3/7/14/30 天）"两键评分，调度算法与扩展完全一致
  - 导入导出 JSON（与浏览器扩展互通）与 Anki TSV；清空词书双重确认
- `services.html` 翻译服务
  - 免费服务逐个真实连通性测试（真实延迟/失败原因）、设默认、调整换线优先级、失败自动换线开关
  - AI 服务（OpenAI 兼容）：DeepSeek / 智谱 GLM / Kimi / 硅基流动 / OpenRouter / Ollama（本机）预设，
    API Key 仅存本机 localStorage，真实连接测试与模型列表拉取
  - 自定义 OpenAI 兼容服务：添加/测试/删除，出现在文本页服务下拉中
- `settings.html` 偏好设置（修改即保存）
  - 默认语言对/服务、失败换线、自动朗读、历史条数、主题（浅/深/跟随系统）、朗读语速与系统音色
  - AI 提示词偏好（词典风格/学习偏好）
  - 数据：历史清空、全部数据导出/导入（JSON，含密钥需妥善保管）、清除全部站点数据
  - 自助诊断：本地服务、免费服务连通性、AI 服务、朗读、存储用量的真实检测

## 运行

```bash
pnpm web:build   # vite SSR 打包 web/server.ts → web/dist/server.js + 客户端词书 bundle → web/public/assets/vendor/
pnpm web:start   # 启动 http://127.0.0.1:8787
```

端口可用环境变量 `FR_WEB_PORT` 覆盖。

## 嵌入到你的网站（免安装翻译能力）

站长在任意页面（如文档站）加一行代码，访客即可获得划词翻译 / 点词词典 / 生词收藏 / 悬浮球快捷翻译，
无需安装浏览器扩展；演示见 [`embed-demo.html`](public/embed-demo.html)。

```html
<script src="https://你的部署地址/fluentread-sdk.js" data-fr-to="zh-Hans"></script>
```

- 配置：`data-fr-*` 属性或 `window.FluentReadConfig`（`serverUrl` / `from` / `to` / `ball` / `selection` / `capture` / `theme`）。
- UI 渲染在 Shadow DOM 内，不污染宿主页面；API 与词书模块已开 CORS，跨域站点可直接调用。
- 生词收藏写入 SDK 服务源绑定的词书库（与本站学习中心同库互通）；词书模块不可用时降级为宿主站
  localStorage 暂存并如实提示。设计方案见
  [docs/reports/web-embed-sdk-design-20261030](../docs/reports/web-embed-sdk-design-20261030/web-embed-sdk-design.md)。

## 数据与词典说明

- 词书数据存浏览器 IndexedDB（Dexie，库 `FluentReadVocabularyBook`，与扩展同 schema）；
  学习中心导出的 JSON / Anki TSV 可直接导入浏览器扩展，反之亦然。
- `GET /api/word` 词典优先读取可选完整词库 `web/.cache/ecdict-full.json`（3.9MB，使用前按扩展
  ecdictAsset.ts 同一 SHA-256 校验；可从扩展"下载扩展词库"的同一 CDN 镜像获取），缺失时回退仓库
  自带 `public/ecdict-core.json`（3000 词精简库），未收录的词自动用免费机器翻译兜底并在词卡上如实标注。
- `web/dist/`、`web/public/assets/vendor/`、`web/.cache/` 为构建/本地缓存产物，已加入 `.gitignore`。

## 边界与说明

- API 密钥只保存在本机浏览器 localStorage，随请求经本地转发服务使用，不写入磁盘与日志。
- 免费线路为非官方公开接口，稳定性不保证；谷歌线路在无法访问 Google 的网络会超时失败，
  界面如实显示失败原因；开启失败换线后自动跳过。
- 视觉基调：中性灰背景 + 白色表面 + 细边框（浅色 #F3F4F6 / 深色 #131518），扁平无渐变，
  品牌青绿只作点缀；主题支持浅色/深色/跟随系统。
- `pnpm compile` 需较大 Node 堆（如 `NODE_OPTIONS=--max-old-space-size=8192`）完成全仓类型检查。
- 学习工作台设计方案见 [docs/reports/web-learning-workbench-design-20261027](../docs/reports/web-learning-workbench-design-20261027/web-learning-workbench-design.md)。
