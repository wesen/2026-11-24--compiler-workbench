// IRWB-047-A: the standard library's graph primitives (IRWB-039 phase 2c). Every primitive on small
// graphs with hand-computed answers, on the three cases where implementations disagree:
//   - an unreachable block: the depth-first walk never reaches it, so it has no order and no idom,
//     `dominates` is false for it (except the a === b short-circuit, which makes a self-edge at it
//     a back edge — a natural loop of one node, as Typed's loopsOf already reported);
//   - a loop with two back edges to one header: ONE natural loop whose `latches` holds both;
//   - an irreducible (two-entry) cycle: the walk still finds a retreating edge in it (so a solver
//     widens at its target), but by the dominance definition neither entry is a header, so
//     `naturalLoops` returns no loop there — retreating edges and back edges are different notions.
// The framework solver's `depthFirst` is pinned too: it maps the library's retreating edges to the
// loop-head set widening sits on (the machine client of the walk, as regalloc is liveness's).
import test from 'node:test';
import assert from 'node:assert/strict';
import { depthFirst, dominators, domTree, naturalLoops } from '../../dist/stdlib/index.js';
import { depthFirst as solverDepthFirst } from '../../dist/framework/dataflow/solver.js';

const graph = (succ, entry = 'e') => ({
  entry,
  nodes: Object.keys(succ),
  succ: b => succ[b] ?? [],
});

test('depthFirst: postorder, reverse postorder and no retreating edges on a diamond', () => {
  // e -> a, b; a -> c; b -> c. The walk marks a node before its successors and orders it after them.
  const d = depthFirst(graph({ e: ['a', 'b'], a: ['c'], b: ['c'], c: [] }));
  assert.deepEqual(d.postorder, ['c', 'a', 'b', 'e']);
  assert.deepEqual(d.reversePostorder, ['e', 'b', 'a', 'c']);
  assert.deepEqual(d.retreating, []);
});

test('depthFirst: a retreating edge per back edge, self-loops included', () => {
  // e -> o; o -> i, t; i -> i, o (both a self-loop and a back edge); t exits.
  const d = depthFirst(graph({ e: ['o'], o: ['i', 't'], i: ['i', 'o'], t: [] }));
  assert.deepEqual(d.postorder, ['i', 't', 'o', 'e']);
  assert.deepEqual(d.reversePostorder, ['e', 'o', 't', 'i']);
  assert.deepEqual(d.retreating, [
    ['i', 'i'],
    ['i', 'o'],
  ]);
});

test('dominators and domTree: immediate dominators, children and the dominates query', () => {
  // The nested loop of the previous test: e dominates all; o dominates i and t; i dominates nothing.
  const g = graph({ e: ['o'], o: ['i', 't'], i: ['i', 'o'], t: [] });
  const d = dominators(g);
  assert.deepEqual([...d.idom], [
    ['e', 'e'],
    ['o', 'e'],
    ['t', 'o'],
    ['i', 'o'],
  ]); // key order: entry first, then reverse postorder (facts are published as JSON)
  assert.deepEqual(d.rpo, ['e', 'o', 't', 'i']);
  assert.equal(d.rounds, 2);
  const tree = domTree(d);
  assert.deepEqual(tree.children.get('e'), ['o']);
  assert.deepEqual(tree.children.get('o'), ['t', 'i']);
  assert.equal(tree.dominates('e', 'i'), true);
  assert.equal(tree.dominates('o', 'i'), true);
  assert.equal(tree.dominates('i', 'i'), true); // a node dominates itself
  assert.equal(tree.dominates('i', 'e'), false);
  assert.equal(tree.dominates('t', 'i'), false);
});

test('dominators: a join reached from both sides is dominated by the fork only', () => {
  // The diamond: c is reached through a and through b, so only e dominates it.
  const d = dominators(graph({ e: ['a', 'b'], a: ['c'], b: ['c'], c: [] }));
  assert.deepEqual(Object.fromEntries(d.idom), { e: 'e', b: 'e', a: 'e', c: 'e' });
  assert.equal(d.rounds, 2);
  assert.equal(domTree(d).dominates('a', 'c'), false);
});

test('naturalLoops: nested loops, inner first, one per header', () => {
  // e -> o -> {i, t}; i loops to itself and to o. The inner loop (head i) is found before the outer
  // (head o) because its first back edge comes first in node order; each has its only latch i.
  const g = graph({ e: ['o'], o: ['i', 't'], i: ['i', 'o'], t: [] });
  const dom = domTree(dominators(g));
  assert.deepEqual(naturalLoops(g, dom.dominates), [
    { head: 'i', latches: ['i'], body: ['i'] },
    { head: 'o', latches: ['i'], body: ['o', 'i'] },
  ]);
});

test('naturalLoops: one loop for a header with two back edges, both latches in it', () => {
  // e -> h; h -> x, y; x -> h; y -> h. One loop headed at h — not one per back edge (IRWB-034-G) —
  // with latches in node order; the body walks predecessors from the latches, last-visited first.
  const g = graph({ e: ['h'], h: ['x', 'y'], x: ['h'], y: ['h'] });
  const dom = domTree(dominators(g));
  assert.deepEqual(naturalLoops(g, dom.dominates), [
    { head: 'h', latches: ['x', 'y'], body: ['h', 'y', 'x'] },
  ]);
});

test('the unreachable block: no order, no idom, dominates nothing, but a self-edge is a back edge', () => {
  // e -> x; the unreachable u jumps to x and to itself. Statement per primitive:
  //   depthFirst   u is in none of the orders, and no edge of the walk touches it;
  //   dominators   u has no idom entry and is in no rpo;
  //   domTree       dominates(u, v) is false for every v but u itself (the a === b short-circuit);
  //   naturalLoops  u -> u is a back edge (u dominates itself), so a one-node loop at u is reported —
  //                 the same facts Typed's loopsOf published before the move.
  const g = graph({ e: ['x'], u: ['x', 'u'], x: [] });
  const walk = depthFirst(g);
  assert.deepEqual(walk.postorder, ['x', 'e']);
  assert.deepEqual(walk.reversePostorder, ['e', 'x']);
  assert.deepEqual(walk.retreating, []);
  const d = dominators(g);
  assert.deepEqual([...d.idom], [
    ['e', 'e'],
    ['x', 'e'],
  ]);
  const tree = domTree(d);
  assert.equal(tree.dominates('u', 'x'), false);
  assert.equal(tree.dominates('x', 'u'), false);
  assert.equal(tree.dominates('u', 'u'), true);
  assert.deepEqual(naturalLoops(g, tree.dominates), [{ head: 'u', latches: ['u'], body: ['u'] }]);
});

test('the irreducible cycle: a retreating edge but no back edge, so no natural loop', () => {
  // e enters the cycle at p and at q; p -> q -> p. Statement per primitive:
  //   depthFirst    the q -> p edge is retreating (p is still on the walk's path), so a solver that
  //                 widens at retreating targets widens at p;
  //   dominators    neither p nor q dominates the other (each is reached from e the other way round),
  //                 so both have immediate dominator e;
  //   naturalLoops  no edge has a target that dominates its source, so the cycle is no natural loop.
  const g = graph({ e: ['p', 'q'], p: ['q'], q: ['p'] });
  const walk = depthFirst(g);
  assert.deepEqual(walk.reversePostorder, ['e', 'p', 'q']);
  assert.deepEqual(walk.retreating, [['q', 'p']]);
  const d = dominators(g);
  assert.deepEqual(Object.fromEntries(d.idom), { e: 'e', p: 'e', q: 'e' });
  const tree = domTree(d);
  assert.equal(tree.dominates('p', 'q'), false);
  assert.equal(tree.dominates('q', 'p'), false);
  assert.deepEqual(naturalLoops(g, tree.dominates), []);
});

test('the framework solver maps the walk to postorder and loop-head sets', () => {
  // The solver keeps its own depthFirst over FlowGraph (blocks, preds) as an adapter: postorder for
  // the sweep, and the retreating edges' targets as the set widening sits on.
  const diamond = { entry: 'e', blocks: ['e', 'a', 'b', 'c'], succ: b => ({ e: ['a', 'b'], a: ['c'], b: ['c'], c: [] })[b], preds: () => [] };
  assert.deepEqual(solverDepthFirst(diamond), { postorder: ['c', 'a', 'b', 'e'], loopHeads: new Set() });
  const loop = { entry: 'e', blocks: ['e', 'h', 'x', 'y'], succ: b => ({ e: ['h'], h: ['x', 'y'], x: ['h'], y: ['h'] })[b], preds: () => [] };
  const r = solverDepthFirst(loop);
  assert.deepEqual(r.postorder, ['x', 'y', 'h', 'e']);
  assert.deepEqual([...r.loopHeads], ['h']);
});
