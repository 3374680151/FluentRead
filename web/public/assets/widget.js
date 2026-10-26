/**
 * @file web/public/assets/widget.js
 *
 * 文件职责：全站悬浮翻译小组件——参考扩展右下角悬浮球与划词翻译的交互：
 * 1) 悬浮球：右下角常驻，可拖拽移动（位置记忆）、点按开合快捷面板（快速翻译输入框、
 *    划词翻译开关、翻译服务/偏好设置入口）、双击复位；
 * 2) 划词/点词弹窗：在页面里选中文本（双击选词同理）即自动弹出气泡，单词走 AI 词典
 *    （音标/义项/例句），句子走真实翻译，附复制与朗读，可随时关闭。
 * 模块边界：只负责本组件的 DOM 与交互；翻译/AI/偏好能力来自 app.js；页面卸载时无残留
 * 计时器与监听（组件随页面销毁，无需额外清理）。
 */
(function () {
  "use strict";

  var prefs = window.frGetPrefs();

  /* ==================== 悬浮球 ==================== */
  var fab = document.createElement("button");
  fab.className = "fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "流畅阅读悬浮球：点击打开快捷翻译面板");
  fab.title = "流畅阅读 · 快捷翻译（可拖动，双击复位）";
  fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h10"/><path d="M8 3v2c0 4-2 7-5 9"/><path d="M5.5 9c1 3 3 5 6 6"/><path d="m13 20 4-10 4 10"/><path d="M14.5 16.5h5"/></svg>';
  document.body.appendChild(fab);

  var panel = document.createElement("div");
  panel.className = "fab-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "快捷翻译面板");
  panel.innerHTML =
    '<h2>快捷翻译</h2>' +
    '<div class="stack" style="margin-top:10px">' +
      '<textarea class="textarea" id="fab-src" rows="3" placeholder="输入要翻译的文本…" style="min-height:64px" aria-label="要翻译的文本"></textarea>' +
      '<button class="btn btn-primary btn-sm" id="fab-go" style="align-self:flex-start">翻译</button>' +
      '<div class="fab-out muted" id="fab-out">译文将显示在这里。</div>' +
      '<div class="fab-meta"><span class="tiny" id="fab-meta"></span>' +
        '<span style="flex:1"></span>' +
        '<button class="icon-btn" id="fab-copy" aria-label="复制译文" title="复制译文" disabled>' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
        "</button>" +
        '<button class="icon-btn" id="fab-speak" aria-label="朗读译文" title="朗读译文" disabled>' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>' +
        "</button>" +
      "</div>" +
      '<label class="switch"><span>划词翻译</span><input type="checkbox" id="fab-sel"><span class="track" aria-hidden="true"></span></label>' +
      '<div class="row" style="justify-content:space-between">' +
        '<a class="tiny" href="services.html">翻译服务</a>' +
        '<a class="tiny" href="settings.html">偏好设置</a>' +
      "</div>" +
    "</div>";
  document.body.appendChild(panel);

  var fabOut = panel.querySelector("#fab-out");
  var fabMeta = panel.querySelector("#fab-meta");
  var fabResult = "";
  var fabLangTo = prefs.dstLang === "auto" ? "zh-Hans" : prefs.dstLang;

  function setPanel(open) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) hideBubble();
  }

  fab.addEventListener("click", function () {
    if (fab.dataset.dragged === "1") return; // 拖拽结束的那次 click 不开合
    setPanel(panel.hidden);
  });

  /* 拖拽移动 + 位置记忆 + 双击复位（键盘方向键微调，作为拖拽的无障碍替代） */
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function placeFab(x, y) {
    fab.style.right = "auto";
    fab.style.bottom = "auto";
    fab.style.left = clamp(x, 8, window.innerWidth - 56) + "px";
    fab.style.top = clamp(y, 8, window.innerHeight - 56) + "px";
  }
  function restoreFabPos() {
    if (prefs.fabPos && typeof prefs.fabPos.x === "number") placeFab(prefs.fabPos.x, prefs.fabPos.y);
  }
  restoreFabPos();
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
      window.frSetPrefs({ fabPos: { x: fab.offsetLeft, y: fab.offsetTop } });
    }
    drag = null;
  });
  fab.addEventListener("dblclick", function () {
    fab.style.left = ""; fab.style.top = ""; fab.style.right = ""; fab.style.bottom = "";
    window.frSetPrefs({ fabPos: null });
    window.frToast("悬浮球已复位到右下角");
  });
  fab.addEventListener("keydown", function (e) {
    var step = 16;
    var delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    placeFab(fab.offsetLeft + delta[0], fab.offsetTop + delta[1]);
    window.frSetPrefs({ fabPos: { x: fab.offsetLeft, y: fab.offsetTop } });
  });

  /* 面板内快速翻译 */
  var fabGo = panel.querySelector("#fab-go");
  var fabSrc = panel.querySelector("#fab-src");
  fabGo.addEventListener("click", function () {
    var text = fabSrc.value.trim();
    if (!text) { window.frToast("请输入要翻译的文本", true); return; }
    var spinner = window.frButtonBusy(fabGo, true);
    fabOut.textContent = "翻译中…";
    fabOut.classList.remove("muted");
    window.frTranslateSmart(text, "auto", fabLangTo, prefs.defaultService).then(function (result) {
      if (result.ok) {
        fabResult = result.text;
        fabOut.textContent = result.text;
        fabMeta.textContent = (result.label || "") + " · " + result.ms + "ms";
        panel.querySelector("#fab-copy").disabled = false;
        panel.querySelector("#fab-speak").disabled = false;
      } else {
        fabResult = "";
        fabOut.textContent = "翻译失败：" + result.error;
        fabOut.classList.add("muted");
        fabMeta.textContent = "";
        panel.querySelector("#fab-copy").disabled = true;
        panel.querySelector("#fab-speak").disabled = true;
      }
    }).finally(function () {
      window.frButtonBusy(fabGo, false);
    });
  });
  fabSrc.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fabGo.click(); }
  });
  panel.querySelector("#fab-copy").addEventListener("click", function () {
    if (fabResult && navigator.clipboard) navigator.clipboard.writeText(fabResult);
    window.frToast("已复制到剪贴板");
  });
  panel.querySelector("#fab-speak").addEventListener("click", function () {
    if (fabResult) window.frSpeak(fabResult, fabLangTo);
  });
  var fabSel = panel.querySelector("#fab-sel");
  fabSel.checked = !!prefs.selectionTranslate;
  fabSel.addEventListener("change", function () {
    window.frSetPrefs({ selectionTranslate: fabSel.checked });
  });
  document.addEventListener("frprefs", function () {
    prefs = window.frGetPrefs();
    fab.hidden = !prefs.fabEnabled;
    if (prefs.fabEnabled && prefs.fabPos) placeFab(prefs.fabPos.x, prefs.fabPos.y);
  });
  fab.hidden = !prefs.fabEnabled;

  /* ==================== 划词 / 点词弹窗 ==================== */
  var bubble = document.createElement("div");
  bubble.className = "sel-bubble";
  bubble.hidden = true;
  bubble.setAttribute("role", "dialog");
  bubble.setAttribute("aria-label", "划词翻译");
  document.body.appendChild(bubble);
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
    var margin = 10;
    var x = clamp(anchorRect.left + anchorRect.width / 2 - bw / 2, 8, window.innerWidth - bw - 8);
    var y = anchorRect.bottom + margin;
    if (y + bh > window.innerHeight - 8) y = Math.max(8, anchorRect.top - bh - margin);
    bubble.style.left = x + "px";
    bubble.style.top = y + "px";
  }

  function isEditable(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = node.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
  }

  function renderBubbleSkeleton(text, wordMode) {
    bubble.innerHTML = '<div class="sb-src">' + window.frEscape(text) + "</div>" +
      '<div class="sb-body"><div class="skeleton" style="height:16px;width:80%"></div></div>';
  }

  function renderBubbleResult(text, payload, wordMode) {
    var body;
    if (wordMode && payload.entry) {
      body = window.frDictCardHtml(payload.entry, payload.ms);
    } else if (payload.ok) {
      body = '<div>' + window.frEscape(payload.text) + "</div>" +
        '<p class="tiny" style="margin:6px 0 0">' + window.frEscape(payload.label || "") + " · " + payload.ms + "ms</p>";
    } else {
      body = '<div style="color:var(--danger)">' + window.frEscape(payload.error || "翻译失败") + "</div>";
    }
    var note = wordMode && !window.frAiConfigured()
      ? '<p class="tiny sb-note muted">配置 AI 服务后，单词会显示完整词典（音标/义项/例句）。</p>'
      : "";
    bubble.innerHTML = '<div class="sb-src">' + window.frEscape(text) + "</div>" +
      '<div class="sb-body">' + body + "</div>" + note +
      '<div class="sb-meta">' +
        '<button class="icon-btn" data-sb-copy aria-label="复制结果" title="复制">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
        "</button>" +
        '<button class="icon-btn" data-sb-speak aria-label="朗读" title="朗读">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>' +
        "</button>" +
        '<button class="icon-btn" data-sb-close aria-label="关闭" title="关闭">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
        "</button>" +
      "</div>";
    var resultText = payload.entry ? (payload.entry.senses || []).map(function (s) { return s.meaning; }).join("；") || payload.entry.word : payload.ok ? payload.text : "";
    bubble.querySelector("[data-sb-copy]").addEventListener("click", function () {
      if (resultText && navigator.clipboard) navigator.clipboard.writeText(resultText);
      window.frToast("已复制到剪贴板");
    });
    bubble.querySelector("[data-sb-speak]").addEventListener("click", function () {
      var speakText = payload.entry ? payload.entry.word : payload.ok ? payload.text : "";
      if (speakText) window.frSpeak(speakText, wordMode ? "en-US" : prefs.dstLang === "auto" ? "zh-Hans" : prefs.dstLang);
    });
    bubble.querySelector("[data-sb-close]").addEventListener("click", hideBubble);
  }

  function isWordLike(text) {
    var t = text.trim();
    if (!t) return false;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(t)) return t.length <= 12 && t.indexOf(" ") < 0;
    return t.length <= 40 && t.split(/\s+/).length <= 3;
  }

  function showBubbleFor(text, rect) {
    var token = ++bubbleToken;
    var wordMode = isWordLike(text);
    renderBubbleSkeleton(text, wordMode);
    placeBubble(rect);
    var context = "";
    try {
      var anchor = window.getSelection().anchorNode;
      var container = anchor && (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement);
      var scope = container && container.closest ? container.closest("p, li, td, th, .trans-out") : null;
      if (scope) context = (scope.textContent || "").trim().slice(0, 240);
    } catch (e) { /* 上下文提取失败不阻塞翻译 */ }
    var request = wordMode && window.frAiConfigured()
      ? window.frDictLookup(text, context).then(function (r) {
          return r.ok ? { wordMode: true, entry: r.entry, ms: r.ms } : { wordMode: false, ok: false, error: r.error, ms: 0 };
        })
      : window.frTranslateSmart(text, "auto", prefs.dstLang === "auto" ? "zh-Hans" : prefs.dstLang, prefs.defaultService).then(function (r) {
          return { wordMode: false, ok: r.ok, text: r.text, label: r.label, error: r.error, ms: r.ms };
        });
    request.then(function (payload) {
      if (token !== bubbleToken) return; // 已被新的选择或关闭取代
      renderBubbleResult(text, payload, wordMode);
      placeBubble(rect);
    });
  }

  document.addEventListener("mouseup", function (e) {
    if (e.target.closest && (e.target.closest(".sel-bubble") || e.target.closest(".fab") || e.target.closest(".fab-panel"))) return;
    if (!prefs.selectionTranslate) return;
    // 等选区稳定后再读取（双击/拖选的 mouseup 时选区已就绪）
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
      showBubbleFor(text, rect);
    }, 10);
  });
  document.addEventListener("pointerdown", function (e) {
    if (e.target.closest && e.target.closest(".sel-bubble")) return;
    // 点击页面其他位置立即收起（mouseup 的新选择会重新弹出）
    if (!bubble.hidden) hideBubble();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !bubble.hidden) hideBubble();
    if (e.key === "Escape" && !panel.hidden) setPanel(false);
  });
})();
