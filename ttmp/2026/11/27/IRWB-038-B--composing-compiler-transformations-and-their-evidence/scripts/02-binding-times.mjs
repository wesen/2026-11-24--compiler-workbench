// Compare the B1-G offline division with the merged solver on a dependence graph.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const at = p => import(pathToFileURL(resolve(p)));
const { solve } = await at('dist/framework/dataflow/solver.js');
const { setLattice } = await at('dist/framework/dataflow/lattices.js');
const { bindingTimes } = await at('../b1-fa-irwb-036-g/src/typed/bta.ts');

// local 0 is an unknown parameter. Assignments 1 <- 2, 2 <- 1, 2 <- 0
// require propagation around a cycle. Local 3 starts at zero and stays static.
const assignments = [[1, 2], [2, 1], [2, 0]];
const store = new Map();
const statements = assignments.map(([lhs, rhs], i) => {
  const value = 'v' + i, id = 's' + i;
  store.set(value, {op: 'get', imm: rhs, args: []});
  store.set(id, {id, op: 'set', local: lhs, value});
  return id;
});
const locals = [0,1,2,3].map(index => ({index, param: index === 0}));
const fn = {locals, blocks:[{stmts: statements}]};
const division = bindingTimes(store, fn, new Set(), new Set());
assert.deepEqual([...division.static], [3]);

// Order by inclusion of possible dynamic sources. A node accumulates taint
// from its dependencies. Entry also reaches independent constant components.
const nodes = locals.map(l => String(l.index));
const edges = [...nodes.map(n => ['entry', n]), ...assignments.map(([l,r]) => [String(r), String(l)])];
const graph = {
  entry:'entry', blocks:['entry', ...nodes],
  preds: n => edges.filter(([,to]) => to === n).map(([from]) => from),
  succ: n => edges.filter(([from]) => from === n).map(([,to]) => to)
};
for (const strategy of ['worklist', 'round-robin']) {
  const result = solve(graph, { direction:'forward', strategy, lattice:setLattice(),
    transfer: (n, input) => n === '0' ? new Set(['unbound']) : input });
  const staticLocals = nodes.filter(n => !result.out.get(n).size).map(Number);
  assert.deepEqual(staticLocals, [...division.static]);
  console.log(strategy, 'static', staticLocals, 'visits', result.iterations);
}
