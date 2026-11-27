// IRWB-038-C probe 04: can the framework's existing monotone solver (src/framework/dataflow/solver.ts) express a
// flow-insensitive binding-time analysis, as B1 cells F (pe.ts:76) and G (bta.ts:65) wrote by hand?
// Encoding: the "flow graph" is the def-use dependence graph (a node per local, an edge from each local to every
// local whose assignment reads it), plus a virtual entry with an edge to every node so all are reachable. The
// lattice is two points, S below D. transfer(local) = D if some assignment of it reads a dynamic source (an unbound
// parameter, a load from non-constant memory), else the join of its dependencies (in).
// This is the least fixpoint of the division, the same division the cells' greatest fixpoint over "static" computes.
import { solve } from '../../../../../../dist/framework/dataflow/solver.js';
// A toy dispatch loop: pc = 0; loop { op = code[pc]; acc = acc OP x; pc = pc + 1 }; code is a promised constant buffer.
const program = {
  pc: { reads: ['pc'], dynamicSource: false },   // pc = 0 | pc + 1
  op: { reads: ['pc'], dynamicSource: false },   // op = load(code, pc), code is constant
  acc: { reads: ['acc', 'op', 'x'], dynamicSource: false },
  x: { reads: [], dynamicSource: true },         // unbound parameter
  tmp: { reads: ['acc'], dynamicSource: false },
};
const locals = Object.keys(program);
const users = l => locals.filter(u => program[u].reads.includes(l));
const ENTRY = '^entry';
const graph = {
  entry: ENTRY,
  blocks: [ENTRY, ...locals],
  succ: b => (b === ENTRY ? locals : users(b)),
  preds: b => (b === ENTRY ? [] : [ENTRY, ...program[b].reads]),
};
const twoPoint = {
  name: 'binding-time', infiniteHeight: false,
  bottom: () => 'S', join: (a, b) => (a === 'D' || b === 'D' ? 'D' : 'S'), equal: (a, b) => a === b,
  encode: v => v, decode: v => v,
};
const sol = solve(graph, {
  direction: 'forward', lattice: twoPoint, boundary: 'S',
  transfer: (b, input) => (b === ENTRY ? 'S' : program[b].dynamicSource ? 'D' : input),
});
console.log(Object.fromEntries(locals.map(l => [l, sol.out.get(l)])), 'iterations:', sol.iterations);
const expected = { pc: 'S', op: 'S', acc: 'D', x: 'D', tmp: 'D' };
console.log('matches the expected division:', locals.every(l => sol.out.get(l) === expected[l]));
