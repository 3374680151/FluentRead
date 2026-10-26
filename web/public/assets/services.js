/**
 * @file web/public/assets/services.js
 *
 * 文件职责：翻译服务页（services.html）的页面逻辑——免费服务的真实连通性测试、
 * 默认服务与换线优先级维护、OpenAI 兼容 AI 服务的配置（预设/密钥/模型列表拉取/
 * 真实连接测试）、自定义服务的新增与删除。所有配置保存到 localStorage 偏好，
 * 密钥不经过任何持久化后端。
 * 模块边界：只操作本页 DOM；共享能力（偏好、请求封装、toast）来自 app.js。
 */
(function () {
  "use strict";

  var els = {
    apiBadge: document.getElementById("api-badge"),
    autoFallback: document.getElementById("auto-fallback"),
    freeRows: document.getElementById("free-rows"),
    aiState: document.getElementById("ai-state"),
    aiPresets: document.getElementById("ai-presets"),
    aiUrl: document.getElementById("ai-url"),
    aiKey: document.getElementById("ai-key"),
    aiKeyToggle: document.getElementById("ai-key-toggle"),
    aiModel: document.getElementById("ai-model"),
    aiModelList: document.getElementById("ai-model-list"),
    aiName: document.getElementById("ai-name"),
    aiSave: document.getElementById("ai-save"),
    aiTest: document.getElementById("ai-test"),
    aiTestResult: document.getElementById("ai-test-result"),
    aiFetchModels: document.getElementById("ai-fetch-models"),
    customList: document.getElementById("custom-list"),
    cusAdd: document.getElementById("cus-add"),
    cusName: document.getElementById("cus-name"),
    cusUrl: document.getElementById("cus-url"),
    cusKey: document.getElementById("cus-key"),
    cusModel: document.getElementById("cus-model"),
  };
  var prefs = window.frGetPrefs();
  var TEST_TEXT = "Hello, world! This is a connection test.";

  var PRESETS = {
    deepseek: { name: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    zhipu: { name: "智谱 GLM", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
    moonshot: { name: "Kimi（Moonshot）", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
    siliconflow: { name: "硅基流动", baseURL: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
    openrouter: { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
    ollama: { name: "Ollama（本机）", baseURL: "http://localhost:11434/v1", model: "" },
  };

  window.frCatalog().then(function (catalog) {
    els.apiBadge.textContent = "本地服务在线 · " + (catalog.services || []).length + " 个免费服务";
    els.apiBadge.className = "badge badge-ok";
    renderFreeRows(catalog);
  }).catch(function () {
    els.apiBadge.textContent = "本地服务离线";
    els.apiBadge.className = "badge badge-danger";
    els.freeRows.innerHTML = '<tr><td colspan="5" class="small" style="color:var(--danger)">本地服务未启动，请先运行 pnpm web:start</td></tr>';
  });
  els.autoFallback.checked = !!prefs.autoFallback;
  fillAiForm();
  renderCustomList();

  document.addEventListener("frprefs", function () {
    prefs = window.frGetPrefs();
    els.autoFallback.checked = !!prefs.autoFallback;
    fillAiForm();
    renderCustomList();
  });

  /* ==================== 免费服务 ==================== */
  var testState = {}; // serviceId -> {ok, ms, error}

  function renderFreeRows(catalog) {
    var services = (catalog.services || []).slice();
    // 目录里出现而偏好顺序中没有的服务，追加到末尾
    services.forEach(function (s) {
      if ((prefs.serviceOrder || []).indexOf(s.id) < 0) prefs.serviceOrder.push(s.id);
    });
    window.frSetPrefs({ serviceOrder: prefs.serviceOrder.slice() });
    els.freeRows.innerHTML = prefs.serviceOrder.map(function (id) {
      var meta = services.filter(function (s) { return s.id === id; })[0] || { id: id, label: window.frFreeServiceLabel(id) };
      var state = testState[id];
      var statusCell = !state
        ? '<span class="dot dot-muted" aria-hidden="true"></span> <span class="tiny">未测试</span>'
        : state.ok
          ? '<span class="dot dot-ok" aria-hidden="true"></span> <span class="tiny">正常 <b class="mono">' + state.ms + "ms</b></span>"
          : '<span class="dot dot-danger" aria-hidden="true"></span> <span class="tiny" style="color:var(--danger)" title="' + window.frEscape(state.error) + '">失败</span>';
      var isDefault = prefs.defaultService === id;
      var order = prefs.serviceOrder.indexOf(id);
      return "<tr>" +
        '<td class="small">' + window.frEscape(meta.label || meta.id) + "</td>" +
        "<td>" + statusCell + "</td>" +
        '<td><input type="radio" name="default-service" data-svc="' + id + '"' + (isDefault ? " checked" : "") + ' aria-label="设为默认服务"></td>' +
        '<td class="small"><button class="icon-btn" data-move="up" data-svc="' + id + '"' + (order === 0 ? " disabled" : "") + ' aria-label="上移">↑</button>' +
        '<button class="icon-btn" data-move="down" data-svc="' + id + '"' + (order === prefs.serviceOrder.length - 1 ? " disabled" : "") + ' aria-label="下移">↓</button></td>' +
        '<td><button class="btn btn-soft btn-sm" data-test="' + id + '">测试</button></td>' +
        "</tr>";
    }).join("");
  }

  els.freeRows.addEventListener("click", function (e) {
    var testBtn = e.target.closest("[data-test]");
    if (testBtn) {
      var id = testBtn.dataset.test;
      testBtn.disabled = true;
      testBtn.textContent = "测试中";
      window.frTranslateOnce(TEST_TEXT, "auto", "zh-Hans", id)
        .then(function (r) {
          testState[id] = r.ok ? { ok: true, ms: r.ms } : { ok: false, error: r.error || "未知错误" };
          if (r.ok) window.frToast(window.frFreeServiceLabel(id) + " 正常 · " + r.ms + "ms");
          else window.frToast(window.frFreeServiceLabel(id) + " 失败：" + r.error, true);
        })
        .catch(function (error) {
          testState[id] = { ok: false, error: error.message };
          window.frToast(window.frFreeServiceLabel(id) + " 失败：" + error.message, true);
        })
        .finally(function () {
          window.frCatalog().then(renderFreeRows);
        });
      return;
    }
    var moveBtn = e.target.closest("[data-move]");
    if (moveBtn && !moveBtn.disabled) {
      var svcId = moveBtn.dataset.svc;
      var from = prefs.serviceOrder.indexOf(svcId);
      var to = moveBtn.dataset.move === "up" ? from - 1 : from + 1;
      if (to < 0 || to >= prefs.serviceOrder.length) return;
      var order = prefs.serviceOrder.slice();
      order.splice(from, 1);
      order.splice(to, 0, svcId);
      window.frSetPrefs({ serviceOrder: order });
      window.frCatalog().then(renderFreeRows);
    }
  });
  els.freeRows.addEventListener("change", function (e) {
    var radio = e.target.closest('input[name="default-service"]');
    if (!radio) return;
    window.frSetPrefs({ defaultService: radio.dataset.svc });
    window.frToast("默认服务已设为 " + window.frFreeServiceLabel(radio.dataset.svc));
  });
  els.autoFallback.addEventListener("change", function () {
    window.frSetPrefs({ autoFallback: els.autoFallback.checked });
    window.frToast(els.autoFallback.checked ? "失败自动换线已开启" : "失败自动换线已关闭");
  });

  /* ==================== AI 服务 ==================== */
  function fillAiForm() {
    var ai = prefs.ai;
    els.aiUrl.value = ai && ai.baseURL || "";
    els.aiKey.value = ai && ai.apiKey || "";
    els.aiModel.value = ai && ai.model || "";
    els.aiName.value = ai && ai.name || "";
    if (window.frAiConfigured()) {
      els.aiState.textContent = "已配置 · " + (ai.name || ai.model);
      els.aiState.className = "badge badge-ok";
    } else {
      els.aiState.textContent = "未配置";
      els.aiState.className = "badge";
    }
  }

  els.aiPresets.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-preset]");
    if (!chip) return;
    els.aiPresets.querySelectorAll(".chip").forEach(function (c) {
      c.setAttribute("aria-pressed", c === chip ? "true" : "false");
    });
    var preset = PRESETS[chip.dataset.preset];
    if (!preset) return;
    els.aiUrl.value = preset.baseURL;
    els.aiModel.value = preset.model;
    if (!els.aiName.value) els.aiName.value = preset.name;
  });

  els.aiKeyToggle.addEventListener("click", function () {
    els.aiKey.type = els.aiKey.type === "password" ? "text" : "password";
  });

  els.aiSave.addEventListener("click", function () {
    var baseURL = els.aiUrl.value.trim().replace(/\/+$/, "");
    var model = els.aiModel.value.trim();
    if (!/^https?:\/\//.test(baseURL)) { window.frToast("Base URL 必须以 http:// 或 https:// 开头", true); return; }
    if (!model) { window.frToast("请填写模型名", true); return; }
    window.frSetPrefs({
      ai: {
        name: els.aiName.value.trim() || model,
        baseURL: baseURL,
        apiKey: els.aiKey.value.trim(),
        model: model,
      },
    });
    window.frToast("AI 服务配置已保存（仅本机浏览器）");
  });

  function showTestResult(ok, message) {
    els.aiTestResult.style.display = "";
    els.aiTestResult.textContent = message;
    els.aiTestResult.className = ok ? "badge badge-ok" : "badge badge-danger";
  }

  els.aiTest.addEventListener("click", function () {
    var baseURL = els.aiUrl.value.trim().replace(/\/+$/, "");
    var model = els.aiModel.value.trim();
    if (!/^https?:\/\//.test(baseURL) || !model) {
      showTestResult(false, "请先填写 Base URL 与模型");
      return;
    }
    var spinner = window.frButtonBusy(els.aiTest, true);
    showTestResult(true, "测试中…");
    // 用表单当前值测试（尚未保存也能测），保存后才持久化
    fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseURL: baseURL, apiKey: els.aiKey.value.trim(), model: model,
        messages: [{ role: "user", content: "只回复两个字：正常" }],
        maxTokens: 8,
      }),
    }).then(function (r) { return r.json(); }).then(function (result) {
      if (result.ok) showTestResult(true, "连接正常 · " + result.ms + "ms");
      else showTestResult(false, "失败：" + (result.error || "未知错误"));
    }).catch(function (error) {
      showTestResult(false, "失败：" + error.message);
    }).finally(function () {
      window.frButtonBusy(els.aiTest, false);
    });
  });

  els.aiFetchModels.addEventListener("click", function () {
    var baseURL = els.aiUrl.value.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(baseURL)) { window.frToast("请先填写正确的 Base URL", true); return; }
    var spinner = window.frButtonBusy(els.aiFetchModels, true);
    window.frAiModels(baseURL, els.aiKey.value.trim()).then(function (result) {
      if (!result.ok) { window.frToast("拉取失败：" + (result.error || "未知错误"), true); return; }
      els.aiModelList.innerHTML = (result.models || []).map(function (m) {
        return '<option value="' + window.frEscape(m) + '"></option>';
      }).join("");
      window.frToast("找到 " + (result.models || []).length + " 个模型，输入框可下拉选择");
    }).catch(function (error) {
      window.frToast("拉取失败：" + error.message, true);
    }).finally(function () {
      window.frButtonBusy(els.aiFetchModels, false);
    });
  });

  /* ==================== 自定义服务 ==================== */
  function renderCustomList() {
    var list = prefs.customServices || [];
    if (!list.length) {
      els.customList.innerHTML = '<p class="tiny muted" style="margin:0">还没有自定义服务。点击右上角「添加自定义服务」。</p>';
      return;
    }
    els.customList.innerHTML = list.map(function (svc) {
      return '<div class="row" style="justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:10px 14px">' +
        '<div><b class="small">' + window.frEscape(svc.name) + "</b>" +
        '<div class="tiny muted mono">' + window.frEscape(svc.baseURL) + " · " + window.frEscape(svc.model) + "</div></div>" +
        '<div class="row" style="gap:8px">' +
        '<button class="btn btn-soft btn-sm" data-cus-test="' + svc.id + '">测试</button>' +
        '<button class="btn btn-danger btn-sm" data-cus-del="' + svc.id + '">删除</button>' +
        "</div></div>";
    }).join("");
  }

  els.customList.addEventListener("click", function (e) {
    var delBtn = e.target.closest("[data-cus-del]");
    if (delBtn) {
      var id = delBtn.dataset.cusDel;
      var target = (prefs.customServices || []).filter(function (s) { return s.id === id; })[0];
      if (!target || !window.confirm("删除自定义服务「" + target.name + "」？")) return;
      window.frSetPrefs({ customServices: prefs.customServices.filter(function (s) { return s.id !== id; }) });
      window.frToast("已删除");
      return;
    }
    var testBtn = e.target.closest("[data-cus-test]");
    if (testBtn) {
      var svc = (prefs.customServices || []).filter(function (s) { return s.id === testBtn.dataset.cusTest; })[0];
      if (!svc) return;
      testBtn.disabled = true;
      testBtn.textContent = "测试中";
      window.frAiChat([{ role: "user", content: "只回复两个字：正常" }], { serviceId: "custom:" + svc.id, maxTokens: 8 })
        .then(function (result) {
          window.frToast(result.ok ? svc.name + " 正常 · " + result.ms + "ms" : svc.name + " 失败：" + result.error, !result.ok);
        })
        .finally(function () {
          testBtn.disabled = false;
          testBtn.textContent = "测试";
        });
    }
  });

  els.cusAdd.addEventListener("click", function () {
    var name = els.cusName.value.trim();
    var baseURL = els.cusUrl.value.trim().replace(/\/+$/, "");
    var model = els.cusModel.value.trim();
    if (!name) { window.frToast("请填写显示名称", true); return; }
    if (!/^https?:\/\//.test(baseURL)) { window.frToast("Base URL 必须以 http:// 或 https:// 开头", true); return; }
    if (!model) { window.frToast("请填写模型名", true); return; }
    var list = (prefs.customServices || []).slice();
    list.push({ id: "c" + Date.now(), name: name, baseURL: baseURL, apiKey: els.cusKey.value.trim(), model: model });
    window.frSetPrefs({ customServices: list });
    els.cusName.value = ""; els.cusUrl.value = ""; els.cusKey.value = ""; els.cusModel.value = "";
    var dialog = document.getElementById("custom-dialog");
    dialog.classList.remove("open");
    document.querySelectorAll(".scrim.show").forEach(function (s) { s.classList.remove("show"); });
    window.frToast("已添加「" + name + "」，可在文本·写作页选择");
  });
})();
