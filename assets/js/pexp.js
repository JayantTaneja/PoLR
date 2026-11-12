// "Counting path expansions (PExp)": a schematic of what the metric counts, not a result. The same 12 sampled
// traces under five inference strategies. Each trace ends up completed (counted), stopped after its prefix
// (PoLR's traces outside the dominant cluster), or never started (CoT, and AC after its stopping rule fires).
import { svg, html, legend, hoverable, responsive } from './charts.js';

const N = 12;
const CLUSTER = 5;                 // PoLR's dominant cluster: traces 1-5
// done: traces completed; prefix: every trace first gets a prefix (PoLR); seq: completed one at a time (AC)
const ROWS = [
  { label: 'CoT', done: 1, note: 'A single trace, run to completion.' },
  { label: 'Self-Consistency', done: 12, note: 'Every sampled trace runs to completion.' },
  { label: 'PoLR', done: CLUSTER, prefix: true, note: 'Every trace gets a short prefix; only the 5 traces in the dominant cluster are completed.' },
  { label: 'AC', done: 4, seq: true, note: 'Traces are sampled one at a time until the answers agree, here after 4; the rest are never started.' },
  { label: 'PoLR + AC', done: 3, prefix: true, seq: true, note: 'Every trace gets a prefix; AC then completes traces from the dominant cluster one at a time and stops after 3.' },
];

// animation timeline, in seconds
const PREFIX = [0, 0.45];          // prefixes grow
const AFTER_PREFIX = 0.6;          // completions start here in PoLR rows
const FULL = 1.0;                  // a parallel completion
const STEP = 0.42, EACH = 0.36;    // sequential completions (AC)

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => 1 - (1 - clamp01(v)) ** 3;

function timing(row, i) {
  const s0 = row.prefix ? AFTER_PREFIX : 0;
  if (i >= row.done) return null;
  return row.seq ? [s0 + i * STEP, s0 + i * STEP + EACH] : [s0, s0 + FULL];
}
const rowEnd = (row) => Math.max(...Array.from({ length: row.done }, (_, i) => timing(row, i)[1]));

export function initPexp(el) {
  if (!el) return;
  const replay = html('button', { type: 'button', class: 'text-button', text: 'Replay' });
  const chart = html('div', { class: 'chart', role: 'img',
    'aria-label': `Schematic of PExp with 12 sampled traces: ${ROWS.map((r) => `${r.label} completes ${r.done}`).join(', ')}.` });
  el.append(
    html('div', { class: 'pexp-toolbar' }, [
      legend([
        { label: 'Completed: counts toward PExp', color: 'var(--bar-done)', kind: 'block' },
        { label: 'Prefix', color: 'var(--s1)', kind: 'block' },
        { label: 'Never started', color: 'var(--ink-muted)', kind: 'ring' },
        { label: "PoLR's dominant cluster", color: 'var(--ink-muted)', kind: 'line' },
      ]),
      replay,
    ]),
    chart,
    html('p', { class: 'caption', text: 'Schematic with 12 sampled traces per question; the outcomes are illustrative. Hover a row for details.' }),
  );

  let cols = [], dots = [], counts = [], t = Infinity, raf = 0;

  function draw(width) {
    const narrow = width < 560;
    const labelW = narrow ? 0 : 130, countW = 52;
    const H = narrow ? 30 : 34, stubH = Math.round(H * 0.26);
    const rowH = narrow ? 70 : 58, top = 22;
    const SVGH = top + ROWS.length * rowH;
    // columns stay close together (12 slots of at most 36 px); the PExp count sits right after them
    const x0 = labelW + 14, slot = Math.min(36, (width - x0 - countW - 8) / N), x1 = x0 + slot * N;
    const colW = Math.min(18, slot * 0.56), xc = x1 + 8 + countW / 2;
    const root = svg('svg', { width, height: SVGH, viewBox: `0 0 ${width} ${SVGH}` });
    const g = svg('g', {}, root);
    svg('text', { class: 'tick', x: xc, y: 10, 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: 'PExp' }, g);
    cols = []; dots = []; counts = [];
    ROWS.forEach((row, r) => {
      const base = top + r * rowH + (narrow ? 20 : 6) + H;      // baseline of the columns
      const grp = svg('g', {}, g);
      svg('text', { class: row.prefix ? 'label-strong' : 'label', x: narrow ? 0 : labelW, y: narrow ? base - H - 9 : base - H / 2,
        'text-anchor': narrow ? 'start' : 'end', 'dominant-baseline': 'middle', text: row.label }, grp);
      svg('line', { x1: x0 - 4, x2: x1 + 4, y1: base + 0.5, y2: base + 0.5, style: 'stroke:var(--grid);stroke-width:1' }, grp);
      for (let i = 0; i < N; i++) {
        const cx = x0 + slot * (i + 0.5), left = cx - colW / 2;
        const c = { row, i, left, base, H, stubH, colW };
        if (row.prefix) c.stub = svg('rect', { x: left, width: colW, rx: 2.5, style: 'fill:var(--s1)' }, grp);
        if (i < row.done) c.full = svg('rect', { x: left, width: colW, rx: 2.5, style: 'fill:var(--bar-done)' }, grp);
        if (!row.prefix && i >= row.done) {
          const dot = svg('circle', { cx, cy: base - 4, r: 3, style: 'fill:none;stroke:var(--ink-muted);stroke-width:1.5;transition:opacity .3s ease' }, grp);
          dots.push({ dot, row });
        }
        cols.push(c);
      }
      if (row.prefix) {                                            // bracket under the dominant cluster
        const a = x0 + slot * 0.5 - colW / 2, b = x0 + slot * (CLUSTER - 0.5) + colW / 2, y = base + 6;
        svg('path', { d: `M${a} ${y - 3}V${y}H${b}V${y - 3}`, style: 'fill:none;stroke:var(--ink-muted);stroke-width:1.5' }, grp);
      }
      const count = svg('text', { class: 'label-strong', x: xc, y: base - H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', style: 'font-size:16px' }, grp);
      counts.push({ count, row });
      svg('rect', { class: 'hit', x: 0, y: base - H - (narrow ? 24 : 10), width, height: H + (narrow ? 34 : 22) }, grp);
      grp.setAttribute('aria-label', `${row.label}: PExp ${row.done} of ${N}. ${row.note}`);
      hoverable(grp, () => ({
        title: row.label,
        rows: [{ value: `${row.done} of ${N}`, name: 'traces completed (PExp)' }, { value: row.note }],
      }));
    });
    chart.replaceChildren(root);
    render(t);
  }

  // draw the state at time `time` (Infinity = final)
  function render(time) {
    for (const c of cols) {
      const { row, i, base, H, stubH } = c;
      const sh = row.prefix ? stubH * ease((time - PREFIX[0]) / (PREFIX[1] - PREFIX[0])) : 0;
      if (c.stub) { c.stub.setAttribute('y', base - sh); c.stub.setAttribute('height', Math.max(0, sh)); }
      if (c.full) {
        const [a, b] = timing(row, i);
        const from = row.prefix ? stubH + 1.5 : 0;               // PoLR rows continue above the prefix
        const h = (H - from) * ease((time - a) / (b - a));
        c.full.setAttribute('y', base - from - h);
        c.full.setAttribute('height', Math.max(0, h));
      }
    }
    for (const { dot, row } of dots) dot.style.opacity = time >= (row.done ? rowEnd(row) : 0) ? 1 : 0;
    for (const { count, row } of counts) {
      const k = Array.from({ length: row.done }, (_, i) => timing(row, i)[1]).filter((e) => e <= time).length;
      count.textContent = String(k);
    }
  }

  function play() {
    cancelAnimationFrame(raf);
    const start = performance.now(), end = Math.max(...ROWS.map(rowEnd)) + 0.2;
    const tick = (now) => {
      t = (now - start) / 1000;
      render(t);
      if (t < end) raf = requestAnimationFrame(tick);
      else { t = Infinity; render(t); }
    };
    raf = requestAnimationFrame(tick);
  }

  responsive(chart, draw);
  replay.addEventListener('click', play);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { replay.hidden = true; return; }
  t = 0; render(t);
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); play(); } }, { threshold: 0.4 });
  io.observe(chart);
}
