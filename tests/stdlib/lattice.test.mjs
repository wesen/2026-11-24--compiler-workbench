// IRWB-048-B: the lattice laws, over each lattice of the standard library. The element domains are finite and small,
// so every triple is checked (the laws are universal statements; a sample would only ever be evidence). Each lattice
// is checked for: join commutative, associative and idempotent; bottom the identity of join; widening an upper bound
// of both arguments; widening a chain that stabilizes; and encode/decode a round trip (the dataflow layer persists
// solved facts through it).
//
// Widening on a lattice of finite height is its join — an upper bound of its arguments, whose ascending chains reach
// a limit because the lattice is finite — and the interval lattice passes its own `widen`, which a solver must use
// because its chains are infinite. The chain bound is the number of generated values, and that is an argument, not
// a round number: widen(x, y) is above x and y, so after every generated value has been joined once the accumulated
// value is above all of them, and joining and widening with any of them again leaves it where it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT,
  I32_MAX,
  I32_MIN,
  TOP,
  flatLattice,
  intervalLattice,
  lattice,
  mapLattice,
  setLattice,
} from '../../dist/stdlib/index.js';

const subsets = xs => {
  const out = [[]];
  for (const x of xs) for (const s of [...out]) out.push([...s, x]);
  return out.map(s => new Set(s));
};
const intervals = (bounds, L) => {
  const out = [L.bottom()];
  for (const lo of bounds) for (const hi of bounds) if (lo <= hi) out.push([lo, hi]);
  return out;
};
/** Every ordered triple, so the law is checked on the whole domain, not on a sample of it. */
const triples = values => {
  const out = [];
  for (const a of values) for (const b of values) for (const c of values) out.push([a, b, c]);
  return out;
};

function checkLattice({ name, L, values, widen }) {
  const show = v => JSON.stringify(L.encode(v));
  test(`${name}: join is commutative, associative and idempotent, with bottom its identity`, () => {
    for (const [a, b, c] of triples(values)) {
      assert.ok(L.equal(L.join(a, b), L.join(b, a)), `${name} commutative on ${show(a)}, ${show(b)}`);
      assert.ok(
        L.equal(L.join(L.join(a, b), c), L.join(a, L.join(b, c))),
        `${name} associative on ${show(a)}, ${show(b)}, ${show(c)}`,
      );
      assert.ok(L.equal(L.join(a, a), a), `${name} idempotent on ${show(a)}`);
      assert.ok(L.equal(L.join(a, L.bottom()), a), `${name} bottom is the right identity on ${show(a)}`);
      assert.ok(L.equal(L.join(L.bottom(), a), a), `${name} bottom is the left identity on ${show(a)}`);
    }
  });

  test(`${name}: widening is an upper bound of its arguments and a chain stabilizes`, () => {
    const leq = (x, y) => L.equal(L.join(x, y), y);
    for (const a of values)
      for (const b of values) {
        const w = widen(a, b);
        assert.ok(leq(a, w), `${name} widen(${show(a)}, ${show(b)}) = ${show(w)} is above its first argument`);
        assert.ok(leq(b, w), `${name} widen(${show(a)}, ${show(b)}) = ${show(w)} is above its second argument`);
        assert.ok(values.some(v => L.equal(v, w)), `${name} widen(${show(a)}, ${show(b)}) stays in the lattice`);
      }
    // An increasing chain: from bottom, each step joins the next generated value and then widens, for every value
    // and then for as many more steps again. The widened sequence is non-decreasing and is constant from the step
    // at which every generated value has been joined once (see the module comment).
    const bound = values.length;
    let x = L.bottom();
    const seq = [x];
    for (let i = 0; i < 2 * bound + 1; i++) {
      x = widen(x, L.join(x, values[i % bound]));
      seq.push(x);
    }
    for (let i = 1; i < seq.length; i++)
      assert.ok(leq(seq[i - 1], seq[i]), `${name} the widened chain is increasing at step ${i}`);
    for (let i = bound; i < seq.length; i++)
      assert.ok(L.equal(seq[i], seq[bound]), `${name} the widened chain is stable at step ${bound}, not at ${i}`);
  });

  test(`${name}: encode/decode is a round trip`, () => {
    for (const v of values) assert.ok(L.equal(L.decode(L.encode(v)), v), `${name} round trip on ${show(v)}`);
  });
}

const c1 = { v: 1, t: 'i32' },
  c2 = { v: 2, t: 'i32' },
  c2f = { v: 2, t: 'f32' };
const set = setLattice();
const flat = flatLattice();
// Every map over the two keys whose value is absent, the inner bottom, or one of the inner constants; a key holding
// the inner bottom is the same element as a missing key, which the laws then also check.
const mapOf = constants => {
  const out = [];
  for (const a of [undefined, BOT, ...constants]) for (const b of [undefined, BOT, ...constants]) {
    const m = new Map();
    if (a !== undefined) m.set('a', a);
    if (b !== undefined) m.set('b', b);
    out.push(m);
  }
  return out;
};
const map = mapLattice(flat);
const thresholds = [-2, 2];
const interval = intervalLattice(-4, 4, thresholds);

checkLattice({ name: 'set', L: set, values: subsets([1, 2, 3]), widen: (a, b) => set.join(a, b) });
checkLattice({ name: 'flat', L: flat, values: [BOT, c1, c2, c2f, TOP], widen: (a, b) => flat.join(a, b) });
checkLattice({ name: 'map', L: map, values: mapOf([c1, c2]), widen: (a, b) => map.join(a, b) });
checkLattice({
  name: 'interval',
  L: interval,
  values: intervals([-4, -2, 0, 2, 4], interval),
  widen: (a, b) => interval.widen(a, b),
});

test('interval: widening with thresholds jumps to the nearest threshold, and to the extreme past the last one', () => {
  const L = intervalLattice(0, 100, [10, 20, 50]);
  const cases = [
    // [old, next] -> widened: a moved upper bound goes to the next threshold up, a moved lower bound to the next
    // threshold down, and an unchanged bound stays.
    [[0, 5], [0, 7], [0, 10]],
    [[0, 10], [0, 15], [0, 20]],
    [[0, 20], [0, 40], [0, 50]],
    [[0, 50], [0, 90], [0, 100]],
    [[0, 100], [0, 100], [0, 100]],
    [[3, 5], [1, 5], [0, 5]],
    [[3, 5], [0, 5], [0, 5]],
    [[5, 5], [0, 7], [0, 10]],
    // A bound already past every threshold jumps to the extreme in one step.
    [[0, 50], [0, 90], [0, 100]],
    [[50, 100], [0, 100], [0, 100]],
    // Bottom on either side.
    [null, [3, 4], [3, 4]],
    [[3, 4], null, [3, 4]],
    [null, null, null],
  ];
  for (const [old, next, want] of cases)
    assert.deepEqual(L.widen(old, next), want, `widen(${JSON.stringify(old)}, ${JSON.stringify(next)})`);
  // Widening up-to is still widening: the result is above both arguments.
  for (const [old, next] of cases)
    if (old && next) {
      const w = L.widen(old, next);
      assert.ok(w[0] <= Math.min(old[0], next[0]) && w[1] >= Math.max(old[1], next[1]), 'an upper bound');
    }
});

test('interval: widening a growing loop bound walks the thresholds one at a time, then stops', () => {
  const ts = [10, 20, 30, 40];
  const L = intervalLattice(0, 100, ts);
  // A counter that grows by 5 per iteration at a loop head, widened at each visit: every widen moves one bound to
  // the next threshold (or to the extreme), so a bound can move at most |thresholds| + 1 times, and the chain must be
  // constant within 2 × (|thresholds| + 2) widen steps.
  let x = L.bottom();
  const seq = [x];
  for (let i = 0; i < 2 * (ts.length + 2); i++) {
    const [lo, hi] = x ?? [0, 0];
    x = L.widen(x, [lo, Math.min(100, hi + 5)]);
    seq.push(x);
  }
  assert.deepEqual(seq.slice(0, 7), [null, [0, 5], [0, 10], [0, 20], [0, 30], [0, 40], [0, 100]]);
  assert.deepEqual(seq[seq.length - 1], [0, 100]);
  assert.deepEqual(seq[seq.length - 2], [0, 100]);
});

test('interval: the default lattice spans i32 and widens to its extremes without thresholds', () => {
  const L = intervalLattice();
  assert.deepEqual(L.top, [I32_MIN, I32_MAX]);
  assert.equal(L.infiniteHeight, true);
  assert.deepEqual(L.widen([0, 5], [0, 7]), [0, I32_MAX]);
  assert.deepEqual(L.widen([0, 5], [-1, 5]), [I32_MIN, 5]);
  assert.deepEqual(L.widen(null, [1, 2]), [1, 2]);
  assert.deepEqual(L.widen([1, 2], null), [1, 2]);
  assert.deepEqual(L.join([0, 1], [2, 3]), [0, 3]);
  assert.deepEqual(L.encode([0, 1]), [0, 1]);
  assert.deepEqual(L.decode([0, 1]), [0, 1]);
  assert.equal(L.encode(null), null);
});

test('the aggregate exposes the four lattices and the two flat values', () => {
  assert.equal(lattice.set, setLattice);
  assert.equal(lattice.flat, flatLattice);
  assert.equal(lattice.interval, intervalLattice);
  assert.equal(lattice.map, mapLattice);
  assert.equal(lattice.TOP, TOP);
  assert.equal(lattice.BOT, BOT);
  assert.equal(mapLattice(flat).name, 'map(flat)');
  assert.equal(map.inner, flat);
  assert.equal(map.infiniteHeight, false);
});

test('the framework re-exports these lattices, so there is one copy', async () => {
  const fw = await import('../../dist/framework/dataflow/index.js');
  for (const n of [
    'BOT',
    'TOP',
    'I32_MIN',
    'I32_MAX',
    'setLattice',
    'flatLattice',
    'intervalLattice',
    'mapLattice',
    'lattice',
  ])
    assert.equal(fw[n], { BOT, TOP, I32_MIN, I32_MAX, setLattice, flatLattice, intervalLattice, mapLattice, lattice }[n], n);
});
