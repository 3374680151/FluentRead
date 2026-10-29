/* FluentRead Web 全站词卡浮层（真实版）
   职责：在任意页面点击/选中单词或表达后，弹出词典词卡：调用 GET /api/word（ECDICT 本地词典
   优先、机器翻译兜底），展示音标、词性、释义与首选译文，提供朗读、收藏（由宿主页面注入
   保存回调）、复制与关闭；Esc / 点击外部关闭，键盘可达，位置自动避让视口边缘。
   边界：只做查词请求与浮层渲染；词书存储、句子翻译由宿主页面通过 onSaved / getSaved 注入。 */

const POS_LABELS = { n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.', conj: 'conj.', pron: 'pron.', art: 'art.', num: 'num.', int: 'int.' };

function frEscape(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/** 创建词卡浮层实例；一个页面复用一个实例（重复打开只更新内容与位置）。 */
export function createWordPopup(options) {
  var opts = Object.assign({ onSave: null, getSaved: null, targetLang: "zh-Hans" }, options || {});
  var root = null;
  var currentRequest = 0;

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.className = "fr-wpopup";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "词典词卡");
    root.hidden = true;
    document.body.appendChild(root);
    document.addEventListener("pointerdown", function (e) {
      if (root && !root.hidden && !e.target.closest(".fr-wpopup") && !e.target.closest("[data-fr-word]")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root && !root.hidden) close();
    });
    return root;
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    currentRequest += 1; // 使未完成的查询作废
  }

  function place(anchorRect) {
    if (!root) return;
    var margin = 10;
    var width = root.offsetWidth || 320;
    var height = root.offsetHeight || 200;
    var left = anchorRect.right + margin;
    var top = anchorRect.top - 8;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, anchorRect.left - width - margin);
    }
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - height - margin);
    }
    root.style.left = left + "px";
    root.style.top = top + "px";
  }

  function speak(text, lang) {
    if (!("speechSynthesis" in window)) { window.frToast("当前浏览器不支持朗读", true); return; }
    speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "en" ? "en-US" : lang === "ja" ? "ja-JP" : lang === "ko" ? "ko-KR" : "en-US";
    speechSynthesis.speak(utterance);
  }

  function renderLoading(term, anchorRect) {
    var el = ensureRoot();
    el.innerHTML = '<div class="fr-wpopup-h"><span class="fr-wpopup-word">' + frEscape(term) +
      '</span><span class="skeleton" style="height:14px;width:84px"></span></div>' +
      '<div class="fr-wpopup-senses"><div class="skeleton" style="height:14px;width:92%"></div>' +
      '<div class="skeleton" style="height:14px;width:78%"></div></div>';
    el.hidden = false;
    place(anchorRect);
    el.querySelector(".fr-wpopup-word").focus();
  }

  function renderError(message, term, anchorRect, request) {
    if (request !== currentRequest) return;
    var el = ensureRoot();
    el.innerHTML = '<div class="fr-wpopup-h"><span class="fr-wpopup-word">' + frEscape(term) + "</span></div>" +
      '<p class="small" style="color:var(--danger);margin:0 0 10px">查询失败：' + frEscape(message) + "</p>" +
      '<div class="fr-wpopup-actions"><button type="button" class="btn btn-outline btn-sm" data-retry>重试</button></div>';
    el.hidden = false;
    place(anchorRect);
    el.querySelector("[data-retry]").addEventListener("click", function () { open(lastOpen); });
  }

  function renderBody(data, ctx, anchorRect, request) {
    if (request !== currentRequest) return;
    var el = ensureRoot();
    var sensesHtml = "";
    if (data.found && data.senses && data.senses.length) {
      sensesHtml = '<ul class="sense">' + data.senses.map(function (s) {
        var pos = s.pos ? '<span class="pos">' + frEscape(s.pos) + "</span>" : "";
        var zh = s.zh ? frEscape(s.zh) : "";
        var en = s.en ? '<span class="tiny" style="display:block">' + frEscape(s.en) + "</span>" : "";
        return "<li>" + pos + "<span>" + zh + en + "</span></li>";
      }).join("") + "</ul>";
    } else {
      sensesHtml = '<p class="small" style="margin:0 0 4px">' + frEscape(data.translation || "（无释义）") + "</p>";
    }
    var sourceBadge = data.found
      ? '<span class="badge badge-primary">ECDICT 词典</span>'
      : '<span class="badge badge-warn">词典未收录 · 机器翻译</span>';
    var lemmaBadge = data.lemma ? '<span class="badge">原形 ' + frEscape(data.lemma) + "</span>" : "";
    var phon = data.phonetic ? '<span class="fr-wpopup-phon">' + frEscape(data.phonetic) + "</span>" : "";
    var pos = data.pos ? '<span class="badge badge-accent">' + frEscape(data.pos) + "</span>" : "";
    var savedLabel = ctx.saved ? "已收藏 ✓" : "收藏到单词本";
    el.innerHTML =
      '<div class="fr-wpopup-h">' +
        '<span class="fr-wpopup-word" tabindex="0">' + frEscape(data.term) + "</span>" + phon + pos +
        '<span style="flex:1"></span>' +
        '<button type="button" class="icon-btn" data-speak aria-label="朗读单词" title="朗读">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>' +
        '<button type="button" class="icon-btn" data-close aria-label="关闭词卡" title="关闭">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      "</div>" +
      sensesHtml +
      '<div class="fr-wpopup-source">' + sourceBadge + lemmaBadge +
        '<span class="tiny">' + data.ms + "ms</span></div>" +
      '<div class="fr-wpopup-actions">' +
        '<button type="button" class="btn ' + (ctx.saved ? "btn-soft" : "btn-primary") + ' btn-sm" data-save>' + savedLabel + "</button>" +
        '<button type="button" class="btn btn-outline btn-sm" data-copy>复制</button>' +
      "</div>";
    el.hidden = false;
    place(anchorRect);

    el.querySelector("[data-speak]").addEventListener("click", function () { speak(data.term, "en"); });
    el.querySelector("[data-close]").addEventListener("click", close);
    el.querySelector("[data-copy]").addEventListener("click", function () {
      var text = data.term + (data.phonetic ? " " + data.phonetic : "") + "\n" +
        (data.senses || []).map(function (s) { return (s.pos ? s.pos + " " : "") + (s.zh || s.en || ""); }).join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text.trim());
      window.frToast("已复制词条");
    });
    el.querySelector("[data-save]").addEventListener("click", function () {
      if (!opts.onSave) return;
      var button = el.querySelector("[data-save]");
      button.disabled = true;
      Promise.resolve(opts.onSave({
        term: data.term,
        translation: data.translation,
        phonetic: data.phonetic || "",
        partOfSpeech: data.pos || "",
        sentence: ctx.sentence || "",
        sentenceTranslation: ctx.sentenceTranslation || "",
      })).then(function (saved) {
        button.disabled = false;
        if (saved) {
          button.classList.remove("btn-primary");
          button.classList.add("btn-soft");
          button.textContent = "已收藏 ✓";
        }
      }).catch(function (error) {
        button.disabled = false;
        window.frToast("收藏失败：" + (error && error.message || error), true);
      });
    });
    el.querySelector(".fr-wpopup-word").focus();
  }

  var lastOpen = null;

  /**
   * 打开词卡。payload：
   *   term（单词或选中文本）、from（源语言）、anchor（DOM 元素或 DOMRect）、
   *   sentence（所在原句，作为收藏语境）、sentenceTranslation（所在句译文）、saved（是否已收藏）。
   */
  function open(payload) {
    lastOpen = payload;
    var anchorRect = payload.anchor.getBoundingClientRect
      ? payload.anchor.getBoundingClientRect()
      : payload.anchor;
    var request = ++currentRequest;
    renderLoading(payload.term, anchorRect);
    var query = new URLSearchParams({ term: payload.term, from: payload.from || "auto", to: opts.targetLang });
    fetch("/api/word?" + query.toString())
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        if (!res.ok || res.body.error) throw new Error((res.body && res.body.error) || "查询失败");
        var saved = false;
        if (opts.getSaved) {
          try { saved = Boolean(opts.getSaved(payload)); } catch (e) { saved = false; }
        }
        renderBody(res.body, {
          sentence: payload.sentence || "",
          sentenceTranslation: payload.sentenceTranslation || "",
          saved: saved,
        }, anchorRect, request);
      })
      .catch(function (error) {
        renderError(error && error.message || String(error), payload.term, anchorRect, request);
      });
  }

  return { open: open, close: close, get isOpen() { return Boolean(root && !root.hidden); } };
}

/** 把句子拆分为可点击的单词与普通分隔符；CJK 字符不产生词按钮（点整句出句子卡）。 */
export function tokenizeSentence(text) {
  var tokens = [];
  var pattern = /([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’\-]*)/gu;
  var lastIndex = 0;
  var match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: "text", text: text.slice(lastIndex, match.index) });
    tokens.push({ type: "word", text: match[1] });
    lastIndex = match.index + match[1].length;
  }
  if (lastIndex < text.length) tokens.push({ type: "text", text: text.slice(lastIndex) });
  return tokens;
}
