// Paper-number sections: results arrows (Table 2) and adaptive-methods bars (Tables 7-8).
import { svg, html, fmt, fmtSigned, round, linear, niceDomain, range, responsive, hoverable, yAxis, xAxis, legend, segmented } from './charts.js';

// Color follows the model. Phi-4, MiMo and DSQ1.5B never share a chart.
const MODEL_COLOR = {
  'DSQ7B': 'var(--s1)', 'QwQ-32B': 'var(--s2)', 'DSQ1.5B': 'var(--s3)', 'Phi-4-15B': 'var(--s3)', 'MiMo-RL-7B': 'var(--s3)',
};

export function renderPaperSections(D) {
  statStrip(document.getElementById('stat-strip'), D.table2);
  resultsChart(document.getElementById('results-chart'), D.table2);
  funnel(document.getElementById('funnel'), D.adaptive);
}

const whenVisible = (el, fn) => {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: 0.3 });
  io.observe(el);
};

// ---------------------------------------------------------------- Highlight strip (Table 2, N = 51)
// The tile values are written in index.html so they show without JS; here they are checked against the
// table and each tile gets a per-model tooltip.
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function statStrip(el, T) {
  if (!el) return;
  for (const tile of el.querySelectorAll('.stat[data-dataset]')) {
    const d = T.datasets.find((x) => x.id === tile.dataset.dataset);
    if (!d) continue;
    const rows = d.N['51'];
    const want = { eta: `${Math.round(median(rows.map((r) => r[2])))}%`, delta: fmtSigned(round(median(rows.map((r) => r[1])))) };
    for (const [k, v] of Object.entries(want)) {
      const got = tile.querySelector(`[data-stat="${k}"]`)?.textContent.trim();
      if (got !== v) console.warn(`Highlight tile ${d.name} ${k}: page says ${got}, Table 2 gives ${v}`);
    }
    tile.setAttribute('aria-label', `${d.name}: ${want.eta} fewer tokens, ${want.delta} points accuracy (median over ${rows.length} models)`);
    hoverable(tile, () => ({
      title: `${d.name}: fewer tokens · accuracy vs. SC`,
      rows: d.models.map((m, i) => ({
        value: `${fmt(rows[i][2])}% · ${fmtSigned(rows[i][1])} pts`, name: m, color: MODEL_COLOR[m],
      })),
    }));
  }
}

// ---------------------------------------------------------------- Results (Table 2, N = 51)
// metric names as they read mid-sentence: "exact match", "accuracy", but "Pass@1" keeps the paper's spelling
const metricName = (m) => (m === 'Pass@1' ? m : m.toLowerCase());
function resultsChart(el, T) {
  const N = '51';
  let ds = 0;
  const legendSlot = html('div');
  const chart = html('div', { class: 'chart', role: 'img' });
  const note = html('p', { class: 'chart-note' });
  el.append(
    html('div', { class: 'controls' }, [segmented('Benchmark', T.datasets.map((d, i) => ({ value: i, label: d.name, sub: `(${d.size.toLocaleString('en-US')})` })), ds, (v) => { ds = v; update(); })]),
    legendSlot, chart, note,
  );
  const yDomains = T.datasets.map((d) => {
    const vals = d.N[N].flatMap(([sc, dl]) => [sc, sc + dl]);
    return niceDomain(Math.min(...vals) - 2, Math.max(...vals) + 2, 5);
  });
  const ro = responsive(chart, draw);
  function update() {
    const d = T.datasets[ds];
    legendSlot.replaceChildren(legend([
      ...d.models.map((m) => ({ label: m, color: MODEL_COLOR[m], kind: 'line' })),
      { label: 'Self-Consistency', color: 'var(--ink-2)', kind: 'ring' },
      { label: 'PoLR', color: 'var(--ink-2)', kind: 'dot' },
    ]));
    const rows = d.N[N].map(([sc, dl, eta], i) => `${d.models[i]}: SC ${fmt(sc)}%, PoLR ${fmt(round(sc + dl))}%, ${fmt(eta)}% fewer tokens`);
    chart.setAttribute('aria-label', `${d.name}, N = 51. ${rows.join('. ')}.`);
    ro.redraw();
    // three lines: source (same for every benchmark), the benchmark itself, then the hover hint
    const metric = metricName(d.metric);
    note.replaceChildren(
      html('span', {}, ['From Table 2 of the paper (', html('var', {}, ['L', html('sub', { text: 'p' })]), ' = 256).']),
      html('span', { text: `${d.name}: ${d.size.toLocaleString('en-US')} problems, ${metric}.` }),
      html('span', { text: 'Hover for exact values.' }),
    );
  }
  function draw(width) {
    const d = T.datasets[ds];
    const [y0, y1, ystep] = yDomains[ds];
    const H = width < 520 ? 300 : 340;
    const m = { t: 14, r: 18, b: 46, l: 62 };
    const x = linear(30, 100, m.l, width - m.r);
    const y = linear(y0, y1, H - m.b, m.t);
    const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}` });
    const g = svg('g', {}, root);
    yAxis(g, y, range(y0, y1, ystep), m.l, width - m.r, (v) => fmt(v, ystep < 1 ? 1 : 0));
    xAxis(g, x, width < 520 ? [30, 50, 70, 100] : range(30, 100, 10), H - m.b, m.t, (v) => `${v}%`);
    svg('text', { class: 'axis-title', x: (m.l + width - m.r) / 2, y: H - 6, 'text-anchor': 'middle', text: 'Tokens generated (% of Self-Consistency)' }, g);
    svg('text', { class: 'axis-title', transform: `translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`, 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: d.metric === 'Accuracy' ? 'Accuracy (%)' : `Accuracy (${metricName(d.metric)}, %)` }, g);
    d.N[N].forEach(([sc, dl, eta, kt], i) => {
      const model = d.models[i], color = MODEL_COLOR[model], polr = round(sc + dl);
      const ax = x(100), ay = y(sc), bx = x(100 - eta), by = y(polr);
      const grp = svg('g', { 'aria-label': `${model}: SC ${fmt(sc)}%, PoLR ${fmt(polr)}%, ${fmt(eta)}% fewer tokens` }, g);
      svg('line', { x1: ax, y1: ay, x2: bx, y2: by, style: `stroke:${color};stroke-width:2;stroke-linecap:round` }, grp);
      svg('circle', { cx: ax, cy: ay, r: 5, style: `fill:var(--chart-surface);stroke:${color};stroke-width:2` }, grp);
      svg('circle', { cx: bx, cy: by, r: 7, style: 'fill:var(--chart-surface)' }, grp);
      svg('circle', { class: 'focus-ring', cx: bx, cy: by, r: 5, style: `fill:${color}` }, grp);
      const nearLeft = bx - m.l < 80;
      svg('text', { class: 'label', x: nearLeft ? bx + 9 : bx - 10, y: nearLeft ? by - 11 : by, 'text-anchor': nearLeft ? 'start' : 'end', 'dominant-baseline': 'middle', text: model }, grp);
      svg('line', { class: 'hit', x1: ax, y1: ay, x2: bx, y2: by, 'stroke-width': 18 }, grp);
      svg('circle', { class: 'hit', cx: ax, cy: ay, r: 14 }, grp);
      svg('circle', { class: 'hit', cx: bx, cy: by, r: 14 }, grp);
      hoverable(grp, () => ({
        title: `${model} · ${d.name}, N = 51`,
        rows: [
          { value: `${fmt(sc)}%`, name: 'Self-Consistency' },
          { value: `${fmt(polr)}% (${fmtSigned(dl)})`, name: 'PoLR', color },
          { value: `${fmt(eta)}%`, name: 'fewer tokens' },
          { value: `${fmt(kt)} ms`, name: 'clustering overhead' },
        ],
      }));
    });
    chart.replaceChildren(root);
  }
  update();
}

// ---------------------------------------------------------------- Adaptive methods (Tables 7-8, N = 51)
// Each row is one bar of a question's 51 sampled traces, split by what happened to them: completed (neutral,
// read from zero), dropped by PoLR because they fall outside the dominant cluster (blue), or never finished
// because AC / ESC stopped early (orange / green). The combined rows carry the PoLR row's blue block, so the
// two savings visibly stack.
const PART = { done: 'var(--bar-done)', PoLR: 'var(--s1)', AC: 'var(--s2)', ESC: 'var(--s3)' };

function funnel(el, A) {
  const names = Object.keys(A.datasets);
  const state = { ds: 'GPQA-Diamond', model: 'QwQ-32B', grown: false };
  const idx = Object.fromEntries(A.methods.map((m, i) => [m, i]));
  // polr: PoLR filters first; stop: the adaptive method in the row; group: blocks of rows with extra spacing
  const ROWS = [
    { label: 'Self-Consistency', key: 'SC', group: 0 },
    { label: 'PoLR', key: 'PoLR', polr: true, group: 0 },
    { label: 'AC', key: 'AC', stop: 'AC', group: 1 },
    { label: 'PoLR + AC', key: 'PoLR+AC', polr: true, stop: 'AC', group: 1 },
    { label: 'ESC', key: 'ESC', stop: 'ESC', group: 2 },
    { label: 'PoLR + ESC', key: 'PoLR+ESC', polr: true, stop: 'ESC', group: 2 },
  ];
  const controls = html('div', { class: 'controls' });
  const chart = html('div', { class: 'chart', role: 'img' });
  el.append(controls,
    legend([
      { label: 'Completed', color: PART.done, kind: 'block' },
      { label: 'Dropped by PoLR (outside the dominant cluster)', color: PART.PoLR, kind: 'block' },
      { label: 'Skipped by AC', color: PART.AC, kind: 'block' },
      { label: 'Skipped by ESC', color: PART.ESC, kind: 'block' },
    ]),
    chart,
    html('p', { class: 'caption', text: 'N = 51 samples; means over 10 runs (Tables 7 and 8 of the paper). Each bar is the 51 traces sampled for a question, split by what happened to them. Hover a row for exact values and run-to-run spread.' }));
  function renderControls() {
    controls.replaceChildren(
      segmented('Benchmark', names.map((n) => ({ value: n, label: n })), state.ds, (v) => {
        state.ds = v;
        if (!A.datasets[v].models.includes(state.model)) state.model = A.datasets[v].models[A.datasets[v].models.length - 1];
        renderControls(); ro.redraw();
      }),
      segmented('Model', A.datasets[state.ds].models.map((m) => ({ value: m, label: m })), state.model, (v) => { state.model = v; ro.redraw(); }),
    );
  }

  let bars = [];
  const BAR_H = 16, GAP = 2;
  const ease = (t) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
  const block = (x0, x1, y) => {
    const w = x1 - x0;
    if (w <= 0.5) return '';
    const r = Math.min(3, w / 2), v = BAR_H - 2 * r;
    return `M${x0 + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${v}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${v}a${r} ${r} 0 0 1 ${r} -${r}z`;
  };
  // u in [0, 1]: every bar starts as 51 completed traces; PoLR's block takes over first (u < 0.5),
  // then AC's or ESC's (u > 0.5). Whatever is left is completed.
  function setGrowth(u) {
    const t1 = ease(u / 0.5), t2 = ease((u - 0.5) / 0.5);
    for (const b of bars) {
      const polrL = b.xp == null ? b.x51 : b.x51 - (b.x51 - b.xp) * t1;
      const stopR = b.xp == null ? b.x51 : b.xp;
      const stopL = b.xs == null ? stopR : stopR - (stopR - b.xs) * t2;
      const doneR = b.xs != null && t2 > 0 ? stopL : polrL;
      b.done.setAttribute('d', block(b.x0, doneR - (doneR < b.x51 - 0.5 ? GAP : 0), b.y));
      if (b.polr) b.polr.setAttribute('d', block(polrL, b.x51, b.y));
      if (b.stop) b.stop.setAttribute('d', block(stopL, stopR - (b.polr ? GAP : 0), b.y));
    }
  }
  function draw(width) {
    const rows = A.datasets[state.ds][state.model]['51'];
    const val = (k) => rows[idx[k]];
    const narrow = width < 560;
    const labelW = narrow ? 0 : 112, valueW = narrow ? 84 : 104;   // value column is right-aligned at the edge
    const rowH = narrow ? 42 : 30, groupGap = narrow ? 8 : 14, top = 20;
    const plotH = ROWS.length * rowH + 2 * groupGap;
    const H = top + plotH + 44;
    const x = linear(0, 51, labelW + 12, width - valueW - 16);
    const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}` });
    const g = svg('g', {}, root);
    const base = top + plotH + 2;
    xAxis(g, x, [0, 10, 20, 30, 40, 51], base, top - 2, String, { grid: true });
    svg('text', { class: 'axis-title', x: (x(0) + x(51)) / 2, y: H - 4, 'text-anchor': 'middle', text: 'Reasoning traces per question' }, g);
    svg('text', { class: 'tick', x: width, y: 8, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: 'Completed · accuracy' }, g);
    bars = [];
    const p = val('PoLR')[2];
    const pm = (k, j) => `${val(k)[j].toFixed(2)} ± ${val(k)[j + 1].toFixed(2)}`;
    ROWS.forEach((row, i) => {
      const r = val(row.key);
      const yc = top + i * rowH + row.group * groupGap + (narrow ? 26 : rowH / 2);
      const grp = svg('g', {}, g);
      svg('text', { class: row.polr ? 'label-strong' : 'label', x: narrow ? 0 : labelW, y: narrow ? yc - 17 : yc, 'text-anchor': narrow ? 'start' : 'end', 'dominant-baseline': 'middle', text: row.label }, grp);
      const b = { x0: x(0), x51: x(51), y: yc - BAR_H / 2, done: svg('path', { class: 'focus-ring', style: `fill:${PART.done}` }, grp) };
      if (row.polr) { b.xp = x(p); b.polr = svg('path', { style: `fill:${PART.PoLR}` }, grp); }
      if (row.stop) { b.xs = x(r[2]); b.stop = svg('path', { style: `fill:${PART[row.stop]}` }, grp); }
      bars.push(b);
      const value = svg('text', { class: 'label', x: width, y: yc, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, grp);
      svg('tspan', { class: 'label-strong', text: fmt(r[2]) }, value);
      svg('tspan', { text: ` · ${r[0].toFixed(1)}%` }, value);
      svg('rect', { class: 'hit', x: 0, y: yc - rowH / 2 - (narrow ? 8 : 0), width, height: rowH }, grp);
      grp.setAttribute('aria-label', `${row.label}: ${fmt(r[2])} of 51 traces completed, ${r[0].toFixed(1)}% accuracy`);
      hoverable(grp, () => ({
        title: `${row.label} · ${state.ds}, ${state.model}`,
        rows: [
          { value: pm(row.key, 2), name: 'completed', color: PART.done },
          row.polr && { value: (51 - p).toFixed(2), name: 'dropped by PoLR', color: PART.PoLR },
          row.stop && { value: ((row.polr ? p : 51) - r[2]).toFixed(2), name: `skipped by ${row.stop}`, color: PART[row.stop] },
          { value: `${pm(row.key, 0)}%`, name: 'accuracy' },
        ].filter(Boolean),
      }));
    });
    chart.setAttribute('aria-label', `${state.ds}, ${state.model}: of 51 sampled traces per question, ${ROWS.map((row) => `${row.label} completes ${fmt(val(row.key)[2])}`).join(', ')}.`);
    chart.replaceChildren(root);
    setGrowth(state.grown ? 1 : 0);
  }
  const ro = responsive(chart, draw);
  renderControls();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { state.grown = true; setGrowth(1); }
  else whenVisible(chart, () => {
    const start = performance.now();
    const tick = (now) => {
      const v = Math.min(1, (now - start) / 1400);   // two stages, eased separately in setGrowth
      setGrowth(v);
      if (v < 1) requestAnimationFrame(tick); else state.grown = true;
    };
    requestAnimationFrame(tick);
  });
}
