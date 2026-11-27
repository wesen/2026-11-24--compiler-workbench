// IRWB-033-H: the rule that picks a schedule (design-doc/01 in the ticket).
//
// The rule is a Strategy IR plan over the schedule passes (src/framework/strategy), executed by the framework's
// synchronous plan executor because the lowering is synchronous by its public API. It emits, in order:
//
//   tile-reduction    split the contraction's reduction and stage both operands in shared memory
//   bind-thread-patch how much of the output plane one thread owns in registers
//   bind-block-tile   the block's tile of the output plane (a multiple of the patch, so 32..1024 threads)
//   unroll            unroll the complete reduction tiles and the register patch
//   launch-variants   print further layouts and let the launch choose by the cost model
//
// The patch comes before the block tile because the block tile's legality divides by it: with the patch bound
// first, every block tile the rule asks for has a legal thread count.
//
// The last step is where the shape values enter. `cudaSource` has no shapes, so a compile-time choice could only
// be a constant; the shapes are known at launch, and the cost model (`costModel` in schedule.ts) is arithmetic over
// the schedule and the shapes, evaluated on the host. Nothing is timed.
import type { Artifact } from '../framework/core/types.js';
import {
  AlgorithmRegistry,
  apply,
  algorithm,
  plan,
  runPlanSync,
  sequence,
} from '../framework/strategy/index.js';
import { syncPassAlgorithm } from '../framework/passes/index.js';
import type { FusionPlan } from './fusion.js';
import type { Fn } from './model.js';
import {
  accumulationOrder,
  bindBlockTile,
  bindThreadPatch,
  checkVariant,
  launchVariants,
  orderPreserved,
  scheduleArtifact,
  scheduleFromPlan,
  tileReduction,
  unroll,
  type Schedule,
  type Step,
  type Variant,
} from './schedule.js';

/**
 * The layouts the rule considers, primary first. Each was measured in script 02 (512^3 and 4096^3): 64x64 with an
 * 8x4 patch is the best large-tile form, 32x32 with a 4x4 patch the best small one, and 64x64 with a 4x4 patch the
 * middle. The launch's cost model decides between them; the primary is what the passes bind.
 */
export const variants: Variant[] = [
  { tile: 16, blockRows: 64, blockCols: 64, patchRows: 8, patchCols: 4 },
  { tile: 16, blockRows: 32, blockCols: 32, patchRows: 4, patchCols: 4 },
  { tile: 16, blockRows: 64, blockCols: 64, patchRows: 4, patchCols: 4 },
];

const steps = [tileReduction, bindThreadPatch, bindBlockTile, unroll, launchVariants] as const;
const primary = variants[0];

/** The plan the rule emits: data in the framework's format, one `apply` per decision. */
export function scheduleStrategy() {
  const step = (name: string, id: string, args: unknown) =>
    apply(name, algorithm(id), { args: args as never });
  return plan(
    'tensor.contraction-tiles',
    sequence(
      'tiles',
      step('tile', tileReduction.id, { tile: primary.tile }),
      step('patch', bindThreadPatch.id, { rows: primary.patchRows, cols: primary.patchCols }),
      step('block', bindBlockTile.id, { rows: primary.blockRows, cols: primary.blockCols }),
      step('unroll', unroll.id, { reduction: true, patch: true }),
      step('variants', launchVariants.id, {
        variants: variants.filter(v => 'ok' in checkVariant(v)),
        fallback: true,
      }),
    ),
    'Tile a thread-mode contraction in shared memory and let the launch choose its layout by the cost model',
    steps.map(p => ({ id: p.id, version: p.version })),
  );
}

/**
 * The schedule of one function: the fusion plan's schedule, then the rule's steps in order.
 *
 * If a step refuses, the rule asked for something its own legality should have refused — a bug, not a fallback —
 * but the compiler still has to produce a source, so the schedule is then the fusion plan's, which is legal for
 * every program. The refusal is not silent: `steps` is empty and a test pins that no corpus program takes it.
 */
export function scheduleOf(
  fn: Fn,
  fusionPlan: FusionPlan,
  /** `false` keeps the plan's schedule untouched: `fuse: false` is stage 2's lowering, byte for byte. */
  options?: { tile?: boolean },
): { schedule: Schedule; steps: Step[] } {
  const initial = scheduleArtifact(scheduleFromPlan(fn, fusionPlan));
  if (options?.tile === false) return { schedule: initial.value, steps: [] };
  const applied: Step[] = [];
  const registry = new AlgorithmRegistry();
  for (const pass of steps)
    registry.register(
      syncPassAlgorithm(pass as never, {
        gate: orderPreserved,
        claims: [accumulationOrder],
        onResult: result =>
          void applied.push({
            pass: result.pass.id,
            version: result.pass.version,
            args: undefined,
            revision: result.artifact.revision,
            changed: result.changed,
          }),
      }),
    );
  try {
    const run = runPlanSync(scheduleStrategy(), registry, initial as Artifact<unknown>);
    run.steps.forEach((s, i) => {
      const record = applied[i];
      if (record) record.args = s.args;
    });
    return { schedule: (run.value as Artifact<Schedule>).value, steps: applied };
  } catch {
    return { schedule: initial.value, steps: [] };
  }
}
