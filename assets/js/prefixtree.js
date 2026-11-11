// "Do reasoning traces agree early?": the sampled traces for one question, merged into a prefix tree
// (icicle layout). Each band is a group of traces whose first tokens are identical; bands split
// where traces diverge. Revealed token by token, with a scrubber. The largest group that is still
// identical at the current token is highlighted, together with the bands it grew out of.
import { svg, html, tooltip } from './charts.js';

const TOK = /\w+|[^\w\s]/g;
const DEPTH = 40;          // tokens shown
const ROW = 12;            // px per trace
const RIGHT_W = 48;        // room for the axis title
const AXIS_H = 24;         // token axis under the tree

const detok = (toks) => toks.join(' ').replace(/ ([,.?!;:)%])/g, '$1').replace(/ ' /g, "'").replace(/\( /g, '(');

function longestPrefix(sample) {
  const keys = Object.keys(sample.prefix_by_Lp).map(Number).sort((a, b) => b - a);
  return sample.prefix_by_Lp[String(keys[0])];
}

function buildTrie(seqs) {
  const root = { start: 0, end: 0, tokens: [], members: seqs.map((_, i) => i), children: [], parent: null };
  (function split(node, d) {
    while (d < DEPTH) {
      const toks = node.members.map((i) => seqs[i][d]);
      if (toks.some((t) => t === undefined) || toks.some((t) => t !== toks[0])) break;
      node.tokens.push(toks[0]);
      d++;
    }
    node.end = d;
    if (d >= DEPTH) return;
    const groups = new Map(), ended = [];
    for (const i of node.members) {
      const t = seqs[i][d];
      if (t === undefined) { ended.push(i); continue; }
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(i);
    }
    for (const members of groups.values()) {
      const child = { start: d, end: d, tokens: [], members, children: [], parent: node };
      node.children.push(child);
      split(child, d);
    }
    node.children.sort((a, b) => b.members.length - a.members.length);
    // traces whose prefix ends here keep their rows (an empty, undrawn leaf)
    if (ended.length) node.children.push({ start: d, end: d, tokens: [], members: ended, children: [], parent: node });
  })(root, 0);
  return root;
}

// For t = 1..DEPTH, the largest group of traces whose first t tokens are identical (the band covering
// token t with the most members). On a tie the group continuing the previous pick wins, so the
// highlight never jumps between equal branches.
function largestGroups(nodes) {
  const within = (n, a) => { for (let m = n; m; m = m.parent) if (m === a) return true; return false; };
  const out = [null];
  for (let t = 1; t <= DEPTH; t++) {
    const prev = out[t - 1];
    let best = null;
    for (const n of nodes) {
      if (!(n.start < t && t <= n.end)) continue;
      const k = n.members.length, b = best?.members.length ?? -1;
      if (k > b || (k === b && prev && within(n, prev) && !within(best, prev))) best = n;
    }
    out.push(best);
  }
  return out;
}

export function initPrefixTree(el, q) {
  if (!el) return;
  const N = q.samples.length;
  const seqs = q.samples.map((s) => (longestPrefix(s).match(TOK) || []).slice(0, DEPTH));
  const root = buildTrie(seqs);

  // rows in DFS order so every node covers a contiguous band
  const nodes = [];
  let row = 0;
  (function place(n, depth) {
    n.row = row;
    n.depth = depth;
    if (n.end > n.start) nodes.push(n);
    if (!n.children.length) { n.leaf = true; row += n.members.length; return; }
    n.children.forEach((c) => place(c, depth + 1));
  })(root, 0);
  const largest = largestGroups(nodes);

  const playBtn = html('button', { type: 'button', class: 'text-button' });
  const scrub = html('input', { type: 'range', min: 0, max: DEPTH, step: 1, value: 0, 'aria-label': 'Tokens generated' });
  const out = html('output');
  const scroll = html('div', { class: 'tree-scroll' });
  el.append(
    html('div', { class: 'tree-toolbar' }, [playBtn, scrub, out]),
    scroll,
    html('p', { class: 'caption', text: `${N} reasoning traces sampled from ${q.model} on a ${q.dataset} question: “${q.question_display ?? q.question}” Each row is one trace, showing its first ${DEPTH} words and symbols. Blue follows the largest group of traces that are still word-for-word identical. Hover a band to read it.` }),
  );

  let reveal = 0, width = 0, clipRect = null, raf = 0, playing = false, shown = null;

  function draw() {
    width = Math.max(760, Math.round(scroll.clientWidth));
    const H = row * ROW;
    const x = (tok) => (tok / DEPTH) * (width - RIGHT_W);
    const root = svg('svg', { width, height: H + AXIS_H, viewBox: `0 0 ${width} ${H + AXIS_H}`, role: 'img', 'aria-label': `Prefix tree of ${N} reasoning traces: groups of traces that share identical opening tokens, splitting where they diverge.` });
    const defs = svg('defs', {}, root);
    const clip = svg('clipPath', { id: 'tree-clip' }, defs);
    clipRect = svg('rect', { x: 0, y: 0, width: x(reveal), height: H }, clip);
    const g = svg('g', { 'clip-path': 'url(#tree-clip)' }, root);
    for (const n of nodes) {
      const x0 = x(n.start) + 1, x1 = x(n.end) - 1;
      const y0 = n.row * ROW + 1, h = n.members.length * ROW - 2;
      const grp = svg('g', { class: 'tree-node' }, g);
      n.el = grp;
      svg('rect', { class: 'box', x: x0, y: y0, width: Math.max(1, x1 - x0), height: h, rx: 3 }, grp);
      // every band shows its text on hover; only shared bands (2+ traces) are keyboard stops,
      // so Tab does not walk through every single-trace sliver
      const phrase = detok(n.tokens);
      const shared = n.members.length >= 2;
      const span = n.end - n.start === 1 ? `token ${n.end}` : `tokens ${n.start + 1}–${n.end}`;
      const content = () => ({
        title: shared ? `${n.members.length} traces share ${span}` : `One trace, ${span}`,
        rows: [{ value: `“${phrase.length > 140 ? phrase.slice(0, 139) + '…' : phrase}”` }],
      });
      grp.addEventListener('pointermove', (e) => tooltip.show(grp, e.clientX, e.clientY, content()));
      grp.addEventListener('pointerleave', () => tooltip.hide(grp));
      if (shared) {
        grp.setAttribute('tabindex', '0');
        grp.setAttribute('aria-label', `${n.members.length} traces share: ${phrase}`);
        grp.addEventListener('focus', () => { const r = grp.getBoundingClientRect(); tooltip.show(grp, r.left + 20, r.top + r.height / 2, content()); });
        grp.addEventListener('blur', () => tooltip.hide(grp));
      }
    }
    // Labels run along "trunks": a node and its largest child share the band's top row, so one label can span
    // the whole chain instead of being cut into slivers wherever a single trace splits off.
    const labels = svg('g', { 'aria-hidden': 'true', style: 'pointer-events:none' }, g);
    const absorbed = new Set();
    for (const n of nodes) {
      if (absorbed.has(n) || n.members.length < 2) continue;
      let toks = [], end = n.end, m = n;
      while (m && m.members.length >= 2 && m.end > m.start) {
        toks = toks.concat(m.tokens); end = m.end;
        if (m !== n) absorbed.add(m);
        m = m.children[0];
      }
      const phrase = detok(toks);
      const maxChars = Math.floor((x(end) - x(n.start) - 10) / 6.4);
      if (maxChars < 6) continue;
      const label = phrase.length > maxChars ? `${phrase.slice(0, maxChars - 1).trimEnd()}…` : phrase;
      svg('text', { class: 'tree-label', x: x(n.start) + 6, y: n.row * ROW + 1 + 11, 'dominant-baseline': 'middle', text: label }, labels);
    }

    // token axis
    const axis = svg('g', { class: 'tree-axis', 'aria-hidden': 'true' }, root);
    svg('line', { x1: 0, x2: x(DEPTH), y1: H + 4, y2: H + 4 }, axis);
    for (let t = 0; t <= DEPTH; t += 10) {
      svg('line', { x1: x(t), x2: x(t), y1: H + 4, y2: H + 8 }, axis);
      svg('text', { x: x(t), y: H + 19, 'text-anchor': t === 0 ? 'start' : t === DEPTH ? 'end' : 'middle', text: String(t) }, axis);
    }
    svg('text', { x: x(DEPTH) + 8, y: H + 19, text: 'tokens' }, axis);

    scroll.replaceChildren(root);
    shown = null;
  }
  // highlight the largest group at token t and every band it grew out of
  function highlight(t) {
    const pick = largest[Math.max(1, Math.min(DEPTH, t))];
    if (pick === shown) return;
    shown = pick;
    const path = new Set();
    for (let m = pick; m; m = m.parent) path.add(m);
    for (const n of nodes) n.el?.classList.toggle('is-main', path.has(n));
  }
  function setReveal(v) {
    reveal = Math.max(0, Math.min(DEPTH, v));
    scrub.value = String(Math.round(reveal));
    out.textContent = `${Math.round(reveal)} of ${DEPTH} tokens`;
    const xr = (reveal / DEPTH) * (width - RIGHT_W);
    if (clipRect) clipRect.setAttribute('width', xr);
    highlight(Math.ceil(reveal));
  }
  function setPlaying(p) {
    playing = p;
    playBtn.replaceChildren(p ? 'Pause' : (reveal >= DEPTH ? 'Replay' : 'Play'));
  }
  function play() {
    cancelAnimationFrame(raf);
    if (reveal >= DEPTH) setReveal(0);
    setPlaying(true);
    const from = reveal, start = performance.now(), dur = 4200 * (1 - from / DEPTH);
    const tick = (now) => {
      const u = Math.min(1, (now - start) / dur);
      setReveal(from + (DEPTH - from) * u);
      if (u < 1 && playing) raf = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
  }
  // autoplay once when the tree first scrolls into view, unless the reader has already used the controls
  let io = null;
  const stopAutoplay = () => { io?.disconnect(); io = null; };
  playBtn.addEventListener('click', () => { stopAutoplay(); if (playing) { cancelAnimationFrame(raf); setPlaying(false); } else play(); });
  scrub.addEventListener('input', () => { stopAutoplay(); cancelAnimationFrame(raf); setReveal(Number(scrub.value)); setPlaying(false); });

  draw();
  new ResizeObserver(() => { if (Math.max(760, Math.round(scroll.clientWidth)) !== width) { draw(); setReveal(reveal); } }).observe(scroll);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setReveal(reduce ? DEPTH : 0);
  setPlaying(false);
  if (!reduce) {
    io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { stopAutoplay(); play(); } }, { threshold: 0.4 });
    io.observe(scroll);
  }
}
