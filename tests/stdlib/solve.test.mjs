// IRWB-053-A: the fixpoint solver in the standard library (moved from framework/dataflow/solver.ts).
//   - forward and backward problems on small graphs with fixpoints computed by hand;
//   - a loop that needs widening (the interval lattice) and the loop heads it widens at;
//   - an unreachable block: it keeps bottom and no reachable fact joins from it;
//   - the refusal cases (infinite height without a widening operator) and the two schedules agreeing
//     on a finite lattice;
//   - one copy, not two: the framework dataflow layer re-exports the library's own solver;
//   - liveness through the solver equals the old hand-rolled liveness on generated graphs, both
//     scopes, against a copy of the old function kept in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, DataflowError, liveness } from '../../dist/stdlib/index.js';
import { setLattice, intervalLattice } from '../../dist/stdlib/lattice/lattices.js';
import { solve as frameworkSolve, DataflowError as FrameworkError } from '../../dist/framework/dataflow/index.js';

const set = (...xs) => new Set(xs);
const same = (got, want) => assert.deepEqual([...got].sort(), [...want].sort());
// a flow graph from an edge list: `graph('e', ['e','a'], [['e','a']])`
const graph = (entry, blocks, edges) => {
  const succ = new Map(blocks.map(b => [b, []])),
    preds = new Map(blocks.map(b => [b, []]));
  for (const [f, t] of edges) succ.get(f).push(t), preds.get(t).push(f);
  return { entry, blocks, succ: b => succ.get(b), preds: b => preds.get(b) };
};

test('solve: a forward problem reaches its known fixpoint (gen along the way, branch joins)', () => {
  // out(b) = in(b) ∪ {b}; boundary {0} enters 'e'. Hand-computed:
  //   e: in {0}, out {0,e}; a: in {0,e}, out {0,e,a}; b: in {0,e}, out {0,e,b};
  //   x: in {0,e,a,b}, out {0,e,a,b,x}
  const g = graph('e', ['e', 'a', 'b', 'x'], [
    ['e', 'a'],
    ['e', 'b'],
    ['a', 'x'],
    ['b', 'x'],
  ]);
  const r = solve(g, {
    direction: 'forward',
    lattice: setLattice(),
    boundary: set(0),
    transfer: (b, v) => new Set([...v, b]),
  });
  same(r.in.get('e'), [0]);
  same(r.out.get('e'), [0, 'e']);
  same(r.in.get('a'), [0, 'e']);
  same(r.in.get('b'), [0, 'e']);
  same(r.in.get('x'), [0, 'e', 'a', 'b']);
  same(r.out.get('x'), [0, 'e', 'a', 'b', 'x']);
  assert.ok(r.iterations >= 4 && r.iterations < 20, `a sane visit count, not ${r.iterations}`);
});

test('solve: a backward problem reaches its known fixpoint (liveness equations, loop included)', () => {
  // e -> h -> {t, x}; t -> h (the back edge); x exits. uses/defs by hand:
  //   e defs 1; h uses 2 defs 3; t uses 3; x uses 1 and 2.
  // Fixpoint: in(x) = {1,2}; out(h) = in(t) ∪ in(x) = {1,2,3}; in(h) = {2} ∪ ({1,2,3} \ {3}) = {1,2};
  //   out(e) = in(h) = {1,2}; in(t) = {3} ∪ out(t) = {3} ∪ in(h) = {1,2,3}; out(t) = in(h) = {1,2}.
  const g = graph('e', ['e', 'h', 't', 'x'], [
    ['e', 'h'],
    ['h', 't'],
    ['h', 'x'],
    ['t', 'h'],
  ]);
  const uses = { e: set(), h: set(2), t: set(3), x: set(1, 2) };
  const defs = { e: set(1), h: set(3), t: set(), x: set() };
  const r = solve(g, {
    direction: 'backward',
    lattice: setLattice(),
    transfer: (b, out) => {
      const inn = new Set(uses[b]);
      for (const v of out) if (!defs[b].has(v)) inn.add(v);
      return inn;
    },
  });
  same(r.in.get('x'), [1, 2]);
  same(r.out.get('h'), [1, 2, 3]);
  same(r.in.get('h'), [1, 2]);
  same(r.out.get('e'), [1, 2]);
  same(r.in.get('t'), [1, 2, 3]);
  same(r.out.get('t'), [1, 2]);
  assert.deepEqual(r.loopHeads, ['h'], 'the back edge makes h the loop head');
});

test('solve: a loop that needs widening terminates at the widened fixpoint, at the loop head only', () => {
  // e -> h -> h -> x, boundary [0,0], transfer h: [lo, hi+1]. Without widening hi grows forever.
  // The interval lattice's own widen jumps a moved upper bound to the extreme, so h reaches [0,100].
  const g = graph('e', ['e', 'h', 'x'], [
    ['e', 'h'],
    ['h', 'h'],
    ['h', 'x'],
  ]);
  const lat = intervalLattice(0, 100);
  const r = solve(g, {
    direction: 'forward',
    lattice: lat,
    boundary: [0, 0],
    transfer: (b, [lo, hi]) => (b === 'h' ? [lo, Math.min(hi + 1, 100)] : [lo, hi]),
    widen: (old, next) => lat.widen(old, next),
  });
  assert.deepEqual(r.in.get('e'), [0, 0]);
  assert.deepEqual(r.in.get('h'), [0, 100], 'the widened loop head');
  assert.deepEqual(r.out.get('h'), [0, 100]);
  assert.deepEqual(r.in.get('x'), [0, 100]);
  assert.deepEqual(r.loopHeads, ['h']);
  // without a widening operator the solver refuses the infinite-height lattice
  assert.throws(
    () => solve(g, { direction: 'forward', lattice: lat, boundary: [0, 0], transfer: (b, v) => v }),
    e => e instanceof DataflowError && e.code === 'noWidening',
  );
});

test('solve: widening can wait (widenAfter), and the thresholds widen up-to them', () => {
  // the same growing loop, but widen only after two visits: the first visits refine, then one
  // widening step jumps to the next threshold and the next to the extreme.
  const g = graph('e', ['e', 'h', 'x'], [
    ['e', 'h'],
    ['h', 'h'],
    ['h', 'x'],
  ]);
  const lat = intervalLattice(0, 100, [10, 50]);
  const r = solve(g, {
    direction: 'forward',
    lattice: lat,
    boundary: [0, 0],
    transfer: (b, [lo, hi]) => (b === 'h' ? [lo, Math.min(hi + 1, 100)] : [lo, hi]),
    widen: (old, next) => lat.widen(old, next),
    widenAfter: 2,
  });
  assert.deepEqual(r.in.get('h'), [0, 100], 'still the widened fixpoint');
  assert.ok(r.iterations < 10, `refine-then-widen converges fast, not in ${r.iterations} visits`);
});

test('solve: an unreachable block keeps bottom and feeds no reachable fact', () => {
  // forward: e -> a; u -> a (u unreachable). a's in joins only out(e); u keeps bottom.
  const fwd = solve(graph('e', ['e', 'a', 'u'], [['e', 'a'], ['u', 'a']]), {
    direction: 'forward',
    lattice: setLattice(),
    boundary: set(0),
    transfer: (b, v) => new Set([...v, b]),
  });
  same(fwd.in.get('a'), [0, 'e']);
  assert.deepEqual([...fwd.in.get('u')], [], 'the unreachable block keeps bottom in');
  assert.deepEqual([...fwd.out.get('u')], [], 'and bottom out');
  // backward: e -> a -> x; u -> x. Nothing of u is in out(x), and u keeps bottom.
  const back = solve(graph('e', ['e', 'a', 'x', 'u'], [['e', 'a'], ['a', 'x'], ['u', 'x']]), {
    direction: 'backward',
    lattice: setLattice(),
    transfer: (b, v) => v,
  });
  assert.deepEqual([...back.out.get('x')], []);
  assert.deepEqual([...back.in.get('u')], []);
  assert.deepEqual([...back.out.get('u')], []);
  // the boundary fact reaches the exits: out(x) = {9} with a boundary, still nothing from u
  const bounded = solve(graph('e', ['e', 'a', 'x', 'u'], [['e', 'a'], ['a', 'x'], ['u', 'x']]), {
    direction: 'backward',
    lattice: setLattice(),
    boundary: set(9),
    transfer: (b, v) => v,
  });
  same(bounded.out.get('x'), [9]);
  assert.deepEqual([...bounded.in.get('u')], []);
  // a bad entry is refused
  assert.throws(
    () =>
      solve(graph('nope', ['e'], []), {
        direction: 'forward',
        lattice: setLattice(),
        transfer: (b, v) => v,
      }),
    e => e instanceof DataflowError && e.code === 'badGraph',
  );
});

test('solve: the worklist and the round-robin schedules agree on a finite lattice', () => {
  const diamond = graph('e', ['e', 'a', 'b', 'h', 'x'], [
    ['e', 'a'],
    ['e', 'b'],
    ['a', 'h'],
    ['b', 'h'],
    ['h', 'a'],
    ['h', 'x'],
  ]);
  const opts = over => ({
    direction: 'forward',
    lattice: setLattice(),
    boundary: set(0),
    transfer: (b, v) => new Set([...v, b]),
    ...over,
  });
  const work = solve(diamond, opts({ strategy: 'worklist' }));
  const rr = solve(diamond, opts({ strategy: 'round-robin' }));
  for (const b of diamond.blocks) {
    same(work.in.get(b), rr.in.get(b));
    same(work.out.get(b), rr.out.get(b));
  }
  assert.equal(work.rounds, 0);
  assert.ok(rr.rounds >= 2, `the sweeps ran, not ${rr.rounds}`);
});

test('solve: the framework dataflow layer re-exports the library solver, one copy not two', () => {
  assert.equal(frameworkSolve, solve);
  assert.equal(FrameworkError, DataflowError);
});

// ---------- liveness through the solver equals the old hand-rolled liveness ----------

/** The old liveness (IRWB-046-B), copied verbatim from src/stdlib/flow/liveness.ts before IRWB-053-A. */
function oldLiveness(graph_, scope) {
  const blocks = graph_.blocks;
  const solveSet = scope === 'all-blocks' ? null : reachable(graph_);
  const use = blocks.map(b => b.uses),
    def = blocks.map(b => b.defs);
  const IN = blocks.map(() => new Set()),
    OUT = blocks.map(() => new Set());
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      if (solveSet && !solveSet.has(k)) continue;
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
function reachable(graph_) {
  const seen = new Set(),
    stack = [graph_.entry ?? 0];
  while (stack.length) {
    const b = stack.pop();
    if (seen.has(b)) continue;
    seen.add(b);
    for (const s of graph_.blocks[b].succ) if (!seen.has(s)) stack.push(s);
  }
  return seen;
}

// mulberry32: a seeded generator, so a failure prints its seed and reproduces
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random LiveGraph: n blocks, 0-3 successors each, uses/defs from a small value pool. */
function gen(r, n) {
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const blocks = [];
  for (let k = 0; k < n; k++) {
    const succ = [];
    const m = Math.floor(r() * 4);
    for (let j = 0; j < m; j++) succ.push(Math.floor(r() * n));
    const uses = new Set(),
      defs = new Set();
    for (let j = 0; j < 3; j++) if (r() < 0.4) uses.add(1 + Math.floor(r() * 6));
    for (let j = 0; j < 3; j++) if (r() < 0.4) defs.add(1 + Math.floor(r() * 6));
    blocks.push({ uses, defs, succ });
  }
  return { blocks, entry: r() < 0.8 ? 0 : Math.floor(r() * n) };
}

test('solve: liveness on the solver equals the old liveness on generated graphs, both scopes', () => {
  let withUnreachable = 0,
    withLoops = 0,
    cases = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const g = gen(r, 2 + Math.floor(r() * 9));
    const seen = reachable(g);
    if (seen.size < g.blocks.length) withUnreachable++;
    let retreating = false;
    const active = new Set();
    const walk = (b, done) => {
      if (active.has(b)) {
        retreating = true;
        return;
      }
      if (done.has(b)) return;
      active.add(b);
      for (const s of g.blocks[b].succ) walk(s, done);
      active.delete(b);
      done.add(b);
    };
    walk(g.entry ?? 0, new Set());
    if (retreating) withLoops++;
    for (const scope of ['all-blocks', 'entry-reachable']) {
      cases++;
      const want = oldLiveness(g, scope);
      const got = liveness(g, scope);
      for (let k = 0; k < g.blocks.length; k++) {
        assert.deepEqual([...got.in[k]].sort(), [...want.in[k]].sort(), `seed ${seed} scope ${scope} in[${k}]`);
        assert.deepEqual([...got.out[k]].sort(), [...want.out[k]].sort(), `seed ${seed} scope ${scope} out[${k}]`);
      }
    }
  }
  // the batch must actually cover the trap cases, or the equality above proved little
  assert.ok(withUnreachable > 0, `${withUnreachable} graphs with unreachable blocks`);
  assert.ok(withLoops > 0, `${withLoops} graphs with a cycle`);
  assert.ok(cases === 600);
});
