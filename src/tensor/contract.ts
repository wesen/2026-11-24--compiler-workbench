/**
 * IRWB-020-N: the meaning contract for tensor passes (design §6), two framework `differential()` invariants in two
 * transformation contracts, both with inputs `{input, origin}` and output `{output}`.
 *
 *   - exact (`tensor.exact-f32`): the output program's f32 results are bit-identical (`Object.is` per element) to
 *     the pass input's, on every case;
 *   - tolerance (`tensor.close-f64`): per element, `|y − r| ≤ τ·max(1, |r|)` with τ = 2⁻¹², `y` the output's f32
 *     result and `r` the origin's f64 result; a case is inconclusive when `r` is not finite or the origin's own
 *     f32 result fails the same bound.
 *
 * Domain: per function, case 0 is the wide case (shapes at 8, values ±2⁻ᵏ, k ∈ [0, 24]), cases 1–8 draw shapes
 * from 1–8 and values from [−1, 1]; all from seed 1. Evidence carries only `{fn, n, shapes}` and string reasons,
 * so it survives the analysis manager's `immutable` (typed arrays and non-finite numbers would not).
 */
import { defineTransformation } from '../framework/contracts/definitions.js';
import { differential, seededRandom } from '../framework/contracts/differential.js';
import type { TransformationDefinition } from '../framework/contracts/types.js';
import type { Artifact } from '../framework/core/types.js';
import { A, TixIR, type Expr, type TixModule } from './ir.js';
import { evaluate, F32, F64 } from './evaluate.js';

export const TAU = 2 ** -12;
export const CASES_PER_FN = 9;
export const SEED = 1;
const MAX_SHAPE = 8;

export interface TensorCase {
  readonly fn: string;
  readonly n: number;
  readonly shapes: Readonly<Record<string, number>>;
  readonly inputs: Readonly<Record<string, { readonly shape: number[]; readonly data: Float64Array }>>;
}
interface Result {
  readonly shape: readonly number[];
  readonly data: Float64Array;
}

/** Every declared dimension and extent (without division) of `fn` is at least 1 under `shapes`. */
function validShapes(m: TixModule, fn: string, shapes: Record<string, number>): boolean {
  const f = m.fns[fn];
  const dims = [...f.params.flatMap(p => p.dims), ...f.result];
  for (const sid of f.body) {
    dims.push(...m.stmts[sid].indices.map(i => i.extent));
    const walk = (eid: string): void => {
      const e: Expr = m.exprs[eid];
      if (e.op === 'reduce') {
        for (const ax of e.axes) if (!ax.extent.div) dims.push(ax.extent.aff);
        walk(e.body);
      } else if ('b' in e) {
        walk(e.a);
        walk(e.b);
      } else if ('a' in e) walk(e.a);
    };
    walk(m.stmts[sid].root);
  }
  return dims.every(d => A.value(d, shapes) >= 1);
}

function inputsFor(m: TixModule, fn: string, shapes: Record<string, number>, value: () => number) {
  const out: Record<string, { shape: number[]; data: Float64Array }> = {};
  for (const p of m.fns[fn].params) {
    const shape = p.dims.map(d => A.value(d, shapes));
    const data = new Float64Array(shape.reduce((a, b) => a * b, 1));
    for (let i = 0; i < data.length; i++) data[i] = value();
    out[p.name] = { shape, data };
  }
  return out;
}

/** The sampled cases of a module (design §6.1), deterministic in the module and the seed. */
export function tensorCases(m: TixModule, random: () => number): TensorCase[] {
  const cases: TensorCase[] = [];
  for (const fn of Object.keys(m.fns).sort()) {
    const names = m.fns[fn].shapes;
    // case 0, the wide case: shapes at 8 (all lowered together until valid), magnitudes over 24 binades
    for (let top = MAX_SHAPE; top >= 1; top--) {
      const shapes = Object.fromEntries(names.map(n => [n, top]));
      if (!validShapes(m, fn, shapes)) continue;
      const wide = () => (random() < 0.5 ? -1 : 1) * 2 ** -Math.floor(random() * 25);
      cases.push({ fn, n: 0, shapes, inputs: inputsFor(m, fn, shapes, wide) });
      break;
    }
    for (let n = 1; n < CASES_PER_FN; n++) {
      for (let tries = 0; tries < 100; tries++) {
        const shapes = Object.fromEntries(names.map(k => [k, 1 + Math.floor(random() * MAX_SHAPE)]));
        if (!validShapes(m, fn, shapes)) continue;
        cases.push({ fn, n, shapes, inputs: inputsFor(m, fn, shapes, () => Math.fround(random() * 2 - 1)) });
        break;
      }
    }
  }
  return cases;
}

const run = (art: Artifact<TixModule>, c: TensorCase, round: (x: number) => number): Result =>
  evaluate(art.value, c.fn, c.inputs, round);
const sameShape = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const scaled = (y: number, r: number) => Math.abs(y - r) / Math.max(1, Math.abs(r));
const describeCase = (c: TensorCase) => ({ fn: c.fn, n: c.n, shapes: c.shapes });
const label = (c: TensorCase) =>
  `${c.fn}#${c.n} (${Object.entries(c.shapes)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')})`;

const ports = { baseline: TixIR, candidate: TixIR };
const baselineKey = ({ baseline }: { baseline: Artifact<TixModule> }) =>
  `${baseline.kind}@${baseline.schemaVersion}:${baseline.revision}`;

/** Bit-identical f32 results against the baseline (bound to the pass input). */
export const exactF32 = differential<typeof ports, TensorCase, Result>({
  id: 'tensor.exact-f32',
  version: '1',
  description: `f32 results bit-identical to the baseline on ${CASES_PER_FN} cases per function (seed ${SEED})`,
  inputs: ports,
  baseline: 'baseline',
  subject: 'candidate',
  count: CASES_PER_FN,
  seed: SEED,
  random: seededRandom,
  cases: ({ baseline }, random) => tensorCases((baseline as Artifact<TixModule>).value, random),
  run: (_side, art, c) => run(art as Artifact<TixModule>, c, F32),
  compare: (a, b, c) => {
    if (!sameShape(a.shape, b.shape))
      return { ok: false, reason: `${label(c)}: shape [${b.shape}], expected [${a.shape}]` };
    for (let i = 0; i < a.data.length; i++)
      if (!Object.is(a.data[i], b.data[i]))
        return { ok: false, reason: `${label(c)}: element ${i} is ${b.data[i]}, expected ${a.data[i]}` };
    return true;
  },
  describeCase,
  baselineKey: baselineKey as never,
});

interface CloseOutcome extends Result {
  /** Baseline only: the origin's own f32 result. */
  readonly f32?: Float64Array;
}
/** Within τ·max(1, |r|) of the baseline's f64 results (bound to the origin). */
export const closeF64 = differential<typeof ports, TensorCase, CloseOutcome>({
  id: 'tensor.close-f64',
  version: '1',
  description: `f32 results within 2^-12·max(1,|r|) of the baseline's f64 results r, on ${CASES_PER_FN} cases per function (seed ${SEED})`,
  inputs: ports,
  baseline: 'baseline',
  subject: 'candidate',
  count: CASES_PER_FN,
  seed: SEED,
  random: seededRandom,
  cases: ({ baseline }, random) => tensorCases((baseline as Artifact<TixModule>).value, random),
  run: (side, art, c) => {
    const a = art as Artifact<TixModule>;
    if (side === 'subject') return run(a, c, F32);
    const ref = run(a, c, F64);
    return { ...ref, f32: run(a, c, F32).data };
  },
  inconclusive: o => {
    if (!o.f32) return false;
    for (let i = 0; i < o.data.length; i++) {
      if (!Number.isFinite(o.data[i])) return true;
      if (!(scaled(o.f32[i], o.data[i]) <= TAU)) return true;
    }
    return false;
  },
  compare: (r, y, c) => {
    if (!sameShape(r.shape, y.shape))
      return { ok: false, reason: `${label(c)}: shape [${y.shape}], expected [${r.shape}]` };
    for (let i = 0; i < r.data.length; i++)
      if (!(scaled(y.data[i], r.data[i]) <= TAU))
        return {
          ok: false,
          reason: `${label(c)}: element ${i} is ${y.data[i]}, reference ${r.data[i]} (scaled error ${scaled(y.data[i], r.data[i]).toExponential(2)} > 2^-12)`,
        };
    return true;
  },
  describeCase,
  baselineKey: baselineKey as never,
});

const contract = (id: string, inv: typeof exactF32, baseline: 'input' | 'origin', about: string) =>
  defineTransformation({
    id,
    version: '1',
    description: about,
    inputs: { input: TixIR, origin: TixIR },
    outputs: { output: TixIR },
    ensures: [
      {
        invariant: inv,
        bindings: {
          baseline: { from: 'inputs', port: baseline },
          candidate: { from: 'outputs', port: 'output' },
        },
      },
    ],
  }) as unknown as TransformationDefinition<any, any>;

/** The exact relation: the pass keeps the f32 bits of its input. */
export const exactContract = contract(
  'tensor.exact',
  exactF32,
  'input',
  'a tensor pass keeps its input’s f32 results bit for bit',
);
/** The tolerance relation: the pass stays within τ of the origin's f64 meaning. */
export const toleranceContract = contract(
  'tensor.tolerance',
  closeF64,
  'origin',
  'a tensor pass stays within 2^-12·max(1,|r|) of the origin’s f64 results',
);

/** For tests and reports: the largest scaled error of `art`'s f32 results against `origin`'s f64 results. */
export function maxScaledError(origin: Artifact<TixModule>, art: Artifact<TixModule>): number {
  let worst = 0;
  for (const c of tensorCases(origin.value, seededRandom(SEED))) {
    const r = run(origin, c, F64),
      y = run(art, c, F32);
    for (let i = 0; i < r.data.length; i++)
      if (Number.isFinite(r.data[i])) worst = Math.max(worst, scaled(y.data[i], r.data[i]));
  }
  return worst;
}
