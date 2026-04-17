/* =========================================================
   AgriSim — lightweight i18n
   Supports English (en), Hindi (hi), Telugu (te).
   Strategy:
     • Walk all visible text nodes + translatable attributes.
     • Translate via free MyMemory API (no API key required).
     • Cache per-string in localStorage so subsequent loads are
       instant and offline-safe.
     • A floating language-switcher pill is auto-injected.
   ========================================================= */

(() => {
  const LANGS = [
    { code: 'en', label: 'EN',  name: 'English' },
    { code: 'hi', label: 'हिं', name: 'हिन्दी' },
    { code: 'te', label: 'తె',  name: 'తెలుగు' }
  ];

  const LANG_KEY  = 'agrisim_lang';
  const CACHE_KEY = 'agrisim_i18n_cache_v1';

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'SVG', 'CANVAS']);
  const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];

  // Strings like "25.4", "78%" — don't translate pure numbers/symbols.
  const NUMERIC_ONLY = /^[\s\d.,:;%°\-+/\\()\[\]<>!?&*@#$]+$/;

  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (_) { cache = {}; }

  // Store originals so we can restore English or re-translate.
  const nodeOriginals = new WeakMap();   // textNode -> original string
  const attrOriginals = new WeakMap();   // element  -> { attr: originalValue }

  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) {}
  }

  /* ---------- DOM collection ---------- */
  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
        if (NUMERIC_ONLY.test(v)) return NodeFilter.FILTER_REJECT;
        let p = n.parentElement;
        while (p) {
          if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.hasAttribute && p.hasAttribute('data-no-translate')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function collectAttrTargets(root) {
    const out = [];
    const all = root.querySelectorAll('[placeholder],[title],[alt],[aria-label]');
    all.forEach(el => {
      if (el.closest('[data-no-translate]')) return;
      if (SKIP_TAGS.has(el.tagName)) return;
      TRANSLATABLE_ATTRS.forEach(a => {
        const v = el.getAttribute(a);
        if (v && v.trim() && !NUMERIC_ONLY.test(v)) out.push({ el, attr: a });
      });
    });
    return out;
  }

  /* ---------- Translation (MyMemory free API) ---------- */
  async function translateOne(text, target) {
    if (target === 'en') return text;
    const trimmed = text.trim();
    if (!trimmed) return text;
    const key = target + '|' + trimmed;
    if (cache[key]) return text.replace(trimmed, cache[key]);

    try {
      const url = 'https://api.mymemory.translated.net/get?q=' +
                  encodeURIComponent(trimmed) +
                  '&langpair=en|' + target;
      const res = await fetch(url);
      const data = await res.json();
      let out = (data && data.responseData && data.responseData.translatedText) || trimmed;
      // Strip MyMemory quota warnings if any
      if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) out = trimmed;
      cache[key] = out;
      return text.replace(trimmed, out);
    } catch (e) {
      return text;
    }
  }

  async function runQueue(jobs, concurrency = 6, onProgress) {
    let done = 0;
    const total = jobs.length;
    const queue = jobs.slice();
    async function worker() {
      while (queue.length) {
        const job = queue.shift();
        try { await job(); } catch (_) {}
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  /* ---------- Apply a language ---------- */
  let currentLang = localStorage.getItem(LANG_KEY) || 'en';
  let busy = false;

  async function applyLanguage(lang) {
    if (busy) return;
    busy = true;
    setBadgeBusy(true);

    const textNodes = collectTextNodes(document.body);
    const attrTargets = collectAttrTargets(document.body);

    // Snapshot originals once.
    textNodes.forEach(n => { if (!nodeOriginals.has(n)) nodeOriginals.set(n, n.nodeValue); });
    attrTargets.forEach(({ el, attr }) => {
      if (!attrOriginals.has(el)) attrOriginals.set(el, {});
      const bag = attrOriginals.get(el);
      if (!(attr in bag)) bag[attr] = el.getAttribute(attr);
    });

    if (lang === 'en') {
      textNodes.forEach(n => {
        const orig = nodeOriginals.get(n);
        if (orig != null) n.nodeValue = orig;
      });
      attrTargets.forEach(({ el, attr }) => {
        const bag = attrOriginals.get(el) || {};
        if (bag[attr] != null) el.setAttribute(attr, bag[attr]);
      });
      currentLang = 'en';
      localStorage.setItem(LANG_KEY, 'en');
      document.documentElement.setAttribute('lang', 'en');
      busy = false;
      setBadgeBusy(false);
      updateSwitcher();
      return;
    }

    const jobs = [];
    textNodes.forEach(n => {
      jobs.push(async () => {
        const orig = nodeOriginals.get(n);
        n.nodeValue = await translateOne(orig, lang);
      });
    });
    attrTargets.forEach(({ el, attr }) => {
      jobs.push(async () => {
        const bag = attrOriginals.get(el) || {};
        const orig = bag[attr];
        if (orig == null) return;
        el.setAttribute(attr, await translateOne(orig, lang));
      });
    });

    await runQueue(jobs, 6, (d, t) => setBadgeProgress(d, t));
    saveCache();

    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.setAttribute('lang', lang);
    busy = false;
    setBadgeBusy(false);
    updateSwitcher();
  }

  /* ---------- UI: floating switcher pill ---------- */
  let switcherEl = null;
  let badgeEl = null;

  function injectStyles() {
    if (document.getElementById('i18n-styles')) return;
    const s = document.createElement('style');
    s.id = 'i18n-styles';
    s.textContent = `
      .i18n-switcher {
        position: fixed; right: 18px; bottom: 18px; z-index: 9999;
        display: flex; gap: 4px; padding: 6px;
        background: rgba(255,255,255,0.96); backdrop-filter: blur(10px);
        border: 1px solid rgba(0,0,0,0.08); border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        font-family: 'Inter', system-ui, sans-serif;
      }
      .i18n-switcher button {
        appearance: none; border: none; background: transparent; cursor: pointer;
        padding: 8px 14px; border-radius: 999px;
        font-size: 0.85rem; font-weight: 600; color: #4a4a4a;
        transition: background .2s, color .2s, transform .15s;
      }
      .i18n-switcher button:hover { background: rgba(200,138,58,0.12); }
      .i18n-switcher button.active {
        background: #2f6b3a; color: #fff;
      }
      .i18n-switcher button:disabled { opacity: 0.55; cursor: wait; }
      .i18n-badge {
        position: fixed; right: 18px; bottom: 68px; z-index: 9999;
        padding: 6px 12px; border-radius: 999px;
        background: rgba(47,107,58,0.95); color: #fff;
        font: 500 0.78rem 'Inter', system-ui, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.18);
        opacity: 0; transform: translateY(8px); transition: all .25s;
        pointer-events: none;
      }
      .i18n-badge.show { opacity: 1; transform: translateY(0); }
      @media (max-width: 640px) {
        .i18n-switcher { right: 10px; bottom: 10px; padding: 4px; }
        .i18n-switcher button { padding: 6px 10px; font-size: 0.8rem; }
      }
    `;
    document.head.appendChild(s);
  }

  function buildSwitcher() {
    injectStyles();
    switcherEl = document.createElement('div');
    switcherEl.className = 'i18n-switcher';
    switcherEl.setAttribute('data-no-translate', '');
    LANGS.forEach(l => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.lang = l.code;
      b.textContent = l.label;
      b.title = l.name;
      b.addEventListener('click', () => {
        if (currentLang === l.code || busy) return;
        applyLanguage(l.code);
      });
      switcherEl.appendChild(b);
    });
    document.body.appendChild(switcherEl);

    badgeEl = document.createElement('div');
    badgeEl.className = 'i18n-badge';
    badgeEl.setAttribute('data-no-translate', '');
    document.body.appendChild(badgeEl);

    updateSwitcher();
  }

  function updateSwitcher() {
    if (!switcherEl) return;
    switcherEl.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === currentLang);
    });
  }

  function setBadgeBusy(on) {
    if (!badgeEl) return;
    if (on) {
      badgeEl.textContent = 'Translating…';
      badgeEl.classList.add('show');
    } else {
      badgeEl.classList.remove('show');
    }
    if (switcherEl) {
      switcherEl.querySelectorAll('button').forEach(b => { b.disabled = on; });
    }
  }

  function setBadgeProgress(done, total) {
    if (!badgeEl || !total) return;
    badgeEl.textContent = `Translating… ${Math.round((done / total) * 100)}%`;
  }

  /* ---------- Init ---------- */
  function init() {
    buildSwitcher();
    if (currentLang && currentLang !== 'en') {
      // Defer so any late-rendered content (e.g. charts labels) is included
      setTimeout(() => applyLanguage(currentLang), 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual re-translation after dynamic DOM changes.
  window.AgriSimI18n = {
    setLanguage: applyLanguage,
    getLanguage: () => currentLang,
    retranslate: () => applyLanguage(currentLang)
  };
})();
