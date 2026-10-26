/**
 * @file web/public/assets/settings.js
 *
 * 文件职责：偏好设置页（settings.html）的页面逻辑——语言/服务/换线/自动朗读/历史条数、
 * 主题三态、朗读语速与系统音色（Web Speech API）、AI 提示词偏好、数据管理
 * （历史清空、全部数据导出/导入、危险清除）、自助诊断（本地服务、免费服务连通性、
 * AI 服务、朗读、屏幕捕获、OCR 引擎 CDN、存储用量的真实检测）。
 * 模块边界：只操作本页 DOM；共享能力（偏好、请求封装、主题、toast）来自 app.js。
 */
(function () {
  "use strict";

  var els = {
    saveBadge: document.getElementById("save-badge"),
    defSrc: document.getElementById("def-src"),
    defDst: document.getElementById("def-dst"),
    defService: document.getElementById("def-service"),
    autoFallback: document.getElementById("auto-fallback"),
    autoRead: document.getElementById("auto-read"),
    selTranslate: document.getElementById("sel-translate"),
    fabEnable: document.getElementById("fab-enable"),
    historyLimit: document.getElementById("history-limit"),
    themeSeg: document.getElementById("theme-seg"),
    ttsRate: document.getElementById("tts-rate"),
    ttsRateLabel: document.getElementById("tts-rate-label"),
    ttsVoice: document.getElementById("tts-voice"),
    ttsTest: document.getElementById("tts-test"),
    ttsHint: document.getElementById("tts-hint"),
    aiState: document.getElementById("ai-state"),
    aiStyle: document.getElementById("ai-style"),
    aiTone: document.getElementById("ai-tone"),
    aiPref: document.getElementById("ai-pref"),
    historyCount: document.getElementById("data-history-count"),
    historyClear: document.getElementById("data-history-clear"),
    dataExport: document.getElementById("data-export"),
    dataImportBtn: document.getElementById("data-import-btn"),
    dataImport: document.getElementById("data-import"),
    dataWipe: document.getElementById("data-wipe"),
    diagGo: document.getElementById("diag-go"),
    diagRows: document.getElementById("diag-rows"),
    diagServices: document.getElementById("diag-services"),
  };
  var prefs = window.frGetPrefs();
  var saveTimer = null;

  function saved() {
    els.saveBadge.textContent = "已保存 ✓";
    els.saveBadge.className = "badge badge-ok";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      els.saveBadge.textContent = "全部已保存";
    }, 1800);
  }

  /* ==================== 语言与翻译 ==================== */
  window.frCatalog().then(function (catalog) {
    window.frFillSelect(els.defSrc, catalog.languages, prefs.srcLang);
    window.frFillSelect(els.defDst, catalog.languages, prefs.dstLang);
    renderServiceSelect();
  });
  function renderServiceSelect() {
    var entries = window.frServiceEntries();
    els.defService.innerHTML = entries.map(function (s) {
      return '<option value="' + window.frEscape(s.id) + '">' + window.frEscape(s.label) + "</option>";
    }).join("");
    if (entries.some(function (s) { return s.id === prefs.defaultService; })) {
      els.defService.value = prefs.defaultService;
    }
  }
  els.defSrc.addEventListener("change", function () { window.frSetPrefs({ srcLang: els.defSrc.value }); saved(); });
  els.defDst.addEventListener("change", function () { window.frSetPrefs({ dstLang: els.defDst.value }); saved(); });
  els.defService.addEventListener("change", function () { window.frSetPrefs({ defaultService: els.defService.value }); saved(); });
  els.autoFallback.checked = !!prefs.autoFallback;
  els.autoFallback.addEventListener("change", function () { window.frSetPrefs({ autoFallback: els.autoFallback.checked }); saved(); });
  els.autoRead.checked = !!prefs.autoRead;
  els.autoRead.addEventListener("change", function () { window.frSetPrefs({ autoRead: els.autoRead.checked }); saved(); });
  els.selTranslate.checked = !!prefs.selectionTranslate;
  els.selTranslate.addEventListener("change", function () { window.frSetPrefs({ selectionTranslate: els.selTranslate.checked }); saved(); });
  els.fabEnable.checked = !!prefs.fabEnabled;
  els.fabEnable.addEventListener("change", function () { window.frSetPrefs({ fabEnabled: els.fabEnable.checked }); saved(); });
  els.historyLimit.value = prefs.historyLimit || 20;
  els.historyLimit.addEventListener("change", function () {
    var value = Math.min(100, Math.max(5, Number(els.historyLimit.value) || 20));
    els.historyLimit.value = String(value);
    window.frSetPrefs({ historyLimit: value });
    saved();
  });

  /* ==================== 主题与朗读 ==================== */
  function renderThemeSeg() {
    els.themeSeg.querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.value === prefs.theme ? "true" : "false");
    });
  }
  renderThemeSeg();
  els.themeSeg.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-value]");
    if (!btn) return;
    window.frSetPrefs({ theme: btn.dataset.value });
    renderThemeSeg();
    saved();
  });
  els.ttsRate.value = String(prefs.ttsRate || 1);
  els.ttsRateLabel.textContent = Number(prefs.ttsRate || 1).toFixed(1) + "×";
  els.ttsRate.addEventListener("input", function () {
    var rate = Number(els.ttsRate.value);
    els.ttsRateLabel.textContent = rate.toFixed(1) + "×";
    window.frSetPrefs({ ttsRate: rate });
  });
  els.ttsRate.addEventListener("change", saved);

  function renderVoices() {
    if (!window.frSpeakSupported()) {
      els.ttsHint.textContent = "当前浏览器不支持语音朗读";
      els.ttsVoice.disabled = true;
      els.ttsTest.disabled = true;
      return;
    }
    var voices = window.speechSynthesis.getVoices();
    var current = window.frGetPrefs().ttsVoice || "";
    els.ttsVoice.innerHTML = '<option value="">浏览器默认</option>' + voices.map(function (v) {
      return '<option value="' + window.frEscape(v.name) + '">' + window.frEscape(v.name + "（" + v.lang + "）") + "</option>";
    }).join("");
    if (voices.some(function (v) { return v.name === current; })) els.ttsVoice.value = current;
    els.ttsHint.textContent = voices.length ? "共 " + voices.length + " 个系统音色" : "音色列表尚未就绪，稍后自动刷新";
  }
  renderVoices();
  if (window.frSpeakSupported() && window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener("voiceschanged", renderVoices);
  }
  els.ttsVoice.addEventListener("change", function () { window.frSetPrefs({ ttsVoice: els.ttsVoice.value }); saved(); });
  els.ttsTest.addEventListener("click", function () {
    window.frSpeak("你好，这是流畅阅读网页版的朗读测试。Hello, this is a FluentRead voice test.");
  });

  /* ==================== AI 助手 ==================== */
  function refreshAiState() {
    if (window.frAiConfigured()) {
      var ai = window.frGetPrefs().ai;
      els.aiState.textContent = "已配置 · " + (ai.name || ai.model);
      els.aiState.className = "badge badge-ok";
    } else {
      els.aiState.textContent = "未配置";
      els.aiState.className = "badge";
    }
  }
  refreshAiState();
  els.aiStyle.value = prefs.aiExplainStyle;
  els.aiStyle.addEventListener("change", function () { window.frSetPrefs({ aiExplainStyle: els.aiStyle.value }); saved(); });
  els.aiTone.value = prefs.aiWriteTone;
  els.aiTone.addEventListener("change", function () { window.frSetPrefs({ aiWriteTone: els.aiTone.value }); saved(); });
  els.aiPref.value = prefs.aiPref || "";
  els.aiPref.addEventListener("change", function () { window.frSetPrefs({ aiPref: els.aiPref.value.trim() }); saved(); });

  /* ==================== 数据 ==================== */
  function historyList() {
    try { return JSON.parse(localStorage.getItem("frweb-history") || "[]") || []; } catch (e) { return []; }
  }
  function refreshDataInfo() {
    els.historyCount.textContent = historyList().length + " 条";
  }
  refreshDataInfo();
  els.historyClear.addEventListener("click", function () {
    localStorage.removeItem("frweb-history");
    refreshDataInfo();
    window.frToast("历史已清空");
  });
  els.dataExport.addEventListener("click", function () {
    var payload = {
      app: "FluentRead Web",
      exportedAt: new Date().toISOString(),
      prefs: window.frGetPrefs(),
      history: historyList(),
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "fluentread-web-backup.json";
    link.click();
    URL.revokeObjectURL(link.href);
    window.frToast("已导出（含密钥，请妥善保管）");
  });
  els.dataImportBtn.addEventListener("click", function () { els.dataImport.click(); });
  els.dataImport.addEventListener("change", function () {
    var file = els.dataImport.files && els.dataImport.files[0];
    if (!file) return;
    file.text().then(function (raw) {
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !data.prefs) throw new Error("不是 FluentRead Web 备份文件");
      try { localStorage.setItem("frweb-prefs", JSON.stringify(data.prefs)); } catch (e) { /* 忽略 */ }
      if (Array.isArray(data.history)) {
        try { localStorage.setItem("frweb-history", JSON.stringify(data.history)); } catch (e) { /* 忽略 */ }
      }
      window.frToast("导入成功，即将刷新页面");
      setTimeout(function () { location.reload(); }, 800);
    }).catch(function (error) {
      window.frToast("导入失败：" + error.message, true);
    }).finally(function () {
      els.dataImport.value = "";
    });
  });
  els.dataWipe.addEventListener("click", function () {
    if (!window.confirm("确定清除全部站点数据？偏好、AI 配置（含密钥）与历史都会删除。")) return;
    if (!window.confirm("再次确认：此操作不可撤销。")) return;
    try {
      localStorage.removeItem("frweb-prefs");
      localStorage.removeItem("frweb-history");
    } catch (e) { /* 忽略 */ }
    window.frToast("已清除，即将刷新页面");
    setTimeout(function () { location.reload(); }, 600);
  });

  /* ==================== 自助诊断 ==================== */
  function diagRow(name, ok, note, tone) {
    var badge = tone === "warn"
      ? '<span class="badge badge-warn">' + window.frEscape(note.badge || "注意") + "</span>"
      : ok
        ? '<span class="badge badge-ok">' + window.frEscape(note.badge || "正常") + "</span>"
        : '<span class="badge badge-danger">' + window.frEscape(note.badge || "异常") + "</span>";
    return "<tr><td class=\"small\">" + window.frEscape(name) + "</td><td>" + badge + "</td><td class=\"tiny\">" + window.frEscape(note.text || "") + "</td></tr>";
  }

  function checkService(id) {
    var startedAt = Date.now();
    return window.frTranslateOnce("Hello, world! This is a connection test.", "auto", "zh-Hans", id)
      .then(function (r) {
        return { id: id, ok: r.ok, ms: Date.now() - startedAt, error: r.error, upstreamMs: r.ms };
      })
      .catch(function (error) {
        return { id: id, ok: false, ms: Date.now() - startedAt, error: error.message };
      });
  }

  els.diagGo.addEventListener("click", function () {
    var spinner = window.frButtonBusy(els.diagGo, true);
    els.diagRows.innerHTML = '<tr><td colspan="3" class="tiny">检测中…</td></tr>';
    els.diagServices.innerHTML = '<span class="tiny muted">检测中…</span>';

    var checks = [];
    // 1. 本地服务
    checks.push(function () {
      var startedAt = Date.now();
      return window.frCatalog()
        .then(function (catalog) {
          return { name: "本地转发服务", ok: true, badge: "在线 " + (Date.now() - startedAt) + "ms", text: "免费服务 " + (catalog.services || []).length + " 个 · 语言 " + Object.keys(catalog.languages || {}).length + " 种" };
        })
        .catch(function () {
          return { name: "本地转发服务", ok: false, badge: "离线", text: "未启动，请运行 pnpm web:start" };
        });
    });
    // 2. 免费服务连通性（并行真实测试）
    checks.push(function () {
      return window.frCatalog().then(function (catalog) {
        return Promise.all((catalog.services || []).map(function (s) { return checkService(s.id); }))
          .then(function (results) {
            els.diagServices.innerHTML = results.map(function (r) {
              return '<span class="chip" aria-pressed="' + r.ok + '">' + window.frEscape(window.frFreeServiceLabel(r.id)) +
                " " + (r.ok ? r.upstreamMs + "ms ✓" : "✕") + "</span>";
            }).join("");
            var okCount = results.filter(function (r) { return r.ok; }).length;
            return {
              name: "免费服务连通性",
              ok: okCount > 0,
              badge: okCount + "/" + results.length + " 正常",
              text: okCount === results.length ? "全部线路可用" : "失败线路在翻译时会被自动跳过（如已开启换线）",
            };
          });
      });
    });
    // 3. AI 服务
    checks.push(function () {
      if (!window.frAiConfigured()) {
        return Promise.resolve({ name: "AI 服务", ok: true, tone: "warn", badge: "未配置", text: "翻译可用免费线路；AI 词典与写作需到翻译服务页配置" });
      }
      var startedAt = Date.now();
      return window.frAiChat([{ role: "user", content: "只回复两个字：正常" }], { maxTokens: 8 })
        .then(function (result) {
          if (result.ok) return { name: "AI 服务", ok: true, badge: "正常 " + result.ms + "ms", text: (window.frGetPrefs().ai.name || "") + " 连接可用" };
          return { name: "AI 服务", ok: false, badge: "失败", text: result.error || "未知错误" };
        });
    });
    // 4. 朗读能力
    checks.push(function () {
      if (!window.frSpeakSupported()) {
        return Promise.resolve({ name: "语音朗读", ok: false, badge: "不支持", text: "当前浏览器没有 speechSynthesis" });
      }
      var count = window.speechSynthesis.getVoices().length;
      return Promise.resolve({ name: "语音朗读", ok: true, badge: "支持", text: count ? "系统提供 " + count + " 个音色" : "音色列表异步加载中" });
    });
    // 5. 屏幕捕获
    checks.push(function () {
      var supported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
      return Promise.resolve({
        name: "屏幕捕获（圈选翻译）", ok: supported,
        badge: supported ? "支持" : "不支持",
        text: supported ? "可在图片·字幕页使用圈选截图" : "当前浏览器不支持 getDisplayMedia",
      });
    });
    // 6. OCR 引擎 CDN（多源探测：任一可达即可用）
    checks.push(function () {
      var candidates = [
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
        "https://fastly.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
        "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js",
      ];
      var startedAt = Date.now();
      var chain = Promise.reject(new Error("start"));
      var reachable = "";
      candidates.forEach(function (url) {
        chain = chain.catch(function () {
          return fetch(url, { method: "HEAD" }).then(function () {
            reachable = new URL(url).host;
          });
        });
      });
      return chain.then(function () {
        var langCdn = fetch("https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz", { method: "HEAD" })
          .then(function () { return true; }).catch(function () { return false; });
        return langCdn.then(function (langOk) {
          return {
            name: "OCR 引擎（CDN）", ok: langOk, badge: "可达 " + (Date.now() - startedAt) + "ms",
            text: "引擎源 " + reachable + (langOk ? " · 语言包 tessdata 官方源可用" : " · 语言包源不可达，识别会失败"),
          };
        });
      }).catch(function () {
        return { name: "OCR 引擎（CDN）", ok: false, badge: "不可达", text: "jsDelivr 主站/镜像与 unpkg 均无法访问，图片翻译不可用；字幕翻译不受影响" };
      });
    });
    // 7. 本地存储
    checks.push(function () {
      var size = 0;
      try { size = (localStorage.getItem("frweb-prefs") || "").length + (localStorage.getItem("frweb-history") || "").length; } catch (e) { /* 忽略 */ }
      return Promise.resolve({
        name: "本地存储", ok: true, badge: "正常",
        text: "偏好与历史约 " + Math.max(1, Math.round(size / 1024)) + " KiB · 历史 " + historyList().length + " 条",
      });
    });

    var chain = Promise.resolve();
    var rows = [];
    checks.forEach(function (check) {
      chain = chain.then(function () { return check(); }).then(function (row) {
        rows.push(diagRow(row.name, row.ok, { badge: row.badge, text: row.text }, row.tone));
        els.diagRows.innerHTML = rows.join("");
      });
    });
    chain.catch(function (error) {
      rows.push(diagRow("检测过程", false, { badge: "异常", text: error.message }));
      els.diagRows.innerHTML = rows.join("");
    }).finally(function () {
      window.frButtonBusy(els.diagGo, false);
    });
  });

  document.addEventListener("frprefs", refreshAiState);
})();
