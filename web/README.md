# FluentRead Web 真站（全功能真实版）

网页版：四个页面全部真实可用，页面发出的请求由本地 Node 服务转发到免费翻译上游
（复用 `src/providers/translation/` 的供应商适配层，与扩展、userscript 同一套协议代码），
AI 能力经本地服务转发到任意 OpenAI 兼容端点。没有任何演示假数据。

## 页面与真实能力

- `index.html` 文本·写作（首页）
  - 翻译：微软 / 腾讯交互翻译 / 阿里 / MyMemory / Google 免费上游 + 已配置的 AI 服务；失败自动换线（按偏好顺序）
  - 输入框行末 `///` 即用当前服务直译；Ctrl+Enter 翻译、Ctrl+Shift+S 交换语言、Alt+R 朗读/停止
  - 译文朗读（浏览器 Web Speech API，语速/音色来自偏好设置）与复制
  - AI 词典：结合原文上下文查词，输出音标、义项、例句（需配置 AI 服务）
  - AI 写作：按语言/长度/语气/模板起草草稿（需配置 AI 服务）
  - 多服务并发对比：真实请求勾选的免费服务，比较译文与耗时，可一键采用
  - 最近翻译历史：仅存本机 localStorage，点击行恢复
- `media.html` 图片·字幕
  - 图片翻译：浏览器本地 OCR（Tesseract.js WASM，按需从 jsDelivr CDN 加载引擎与语言包），
    图片不出本机，识别行批量真实翻译；支持拖拽/粘贴
  - 字幕翻译：SRT / VTT 解析，按批次（每批 8 条）真实翻译，行数不一致自动逐条重试，
    译文可编辑，导出译文/双语 SRT
  - 圈选截图：`getDisplayMedia` 共享屏幕后框选区域，本地 OCR + 翻译，画面不上传
- `services.html` 翻译服务
  - 免费服务逐个真实连通性测试（真实延迟/失败原因）、设默认、调整换线优先级、失败自动换线开关
  - AI 服务（OpenAI 兼容）：DeepSeek / 智谱 GLM / Kimi / 硅基流动 / OpenRouter / Ollama（本机）预设，
    API Key 仅存本机 localStorage，真实连接测试与模型列表拉取
  - 自定义 OpenAI 兼容服务：添加/测试/删除，出现在文本页服务下拉中
- `settings.html` 偏好设置（修改即保存）
  - 默认语言对/服务、失败换线、自动朗读、历史条数、主题（浅/深/跟随系统）、朗读语速与系统音色
  - AI 提示词偏好（词典风格/写作语气/学习偏好）
  - 数据：历史清空、全部数据导出/导入（JSON，含密钥需妥善保管）、清除全部站点数据
  - 自助诊断：本地服务、免费服务连通性、AI 服务、朗读、屏幕捕获、OCR CDN、存储用量的真实检测

## 运行

```bash
pnpm web:build   # vite SSR 打包 web/server.ts → web/dist/server.js
pnpm web:start   # 启动 http://127.0.0.1:8787
```

端口可用环境变量 `FR_WEB_PORT` 覆盖。

## 边界与说明

- API 密钥只保存在本机浏览器 localStorage，随请求经本地转发服务使用，不写入磁盘与日志。
- 免费线路为非官方公开接口，稳定性不保证；谷歌线路在无法访问 Google 的网络会超时失败，
  界面如实显示失败原因；开启失败换线后自动跳过。
- 图片 OCR 首次使用需能访问 cdn.jsdelivr.net（下载引擎与语言包）；OCR CDN 不可达时字幕翻译不受影响。
- `pnpm compile` 需较大 Node 堆（如 `NODE_OPTIONS=--max-old-space-size=8192`）完成全仓类型检查。
- 产物 `web/dist/` 为构建输出，已加入 `.gitignore`。
