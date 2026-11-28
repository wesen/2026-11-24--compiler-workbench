// IRWB-053-B: the standard library's fixpoint solver (IRWB-039 phase 2d), moved from
// framework/dataflow/solver.ts, and its second client, liveness rewritten on it.
//   - the forward and backward directions on small graphs with hand-computed fixpoints;
//   - a loop whose fact grows without bound: refused without `widen`, terminated by it at the loop head;
//   - an unreachable block: the solver reports it, at bottom, and never joins its facts;
//   - liveness through the solver equals the old hand-written sweep on generated graphs, under both
//     scopes — the old function is copied below, unchanged, as the oracle;
//   - the framework's re-export is the same function (the caller's import keeps working).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DataflowError,
  I32_MAX,
  intervalLattice,
  liveness,
  mapLattice,
  setLattice,
  solve,
} from '../../dist/stdlib/index.js';
import * as framework from '../../dist/framework/dataflow/solver.js';

/** A graph of named blocks with string edges. */
const graph = (entry, edges) => ({
  entry,
  blocks: Object.keys(edges),
  succ: b => edges[b] ?? [],
  preds: b => Object.keys(edges).filter(k => edges[k].includes(b)),
});

const sorted = set => [...set].sort();

test('flow: the forward direction converges to the hand-computed fixpoint', () => {
  //  A(entry) -> B;  B -> C, D;  C -> B (the back edge);  D exits. Each block adds its own name.
  const g = graph('A', { A: ['B'], B: ['C', 'D'], C: ['B'], D: [] });
  const gen = { A: ['a'], B: ['b'], C: ['c'], D: ['d'] };
  const r = solve(g, {
    direction: 'forward',
    lattice: setLattice(),
    transfer: (b, input) => new Set([...input, ...gen[b]]),
  });
  const inSet = b => sorted(r.in.get(b)),
    outSet = b => sorted(r.out.get(b));
  assert.deepEqual(inSet('A'), [], 'the boundary is bottom: the entry starts empty');
  assert.deepEqual(outSet('A'), ['a']);
  // B joins A's out with C's out, and C's out carries B's and its own name, so the loop moves it twice.
  assert.deepEqual(inSet('B'), ['a', 'b', 'c']);
  assert.deepEqual(outSet('B'), ['a', 'b', 'c']);
  assert.deepEqual(inSet('C'), ['a', 'b', 'c']);
  assert.deepEqual(inSet('D'), ['a', 'b', 'c']);
  assert.deepEqual(outSet('D'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(r.loopHeads, ['B']);
  assert.deepEqual([...r.in.keys()].sort(), ['A', 'B', 'C', 'D']);
});

test('flow: the backward direction converges to the hand-computed fixpoint', () => {
  // The same graph, solved backwards with gen/kill:  in(b) = gen(b) ∪ (out(b) \ kill(b)).
  const g = graph('A', { A: ['B'], B: ['C', 'D'], C: ['B'], D: [] });
  const gen = { A: ['a'], B: ['b'], C: [], D: ['d'] },
    kill = { A: [], B: [], C: ['d'], D: [] };
  const transfer = (b, out) => {
    const live = new Set(gen[b]);
    for (const x of out) if (!kill[b].includes(x)) live.add(x);
    return live;
  };
  const r = solve(g, { direction: 'backward', lattice: setLattice(), transfer });
  const inSet = b => sorted(r.in.get(b)),
    outSet = b => sorted(r.out.get(b));
  assert.deepEqual(outSet('D'), [], 'D has no successors: the boundary is bottom');
  assert.deepEqual(inSet('D'), ['d']);
  // C kills d, so d dies on the way into C, and B, A never see it.
  assert.deepEqual(inSet('C'), ['b']);
  assert.deepEqual(inSet('B'), ['b', 'd']);
  assert.deepEqual(outSet('B'), ['b', 'd']);
  assert.deepEqual(inSet('A'), ['a', 'b', 'd']);
  // the same facts as a round-robin sweep, which the worklist must agree with on a finite-height lattice
  const rr = solve(g, { direction: 'backward', lattice: setLattice(), transfer, strategy: 'round-robin' });
  assert.deepEqual(inSet('A'), sorted(rr.in.get('A')));
  assert.equal(r.rounds, 0);
  assert.ok(rr.rounds > 0);
});

test('flow: a loop that needs widening is refused without it and terminates at the loop head with it', () => {
  //  entry -> head;  head -> body, exit;  body -> head. head increments a counter, so the interval at the
  //  head grows without bound: the lattice is of infinite height and the solver must either refuse or widen.
  const g = graph('entry', { entry: ['head'], head: ['body', 'exit'], body: ['head'], exit: [] });
  const intervals = mapLattice(intervalLattice());
  const step = name => (b, input) => {
    if (b === 'entry') return input;
    const r = input.get(name);
    return new Map(input).set(name, r ? [r[0], Math.min(r[1] + 1, I32_MAX)] : [0, 0]);
  };
  const boundary = new Map([['x', [0, 0]]]);
  assert.throws(
    () => solve(g, { direction: 'forward', lattice: intervals, boundary, transfer: step('x') }),
    e => e instanceof DataflowError && e.code === 'noWidening',
    'an infinite-height lattice without widen is refused',
  );
  const inner = intervals.inner;
  const r = solve(g, {
    direction: 'forward',
    lattice: intervals,
    boundary,
    transfer: step('x'),
    widen: (old, next) => {
      const out = new Map(next);
      for (const [k, v] of next) out.set(k, inner.widen(old.get(k) ?? null, v));
      return out;
    },
  });
  assert.deepEqual(r.loopHeads, ['head']);
  // the counter reaches the widened bound at the head and no further visit changes it
  assert.deepEqual(r.in.get('head').get('x'), [0, I32_MAX]);
  assert.deepEqual(r.out.get('entry').get('x'), [0, 0]);
  assert.deepEqual(r.in.get('exit').get('x'), [0, I32_MAX]);
  // a widening solver that never widens would visit the head far more often; the bound is loose but real
  assert.ok(r.iterations < 50, `widen after ${r.iterations} visits is not a widening solver`);
  // widenAfter defers the widening: the first visit refines, and the result is still a fixpoint
  const late = solve(g, {
    direction: 'forward',
    lattice: intervals,
    boundary,
    transfer: step('x'),
    widen: (old, next) => {
      const out = new Map(next);
      for (const [k, v] of next) out.set(k, inner.widen(old.get(k) ?? null, v));
      return out;
    },
    widenAfter: 3,
  });
  assert.deepEqual(late.in.get('head').get('x'), [0, I32_MAX]);
});

test('flow: an unreachable block is reported at bottom and never joins a fact', () => {
  //  A(entry) -> B;  B exits;  C -> B, and no path from A reaches C.
  const g = graph('A', { A: ['B'], B: [], C: ['B'] });
  const r = solve(g, {
    direction: 'forward',
    lattice: setLattice(),
    transfer: (b, input) => (b === 'A' ? new Set([...input, 'a']) : input),
  });
  assert.deepEqual(sorted(r.in.get('B')), ['a']);
  assert.deepEqual(sorted(r.in.get('C')), [], 'unreachable blocks keep bottom, forward');
  assert.deepEqual(sorted(r.out.get('C')), []);
  // backwards the same block would otherwise inherit B's fact through the edge C -> B: it must not.
  const back = solve(g, {
    direction: 'backward',
    lattice: setLattice(),
    transfer: (b, out) => out,
    boundary: new Set(['live']),
  });
  assert.deepEqual(sorted(back.in.get('B')), ['live']);
  assert.deepEqual(sorted(back.in.get('C')), [], 'unreachable blocks keep bottom, backward');
  assert.deepEqual(sorted(back.in.get('A')), ['live']);
});

test('flow: a graph whose entry is not a block is refused', () => {
  assert.throws(
    () => solve({ ...graph('A', { A: [] }), entry: 'Z' }, { direction: 'forward', lattice: setLattice(), transfer: (b, v) => v }),
    e => e instanceof DataflowError && e.code === 'badGraph',
  );
});

test('flow: the framework re-exports the library solver, and its depthFirst is the library flowOrder', () => {
  assert.equal(framework.solve, solve);
  assert.equal(framework.DataflowError, DataflowError);
  const order = framework.depthFirst(graph('A', { A: ['B'], B: ['C'], C: ['B'] }));
  assert.deepEqual([...order.loopHeads], ['B']);
  assert.deepEqual(order.postorder, ['C', 'B', 'A']);
});

// ---------- liveness through the solver against the old sweep ----------
// The old implementation (src/stdlib/flow/liveness.ts before IRWB-053-B), copied verbatim: the oracle.
function oldLiveness(graph, scope) {
  const blocks = graph.blocks;
  const solve = scope === 'all-blocks' ? null : oldReachableBlocks(graph);
  const use = blocks.map(b => b.uses),
    def = blocks.map(b => b.defs);
  const IN = blocks.map(() => new Set()),
    OUT = blocks.map(() => new Set());
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      if (solve && !solve.has(k)) continue;
      const out = new Set();
      for (const s of blocks[k].succ) for (const r of IN[s]) out.add(r);
      const inn = new Set(use[k]);
      for (const r of out) if (!def[k].has(r)) inn.add(r);
      if (inn.size !== IN[k].size || out.size !== OUT[k].size) {
        IN[k] = inn;
        OUT[k] = out;
        changed = true;
      }
    }
  }
  return { in: IN, out: OUT };
}
function oldReachableBlocks(graph) {
  const seen = new Set(),
    stack = [graph.entry ?? 0];
  while (stack.length) {
    const b = stack.pop();
    if (seen.has(b)) continue;
    seen.add(b);
    for (const s of graph.blocks[b].succ) if (!seen.has(s)) stack.push(s);
  }
  return seen;
}

/** A deterministic generator of small CFGs: n blocks, random edges (loops and unreachable blocks included). */
const generatedGraphs = (count, seed = 7) => {
  let s = seed;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const pick = n => Math.floor(rnd() * n);
  const graphs = [];
  for (let g = 0; g < count; g++) {
    const n = 1 + pick(7);
    const blocks = [];
    for (let k = 0; k < n; k++) {
      const uses = new Set(),
        defs = new Set();
      for (let v = 0; v < 5; v++) {
        if (rnd() < 0.3) uses.add(v);
        if (rnd() < 0.3) defs.add(v);
      }
      const succ = [];
      const out = pick(3); // 0..2 successors
      for (let i = 0; i < out; i++) succ.push(pick(n));
      blocks.push({ uses, defs, succ });
    }
    graphs.push({ blocks, ...(rnd() < 0.3 ? { entry: pick(n) } : {}) });
  }
  return graphs;
};

test('flow: liveness through the solver equals the old sweep on generated graphs, both scopes', () => {
  const graphs = generatedGraphs(300);
  let scoped = 0,
    unreachable = 0;
  for (const g of graphs) {
    for (const scope of ['all-blocks', 'entry-reachable']) {
      const got = liveness(g, scope),
        want = oldLiveness(g, scope);
      assert.equal(got.in.length, g.blocks.length);
      assert.equal(got.out.length, g.blocks.length);
      for (let k = 0; k < g.blocks.length; k++) {
        assert.deepEqual(sorted(got.in[k]), sorted(want.in[k]), `${scope} in[${k}] of ${JSON.stringify(g.blocks.map(b => b.succ))}`);
        assert.deepEqual(sorted(got.out[k]), sorted(want.out[k]), `${scope} out[${k}] of ${JSON.stringify(g.blocks.map(b => b.succ))}`);
      }
      if (scope === 'entry-reachable') {
        const reach = oldReachableBlocks(g);
        if (reach.size < g.blocks.length) unreachable++;
      } else scoped++;
    }
  }
  // the generator has to produce both shapes for the comparison to mean anything
  assert.ok(scoped > 0);
  assert.ok(unreachable > 20, `only ${unreachable} generated graphs have an unreachable block`);
});

test('flow: liveness on an empty graph, and the hand-written cases still hold', () => {
  assert.deepEqual(liveness({ blocks: [] }, 'all-blocks'), { in: [], out: [] });
  assert.deepEqual(liveness({ blocks: [] }, 'entry-reachable'), { in: [], out: [] });
  // block 1 is reached by nothing; the two scopes disagree on it and on nothing else
  const g = {
    blocks: [
      { uses: new Set(), defs: new Set(), succ: [2] },
      { uses: new Set(), defs: new Set(), succ: [2] },
      { uses: new Set([64, 65]), defs: new Set(), succ: [] },
    ],
  };
  assert.deepEqual(sorted(liveness(g, 'all-blocks').out[1]), [64, 65]);
  assert.deepEqual(sorted(liveness(g, 'entry-reachable').out[1]), []);
  // the entry index decides what 'entry-reachable' means
  const h = {
    blocks: [
      { uses: new Set(), defs: new Set(), succ: [1] },
      { uses: new Set([7]), defs: new Set(), succ: [] },
    ],
    entry: 1,
  };
  assert.deepEqual(sorted(liveness(h, 'entry-reachable').in[1]), [7]);
});
