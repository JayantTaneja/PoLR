// "Try it": PoLR's clustering running in the browser on one question's sampled prefixes.
// Dots sit on a 2-D projection of the prefixes' TF-IDF features; colors are clusters.
import { svg, html, segmented, tooltip } from './charts.js';
import { runPoLR, embed2d } from './polr.js';

const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const OTHER = 'var(--neutral-mark)';
const colorOf = (rank) => (rank < COLORS.length ? COLORS[rank] : OTHER);
const MAP_H = 340, PAD = 26, R = 6;

export function initPlayground(el, q) {
  if (!el) return;
  const lps = Object.keys(q.samples[0].prefix_by_Lp).map(Number).sort((a, b) => a - b);
  const dims = 10;
  const N = q.samples.length, gold = String(q.gold);
  const prefixes = (lp) => q.samples.map((s) => s.prefix_by_Lp[String(lp)] ?? '');
  const state = { lp: lps.includes(256) ? 256 : lps[lps.length - 1], t: q.params?.threshold ?? 1.0, expanded: false, selected: null };

  // 2-D coordinates per prefix length, sign/axis-aligned to the neighbouring length so dots glide instead of flip
  const coords = {};
  let prev = null;
  for (const lp of lps) {
    const c = embed2d(prefixes(lp));
    if (prev) align(c, prev);
    coords[lp] = c;
    prev = c;
  }

  // ---------- DOM
  el.append(html('div', { class: 'pg-question' }, [
    html('div', { class: 'meta', text: `${q.label ?? q.dataset} · ${N} sampled traces` }),
    html('div', { text: q.question_display ?? q.question }),
    html('div', { class: 'meta', text: `Correct answer: ${gold}` }),
  ]));

  const tOut = html('output');
  const tInput = html('input', { type: 'range', min: 0.5, max: 1.0, step: 0.05, value: state.t, 'aria-label': 'Distance threshold' });
  tInput.addEventListener('input', () => { state.t = Number(tInput.value); update(); });
  el.append(html('div', { class: 'controls' }, [
    segmented('Prefix length (tokens)', lps.map((lp) => ({ value: lp, label: String(lp) })), state.lp, (v) => { state.lp = v; update(); }),
    html('div', { class: 'control' }, [html('span', { class: 'control-label', text: 'Distance threshold' }), html('div', { class: 'range' }, [tInput, tOut])]),
  ]));

  const map = html('div', { class: 'pg-map' });
  const side = html('div', { class: 'pg-side', 'aria-live': 'polite' });
  el.append(html('div', { class: 'pg-grid' }, [
    html('div', {}, [map, html('p', { class: 'pg-map-caption', text: 'Map: the top two principal components of the prefixes’ TF-IDF features. Clusters are computed on 10 dimensions, so a dot can sit near another cluster.' })]),
    side,
  ]));
  const reader = html('div', { class: 'pg-reader' });
  el.append(reader);

  // ---------- map
  const svgEl = svg('svg', { height: MAP_H, role: 'img', 'aria-label': 'Map of the sampled prefixes, colored by cluster' });
  const hullLayer = svg('g', {}, svgEl);
  const dotLayer = svg('g', {}, svgEl);
  map.append(svgEl);
  const dots = q.samples.map((s, i) => {
    const g = svg('g', { class: 'dot', tabindex: 0 }, dotLayer);
    svg('circle', { class: 'hit', r: 13 }, g);
    const c = svg('circle', { r: R, style: 'stroke:var(--bg-soft);stroke-width:2' }, g);
    const ring = svg('circle', { r: R + 3.5, style: 'fill:none;stroke:var(--ink-1);stroke-width:1.5;opacity:0' }, g);
    const words = () => s.prefix_by_Lp[String(state.lp)].split(/\s+/).slice(0, 16).join(' ');
    const tip = () => {
      const rows = [{ value: `“${words()}…”` }];
      if (state.expanded && result.labels[i] === 0) rows.push({ value: String(s.answer), name: 'final answer' });
      return { title: `Trace ${i + 1} · cluster ${result.labels[i] + 1}`, rows };
    };
    g.addEventListener('pointermove', (e) => tooltip.show(g, e.clientX, e.clientY, tip()));
    g.addEventListener('pointerleave', () => tooltip.hide(g));
    g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); tooltip.show(g, r.right, r.top, tip()); });
    g.addEventListener('blur', () => tooltip.hide(g));
    const pick = () => { state.selected = state.selected === i ? null : i; paint(); renderReader(); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return { g, c, ring, x: null, y: null };
  });

  let result = null, width = 0, raf = 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function targets() {
    const c = coords[state.lp];
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((width - 2 * PAD) / ((x1 - x0) || 1), (MAP_H - 2 * PAD) / ((y1 - y0) || 1));
    const cx = width / 2 - ((x0 + x1) / 2) * s, cy = MAP_H / 2 + ((y0 + y1) / 2) * s;
    const pts = c.map(([x, y]) => [cx + x * s, cy - y * s]);
    // spread identical prefixes (same point) on a small sunflower so every trace stays visible
    const groups = new Map();
    pts.forEach((p, i) => { const k = `${Math.round(p[0])},${Math.round(p[1])}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    for (const idx of groups.values()) {
      if (idx.length < 2) continue;
      const [ox, oy] = pts[idx[0]];
      idx.forEach((i, k) => { const r = 7.5 * Math.sqrt(k), a = k * 2.39996; pts[i] = [ox + r * Math.cos(a), oy + r * Math.sin(a)]; });
    }
    return pts;
  }

  function layout(animate) {
    width = Math.round(map.clientWidth) || 560;
    svgEl.setAttribute('width', width);
    svgEl.setAttribute('viewBox', `0 0 ${width} ${MAP_H}`);
    const to = targets();
    const from = dots.map((d, i) => (d.x == null ? to[i] : [d.x, d.y]));
    cancelAnimationFrame(raf);
    const set = (u) => {
      dots.forEach((d, i) => {
        d.x = from[i][0] + (to[i][0] - from[i][0]) * u;
        d.y = from[i][1] + (to[i][1] - from[i][1]) * u;
        d.g.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`);
      });
      drawHulls();
    };
    if (!animate || reduceMotion.matches) { set(1); return; }
    const start = performance.now();
    const tick = (now) => {
      const v = Math.min(1, (now - start) / 450), u = v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2;
      set(u);
      if (v < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function drawHulls() {
    hullLayer.replaceChildren();
    result.clusters.slice(0, COLORS.length).forEach((members, rank) => {
      const faded = state.expanded && rank > 0;
      const style = `fill:${colorOf(rank)};stroke:${colorOf(rank)};fill-opacity:${faded ? 0.05 : 0.13};stroke-opacity:${faded ? 0.05 : 0.13};stroke-width:28;stroke-linejoin:round;stroke-linecap:round`;
      const pts = hull(members.map((i) => [dots[i].x, dots[i].y]));
      if (pts.length === 1) svg('circle', { cx: pts[0][0], cy: pts[0][1], r: 14, style: `fill:${colorOf(rank)};fill-opacity:${faded ? 0.05 : 0.13}` }, hullLayer);
      else svg('path', { d: `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`, style }, hullLayer);
    });
  }

  function paint() {
    result.labels.forEach((rank, i) => {
      const d = dots[i];
      d.c.style.fill = colorOf(rank);
      d.g.style.opacity = state.expanded && rank !== 0 ? 0.35 : 1;
      d.ring.style.opacity = state.selected === i ? 1 : 0;
      d.g.setAttribute('aria-label', `Trace ${i + 1}, cluster ${rank + 1}${rank === 0 ? ' (dominant)' : ''}. Press Enter to read its prefix.`);
    });
    drawHulls();
  }

  // ---------- side panel
  function renderSide() {
    const sizes = result.clusters.map((c) => c.length);
    const bar = html('div', { class: 'cluster-bar', role: 'img', 'aria-label': `Cluster sizes: ${sizes.join(', ')}` },
      sizes.map((n, r) => { const s = html('span'); s.style.flexGrow = n; s.style.background = colorOf(r); return s; }));
    const items = sizes.slice(0, COLORS.length).map((n, r) => {
      const sw = html('span', { class: 'sw' }); sw.style.background = colorOf(r);
      return html('li', {}, [sw, r === 0 ? html('strong', { text: 'Cluster 1 (dominant)' }) : `Cluster ${r + 1}`, html('span', { class: 'n', text: `${n} prefix${n === 1 ? '' : 'es'}` })]);
    });
    if (sizes.length > COLORS.length) {
      const rest = sizes.slice(COLORS.length), sw = html('span', { class: 'sw' }); sw.style.background = OTHER;
      items.push(html('li', {}, [sw, `${rest.length} smaller cluster${rest.length === 1 ? '' : 's'}`, html('span', { class: 'n', text: `${rest.reduce((a, b) => a + b, 0)} prefixes` })]));
    }
    const btn = html('button', { type: 'button', class: 'button', text: state.expanded ? 'Reset' : 'Expand the dominant cluster' });
    btn.addEventListener('click', () => { state.expanded = !state.expanded; paint(); renderSide(); renderReader(); });

    const kids = [
      html('div', {}, [html('h4', { text: `${sizes.length} cluster${sizes.length === 1 ? '' : 's'} at ${state.lp} tokens` }), bar, html('ul', { class: 'cluster-legend' }, items)]),
      html('div', {}, [btn]),
    ];
    if (!state.expanded) {
      kids.push(html('p', { class: 'pg-hint', text: `So far PoLR has generated only the ${N} prefixes. Expanding finishes the ${sizes[0]} traces in the dominant cluster and votes on their answers.` }));
    } else {
      const verdict = (a) => (a === gold ? html('span', { class: 'ok', text: 'correct' }) : html('span', { class: 'no', text: 'wrong' }));
      const tally = (v) => {
        const all = [...v.counts].sort((a, b) => b[1] - a[1]);
        const repeated = all.filter(([, k]) => k > 1), singles = all.filter(([, k]) => k === 1);
        const shown = all.length <= 5 ? all : repeated;
        const parts = shown.map(([a, k]) => `${a} ×${k}`);
        if (shown !== all && singles.length) parts.push(`${singles.length} other answer${singles.length === 1 ? '' : 's'} ×1`);
        return parts.join(' · ');
      };
      const vote = (k, v, d) => html('div', { class: 'vote' }, [
        html('div', { class: 'k', text: k }), html('div', { class: 'v', text: v.answer ?? '–' }),
        html('div', { class: 'd' }, [d, ' · ', verdict(v.answer)]),
        html('div', { class: 'd tally', text: `Votes: ${tally(v)}` }),
      ]);
      const pct = (x) => `${(x * 100).toFixed(0)}%`;
      const tk = result.tokens;
      const track = (frac, color) => { const t = html('span', { class: 'track' }, [html('i')]); t.firstChild.style.width = pct(frac); t.firstChild.style.background = color; return t; };
      kids.push(
        html('div', { class: 'vote-cards' }, [
          vote('PoLR vote', result.polr, `${result.polr.count} of ${result.dominant.length} completed`),
          vote('Self-Consistency vote', result.sc, `${result.sc.count} of ${N} completed`),
        ]),
        html('div', { class: 'bars' }, [
          html('div', { class: 'row' }, ['SC', track(1, 'var(--neutral-mark)')]),
          html('div', { class: 'row' }, ['PoLR', track(tk.polr / tk.sc, 'var(--s1)')]),
          html('div', { class: 'sum', text: `PoLR generates ${(tk.eta * 100).toFixed(1)}% fewer tokens than SC on this question.` }),
        ]),
      );
    }
    side.replaceChildren(...kids);
  }

  function renderReader() {
    if (state.selected == null) {
      reader.replaceChildren(html('p', { class: 'pg-hint', text: 'Click a dot to read that trace’s prefix.' }));
      return;
    }
    const i = state.selected, s = q.samples[i], rank = result.labels[i];
    const status = rank === 0
      ? (state.expanded ? `In the dominant cluster: PoLR completes it, and it answers ${s.answer}.` : 'In the dominant cluster: PoLR will complete this trace.')
      : `Not in the dominant cluster, so PoLR stops it here. Run to the end, it would answer ${s.answer}.`;
    reader.replaceChildren(
      html('div', {}, [html('strong', { text: `Trace ${i + 1}` }), html('span', { class: 'muted', text: ` · cluster ${rank + 1} · first ${state.lp} tokens` })]),
      html('p', { text: s.prefix_by_Lp[String(state.lp)] }),
      html('p', { class: 'pg-hint', text: status }),
    );
  }

  function update(animate = true) {
    tOut.textContent = state.t.toFixed(2);
    result = runPoLR(q.samples, { Lp: state.lp, threshold: state.t, dims });
    layout(animate);
    paint();
    renderSide();
    renderReader();
  }
  update(false);
  new ResizeObserver(() => { if (Math.round(map.clientWidth) !== width) layout(false); }).observe(map);
}

// flip / swap the 2-D axes of `c` to best match `ref` (PCA axes have arbitrary sign and order)
function align(c, ref) {
  const dot = (a, b) => c.reduce((s, p, i) => s + p[a] * ref[i][b], 0);
  if (Math.abs(dot(0, 1)) + Math.abs(dot(1, 0)) > Math.abs(dot(0, 0)) + Math.abs(dot(1, 1))) c.forEach((p) => p.reverse());
  for (const k of [0, 1]) if (dot(k, k) < 0) c.forEach((p) => { p[k] = -p[k]; });
}

// convex hull (monotone chain)
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
  for (const pt of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
