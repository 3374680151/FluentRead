/**
 * @file web/public/assets/media.js
 *
 * 文件职责：图片·字幕页（media.html）的页面逻辑，三个能力全部真实可用：
 * 1) 图片翻译——浏览器本地 OCR（Tesseract.js WASM，按需从 CDN 加载，图片不出本机），
 *    识别行经 /api/translate 或 AI 服务批量翻译；
 * 2) 字幕翻译——解析 SRT/VTT，按批次真实翻译（批内行数不一致自动逐条重试），
 *    译文可编辑，导出译文/双语 SRT；
 * 3) 圈选截图——getDisplayMedia 共享屏幕，框选区域裁剪后本地 OCR 并翻译。
 * 模块边界：只操作本页 DOM 与媒体对象；共享能力（偏好、翻译封装、toast）来自 app.js。
 * 页面卸载时终止 OCR worker 并停止屏幕共享轨道。
 */
(function () {
  "use strict";

  var els = {
    apiBadge: document.getElementById("api-badge"),
    /* 图片翻译 */
    imgDrop: document.getElementById("img-drop"),
    imgFile: document.getElementById("img-file"),
    imgPreview: document.getElementById("img-preview"),
    imgMeta: document.getElementById("img-meta"),
    ocrLang: document.getElementById("ocr-lang"),
    imgTo: document.getElementById("img-to"),
    imgService: document.getElementById("img-service"),
    ocrAuto: document.getElementById("ocr-auto"),
    ocrGo: document.getElementById("ocr-go"),
    ocrStatus: document.getElementById("ocr-status"),
    ocrProgress: document.getElementById("ocr-progress"),
    ocrSummary: document.getElementById("ocr-summary"),
    ocrRows: document.getElementById("ocr-rows"),
    ocrText: document.getElementById("ocr-text"),
    /* 字幕翻译 */
    subDrop: document.getElementById("sub-drop"),
    subFile: document.getElementById("sub-file"),
    subPaste: document.getElementById("sub-paste"),
    subParse: document.getElementById("sub-parse"),
    subCard: document.getElementById("sub-card"),
    subName: document.getElementById("sub-name"),
    subMeta: document.getElementById("sub-meta"),
    subState: document.getElementById("sub-state"),
    subLang: document.getElementById("sub-lang"),
    subService: document.getElementById("sub-service"),
    subGo: document.getElementById("sub-go"),
    subCancel: document.getElementById("sub-cancel"),
    subStatus: document.getElementById("sub-status"),
    subProgress: document.getElementById("sub-progress"),
    subRows: document.getElementById("sub-rows"),
    subExport: document.getElementById("sub-export"),
    subExportDual: document.getElementById("sub-export-dual"),
    /* 圈选截图 */
    areaLang: document.getElementById("area-lang"),
    areaTo: document.getElementById("area-to"),
    areaService: document.getElementById("area-service"),
    areaGo: document.getElementById("area-go"),
    areaStop: document.getElementById("area-stop"),
    areaStatus: document.getElementById("area-status"),
    areaStage: document.getElementById("area-stage"),
    areaVideo: document.getElementById("area-video"),
    areaPlaceholder: document.getElementById("area-placeholder"),
    areaSel: document.getElementById("area-sel"),
    areaRows: document.getElementById("area-rows"),
    areaResultMeta: document.getElementById("area-result-meta"),
    areaText: document.getElementById("area-text"),
  };
  var prefs = window.frGetPrefs();

  window.frCatalog().then(function (catalog) {
    els.apiBadge.textContent = "本地服务在线";
    els.apiBadge.className = "badge badge-ok";
    var targetLanguages = {};
    Object.keys(catalog.languages).forEach(function (code) {
      if (code !== "auto") targetLanguages[code] = catalog.languages[code];
    });
    window.frFillSelect(els.imgTo, targetLanguages, prefs.dstLang === "auto" ? "zh-Hans" : prefs.dstLang);
    window.frFillSelect(els.subLang, targetLanguages, prefs.dstLang === "auto" ? "zh-Hans" : prefs.dstLang);
    window.frFillSelect(els.areaTo, targetLanguages, prefs.dstLang === "auto" ? "zh-Hans" : prefs.dstLang);
    fillServiceSelects();
  }).catch(function () {
    els.apiBadge.textContent = "本地服务离线";
    els.apiBadge.className = "badge badge-danger";
    window.frToast("本地服务未启动，请先运行 pnpm web:start", true);
  });

  function fillServiceSelects() {
    [els.imgService, els.subService, els.areaService].forEach(function (select) {
      var current = select.value || prefs.defaultService;
      select.innerHTML = window.frServiceEntries().map(function (s) {
        return '<option value="' + window.frEscape(s.id) + '">' + window.frEscape(s.label) + "</option>";
      }).join("");
      if (select.querySelector('option[value="' + current + '"]')) select.value = current;
    });
  }
  document.addEventListener("frprefs", fillServiceSelects);
  els.ocrAuto.checked = !!prefs.autoTranslateOcr;
  els.ocrAuto.addEventListener("change", function () {
    window.frSetPrefs({ autoTranslateOcr: els.ocrAuto.checked });
  });
  els.ocrLang.value = prefs.ocrLang || "eng";
  els.ocrLang.addEventListener("change", function () { window.frSetPrefs({ ocrLang: els.ocrLang.value }); });
  els.areaLang.value = prefs.ocrLang || "eng";

  /* ==================== OCR 引擎（Tesseract.js，按需加载，多 CDN 自动回退） ==================== */
  var OCR_CDNS = [
    { label: "cdn.jsdelivr.net", script: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", base: "https://cdn.jsdelivr.net/npm" },
    { label: "fastly.jsdelivr.net", script: "https://fastly.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", base: "https://fastly.jsdelivr.net/npm" },
    { label: "unpkg.com", script: "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js", base: "https://unpkg.com" },
  ];
  // 语言包（traineddata）使用 tessdata 官方源；与脚本源分开，避免单一镜像故障
  var OCR_LANG_CDN = "https://tessdata.projectnaptha.com/4.0.0";
  var ocrCdn = null; // 本次会话选中的 CDN
  function loadScriptOnce(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = url;
      script.onload = resolve;
      script.onerror = function () { script.remove(); reject(new Error("加载失败")); };
      document.head.appendChild(script);
    });
  }
  function ensureTesseract() {
    if (window.Tesseract && ocrCdn) return Promise.resolve();
    var cached = null;
    try { cached = sessionStorage.getItem("frweb-ocr-cdn"); } catch (e) { /* 忽略 */ }
    if (cached) {
      var saved = OCR_CDNS.filter(function (c) { return c.label === cached; })[0];
      if (saved) {
        ocrCdn = saved;
        return loadScriptOnce(saved.script).then(function () { /* 已缓存可用源 */ });
      }
    }
    var chain = Promise.reject(new Error("start"));
    OCR_CDNS.forEach(function (candidate) {
      chain = chain.catch(function () {
        return loadScriptOnce(candidate.script).then(function () {
          ocrCdn = candidate;
          try { sessionStorage.setItem("frweb-ocr-cdn", candidate.label); } catch (e) { /* 忽略 */ }
        });
      });
    });
    return chain.catch(function () {
      throw new Error("无法从任何 CDN 加载 OCR 引擎（jsDelivr 主站/镜像与 unpkg 均不可达），请检查网络");
    });
  }

  var ocrWorker = null;
  var ocrWorkerLang = "";
  var progressHandler = null;
  function getOcrWorker(lang) {
    return ensureTesseract().then(function () {
      if (ocrWorker && ocrWorkerLang === lang) return ocrWorker;
      if (ocrWorker) return ocrWorker.terminate().then(function () {
        ocrWorker = null;
        return getOcrWorker(lang);
      });
      // 显式指定 worker/core/lang 路径：Tesseract.js 的默认值硬编码主站 CDN，
      // 主站不可达时必须随选中的镜像一起切换
      var options = {
        workerPath: ocrCdn.base + "/tesseract.js@5/dist/worker.min.js",
        corePath: ocrCdn.base + "/tesseract.js-core@5",
        langPath: OCR_LANG_CDN,
        logger: function (m) {
          if (progressHandler) progressHandler(m);
        },
      };
      return window.Tesseract.createWorker(lang, 1, options).then(function (worker) {
        ocrWorker = worker;
        ocrWorkerLang = lang;
        return worker;
      });
    });
  }

  /** 对图片/画布做 OCR，返回非空文本行 [{text, confidence}]。 */
  function recognizeLines(source, lang) {
    progressHandler = function (m) {
      var label = {
        "loading tesseract core": "加载识别引擎",
        "initializing tesseract": "初始化引擎",
        "loading language traineddata": "下载语言包",
        "initializing api": "初始化识别",
        "recognizing text": "识别文字",
      }[m.status] || m.status;
      var percent = Math.round((m.progress || 0) * 100);
      els.ocrStatus.textContent = label + " " + percent + "%";
      els.areaStatus.textContent = label + " " + percent + "%";
      var bar = document.querySelector("#ocr-progress i");
      if (bar) bar.style.width = percent + "%";
    };
    els.ocrProgress.hidden = false;
    return getOcrWorker(lang).then(function (worker) {
      els.ocrStatus.textContent = "识别引擎：" + (ocrCdn ? ocrCdn.label : "默认") + " · 识别中…";
      return worker.recognize(source);
    }).then(function (data) {
      els.ocrProgress.hidden = true;
      progressHandler = null;
      return (data.data.lines || [])
        .map(function (line) { return { text: line.text.trim(), confidence: line.confidence }; })
        .filter(function (line) { return line.text; });
    }).catch(function (error) {
      els.ocrProgress.hidden = true;
      progressHandler = null;
      throw error;
    });
  }

  function confidenceBadge(confidence) {
    var rounded = Math.round(confidence);
    var cls = rounded >= 90 ? "badge-ok" : rounded >= 75 ? "badge-warn" : "badge-danger";
    return '<span class="badge ' + cls + '">' + rounded + "%</span>";
  }

  /** 批量翻译一组行：先整体一次请求，行数不一致时逐条重试。返回与输入等长的译文数组。 */
  function translateLines(lines, to, serviceId) {
    var joined = lines.map(function (line) { return line.text; }).join("\n");
    return window.frTranslateSmart(joined, "auto", to, serviceId).then(function (result) {
      if (!result.ok) {
        return lines.map(function () { return "（失败：" + result.error + "）"; });
      }
      var parts = result.text.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length === lines.length) return parts;
      // 行数不一致：逐条重试，保证对齐
      var chain = Promise.resolve();
      var perLine = [];
      lines.forEach(function (line) {
        chain = chain.then(function () {
          return window.frTranslateSmart(line.text, "auto", to, serviceId).then(function (r) {
            perLine.push(r.ok ? r.text : "（失败：" + r.error + "）");
          });
        });
      });
      return chain.then(function () { return perLine; });
    });
  }

  /* ==================== 图片翻译 ==================== */
  var currentImage = null; // File/Blob
  var ocrLines = [];       // [{text, confidence, trans}]

  function loadImage(file) {
    if (!file || !/^image\//.test(file.type)) { window.frToast("请选择图片文件", true); return; }
    currentImage = file;
    ocrLines = [];
    var url = URL.createObjectURL(file);
    els.imgPreview.innerHTML = "";
    var img = document.createElement("img");
    img.src = url;
    img.alt = "待识别图片预览";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "320px";
    img.style.borderRadius = "8px";
    els.imgPreview.appendChild(img);
    els.imgMeta.textContent = file.name + " · " + Math.round(file.size / 1024) + " KiB";
    els.ocrStatus.textContent = "图片已就绪";
    els.ocrSummary.textContent = "待识别";
    els.ocrSummary.className = "badge";
    els.ocrRows.innerHTML = '<tr><td colspan="3" class="tiny">点击「开始识别」。</td></tr>';
  }

  els.imgDrop.addEventListener("click", function () { els.imgFile.click(); });
  els.imgDrop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.imgFile.click(); }
  });
  els.imgFile.addEventListener("change", function () {
    if (els.imgFile.files && els.imgFile.files[0]) loadImage(els.imgFile.files[0]);
    els.imgFile.value = "";
  });
  ["dragover", "dragenter"].forEach(function (type) {
    els.imgDrop.addEventListener(type, function (e) { e.preventDefault(); });
  });
  els.imgDrop.addEventListener("drop", function (e) {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
  });
  document.addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image/") === 0) {
        loadImage(items[i].getAsFile());
        return;
      }
    }
  });

  function renderOcrRows() {
    if (!ocrLines.length) {
      els.ocrRows.innerHTML = '<tr><td colspan="3" class="tiny">没有识别到文字。</td></tr>';
      els.ocrText.textContent = "";
      return;
    }
    els.ocrRows.innerHTML = ocrLines.map(function (line) {
      return "<tr><td class=\"small mono\">" + window.frEscape(line.text) + "</td>" +
        "<td class=\"small\">" + window.frEscape(line.trans || "…") + "</td>" +
        "<td>" + confidenceBadge(line.confidence) + "</td></tr>";
    }).join("");
    els.ocrText.textContent = ocrLines.map(function (line) {
      return line.text + (line.trans ? " — " + line.trans : "");
    }).join("\n");
  }

  function translateOcrLines() {
    if (!ocrLines.length) { window.frToast("先识别图片", true); return; }
    var to = els.imgTo.value;
    var serviceId = els.imgService.value;
    var found = window.frFindService(serviceId);
    els.ocrStatus.textContent = "翻译中…";
    els.ocrSummary.textContent = "翻译中…";
    els.ocrSummary.className = "badge";
    els.ocrRows.innerHTML = '<tr><td colspan="3" class="tiny">翻译中…</td></tr>';
    translateLines(ocrLines, to, serviceId).then(function (translations) {
      ocrLines.forEach(function (line, i) { line.trans = translations[i] || ""; });
      renderOcrRows();
      els.ocrStatus.textContent = "完成";
      els.ocrSummary.textContent = ocrLines.length + " 行 · " + (found ? found.label : serviceId);
      els.ocrSummary.className = "badge badge-ok";
    });
  }

  els.ocrGo.addEventListener("click", function () {
    if (!currentImage) { window.frToast("请先加载图片", true); return; }
    var lang = els.ocrLang.value;
    els.ocrGo.disabled = true;
    els.ocrStatus.textContent = "准备引擎…";
    recognizeLines(currentImage, lang).then(function (lines) {
      ocrLines = lines;
      renderOcrRows();
      els.ocrSummary.textContent = lines.length ? lines.length + " 行 · " + lang : "无文字";
      els.ocrSummary.className = "badge " + (lines.length ? "badge-ok" : "");
      els.ocrStatus.textContent = lines.length ? "识别完成" : "未识别到文字";
      if (lines.length && els.ocrAuto.checked) translateOcrLines();
    }).catch(function (error) {
      els.ocrStatus.textContent = "识别失败";
      els.ocrSummary.textContent = "失败";
      els.ocrSummary.className = "badge badge-danger";
      window.frToast("识别失败：" + error.message, true);
    }).finally(function () {
      els.ocrGo.disabled = false;
    });
  });
  document.getElementById("ocr-retrans").addEventListener("click", translateOcrLines);

  /* ==================== 字幕翻译 ==================== */
  var cues = [];        // [{start, end, text, trans}]
  var subBaseName = "subtitle";
  var subCancelled = false;

  function parseTimeCode(raw) {
    var m = raw.trim().replace(",", ".").match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
    if (!m) return NaN;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
  }
  function formatTimeCode(seconds) {
    var total = Math.max(0, seconds);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = Math.floor(total % 60);
    var ms = Math.round((total - Math.floor(total)) * 1000);
    var pad = function (n, width) { return String(n).padStart(width || 2, "0"); };
    return pad(h) + ":" + pad(m) + ":" + pad(s) + "," + pad(ms, 3);
  }

  function parseSubtitle(raw) {
    var blocks = raw.replace(/\r\n?/g, "\n").split(/\n{2,}/);
    var parsed = [];
    var timeRe = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/;
    blocks.forEach(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.trim(); });
      if (!lines.length) return;
      if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0]) && lines.length === 1) return;
      var timeIndex = -1;
      for (var i = 0; i < lines.length; i++) {
        if (timeRe.test(lines[i])) { timeIndex = i; break; }
      }
      if (timeIndex < 0) return;
      var match = lines[timeIndex].match(timeRe);
      var start = parseTimeCode(match[1]);
      var end = parseTimeCode(match[2]);
      if (isNaN(start) || isNaN(end)) return;
      var text = lines.slice(timeIndex + 1).join(" ").trim();
      if (!text) return;
      parsed.push({ start: start, end: end, text: text, trans: "" });
    });
    return parsed;
  }

  function renderSubRows() {
    els.subRows.innerHTML = cues.map(function (cue, index) {
      return "<tr>" +
        '<td class="small mono">' + (index + 1) + "</td>" +
        '<td class="tiny mono">' + window.frEscape(formatTimeCode(cue.start)) + "<br>" + window.frEscape(formatTimeCode(cue.end)) + "</td>" +
        '<td class="small">' + window.frEscape(cue.text) + "</td>" +
        '<td class="small" contenteditable="true" data-sub-i="' + index + '" spellcheck="false">' + window.frEscape(cue.trans || "") + "</td>" +
        "</tr>";
    }).join("");
  }

  els.subRows.addEventListener("input", function (e) {
    var cell = e.target.closest("[data-sub-i]");
    if (!cell) return;
    var index = Number(cell.dataset.subI);
    if (cues[index]) cues[index].trans = cell.textContent.trim();
  });

  function loadSubtitleText(raw, baseName) {
    var parsed = parseSubtitle(raw);
    if (!parsed.length) {
      window.frToast("没有解析出字幕条目，请确认是 SRT 或 VTT 内容", true);
      return;
    }
    cues = parsed;
    subBaseName = baseName || "subtitle";
    els.subCard.hidden = false;
    els.subName.textContent = subBaseName + ".srt";
    els.subMeta.textContent = parsed.length + " 条";
    els.subState.textContent = "待翻译";
    els.subState.className = "badge";
    els.subStatus.textContent = "";
    els.subProgress.hidden = true;
    renderSubRows();
    window.frToast("已解析 " + parsed.length + " 条字幕");
  }

  els.subParse.addEventListener("click", function () {
    var raw = els.subPaste.value.trim();
    if (!raw) { window.frToast("请先粘贴字幕内容", true); return; }
    loadSubtitleText(raw, "pasted-subtitle");
  });

  function loadSubtitle(file) {
    file.text().then(function (raw) {
      loadSubtitleText(raw, file.name.replace(/\.(srt|vtt)$/i, ""));
    }).catch(function (error) {
      window.frToast("读取文件失败：" + error.message, true);
    });
  }

  els.subDrop.addEventListener("click", function () { els.subFile.click(); });
  els.subDrop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.subFile.click(); }
  });
  els.subFile.addEventListener("change", function () {
    if (els.subFile.files && els.subFile.files[0]) loadSubtitle(els.subFile.files[0]);
    els.subFile.value = "";
  });
  ["dragover", "dragenter"].forEach(function (type) {
    els.subDrop.addEventListener(type, function (e) { e.preventDefault(); });
  });
  els.subDrop.addEventListener("drop", function (e) {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadSubtitle(e.dataTransfer.files[0]);
  });

  function translateSubtitleCue(cue, to, serviceId) {
    return window.frTranslateSmart(cue.text, "auto", to, serviceId).then(function (r) {
      return r.ok ? r.text : "（失败：" + r.error + "）";
    });
  }

  els.subGo.addEventListener("click", function () {
    if (!cues.length) { window.frToast("请先上传字幕文件", true); return; }
    var to = els.subLang.value;
    var serviceId = els.subService.value;
    var found = window.frFindService(serviceId);
    var BATCH = 8;
    subCancelled = false;
    els.subGo.disabled = true;
    els.subCancel.hidden = false;
    els.subProgress.hidden = false;
    els.subState.textContent = "翻译中";
    els.subState.className = "badge";

    var done = 0;
    function updateProgress() {
      var percent = Math.round((done / cues.length) * 100);
      els.subProgress.querySelector("i").style.width = percent + "%";
      els.subStatus.textContent = done + " / " + cues.length + " 条";
    }
    updateProgress();

    var chain = Promise.resolve();
    for (var start = 0; start < cues.length; start += BATCH) {
      (function (from) {
        chain = chain.then(function () {
          if (subCancelled) return null;
          var batch = cues.slice(from, from + BATCH);
          var joined = batch.map(function (cue) { return cue.text; }).join("\n");
          return window.frTranslateSmart(joined, "auto", to, serviceId).then(function (result) {
            var translations = null;
            if (result.ok) {
              var parts = result.text.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
              if (parts.length === batch.length) translations = parts;
            }
            var inner = Promise.resolve();
            batch.forEach(function (cue, i) {
              var at = from + i;
              inner = inner.then(function () {
                if (translations) {
                  cues[at].trans = translations[i];
                  return null;
                }
                return translateSubtitleCue(cue, to, serviceId).then(function (text) {
                  cues[at].trans = text;
                });
              });
            });
            return inner.then(function () {
              done += batch.length;
              updateProgress();
              renderSubRows();
            });
          });
        });
      })(start);
    }
    chain.then(function () {
      els.subGo.disabled = false;
      els.subCancel.hidden = true;
      els.subProgress.hidden = true;
      if (subCancelled) {
        els.subState.textContent = "已停止（部分完成）";
        els.subState.className = "badge badge-warn";
        els.subStatus.textContent = done + " / " + cues.length + " 条已翻译";
      } else {
        els.subState.textContent = "已翻译 · " + (found ? found.label : serviceId);
        els.subState.className = "badge badge-ok";
        els.subStatus.textContent = "完成";
        window.frToast("字幕翻译完成");
      }
      renderSubRows();
    });
  });
  els.subCancel.addEventListener("click", function () {
    subCancelled = true;
    els.subCancel.disabled = true;
    els.subStatus.textContent = "正在停止…";
    setTimeout(function () { els.subCancel.disabled = false; }, 1000);
  });

  function downloadSubtitle(bilingual) {
    if (!cues.length) { window.frToast("没有可导出的字幕", true); return; }
    var content = cues.map(function (cue, index) {
      return (index + 1) + "\n" + formatTimeCode(cue.start) + " --> " + formatTimeCode(cue.end) + "\n" +
        (bilingual ? (cue.trans || "（未翻译）") + "\n" + cue.text + "\n" : (cue.trans || cue.text) + "\n");
    }).join("\n");
    var blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = subBaseName + (bilingual ? ".bilingual.srt" : ".translated.srt");
    link.click();
    URL.revokeObjectURL(link.href);
    window.frToast("已导出 " + (bilingual ? "双语" : "译文") + " SRT");
  }
  els.subExport.addEventListener("click", function () { downloadSubtitle(false); });
  els.subExportDual.addEventListener("click", function () { downloadSubtitle(true); });

  /* ==================== 圈选截图 ==================== */
  var displayStream = null;

  function stopSharing() {
    if (displayStream) {
      displayStream.getTracks().forEach(function (track) { track.stop(); });
      displayStream = null;
    }
    els.areaVideo.srcObject = null;
    els.areaVideo.style.display = "none";
    els.areaPlaceholder.style.display = "";
    els.areaSel.style.display = "none";
    els.areaStop.hidden = true;
    els.areaGo.disabled = false;
    els.areaStatus.textContent = "未共享";
    els.areaStatus.className = "badge";
  }

  els.areaGo.addEventListener("click", function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      window.frToast("当前浏览器不支持屏幕共享（getDisplayMedia）", true);
      return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false }).then(function (stream) {
      displayStream = stream;
      stream.getVideoTracks()[0].addEventListener("ended", stopSharing);
      els.areaVideo.srcObject = stream;
      els.areaVideo.style.display = "";
      els.areaPlaceholder.style.display = "none";
      els.areaStop.hidden = false;
      els.areaGo.disabled = true;
      els.areaStatus.textContent = "共享中 · 拖出矩形识别";
      els.areaStatus.className = "badge badge-ok";
    }).catch(function (error) {
      if (error && error.name !== "NotAllowedError") window.frToast("共享失败：" + error.message, true);
    });
  });
  els.areaStop.addEventListener("click", stopSharing);

  var selection = null; // {x0, y0}
  function stagePoint(event) {
    var rect = els.areaStage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function drawSelection(point) {
    if (!selection) return;
    var x = Math.min(selection.x0, point.x);
    var y = Math.min(selection.y0, point.y);
    var w = Math.abs(point.x - selection.x0);
    var h = Math.abs(point.y - selection.y0);
    els.areaSel.style.left = x + "px";
    els.areaSel.style.top = y + "px";
    els.areaSel.style.width = w + "px";
    els.areaSel.style.height = h + "px";
    return { x: x, y: y, w: w, h: h };
  }

  els.areaStage.addEventListener("pointerdown", function (e) {
    if (!displayStream) return;
    e.preventDefault();
    els.areaStage.setPointerCapture(e.pointerId);
    selection = stagePoint(e);
    els.areaSel.style.display = "";
    drawSelection(selection);
  });
  els.areaStage.addEventListener("pointermove", function (e) {
    if (!selection) return;
    drawSelection(stagePoint(e));
  });
  els.areaStage.addEventListener("pointerup", function (e) {
    if (!selection) return;
    var rect = drawSelection(stagePoint(e));
    selection = null;
    if (!rect || rect.w < 8 || rect.h < 8) {
      els.areaSel.style.display = "none";
      return;
    }
    captureRegion(rect);
  });

  function captureRegion(rect) {
    var video = els.areaVideo;
    if (!video.videoWidth) return;
    var offsetX = video.offsetLeft - els.areaStage.clientLeft;
    var offsetY = video.offsetTop - els.areaStage.clientTop;
    var scale = video.videoWidth / video.clientWidth;
    var sx = (rect.x - offsetX) * scale;
    var sy = (rect.y - offsetY) * scale;
    var sw = rect.w * scale;
    var sh = rect.h * scale;
    if (sx < 0) { sw += sx; sx = 0; }
    if (sy < 0) { sh += sy; sy = 0; }
    sw = Math.min(sw, video.videoWidth - sx);
    sh = Math.min(sh, video.videoHeight - sy);
    if (sw <= 2 || sh <= 2) return;
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    var lang = els.areaLang.value;
    els.areaStatus.textContent = "识别中…";
    els.areaStatus.className = "badge";
    els.areaRows.innerHTML = '<tr><td colspan="3" class="tiny">识别中…</td></tr>';
    recognizeLines(canvas, lang).then(function (lines) {
      if (!lines.length) {
        els.areaRows.innerHTML = '<tr><td colspan="3" class="tiny">该区域没有识别到文字。</td></tr>';
        els.areaResultMeta.textContent = "无文字";
        els.areaResultMeta.className = "badge";
        els.areaStatus.textContent = "共享中";
        els.areaStatus.className = "badge badge-ok";
        return null;
      }
      els.areaResultMeta.textContent = lines.length + " 行";
      els.areaResultMeta.className = "badge badge-ok";
      els.areaRows.innerHTML = lines.map(function (line) {
        return "<tr><td class=\"small mono\">" + window.frEscape(line.text) + "</td><td class=\"small\">…</td><td>" + confidenceBadge(line.confidence) + "</td></tr>";
      }).join("");
      els.areaStatus.textContent = "翻译中…";
      return translateLines(lines, els.areaTo.value, els.areaService.value).then(function (translations) {
        var merged = lines.map(function (line, i) {
          return { text: line.text, confidence: line.confidence, trans: translations[i] || "" };
        });
        els.areaRows.innerHTML = merged.map(function (line) {
          return "<tr><td class=\"small mono\">" + window.frEscape(line.text) + "</td>" +
            "<td class=\"small\">" + window.frEscape(line.trans) + "</td>" +
            "<td>" + confidenceBadge(line.confidence) + "</td></tr>";
        }).join("");
        els.areaText.textContent = merged.map(function (line) {
          return line.text + (line.trans ? " — " + line.trans : "");
        }).join("\n");
        els.areaResultMeta.textContent = merged.length + " 行 · 已翻译";
        els.areaStatus.textContent = "共享中";
        els.areaStatus.className = "badge badge-ok";
      });
    }).catch(function (error) {
      els.areaStatus.textContent = "识别失败";
      els.areaStatus.className = "badge badge-danger";
      window.frToast("识别失败：" + error.message, true);
    });
  }

  /* ==================== 离开页面时清理 ==================== */
  window.addEventListener("beforeunload", function () {
    stopSharing();
    if (ocrWorker) ocrWorker.terminate();
  });
})();
