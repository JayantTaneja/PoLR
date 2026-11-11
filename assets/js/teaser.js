// Teaser: a schematic token budget. Each bar is one sampled reasoning trace; its length is the
// tokens generated. Self-Consistency completes every trace. PoLR generates short prefixes,
// clusters them, and completes only the dominant cluster. Illustrative geometry only.
import { svg } from './charts.js';

const LEN = [0.86, 0.95, 0.78, 0.91, 1.0, 0.83, 0.88, 0.74, 0.97, 0.81, 0.9, 0.79, 0.93, 0.85, 0.76, 0.89];
const CLUSTER = [0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 2, 0, 1, 0, 1]; // 9 / 5 / 2
const CLUSTER_COLOR = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const N = LEN.length, PREFIX = 0.2;
const W = 440, X0 = 2, LMAX = 392, BAR = 10, PITCH = 17, TOP = 6, GROUP_GAP = 9;
const H = TOP * 2 + N * PITCH + GROUP_GAP * 2;
const T = { prefix: [0, 900], cluster: [900, 1900], expand: [1900, 3300], vote: [3300, 3800] };
const END = 3800;
const STEP_END = { 1: T.prefix[1], 2: T.cluster[1], 3: T.expand[1] + 200, 4: END };

const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const prog = (t, [a, b], delay = 0) => ease(Math.min(1, Math.max(0, (t - a - delay) / (b - a))));

// grouped order: cluster 0 rows, then 1, then 2 (stable within a cluster)
const order = [...LEN.keys()].sort((a, b) => CLUSTER[a] - CLUSTER[b] || a - b);
const groupedY = new Array(N);
order.forEach((row, k) => { groupedY[row] = TOP + k * PITCH + CLUSTER[row] * GROUP_GAP; });
const plainY = LEN.map((_, i) => TOP + i * PITCH + GROUP_GAP);
const dominantRows = order.filter((r) => CLUSTER[r] === 0);
const SC_TOTAL = LEN.reduce((a, b) => a + b, 0);

export function initTeaser() {
  const scSvg = document.querySelector('[data-teaser="sc"]');
  const polrSvg = document.querySelector('[data-teaser="polr"]');
  if (!scSvg || !polrSvg) return;
  for (const s of [scSvg, polrSvg]) s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const scMeter = document.querySelector('[data-meter="sc"]');
  const polrMeter = document.querySelector('[data-meter="polr"]');

  // --- Self-Consistency panel
  const scBars = LEN.map((len, i) => {
    svg('rect', { x: X0, y: plainY[i], width: len * LMAX, height: BAR, rx: 2, style: 'fill:var(--ghost)' }, scSvg);
    return svg('rect', { x: X0, y: plainY[i], width: 0, height: BAR, rx: 2, style: 'fill:var(--neutral-mark)' }, scSvg);
  });
  const scVote = voteMark(scSvg, plainY[0], plainY[N - 1] + BAR);

  // --- PoLR panel
  const rows = LEN.map((len, i) => {
    const g = svg('g', {}, polrSvg);
    const ghost = svg('rect', { x: X0, y: 0, width: len * LMAX, height: BAR, rx: 2, style: 'fill:var(--ghost);stroke:var(--ghost-edge);stroke-width:1;opacity:0' }, g);
    const cont = svg('rect', { x: X0 + PREFIX * LMAX - 2, y: 0, width: 0, height: BAR, rx: 2, style: `fill:${CLUSTER_COLOR[0]};opacity:0.55` }, g);
    const gray = svg('rect', { x: X0, y: 0, width: 0, height: BAR, rx: 2, style: 'fill:var(--neutral-mark)' }, g);
    const colored = svg('rect', { x: X0, y: 0, width: PREFIX * LMAX, height: BAR, rx: 2, style: `fill:${CLUSTER_COLOR[CLUSTER[i]]};opacity:0` }, g);
    return { g, ghost, cont, gray, colored, len };
  });
  const yTop = groupedY[dominantRows[0]], yBot = groupedY[dominantRows[dominantRows.length - 1]] + BAR;
  const polrVote = voteMark(polrSvg, yTop, yBot);

  const steps = [...document.querySelectorAll('.teaser-steps button')];
  const setStep = (n) => steps.forEach((b) => {
    const on = Number(b.dataset.step) === n;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  function render(t) {
    let scGen = 0, polrGen = 0;
    scBars.forEach((r, i) => {
      const p = prog(t, [0, T.expand[1]], i * 18);
      r.setAttribute('width', LEN[i] * LMAX * p);
      scGen += LEN[i] * p;
    });
    scVote.style.opacity = prog(t, T.vote);
    const mv = prog(t, T.cluster);
    rows.forEach((r, i) => {
      const pp = prog(t, T.prefix, i * 25);
      r.gray.setAttribute('width', PREFIX * LMAX * pp);
      polrGen += PREFIX * pp;
      r.colored.style.opacity = prog(t, [T.cluster[0], T.cluster[0] + 500]);
      r.g.setAttribute('transform', `translate(0 ${plainY[i] + (groupedY[i] - plainY[i]) * mv})`);
      if (CLUSTER[i] === 0) {
        const pe = prog(t, T.expand, dominantRows.indexOf(i) * 40);
        r.cont.setAttribute('width', Math.max(0, (r.len - PREFIX) * LMAX + 2) * pe);
        polrGen += (r.len - PREFIX) * pe;
      } else {
        r.ghost.style.opacity = prog(t, [T.expand[0], T.expand[0] + 700]);
      }
    });
    polrVote.style.opacity = prog(t, T.vote);
    if (scMeter) scMeter.style.width = `${(scGen / SC_TOTAL) * 100}%`;
    if (polrMeter) polrMeter.style.width = `${(polrGen / SC_TOTAL) * 100}%`;
    setStep(t < T.prefix[1] ? 1 : t < T.cluster[1] ? 2 : t < T.expand[1] ? 3 : 4);
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  function play(from = 0) {
    cancelAnimationFrame(raf);
    if (reduce.matches) { render(END); return; }
    const start = performance.now() - from;
    const tick = (now) => {
      const t = now - start;
      render(Math.min(t, END));
      if (t < END) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  render(reduce.matches ? END : 0);
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); play(); }
  }, { threshold: 0.35 });
  io.observe(polrSvg);
  document.getElementById('teaser-replay')?.addEventListener('click', () => play());
  steps.forEach((b) => b.addEventListener('click', () => {
    io.disconnect();
    cancelAnimationFrame(raf);
    render(STEP_END[b.dataset.step]);
  }));
}

// a bracket to the right of the voted traces
function voteMark(parent, y1, y2) {
  const x = X0 + LMAX + 14;
  const g = svg('g', { style: 'opacity:0' }, parent);
  const st = 'fill:none;stroke:var(--ink-2);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round';
  svg('path', { d: `M${x - 5} ${y1} H${x} V${y2} H${x - 5}`, style: st }, g);
  svg('path', { d: `M${x} ${(y1 + y2) / 2} H${x + 10}`, style: st }, g);
  svg('circle', { cx: x + 16, cy: (y1 + y2) / 2, r: 5, style: 'fill:var(--ink-1)' }, g);
  return g;
}
