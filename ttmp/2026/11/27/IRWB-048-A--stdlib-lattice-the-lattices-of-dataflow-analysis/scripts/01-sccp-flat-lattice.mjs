// IRWB-048-A probe 01: is SCCP's private three-level lattice (src/typed/sccp.ts) the library's flat lattice?
// The brief says: make SCCP use it if it is the same lattice; if not, say why and leave it. This probe prints
// the operation tables side by side, so the report's claim is checked, not asserted:
//   - SCCP is a *reductive* analysis: names start at TOP and descend; its operation is `meet`, whose identity
//     is TOP and whose absorbent (two distinct constants) is BOT. The library's flat lattice is oriented the
//     other way: join ascends, 'unknown' (BOT) is the identity and 'varies' (TOP) the absorbent.
//   - SCCP's constants carry an i32/f32 tag (1 i32 and 1 f32 are different values); the library's Flat<T>
//     compares untyped JSON.
// The two are the same three levels with the ORDER REVERSED — the dual lattice — and the Lattice interface
// fixes the orientation (bottom(), join), so SCCP would have to call join for meet and bottom for top.
import { meet } from '../../../../../../dist/typed/sccp.js';
import { flatLattice, BOT, TOP } from '../../../../../../dist/stdlib/index.js';

const TOPV = { k: 'top' },
  BOTV = { k: 'bot' },
  one = { k: 'const', v: 1, t: 'i32' },
  two = { k: 'const', v: 2, t: 'i32' },
  oneF = { k: 'const', v: 1, t: 'f32' };
const L = flatLattice();

console.log('SCCP (meet, identity TOP, absorbent BOT)   | library flat (join, identity BOT, absorbent TOP)');
for (const [a, b] of [
  [TOPV, one],
  [one, TOPV],
  [one, one],
  [one, two],
  [one, BOTV],
  [one, oneF],
]) {
  const la = a.k === 'const' ? { value: { v: a.v, t: a.t } } : a.k === 'top' ? BOT : TOP;
  const lb = b.k === 'const' ? { value: { v: b.v, t: b.t } } : b.k === 'top' ? BOT : TOP;
  const m = meet(a, b),
    j = L.join(la, lb);
  const show = x => (x.k === 'top' ? 'TOP' : x.k === 'bot' ? 'BOT' : `const(${x.v}:${x.t})`);
  const showF = x =>
    x === BOT ? "BOT('unknown')" : x === TOP ? "TOP('varies')" : `value(${JSON.stringify(x.value)})`;
  // the library value mapped back to SCCP's orientation (library BOT = SCCP TOP and vice versa)
  const toSccp = x => (x === BOT ? TOPV : x === TOP ? BOTV : { k: 'const', v: x.value.v, t: x.value.t });
  const via = toSccp(j),
    sameS = (p, q) => p.k === q.k && (p.k !== 'const' || (p.v === q.v && p.t === q.t));
  console.log(
    `  meet(${show(a)}, ${show(b)}) = ${show(m).padEnd(16)} | join(${showF(la)}, ${showF(lb)}) = ${showF(j).padEnd(20)} agrees (as duals): ${sameS(m, via)}`,
  );
}
console.log(
  "\nSame three levels, opposite order: SCCP's lattice is the library flat lattice's DUAL, not itself.",
);
console.log(
  'SCCP needs meet over typed constants; the Lattice interface fixes bottom+join over untyped JSON.',
);
