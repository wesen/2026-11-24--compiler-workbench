// IRWB-033-I: the schedule IR, a v6 artifact between Tix and CUDA (design/01 in the ticket).
//
// A schedule says, for every kernel of a Tix function, how its elements are laid out on the machine: the
// mapping (thread, block, tile), the shared-memory rows and staged terms of block mode, and — for tile mode —
// the block tile, the per-thread register patch, the chunked reductions and the operand tiles staged per
// chunk. The emitter (cuda-source.ts) prints what the schedule says and makes no decisions of its own. The
// schedule is produced by `tensor.plan-schedule` from the fusion plan (stages 3 and 3b, unchanged) and refined
// by the passes in schedule-passes.ts.
import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import type { FusionPlan } from './fusion.js';
import type { Fn } from './model.js';

export type SchedMode = 'thread' | 'block' | 'tile';

/** One operand tile staged per chunk of a tiled reduction. `dims[p]` says where position p of the tensor's
 *  shape gets its tile coordinate: `'chunk'` (the reduction's chunked first axis), or the id of the output
 *  axis whose block tile covers the position. */
export interface StageTile {
  tensor: string;
  dims: ('chunk' | string)[];
  /** Vector width of the staged loads along the last tile dimension (bind pass). */
  vector?: number;
  /** Extra floats of padding per row of the staged tile (bind pass). */
  pad?: number;
}
/** The chunk schedule of one outermost reduction: its first axis is split into chunks of `size`, and the tile
 *  of each staged operand is cooperatively loaded before the chunk's terms run. A reduction that the split-sum
 *  pass already split (a `blocks` extent with a `tail` inner axis and reads of the form lane + block*width) is
 *  chunked in blocks: `unit: 'block'`, `size` in blocks, `split` naming the inner axis and the block width. */
export interface ChunkSchedule {
  axis: string;
  size: number;
  unit: 'element' | 'block';
  split?: { inner: string; width: number };
  stage: StageTile[];
}
/** Tile mode: how one member's output space is distributed. `block[a]` is the block-tile extent along the
 *  member's axis a; `patch[a]` is the per-thread patch along a; `patchMap[a]` says how the thread's patch
 *  elements lie along a (`strided` for the last axis, so that consecutive threads hold consecutive coordinates
 *  and both tile reads and stores coalesce); `chunks[r]` schedules reduction r (preorder over
 *  `outerReductions`), or leaves it serial. */
export interface TileMember {
  statement: string;
  block: number[];
  patch: number[];
  patchMap: ('contiguous' | 'strided')[];
  chunks: (ChunkSchedule | undefined)[];
  unroll?: boolean;
}
export interface SchedKernel {
  id: string;
  /** Member statements in source order. */
  statements: string[];
  /** Block-domain rank: the leading shared axes. Tile kernels have depth 0. */
  depth: number;
  mode: SchedMode;
  /** The host decides at launch between this kernel and stage 2's per-statement code. */
  gated: boolean;
  /** Threads per block (block and tile mode). */
  threads?: number;
  // Members written to global memory (the result, members read by a later kernel, singletons).
  stored?: string[];
  // Block mode, as stages 3 and 3b planned it:
  staged?: string[];
  buffered?: string[];
  inPlace?: { statement: string; over: string }[];
  terms?: { statement: string; reduction: number }[];
  heavy?: string[];
  // Tile mode:
  tiles?: TileMember[];
  /** Why the schedule is what it is: the fusion plan's reasons and every pass decision. */
  reasons: string[];
}
export interface ScheduleUnit {
  /** The Tix function the schedule lays out; passes decide legality from it. */
  fn: Fn;
  kernels: SchedKernel[];
  /** Pass refusals, with the pass that refused and the reason. */
  refusals: { pass: string; kernel: string; statement?: string; reason: string }[];
}

function fail(reason: string): never {
  throw Error(reason);
}
export function validateSchedule(value: unknown): asserts value is ScheduleUnit {
  const s = value as ScheduleUnit | null;
  if (!s || typeof s.fn !== 'object' || !s.fn || !Array.isArray(s.kernels) || !s.kernels.length)
    fail('Invalid schedule');
  if (!Array.isArray(s.refusals)) fail('Invalid refusals');
  const seen = new Set<string>();
  for (const [i, k] of s.kernels.entries()) {
    if (k.id !== 'k' + i) fail(`Kernel ${k.id} is out of order`);
    if (!Array.isArray(k.statements) || !k.statements.length) fail(`Kernel ${k.id} has no statements`);
    if (!['thread', 'block', 'tile'].includes(k.mode)) fail(`Kernel ${k.id} has an invalid mode`);
    if (typeof k.gated !== 'boolean') fail(`Kernel ${k.id} has no gate flag`);
    for (const t of k.statements) {
      if (seen.has(t)) fail(`Statement ${t} is in two kernels`);
      seen.add(t);
    }
    if (k.mode === 'tile') {
      if (k.depth !== 0) fail(`Tile kernel ${k.id} has a block domain`);
      if (!Array.isArray(k.tiles) || k.tiles.length !== k.statements.length)
        fail(`Tile kernel ${k.id} has no tile per member`);
      for (const t of k.tiles) {
        if (!t.statement || !Array.isArray(t.block) || !Array.isArray(t.patch) || !Array.isArray(t.chunks))
          fail(`Tile kernel ${k.id} has an invalid tile entry`);
        if (t.patch.some(p => !(p >= 1)) || t.block.some(b => !(b >= 1))) fail('Invalid tile sizes');
        if (
          t.block.length !== t.patch.length ||
          !t.block.length ||
          !Array.isArray(t.patchMap) ||
          t.patchMap.length !== t.block.length ||
          t.patchMap.some(m => m !== 'contiguous' && m !== 'strided')
        )
          fail('Tile and patch disagree in rank');
        for (const c of t.chunks)
          if (
            c &&
            (typeof c.axis !== 'string' ||
              !(c.size >= 1) ||
              !['element', 'block'].includes(c.unit) ||
              (c.split && (typeof c.split.inner !== 'string' || c.split.width !== 4)) ||
              !Array.isArray(c.stage) ||
              c.stage.some(st => {
                if (typeof st?.tensor !== 'string' || !Array.isArray(st.dims) || !st.dims.length) return true;
                if (st.vector !== undefined && ![1, 2, 4].includes(st.vector)) return true;
                if (st.pad !== undefined && !(st.pad >= 0)) return true;
                return st.dims.some(d => d !== 'chunk' && typeof d !== 'string');
              }))
          )
            fail('Invalid chunk schedule');
      }
      if (!k.threads || k.threads < 1 || k.threads > 1024) fail(`Tile kernel ${k.id} has invalid threads`);
    }
    // The bind pass sets the thread count of block kernels (stage 3's measured caps); the initial schedule
    // leaves it open.
    if (k.mode === 'block' && k.threads !== undefined && (k.threads < 1 || k.threads > 1024))
      fail(`Block kernel ${k.id} has invalid threads`);
  }
}

export const SchedIR = defineIR<ScheduleUnit>({
  id: 'tensor.sched',
  version: '1',
  description: 'Kernel layout of a Tix function: mappings, tiles, patches, chunks and staged operands',
  validate: validateSchedule,
  // The correspondence currency is the member statement: the Tix correspondence maps statements to members,
  // the CUDA correspondence maps members to kernels, and composition joins them.
  entities: unit => unit.kernels.flatMap(k => k.statements.map(s => unit.fn.name + '/' + s)),
});
function* entities(unit: ScheduleUnit): Generator<IREntity> {
  // The correspondence currency is the member statement: the Tix correspondence maps statements to members,
  // the schedule passes map members to members, and the CUDA correspondence maps members to kernels. Kernels
  // are attributes of their members, so every correspondence in the chain speaks the same entity universe.
  for (const k of unit.kernels)
    for (const s of k.statements) {
      const tile = k.tiles?.find(t => t.statement === s);
      yield {
        id: unit.fn.name + '/' + s,
        kind: 'member',
        attributes: { kernel: k.id, mode: k.mode, depth: k.depth, gated: k.gated, ...(tile ? { tile } : {}) },
      };
    }
}
function relations(): Generator<IRRelation> {
  // The kernel structure lives in the members' attributes; the schedule has no edges of its own.
  return (function* () {})();
}
export const scheduleAdapter = defineAdapter<ScheduleUnit>({
  id: 'tensor.schedule-adapter',
  version: '1',
  description: 'Kernels and the statements they compute',
  kind: SchedIR.id,
  schemaVersion: SchedIR.version,
  validate: validateSchedule,
  relationKinds: {},
  entities,
  relations,
  resolve: (unit, id) => [...entities(unit)].find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});

/** The initial schedule: the fusion plan's groups as kernels, with no schedule decisions beyond theirs. */
export function toSchedule(fn: Fn, plan: FusionPlan): ScheduleUnit {
  return {
    fn,
    kernels: plan.groups.map(({ kernel, statements, depth, mapping, gated, ...rest }) => ({
      id: kernel,
      statements,
      depth,
      mode: mapping,
      gated,
      ...rest,
      reasons: [...rest.reasons],
    })),
    refusals: [
      ...plan.refusals.map(r => ({
        pass: 'tensor.plan-fusion',
        kernel: r.kernel,
        statement: r.statement,
        reason: r.reason,
      })),
      ...plan.termRefusals.map(r => ({
        pass: 'tensor.plan-fusion',
        kernel: r.kernel,
        statement: r.statement,
        reason: 'terms not staged: ' + r.reason,
      })),
    ],
  };
}
