// IRWB-033-I: scheduling steps as v6 passes over the schedule IR (design/01 in the ticket).
//
// Each pass decides its legality from the schedule value (which carries the Tix function) and records what it
// refused and why. The pure transforms here are shared by the synchronous lowering path (cudaSource,
// runTixCuda) and the checked path (checkLowering applies them through the framework's pass machinery, which
// diffs revisions, enforces the declared writes and derives the correspondence).
//
// Order preservation, the invariant every pass must keep: each output element accumulates its terms one at a
// time in the meaning's order — reduction axes ascending, first axis outermost, chunk-major after a chunk
// split — rounding the product and the sum separately. A staged copy moves words unchanged; a register
// accumulator belongs to exactly one output element and is touched only by that element's own term sequence.
import { definePass } from '../framework/passes/index.js';
import { groupDetails, outerReductions, planFusion, unfusedPlan } from './fusion.js';
import { plain, width as splitWidth, type Expr, type Fn, type Statement } from './model.js';

type Load = Extract<Expr, { kind: 'load' }>;
type Reduce = Extract<Expr, { kind: 'reduce' }>;
import {
  scheduleAdapter,
  SchedIR,
  toSchedule,
  type ChunkSchedule,
  type ScheduleUnit,
  type SchedKernel,
  type StageTile,
  type TileMember,
} from './schedule.js';

type Refusal = ScheduleUnit['refusals'][number];
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The tile rule's configuration for a two-axis tiled run (the only rank the pass tiles; single-axis runs stay
 *  in their row kernel). `chunk` is the reduction's chunk extent, in elements or, for a reduction that the
 *  split-sum pass already split, in blocks. */
export interface TileConfig {
  block: [number, number];
  patch: [number, number];
  chunk: number;
}
export const tileConfigDefault: TileConfig = { block: [64, 64], patch: [4, 4], chunk: 32 };

/** The gate rule for tile kernels: the tile grid must have at least this many blocks before the tiled path
 *  beats stage 2's one-thread-per-element kernels. Set from the crossover measured in the ticket's scripts. */
export const tileGate = { minTiles: 4 };

function loads(e: Expr): Load[] {
  const out: Load[] = [];
  const walk = (x: Expr) => {
    if (x.kind === 'load') out.push(x);
    if (x.kind === 'op') x.args.forEach(walk);
    if (x.kind === 'reduce') walk(x.body);
  };
  walk(e);
  return out;
}

/** Whether every read of `names` in s is at s's own indices (the condition that keeps a run in registers). */
function ownReads(s: Statement, names: Set<string>): boolean {
  return loads(s.expr)
    .filter(e => names.has(e.name))
    .every(e => e.indices.length === s.axes.length && e.indices.every((a, p) => plain(a) === s.axes[p].id));
}

/** The chunk schedule of one outermost reduction, or the reason it stays serial. */
function chunkOf(
  r: Reduce,
  m: Statement,
  tensors: ReadonlyMap<string, { shape: import('./model.js').Affine[] }>,
  config: TileConfig,
): { chunk?: ChunkSchedule; refusal?: string } {
  const axes = r.axes.map(a => a.id);
  const first = r.axes[0];
  // The split-sum pass's canonical form: an outer axis with a `blocks` extent, an inner axis with a `tail`
  // extent bound by it, and every read index of the pair of the form lane + block*width.
  const split =
    r.axes.length === 2 &&
    (first.extent.kind === 'blocks' || first.extent.kind === 'tail') &&
    r.axes[1].extent.kind === 'tail' &&
    r.axes[1].extent.block === first.id
      ? { inner: r.axes[1].id, width: splitWidth }
      : undefined;
  if (first.extent.kind !== 'dim' && !split)
    return { refusal: `${r.op}: the first axis is not a plain extent the pass can chunk` };
  const stage = new Map<string, StageTile>();
  for (const e of loads(r.body)) {
    const dims: StageTile['dims'] = [];
    for (const index of e.indices) {
      const id = plain(index);
      if (id && axes.includes(id)) {
        if (id !== first.id && !(split && id === split.inner))
          return {
            refusal: `${r.op}: the reduction axis ${id} appears in a read beyond the chunked first axis`,
          };
        dims.push('chunk');
      } else if (id && m.axes.some(a => a.id === id)) {
        dims.push(id);
      } else
        return {
          refusal: `${r.op}: reads ${e.name} at an index (${JSON.stringify(index)}) that is neither a reduction axis nor one output axis`,
        };
    }
    if (dims.includes('chunk') && !stage.has(e.name)) stage.set(e.name, { tensor: e.name, dims });
  }
  if (!stage.size) return { refusal: `${r.op}: no read of the body depends on the chunked axis` };
  return {
    chunk: {
      axis: first.id,
      size: config.chunk,
      unit: split ? 'block' : 'element',
      ...(split ? { split } : {}),
      stage: [...stage.values()],
    },
  };
}

function tileMember(
  m: Statement,
  tensors: ReadonlyMap<string, { shape: import('./model.js').Affine[] }>,
  config: TileConfig,
): { tile: TileMember; refusals: string[] } {
  const refusals: string[] = [];
  const chunks = outerReductions(m.expr).map(r => {
    const made = chunkOf(r, m, tensors, config);
    if (made.refusal) refusals.push(made.refusal);
    return made.chunk;
  });
  return {
    tile: {
      statement: m.name,
      block: [...config.block],
      patch: [...config.patch],
      patchMap: ['contiguous', 'strided'],
      chunks,
    },
    refusals,
  };
}

const chunkable = (tile: TileMember) => tile.chunks.some(c => c && c.stage.length > 0);

/** The tile pass: partition each kernel's members into runs of equal shape, tile the runs that have a
 *  chunkable contraction reading global memory, and leave the rest in their kernel. */
export function applyTile(fn: Fn, unit: ScheduleUnit, config: TileConfig = tileConfigDefault): ScheduleUnit {
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const statements = new Map(fn.statements.map(s => [s.name, s]));
  const refusals = [...unit.refusals];
  const rebuilt: { members: Statement[]; tile?: TileMember[]; depth: number; reasons: string[] }[] = [];
  for (const kernel of unit.kernels) {
    if (kernel.mode === 'tile') {
      rebuilt.push({
        members: kernel.statements.map(n => statements.get(n)!),
        tile: kernel.tiles,
        depth: 0,
        reasons: kernel.reasons,
      });
      continue;
    }
    const members = kernel.statements.map(n => statements.get(n)!);
    // A run is a maximal set of consecutive members of equal shape whose members read each other only at their
    // own indices; a member that breaks the rule starts a new run.
    const runs: Statement[][] = [];
    for (const s of members) {
      const run = runs.at(-1);
      if (run && eq(run[0].shape, s.shape) && ownReads(s, new Set(run.map(r => r.name)))) run.push(s);
      else runs.push([s]);
    }
    let kept: (typeof rebuilt)[number] | undefined;
    for (const run of runs) {
      const made = run.map(m => tileMember(m, tensors, config));
      const tileable = run[0].axes.length === 2 && made.some(m => chunkable(m.tile));
      if (!tileable) {
        for (const [i, m] of run.entries())
          for (const note of made[i].refusals)
            refusals.push({ pass: 'tensor.sched.tile', kernel: kernel.id, statement: m.name, reason: note });
        refusals.push({
          pass: 'tensor.sched.tile',
          kernel: kernel.id,
          statement: run[0].name,
          reason:
            run[0].axes.length !== 2
              ? `the run has ${run[0].axes.length} axes; the pass tiles two-axis runs`
              : 'no reduction of the run reads a tensor from global memory in a chunkable position',
        });
        if (kept) kept.members.push(...run);
        else rebuilt.push({ members: [...run], depth: kernel.depth, reasons: [] });
        kept = rebuilt.at(-1);
        continue;
      }
      const tiles = made.map(m => m.tile);
      tiles.forEach(t => (t.unroll = true));
      rebuilt.push({
        members: run,
        tile: tiles,
        depth: 0,
        reasons: [
          `tiled: one block per tile of the output space (${config.block.join('x')}), a ` +
            `${config.patch.join('x')} register patch per thread, reductions chunked by ${config.chunk}`,
        ],
      });
      kept = undefined;
    }
  }
  // Readers over the new kernel sequence, for the stored and staged decisions of the kernels that stay.
  const readerKernels = new Map<string, number[]>();
  rebuilt.forEach((seg, g) =>
    seg.members.forEach(s =>
      loads(s.expr).forEach(e => readerKernels.set(e.name, [...(readerKernels.get(e.name) ?? []), g])),
    ),
  );
  const kernels: SchedKernel[] = [];
  rebuilt.forEach((seg, g) => {
    if (seg.tile) {
      kernels.push({
        id: 'k' + kernels.length,
        statements: seg.members.map(m => m.name),
        depth: 0,
        mode: 'tile',
        gated: true,
        threads: (config.block[0] / config.patch[0]) * (config.block[1] / config.patch[1]),
        stored: seg.members
          .filter(
            m =>
              (seg.members.length === 1 && m.name === fn.result) ||
              (readerKernels.get(m.name) ?? []).some(r => r > g),
          )
          .map(m => m.name),
        tiles: seg.tile,
        reasons: seg.reasons,
      });
      return;
    }
    const { details, termRefusals } = groupDetails(
      fn,
      seg.members,
      seg.depth,
      readerKernels,
      kernels.length,
      seg.reasons,
    );
    for (const r of termRefusals)
      refusals.push({
        pass: 'tensor.plan-fusion',
        kernel: r.kernel,
        statement: r.statement,
        reason: 'terms not staged: ' + r.reason,
      });
    const block = seg.members.some(m => m.axes.length > seg.depth);
    kernels.push({
      id: 'k' + kernels.length,
      statements: seg.members.map(m => m.name),
      depth: seg.depth,
      mode: block ? 'block' : 'thread',
      gated: block,
      ...details,
    });
  });
  return { fn: unit.fn, kernels, refusals };
}

// The bind pass: thread counts for block kernels (stage 3's measured caps, decided here so the emitter does not
// decide) and the staged tiles' vector widths and padding.
//
// Threads of a block-mode kernel: 128 for rows-only kernels, 64 when a member's reduction reads a tensor from
// global memory (a contraction operand: attention's k and v, mlp's w and v; IRWB-029-D diary step 4). A kernel
// with heavy members keeps its launch-time width (it needs the shape values), so `threads` stays unset there
// and the emitter's host code computes it as stage 3 did — a launch-time rule, like the gate.
export const blockThreads = { rows: 128, contraction: 64, heavy: 256 };
function operandsFromGlobal(e: Expr, rowBuffers: Set<string>, inKernel: Set<string>): boolean {
  let found = false;
  const walk = (x: Expr, inReduction: boolean): void => {
    if (x.kind === 'load') {
      if (inReduction && !rowBuffers.has(x.name) && !inKernel.has(x.name)) found = true;
    } else if (x.kind === 'op') x.args.forEach(a => walk(a, inReduction));
    else if (x.kind === 'reduce') walk(x.body, true);
  };
  walk(e, false);
  return found;
}
export function applyBind(fn: Fn, unit: ScheduleUnit): ScheduleUnit {
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const statements = new Map(fn.statements.map(s => [s.name, s]));
  const kernels = unit.kernels.map((kernel): SchedKernel => {
    if (kernel.mode !== 'block') return kernel;
    const members = kernel.statements.map(n => statements.get(n)!);
    const rowBuffers = new Set([...(kernel.staged ?? []), ...(kernel.buffered ?? [])]);
    const inKernel = new Set(kernel.statements);
    if (kernel.heavy?.length)
      return {
        ...kernel,
        reasons: [...kernel.reasons, 'the block width is chosen at launch (heavy members)'],
      };
    const cap = members.some(m => operandsFromGlobal(m.expr, rowBuffers, inKernel))
      ? blockThreads.contraction
      : blockThreads.rows;
    return {
      ...kernel,
      threads: cap,
      reasons: [
        ...kernel.reasons,
        `${cap} threads per block (the stage 3 cap for ${cap === blockThreads.contraction ? 'contraction' : 'rows-only'} kernels)`,
      ],
    };
  });
  // Staged tiles: padding 1 per row, to break the bank conflicts of the patch reads (the tile's row stride
  // becomes odd, so a warp's rows hit distinct banks). The `vector` field is reserved for float4 staging in a
  // later step; the runtime row-alignment rule it needs is a gate condition on the shape values. The schedule
  // value is frozen, so the tiles are copied, not mutated.
  const padded = kernels.map((kernel): SchedKernel => {
    if (kernel.mode !== 'tile') return kernel;
    return {
      ...kernel,
      tiles: kernel.tiles?.map(t => ({
        ...t,
        chunks: t.chunks.map(c => c && { ...c, stage: c.stage.map(s => ({ ...s, pad: 1 })) }),
      })),
    };
  });
  return { fn: unit.fn, kernels: padded, refusals: [...unit.refusals] };
}

// The unroll pass: mark the fixed-length loops of tile kernels for `#pragma unroll`.
export function applyUnroll(fn: Fn, unit: ScheduleUnit): ScheduleUnit {
  void fn;
  const kernels = unit.kernels.map(
    (kernel): SchedKernel =>
      kernel.mode !== 'tile'
        ? kernel
        : {
            ...kernel,
            tiles: kernel.tiles?.map(t => ({ ...t, unroll: true })),
            reasons: [...kernel.reasons],
          },
  );
  return { fn: unit.fn, kernels, refusals: [...unit.refusals] };
}

// The passes as v6 pass definitions. The schedule's members survive every pass unchanged, so the framework's
// diff derives the member-to-member correspondence; the tile pass may split kernels, which the diff sees as
// changed kernel entities.
export const tileSchedPass = definePass<ScheduleUnit, {}, TileConfig>({
  id: 'tensor.sched.tile',
  version: '1',
  description: 'Tile eligible contraction runs: block tiles, register patches, chunked reductions',
  ir: SchedIR,
  adapter: scheduleAdapter,
  writes: { entities: ['member'], relations: [] },
  run: ({ before, params }) => ({
    native: applyTile(before.value.fn, before.value, params ?? tileConfigDefault),
    edits: 1,
  }),
});
export const bindSchedPass = definePass<ScheduleUnit>({
  id: 'tensor.sched.bind',
  version: '1',
  description: 'Bind threads to blocks (the measured caps) and choose staged tile widths and padding',
  ir: SchedIR,
  adapter: scheduleAdapter,
  writes: { entities: ['member'], relations: [] },
  run: ({ before }) => ({ native: applyBind(before.value.fn, before.value), edits: 1 }),
});
export const unrollSchedPass = definePass<ScheduleUnit>({
  id: 'tensor.sched.unroll',
  version: '1',
  description: 'Unroll the fixed-length patch and chunk loops of tile kernels',
  ir: SchedIR,
  adapter: scheduleAdapter,
  writes: { entities: ['member'], relations: [] },
  run: ({ before }) => ({ native: applyUnroll(before.value.fn, before.value), edits: 1 }),
});
export const schedulePasses = [tileSchedPass, bindSchedPass, unrollSchedPass] as const;

/** The schedule for one lowering: the fusion plan's groups, then the passes in order. The synchronous
 *  lowering path (cudaSource, runTixCuda) applies the same transforms the checked path applies through the
 *  pass machinery; checkLowering is where each step's contract and the chain's composed correspondence run. */
export function scheduleFor(f: Fn, fuse: boolean, config: TileConfig = tileConfigDefault): ScheduleUnit {
  const initial = toSchedule(f, fuse ? planFusion(f) : unfusedPlan(f));
  if (!fuse) return initial;
  return applyUnroll(f, applyBind(f, applyTile(f, initial, config)));
}
