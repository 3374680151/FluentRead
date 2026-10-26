/**
 * @file web/public/assets/app.js
 *
 * 文件职责：FluentRead Web 各页面共享的前端基础能力——深浅主题（浅色/深色/跟随系统）、
 * 用户偏好（localStorage 持久化 + frprefs 变更事件）、免费翻译请求封装（/api/translate，
 * 含失败自动换线）、OpenAI 兼容 AI 请求封装（/api/ai，密钥仅存本机 localStorage）、
 * 译文朗读（浏览器 Web Speech API）、toast 提示、页签、抽屉与对话框、复制到剪贴板。
 * 模块边界：只提供站点级公共能力与请求编排，不含各页面业务；页面逻辑见同目录
 * index.js / media.js / services.js / settings.js。所有数据均来自本地服务真实接口，
 * 不含任何演示假数据。
 */
(function () {
  "use strict";

  /* ==================== 偏好存储 ==================== */
  var PREFS_KEY = "frweb-prefs";
  var DEFAULT_PREFS = {
    theme: "auto",
    srcLang: "auto",
    dstLang: "zh-Hans",
    defaultService: "microsoft",
    serviceOrder: ["microsoft", "transmart", "alibaba", "mymemory", "google"],
    compareServices: ["microsoft", "google"],
    autoFallback: true,
    autoRead: false,
    ttsRate: 1,
    ttsVoice: "",
    historyLimit: 20,
    inlineDirect: true,
    ai: null,
    customServices: [],
    aiExplainStyle: "精讲（词根 + 搭配 + 例句）",
    aiWriteTone: "礼貌正式",
    aiPref: "",
    ocrLang: "eng",
    autoTranslateOcr: true
  };
  var prefs = (function () {
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { stored = {}; }
    var merged = {};
    Object.keys(DEFAULT_PREFS).forEach(function (key) {
      merged[key] = typeof stored[key] === "undefined" ? DEFAULT_PREFS[key] : stored[key];
    });
    if (!merged.ai || typeof merged.ai !== "object") merged.ai = null;
    if (!Array.isArray(merged.customServices)) merged.customServices = [];
    return merged;
  })();

  window.frGetPrefs = function () { return prefs; };

  window.frSetPrefs = function (patch) {
    Object.keys(patch).forEach(function (key) { prefs[key] = patch[key]; });
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* 隐私模式忽略 */ }
    document.dispatchEvent(new CustomEvent("frprefs", { detail: { prefs: prefs } }));
  };

  /* ==================== 主题（浅色/深色/跟随系统） ==================== */
  var root = document.documentElement;
  var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function resolvedTheme() {
    if (prefs.theme === "light" || prefs.theme === "dark") return prefs.theme;
    return darkQuery && darkQuery.matches ? "dark" : "light";
  }
  function applyTheme() {
    root.setAttribute("data-theme", resolvedTheme());
    document.querySelectorAll("[data-theme-btn]").forEach(function (b) {
      b.setAttribute("aria-pressed", resolvedTheme() === "dark" ? "true" : "false");
    });
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener("change", applyTheme);
  // 迁移旧版仅有的 fr-theme 键
  try {
    var legacy = localStorage.getItem("fr-theme");
    if (legacy && (legacy === "light" || legacy === "dark") && prefs.theme === "auto") {
      window.frSetPrefs({ theme: legacy });
    }
    localStorage.removeItem("fr-theme");
  } catch (e) { /* 忽略 */ }
  applyTheme();
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-btn]");
    if (!btn) return;
    window.frSetPrefs({ theme: resolvedTheme() === "dark" ? "light" : "dark" });
  });

  /* ==================== Toast ==================== */
  var toastZone = null;
  window.frToast = function (msg, isError) {
    if (!toastZone) {
      toastZone = document.createElement("div");
      toastZone.className = "toast-zone";
      toastZone.setAttribute("role", "status");
      document.body.appendChild(toastZone);
    }
    var t = document.createElement("div");
    t.className = "toast";
    if (isError) t.style.borderColor = "var(--danger)";
    t.textContent = msg;
    toastZone.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  };

  /* ==================== 页签 ==================== */
  document.querySelectorAll("[data-tabs]").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (!tab) return;
      var tabs = Array.prototype.slice.call(group.querySelectorAll('[role="tab"]'));
      tabs.forEach(function (t2) {
        var sel = t2 === tab;
        t2.setAttribute("aria-selected", sel ? "true" : "false");
        t2.tabIndex = sel ? 0 : -1;
      });
      document.querySelectorAll('[data-tab-panel="' + group.dataset.tabs + '"]').forEach(function (p) {
        p.hidden = p.id !== tab.dataset.panel;
      });
    });
  });

  /* ==================== 抽屉 / 对话框 ==================== */
  function openLayer(el) {
    if (!el) return;
    el.classList.add("open");
    var id = "scrim-" + (el.id || Math.random().toString(36).slice(2));
    var scrim = document.getElementById(id);
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.id = id;
      document.body.appendChild(scrim);
      scrim.addEventListener("click", function () { closeLayer(el); });
    }
    scrim.classList.add("show");
    var first = el.querySelector("input, select, textarea, button:not([data-close])");
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function closeLayer(el) {
    if (!el) return;
    el.classList.remove("open");
    document.querySelectorAll(".scrim.show").forEach(function (s) { s.classList.remove("show"); });
  }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open]");
    if (opener) { openLayer(document.getElementById(opener.dataset.open)); return; }
    var closer = e.target.closest("[data-close]");
    if (closer) closeLayer(closer.closest(".drawer, .dialog"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll(".drawer.open, .dialog.open").forEach(closeLayer);
  });

  /* ==================== 复制 ==================== */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn) return;
    var node = document.getElementById(btn.dataset.copy);
    var value = node ? node.textContent : btn.dataset.copy;
    if (!value) return;
    if (navigator.clipboard) navigator.clipboard.writeText(value.trim());
    window.frToast("已复制到剪贴板");
  });

  /* ==================== 工具 ==================== */
  window.frEscape = function (value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  window.frFillSelect = function (select, entries, value) {
    select.innerHTML = "";
    Object.keys(entries).forEach(function (code) {
      var option = document.createElement("option");
      option.value = code;
      option.textContent = entries[code];
      select.appendChild(option);
    });
    select.value = value;
  };
  window.frButtonBusy = function (button, busy) {
    if (busy) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      var spinner = document.createElement("span");
      spinner.className = "spin";
      button.prepend(spinner);
      return spinner;
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
    var spin = button.querySelector(".spin");
    if (spin) spin.remove();
    return null;
  };

  /* ==================== 服务目录与可选服务 ==================== */
  var catalogPromise = null;
  window.frCatalog = function () {
    if (!catalogPromise) {
      catalogPromise = fetch("/api/services").then(function (r) { return r.json(); });
      catalogPromise.catch(function () { catalogPromise = null; });
    }
    return catalogPromise;
  };

  window.frFreeServiceLabel = function (id) {
    var names = { microsoft: "微软翻译（网页接口）", transmart: "腾讯交互翻译", alibaba: "阿里翻译（网页接口）", mymemory: "MyMemory（官方免费 API）", google: "Google 翻译（网页接口）" };
    return names[id] || id;
  };

  /** 当前可选服务：免费服务（按偏好顺序）+ 已配置的 AI 服务（主 AI 与自定义服务）。 */
  window.frServiceEntries = function () {
    var p = window.frGetPrefs();
    var entries = [];
    (p.serviceOrder || []).forEach(function (id) {
      entries.push({ id: id, label: window.frFreeServiceLabel(id), kind: "free" });
    });
    if (window.frAiConfigured()) entries.push({ id: "ai", label: "AI · " + (p.ai.name || p.ai.model), kind: "ai" });
    (p.customServices || []).forEach(function (svc) {
      entries.push({ id: "custom:" + svc.id, label: svc.name, kind: "ai" });
    });
    return entries;
  };
  window.frFindService = function (id) {
    return window.frServiceEntries().filter(function (s) { return s.id === id; })[0] || null;
  };

  /* ==================== 翻译请求（免费服务，含失败自动换线） ==================== */
  window.frTranslateOnce = function (text, from, to, serviceId) {
    return fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text, from: from, to: to, services: [serviceId] }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) throw new Error(data.error);
      return data.results[0];
    });
  };

  /**
   * 带失败自动换线的翻译：AI 服务直接走 AI 翻译；
   * 免费服务按偏好顺序依次尝试，每次尝试都记录在 attempts 中（含真实失败原因）。
   */
  window.frTranslateSmart = function (text, from, to, serviceId) {
    var p = window.frGetPrefs();
    var chain = [serviceId];
    if (!serviceId || serviceId.indexOf("custom:") !== 0 && serviceId !== "ai") {
      if (p.autoFallback) {
        (p.serviceOrder || []).forEach(function (id) {
          if (chain.indexOf(id) < 0) chain.push(id);
        });
      }
    }
    var attempts = [];
    function tryNext(index) {
      if (index >= chain.length) {
        return Promise.resolve({
          ok: false, text: "", label: "",
          error: attempts.length ? attempts[attempts.length - 1].error : "无可用服务",
          attempts: attempts,
        });
      }
      var id = chain[index];
      var found = window.frFindService(id);
      var attempt = { id: id, label: found ? found.label : id };
      attempts.push(attempt);
      var request = id === "ai" || id.indexOf("custom:") === 0
        ? window.frAiTranslate(text, from, to, id)
        : window.frTranslateOnce(text, from, to, id).then(function (r) {
            return { ok: r.ok, text: r.text || "", error: r.error, ms: r.ms };
          });
      return request.then(function (result) {
        attempt.ok = result.ok;
        attempt.error = result.error;
        attempt.ms = result.ms;
        if (result.ok) return { ok: true, text: result.text, label: attempt.label, ms: result.ms, attempts: attempts };
        return tryNext(index + 1);
      });
    }
    return tryNext(0);
  };

  /* ==================== AI（OpenAI 兼容，经本地服务转发） ==================== */
  window.frAiConfigured = function () {
    var ai = window.frGetPrefs().ai;
    return !!(ai && ai.baseURL && ai.model);
  };

  /** 用指定 AI 服务（"ai" 或 "custom:<id>"）发聊天请求；返回 {ok, text|error, ms}。 */
  window.frAiChat = function (messages, opts) {
    opts = opts || {};
    var p = window.frGetPrefs();
    var endpoint = p.ai;
    if (opts.serviceId && opts.serviceId.indexOf("custom:") === 0) {
      var customId = opts.serviceId.slice(7);
      endpoint = (p.customServices || []).filter(function (s) { return s.id === customId; })[0] || null;
    }
    if (!endpoint || !endpoint.baseURL || !endpoint.model) {
      return Promise.resolve({ ok: false, error: "AI 服务未配置" });
    }
    return fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseURL: endpoint.baseURL,
        apiKey: endpoint.apiKey || "",
        model: endpoint.model,
        messages: messages,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      }),
    }).then(function (r) { return r.json(); });
  };

  window.frAiTranslate = function (text, from, to, serviceId) {
    return window.frCatalog().then(function (catalog) {
      var toLabel = catalog.languages[to] || to;
      var fromHint = from === "auto" ? "自动检测源语言" : "源语言为 " + (catalog.languages[from] || from);
      return window.frAiChat([
        { role: "system", content: "你是专业翻译引擎。把用户内容翻译成" + toLabel + "，" + fromHint + "。只输出译文本身，保留原有换行，不要解释。" },
        { role: "user", content: text },
      ], { serviceId: serviceId, temperature: 0.2 });
    }).then(function (result) {
      if (!result.ok) return result;
      return { ok: true, text: result.text.trim(), ms: result.ms };
    });
  };

  window.frAiModels = function (baseURL, apiKey) {
    return fetch("/api/ai/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseURL: baseURL, apiKey: apiKey || "" }),
    }).then(function (r) { return r.json(); });
  };

  /* ==================== 朗读（浏览器 Web Speech API） ==================== */
  window.frSpeakSupported = function () { return "speechSynthesis" in window; };
  window.frSpeak = function (text, lang) {
    if (!window.frSpeakSupported() || !text) return false;
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang || navigator.language || "zh-CN";
    utter.rate = window.frGetPrefs().ttsRate || 1;
    var voiceName = window.frGetPrefs().ttsVoice;
    if (voiceName) {
      var voice = window.speechSynthesis.getVoices().filter(function (v) { return v.name === voiceName; })[0];
      if (voice) utter.voice = voice;
    }
    window.speechSynthesis.speak(utter);
    return true;
  };
  window.frStopSpeak = function () {
    if (window.frSpeakSupported()) window.speechSynthesis.cancel();
  };
})();
