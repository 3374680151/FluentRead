/**
 * @file web/public/fluentread-sdk.js
 *
 * 文件职责：FluentRead 嵌入式翻译 SDK——站长在任意网站（尤其是文档站）加一行 <script>，
 * 访客即可免安装获得插件式翻译与生词收集能力：悬浮球快捷翻译（可拖拽、位置记忆、双击复位）、
 * 划词翻译气泡（单词走 ECDICT 词典 /api/word，句子走 /api/translate 五线路换线）、
 * 朗读、一键收藏生词（懒加载 SDK 源下的词书领域层，与本站学习中心同库互通，
 * 失败降级为宿主站 localStorage 暂存并如实提示）。
 * 模块边界：零依赖、自包含，不读写宿主页面的全局与样式；UI 渲染在 Shadow DOM（fr-sdk-root）内；
 * 配置经 data-fr-* 属性与 window.FluentReadConfig 注入；组件生命周期与页面一致，无遗留计时器。
 */

(function () {
  "use strict";

  /* ==================== 配置（默认值 ← data-fr-* ← window.FluentReadConfig） ==================== */
  var scriptTag = document.currentScript;
  var defaults = {
    serverUrl: scriptTag && scriptTag.src ? new URL(scriptTag.src).origin : location.origin,
    from: "auto",
    to: "zh-Hans",
    ball: true,
    selection: true,
    capture: true,
    theme: "auto", // auto | light | dark
  };
  if (scriptTag) {
    [].forEach.call(scriptTag.attributes, function (attr) {
      var match = /^data-fr-([a-z]+)$/.exec(attr.name);
      if (!match) return;
      var key = match[1];
      var value = attr.value;
      if (value === "true" || value === "false") value = value === "true";
      defaults[key] = value;
    });
  }
  var config = Object.assign({}, defaults, window.FluentReadConfig || {});
  var SERVER = String(config.serverUrl || "").replace(/\/$/, "");

  /** theme:'auto' 时跟随宿主页面配色（按 body 背景亮度判断），无法判定时回退系统偏好。 */
  function detectHostTheme() {
    try {
      var node = document.body || document.documentElement;
      var background = getComputedStyle(node).backgroundColor;
      var match = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(background);
      if (match) {
        var luminance = 0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3]);
        return luminance < 128 ? "dark" : "light";
      }
    } catch (e) { /* 取不到背景色时走系统偏好 */ }
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  var isDark = config.theme === "dark" ||
    (config.theme !== "light" && detectHostTheme() === "dark");

  /* ==================== Shadow DOM 宿主与样式 ==================== */
  var root = document.createElement("div");
  root.id = "fr-sdk-root";
  var shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>" +
    ":host{all:initial;font-family:-apple-system,'SF Pro Text','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;font-size:14px;line-height:1.6;color:" + (isDark ? "#E8EAED" : "#1F2328") + "}" +
    "*{box-sizing:border-box;margin:0}" +
    ".frsdk-fab{position:fixed;right:24px;bottom:24px;z-index:2147483000;width:46px;height:46px;border-radius:50%;border:none;cursor:pointer;display:grid;place-items:center;color:#fff;background:#0B7C72;box-shadow:0 6px 18px rgba(2,10,9,.28);transition:background-color .16s}" +
    ".frsdk-fab:hover{background:#22A196}" +
    ".frsdk-fab:active{cursor:grabbing}" +
    ".frsdk-panel{position:fixed;right:24px;bottom:82px;z-index:2147483000;width:288px;padding:14px 16px;border-radius:12px;border:1px solid " + (isDark ? "#30363D" : "#D8DEE4") + ";background:" + (isDark ? "#16191C" : "#FFFFFF") + ";box-shadow:0 12px 32px rgba(2,10,9,.2)}" +
    ".frsdk-panel[hidden]{display:none}" +
    ".frsdk-panel h2{font-size:14px;font-weight:800}" +
    ".frsdk-textarea{width:100%;min-height:60px;resize:vertical;font:inherit;font-size:13.5px;color:inherit;background:transparent;border:1px solid " + (isDark ? "#30363D" : "#C9D1D9") + ";border-radius:8px;padding:7px 10px;margin:10px 0 8px}" +
    ".frsdk-textarea:focus{outline:none;border-color:#0B7C72;box-shadow:0 0 0 3px rgba(11,124,114,.22)}" +
    ".frsdk-btn{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 12px;border-radius:8px;border:none;font:inherit;font-size:13px;font-weight:700;cursor:pointer;background:#0B7C72;color:#fff}" +
    ".frsdk-btn:hover{background:#22A196}" +
    ".frsdk-btn[disabled]{opacity:.55;cursor:not-allowed}" +
    ".frsdk-btn-ghost{background:transparent;color:inherit;border:1px solid " + (isDark ? "#30363D" : "#C9D1D9") + "}" +
    ".frsdk-out{margin-top:10px;font-size:13.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word}" +
    ".frsdk-meta{display:flex;align-items:center;gap:6px;margin-top:8px;color:" + (isDark ? "#8B949E" : "#57606A") + ";font-size:12px}" +
    ".frsdk-icon{display:inline-grid;place-items:center;width:28px;height:28px;border:none;border-radius:7px;background:transparent;color:inherit;cursor:pointer}" +
    ".frsdk-icon:hover{background:" + (isDark ? "#21262D" : "#EEF2F5") + "}" +
    ".frsdk-switch{display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:13px;font-weight:600;cursor:pointer}" +
    ".frsdk-switch input{position:absolute;opacity:0;width:36px;height:20px;cursor:pointer}" +
    ".frsdk-track{width:36px;height:20px;border-radius:999px;background:" + (isDark ? "#30363D" : "#C9D1D9") + ";position:relative;transition:background-color .16s;flex:none}" +
    ".frsdk-track::after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .16s}" +
    ".frsdk-switch input:checked + .frsdk-track{background:#0B7C72}" +
    ".frsdk-switch input:checked + .frsdk-track::after{transform:translateX(16px)}" +
    ".frsdk-links{display:flex;justify-content:space-between;margin-top:12px;font-size:12px}" +
    ".frsdk-links a{color:#22A196;text-decoration:none}" +
    ".frsdk-bubble{position:fixed;z-index:2147483000;width:min(330px,calc(100vw - 20px));max-height:min(420px,calc(100vh - 20px));overflow-y:auto;padding:12px 14px;border-radius:11px;border:1px solid #0B7C72;background:" + (isDark ? "#16191C" : "#FFFFFF") + ";box-shadow:0 10px 30px rgba(2,10,9,.2);font-size:13.5px}" +
    ".frsdk-bubble[hidden]{display:none}" +
    ".frsdk-bubble .src{font-weight:700;font-size:14px;margin-bottom:6px;word-break:break-word}" +
    ".frsdk-bubble .phon{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:" + (isDark ? "#8B949E" : "#57606A") + ";margin-right:6px}" +
    ".frsdk-bubble .pos{color:#B45309;font-weight:700;font-style:italic;font-size:12px;margin-right:6px}" +
    ".frsdk-bubble .sense{margin:3px 0}" +
    ".frsdk-bubble .sense .en{display:block;font-size:12px;color:" + (isDark ? "#8B949E" : "#57606A") + "}" +
    ".frsdk-bubble .badge{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;background:" + (isDark ? "#12312D" : "#E2F3F1") + ";color:#0B7C72;margin-right:5px}" +
    ".frsdk-bubble .badge.warn{background:" + (isDark ? "#332408" : "#FEF3C7") + ";color:#B45309}" +
    ".frsdk-bubble .meta{display:flex;align-items:center;gap:4px;margin-top:9px}" +
    ".frsdk-bubble .meta .tiny{font-size:11.5px;color:" + (isDark ? "#8B949E" : "#57606A") + ";margin-right:auto}" +
    ".frsdk-bubble .err{color:#E5534B}" +
    ".frsdk-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;align-items:center;gap:8px}" +
    ".frsdk-toast div{background:" + (isDark ? "#E8EAED" : "#1F2328") + ";color:" + (isDark ? "#16191C" : "#F0F3F6") + ";border-radius:999px;padding:8px 16px;font-size:12.5px;font-weight:600}" +
    ".frsdk-skeleton{border-radius:6px;height:14px;background:linear-gradient(100deg," + (isDark ? "#21262D" : "#E9EEF2") + " 40%," + (isDark ? "#30363D" : "#F6F8FA") + " 50%," + (isDark ? "#21262D" : "#E9EEF2") + " 60%);background-size:200% 100%;animation:frsdk-shimmer 1.3s infinite linear}" +
    "@keyframes frsdk-shimmer{to{background-position:-200% 0}}" +
    ".frsdk-spin{width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:frsdk-rot .7s linear infinite}" +
    "@keyframes frsdk-rot{to{transform:rotate(360deg)}}" +
    "</style>";
  document.body.appendChild(root);
  var doc = shadow;
  /** ShadowRoot 没有createElement；元素在 document 上创建后挂入 shadow。 */
  function createEl(tag) { return document.createElement(tag); }

  /* ==================== 工具 ==================== */
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(message, isError) {
    var zone = doc.querySelector(".frsdk-toast");
    if (!zone) {
      zone = createEl("div");
      zone.className = "frsdk-toast";
      zone.setAttribute("role", "status");
      shadow.appendChild(zone);
    }
    var item = createEl("div");
    if (isError) item.style.color = "#E5534B";
    item.textContent = message;
    zone.appendChild(item);
    setTimeout(function () { item.remove(); }, 3200);
  }
  function speak(text, lang) {
    if (!("speechSynthesis" in window) || !text) { toast("当前浏览器不支持朗读", true); return; }
    speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "en" || lang === "en-US" ? "en-US" : lang === "ja" ? "ja-JP" : lang === "ko" ? "ko-KR" : lang === "zh-Hans" || lang === "zh-Hant" ? "zh-CN" : "en-US";
    speechSynthesis.speak(utterance);
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  /** 复制统一入口：剪贴板在文档失焦/权限受限时会 reject，必须兜底提示而不是留下未处理 rejection。 */
  function copyText(text, successMessage) {
    if (!navigator.clipboard || !text) { toast("复制失败：剪贴板不可用", true); return; }
    navigator.clipboard.writeText(text).then(function () {
      toast(successMessage || "已复制");
    }).catch(function () {
      toast("复制失败：请重试（页面需保持前台）", true);
    });
  }

  /* ==================== 访客偏好（localStorage 持久化：划词开关 / 目标语言） ==================== */
  function readPref(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* 隐私模式忽略 */ }
  }
  /** 生效目标语言：面板切换后持久化，优先于嵌入配置。 */
  function targetLang() { return readPref("fr-sdk-to", String(config.to || "zh-Hans")); }

  /* ==================== 翻译 API（免费线路依次换线） ==================== */
  var servicesCache = null;
  var languagesCache = null;
  function loadServices() {
    if (servicesCache) return Promise.resolve(servicesCache);
    return fetch(SERVER + "/api/services").then(function (r) { return r.json(); }).then(function (data) {
      servicesCache = (data.services || []).map(function (s) { return s.id; });
      languagesCache = data.languages || {};
      return servicesCache;
    }).catch(function () {
      servicesCache = ["microsoft", "transmart", "alibaba", "mymemory", "google"];
      languagesCache = { "zh-Hans": "简体中文", en: "English", ja: "日本語" };
      return servicesCache;
    });
  }
  function translateOnce(text, from, to, serviceId) {
    return fetch(SERVER + "/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text, from: from, to: to, services: [serviceId] }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) throw new Error(data.error);
      return data.results[0];
    });
  }
  /** 依次尝试全部免费线路，返回首个成功结果；全部失败时如实返回最后一次错误。 */
  function translateSmart(text) {
    var to = targetLang();
    return loadServices().then(function (ids) {
      var chain = ids.length ? ids : ["microsoft"];
      var attempts = [];
      function tryNext(index) {
        if (index >= chain.length) {
          return Promise.resolve({ ok: false, error: attempts.length ? attempts[attempts.length - 1].error : "无可用服务" });
        }
        return translateOnce(text, String(config.from || "auto"), to, chain[index]).then(function (result) {
          attempts.push({ id: chain[index], ok: result.ok, error: result.error });
          if (result.ok) return { ok: true, text: result.text || "", ms: result.ms, service: chain[index] };
          return tryNext(index + 1);
        }).catch(function (error) {
          attempts.push({ id: chain[index], ok: false, error: error.message });
          return tryNext(index + 1);
        });
      }
      return tryNext(0);
    });
  }
  function lookupWord(term) {
    var query = new URLSearchParams({ term: term, from: String(config.from || "auto"), to: targetLang() });
    return fetch(SERVER + "/api/word?" + query.toString())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        return data;
      });
  }

  /* ==================== 生词收藏（词书领域层懒加载，失败降级 localStorage） ==================== */
  var vocabModulePromise = null;
  function loadVocabModule() {
    if (!vocabModulePromise) {
      vocabModulePromise = import(SERVER + "/assets/vendor/fr-vocabulary.js");
    }
    return vocabModulePromise;
  }
  var localWordsKey = "fr-sdk-words";
  function readLocalWords() {
    try { return JSON.parse(localStorage.getItem(localWordsKey) || "[]"); } catch (e) { return []; }
  }
  function writeLocalWords(words) {
    try { localStorage.setItem(localWordsKey, JSON.stringify(words.slice(0, 500))); } catch (e) { /* 隐私模式忽略 */ }
  }
  function localWordKey(term) { return "en\u0000" + String(term || "").trim().toLowerCase(); }

  /**
   * 收藏生词：词形 / 表达 / 整句统一走词书 upsert（含去重合并与语境保留）。
   * 词书模块不可用时降级为宿主站 localStorage 暂存，并明确告知用户数据位置。
   */
  function captureWord(draft) {
    var to = targetLang();
    return loadVocabModule().then(function (mod) {
      return mod.vocabularyBook.upsert({
        sourceLanguage: draft.kind === "sentence" ? (/^[\u4e00-\u9fff]/.test(draft.term) ? "zh-Hans" : "en") : "en",
        targetLanguage: to,
        term: draft.term,
        translation: draft.translation || "",
        kind: draft.kind,
        phonetic: draft.phonetic || "",
        partOfSpeech: draft.pos || "",
        context: {
          text: (draft.contextText || draft.term).slice(0, 500),
          sourceUrl: location.href,
          pageTitle: document.title || "嵌入页面",
          capturedAt: Date.now(),
        },
      });
    }).then(function (entry) {
      return { where: "book", entry: entry };
    }).catch(function (error) {
      var words = readLocalWords();
      words.unshift({ key: localWordKey(draft.term), term: draft.term, translation: draft.translation || "", at: Date.now(), contextText: draft.contextText || "" });
      writeLocalWords(words);
      return { where: "local", error: error };
    });
  }
  function isSaved(term) {
    return loadVocabModule()
      .then(function (mod) { return mod.vocabularyBook.getByTerm("en", term); })
      .then(function (entry) { return Boolean(entry) || readLocalWords().some(function (w) { return w.key === localWordKey(term); }); })
      .catch(function () { return readLocalWords().some(function (w) { return w.key === localWordKey(term); }); });
  }

  /* ==================== 悬浮球 + 快捷翻译面板 ==================== */
  var fab = createEl("button");
  fab.className = "frsdk-fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "流畅阅读翻译：点击打开快捷翻译面板");
  fab.title = "流畅阅读 · 快捷翻译（可拖动，双击复位）";
  fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h10"/><path d="M8 3v2c0 4-2 7-5 9"/><path d="M5.5 9c1 3 3 5 6 6"/><path d="m13 20 4-10 4 10"/><path d="M14.5 16.5h5"/></svg>';
  if (config.ball === false || config.ball === "false") fab.hidden = true;

  var panel = createEl("div");
  panel.className = "frsdk-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "快捷翻译面板");
  var sameOrigin = SERVER === location.origin;
  panel.innerHTML =
    '<h2>快捷翻译</h2>' +
    '<div class="frsdk-langrow"><label class="frsdk-label" for="frsdk-to">目标语言</label>' +
      '<select class="frsdk-select" id="frsdk-to" data-fab-to aria-label="目标语言"></select></div>' +
    '<textarea class="frsdk-textarea" data-fab-src placeholder="输入要翻译的文本…" aria-label="要翻译的文本"></textarea>' +
    '<button class="frsdk-btn" data-fab-go type="button">翻译</button>' +
    '<div class="frsdk-out" data-fab-out>译文将显示在这里。</div>' +
    '<div class="frsdk-meta"><span data-fab-meta></span><span style="flex:1"></span>' +
      '<button class="frsdk-icon" data-fab-copy aria-label="复制译文" title="复制" disabled><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '<button class="frsdk-icon" data-fab-speak aria-label="朗读译文" title="朗读" disabled><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>' +
    "</div>" +
    '<label class="frsdk-switch"><span>划词翻译</span><input type="checkbox" data-fab-sel><span class="frsdk-track" aria-hidden="true"></span></label>' +
    (sameOrigin ? '<div class="frsdk-links"><a href="' + SERVER + '/learn.html" target="_blank" rel="noopener">我的生词本</a><a href="' + SERVER + '/study.html" target="_blank" rel="noopener">学习工作台</a></div>' : "");

  shadow.appendChild(fab);
  shadow.appendChild(panel);

  var fabOut = panel.querySelector("[data-fab-out]");
  var fabMeta = panel.querySelector("[data-fab-meta]");
  var fabResult = "";
  var selectionOn = readPref("fr-sdk-selection", String(config.selection !== false && config.selection !== "false")) === "true";

  function setPanel(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) hideBubble();
  }
  fab.addEventListener("click", function () {
    if (fab.dataset.dragged === "1") return;
    setPanel(panel.hidden);
  });

  try {
    var savedPos = JSON.parse(localStorage.getItem("fr-sdk-fab-pos") || "null");
    if (savedPos && typeof savedPos.x === "number") placeFab(savedPos.x, savedPos.y);
  } catch (e) { /* 位置记忆不可用则用默认位置 */ }
  function placeFab(x, y) {
    fab.style.right = "auto";
    fab.style.bottom = "auto";
    fab.style.left = clamp(x, 8, window.innerWidth - 54) + "px";
    fab.style.top = clamp(y, 8, window.innerHeight - 54) + "px";
  }
  var drag = null;
  fab.addEventListener("pointerdown", function (e) {
    drag = { x: e.clientX, y: e.clientY, l: fab.offsetLeft, t: fab.offsetTop, moved: false };
    fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    placeFab(drag.l + dx, drag.t + dy);
  });
  fab.addEventListener("pointerup", function () {
    if (drag && drag.moved) {
      fab.dataset.dragged = "1";
      setTimeout(function () { fab.dataset.dragged = ""; }, 0);
      try { localStorage.setItem("fr-sdk-fab-pos", JSON.stringify({ x: fab.offsetLeft, y: fab.offsetTop })); } catch (e) { /* 忽略 */ }
    }
    drag = null;
  });
  fab.addEventListener("dblclick", function () {
    fab.style.left = ""; fab.style.top = ""; fab.style.right = ""; fab.style.bottom = "";
    try { localStorage.removeItem("fr-sdk-fab-pos"); } catch (e) { /* 忽略 */ }
    toast("悬浮球已复位");
  });
  fab.addEventListener("keydown", function (e) {
    var step = 16;
    var delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    placeFab(fab.offsetLeft + delta[0], fab.offsetTop + delta[1]);
  });

  var fabGo = panel.querySelector("[data-fab-go]");
  var fabSrc = panel.querySelector("[data-fab-src]");
  fabGo.addEventListener("click", function () {
    var text = fabSrc.value.trim();
    if (!text) { toast("请输入要翻译的文本", true); return; }
    fabGo.disabled = true;
    fabOut.textContent = "翻译中…";
    translateSmart(text).then(function (result) {
      if (result.ok) {
        fabResult = result.text;
        fabOut.textContent = result.text;
        fabMeta.textContent = result.ms + "ms · " + (result.service || "");
        panel.querySelector("[data-fab-copy]").disabled = false;
        panel.querySelector("[data-fab-speak]").disabled = false;
      } else {
        fabResult = "";
        fabOut.textContent = "翻译失败：" + (result.error || "所有线路均不可用");
        fabMeta.textContent = "";
        panel.querySelector("[data-fab-copy]").disabled = true;
        panel.querySelector("[data-fab-speak]").disabled = true;
      }
    }).finally(function () {
      fabGo.disabled = false;
    });
  });
  fabSrc.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fabGo.click(); }
  });
  /* 目标语言下拉：服务目录加载后填充，切换即持久化 */
  loadServices().then(function () {
    var select = panel.querySelector("[data-fab-to]");
    if (!select) return;
    var labels = languagesCache || {};
    var codes = Object.keys(labels).filter(function (code) { return code !== "auto"; });
    if (codes.indexOf(targetLang()) < 0) codes.unshift(targetLang());
    codes.forEach(function (code) {
      var option = createEl("option");
      option.value = code;
      option.textContent = labels[code] || code;
      select.appendChild(option);
    });
    select.value = targetLang();
    select.addEventListener("change", function () {
      writePref("fr-sdk-to", select.value);
      toast("目标语言已切换为 " + (labels[select.value] || select.value));
    });
  });
  panel.querySelector("[data-fab-copy]").addEventListener("click", function () {
    copyText(fabResult, "已复制到剪贴板");
  });
  panel.querySelector("[data-fab-speak]").addEventListener("click", function () {
    if (fabResult) speak(fabResult, targetLang());
  });
  var fabSel = panel.querySelector("[data-fab-sel]");
  fabSel.checked = selectionOn;
  fabSel.addEventListener("change", function () {
    selectionOn = fabSel.checked;
    writePref("fr-sdk-selection", selectionOn);
    if (!selectionOn) hideBubble();
  });

  /* ==================== 划词 / 点词气泡 ==================== */
  var bubble = createEl("div");
  bubble.className = "frsdk-bubble";
  bubble.hidden = true;
  bubble.setAttribute("role", "dialog");
  bubble.setAttribute("aria-label", "流畅阅读翻译");
  shadow.appendChild(bubble);
  var bubbleToken = 0;

  function hideBubble() {
    bubbleToken++;
    bubble.hidden = true;
    bubble.innerHTML = "";
  }
  function placeBubble(anchorRect) {
    bubble.hidden = false;
    bubble.style.left = "0px";
    bubble.style.top = "0px";
    var bw = bubble.offsetWidth;
    var bh = bubble.offsetHeight;
    var x = clamp(anchorRect.left + anchorRect.width / 2 - bw / 2, 8, window.innerWidth - bw - 8);
    var y = anchorRect.bottom + 10;
    if (y + bh > window.innerHeight - 8) y = Math.max(8, anchorRect.top - bh - 10);
    bubble.style.left = x + "px";
    bubble.style.top = y + "px";
  }
  function isEditable(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = node.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
  }
  function isWordLike(text) {
    var t = text.trim();
    if (!t) return false;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(t)) return t.length <= 12 && t.indexOf(" ") < 0;
    return t.length <= 40 && t.split(/\s+/).length <= 3;
  }
  function contextText() {
    try {
      var anchor = window.getSelection().anchorNode;
      var container = anchor && (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement);
      var scope = container && container.closest ? container.closest("p, li, td, th, h1, h2, h3, h4, pre, blockquote, dd, dt") : null;
      return scope ? (scope.textContent || "").trim().slice(0, 240) : "";
    } catch (e) { return ""; }
  }

  function renderSkeleton(text) {
    bubble.innerHTML = '<div class="src">' + escapeHtml(text) + "</div>" +
      '<div class="frsdk-skeleton" style="width:82%"></div><div class="frsdk-skeleton" style="width:64%;margin-top:8px"></div>';
  }

  function saveButtonHtml(saved) {
    return saved
      ? '<button class="frsdk-btn frsdk-btn-ghost" disabled data-save type="button">已收藏 ✓</button>'
      : '<button class="frsdk-btn" data-save type="button">收藏生词</button>';
  }

  function bindSaveButton(draft) {
    var button = bubble.querySelector("[data-save]");
    if (!button) return;
    if (button.disabled) return;
    button.addEventListener("click", function () {
      if (config.capture === false || config.capture === "false") { toast("站长已关闭生词收集"); return; }
      button.disabled = true;
      captureWord(draft).then(function (result) {
        if (result.where === "book") {
          button.textContent = "已收藏 ✓";
          button.classList.add("frsdk-btn-ghost");
          toast("已收藏到生词本" + (sameOrigin ? "，可在学习中心复习" : ""));
        } else {
          button.textContent = "已存本地";
          toast("词书暂不可用，生词已存在本页浏览器（" + (result.error && result.error.message || "未知原因") + "）", true);
        }
      });
    });
  }

  function renderSentence(text, payload, rect) {
    var body = payload.ok
      ? "<div>" + escapeHtml(payload.text) + "</div>"
      : '<div class="err">' + escapeHtml(payload.error || "翻译失败") + "</div>";
    bubble.innerHTML = '<div class="src">' + escapeHtml(text) + "</div>" +
      '<div class="sense">' + body + "</div>" +
      '<div class="meta"><span class="tiny">' + (payload.ok ? payload.ms + "ms · " + (payload.service || "") : "点击重试") + "</span>" +
        '<button class="frsdk-icon" data-retry aria-label="重试" title="重试"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>' +
        '<button class="frsdk-icon" data-copy aria-label="复制" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
        '<button class="frsdk-icon" data-speak aria-label="朗读" title="朗读"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>' +
        '<button class="frsdk-icon" data-close aria-label="关闭" title="关闭"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      "</div>";
    placeBubble(rect);
    bubble.querySelector("[data-copy]").addEventListener("click", function () {
      copyText(payload.ok ? payload.text : "", "已复制");
    });
    bubble.querySelector("[data-speak]").addEventListener("click", function () { speak(payload.ok ? payload.text : text, payload.ok ? targetLang() : "en"); });
    bubble.querySelector("[data-close]").addEventListener("click", hideBubble);
    bubble.querySelector("[data-retry]").addEventListener("click", function () { showFor(lastText, lastRect, lastContext); });
  }

  function renderWord(text, data, rect, saved) {
    var senses = (data.senses || []).map(function (s) {
      return '<div class="sense">' + (s.pos ? '<span class="pos">' + escapeHtml(s.pos) + "</span>" : "") +
        "<span>" + escapeHtml(s.zh || s.en || "") + (s.en && s.zh ? '<span class="en">' + escapeHtml(s.en) + "</span>" : "") + "</span></div>";
    }).join("");
    var body = data.found
      ? (senses || "<div>" + escapeHtml(data.translation || "") + "</div>")
      : '<div>' + escapeHtml(data.translation || "") + '</div><div style="margin-top:6px"><span class="badge warn">词典未收录 · 机器翻译</span></div>';
    bubble.innerHTML =
      '<div class="src">' + escapeHtml(data.term) +
        (data.phonetic ? '<span class="phon">' + escapeHtml(data.phonetic) + "</span>" : "") +
        (data.pos ? '<span class="pos">' + escapeHtml(data.pos) + "</span>" : "") +
        '<button class="frsdk-icon" data-speak-word aria-label="朗读单词" title="朗读" style="float:right"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>' +
      "</div>" + body +
      '<div class="meta">' +
        '<span class="tiny">' + (data.found ? '<span class="badge">ECDICT 词典</span>' : "") + (data.lemma ? '<span class="badge">原形 ' + escapeHtml(data.lemma) + "</span>" : "") + data.ms + "ms</span>" +
        saveButtonHtml(saved) +
        '<button class="frsdk-icon" data-copy aria-label="复制" title="复制"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
        '<button class="frsdk-icon" data-close aria-label="关闭" title="关闭"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      "</div>";
    placeBubble(rect);
    bubble.querySelector("[data-speak-word]").addEventListener("click", function () { speak(data.term, "en"); });
    bubble.querySelector("[data-copy]").addEventListener("click", function () {
      var text2 = data.term + (data.phonetic ? " " + data.phonetic : "") + "\n" +
        (data.senses || []).map(function (s) { return (s.pos ? s.pos + " " : "") + (s.zh || s.en || ""); }).join("\n");
copyText(text2.trim(), "已复制词条");
    });
    bubble.querySelector("[data-close]").addEventListener("click", hideBubble);
    bindSaveButton({
      kind: text.trim().split(/\s+/).length > 1 ? "expression" : undefined,
      term: data.term,
      translation: data.translation || (data.senses || []).map(function (s) { return s.zh || s.en; }).filter(Boolean).join("；"),
      phonetic: data.phonetic || "",
      pos: data.pos || "",
      contextText: lastContext,
    });
  }

  var lastText = "";
  var lastRect = null;
  var lastContext = "";

  function showFor(text, rect, context) {
    lastText = text;
    lastRect = rect;
    lastContext = context;
    var token = ++bubbleToken;
    renderSkeleton(text);
    placeBubble(rect);
    if (isWordLike(text)) {
      lookupWord(text).then(function (data) {
        if (token !== bubbleToken) return;
        var termForSave = data.lemma || text;
        isSaved(termForSave).then(function (saved) {
          if (token !== bubbleToken) return;
          renderWord(text, data, rect, saved);
        });
      }).catch(function (error) {
        if (token !== bubbleToken) return;
        renderSentence(text, { ok: false, error: "词典查询失败：" + error.message }, rect);
      });
    } else {
      translateSmart(text).then(function (result) {
        if (token !== bubbleToken) return;
        renderSentence(text, result, rect);
      });
    }
  }

  document.addEventListener("mouseup", function (e) {
    if (e.target.closest && (e.target.closest("#fr-sdk-root") || e.target.closest("input, textarea, select, [contenteditable]"))) return;
    if (!selectionOn) return;
    setTimeout(function () {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) { hideBubble(); return; }
      var text = String(selection).trim();
      if (!text || text.length > 600) { hideBubble(); return; }
      var range = selection.getRangeAt(0);
      var container = range.commonAncestorContainer;
      if (isEditable(container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)) { hideBubble(); return; }
      var rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { hideBubble(); return; }
      showFor(text.replace(/\s+/g, " ").slice(0, 300), rect, contextText());
    }, 10);
  });
  document.addEventListener("pointerdown", function (e) {
    if (e.target.closest && (e.target.closest("#fr-sdk-root") || shadow.contains(e.target))) return;
    if (!bubble.hidden) hideBubble();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!bubble.hidden) hideBubble();
      if (!panel.hidden) setPanel(false);
    }
  });
})();
