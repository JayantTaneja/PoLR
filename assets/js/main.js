import { renderPaperSections } from './sections.js';
import { initTeaser } from './teaser.js';
import { initPrefixTree } from './prefixtree.js';
import { initPlayground } from './playground.js';
import { html, segmented } from './charts.js';

function initThemeToggle() {
  const btn = document.querySelector('.theme-toggle');
  if (!btn) return;
  const root = document.documentElement;
  const isDark = () => root.dataset.theme === 'dark'
    || (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const sync = () => btn.setAttribute('aria-pressed', String(isDark()));
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('polr-theme', next); } catch (e) { /* storage unavailable */ }
    sync();
  });
  sync();
}

function initBibtexCopy() {
  const btn = document.getElementById('copy-bibtex');
  const code = document.getElementById('bibtex-code');
  if (!btn || !code) return;
  const label = btn.querySelector('span');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      label.textContent = 'Copied';
    } catch (e) {
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      label.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => { label.textContent = 'Copy'; }, 1800);
  });
}

function closeMenusOnOutsideClick() {
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('details.navbar-dropdown[open]')) {
      if (!d.contains(e.target)) d.removeAttribute('open');
    }
  });
}

const getJSON = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

// data-src holds one or more comma-separated trace files; with several, a "Model" switcher appears.
async function mountTraces(el, init) {
  if (!el?.dataset.src) return;
  const srcs = el.dataset.src.split(',').map((s) => s.trim()).filter(Boolean);
  let sets;
  try { sets = await Promise.all(srcs.map(getJSON)); } catch (e) { console.error('Could not load traces', e); return; }
  const body = document.createElement('div');
  const show = (i) => { body.replaceChildren(); init(body, sets[i]); };
  if (sets.length > 1) {
    // switch by question when every set comes from the same model, by model otherwise
    const sameModel = sets.every((q) => q.model === sets[0].model);
    el.append(html('div', { class: 'controls' }, [segmented(sameModel ? 'Question' : 'Model',
      sets.map((q, i) => ({ value: i, label: sameModel ? (q.label ?? q.dataset) : q.model })), 0, show)]));
  }
  el.append(body);
  show(0);
}

async function init() {
  initThemeToggle();
  initBibtexCopy();
  closeMenusOnOutsideClick();
  initTeaser();
  mountTraces(document.getElementById('prefix-tree'), initPrefixTree);
  mountTraces(document.getElementById('playground'), initPlayground);
  try { renderPaperSections(await getJSON('assets/data/paper-tables.json')); } catch (e) { console.error('Could not load paper tables', e); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
