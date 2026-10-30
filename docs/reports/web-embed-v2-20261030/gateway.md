# 模型网关设计（LiteLLM）

> 目的：**加一家模型 = 改配置，不改代码。** 支持国内、海外、本地、以及任意 OpenAI 兼容端点。

---

## 一、为什么必须有网关

| 理由 | 说明 |
| --- | --- |
| 不用写适配器 | 扩展里 40 家 provider 是历史包袱，网站版不该重来一遍 |
| 一个端点接住所有模型 | 业务代码只认 `baseURL + model`，换模型零改动 |
| 预算与用量现成 | 虚拟 key、每日预算、花费统计、自带 UI，不用自己写 |
| 失败自动重试与降级 | 一个模型挂了自动换下一个，不用在业务层写 fallback |

---

## 二、拓扑

```
浏览器（写作台 / SDK）
        │  只有我们的站点地址，拿不到任何 key
        ▼
  web 服务（Node）
        │  持有一个网关 key
        ▼
  LiteLLM 网关  ──►  DeepSeek / 通义 / 智谱 / Kimi
        │        ──►  OpenAI / Claude / Gemini
        │        ──►  Ollama（本地）
        │        ──►  任意 OpenAI 兼容端点（自定义）
        ▼
     数据库（预算、用量、虚拟 key）
```

---

## 三、模型清单配置

```yaml
model_list:
  # ---------- 国内 ----------
  - model_name: deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY

  - model_name: qwen-plus
    litellm_params:
      model: dashscope/qwen-plus
      api_key: os.environ/DASHSCOPE_API_KEY

  - model_name: glm-4
    litellm_params:
      model: openai/glm-4
      api_base: https://open.bigmodel.cn/api/paas/v4
      api_key: os.environ/ZHIPU_API_KEY

  # ---------- 海外 ----------
  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY

  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-5
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: gemini-flash
    litellm_params:
      model: gemini/gemini-2.5-flash
      api_key: os.environ/GEMINI_API_KEY

  # ---------- 本地 ----------
  - model_name: local-qwen
    litellm_params:
      model: ollama/qwen2.5:7b
      api_base: http://ollama:11434

  # ---------- 自定义（万能入口）----------
  - model_name: my-custom
    litellm_params:
      model: openai/任意模型名
      api_base: os.environ/CUSTOM_BASE
      api_key: os.environ/CUSTOM_KEY

router_settings:
  fallbacks:
    - deepseek-chat: [qwen-plus, gpt-4o-mini]
  num_retries: 2
  timeout: 60

litellm_settings:
  drop_params: true          # 不同模型不认的参数自动丢掉，避免报错

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL
```

**规则**：网关原生支持的模型写 `provider/model`；不支持的用 `openai/模型名 + api_base`。
后者是万能入口——任何 OpenAI 兼容端点都能这么接，包括你自己搭的。

---

## 四、三层模型怎么落到网关

| 层 | 配置在哪 | 请求怎么走 | 访客看到 |
| --- | --- | --- | --- |
| **L1 站点默认** | 我们的 `.env`：`FR_DEFAULT_MODEL` | 网关，用站点 key | 什么都不用选 |
| **L2 可选池** | `models.json` 里标 `enabled: true` 的模型 | 网关，用站点 key | 顶部下拉，显示质量/速度/成本三档 |
| **L3 访客自带** | 访客在设置页填 | **经我们的 `/api/ai` 转发**（带访客 key） | 默认折叠 |

`models.json` 只描述"怎么展示"，不管调用：

```json
[
  { "id": "deepseek-chat", "label": "DeepSeek",   "quality": "高", "speed": "快", "cost": "低", "enabled": true },
  { "id": "qwen-plus",     "label": "通义千问",   "quality": "中", "speed": "快", "cost": "低", "enabled": true },
  { "id": "gpt-4o-mini",   "label": "GPT-4o mini","quality": "高", "speed": "快", "cost": "中", "enabled": false },
  { "id": "claude-sonnet", "label": "Claude",     "quality": "高", "speed": "中", "cost": "高", "enabled": false }
]
```

`enabled` 就是"站长开不开放给访客"的开关，改完刷新即生效。

---

## 五、L3 的一个必须修正的细节

早前设计说"访客自带模型直连、不经我们服务端"。**这条在浏览器里行不通**——
浏览器直连第三方 API 会被 CORS 拦掉（扩展能绕过是因为它有后台权限，网站没有）。

所以 L3 也必须经我们的 `/api/ai` 转发。相应地：

- 访客的 key 会短暂经过我们的服务端 → 必须**不落盘、不写日志、不缓存**，响应头加 `cache-control: no-store`。
- "不占站点额度"这条仍然成立，因为用的是访客自己的 key。
- 设置页要如实写一句："你的密钥会经本站转发到你所填的服务，本站不保存。"

---

## 六、加一个新模型要做什么

1. 在 `litellm` 的 `model_list` 加一条（或在 LiteLLM 后台 UI 里点）。
2. 在 `models.json` 加一条展示信息，`enabled` 决定是否对访客开放。
3. 重启网关（或在 UI 里热加载）。

**不改一行业务代码。** 这就是留网关的全部意义。

---

## 七、运维要点

| 事项 | 做法 |
| --- | --- |
| 预算封顶 | 网关里给站点 key 设每日预算，超了直接拒，不会悄悄烧钱 |
| 失败降级 | `fallbacks` 配好链，一个模型挂了自动换 |
| 参数兼容 | `drop_params: true`，否则换个模型就报"不支持某参数" |
| 健康检查 | 定时打 `/health`，挂了告警 |
| 数据库 | 本地 SQLite 够用；生产建议 Postgres，避免并发写锁 |
| 日志 | 网关日志会含提示词，**别把访客原文落进网关日志**，或定期清理 |
