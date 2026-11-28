// IRWB-048-A: the standard library's lattices (moved from src/framework/dataflow/lattices.ts, IRWB-001 E4).
// The laws every lattice must satisfy, checked on each lattice (set, flat, interval, map) over generated
// values — the full pools of a small universe, so every pair and triple is a case, not a sample:
//   - join is commutative, associative and idempotent, and bottom is its identity;
//   - an increasing chain joined element by element stabilizes within the pool's size (finite height),
//     the termination argument the round-robin solver rests on;
//   - encode/decode round-trips every value (solved facts are persisted and compared);
//   - a map key present with the inner bottom equals the map without it (the case a careless extraction
//     of the map lattice gets wrong: join and equal must read a missing key as the inner bottom);
//   - the interval lattice's widening: an upper bound of its arguments on every generated pair, and it
//     stabilizes an increasing chain that walks past every threshold — a bound that moves jumps to the
//     nearest threshold, and one already past every threshold jumps to the extreme in one step.
// Plus the seam: the framework's dataflow layer re-exports the library's lattices, so the function
// objects its callers import are the library's, not copies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lattice,
  setLattice,
  flatLattice,
  intervalLattice,
  mapLattice,
  I32_MAX,
  I32_MIN,
} from '../../dist/stdlib/index.js';
import * as fw from '../../dist/framework/dataflow/index.js';

// ---------- generated value pools (every element of a small universe) ----------
const subsets = ([x, ...rest]) => (x === undefined ? [[]] : subsets(rest).flatMap(s => [s, [x, ...s]]));
const setPool = subsets([1, 2, 3]).map(s => new Set(s));

const jsons = [0, 1, -1, 2, 'a', true, null, [1, 2], { x: 1 }];
const flatPool = [lattice.flat().bottom(), 'varies', ...jsons.map(v => ({ value: v }))];

const intervalPool = [
  null,
  [0, 0],
  [-3, 3],
  [10, 20],
  [I32_MIN, 0],
  [5, I32_MAX],
  [-100, -50],
  [7, 7],
  [I32_MIN, I32_MAX],
];

const innerSets = [new Set(), new Set([1]), new Set([2]), new Set([1, 2])];
const mapOf = o => new Map(Object.entries(o).map(([k, [i]]) => [k, innerSets[i]]));
const mapPool = [
  mapOf({}),
  mapOf({ a: [0] }), // a key present with the inner bottom
  mapOf({ b: [2] }),
  mapOf({ a: [1] }),
  mapOf({ a: [1], b: [2] }),
  mapOf({ a: [3] }),
  mapOf({ a: [3], b: [0] }),
  mapOf({ a: [1], b: [3], x: [2] }),
];

// ---------- the laws, over every pair and triple of each pool ----------
function laws(name, L, pool) {
  const b = L.bottom();
  test(`lattice ${name}: join is commutative, associative, idempotent; bottom is its identity`, () => {
    for (const x of pool) {
      assert.ok(L.equal(L.join(x, x), x), `idempotent at ${JSON.stringify(L.encode(x))}`);
      assert.ok(
        L.equal(L.join(x, b), x) && L.equal(L.join(b, x), x),
        `bottom at ${JSON.stringify(L.encode(x))}`,
      );
      for (const y of pool) {
        assert.ok(L.equal(L.join(x, y), L.join(y, x)), `commutative at ${JSON.stringify(L.encode(x))}`);
        for (const z of pool)
          assert.ok(
            L.equal(L.join(x, L.join(y, z)), L.join(L.join(x, y), z)),
            `associative at ${[x, y, z].map(v => JSON.stringify(L.encode(v))).join(' ')}`,
          );
      }
    }
  });
  test(`lattice ${name}: joining an increasing chain of the pool stabilizes within its size`, () => {
    for (let start = 0; start < pool.length; start++) {
      let acc = pool[start],
        changes = 0;
      for (let step = 1; step < 2 * pool.length; step++) {
        const next = L.join(acc, pool[(start + step) % pool.length]);
        if (!L.equal(next, acc)) ((acc = next), changes++);
      }
      assert.ok(changes < pool.length, `chain from ${start} stabilizes (${changes} changes)`);
    }
  });
  test(`lattice ${name}: encode/decode round-trips every value`, () => {
    for (const v of pool)
      assert.ok(L.equal(L.decode(L.encode(v)), v), `round-trip at ${JSON.stringify(L.encode(v))}`);
  });
}

const set = setLattice(),
  flat = flatLattice(),
  interval = intervalLattice(),
  map = mapLattice(setLattice());
laws('set', set, setPool);
laws('flat', flat, flatPool);
laws('interval', interval, intervalPool);
laws('map(set)', map, mapPool);

test('lattice map(set): a key present with the inner bottom is the key missing', () => {
  assert.ok(map.equal(mapPool[0], mapPool[1]));
  assert.ok(map.equal(map.join(mapPool[0], mapPool[1]), mapPool[0]));
  assert.deepEqual(map.encode(mapPool[1]), {}); // encode drops it, so persisted facts agree
});

// ---------- the interval lattice's widening ----------
const widenLaws = (name, L, pool) => {
  test(`interval widening (${name}): an upper bound of its arguments on every generated pair`, () => {
    for (const a of pool)
      for (const c of pool) {
        const w = L.widen(a, c);
        assert.ok(L.equal(L.join(a, w), w), `above ${JSON.stringify(a)}`);
        assert.ok(L.equal(L.join(c, w), w), `above ${JSON.stringify(c)}`);
      }
  });
};

widenLaws('i32', interval, intervalPool);
const T = [-10, 3, 7, 42],
  TW = intervalLattice(-100, 1000, T);
widenLaws('widen up-to', TW, [null, [0, 0], [1, 5], [-50, 20], [0, 1000], [-100, 1000], [-4, 4], [42, 42]]);

test('interval widening: a moved bound jumps to the nearest threshold, not the extreme', () => {
  assert.deepEqual(TW.widen([0, 0], [0, 5]), [0, 7]); // up(5) = 7, the nearest threshold above 5
  assert.deepEqual(TW.widen([0, 0], [-5, 0]), [-10, 0]); // down(-5) = -10, the nearest threshold below 5
  assert.deepEqual(TW.widen([10, 20], [3, 20]), [3, 20]); // a threshold is itself: down(3) = 3
  assert.deepEqual(TW.widen([0, 10], [0, 2]), [0, 10]); // a bound that did not climb past the old one stays
  assert.deepEqual(TW.widen([0, 0], [0, 500]), [0, 1000]); // past every threshold: the extreme in one step
  assert.deepEqual(interval.widen([0, 0], [0, 1]), [0, I32_MAX]); // without thresholds, one step to the extreme
});

test('interval widening: stabilizes an increasing chain that walks past every threshold', () => {
  // the chain [0, i] for i = 1..1001 climbs past every threshold; widening must reach a fixed point in at
  // most T.length + 2 steps (each bound may sit on one threshold per widening, then the extreme).
  let acc = [0, 0],
    changes = 0;
  for (let i = 1; i <= 1001; i++) {
    const next = TW.widen(acc, [0, i]);
    if (!TW.equal(next, acc)) ((acc = next), changes++);
  }
  assert.deepEqual(acc, [0, 1000]);
  assert.ok(changes <= T.length + 2, `${changes} widening changes`);
  assert.deepEqual(TW.widen(acc, [0, 5000]), acc); // stable: further climbing changes nothing
});

// ---------- the seam: the framework re-exports the library, not a copy ----------
test('the framework dataflow layer re-exports the library lattices', () => {
  assert.equal(fw.lattice, lattice);
  assert.equal(fw.setLattice, setLattice);
  assert.equal(fw.intervalLattice, intervalLattice);
  assert.equal(fw.mapLattice, mapLattice);
  assert.equal(fw.flatLattice, flatLattice);
  assert.equal(fw.I32_MAX, I32_MAX);
  assert.equal(fw.I32_MIN, I32_MIN);
});
