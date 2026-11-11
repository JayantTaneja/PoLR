// Small, dependency-free helpers for SVG charts, tables, controls and the shared tooltip.
// Colors are CSS custom properties (see style.css), so light/dark switch without a redraw.

const SVGNS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  if (parent) parent.appendChild(el);
  return el;
}

export function html(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- number formatting ----------
export const MINUS = '−';
export const fmt = (v, d = 1) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d);
export const fmtSigned = (v, d = 1) => (v > 0 ? '+' : v < 0 ? MINUS : '±') + Math.abs(v).toFixed(d);
export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- scales ----------
export function linear(d0, d1, r0, r1) {
  const f = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  f.invert = (p) => d0 + ((p - r0) / (r1 - r0)) * (d1 - d0);
  return f;
}
export function log2(d0, d1, r0, r1) {
  const a = Math.log2(d0), b = Math.log2(d1);
  const f = (v) => r0 + ((Math.log2(v) - a) / (b - a)) * (r1 - r0);
  f.invert = (p) => 2 ** (a + ((p - r0) / (r1 - r0)) * (b - a));
  return f;
}
export function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * mag;
}
export function niceDomain(min, max, count = 5) {
  const step = niceStep(max - min, count);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step, step];
}
export function range(a, b, step) {
  const out = [];
  for (let v = a; v <= b + step / 1e6; v += step) out.push(round(v, 6));
  return out;
}

// ---------- responsive drawing ----------
export function responsive(container, draw) {
  let width = 0;
  const run = () => {
    const w = Math.round(container.clientWidth);
    if (w && w !== width) { width = w; draw(w); }
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(run).observe(container);
  else window.addEventListener('resize', run);
  run(); // draw now; don't wait for the first observer callback (it never fires in background tabs)
  return { redraw: () => { width = 0; run(); } };
}

// ---------- tooltip (values lead, labels follow) ----------
const tipEl = () => document.getElementById('viz-tooltip');
let tipOwner = null;
export const tooltip = {
  show(owner, x, y, { title, rows = [] }) {
    const el = tipEl();
    if (!el) return;
    tipOwner = owner;
    el.replaceChildren();
    if (title) el.append(html('div', { class: 'tt-title', text: title }));
    for (const r of rows) {
      const row = html('div', { class: 'tt-row' });
      if (r.color) {
        const key = html('span', { class: 'tt-key' });
        key.style.background = r.color;
        row.append(key);
      }
      row.append(html('span', { class: 'tt-val', text: r.value }));
      if (r.name) row.append(html('span', { class: 'tt-name', text: r.name }));
      el.append(row);
    }
    el.hidden = false;
    const pad = 12;
    const { width, height } = el.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + width > window.innerWidth - pad) left = x - width - 14;
    if (top + height > window.innerHeight - pad) top = y - height - 14;
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
  },
  hide(owner) {
    if (owner && owner !== tipOwner) return;
    const el = tipEl();
    if (el) el.hidden = true;
    tipOwner = null;
  },
};

// Hover + keyboard focus both open the tooltip for a mark group.
export function hoverable(el, content) {
  el.setAttribute('tabindex', '0');
  el.addEventListener('pointermove', (e) => tooltip.show(el, e.clientX, e.clientY, content()));
  el.addEventListener('pointerleave', () => tooltip.hide(el));
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    tooltip.show(el, r.left + r.width / 2, r.top + r.height / 2, content());
  });
  el.addEventListener('blur', () => tooltip.hide(el));
}
window.addEventListener('scroll', () => tooltip.hide(), { passive: true });

// ---------- axes ----------
export function yAxis(g, y, ticks, x0, x1, format = (v) => String(v)) {
  const grid = svg('g', { class: 'grid' }, g);
  for (const t of ticks) {
    const py = Math.round(y(t)) + 0.5;
    svg('line', { x1: x0, x2: x1, y1: py, y2: py }, grid);
    svg('text', { class: 'tick', x: x0 - 8, y: py, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: format(t) }, g);
  }
}
export function xAxis(g, x, ticks, y0, yTop, format = (v) => String(v), { grid = false, extent } = {}) {
  const gg = svg('g', { class: 'grid' }, g);
  for (const t of ticks) {
    const px = Math.round(x(t)) + 0.5;
    if (grid) svg('line', { x1: px, x2: px, y1: yTop, y2: y0 }, gg);
    svg('text', { class: 'tick', x: px, y: y0 + 18, 'text-anchor': 'middle', text: format(t) }, g);
  }
  const [a, b] = extent || [x(ticks[0]), x(ticks[ticks.length - 1])];
  svg('line', { class: 'axis-line', x1: a - 0.5, x2: b + 0.5, y1: Math.round(y0) + 0.5, y2: Math.round(y0) + 0.5 }, g);
}

// ---------- legend ----------
// items: [{label, color, kind: 'line'|'dot'|'ring'}]
export function legend(items) {
  const ul = html('ul', { class: 'legend' });
  for (const it of items) {
    const s = svg('svg', { width: it.kind === 'line' ? 18 : 12, height: 12, 'aria-hidden': 'true' });
    if (it.kind === 'line') svg('line', { x1: 1, x2: 17, y1: 6, y2: 6, style: `stroke:${it.color};stroke-width:2;stroke-linecap:round` }, s);
    else if (it.kind === 'ring') svg('circle', { cx: 6, cy: 6, r: 4.5, style: `fill:var(--chart-surface);stroke:${it.color};stroke-width:2` }, s);
    else if (it.kind === 'block') svg('rect', { x: 0, y: 0, width: 12, height: 12, rx: 3, style: `fill:${it.color}` }, s);
    else svg('circle', { cx: 6, cy: 6, r: 5, style: `fill:${it.color}` }, s);
    ul.append(html('li', {}, [s, it.label]));
  }
  return ul;
}

// ---------- controls ----------
// Segmented button group. options: [{value, label, sub}]
export function segmented(label, options, current, onChange) {
  const wrap = html('div', { class: 'control' });
  const id = `seg-${Math.random().toString(36).slice(2, 8)}`;
  wrap.append(html('span', { class: 'control-label', id, text: label }));
  const group = html('div', { class: 'segmented', role: 'group', 'aria-labelledby': id });
  for (const o of options) {
    const b = html('button', { type: 'button', 'aria-pressed': String(o.value === current) }, [o.label, o.sub ? html('span', { class: 'sub', text: o.sub }) : null]);
    b.addEventListener('click', () => {
      for (const other of group.children) other.setAttribute('aria-pressed', String(other === b));
      onChange(o.value);
    });
    group.append(b);
  }
  wrap.append(group);
  return wrap;
}
