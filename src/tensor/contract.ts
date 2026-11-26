/**
 * The meaning contract for tensor passes (IRWB-020): a sampled differential check with two relations.
 *
 *   domain       per function of the origin, `count` cases: shape names drawn from 1..8, input values uniform in
 *                [-4, 4) as f32, generated from a per-case seed;
 *   observation  the function's result (shape and elements), or a trap;
 *   exact        the candidate's f32 result is bit-identical to the f32 result of the pass's input;
 *   tolerance    the candidate's f32 result is within TOLERANCE_FACTOR times the running error bound of the
 *                candidate's own evaluation order of the f64 result of the origin.
 *
 * `exact` is transitive, so comparing with the pass's input says "this step changed no bit" and stays usable after
 * a tolerance step. `tolerance` is not, so every step is compared with the origin's reference.
 *
 * One spec, invariant and contract object exists per (relation, count, seed): the contract registry refuses a second
 * object under one id and version.
 */
import { defineTransformation } from '../framework/contracts/definitions.js';
import {
  differential,
  runDifferential,
  seededRandom,
  type DifferentialEvidence,
  type DifferentialInvariant,
  type DifferentialSpec,
} from '../framework/contracts/differential.js';
import type { CheckResult, TransformationDefinition } from '../framework/contracts/types.js';
import type { Artifact } from '../framework/core/types.js';
import { runBound, runF32, runF64, type TensorInput } from './evaluate.js';
import { affEval, TixIRType, type Expr, type Fn, type TixIR } from './ir.js';

export type Relation = 'exact' | 'tolerance';
export interface CheckParams {
  /** Cases per function (default 16). */
  readonly count?: number;
  readonly seed?: number;
}

/** The check domain. There is one; `optimizeTix` checks on it. */
export const DOMAIN = Object.freeze({
  count: 16,
  seed: 7,
  /** Each shape name is drawn uniformly from sizeMin..sizeMax. */
  sizeMin: 1,
  sizeMax: 8,
  /** Input elements are uniform in [valueMin, valueMax), rounded to f32. */
  valueMin: -4,
  valueMax: 4,
  /** A binding is redrawn while the origin function's loop work exceeds this, or an extent is below 1. */
  maxWork: 2 ** 18,
  attempts: 64,
});
/** How many running error bounds the candidate may be away from the reference (see the design, section 6.3). */
export const TOLERANCE_FACTOR = 2;

/** A case is plain JSON (evidence is stored immutably): its input values are regenerated from `seed`. */
export interface Case {
  readonly fn: string;
  readonly n: number;
  readonly shapes: Readonly<Record<string, number>>;
  readonly seed: number;
}

/** The loop work of a function of the origin under a binding (its extents are affine in the shape names). */
function workOf(fn: Fn, shapes: Readonly<Record<string, number>>): number {
  const ext = (indices: Fn['stmts'][number]['indices']): number => {
    let n = 1;
    for (const i of indices) {
      const e = i.extent.k === 'aff' ? affEval(i.extent.aff, shapes) : NaN;
      if (!(e >= 1)) return NaN;
      n *= e;
    }
    return n;
  };
  const expr = (e: Expr): number => {
    switch (e.k) {
      case 'neg':
        return 1 + expr(e.a);
      case 'bin':
        return 1 + expr(e.a) + expr(e.b);
      case 'call':
        return 1 + e.args.reduce((a, x) => a + expr(x), 0);
      case 'reduce':
        return ext(e.indices) * (1 + expr(e.body));
      default:
        return 1;
    }
  };
  let work = 0;
  for (const p of fn.params) for (const d of p.dims) if (!(affEval(d, shapes) >= 1)) return NaN;
  for (const s of fn.stmts) work += ext(s.indices) * expr(s.expr);
  return work;
}

export function generateCases(origin: TixIR, random: () => number, count: number): Case[] {
  const out: Case[] = [];
  const span = DOMAIN.sizeMax - DOMAIN.sizeMin + 1;
  for (const name of Object.keys(origin.fns).sort()) {
    const fn = origin.fns[name];
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < DOMAIN.attempts; attempt++) {
        const shapes: Record<string, number> = {};
        for (const s of fn.shapes) shapes[s] = DOMAIN.sizeMin + Math.floor(random() * span);
        const seed = Math.floor(random() * 2 ** 32);
        // NaN (an extent below 1) fails the comparison too
        if (workOf(fn, shapes) <= DOMAIN.maxWork) {
          out.push({ fn: name, n, shapes, seed });
          break;
        }
      }
    }
  }
  return out;
}

const INPUTS = new WeakMap<Case, Record<string, TensorInput>>();
/** The inputs of a case: one f32 tensor per parameter of the origin's function, in parameter order. */
export function caseInputs(origin: TixIR, kase: Case): Record<string, TensorInput> {
  let inputs = INPUTS.get(kase);
  if (!inputs) {
    const random = seededRandom(kase.seed);
    inputs = {};
    for (const p of origin.fns[kase.fn].params) {
      const shape = p.dims.map(d => affEval(d, kase.shapes));
      const data = new Float32Array(shape.reduce((a, b) => a * b, 1));
      for (let i = 0; i < data.length; i++)
        data[i] = DOMAIN.valueMin + random() * (DOMAIN.valueMax - DOMAIN.valueMin);
      inputs[p.name] = { shape, data };
    }
    INPUTS.set(kase, inputs);
  }
  return inputs;
}

/** The result shape the origin gives a case; a candidate must produce the same. */
function resultShape(origin: TixIR, kase: Case): number[] {
  const fn = origin.fns[kase.fn];
  const param = fn.params.find(p => p.name === fn.result);
  if (param) return param.dims.map(d => affEval(d, kase.shapes));
  return fn.stmts
    .find(s => s.name === fn.result)!
    .indices.map(i => affEval((i.extent as { aff: Parameters<typeof affEval>[0] }).aff, kase.shapes));
}

type Outcome =
  | { readonly trap: string }
  | {
      readonly trap?: undefined;
      readonly shape: readonly number[];
      /** f32 result, or the f64 result on the reference side of `tolerance`. */
      readonly data: Float32Array | Float64Array;
      /** The candidate's running error bound (`tolerance`, candidate side). */
      readonly bound?: Float64Array;
    };

type Ports = { origin: typeof TixIRType; reference: typeof TixIRType; candidate: typeof TixIRType };
const finite = (a: ArrayLike<number>) => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
};
const sameShape = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((d, k) => d === b[k]);

function makeSpec(relation: Relation, count: number, seed: number): DifferentialSpec<Ports, Case, Outcome> {
  const run = (f: () => Outcome): Outcome => {
    try {
      return f();
    } catch (e) {
      // a trap, or a function or parameter the candidate no longer has: the run has no result
      return { trap: (e as Error).message };
    }
  };
  return {
    id: `tensor.meaning-${relation}`,
    version: `1+${count}.${seed}`,
    description:
      relation === 'exact'
        ? `f32 results are bit-identical to the reference's on ${count} cases per function (seed ${seed})`
        : `f32 results are within ${TOLERANCE_FACTOR} running error bounds of the origin's f64 results on ${count} cases per function (seed ${seed})`,
    inputs: { origin: TixIRType, reference: TixIRType, candidate: TixIRType },
    baseline: 'reference',
    subject: 'candidate',
    count,
    seed,
    cases: ({ origin }, random, n) => generateCases(origin.value, random, n),
    run: (side, art, kase, ports) => {
      const ir = (art as Artifact<TixIR>).value,
        inputs = caseInputs(ports.origin.value, kase);
      if (relation === 'exact' || side === 'subject')
        return run(() => {
          const r = runF32(ir, kase.fn, inputs);
          if (relation === 'exact') return r;
          // candidate side of `tolerance`: a result that is the wrong shape or not finite is decided without a bound
          if (!sameShape(r.shape, resultShape(ports.origin.value, kase)) || !finite(r.data)) return r;
          return { ...r, bound: runBound(ir, kase.fn, inputs).bound };
        });
      return run(() => runF64(ir, kase.fn, inputs));
    },
    // rule 1: a reference that is not finite decides nothing; rule 3: neither does a bound that is not finite
    inconclusive:
      relation === 'exact'
        ? undefined
        : o =>
            o.trap === undefined &&
            (o.bound ? !finite(o.bound) : o.data instanceof Float64Array && !finite(o.data)),
    compare: (ref, got, kase) => {
      const at = `${kase.fn}#${kase.n}`;
      if (ref.trap !== undefined) return { ok: false, reason: `${at}: the reference failed: ${ref.trap}` };
      if (got.trap !== undefined) return { ok: false, reason: `${at}: the candidate failed: ${got.trap}` };
      if (!sameShape(ref.shape, got.shape))
        return { ok: false, reason: `${at}: shape [${got.shape}] instead of [${ref.shape}]` };
      for (let i = 0; i < ref.data.length; i++) {
        const r = ref.data[i],
          c = got.data[i];
        if (relation === 'exact') {
          if (!Object.is(r, c))
            return { ok: false, reason: `${at}: element ${i} is ${c}, the reference has ${r}` };
        } else if (!got.bound) {
          // rule 2: the candidate has an element that is not finite where the reference is finite
          if (!Number.isFinite(c))
            return { ok: false, reason: `${at}: element ${i} is ${c}, the reference has ${r}` };
        } else if (!(Math.abs(c - r) <= TOLERANCE_FACTOR * got.bound![i])) {
          return {
            ok: false,
            reason: `${at}: element ${i} is ${c}, the reference has ${r}: off by ${Math.abs(c - r)}, allowed ${TOLERANCE_FACTOR * got.bound![i]}`,
          };
        }
      }
      return true;
    },
    // a case is already plain JSON
    describeCase: kase => ({ fn: kase.fn, n: kase.n, shapes: { ...kase.shapes }, seed: kase.seed }),
    maxCounterexamples: 3,
    baselineKey: ({ origin, reference }) => `${origin.revision}:${reference.revision}`,
  };
}

interface Made {
  readonly spec: DifferentialSpec<Ports, Case, Outcome>;
  readonly invariant: DifferentialInvariant<Ports>;
  readonly contract: TransformationDefinition<any, any>;
}
const MADE = new Map<string, Made>();
function made(relation: Relation, params: CheckParams = {}): Made {
  const count = params.count ?? DOMAIN.count,
    seed = params.seed ?? DOMAIN.seed,
    key = `${relation}/${count}/${seed}`;
  let m = MADE.get(key);
  if (!m) {
    const spec = makeSpec(relation, count, seed);
    const invariant = differential(spec);
    const contract = defineTransformation({
      id: `tensor.pass-${relation}`,
      version: spec.version,
      description: `a tensor pass keeps the meaning of the program (${relation})`,
      inputs: { input: TixIRType, origin: TixIRType },
      outputs: { output: TixIRType },
      ensures: [
        {
          invariant,
          bindings: {
            origin: { from: 'inputs', port: 'origin' },
            reference: { from: 'inputs', port: relation === 'exact' ? 'input' : 'origin' },
            candidate: { from: 'outputs', port: 'output' },
          },
        },
      ],
    });
    MADE.set(key, (m = { spec, invariant, contract }));
  }
  return m;
}

/** The differential spec of a relation (one object per relation, count and seed). */
export const meaningSpec = (relation: Relation, params?: CheckParams) => made(relation, params).spec;
/** The contract `applyPass` takes, with `contractInputs: { origin }` (one object per relation, count and seed). */
export const tensorContract = (relation: Relation, params?: CheckParams) => made(relation, params).contract;

export interface MeaningPorts {
  readonly origin: Artifact<TixIR>;
  readonly input: Artifact<TixIR>;
  readonly output: Artifact<TixIR>;
}
/** The same check without a manager and without a Promise. */
export function checkMeaning(relation: Relation, ports: MeaningPorts, params?: CheckParams): CheckResult {
  const evidence: DifferentialEvidence = runDifferential(made(relation, params).spec, {
    origin: ports.origin,
    reference: relation === 'exact' ? ports.input : ports.origin,
    candidate: ports.output,
  });
  const first = evidence.counterexamples[0]?.reason;
  return {
    ok: evidence.status === 'agree',
    reason:
      evidence.status === 'agree'
        ? `${evidence.agree}/${evidence.total} cases agree (${evidence.inconclusive} inconclusive)`
        : evidence.status === 'disagree'
          ? `${evidence.disagree}/${evidence.total} cases disagree; ${first}`
          : `no decided case among ${evidence.total}`,
    evidence,
  };
}
