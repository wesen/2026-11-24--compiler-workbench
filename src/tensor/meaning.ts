import { runDifferential, seededRandom } from '../framework/contracts/differential.js';
import type { CheckResult } from '../framework/contracts/types.js';
import type { Artifact } from '../framework/core/types.js';
import { elementCount, evaluate, EvaluationLimit } from './evaluate.js';
import type { Precision, TensorInput, TensorInputs } from './evaluate.js';
import { tensorIR } from './ir.js';
import { dimensions, InvalidExtent } from './model.js';
import type { TensorFunction, TensorModule } from './model.js';

type TensorArtifact = Artifact<TensorModule>;
export type Relation = 'exact' | 'tolerance';
const SEED = 7;
const AXES = [0, 1, 4, 5, 6, 2, 3, 8, 9];
const TENSOR_LIMIT = 4_096;
const VISIT_LIMIT = 100_000;

interface Binding {
  readonly values: readonly number[];
  readonly shapes: readonly number[][];
  readonly nonempty: boolean;
}

const patterns = ['zeros', 'negative-zero', 'ones', 'alternating-sign', 'seeded', 'half-ulp'] as const;
type Pattern = (typeof patterns)[number];

interface Case {
  readonly binding: Binding;
  readonly pattern: Pattern;
  readonly inputs: TensorInputs;
}

function makeInputs(fn: TensorFunction, shapes: readonly number[][], pattern: Pattern): TensorInputs {
  const random = seededRandom(SEED);
  const halfUlp = [1, 0, 0, 0, 2 ** -24, 2 ** -24];
  return Object.fromEntries(
    fn.parameters.map(({ name }, p) => {
      const shape = shapes[p];
      const width = shape[shape.length - 1];
      const data = new Float32Array(elementCount(shape));
      for (let i = 0; i < data.length; i++) {
        switch (pattern) {
          case 'negative-zero':
            data[i] = -0;
            break;
          case 'ones':
            data[i] = 1;
            break;
          case 'alternating-sign':
            data[i] = i % 2 === 0 ? 1 : -1;
            break;
          case 'seeded':
            data[i] = 2 * random() - 1;
            break;
          case 'half-ulp':
            data[i] = width >= halfUlp.length ? (halfUlp[i % width] ?? 0) : 0;
            break;
        }
      }
      return [name, { shape, data }];
    }),
  );
}

function selectBindings(fn: TensorFunction): Binding[] {
  const seen = new Set<string>();
  const names = fn.witnesses.map(w => w.name);
  function eligible(values: readonly number[]): Binding | undefined {
    const key = values.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const env = new Map(names.map((name, i) => [name, values[i]]));
      const shapes = fn.parameters.map(param => dimensions(param.shape, env));
      if (shapes.some(shape => elementCount(shape) > TENSOR_LIMIT)) return;
      const result = evaluate(fn, makeInputs(fn, shapes, 'zeros'), 'f32', VISIT_LIMIT, TENSOR_LIMIT);
      return { values, shapes, nonempty: result.data.length > 0 };
    } catch (error) {
      if (!(error instanceof InvalidExtent || error instanceof EvaluationLimit)) throw error;
      return;
    }
  }

  const uniform = AXES.flatMap(value => eligible(names.map(() => value)) ?? []);
  const selected = uniform.slice(0, 6);
  let firstNonempty = uniform.find(binding => binding.nonempty);
  const random = seededRandom(SEED);
  for (let i = 0; names.length && i < 512 && (selected.length < 8 || !firstNonempty); i++) {
    const binding = eligible(names.map(() => AXES[Math.floor(random() * AXES.length)]));
    if (!binding) continue;
    if (selected.length < 8) selected.push(binding);
    if (binding.nonempty) firstNonempty ??= binding;
  }
  selected.push(...uniform.slice(6, 6 + (8 - selected.length)));
  if (firstNonempty && !selected.some(binding => binding.nonempty))
    selected[selected.length - 1] = firstNonempty;
  return selected;
}

function generateCases(fn: TensorFunction): Case[] {
  return selectBindings(fn).flatMap(binding =>
    patterns.map(pattern => ({ binding, pattern, inputs: makeInputs(fn, binding.shapes, pattern) })),
  );
}

type Outcome = { readonly output: TensorInput } | { readonly error: string };

function run(fn: TensorFunction, precision: Precision, kase: Case): Outcome {
  try {
    return { output: evaluate(fn, kase.inputs, precision, VISIT_LIMIT, TENSOR_LIMIT) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function coordinate(shape: readonly number[], offset: number): number[] {
  const result = new Array<number>(shape.length);
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    result[axis] = offset % shape[axis];
    offset = Math.floor(offset / shape[axis]);
  }
  return result;
}

function bits(data: Float32Array | Float64Array): Uint32Array {
  return new Uint32Array(data.buffer, data.byteOffset, data.length);
}

const hex = (value: number) => value.toString(16).padStart(8, '0');
function compare(expected: Outcome, got: Outcome, relation: Relation): { ok: boolean; reason?: string } {
  if ('error' in expected) return { ok: false, reason: `reference evaluation failed: ${expected.error}` };
  if ('error' in got) return { ok: false, reason: `candidate evaluation failed: ${got.error}` };
  const a = expected.output;
  const b = got.output;
  if (a.shape.length !== b.shape.length || a.shape.some((axis, i) => axis !== b.shape[i]))
    return { ok: false, reason: `expected shape [${a.shape}], got [${b.shape}]` };
  if (relation === 'exact') {
    const left = bits(a.data);
    const right = bits(b.data);
    const index = left.findIndex((value, i) => value !== right[i]);
    if (index >= 0)
      return {
        ok: false,
        reason: `[${coordinate(a.shape, index)}] expected f32 bits ${hex(left[index])}, got ${hex(right[index])}`,
      };
  } else {
    for (const [i, reference] of a.data.entries()) {
      const candidate = b.data[i];
      if (Number.isFinite(reference)) {
        const error = Math.abs(candidate - reference);
        const limit = 1e-5 + 1e-5 * Math.abs(reference);
        if (Number.isFinite(candidate) && error <= limit) continue;
        return {
          ok: false,
          reason: `[${coordinate(a.shape, i)}] f64 reference ${reference}, f32 candidate ${candidate}, error ${error} exceeds ${limit}`,
        };
      }
      if (!Object.is(reference, candidate))
        return {
          ok: false,
          reason: `[${coordinate(a.shape, i)}] f64 reference ${reference}, f32 candidate ${candidate}`,
        };
    }
  }
  return { ok: true };
}

/** Bind both relations to one original case set. The case set is generated only when a rewrite needs checking. */
export function meaningGates(origin: TensorArtifact) {
  let domains: readonly { readonly fn: TensorFunction; readonly cases: readonly Case[] }[] | undefined;
  return (relation: Relation) =>
    (before: TensorArtifact, after: TensorArtifact): CheckResult => {
      domains ??= origin.value.functions.map(fn => ({ fn, cases: generateCases(fn) }));
      const baseline = relation === 'exact' ? before : origin;
      const reports = [];
      for (const { fn, cases } of domains) {
        const a = baseline.value.functions.find(f => f.name === fn.name);
        const b = after.value.functions.find(f => f.name === fn.name);
        if (!a || !b) return { ok: false, reason: `missing function '${fn.name}'` };
        const inputs = { baseline, subject: after };
        const evidence = runDifferential<typeof ports, Case, Outcome>(
          {
            id: `tensor.meaning.${relation}`,
            version: '1',
            description: 'Compare the returned tensor with the appropriate reference on sampled inputs',
            inputs: ports,
            baseline: 'baseline',
            subject: 'subject',
            seed: SEED,
            count: cases.length,
            cases: () => cases,
            run: (side, _artifact, kase) =>
              side === 'baseline' ? run(a, relation === 'exact' ? 'f32' : 'f64', kase) : run(b, 'f32', kase),
            compare: (expected, got) => compare(expected, got, relation),
            describeCase: ({ binding, pattern }) => ({
              fn: fn.name,
              shapes: binding.shapes,
              shapeNames: Object.fromEntries(fn.witnesses.map((w, i) => [w.name, binding.values[i]])),
              pattern,
              seed: SEED,
            }),
          },
          inputs,
        );
        reports.push({ fn: fn.name, ...evidence });
        if (evidence.status !== 'agree')
          return {
            ok: false,
            reason: evidence.counterexamples[0]?.reason ?? `no eligible cases for '${fn.name}'`,
            evidence: { method: 'sampled', relation, reports },
          };
      }
      return { ok: true, evidence: { method: 'sampled', relation, reports } };
    };
}

const ports = { baseline: tensorIR, subject: tensorIR } as const;
