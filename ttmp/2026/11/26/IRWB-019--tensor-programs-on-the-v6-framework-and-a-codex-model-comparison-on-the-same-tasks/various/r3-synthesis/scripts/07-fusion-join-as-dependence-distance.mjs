// Reproduction of IRWB-038-D scripts/05 (Fable), with three added cases; claim (D): planFusion's join test is a
// dependence-distance test.
// Prototype: planFusion's join test (src/tensor/fusion.ts:83-105, `joinDepth`) restated as a domain-independent
// dependence test over affine accesses, then compared with planFusion on the corpus and on programs chosen to
// make the test refuse.
//
// Theory (Allen and Kennedy, "Optimizing Compilers for Modern Architectures", ch. 2-3 and 8; Feautrier 1992):
// a statement instance is a point of its iteration domain; a read of T at f(c) by the consumer instance c depends
// on the producer instance f(c); the distance vector is c - f(c). A loop may run its iterations in parallel iff no
// dependence is carried by it, i.e. the distance in its position is 0 for every dependence. Fusing producer and
// consumer under `k` shared parallel loops is legal iff, for every read of a group member, the first k distance
// components are 0, and the k outer extents are equal (conformable domains). The largest such k is the answer.
//
// The interface below knows nothing of Tix: a statement is { name, domain: extent keys, axes, reads: [{array, map}] }
// with `map` a list of affine forms { constant, terms: [[name, coefficient]] } over the statement's axes.
// usage: node 05-fusion-legality-as-dependence-distance.mjs   (after `npm run build`)
import { readFileSync, readdirSync } from 'node:fs';
import { dist, at } from './00-root.mjs';
const { parse } = await dist('tensor/parser.js');
const { planFusion } = await dist('tensor/fusion.js');
const { visit } = await dist('tensor/model.js');

// ---------- domain-independent part ----------
/** Affine a - b as a canonical string; '0' means the two forms are equal. */
const minus = (a, b) => {
  const t = new Map(a.terms); for (const [n, k] of b.terms) t.set(n, (t.get(n) ?? 0) - k);
  const terms = [...t].filter(([, k]) => k !== 0).sort(); const c = a.constant - b.constant;
  return terms.length || c ? JSON.stringify([c, terms]) : '0';
};
const axis = name => ({ constant: 0, terms: [[name, 1]] });
/** The distance vector of one read, by position: consumer axis p minus the read's index p. */
const distance = (stmt, read) => read.map.map((f, p) => (p < stmt.axes.length ? minus(axis(stmt.axes[p]), f) : 'n/a'));
/** The number of leading loops producer group and consumer can share in parallel; 0 if they cannot be fused. */
function commonParallelDepth(consumer, members, depth) {
  const names = new Set(members.map(m => m.name));
  const reads = consumer.reads.filter(r => names.has(r.array));
  if (!reads.length) return 0;                                   // no dependence: this plan does not fuse siblings
  let k = Math.min(depth, consumer.axes.length);
  for (let p = 0; p < k; p++) if (consumer.domain[p] !== members[0].domain[p]) { k = p; break; }
  for (const r of reads) { const d = distance(consumer, r); for (let p = 0; p < k; p++) if (d[p] !== '0') { k = p; break; } }
  return k;
}
/** Greedy contiguous grouping, the same policy as planFusion; the legality question is the function above. */
function groups(stmts) {
  const runs = [];
  for (const s of stmts) {
    const cur = runs.at(-1), k = cur ? commonParallelDepth(s, cur.members, cur.depth) : 0;
    if (k > 0) { cur.members.push(s); cur.depth = k; } else runs.push({ members: [s], depth: s.axes.length });
  }
  return runs.map(r => ({ statements: r.members.map(m => m.name), depth: r.depth }));
}
// ---------- the Tix instance: 9 lines ----------
const instance = fn => fn.statements.map(s => {
  const reads = []; visit(s.expr, e => { if (e.kind === 'load') reads.push({ array: e.name, map: e.indices }); });
  return { name: s.name, axes: s.axes.map(a => a.id), domain: s.shape.map(d => JSON.stringify(d)), reads };
});

const sources = readdirSync(at('corpus/tensor')).map(d => [d, readFileSync(at(`corpus/tensor/${d}/main.tix`), 'utf8')]);
sources.push(
  ['shifted read across rows', 'fn f(x: f32[N,D]): f32[N-1,D] { a[i,j] = x[i,j] * 2; b[i,j]: f32[N-1,D] = a[i + 1, j] * 3; return b; }'],
  ['transposed read', 'fn f(x: f32[N,N]): f32[N,N] { a[i,j] = x[i,j] * 2; b[i,j] = a[j,i] + 1; return b; }'],
  ['row then column', 'fn f(x: f32[N,D]): f32[N,D] { m[i] = sum(j) x[i,j]; c[i,j] = x[i,j] - m[i]; v[j] = sum(i) c[i,j]; y[i,j] = c[i,j] / v[j]; return y; }'],
  // added by the synthesis: a constant outer index, a reduction consumer of a producer, a broadcast read
  ['constant outer index', 'fn f(x: f32[N,D]): f32[N,D] { a[i,j] = x[i,j] * 2; b[i,j]: f32[N,D] = a[0, j] + 1; return b; }'],
  ['reduction consumer', 'fn f(x: f32[N,D]): f32[N] { a[i,j] = x[i,j] * 2; s[i] = sum(j) a[i,j]; return s; }'],
  ['broadcast read', 'fn f(x: f32[N], w: f32[D]): f32[N,D] { a[i] = x[i] * 2; b[i,j] = a[i] * w[j]; return b; }'],
  ['shifted read in the inner axis', 'fn f(x: f32[N,D]): f32[N,D-1] { a[i,j] = x[i,j] * 2; b[i,j]: f32[N,D-1] = a[i, j + 1] * 3; return b; }'],
);
let same = 0, total = 0;
for (const [name, text] of sources) {
  for (const fn of parse(text).functions) {
    const theirs = planFusion(fn).groups.map(g => ({ statements: g.statements, depth: g.depth }));
    const ours = groups(instance(fn));
    const ok = JSON.stringify(theirs) === JSON.stringify(ours); total++; if (ok) same++;
    console.log((ok ? 'same  ' : 'DIFFER'), name.padEnd(30), ours.map(g => `[${g.statements.join(' ')}]@${g.depth}`).join(' '));
    if (!ok) console.log('       planFusion:', JSON.stringify(theirs));
  }
}
console.log(`${same}/${total} functions: the dependence-distance test gives planFusion's groups and depths`);
