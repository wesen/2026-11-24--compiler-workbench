/**
 * IRWB-036-D: the driver that specializes an interpreter on its own input program.
 *
 * The pieces are ordinary checked passes: `specialize` binds a `cells` promise and folds the loads it licenses
 * (`specialize.ts`), and `dispatch` peels a dispatch loop per constant program-counter state (`dispatch.ts`). One
 * `dispatch` application can only peel the states that are constants *now*: the next state is an expression
 * (`pc = pc + 2`) that `constprop` and `fold` have not resolved yet. So the driver reserves the order for a fixed
 * point over the cleanup passes, and every step is one checked revision under the program's assumptions.
 *
 * This exists instead of a pipeline entry because the fixpoint needs a `typed.bindings` artifact, which a strategy
 * node cannot pass today (see the ticket's report, "Later").
 */
import type { Artifact } from '../framework/core/types.js';
import type { Program } from './program.js';
import { specialize, type Bindings } from './specialize.js';

/**
 * The order one round applies: fold what the promise licenses (a copy's dispatch becomes readable only after
 * `constprop` has carried `pc` into the fetch's temporaries), peel what is constant, then let the ordinary passes
 * resolve the next state.
 */
export const FUTAMURA_ROUND: readonly string[] = [
  'specialize',
  'dispatch',
  'constprop',
  'fold',
  'simplify',
  'cfg',
  'dce',
];

export interface FutamuraStep {
  readonly round: number;
  readonly pass: string;
  readonly rev: string;
  readonly changed: boolean;
  readonly edits: number;
  readonly check?: string;
}

export interface FutamuraRun {
  /** The revision after the promise was bound (before any peeling). */
  readonly bound: string;
  readonly rounds: number;
  readonly final: string;
  readonly steps: readonly FutamuraStep[];
  /** Whether the fixpoint stopped because nothing changed, or because the round budget ran out. */
  readonly stopped: 'stable' | 'budget';
}

/**
 * Bind `bindings` (a `typed.bindings` artifact: scalar parameters and, for a first Futamura projection, the
 * interpreted program as `cells`) and run the dispatch fixpoint under the restricted contract. Throws, leaving the
 * head and the assumptions as they were, if any revision is rejected by the meaning contract.
 */
export async function specializeOnBytecode(
  p: Program,
  bindings: Artifact<Bindings>,
  opts: { maxRounds?: number; round?: readonly string[]; count?: number } = {},
): Promise<FutamuraRun> {
  const round = opts.round ?? FUTAMURA_ROUND;
  const maxRounds = opts.maxRounds ?? 12;
  const bound = (await p.specialize(bindings)).rev;
  const steps: FutamuraStep[] = [];
  let rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    let changed = false;
    for (const name of round) {
      // `specialize` is not in PASSES: it needs a bindings artifact, which no pipeline can give it
      const pass = name === 'specialize' ? specialize : name;
      const r = await p.apply(pass, { count: opts.count, params: { bindings } });
      steps.push({
        round: rounds + 1,
        pass: r.pass,
        rev: r.rev,
        changed: r.changed,
        edits: r.edits,
        ...(r.check ? { check: r.check } : {}),
      });
      changed ||= r.changed;
    }
    if (!changed) break;
  }
  return {
    bound,
    rounds,
    final: `r${p.rev}`,
    steps,
    stopped: rounds < maxRounds ? 'stable' : 'budget',
  };
}
