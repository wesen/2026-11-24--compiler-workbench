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
import { fingerprint } from '../core/data.js';
import { ContractError } from './analysis-manager.js';
import { defineInvariant } from './definitions.js';
import { drive, driveAsync, wait, type Steps } from '../core/steps.js';
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
  /** The generator to seed (default `seededRandom`, mulberry32); a port may supply its tool's own generator. */
  readonly random?: (seed: number) => () => number;
  /** Generate the cases, deterministically from `random` and the inputs. */
  cases(inputs: PortValues<P>, random: () => number, count: number): readonly Case[];
  /** Run one side on one case. `side` names which port `value` came from. */
  run(side: 'baseline' | 'subject', value: PortValue<P[keyof P]>, kase: Case, inputs: PortValues<P>): Outcome;
  compare(baseline: Outcome, subject: Outcome, kase: Case): CaseComparison | boolean;
  inconclusive?(outcome: Outcome): boolean;
  describeCase?(kase: Case): unknown;
  readonly maxCounterexamples?: number;
  /**
   * IRWB-004 D1: a key such that the cases, and the baseline's outcome on each, are a function of this spec (its id,
   * version, seed and count) and the key alone; for a check against a fixed origin, the origin's revision. With a
   * key, both are computed once per key and reused by every later check.
   */
  readonly baselineKey?: (inputs: PortValues<P>) => string | undefined;
  /**
   * IRWB-004 D1: a key such that the subject's outcome on a case is a function of the case and the key alone (for a
   * program, a hash of the code the case can reach). Used only together with `baselineKey`: a decided verdict is
   * kept under (baseline key, case index, subject key) and replayed instead of evaluating the case again.
   */
  readonly subjectKey?: (
    subject: PortValue<P[keyof P]>,
    kase: Case,
    inputs: PortValues<P>,
  ) => string | undefined;
  /**
   * IRWB-004 F4: decide the cases at the indices `todo` elsewhere (e.g. on worker threads), returning one verdict
   * per index, in the order of `todo`, exactly as `run`, `inconclusive` and `compare` would decide them; or
   * `undefined` to decide them here. The check's evidence is assembled in case order, whoever decided a case.
   */
  readonly decide?: (
    inputs: PortValues<P>,
    cases: readonly Case[],
    todo: readonly number[],
  ) => Promise<readonly Decided[]> | undefined;
}

/** One decided case: what `compare` (or `inconclusive`) concluded. */
export type Decided =
  | { readonly v: 'agree' }
  | { readonly v: 'inconclusive' }
  | { readonly v: 'disagree'; readonly reason: string };

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
  const result = (evidence: DifferentialEvidence): CheckResult => ({
    ok: evidence.status === 'agree',
    reason:
      evidence.status === 'agree'
        ? `${evidence.agree}/${evidence.total} sampled cases agree (${evidence.inconclusive} inconclusive)`
        : evidence.status === 'disagree'
          ? `${evidence.disagree}/${evidence.total} sampled cases disagree`
          : `no decided case among ${evidence.total} (all inconclusive)`,
    evidence,
  });
  const inv = defineInvariant<P>({
    id: spec.id,
    version: spec.version,
    description: spec.description,
    inputs: spec.inputs,
    check(_ctx, inputs): CheckResult | Promise<CheckResult> {
      // IRWB-052: a promise only when `spec.decide` took the cases; otherwise the verdict is returned as a value,
      // so a synchronous driver can run a contract whose check has an executor hook but no executor installed
      const evidence = drive(differentialSteps(spec, inputs, seed, maxCx));
      return evidence instanceof Promise ? evidence.then(result) : result(evidence);
    },
  });
  const out = Object.assign(Object.create(null), inv, {
    method: 'sampled' as const,
  }) as DifferentialInvariant<P>;
  SPECS.set(out, spec as DifferentialSpec<any, any, any>);
  return out;
}

const SPECS = new WeakMap<object, DifferentialSpec<any, any, any>>();
/** IRWB-004 F4: the specification a differential invariant was made from (a worker decides cases with it). */
export function differentialSpec<P extends Ports>(
  inv: DifferentialInvariant<P>,
): DifferentialSpec<P, any, any> {
  const spec = SPECS.get(inv);
  if (!spec) throw new Error(`${inv.id} is not a differential invariant of this realm`);
  return spec;
}

/**
 * IRWB-004 D1: what a check against a baseline key keeps. The cases and the baseline's outcomes (computed as cases
 * are first evaluated) are fixed by the key; `verdicts` maps `index \0 subject key` to the decided verdict. A few
 * keys are kept, least recently used first out.
 */
interface Reuse {
  readonly key: string;
  readonly cases: readonly unknown[];
  readonly caseDigest: string;
  readonly outcomes: unknown[];
  readonly verdicts: Map<string, Decided>;
}
const REUSE = new Map<string, Reuse>();
// A running batch can outlive its baseline's entry in the bounded verdict cache.
const IN_FLIGHT = new Map<string, Promise<readonly Decided[]>>();
const REUSE_MAX = 4;
let reuseEnabled = true;
/** Turn the reuse of cases, baseline outcomes and verdicts on or off (tests and measurements compare both). */
export function setDifferentialReuse(enabled: boolean): void {
  reuseEnabled = enabled;
  if (!enabled) {
    REUSE.clear();
    IN_FLIGHT.clear();
  }
}
/** Counts since the last reset: sides run here, verdicts replayed from the memo, cases decided by `decide`. */
const STATS = { baselineRuns: 0, subjectRuns: 0, replayed: 0, delegated: 0 };
export function differentialStats(reset = false): Readonly<typeof STATS> {
  const out = { ...STATS };
  if (reset) for (const k of Object.keys(STATS) as (keyof typeof STATS)[]) STATS[k] = 0;
  return out;
}

/** Encode case values as canonical plain data, preserving typed-array bytes and special numbers. */
function caseDigest(cases: readonly unknown[]): string {
  function encode(value: unknown): unknown {
    if (value === null) return ['null'];
    if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      value === undefined
    )
      return [typeof value, String(value)];
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return [
        'view',
        Object.getPrototypeOf(value).constructor.name,
        Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
      ];
    }
    if (value instanceof ArrayBuffer)
      return ['buffer', Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('')];
    if (Array.isArray(value)) return ['array', value.map(encode)];
    if (value instanceof Date) return ['date', String(value.getTime())];
    if (value instanceof Map) return ['map', [...value].map(([k, v]) => [encode(k), encode(v)])];
    if (value instanceof Set) return ['set', [...value].map(encode)];
    if (typeof value === 'object')
      return [
        'object',
        Object.keys(value)
          .sort()
          .map(k => [k, encode((value as Record<string, unknown>)[k])]),
      ];
    throw new Error('Unsupported differential case value');
  }
  return fingerprint(encode(cases));
}

function prepare<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  inputs: PortValues<P>,
  seed: number,
): { cases: readonly Case[]; reuse?: Reuse } {
  const bk = reuseEnabled ? spec.baselineKey?.(inputs) : undefined;
  if (bk === undefined) return { cases: spec.cases(inputs, (spec.random ?? seededRandom)(seed), spec.count) };
  const key = `${spec.id}@${spec.version}#${seed}#${spec.count}#${bk}`;
  let reuse = REUSE.get(key);
  if (reuse) {
    const current = spec.cases(inputs, (spec.random ?? seededRandom)(seed), spec.count);
    if (reuse.caseDigest !== caseDigest(current))
      throw new ContractError('baseline-key', `Differential baseline key ${bk} produced different cases`);
    REUSE.delete(key);
  } else {
    const cases = spec.cases(inputs, (spec.random ?? seededRandom)(seed), spec.count);
    reuse = {
      key,
      cases,
      caseDigest: caseDigest(cases),
      outcomes: [],
      verdicts: new Map(),
    };
  }
  REUSE.set(key, reuse);
  while (REUSE.size > REUSE_MAX) REUSE.delete(REUSE.keys().next().value!);
  return { cases: reuse.cases as readonly Case[], reuse };
}

const AGREE: Decided = Object.freeze({ v: 'agree' }),
  INCONCLUSIVE: Decided = Object.freeze({ v: 'inconclusive' });
/**
 * Decide one case: run both sides, then `inconclusive`, then `compare`, as a check always has. `outcomes`, when
 * given, keeps the baseline's outcome by case index (it is fixed by the baseline key); a worker deciding cases for a
 * check (IRWB-004 F4) calls this too, with its own `outcomes`.
 */
export function decideCase<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  inputs: PortValues<P>,
  kase: Case,
  index: number,
  outcomes?: unknown[],
): Decided {
  let a = outcomes?.[index] as Outcome | undefined;
  if (a === undefined) {
    a = spec.run('baseline', inputs[spec.baseline] as PortValue<P[keyof P]>, kase, inputs);
    STATS.baselineRuns++;
    if (outcomes) outcomes[index] = a;
  }
  STATS.subjectRuns++;
  const b = spec.run('subject', inputs[spec.subject] as PortValue<P[keyof P]>, kase, inputs);
  if (spec.inconclusive?.(a) || spec.inconclusive?.(b)) return INCONCLUSIVE;
  const c = spec.compare(a, b, kase);
  const verdict = typeof c === 'boolean' ? { ok: c } : c;
  return verdict.ok ? AGREE : Object.freeze({ v: 'disagree', reason: verdict.reason ?? 'outcomes differ' });
}

/** The evidence of decided cases, counted in case order (so counterexamples come in case order). */
function tally<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  seed: number,
  cases: readonly Case[],
  verdicts: readonly Decided[],
  maxCounterexamples: number,
): DifferentialEvidence {
  let agree = 0,
    disagree = 0,
    inconclusive = 0;
  const counterexamples: { case: unknown; reason: string }[] = [];
  for (let i = 0; i < cases.length; i++) {
    const d = verdicts[i];
    if (d.v === 'inconclusive') inconclusive++;
    else if (d.v === 'agree') agree++;
    else {
      disagree++;
      if (counterexamples.length < maxCounterexamples)
        counterexamples.push({
          case: spec.describeCase ? spec.describeCase(cases[i]) : cases[i],
          reason: d.reason,
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

/** The memo keys of the cases (undefined where a case has no subject key or nothing is reused). */
function memoKeys<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  inputs: PortValues<P>,
  cases: readonly Case[],
  reuse: Reuse | undefined,
): (string | undefined)[] {
  if (!reuse || !spec.subjectKey) return new Array(cases.length).fill(undefined);
  const subject = inputs[spec.subject] as PortValue<P[keyof P]>;
  return cases.map((c, i) => {
    const sk = spec.subjectKey!(subject, c, inputs);
    return sk === undefined ? undefined : `${i}\u0000${sk}`;
  });
}

/**
 * Run a differential specification directly (tools, the workbench's Checks view) without a manager. IRWB-004: with
 * `baselineKey`, the cases and baseline outcomes are kept and reused; with `subjectKey` too, a case whose verdict is
 * known for its subject key is not evaluated again. The evidence is the same either way.
 */
export function runDifferential<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  inputs: PortValues<P>,
  seed = spec.seed ?? 1,
  maxCounterexamples = spec.maxCounterexamples ?? 5,
): DifferentialEvidence {
  const { cases, reuse } = prepare(spec, inputs, seed);
  const keys = memoKeys(spec, inputs, cases, reuse);
  const verdicts: Decided[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    const known = keys[i] === undefined ? undefined : reuse!.verdicts.get(keys[i]!);
    if (known) {
      verdicts[i] = known;
      STATS.replayed++;
      continue;
    }
    verdicts[i] = decideCase(spec, inputs, cases[i], i, reuse?.outcomes);
    if (keys[i] !== undefined) reuse!.verdicts.set(keys[i]!, verdicts[i]);
  }
  return tally(spec, seed, cases, verdicts, maxCounterexamples);
}

/** `runDifferential`, with the cases nobody decided yet handed to `spec.decide` (IRWB-004 F4). */
export function runDifferentialAsync<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  inputs: PortValues<P>,
  seed = spec.seed ?? 1,
  maxCounterexamples = spec.maxCounterexamples ?? 5,
): Promise<DifferentialEvidence> {
  return driveAsync(differentialSteps(spec, inputs, seed, maxCounterexamples));
}
/** The run as steps (steps.ts): it yields only when `spec.decide`, or a batch already in flight, has the cases. */
function* differentialSteps<P extends Ports, Case, Outcome>(
  spec: DifferentialSpec<P, Case, Outcome>,
  inputs: PortValues<P>,
  seed: number,
  maxCounterexamples: number,
): Steps<DifferentialEvidence> {
  const { cases, reuse } = prepare(spec, inputs, seed);
  const keys = memoKeys(spec, inputs, cases, reuse);
  const verdicts: Decided[] = new Array(cases.length);
  const todo: number[] = [];
  for (let i = 0; i < cases.length; i++) {
    const known = keys[i] === undefined ? undefined : reuse!.verdicts.get(keys[i]!);
    if (known) {
      verdicts[i] = known;
      STATS.replayed++;
    } else todo.push(i);
  }
  const batchKey =
    spec.decide && reuse && todo.length && todo.every(i => keys[i] !== undefined)
      ? JSON.stringify([reuse.key, todo.map(i => keys[i])])
      : undefined;
  const pending = batchKey === undefined ? undefined : IN_FLIGHT.get(batchKey);
  const elsewhere = pending ?? (todo.length ? spec.decide?.(inputs, cases, todo) : undefined);
  if (elsewhere) {
    if (batchKey !== undefined && !pending) IN_FLIGHT.set(batchKey, elsewhere);
    try {
      const decided = yield* wait(elsewhere);
      if (decided.length !== todo.length)
        throw new Error(`${spec.id}: decide returned ${decided.length} of ${todo.length}`);
      todo.forEach((i, k) => (verdicts[i] = decided[k]));
      if (pending) STATS.replayed += todo.length;
      else STATS.delegated += todo.length;
    } finally {
      if (batchKey !== undefined && IN_FLIGHT.get(batchKey) === elsewhere) IN_FLIGHT.delete(batchKey);
    }
  } else for (const i of todo) verdicts[i] = decideCase(spec, inputs, cases[i], i, reuse?.outcomes);
  for (const i of todo) if (keys[i] !== undefined) reuse!.verdicts.set(keys[i]!, verdicts[i]);
  return tally(spec, seed, cases, verdicts, maxCounterexamples);
}

/** The assurance a check's evidence supports: sampled differential testing is weaker than an exact checker. */
export function assuranceOf(evidence: unknown): 'checked' | 'checked-sampled' | 'checked-exact' {
  const method = (evidence as { method?: string } | null)?.method;
  if (method === 'sampled') return 'checked-sampled';
  if (method === 'exhaustive' || method === 'exact') return 'checked-exact';
  return 'checked';
}
