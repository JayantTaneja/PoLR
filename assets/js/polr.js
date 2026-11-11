// A small re-implementation of PoLR's prefix clustering, written for this page from the description in the
// paper (Section 3.1 and Appendix A): word-level TF-IDF fitted on one question's N prefixes, PCA down to
// 10 dimensions, then agglomerative clustering with cosine distance, average linkage and a distance
// threshold of 1.0. It exists only to drive the page's illustrations; it is not the authors' implementation,
// and the paper is the reference for the method.
// Runs in the browser and in Node (no DOM use).

// Lowercased words of two or more characters.
const WORD_RUN = /[\p{L}\p{N}_]+/gu;
export function tokenize(text) {
  const out = [];
  for (const m of String(text).toLowerCase().matchAll(WORD_RUN)) {
    if ([...m[0]].length >= 2) out.push(m[0]);
  }
  return out;
}

// TF-IDF: raw term counts, smoothed idf = ln((1 + n) / (1 + df)) + 1, rows L2-normalised.
// Returns sparse rows as Map(termIndex -> weight).
export function tfidf(docs) {
  const vocab = new Map();
  const counts = docs.map((d) => {
    const c = new Map();
    for (const t of tokenize(d)) {
      if (!vocab.has(t)) vocab.set(t, vocab.size);
      const j = vocab.get(t);
      c.set(j, (c.get(j) || 0) + 1);
    }
    return c;
  });
  const n = docs.length;
  const df = new Float64Array(vocab.size);
  for (const c of counts) for (const j of c.keys()) df[j] += 1;
  return counts.map((c) => {
    const row = new Map();
    let norm = 0;
    for (const [j, cnt] of c) {
      const w = cnt * (Math.log((1 + n) / (1 + df[j])) + 1);
      row.set(j, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [j, w] of row) row.set(j, w / norm);
    return row;
  });
}

function gram(rows) {
  const n = rows.length;
  const G = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const [a, b] = rows[i].size <= rows[j].size ? [rows[i], rows[j]] : [rows[j], rows[i]];
      let s = 0;
      for (const [k, v] of a) { const u = b.get(k); if (u !== undefined) s += v * u; }
      G[i][j] = G[j][i] = s;
    }
  }
  return G;
}

// Cyclic Jacobi eigen-decomposition of a small symmetric matrix; vectors[i][k] is component i of eigenvector k.
function eigSym(A) {
  const n = A.length;
  const a = A.map((r) => Float64Array.from(r));
  const v = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = 1; return r; });
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: v };
}

// Reduce the TF-IDF features to `dims` principal components (centre the features, keep the top components)
// and return the Gram matrix of the reduced vectors, plus the eigen-decomposition for the 2-D map.
function reduced(prefixes, dims) {
  const G = gram(tfidf(prefixes));
  const n = G.length;
  const rowMean = G.map((r) => r.reduce((x, y) => x + y, 0) / n);
  const all = rowMean.reduce((x, y) => x + y, 0) / n;
  const C = G.map((r, i) => Float64Array.from(r, (g, j) => g - rowMean[i] - rowMean[j] + all));
  const { values, vectors } = eigSym(C);
  const order = [...values.keys()].sort((x, y) => values[y] - values[x]);
  const top = order.slice(0, Math.min(dims, n));
  const R = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (const t of top) s += Math.max(values[t], 0) * vectors[i][t] * vectors[j][t];
      R[i][j] = R[j][i] = s;
    }
  }
  return { R, values, vectors, order };
}

// Cosine distances from a Gram matrix, clipped to [0, 2]. A zero vector is at distance 1 from everything except
// another zero vector: after centring, two zero vectors are identical prefixes, so they are at distance 0.
function cosineFromGram(G) {
  const scale = Math.max(1e-300, ...G.map((r, i) => r[i]));
  const norm = G.map((r, i) => (r[i] > 1e-12 * scale ? Math.sqrt(r[i]) : 0));
  return G.map((r, i) => Float64Array.from(r, (g, j) => {
    if (i === j) return 0;
    if (norm[i] === 0 && norm[j] === 0) return 0;
    const den = norm[i] * norm[j];
    return den > 0 ? Math.min(2, Math.max(0, 1 - g / den)) : 1;
  }));
}

// Average-linkage agglomerative clustering: keep merging the closest pair of clusters while their
// average distance is below the threshold. Clusters come back largest first (ties: smallest member index).
export function agglomerative(D, threshold) {
  const n = D.length;
  const d = D.map((r) => Float64Array.from(r));
  const size = new Array(n).fill(1);
  const members = Array.from({ length: n }, (_, i) => [i]);
  const alive = new Array(n).fill(true);
  for (;;) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (alive[j] && d[i][j] < best) { best = d[i][j]; bi = i; bj = j; }
      }
    }
    if (bi < 0 || !(best < threshold)) break;
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      d[bi][k] = d[k][bi] = (size[bi] * d[bi][k] + size[bj] * d[bj][k]) / (size[bi] + size[bj]);
    }
    size[bi] += size[bj];
    members[bi] = members[bi].concat(members[bj]);
    alive[bj] = false;
  }
  const clusters = members.filter((_, i) => alive[i]).map((m) => m.sort((a, b) => a - b))
    .sort((a, b) => b.length - a.length || a[0] - b[0]);
  const labels = new Array(n);
  clusters.forEach((m, c) => m.forEach((i) => { labels[i] = c; }));
  return { labels, clusters };
}

export function clusterPrefixes(prefixes, { threshold = 1.0, dims = 10 } = {}) {
  return agglomerative(cosineFromGram(reduced(prefixes, dims).R), threshold);
}

// 2-D coordinates for the page's map: the top two principal components of the same features.
export function embed2d(prefixes) {
  const { values, vectors, order } = reduced(prefixes, 2);
  return prefixes.map((_, i) => order.slice(0, 2).map((t) => Math.sqrt(Math.max(values[t], 0)) * vectors[i][t]));
}

// Majority vote; ties go to the answer seen first. Missing answers do not vote.
export function majority(answers) {
  const counts = new Map();
  for (const a of answers) {
    if (a == null || String(a).trim() === '') continue;
    const k = String(a).trim();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let answer = null, count = 0;
  for (const [k, c] of counts) if (c > count) { answer = k; count = c; }
  return { answer, count, counts };
}

// One PoLR run on a question's samples: [{prefix_by_Lp, answer, correct, trace_tokens}]
export function runPoLR(samples, { Lp, threshold = 1.0, dims = 10 }) {
  const prefixes = samples.map((s) => s.prefix_by_Lp[String(Lp)] ?? '');
  const { labels, clusters } = clusterPrefixes(prefixes, { threshold, dims });
  const dominant = clusters[0];
  const sc = majority(samples.map((s) => s.answer));
  const polr = majority(dominant.map((i) => samples[i].answer));
  const lf = samples.map((s) => s.trace_tokens);
  const lp = lf.map((l) => Math.min(Number(Lp), l));
  const tSC = lf.reduce((a, b) => a + b, 0);
  const tPoLR = lp.reduce((a, b) => a + b, 0) + dominant.reduce((a, i) => a + (lf[i] - lp[i]), 0);
  return { labels, clusters, dominant, sc, polr, tokens: { sc: tSC, polr: tPoLR, eta: 1 - tPoLR / tSC } };
}
