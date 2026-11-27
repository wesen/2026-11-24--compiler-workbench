// IRWB-033-J: the schedule pipeline as a Strategy IR plan. `src/framework/strategy` fits where the lowering is
// asynchronous (the contract path): the plan is data, the passes are registered as algorithms (through the
// framework bridge, in gate mode: the same synchronous order gate as the plain path), and the interpreter
// records every application. Where it does not fit: `cudaSource` is synchronous by the fixed API and
// `S.execute` is an asynchronous interpreter, so the plain lowering path (schedule.ts) calls the same versioned
// step functions in this plan's order directly; a test asserts the two paths give the same schedule. The
// strategy layer also sees artifacts as opaque JSON: the decisions that need the IR live inside the passes, and
// the tile sizes ride along as plan arguments — the natural place for a later shape-aware selector.
import type { Artifact } from '../framework/core/types.js';
import { passAlgorithm } from '../framework/passes/index.js';
import {
  algorithm,
  apply,
  conditional,
  plan,
  ref,
  sequence,
} from '../framework/strategy/builders.js';
import { execute as executePlan } from '../framework/strategy/index.js';
import { AlgorithmRegistry } from '../framework/strategy/registry.js';
import {
  fusePass,
  orderGate,
  pipelinePass,
  tilePass,
  type ScheduleStep,
  type ScheduleUnit,
  type TileParams,
} from './schedule.js';

const registry = new AlgorithmRegistry()
  .register(passAlgorithm(fusePass, { gate: orderGate }))
  .register(passAlgorithm(tilePass, { gate: orderGate }))
  .register(passAlgorithm(pipelinePass, { gate: orderGate }))
  .register({
    id: 'tensor.fuse-flag',
    version: '1',
    kind: 'predicate',
    description: 'Whether this lowering fuses statements (the fixed API fuse option)',
    run: (_ctx, _input, args) => (args as { fuse?: boolean }).fuse === true,
  });

/** The schedule pipeline: fuse, then tile, then double-buffer — or nothing, when the lowering must stay plain. */
export const schedulePlan = plan(
  'tensor.schedule-pipeline',
  sequence(
    'pipeline',
    conditional(
      'fuse-or-plain',
      algorithm('tensor.fuse-flag', '1'),
      sequence(
        'fused',
        apply('fuse', algorithm('tensor.schedule.fuse', '1'), { input: ref('input', ['schedule']) }),
        apply('tile', algorithm('tensor.schedule.tile', '1'), {
          args: { tile: ref('input', ['tile']) },
        }),
        apply('double-buffer', algorithm('tensor.schedule.pipeline', '1')),
      ),
      sequence('plain'),
      { args: { fuse: ref('input', ['fuse']) } },
    ),
  ),
  'The schedule pipeline over the scheduling passes; the tile sizes are plan arguments',
);

/** Run the plan on the trivial schedule `r0`. Returns the final schedule and the step records. */
export async function runScheduleStrategy(input: {
  schedule: Artifact<ScheduleUnit>;
  fuse: boolean;
  tile: TileParams;
}): Promise<{ schedule: Artifact<ScheduleUnit>; steps: ScheduleStep[]; execution: unknown }> {
  const execution = await executePlan(schedulePlan, registry, input, { id: 'tensor-schedule-pipeline' });
  if (execution.status !== 'succeeded')
    throw Error(`The schedule plan ${execution.status}: ${execution.error?.message ?? execution.status}`);
  const value = execution.value as Artifact<ScheduleUnit> | { schedule: Artifact<ScheduleUnit> };
  const schedule = value && typeof value === 'object' && 'revision' in value ? value : value.schedule;
  const steps: ScheduleStep[] = [];
  for (const record of execution.records)
    for (const evidence of record.evidence)
      if (evidence.label === 'pass') {
        const data = evidence.data as { pass: string; changed: boolean; report?: string };
        steps.push({ pass: data.pass, changed: data.changed, reason: data.report ?? '' });
      }
  return { schedule, steps, execution };
}
