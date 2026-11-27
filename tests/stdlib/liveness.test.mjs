// IRWB-046-B: the standard library's liveness primitive (IRWB-039 phase 2b).
//   - exact in/out sets on a CFG with a loop (the least fixpoint of in = use ∪ (out \ def),
//     out = ∪ in[succ], computed by hand);
//   - the trap case R3 found: a block no path from the entry reaches, which is where an all-blocks
//     sweep (machine liveness) and an entry-reachable solver (the framework's) disagree;
//   - upward exposure: a value the block defines before its first read is not live into the block;
//   - the machine clients' scope choice, through regalloc's intervals() on hand-written machine code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveness, reachableBlocks } from '../../dist/stdlib/index.js';
import { intervals } from '../../dist/typed/backend/regalloc.js';

const set = (...xs) => new Set(xs);
const live = blocks => liveness({ blocks }, 'all-blocks');
const same = (a, b) => assert.deepEqual([...a].sort((x, y) => x - y), [...b].sort((x, y) => x - y));

test('liveness: exact in and out sets on a CFG with a loop', () => {
  // 0 -> 1; 1 branches to 2 and 4; 2 -> 3 -> 1 (the back edge); 4 exits. Block 1 defines nothing and
  // reads 2; block 2 defines 2 and reads 1; block 4 reads 1 and 2; block 0 defines 1.
  const g = {
    blocks: [
      { uses: set(), defs: set(1), succ: [1] },
      { uses: set(2), defs: set(), succ: [2, 4] },
      { uses: set(1), defs: set(2), succ: [3] },
      { uses: set(), defs: set(), succ: [1] },
      { uses: set(1, 2), defs: set(), succ: [] },
    ],
  };
  const r = liveness(g, 'all-blocks');
  for (const [k, i, o] of [
    [0, set(2), set(1, 2)],
    [1, set(1, 2), set(1, 2)],
    [2, set(1), set(1, 2)],
    [3, set(1, 2), set(1, 2)],
    [4, set(1, 2), set()],
  ]) {
    same(r.in[k], i);
    same(r.out[k], o);
  }
  // the same facts under 'entry-reachable': every block here is reachable, so nothing changes
  const e = liveness(g, 'entry-reachable');
  for (let k = 0; k < g.blocks.length; k++) {
    same(e.in[k], r.in[k]);
    same(e.out[k], r.out[k]);
  }
});

test('liveness: the scope is a required choice, and only unreachable blocks see it', () => {
  // R3's case (probe 08): block 0 jumps to the join; block 1, which no path from the entry reaches,
  // also jumps to the join; the join uses registers 64 and 65.
  const g = {
    blocks: [
      { uses: set(), defs: set(), succ: [2] },
      { uses: set(), defs: set(), succ: [2] },
      { uses: set(64, 65), defs: set(), succ: [] },
    ],
  };
  assert.deepEqual([...reachableBlocks(g)], [0, 2]);
  // 'all-blocks' is the machine scope: block 1 is laid out and its instructions still need registers,
  // so its live-out is computed like any other block's, from its successors.
  const all = liveness(g, 'all-blocks');
  same(all.out[1], set(64, 65));
  same(all.in[1], set(64, 65));
  same(all.out[0], set(64, 65));
  // 'entry-reachable' is the framework solver's scope: an unreachable block keeps the empty set.
  const entry = liveness(g, 'entry-reachable');
  same(entry.out[1], set());
  same(entry.in[1], set());
  // the reachable blocks are unaffected: a reachable block's successors are reachable, so no
  // reachable block ever joins a fact from an unreachable one
  for (const k of [0, 2]) {
    same(entry.in[k], all.in[k]);
    same(entry.out[k], all.out[k]);
  }
});

test('liveness: a value defined before its first read in the block is not live into the block', () => {
  // the caller folds per-instruction uses and defs into per-block sets, and `uses` means
  // upward-exposed uses: block 1 reads 3 but defines it first, so 3 is not in the block's uses, while
  // 4 is read before its definition. Passing every read instead (the careless extraction) would make
  // 3 live into block 1 and out of block 0.
  const g = {
    blocks: [
      { uses: set(), defs: set(), succ: [1] },
      { uses: set(4), defs: set(3, 4), succ: [2] },
      { uses: set(3), defs: set(), succ: [] },
    ],
  };
  const r = live(g.blocks);
  same(r.in[1], set(4));
  same(r.out[0], set(4));
  same(r.in[2], set(3));
});

test('liveness: an entry other than block 0 decides what entry-reachable computes', () => {
  const g = {
    blocks: [
      { uses: set(), defs: set(), succ: [1] },
      { uses: set(7), defs: set(), succ: [2] },
      { uses: set(), defs: set(), succ: [] },
    ],
    entry: 1,
  };
  const r = liveness(g, 'entry-reachable');
  same(r.out[0], set()); // not reachable from entry 1
  same(r.in[1], set(7));
  same(r.out[1], set());
});

test('liveness: the machine clients use the all-blocks scope (regalloc intervals on the trap case)', () => {
  // hand-written machine code for the trap case: block 0 jumps to the join, block 1 (unreachable)
  // jumps to the join, the join adds 64 and 65 into 66 and returns.
  const code = [
    { op: 'label', name: 'L0', covers: [] },
    { op: 'j', target: 'join', covers: [] },
    { op: 'label', name: 'L1', covers: [] },
    { op: 'j', target: 'join', covers: [] },
    { op: 'label', name: 'join', covers: [] },
    { op: 'add', rd: 66, rs1: 64, rs2: 65, covers: [] },
    { op: 'ret', covers: [] },
  ];
  const iv = intervals(code);
  // the allocator has always swept every block: the unreachable block's live-out is the join's
  // live-in, {64, 65}, never the empty set an entry-reachable solver would give
  same(iv.liveOut[1], set(64, 65));
  same(iv.liveOut[0], set(64, 65));
});
