// IRWB-033-G: the rule that picks a schedule for a Tix function.
//
// A strategy over the scheduling passes, not a search: the fusion plan builds the schedule, and every kernel that is
// a tiled-able contraction gets the same tile shape, chosen by measurement (probe 01 and the report's table) and by
// nothing else. There is no timing here and no candidate set — `fuse: false` schedules nothing at all, so stage 2's
// lowering stays byte for byte what it was.
import type { Artifact } from '../framework/core/types.js';
import type { Fn, Module } from './model.js';
import type { ScheduleFunction } from './schedule.js';
import { contractionOf } from './schedule.js';
import {
  applyScheduleStep,
  scheduleBuildPass,
  scheduleStageOperandPass,
  scheduleTileDomainPass,
  scheduleTileReductionPass,
  tixArtifact,
  type ScheduleStep,
} from './schedule-passes.js';

/**
 * The tile shape every tiled contraction gets (probe 01: 64×64×32×4×4 measured 0.0637 ms against 0.2467 for one
 * thread per output at 512³, and 18.9 ms against 241 at 4096³; larger blocks are better at 4096³ and much worse at
 * 512³, and the extents are only known at launch, so one static shape is what this stage has).
 */
export const contractionTiles = {
  block: [64, 64] as [number, number],
  lane: [4, 4] as [number, number],
  kTile: 32,
  stage: ['a', 'b'],
};

export interface Scheduled {
  schedule: ScheduleFunction;
  /** The schedule artifact, the exact revision a pass is applied to. */
  artifact: Artifact<ScheduleFunction>;
  steps: ScheduleStep[];
}

/** Build the schedule of `fn` and apply the strategy's steps to it. */
export function scheduleStrategy(
  fn: Fn,
  options: { fuse?: boolean; baseline?: Artifact<Module>; tiles?: typeof contractionTiles } = {},
): Scheduled {
  const fuse = options.fuse !== false;
  const tiles = options.tiles ?? contractionTiles;
  const steps: ScheduleStep[] = [];
  const build = applyScheduleStep(
    scheduleBuildPass,
    options.baseline ?? tixArtifact(fn),
    { fn, fuse },
    'tix-schedule/' + fn.name,
  );
  steps.push(build.step);
  let artifact: Artifact<ScheduleFunction> = build.artifact;
  if (!build.step.applied || !fuse) return { schedule: artifact.value, artifact, steps };
  // Every kernel that is a tiled-able contraction, in kernel order; a kernel that is not keeps the plan's schedule.
  const targets = artifact.value.kernels
    .filter(kernel => contractionOf(kernel, fn).ok)
    .map(kernel => kernel.name);
  for (const kernel of targets) {
    for (const [pass, params] of [
      [scheduleTileDomainPass, { block: tiles.block, lane: tiles.lane }],
      [scheduleTileReductionPass, { kTile: tiles.kTile }],
      [scheduleStageOperandPass, { stage: tiles.stage, buffer: 'single' as const }],
    ] as const) {
      const applied = applyScheduleStep(pass, artifact, { fn, kernel, ...params });
      steps.push(applied.step);
      artifact = applied.artifact;
    }
  }
  return { schedule: artifact.value, artifact, steps };
}

/** The schedule of `fn` with no scheduling step applied: what the fusion plan decided. */
export function plannedSchedule(
  fn: Fn,
  options: { fuse?: boolean; baseline?: Artifact<Module> } = {},
): Scheduled {
  const build = applyScheduleStep(
    scheduleBuildPass,
    options.baseline ?? tixArtifact(fn),
    { fn, fuse: options.fuse !== false },
    'tix-schedule/' + fn.name,
  );
  return { schedule: build.artifact.value, artifact: build.artifact, steps: [build.step] };
}
