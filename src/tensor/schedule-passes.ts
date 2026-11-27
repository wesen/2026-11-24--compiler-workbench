// IRWB-033-E: the steps from the initial schedule (stage 2) to the one that is printed, each a v6 pass on the
// schedule IR with its legality decided from the IR, a correspondence to the revision before it, and (when the
// pipeline runs checked) the interpreter's exact check. The order and the arguments are a Strategy IR plan.
import type { CheckResult } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact, type CorrespondenceEntry } from '../framework/ir/index.js';
import { definePass, syncPassAlgorithm, type Pass, type PassResult } from '../framework/passes/index.js';
import * as S from '../framework/strategy/index.js';
import { gate as gateConstants, planFusion, type FusionGroup } from './fusion.js';
import type { Fn } from './model.js';
import {
  configLimits,
  contractionOf,
  kernelOf,
  scheduleAdapter,
  ScheduleIR,
  type BlockKernel,
  type Schedule,
  type ScheduleKernel,
  type TileConfig,
} from './schedule.js';
import { scheduleGate } from './schedule-eval.js';

/** Stage 2 as a schedule: one thread kernel per statement, every statement stored. */
export function initialSchedule(fn: Fn): Schedule {
  return {
    fn,
    kernels: fn.statements.map((s, g) => ({
      kind: 'thread',
      name: 'k' + g,
      statements: [s.name],
      stored: [s.name],
      reasons: [],
    })),
  };
}
export const scheduleArtifact = (schedule: Schedule) =>
  createIRArtifact(scheduleAdapter, 'tix-schedule/' + schedule.fn.name, schedule);

/** The statements that are kernels of their own: marked contractions and tile kernels. */
const isolated = (s: Schedule) =>
  new Set(
    s.kernels
      .filter(k => k.kind === 'tile' || (k.kind === 'thread' && k.contraction))
      .flatMap(k => k.statements),
  );
/** Stage 3b's decisions for this schedule's grouping, by first statement. */
function planned(s: Schedule) {
  const plan = planFusion(s.fn, isolated(s));
  return new Map(plan.groups.map(g => [g.statements[0], g]));
}

function entries(before: Schedule, after: ScheduleKernel[], relation: string): CorrespondenceEntry[] {
  return [
    ...after.map(k => ({
      from: before.kernels.filter(b => b.statements.some(n => k.statements.includes(n))).map(b => b.name),
      to: [k.name],
      relation,
    })),
    ...before.fn.statements.map(x => ({ from: ['s/' + x.name], to: ['s/' + x.name], relation: 'same' })),
  ];
}
function step<P>(
  name: string,
  description: string,
  run: (schedule: Schedule, params: P) => ScheduleKernel[],
): Pass<Schedule, {}, P> {
  return definePass<Schedule, {}, P>({
    id: 'tensor.sched.' + name,
    version: '1',
    description,
    ir: ScheduleIR,
    adapter: scheduleAdapter,
    writes: { entities: ['kernel'], relations: ['computes'] },
    run: ({ before, params }) => {
      const kernels = run(before.value, params);
      return {
        native: { fn: before.value.fn, kernels },
        correspondence: entries(before.value, kernels, name),
      };
    },
  });
}
const onBlocks = (s: Schedule, change: (k: BlockKernel, g: FusionGroup) => BlockKernel) => {
  const plan = planned(s);
  return s.kernels.map(k => {
    const g = plan.get(k.statements[0]);
    return k.kind === 'block' && g && g.statements.length === k.statements.length ? change(k, g) : k;
  });
};
/** The configuration a tile step works on: the last one of each tile kernel (the one being built). */
const onConfig = (s: Schedule, change: (c: TileConfig) => TileConfig, what: string) =>
  s.kernels.map(k => {
    if (k.kind !== 'tile') return k;
    const next = change(k.configs.at(-1)!);
    const { problem } = configLimits(next);
    if (problem) throw Error(`${what} of ${k.name} refused: ${problem}`);
    return { ...k, configs: [...k.configs.slice(0, -1), next], reasons: [...k.reasons, what] };
  });

export const passes = {
  markContractions: step<undefined>(
    'mark-contractions',
    'Annotate single-statement thread kernels that have the contraction form with their row, column and batch axes',
    s =>
      s.kernels.map(k => {
        if (k.kind !== 'thread' || k.statements.length !== 1) return k;
        const c = contractionOf(s.fn.statements.find(x => x.name === k.statements[0])!);
        return 'refused' in c ? k : { ...k, contraction: c.roles };
      }),
  ),
  fuse: step<undefined>(
    'fuse',
    'Stage 3: merge adjacent kernels into thread or block kernels where every member reads the others at its own block point; a contraction stays alone',
    s => {
      if (s.kernels.some(k => k.kind !== 'thread' || k.statements.length !== 1))
        throw Error('fuse starts from one thread kernel per statement');
      const marks = new Map(
        s.kernels.map(k => [k.statements[0], k.kind === 'thread' ? k.contraction : undefined]),
      );
      return planFusion(s.fn, isolated(s)).groups.map(g => {
        const k = kernelOf(g, { terms: false, inPlace: false, gate: false });
        const contraction = marks.get(g.statements[0]);
        return k.kind === 'thread' && contraction ? { ...k, contraction } : k;
      });
    },
  ),
  stageTerms: step<undefined>(
    'stage-terms',
    'Stage 3b: all threads of a block compute the terms of a row reduction and one folds them in order',
    s =>
      onBlocks(s, (k, g) => ({
        ...k,
        terms: g.terms,
        heavy: g.heavy,
        reasons: [...k.reasons, ...g.reasons.filter(r => r.includes('compute the terms of'))],
      })),
  ),
  inPlace: step<undefined>('in-place', 'Stage 3b: write a row over the row it is computed from', s =>
    onBlocks(s, (k, g) => ({
      ...k,
      inPlace: g.inPlace,
      reasons: [...k.reasons, ...g.reasons.filter(r => r.includes('is written over the row of'))],
    })),
  ),
  gate: step<undefined>(
    'gate',
    'Stage 3b: the host chooses at launch between a block kernel and its statements one by one',
    s =>
      onBlocks(s, k => ({
        ...k,
        gate: { ...gateConstants, heavyLanes: [...gateConstants.heavyLanes] as [number, number] },
      })),
  ),
  tile: step<{ tile: [number, number]; minTiles: number; minTerms: number }>(
    'tile',
    'Give a contraction kernel a configuration with one block per tile of its (row, column) space and one thread per element',
    (s, { tile, minTiles, minTerms }) =>
      s.kernels.map(k => {
        const config: TileConfig = { tile, patch: [1, 1], chunk: 0, staged: false, minTiles, minTerms };
        const { problem } = configLimits(config);
        if (k.kind === 'thread' && k.contraction) {
          if (problem) throw Error(`tile of ${k.name} refused: ${problem}`);
          return {
            kind: 'tile' as const,
            name: k.name,
            statements: k.statements,
            stored: k.stored,
            roles: k.contraction,
            configs: [config],
            reasons: [
              ...k.reasons,
              `tile ${tile.join(' x ')} when there are at least ${minTiles} tiles and ${minTerms} terms`,
            ],
          };
        }
        if (k.kind !== 'tile') return k;
        if (problem) throw Error(`tile of ${k.name} refused: ${problem}`);
        return {
          ...k,
          configs: [...k.configs, config],
          reasons: [
            ...k.reasons,
            `tile ${tile.join(' x ')} when there are at least ${minTiles} tiles and ${minTerms} terms`,
          ],
        };
      }),
  ),
  // Unroll and jam: every thread's one element becomes a patch, so the tile grows by the patch and the block
  // keeps its threads. (A 64 x 64 tile with one thread per element is not a legal block: 4,096 threads.)
  registerTile: step<{ patch: [number, number] }>(
    'register-tile',
    'Each thread of a tile computes a patch of outputs in registers, the terms loop shared by the patch; the tile grows by the patch',
    (s, { patch }) =>
      onConfig(
        s,
        c => ({
          ...c,
          tile: [(c.tile[0] / c.patch[0]) * patch[0], (c.tile[1] / c.patch[1]) * patch[1]],
          patch,
        }),
        `patch ${patch.join(' x ')} per thread`,
      ),
  ),
  stageOperands: step<{ chunk: number }>(
    'stage-operands',
    "Run the terms in chunks and copy each chunk's factors to shared memory first",
    (s, { chunk }) =>
      onConfig(s, c => ({ ...c, chunk, staged: true }), `chunks of ${chunk} terms staged in shared memory`),
  ),
};

// The tile configurations, in the order the host tries them (IRWB-033-E probes 01 and 02 and report):
//  - 64 x 64 tiles, 4 x 4 patches, chunks of 16: the fastest at 512^3 (0.076 ms against 0.213 for stage 2) and
//    1024 x 256 x 1024 (0.099 against 0.451). It lost with 16 tiles (200^3: 0.027 against 0.018; 1024 x 1024 x 64:
//    0.109 against 0.096) and won with 64 (512^3).
//  - 32 x 32 tiles, 2 x 2 patches, chunks of 32: for fewer outputs (1024 x 1024 x 64: 0.072 with 64 tiles).
//  - A reduction needs enough terms: script 07 has the measurements behind MIN_TERMS.
const MIN_TERMS = 64;
// `threads` is the block before register tiling (one thread per element); the tile is threads x patch.
export const tileConfigs: {
  threads: [number, number];
  patch: [number, number];
  chunk: number;
  minTiles: number;
  minTerms: number;
}[] = [
  { threads: [16, 16], patch: [4, 4], chunk: 16, minTiles: 64, minTerms: MIN_TERMS },
  { threads: [16, 16], patch: [2, 2], chunk: 32, minTiles: 64, minTerms: MIN_TERMS },
];

/** The strategy that builds the fused schedule: stage 3 and 3b's steps, then one tile configuration at a time. */
export const fusedPlan = S.plan(
  'tensor.schedule.fused',
  S.sequence(
    'main',
    S.apply('mark', S.algorithm(passes.markContractions.id)),
    S.apply('fuse', S.algorithm(passes.fuse.id)),
    S.apply('terms', S.algorithm(passes.stageTerms.id)),
    S.apply('in-place', S.algorithm(passes.inPlace.id)),
    S.apply('gate', S.algorithm(passes.gate.id)),
    ...tileConfigs.flatMap(({ threads, patch, chunk, minTiles, minTerms }, i) => [
      S.apply(`tile-${i}`, S.algorithm(passes.tile.id), { args: { tile: threads, minTiles, minTerms } }),
      S.apply(`patch-${i}`, S.algorithm(passes.registerTile.id), { args: { patch } }),
      S.apply(`stage-${i}`, S.algorithm(passes.stageOperands.id), { args: { chunk } }),
    ]),
  ),
  'Stage 3 fusion and 3b terms, in-place rows and gate; then tiled contractions, one configuration at a time',
);
/** `fuse: false`: the initial schedule, unchanged. */
export const unfusedStrategy = S.plan('tensor.schedule.unfused', S.sequence('main'), 'Stage 2: no step');

export interface ScheduleStep {
  pass: string;
  changed: boolean;
  revision: string;
  check?: unknown;
}
/**
 * Run a plan from the initial schedule. Unchecked, a step's candidate is validated by the IR (structure and
 * legality); checked, it must also pass the interpreter's exact check (`scheduleGate`).
 */
export function buildSchedule(fn: Fn, plan: S.StrategyPlan, options?: { check?: boolean }) {
  const steps: ScheduleStep[] = [];
  const gate = (before: Artifact<Schedule>, candidate: Artifact<Schedule>): CheckResult =>
    options?.check ? scheduleGate(before, candidate) : { ok: true };
  const registry = new S.AlgorithmRegistry();
  for (const pass of Object.values(passes) as Pass<Schedule, {}, any>[])
    registry.register(
      syncPassAlgorithm(pass, gate, (r: PassResult<Schedule>) =>
        steps.push({
          pass: pass.id,
          changed: r.changed,
          revision: r.artifact.revision,
          ...(r.changed && { check: (r.contract as CheckResult | undefined)?.evidence }),
        }),
      ),
    );
  const initial = scheduleArtifact(initialSchedule(fn));
  const execution = S.executeSync(plan, registry, initial);
  if (execution.status !== 'succeeded') throw Error('Schedule step rejected: ' + execution.error?.message);
  return { initial, schedule: execution.result as Artifact<Schedule>, steps, records: execution.records };
}
