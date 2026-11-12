import { renderPaperSections } from './sections.js';
import { initTeaser } from './teaser.js';
import { initPrefixTree } from './prefixtree.js';
import { initPlayground } from './playground.js';
import { initPexp } from './pexp.js';
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

// Copy-link anchors: every section heading gets a small link icon (shown on hover or keyboard focus) that copies
// the section's URL, e.g. https://jayanttaneja.github.io/PoLR/#pexp, and puts the anchor in the address bar.
// Feedback is quiet: the icon turns into a check mark for a moment, and screen readers hear "Link copied".
function initHeadingLinks() {
  const LINK = '<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.5-1.5"/>';
  const CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
  const status = html('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  document.body.append(status);
  for (const h of document.querySelectorAll('section[id] h2.title, h3.title[id]')) {
    const id = h.id || h.closest('section[id]').id;
    const name = h.textContent.trim();
    const a = html('a', { class: 'heading-link', href: `#${id}`, title: 'Copy link to this section', 'aria-label': `Copy link to section: ${name}` });
    a.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${LINK}</svg>`;
    const icon = a.firstChild;
    let timer = 0;
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      history.replaceState(null, '', `#${id}`);
      let copied = false;
      try { await navigator.clipboard.writeText(location.href); copied = true; } catch (err) { /* clipboard blocked: the link is still in the address bar */ }
      status.textContent = copied ? 'Link copied' : 'Link is in the address bar';
      if (!copied) return;
      icon.innerHTML = CHECK;
      a.classList.add('is-copied');
      clearTimeout(timer);
      timer = setTimeout(() => { icon.innerHTML = LINK; a.classList.remove('is-copied'); status.textContent = ''; }, 1500);
    });
    h.append(a);
  }
}

// Display math: the LaTeX source sits in the element (.math-block) and KaTeX (loaded deferred from the CDN)
// renders it in place. If KaTeX is unavailable the source stays visible as plain text.
function renderMath() {
  if (!window.katex) return;
  for (const el of document.querySelectorAll('.math-block')) {
    const tex = el.textContent;
    el.setAttribute('aria-label', tex);
    window.katex.render(tex, el, { displayMode: true, throwOnError: false });
  }
}

async function init() {
  renderMath();
  initThemeToggle();
  initBibtexCopy();
  initHeadingLinks();
  closeMenusOnOutsideClick();
  initTeaser();
  mountTraces(document.getElementById('prefix-tree'), initPrefixTree);
  mountTraces(document.getElementById('playground'), initPlayground);
  initPexp(document.getElementById('pexp-figure'));
  try { renderPaperSections(await getJSON('assets/data/paper-tables.json')); } catch (e) { console.error('Could not load paper tables', e); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
