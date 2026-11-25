/**
 * IRWB-001 E5: differential checkers as v6 invariants.
 *
 * Compiler Workbench checks meaning by running two artifacts on the same generated inputs and comparing results,
 * traps and memory. v6 knows only exact checkers. `differential()` packages the sampled method as an ordinary
 * `InvariantDefinition`, so a transformation contract can `ensure` it like any other invariant. Its evidence records
 * the method (`sampled`), the case count and seed, how many cases agreed, disagreed or were inconclusive, and the
 * first counterexamples. Inconclusive cases (for example a step limit hit by either side) are counted and never
 * treated as a verdict; a check with no decided case fails, because it has established nothing.
 */
import { defineInvariant } from './definitions.js';
import type { CheckResult, InvariantDefinition, PortValue, PortValues, Ports } from './types.js';

/** A small deterministic generator (mulberry32), so a reported counterexample can be run again from its seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CaseComparison {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface DifferentialSpec<P extends Ports, Case, Outcome> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly inputs: P;
  /** The port whose behaviour defines the expected meaning (e.g. `origin`, r0). */
  readonly baseline: keyof P & string;
  /** The port being checked against it (e.g. `candidate`). */
  readonly subject: keyof P & string;
  readonly count: number;
  readonly seed?: number;
  /** Generate the cases, deterministically from `random` and the inputs. */
  cases(inputs: PortValues<P>, random: () => number, count: number): readonly Case[];
  /** Run one side on one case. `side` names which port `value` came from. */
  run(side: 'baseline' | 'subject', value: PortValue<P[keyof P]>, kase: Case, inputs: PortValues<P>): Outcome;
  compare(baseline: Outcome, subject: Outcome, kase: Case): CaseComparison | boolean;
  inconclusive?(outcome: Outcome): boolean;
  describeCase?(kase: Case): unknown;
  readonly maxCounterexamples?: number;
}

export interface DifferentialEvidence {
  readonly method: 'sampled';
  readonly invariant: string;
  readonly seed: number;
  readonly total: number;
  readonly agree: number;
  readonly disagree: number;
  readonly inconclusive: number;
  readonly status: 'agree' | 'disagree' | 'inconclusive';
  readonly counterexamples: readonly { readonly case: unknown; readonly reason: string }[];
}

export type DifferentialInvariant<P extends Ports> = InvariantDefinition<P> & {
  readonly method: 'sampled';
};

export function differential<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
): DifferentialInvariant<P> {
  if (!(spec.count > 0 && Number.isInteger(spec.count)))
    throw new Error('Differential check needs a positive case count');
  if (!(spec.baseline in spec.inputs) || !(spec.subject in spec.inputs) || spec.baseline === spec.subject)
    throw new Error('Differential check needs distinct baseline and subject ports');
  const seed = spec.seed ?? 1,
    maxCx = spec.maxCounterexamples ?? 5;
  const inv = defineInvariant<P>({
    id: spec.id,
    version: spec.version,
    description: spec.description,
    inputs: spec.inputs,
    check(_ctx, inputs): CheckResult {
      const evidence = runDifferential(spec, inputs, seed, maxCx);
      return {
        ok: evidence.status === 'agree',
        reason:
          evidence.status === 'agree'
            ? `${evidence.agree}/${evidence.total} sampled cases agree (${evidence.inconclusive} inconclusive)`
            : evidence.status === 'disagree'
              ? `${evidence.disagree}/${evidence.total} sampled cases disagree`
              : `no decided case among ${evidence.total} (all inconclusive)`,
        evidence,
      };
    },
  });
  return Object.assign(Object.create(null), inv, { method: 'sampled' as const }) as DifferentialInvariant<P>;
}

/** Run a differential specification directly (tools, the workbench's Checks view) without a manager. */
export function runDifferential<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  inputs: PortValues<P>,
  seed = spec.seed ?? 1,
  maxCounterexamples = spec.maxCounterexamples ?? 5,
): DifferentialEvidence {
  const cases = spec.cases(inputs, seededRandom(seed), spec.count);
  let agree = 0,
    disagree = 0,
    inconclusive = 0;
  const counterexamples: { case: unknown; reason: string }[] = [];
  for (const kase of cases) {
    const a = spec.run('baseline', inputs[spec.baseline] as PortValue<P[keyof P]>, kase, inputs);
    const b = spec.run('subject', inputs[spec.subject] as PortValue<P[keyof P]>, kase, inputs);
    if (spec.inconclusive?.(a) || spec.inconclusive?.(b)) {
      inconclusive++;
      continue;
    }
    const c = spec.compare(a, b, kase);
    const verdict = typeof c === 'boolean' ? { ok: c } : c;
    if (verdict.ok) agree++;
    else {
      disagree++;
      if (counterexamples.length < maxCounterexamples)
        counterexamples.push({
          case: spec.describeCase ? spec.describeCase(kase) : kase,
          reason: verdict.reason ?? 'outcomes differ',
        });
    }
  }
  return {
    method: 'sampled',
    invariant: spec.id,
    seed,
    total: cases.length,
    agree,
    disagree,
    inconclusive,
    status: disagree ? 'disagree' : agree ? 'agree' : 'inconclusive',
    counterexamples,
  };
}

/** The assurance a check's evidence supports: sampled differential testing is weaker than an exact checker. */
export function assuranceOf(evidence: unknown): 'checked-sampled' | 'checked-exact' {
  return (evidence as { method?: string } | null)?.method === 'sampled' ? 'checked-sampled' : 'checked-exact';
}
