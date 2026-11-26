import {
  differential,
  differentialSpec,
  runDifferential,
  seededRandom,
} from '../framework/contracts/index.js';
import type { CheckResult } from '../framework/contracts/index.js';
import { canonical } from '../framework/core/data.js';
import { dimensions, evaluate, EvaluationDomainError, tensorSize } from './evaluate.js';
import type { Inputs, Tensor } from './evaluate.js';
import { TensorIR } from './ir.js';
import { AffineRangeError } from './model.js';
import type { TensorFn, TixProgram } from './model.js';

export type Relation = 'exact' | 'tolerance';
const budget = { steps: 200_000, elements: 8192 };
const sizes = [1, 2, 3, 4, 5, 8, 9];
const patterns = ['ones', 'dyadic', 'small-addends'] as const;
type Pattern = (typeof patterns)[number];
const smallAddends = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24, 2 ** -24];

type Case = { fn: string } & ({ uncovered: true } | { shapes: number[][]; pattern: Pattern; seed: number });
type Outcome = { tensor: Tensor } | { error: string };

function inputsFor(fn: TensorFn, kase: Extract<Case, { shapes: number[][] }>): Inputs {
  const random = seededRandom(kase.seed);
  return Object.fromEntries(
    fn.params.map((p, i) => {
      const shape = kase.shapes[i];
      const n = tensorSize(shape, p.at, budget.elements);
      const data = Float32Array.from({ length: n }, (_, k) =>
        p.name === 'eps' && shape.length === 1 && shape[0] === 1
          ? 2 ** -10
          : kase.pattern === 'ones'
            ? 1
            : kase.pattern === 'small-addends'
              ? smallAddends[k % 8]
              : (Math.floor(random() * 33) - 16) / 16,
      );
      return [p.name, { shape, data }];
    }),
  );
}

function* tuples(fn: TensorFn, random: () => number): Iterable<number[]> {
  for (const n of sizes) yield fn.shapes.map(() => n);
  for (const s of fn.shapes.keys()) for (const n of sizes) yield fn.shapes.map((_, i) => (i === s ? n : 4));
  for (let i = 0; i < 32; i++) yield fn.shapes.map(() => sizes[Math.floor(random() * sizes.length)]);
}

function cases(origin: TixProgram, random: () => number, count: number): Case[] {
  return origin.value.functions.flatMap(fn => {
    const seen = new Set<string>(),
      admitted: Case[] = [];
    for (const binding of tuples(fn, random)) {
      const values = new Map(fn.shapes.map((name, i) => [name, binding[i]]));
      try {
        const shapes = fn.params.map(p => dimensions(p.shape, values, p.at));
        const key = JSON.stringify(shapes);
        if (seen.has(key)) continue;
        seen.add(key);
        // Shape and work limits are independent of the data values in this language.
        evaluate(fn, inputsFor(fn, { fn: fn.name, shapes, pattern: 'ones', seed: 0 }), 'f64', budget);
        for (const pattern of patterns)
          admitted.push({ fn: fn.name, shapes, pattern, seed: Math.floor(random() * 2 ** 32) });
      } catch (e) {
        if (e instanceof EvaluationDomainError || e instanceof AffineRangeError) continue;
        throw e;
      }
      if (admitted.length >= count) break;
    }
    return admitted.length ? admitted : [{ fn: fn.name, uncovered: true } as const];
  });
}

function compare(relation: Relation, a: Outcome, b: Outcome): { ok: boolean; reason?: string } {
  if ('error' in a) return { ok: false, reason: a.error };
  if ('error' in b) return { ok: false, reason: b.error };
  if (canonical(a.tensor.shape) !== canonical(b.tensor.shape))
    return { ok: false, reason: 'output shape differs' };
  if (relation === 'exact') {
    const words = (x: Tensor) => new Uint32Array(x.data.buffer, x.data.byteOffset, x.data.length);
    const x = words(a.tensor),
      y = words(b.tensor);
    const hex = (w: number) => `0x${w.toString(16).padStart(8, '0')}`;
    for (let i = 0; i < x.length; i++)
      if (x[i] !== y[i])
        return { ok: false, reason: `output[${i}]: expected ${hex(x[i])}, got ${hex(y[i])}` };
  } else {
    for (let i = 0; i < a.tensor.data.length; i++) {
      const ref = a.tensor.data[i],
        got = b.tensor.data[i],
        limit = 8e-6 + 2e-5 * Math.abs(ref);
      if (!Number.isFinite(ref) || !Number.isFinite(got) || Math.abs(got - ref) > limit)
        return { ok: false, reason: `output[${i}]: expected finite ${ref} within ${limit}, got ${got}` };
    }
  }
  return { ok: true };
}

function invariant(relation: Relation) {
  return differential<
    { origin: typeof TensorIR; input: typeof TensorIR; candidate: typeof TensorIR },
    Case,
    Outcome
  >({
    id: `tensor.meaning.${relation}`,
    version: '1',
    description:
      relation === 'exact'
        ? 'Sampled bit-exact f32 outputs'
        : 'Sampled f32 outputs within tolerance of original f64',
    inputs: { origin: TensorIR, input: TensorIR, candidate: TensorIR },
    baseline: relation === 'exact' ? 'input' : 'origin',
    subject: 'candidate',
    seed: 20,
    count: 8 * patterns.length,
    cases: ({ origin }, random, count) => cases(origin, random, count),
    run(side, program, kase) {
      if ('uncovered' in kase) return { error: `no admitted case for '${kase.fn}'` };
      const fn = program.value.functions.find(f => f.name === kase.fn)!;
      try {
        const precision = relation === 'tolerance' && side === 'baseline' ? 'f64' : 'f32';
        return { tensor: evaluate(fn, inputsFor(fn, kase), precision, budget) };
      } catch (e) {
        if (e instanceof EvaluationDomainError || e instanceof AffineRangeError)
          return { error: `${side}: ${e.message}` };
        throw e;
      }
    },
    compare: (a, b) => compare(relation, a, b),
  });
}

const invariants = { exact: invariant('exact'), tolerance: invariant('tolerance') };
const signature = (p: TixProgram) =>
  canonical(
    p.value.functions.map(f => ({
      name: f.name,
      shapes: f.shapes,
      params: f.params.map(p => [p.name, p.shape]),
      result: f.resultShape,
    })),
  );

export function checkMeaning(
  origin: TixProgram,
  input: TixProgram,
  candidate: TixProgram,
  relation: Relation,
): CheckResult {
  if (signature(origin) !== signature(candidate)) return { ok: false, reason: 'public signatures changed' };
  const inv = invariants[relation];
  const evidence = runDifferential(differentialSpec(inv), { origin, input, candidate });
  return {
    ok: evidence.status === 'agree',
    reason: `${evidence.agree}/${evidence.total} cases agree under ${relation}`,
    evidence,
  };
}
