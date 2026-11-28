// IRWB-047-B: the standard library's graph primitives — depth-first orders (postorder, reverse postorder,
// retreating edges), immediate dominators with the dominator tree and `dominates`, and natural loops, one per
// header with all its latches. Every expectation is written out and was read off
// ttmp/2026/11/27/IRWB-047-B-*/scripts/01-graph-primitives.mjs, then checked by hand; the graphs are:
//   A   a loop whose header has one outside predecessor (a preheader)
//   A2  the same loop with a second outside predecessor (no single preheader)
//   B   a block no path from the entry reaches, and a self-loop on another one
//   C   two back edges to one header (a `continue` shape), the IRWB-034-G fix
//   D   an irreducible two-entry cycle
// The two clients are checked too: the framework solver's depthFirst and Typed's cfgOf/dominatorsOf/loopsOf.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  depthFirst,
  dominates,
  dominators,
  dominatorTree,
  naturalLoops,
  predecessors,
} from '../../dist/stdlib/index.js';
import { depthFirst as solverDepthFirst } from '../../dist/framework/dataflow/solver.js';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { projectSource, ingestProject } = await import('../../dist/typed/project.js');
const { projectFiles } = await import('../../tools/corpus.mjs');
const { storeOf } = await import('../../dist/typed/ir.js');
const A = await import('../../dist/typed/analyses.js');

/** A digraph from `(from, to)` edges; nodes are listed in first-mention order with the entry first. */
const graph = (entry, edges) => {
  const nodes = [entry, ...new Set(edges.flat())].filter((n, i, a) => a.indexOf(n) === i);
  const succ = new Map(nodes.map(n => [n, []]));
  for (const [from, to] of edges) succ.get(from).push(to);
  return { nodes, entry, succ: n => succ.get(n) };
};
const pair = (a, b) => [a, b];

test('graph: depth-first orders on a loop: postorder, reverse postorder, retreating edges', () => {
  // e -> a -> c; c -> d and c -> x; d -> c (the back edge); x exits.
  const g = graph('e', [
    pair('e', 'a'),
    pair('a', 'c'),
    pair('c', 'd'),
    pair('c', 'x'),
    pair('d', 'c'),
  ]);
  const d = depthFirst(g);
  // postorder lists a node after every node it reaches: d and x finish before c, c before a, a before e
  assert.deepEqual(d.postorder, ['d', 'x', 'c', 'a', 'e']);
  assert.deepEqual(d.rpo, ['e', 'a', 'c', 'x', 'd']);
  // taking d -> c meets c still on the stack; that is the only edge of the walk that retreats
  assert.deepEqual(d.retreating, [{ from: 'd', to: 'c' }]);
  assert.deepEqual([...predecessors(g)], [
    ['e', []],
    ['a', ['e']],
    ['c', ['a', 'd']],
    ['d', ['c']],
    ['x', ['c']],
  ]);
});

test('graph: dominators, the dominator tree and dominates, on the same loop', () => {
  const g = graph('e', [
    pair('e', 'a'),
    pair('a', 'c'),
    pair('c', 'd'),
    pair('c', 'x'),
    pair('d', 'c'),
  ]);
  const dom = dominators(g);
  assert.deepEqual([...dom.idom], [
    ['e', 'e'],
    ['a', 'e'],
    ['c', 'a'],
    ['x', 'c'],
    ['d', 'c'],
  ]);
  assert.deepEqual(dom.rpo, ['e', 'a', 'c', 'x', 'd']);
  // one sweep sets every immediate dominator; the second sweep changes nothing and ends the iteration
  assert.equal(dom.rounds, 2);
  assert.deepEqual([...dominatorTree(dom.idom)], [
    ['e', ['a']],
    ['a', ['c']],
    ['c', ['x', 'd']],
    ['x', []],
    ['d', []],
  ]);
  // the entry dominates everything; a dominates d although a is not d's immediate dominator; the header
  // dominates its latch; a does not dominate the exit's sibling path
  assert.equal(dominates(dom.idom, 'e', 'd'), true);
  assert.equal(dominates(dom.idom, 'a', 'd'), true);
  assert.equal(dominates(dom.idom, 'c', 'd'), true);
  assert.equal(dominates(dom.idom, 'd', 'c'), false);
  assert.equal(dominates(dom.idom, 'd', 'x'), false);
  assert.equal(dominates(dom.idom, 'e', 'e'), true);
});

test('graph: one natural loop, its exits, and the preheader rule', () => {
  const loop = graph('e', [
    pair('e', 'a'),
    pair('a', 'c'),
    pair('c', 'd'),
    pair('c', 'x'),
    pair('d', 'c'),
  ]);
  assert.deepEqual(naturalLoops(loop), [
    { header: 'c', latches: ['d'], body: ['c', 'd'], exits: ['x'], preheader: 'a' },
  ]);
  // a second outside predecessor to the header: the loop is the same, but there is no single node to put
  // once-per-loop work in, so the preheader is null
  const two = graph('e', [
    pair('e', 'a'),
    pair('e', 'b'),
    pair('a', 'c'),
    pair('b', 'c'),
    pair('c', 'd'),
    pair('c', 'x'),
    pair('d', 'c'),
  ]);
  assert.deepEqual(naturalLoops(two), [
    { header: 'c', latches: ['d'], body: ['c', 'd'], exits: ['x'], preheader: null },
  ]);
});

test('graph: an unreachable block is in no order, no dominator tree — but its self-loop is a natural loop', () => {
  // u is named as a successor by nobody reachable and jumps to t and to itself; the entry is not nodes[0]
  const g = {
    nodes: ['u', 'e', 't'],
    entry: 'e',
    succ: n => ({ e: ['t'], u: ['t', 'u'], t: [] })[n],
  };
  const d = depthFirst(g);
  // the orders start at the entry, so u is in neither
  assert.deepEqual(d.postorder, ['t', 'e']);
  assert.deepEqual(d.rpo, ['e', 't']);
  assert.deepEqual(d.retreating, []);
  const dom = dominators(g);
  // u has no immediate dominator (absent, not null); every reachable node has one
  assert.deepEqual([...dom.idom], [
    ['e', 'e'],
    ['t', 'e'],
  ]);
  assert.equal(dom.idom.has('u'), false);
  assert.deepEqual([...dominatorTree(dom.idom).keys()], ['e', 't']);
  // dominance is reflexive, so u dominates itself and nothing else dominates it
  assert.equal(dominates(dom.idom, 'u', 'u'), true);
  assert.equal(dominates(dom.idom, 'e', 'u'), false);
  assert.equal(dominates(dom.idom, 'u', 't'), false);
  // the moved code has always reported this: dominance does not filter on reachability, so an unreachable
  // self-loop is a natural loop of an unreachable header, with the reachable successor as its exit
  assert.deepEqual(naturalLoops(g), [{ header: 'u', latches: ['u'], body: ['u'], exits: ['t'], preheader: null }]);
});

test('graph: a loop with two back edges to one header is one loop with two latches', () => {
  // h is the header; its two arms both jump back (a `continue`, or a dispatch loop whose arms jump back).
  const g = graph('e', [
    pair('e', 'h'),
    pair('h', 'a'),
    pair('h', 'x'),
    pair('a', 'l1'),
    pair('a', 'l2'),
    pair('l1', 'h'),
    pair('l2', 'h'),
  ]);
  const d = depthFirst(g);
  assert.deepEqual(d.postorder, ['l1', 'l2', 'a', 'x', 'h', 'e']);
  assert.deepEqual(d.retreating, [
    { from: 'l1', to: 'h' },
    { from: 'l2', to: 'h' },
  ]);
  // one loop per header (IRWB-034-G), not one per back edge: both latches, and a body that includes both
  // arms — one loop per back edge would give two loops whose bodies exclude each other's latch
  assert.deepEqual(naturalLoops(g), [
    { header: 'h', latches: ['l1', 'l2'], body: ['h', 'l2', 'a', 'l1'], exits: ['x'], preheader: 'e' },
  ]);
});

test('graph: an irreducible two-entry cycle has a retreating edge and no natural loop', () => {
  // e branches to a and b; a <-> b; both leave to x. Neither a nor b dominates the other, so there is no
  // dominance back edge and no natural loop: a natural loop is a reducible notion.
  const g = graph('e', [
    pair('e', 'a'),
    pair('e', 'b'),
    pair('a', 'b'),
    pair('b', 'a'),
    pair('a', 'x'),
    pair('b', 'x'),
  ]);
  const d = depthFirst(g);
  assert.deepEqual(d.postorder, ['x', 'b', 'a', 'e']);
  assert.deepEqual(d.rpo, ['e', 'a', 'b', 'x']);
  // the walk still retreats: b -> a meets a on the stack. A dataflow solver widens at a; a loop pass sees
  // nothing, because the cycle has two entries
  assert.deepEqual(d.retreating, [{ from: 'b', to: 'a' }]);
  const dom = dominators(g);
  assert.deepEqual([...dom.idom], [
    ['e', 'e'],
    ['a', 'e'],
    ['b', 'e'],
    ['x', 'e'],
  ]);
  assert.equal(dominates(dom.idom, 'a', 'b'), false);
  assert.equal(dominates(dom.idom, 'b', 'a'), false);
  assert.deepEqual(naturalLoops(g), []);
});

test('graph: the framework solver walks the library order and widens at the retreating targets', () => {
  const g = graph('e', [
    pair('e', 'h'),
    pair('h', 'a'),
    pair('h', 'x'),
    pair('a', 'l1'),
    pair('a', 'l2'),
    pair('l1', 'h'),
    pair('l2', 'h'),
  ]);
  const flow = {
    entry: 'e',
    blocks: g.nodes,
    succ: n => g.succ(n),
    preds: () => [],
  };
  const r = solverDepthFirst(flow);
  assert.deepEqual(r.postorder, depthFirst(g).postorder);
  assert.deepEqual([...r.loopHeads], ['h']);
});

test('graph: Typed’s analyses are the library’s answers on the corpus', () => {
  for (const id of ['blend', 'regex-nfa']) {
    const st = storeOf(ingestProject(projectSource(id, projectFiles(id))).value);
    let loops = 0;
    for (const f of st.fns.values()) {
      const cfg = A.cfgOf(f);
      // the digraph the analyses pass: block ids, the first block, successors restricted to blocks
      const g = {
        nodes: f.blocks.map(b => b.id),
        entry: f.blocks[0].id,
        succ: b => (cfg.succ[b] ?? []).filter(s => cfg.succ[s]),
      };
      assert.deepEqual(cfg.rpo, depthFirst(g).rpo, `${id}/${f.name}: rpo`);
      const lib = dominators(g),
        d = A.dominatorsOf(f);
      assert.deepEqual(d.rpo, lib.rpo);
      assert.equal(d.rounds, lib.rounds);
      assert.deepEqual(Object.entries(d.idom), [...lib.idom], `${id}/${f.name}: idom`);
      const v = A.domView(d);
      assert.deepEqual([...v.children], [...dominatorTree(lib.idom)]);
      for (const [a, b] of [...lib.idom.keys()].flatMap(a => [...lib.idom.keys()].map(b => [a, b])))
        assert.equal(v.dominates(a, b), dominates(lib.idom, a, b), `${id}/${f.name}: ${a} dom ${b}`);
      const ls = A.loopsOf(st, f),
        nls = naturalLoops(g);
      assert.deepEqual(
        ls.map(L => [L.head, L.latches, L.body, L.exits, L.preheader, L.id]),
        nls.map(L => [L.header, L.latches, L.body, L.exits, L.preheader, `loop:${f.name}@${L.header}`]),
        `${id}/${f.name}: loops`,
      );
      loops += ls.length;
    }
    assert.ok(loops > 0, `${id}: the corpus functions have loops to compare`);
  }
});
