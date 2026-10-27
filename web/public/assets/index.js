/**
 * @file web/public/assets/index.js
 *
 * 文件职责：文本翻译页（index.html）的页面逻辑——真实调用本地 /api/translate 与 /api/ai：
 * 翻译（失败自动换线）、输入框 /// 直译、译文朗读与复制、AI 词典（结构化查询原文词语）、
 * 最近翻译历史（localStorage）。划词/点词弹窗翻译与悬浮球由共享的 widget.js 提供。
 * 模块边界：只操作本页 DOM；共享能力（偏好、请求封装、主题、toast）来自 app.js。
 */
(function () {
  "use strict";

  var els = {
    apiBadge: document.getElementById("api-badge"),
    srcLang: document.getElementById("src-lang"),
    dstLang: document.getElementById("dst-lang"),
    service: document.getElementById("service"),
    src: document.getElementById("src-input"),
    srcCount: document.getElementById("src-count"),
    out: document.getElementById("out"),
    outService: document.getElementById("out-service"),
    go: document.getElementById("go"),
    clear: document.getElementById("clear"),
    copy: document.getElementById("copy"),
    speak: document.getElementById("speak"),
    swap: document.getElementById("swap"),
    timing: document.getElementById("timing"),
    dictWord: document.getElementById("dict-word"),
    dictGo: document.getElementById("dict-go"),
    dictFromSel: document.getElementById("dict-from-sel"),
    dictResult: document.getElementById("dict-result"),
    dictBadge: document.getElementById("dict-badge"),
    history: document.getElementById("history"),
    hisClear: document.getElementById("his-clear"),
  };
  var prefs = window.frGetPrefs();

  /* ---------- 目录与服务填充 ---------- */
  window.frCatalog().then(function (catalog) {
    window.frFillSelect(els.srcLang, catalog.languages, prefs.srcLang);
    window.frFillSelect(els.dstLang, catalog.languages, prefs.dstLang);
    fillServiceSelect();
    els.apiBadge.textContent = "本地服务在线";
    els.apiBadge.className = "badge badge-ok";
  }).catch(function () {
    els.apiBadge.textContent = "本地服务离线";
    els.apiBadge.className = "badge badge-danger";
    window.frToast("本地服务未启动，请先运行 pnpm web:start", true);
  });
  refreshDictBadge();

  function fillServiceSelect() {
    var current = els.service.value || prefs.defaultService;
    var entries = window.frServiceEntries();
    els.service.innerHTML = entries.map(function (s) {
      return '<option value="' + window.frEscape(s.id) + '">' + window.frEscape(s.label) + "</option>";
    }).join("");
    if (entries.some(function (s) { return s.id === current; })) els.service.value = current;
  }

  function refreshDictBadge() {
    if (window.frAiConfigured()) {
      var ai = prefs.ai || {};
      els.dictBadge.textContent = "AI 词典 · " + (ai.name || ai.model);
      els.dictBadge.className = "badge badge-ok";
    } else {
      els.dictBadge.textContent = "需在翻译服务页配置 AI";
      els.dictBadge.className = "badge";
    }
  }

  document.addEventListener("frprefs", function () {
    prefs = window.frGetPrefs();
    fillServiceSelect();
    refreshDictBadge();
  });

  /* ---------- 翻译 ---------- */
  var lastResult = "";

  function showResult(result, startedAt) {
    if (result.ok) {
      lastResult = result.text;
      els.out.textContent = result.text;
      els.out.classList.remove("muted");
      els.outService.textContent = result.label || "";
      if (prefs.autoRead) window.frSpeak(result.text, els.dstLang.value);
    } else {
      lastResult = "";
      els.out.textContent = "翻译失败：" + (result.error || "未知错误");
      els.out.classList.add("muted");
      els.outService.textContent = "";
    }
    var failed = (result.attempts || []).filter(function (a) { return !a.ok; });
    var fallbackNote = failed.length > 1 || (!result.ok && failed.length)
      ? " · 尝试过 " + failed.map(function (a) { return a.label; }).join(" → ")
      : "";
    els.timing.textContent = result.ok
      ? "耗时 " + result.ms + "ms" + (failed.length ? "（前 " + failed.length + " 个服务失败" + fallbackNote + "）" : "")
      : "全部尝试失败 · " + (Date.now() - startedAt) + "ms";
  }

  function requestTranslate() {
    var text = els.src.value.trim();
    if (!text) { window.frToast("请输入要翻译的文本", true); return; }
    var startedAt = Date.now();
    var spinner = window.frButtonBusy(els.go, true);
    els.out.innerHTML = '<div class="stack">' +
      '<div class="skeleton" style="height:20px;width:92%"></div>' +
      '<div class="skeleton" style="height:20px;width:85%"></div>' +
      '<div class="skeleton" style="height:20px;width:60%"></div></div>';
    window.frTranslateSmart(text, els.srcLang.value, els.dstLang.value, els.service.value)
      .then(function (result) {
        showResult(result, startedAt);
        if (result.ok) saveHistory({ text: text, from: els.srcLang.value, to: els.dstLang.value, result: result });
      })
      .catch(function (error) { window.frToast("请求失败：" + error.message, true); })
      .finally(function () {
        window.frButtonBusy(els.go, false);
        if (spinner) spinner.remove();
      });
  }

  els.go.addEventListener("click", requestTranslate);
  els.src.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); requestTranslate(); }
  });
  els.src.addEventListener("input", function () {
    els.srcCount.textContent = els.src.value.length + " / 5000";
    // 输入框直译：行末输入 /// 即用当前服务翻译并替换输入内容
    if (prefs.inlineDirect && /\/\/\/\s*$/.test(els.src.value)) {
      var text = els.src.value.replace(/\/\/\/\s*$/, "").trim();
      if (!text) { els.src.value = ""; return; }
      window.frTranslateSmart(text, els.srcLang.value, els.dstLang.value, els.service.value)
        .then(function (result) {
          if (result.ok) {
            els.src.value = result.text;
            els.srcCount.textContent = els.src.value.length + " / 5000";
            window.frToast("已直译（" + result.label + "）");
          } else {
            window.frToast("直译失败：" + result.error, true);
          }
        });
    }
  });
  els.clear.addEventListener("click", function () {
    els.src.value = "";
    els.srcCount.textContent = "0 / 5000";
    els.out.textContent = "译文将显示在这里。";
    els.out.classList.add("muted");
    els.outService.textContent = "";
    els.timing.textContent = "";
    lastResult = "";
  });
  els.copy.addEventListener("click", function () {
    if (!lastResult) return;
    if (navigator.clipboard) navigator.clipboard.writeText(lastResult);
    window.frToast("已复制到剪贴板");
  });
  els.speak.addEventListener("click", function () {
    if (!window.frSpeakSupported()) { window.frToast("当前浏览器不支持语音朗读", true); return; }
    if (window.speechSynthesis.speaking) { window.frStopSpeak(); return; }
    if (!lastResult) { window.frToast("还没有可朗读的译文", true); return; }
    window.frSpeak(lastResult, els.dstLang.value);
  });
  els.swap.addEventListener("click", swapLangs);
  els.srcLang.addEventListener("change", function () { window.frSetPrefs({ srcLang: els.srcLang.value }); });
  els.dstLang.addEventListener("change", function () { window.frSetPrefs({ dstLang: els.dstLang.value }); });
  els.service.addEventListener("change", function () { window.frSetPrefs({ defaultService: els.service.value }); });

  function swapLangs() {
    if (els.srcLang.value === "auto") { window.frToast("自动检测语言无法交换", true); return; }
    var from = els.srcLang.value;
    els.srcLang.value = els.dstLang.value;
    els.dstLang.value = from;
    window.frSetPrefs({ srcLang: els.srcLang.value, dstLang: els.dstLang.value });
  }

  /* ---------- AI 词典 ---------- */
  function renderDictGuidance() {
    els.dictResult.innerHTML = '<div class="callout"><span>词典由 AI 服务提供。请先到 <a href="services.html">翻译服务</a> 页配置任意 OpenAI 兼容服务（DeepSeek、智谱 GLM、OpenAI 等）。</span></div>';
  }

  function lookupDict(word) {
    if (!word.trim()) { window.frToast("请输入要查询的词", true); return; }
    if (!window.frAiConfigured()) { renderDictGuidance(); return; }
    var context = els.src.value.trim().slice(0, 240);
    var spinner = window.frButtonBusy(els.dictGo, true);
    els.dictResult.innerHTML = '<div class="skeleton" style="height:18px;width:60%"></div>';
    window.frDictLookup(word, context).then(function (result) {
      if (!result.ok && result.raw) {
        els.dictResult.innerHTML = '<div class="callout"><span>AI 返回的不是预期的 JSON 结构：</span></div><p class="small" style="white-space:pre-wrap">' + window.frEscape(result.raw) + "</p>";
        return;
      }
      if (!result.ok) {
        els.dictResult.innerHTML = '<div class="callout"><span>查询失败：' + window.frEscape(result.error || "未知错误") + "</span></div>";
        return;
      }
      els.dictResult.innerHTML = window.frDictCardHtml(result.entry, result.ms);
      var speakBtn = els.dictResult.querySelector("[data-dict-speak]");
      if (speakBtn) speakBtn.addEventListener("click", function () {
        window.frSpeak(result.entry.word || word, "en-US");
      });
    }).finally(function () {
      window.frButtonBusy(els.dictGo, false);
    });
  }

  els.dictGo.addEventListener("click", function () { lookupDict(els.dictWord.value.trim()); });
  els.dictWord.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); lookupDict(els.dictWord.value.trim()); }
  });
  els.dictFromSel.addEventListener("click", function () {
    var selected = els.src.value.slice(els.src.selectionStart || 0, els.src.selectionEnd || 0).trim();
    if (!selected) { window.frToast("请先在原文中选中一个词", true); return; }
    els.dictWord.value = selected;
    lookupDict(selected);
  });

  /* ---------- 历史 ---------- */
  var HISTORY_KEY = "frweb-history";
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") || []; } catch (e) { return []; }
  }
  function saveHistory(entry) {
    var list = loadHistory();
    list.unshift({
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      from: entry.from, to: entry.to,
      text: entry.text.length > 60 ? entry.text.slice(0, 60) + "…" : entry.text,
      fullText: entry.text,
      out: entry.result.text, service: entry.result.label, ms: entry.result.ms,
    });
    list = list.slice(0, prefs.historyLimit || 20);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
    renderHistory();
  }
  function renderHistory() {
    var list = loadHistory();
    if (!list.length) {
      els.history.innerHTML = '<tr><td colspan="5" class="tiny">暂无记录</td></tr>';
      return;
    }
    els.history.innerHTML = list.map(function (item) {
      return "<tr>" +
        '<td class="small mono">' + window.frEscape(item.time) + "</td>" +
        '<td class="small">' + window.frEscape(item.from) + " → " + window.frEscape(item.to) + "</td>" +
        '<td class="small" style="max-width:420px"><div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + window.frEscape(item.text) + "</div>" +
        '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>' + window.frEscape(item.out) + "</b></div></td>" +
        '<td class="small">' + window.frEscape(item.service || "—") + "</td>" +
        '<td class="small mono">' + (item.ms ? item.ms + "ms" : "—") + "</td></tr>";
    }).join("");
    Array.prototype.slice.call(els.history.querySelectorAll("tr")).forEach(function (row, index) {
      if (!list[index]) return;
      row.style.cursor = "pointer";
      row.addEventListener("click", function () {
        var item = list[index];
        els.src.value = item.fullText;
        els.srcCount.textContent = item.fullText.length + " / 5000";
        lastResult = item.out;
        els.out.textContent = item.out;
        els.out.classList.remove("muted");
        els.outService.textContent = item.service || "";
      });
    });
  }
  els.hisClear.addEventListener("click", function () {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* 忽略 */ }
    renderHistory();
    window.frToast("历史已清空");
  });
  renderHistory();

  /* ---------- 站内快捷键 ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) { e.preventDefault(); swapLangs(); return; }
    if (e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      if (window.speechSynthesis && window.speechSynthesis.speaking) { window.frStopSpeak(); return; }
      if (lastResult) window.frSpeak(lastResult, els.dstLang.value);
    }
  });
})();
