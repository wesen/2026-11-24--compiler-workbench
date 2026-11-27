// IRWB-046-C: the standard library's first primitive, liveness (src/stdlib/flow/liveness.ts).
//
// The tests are of two kinds: hand-computed sets on small graphs (a diamond with a loop, a block whose variable is
// read before it is defined, a variable read twice in one instruction, an unreachable block), and a search-based
// reference on seeded random graphs. The reference is the definition — a variable is live after an item when some
// path from there reaches a read of it without writing it — so it is an independent implementation of the same law,
// not a second copy of the fixpoint.
import test from 'node:test';
import assert from 'node:assert/strict';

const { liveness } = await import('../../dist/stdlib/index.js');

/**
 * A shape from `[[reads, writes], ...]` per block plus successor indices; item positions are assigned in block order.
 */
const shape = blocks => {
  const start = [];
  let n = 0;
  for (const b of blocks) {
    start.push(n);
    n += b.items.length;
  }
  const ranges = blocks.map((b, k) => ({ start: start[k], end: start[k] + b.items.length - 1 }));
  const reads = [],
    writes = [];
  for (const b of blocks)
    for (const [r, w] of b.items) {
      reads.push(r);
      writes.push(w);
    }
  return {
    blockCount: blocks.length,
    successors: b => blocks[b].succ,
    items: b => ranges[b],
    reads: i => reads[i],
    writes: i => writes[i],
  };
};
const set = (...xs) => new Set(xs);
const sets = lv => lv.liveIn.map((s, k) => [s, lv.liveOut[k]]);
const equal = (actual, expected, what) =>
  assert.deepEqual(
    actual.map(s => [...s].sort((a, b) => a - b)),
    expected.map(s => [...s].sort((a, b) => a - b)),
    what,
  );
/** Every item's live-after set, block by block, in item order. */
const liveAfterItems = (lv, block) => {
  const out = [];
  lv.walkBackwards(block, (i, after) => out[i] = new Set(after));
  return out.filter(s => s !== undefined);
};

// ---------- hand-computed: a diamond with a loop ----------

//   0 entry      a = 1                      reads {}, writes {a}
//   1 head:      b = f(a)                   reads {a}, writes {b}
//   2 body:      a = g(b); use(a)           reads {b}, writes {a}; reads {a}
//   3 exit:      use(a)                     reads {a}
//   succ 0 -> [1], 1 -> [2, 3], 2 -> [1], 3 -> []
const LOOP = [
  { items: [[[], [0]]], succ: [1] },
  { items: [[[0], [1]]], succ: [2, 3] },
  {
    items: [
      [[1], [0]],
      [[0], []],
    ],
    succ: [1],
  },
  { items: [[[0], []]], succ: [] },
];

test('liveness of a diamond with a loop: live-in and live-out per block', () => {
  const lv = liveness(shape(LOOP), { blocks: 'all' });
  const [[in0, out0], [in1, out1], [in2, out2], [in3, out3]] = sets(lv);
  // a is live everywhere from the head's use down to the exit, but block 0 defines it before any use;
  // b is live only from its definition in the head to the body
  equal([in0, out0], [set(), set(0)], 'block 0: nothing live in (a is defined there), a live out');
  equal([in1, out1], [set(0), set(0, 1)], 'block 1: a live in, a and b live out (b is used in the body)');
  equal([in2, out2], [set(1), set(0)], 'block 2: b live in, a live out');
  equal([in3, out3], [set(0), set()], 'block 3: a live in, nothing live out');
});

test('liveness gives each item the variables live after it', () => {
  const lv = liveness(shape(LOOP), { blocks: 'all' });
  // block 1: `b = f(a)` — live after it: {a, b} (b because the body reads it, a because the exit does)
  equal(liveAfterItems(lv, 1), [set(0, 1)], 'block 1 items');
  // block 2: after `a = g(b)` a is live (the next item reads it) and b is not (that was b's last use);
  //          after `use(a)` only a is live, which is the block's live-out
  equal(liveAfterItems(lv, 2), [set(0), set(0)], 'block 2 items, in item order');
});

test('a variable that is read before it is defined in the block is live in; one defined first is not', () => {
  //   block 0: use(x) then x = 1  -> x is an upward-exposed use: live in
  //   block 1: x = 2  then use(x) -> x is defined first: not live in
  const s = shape([
    {
      items: [
        [[7], []],
        [[], [7]],
      ],
      succ: [],
    },
  ]);
  equal([liveness(s, { blocks: 'all' }).liveIn[0]], [set(7)], 'use before definition');
  const s2 = shape([
    {
      items: [
        [[], [7]],
        [[7], []],
      ],
      succ: [],
    },
  ]);
  equal([liveness(s2, { blocks: 'all' }).liveIn[0]], [set()], 'definition before use');
});

test('a variable read twice by one instruction is one variable', () => {
  const s = shape([{ items: [[[3, 3, 3], []]], succ: [] }]);
  const lv = liveness(s, { blocks: 'all' });
  assert.equal(lv.liveIn[0].size, 1);
  assert.ok(lv.liveIn[0].has(3));
});

// ---------- the unreachable block (the ticket's case) ----------

//   block 0 entry:   j join                       (no reads, no writes)
//   block 1 dead:    j join                       (nothing jumps to `dead`)
//   block 2 join:    add rd66, r64, r65           reads {64, 65}, writes {66}
// The join uses 64 and 65, so the join's live-in is {64, 65} and so is block 1's live-out — whether or not anything
// reaches block 1. That is scope 'all', the code as laid out: the machine code's answer, which is what the register
// allocator's intervals and the coalescer ask for, so that an interval covers what unreachable code reads. Scope
// 'entryReachable' is the executions' answer: a block no path from the entry reaches has no liveness at all. Both are
// asserted here so that the scope is a stated property of the primitive and not an accident of its implementation.
const UNREACHABLE = [
  { items: [[[], []]], succ: [2] },
  { items: [[[], []]], succ: [2] },
  { items: [[[64, 65], [66]]], succ: [] },
];

test("unreachable block: scope 'all' gives it the join's live-in as its live-out", () => {
  const lv = liveness(shape(UNREACHABLE), { blocks: 'all' });
  equal([lv.liveOut[1]], [set(64, 65)], "block 1's live-out with scope 'all'");
  assert.deepEqual(liveAfterItems(lv, 1).map(s => [...s].sort((a, b) => a - b)), [[64, 65]]);
  // and the reachable part is the same under either scope
  equal([lv.liveIn[2], lv.liveIn[0], lv.liveOut[0]], [set(64, 65), set(64, 65), set(64, 65)], 'reachable blocks');
});

test("unreachable block: scope 'entryReachable' gives it no liveness", () => {
  const lv = liveness(shape(UNREACHABLE), { blocks: 'entryReachable', entry: 0 });
  equal([lv.liveIn[1], lv.liveOut[1]], [set(), set()], "block 1 has no liveness with scope 'entryReachable'");
  assert.deepEqual(liveAfterItems(lv, 1).map(s => [...s].sort((a, b) => a - b)), [[]]);
  // the reachable part is unchanged, which is why a test of the join alone would pass under either scope
  equal([lv.liveIn[2], lv.liveIn[0], lv.liveOut[0]], [set(64, 65), set(64, 65), set(64, 65)], 'reachable blocks');
});

test("scope 'entryReachable' starts at the entry it is given, and stops at what it cannot reach", () => {
  //   0 (unreachable from 1):  j 2
  //   1 entry:                 j 2
  //   2:                       use(9)
  const s = shape([
    { items: [[[], []]], succ: [2] },
    { items: [[[], []]], succ: [2] },
    { items: [[[9], []]], succ: [] },
  ]);
  const from1 = liveness(s, { blocks: 'entryReachable', entry: 1 });
  equal([from1.liveOut[0]], [set()], 'block 0 is not reached from block 1');
  equal([from1.liveIn[1], from1.liveIn[2]], [set(9), set(9)], 'blocks 1 and 2 are');
  const from0 = liveness(s, { blocks: 'entryReachable', entry: 0 });
  equal([from0.liveOut[1]], [set()], 'block 1 is not reached from block 0');
});

// ---------- the definition, as a search: seeded random graphs ----------

/**
 * The reference: v is live at a point when some path from there reaches an item that reads v without an item that
 * writes v on the way (an item that reads v reaches it, even where it also writes v). Paths follow a block's items,
 * then its successors' — scope 'all', so an unreachable block is searched like any other. `point` is 'before' or
 * 'after' an item of a block.
 */
const referenceLive = (blocks, ranges, readsAt, writesAt) => {
  const ref = (point, v) => {
    const seen = new Set();
    const work = [point];
    while (work.length) {
      const p = work.pop();
      const key = `${p.at}:${p.k}:${p.i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.at === 'before') {
        if (readsAt(p.i).includes(v)) return true;
        if (!writesAt(p.i).includes(v)) work.push({ at: 'after', k: p.k, i: p.i });
      } else if (p.i + 1 <= ranges[p.k].end) work.push({ at: 'before', k: p.k, i: p.i + 1 });
      else for (const s of blocks[p.k].succ) work.push({ at: 'before', k: s, i: ranges[s].start });
    }
    return false;
  };
  return ref;
};

test('seeded random graphs: the fixpoint agrees with the definition, at every block and every item', () => {
  let seed = 20261127;
  const rnd = n => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const VARS = 4;
  for (let g = 0; g < 40; g++) {
    const nb = 1 + rnd(5);
    const blocks = [];
    for (let b = 0; b < nb; b++) {
      const items = [];
      const count = 1 + rnd(2);
      for (let i = 0; i < count; i++) {
        const r = [],
          w = [];
        for (let v = 0; v < VARS; v++) {
          if (rnd(4) === 0) r.push(v);
          if (rnd(4) === 0) w.push(v);
        }
        items.push([r, w]);
      }
      const succ = [];
      for (let s = 0; s < nb; s++) if (rnd(3) === 0) succ.push(s);
      blocks.push({ items, succ });
    }
    const s = shape(blocks);
    const ranges = blocks.map((b, k) => s.items(k));
    const reads = [],
      writes = [];
    for (const b of blocks)
      for (const [r, w] of b.items) {
        reads.push(r);
        writes.push(w);
      }
    const readsAt = i => reads[i],
      writesAt = i => writes[i];
    const lv = liveness(s, { blocks: 'all' });
    const ref = referenceLive(blocks, ranges, readsAt, writesAt);
    const expected = point => {
      const out = [];
      for (let v = 0; v < VARS; v++) if (ref(point, v)) out.push(v);
      return out;
    };
    const sorted = s => [...s].sort((x, y) => x - y);
    const where = `${JSON.stringify(blocks)}`;
    for (let b = 0; b < nb; b++) {
      const items = [];
      lv.walkBackwards(b, (i, after) => items.push([i, sorted(after)]));
      for (const [i, after] of items)
        assert.deepEqual(after, expected({ at: 'after', k: b, i }), `graph ${g} ${where}, after item ${i} of ${b}`);
      assert.deepEqual(
        sorted(lv.liveIn[b]),
        expected({ at: 'before', k: b, i: ranges[b].start }),
        `graph ${g} ${where}, live-in of ${b}`,
      );
      assert.deepEqual(
        sorted(lv.liveOut[b]),
        expected({ at: 'after', k: b, i: ranges[b].end }),
        `graph ${g} ${where}, live-out of ${b}`,
      );
    }
  }
});
