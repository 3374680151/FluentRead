/* FluentRead Web 原型交互脚本
   职责：主题切换（localStorage 记忆）、页签切换、抽屉/对话框开关、
   toast 反馈、复制按钮与文本翻译页的请求→加载→出稿演示。 */
(function () {
  "use strict";

  /* ---------- 主题 ---------- */
  var root = document.documentElement;
  function applyTheme(mode) {
    root.setAttribute("data-theme", mode);
    try { localStorage.setItem("fr-theme", mode); } catch (e) { /* 隐私模式忽略 */ }
    document.querySelectorAll("[data-theme-btn]").forEach(function (b) {
      b.setAttribute("aria-pressed", mode === "dark" ? "true" : "false");
    });
  }
  var saved = null;
  try { saved = localStorage.getItem("fr-theme"); } catch (e) { /* 同上 */ }
  applyTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-btn]");
    if (!btn) return;
    applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  /* ---------- Toast ---------- */
  var zone = null;
  window.frToast = function (msg) {
    if (!zone) {
      zone = document.createElement("div");
      zone.className = "toast-zone";
      zone.setAttribute("role", "status");
      document.body.appendChild(zone);
    }
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    zone.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  };

  /* ---------- 页签 ---------- */
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

  /* ---------- 抽屉 / 对话框 ---------- */
  function openLayer(el) {
    if (!el) return;
    el.classList.add("open");
    var scrim = ensureScrim(el);
    scrim.classList.add("show");
    var first = el.querySelector("input, select, textarea, button:not([data-close])");
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function closeLayer(el) {
    if (!el) return;
    el.classList.remove("open");
    hideScrim();
  }
  function ensureScrim(el) {
    var id = "scrim-" + (el.id || Math.random().toString(36).slice(2));
    var scrim = document.getElementById(id);
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.id = id;
      document.body.appendChild(scrim);
      scrim.addEventListener("click", function () { closeLayer(el); });
    }
    return scrim;
  }
  function hideScrim() {
    document.querySelectorAll(".scrim.show").forEach(function (s) { s.classList.remove("show"); });
  }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open]");
    if (opener) { openLayer(document.getElementById(opener.dataset.open)); return; }
    var closer = e.target.closest("[data-close]");
    if (closer) { closeLayer(closer.closest(".drawer, .dialog")); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".drawer.open, .dialog.open").forEach(closeLayer);
    }
  });

  /* ---------- 复制演示 ---------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn) return;
    var text = document.getElementById(btn.dataset.copy);
    var value = text ? text.textContent : btn.dataset.copy;
    if (navigator.clipboard) navigator.clipboard.writeText(value.trim());
    window.frToast("已复制到剪贴板");
  });

  /* ---------- 翻译演示（text.html） ---------- */
  var goBtn = document.getElementById("demo-translate");
  if (goBtn) {
    goBtn.addEventListener("click", function () {
      var out = document.getElementById("demo-output");
      var bar = document.getElementById("demo-service");
      goBtn.disabled = true;
      goBtn.setAttribute("aria-busy", "true");
      var spinner = document.createElement("span");
      spinner.className = "spin";
      goBtn.prepend(spinner);
      out.innerHTML = '<div class="stack">' +
        '<div class="skeleton" style="height:20px;width:92%"></div>' +
        '<div class="skeleton" style="height:20px;width:85%"></div>' +
        '<div class="skeleton" style="height:20px;width:60%"></div></div>';
      if (bar) bar.textContent = "正在请求 免费翻译服务（线路 2 · 微软）…";
      setTimeout(function () {
        out.innerHTML =
          '<p>过去，机器翻译系统需要流式传输音频并立即生成翻译，' +
          '延迟是衡量质量的核心指标。而新一代大语言模型能够理解上下文、' +
          '修正口语中的冗余，并保持术语一致——这为实时双语阅读带来了全新的体验。</p>' +
          '<p class="trans-src">— 由 免费翻译服务 生成 · 0.8s</p>';
        goBtn.disabled = false;
        goBtn.removeAttribute("aria-busy");
        spinner.remove();
        if (bar) bar.textContent = "免费翻译服务 · 线路 2（微软）";
        window.frToast("翻译完成 · 已写入缓存");
      }, 1200);
    });
  }

  /* ---------- 翻转卡（learn.html） ---------- */
  document.querySelectorAll(".flash").forEach(function (card) {
    card.addEventListener("click", function () { card.classList.toggle("flip"); });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.classList.toggle("flip"); }
    });
  });
})();
