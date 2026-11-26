import { runDifferential, seededRandom } from '../framework/contracts/index.js';
import type { CheckResult, DifferentialSpec } from '../framework/contracts/index.js';
import { elementCount, evaluate, extentOf } from './evaluate.js';
import type { Inputs, Precision, Tensor } from './evaluate.js';
import { TensorType } from './ir.js';
import type { Expr, TensorArtifact, TensorFunction } from './model.js';

export type Relation = 'exact' | 'tolerance';
type Pattern = 'ones' | 'mixed' | 'sparse';
interface Case {
  name: string;
  shapes: number[][];
  pattern: Pattern;
  inputs: Inputs;
}

interface Cases {
  items: Case[];
  uncovered: string[];
}

const seed = 7;
const extents = [0, 1, 3, 4, 5, 7, 8, 9];
const patterns: readonly Pattern[] = ['ones', 'mixed', 'sparse'];
const sparse = [1, -0, 0, 0, 2 ** -25, 2 ** -25, 2 ** -25, 2 ** -25];
const maxElements = 4096;
const maxWork = 100_000;

function samples(fn: TensorFunction, random: () => number): Case[] {
  const cases: Case[] = [];
  const seen = new Set<string>();
  const sizes = [...extents.map(n => () => n), (i: number) => [2, 3, 5][i % 3]];
  for (const size of sizes) {
    const binding = new Map(fn.shapeNames.map((name, i) => [name, BigInt(size(i))]));
    const shapeOf = (dim: Parameters<typeof extentOf>[0]) => extentOf(dim, binding);
    function cost(expr: Expr): number {
      switch (expr.kind) {
        case 'unary':
          return 1 + cost(expr.arg);
        case 'binary':
          return 1 + cost(expr.left) + cost(expr.right);
        case 'reduce': {
          const iterations = elementCount(expr.binders.map(binder => shapeOf(binder.extent)));
          return iterations === 0 ? 1 : 1 + iterations * cost(expr.body);
        }
        default:
          return 1;
      }
    }
    let shapes: number[][];
    try {
      shapes = fn.params.map(param => param.shape.map(shapeOf));
      if (shapes.some(shape => elementCount(shape) > maxElements)) continue;
      let work = 0;
      for (const stmt of fn.statements) {
        const count = elementCount(stmt.binders.map(binder => shapeOf(binder.extent)));
        if (count > maxElements) {
          work = Infinity;
          break;
        }
        if (count) work += count * cost(stmt.body);
      }
      if (work > maxWork) continue;
    } catch {
      // The affine signature has no concrete call at this assignment.
      continue;
    }
    const key = JSON.stringify(shapes);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const pattern of patterns) {
      const inputs = Object.fromEntries(
        fn.params.map(({ name }, i) => {
          const shape = shapes[i];
          const data = Float32Array.from({ length: elementCount(shape) }, (_, j) =>
            pattern === 'ones'
              ? 1
              : pattern === 'mixed'
                ? (Math.floor(random() * 33) - 16) / 16
                : sparse[j % sparse.length],
          );
          return [name, { shape, data }];
        }),
      );
      cases.push({ name: fn.name, shapes, pattern, inputs });
    }
  }
  return cases;
}

export function generateCases(origin: TensorArtifact): Cases {
  const random = seededRandom(seed);
  const items: Case[] = [];
  const uncovered: string[] = [];
  for (const fn of origin.value.functions) {
    const cases = samples(fn, random);
    if (cases.length === 0) uncovered.push(fn.name);
    items.push(...cases);
  }
  return { items, uncovered };
}

type Outcome = { tensor: Tensor } | { error: string };
const ports = { baseline: TensorType, candidate: TensorType };

function run(artifact: TensorArtifact, input: Case, precision: Precision): Outcome {
  const fn = artifact.value.functions.find(fn => fn.name === input.name);
  if (!fn) return { error: 'function is missing' };
  try {
    return { tensor: evaluate(fn, input.inputs, precision) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function coordinate(offset: number, shape: readonly number[]): number[] {
  return shape
    .slice()
    .reverse()
    .map(extent => {
      const index = offset % extent;
      offset = Math.floor(offset / extent);
      return index;
    })
    .reverse();
}

function words(data: Tensor['data']): Uint32Array {
  return new Uint32Array(data.buffer, data.byteOffset, data.length);
}

function compare(baseline: Outcome, candidate: Outcome, relation: Relation): CheckResult {
  if ('error' in baseline) return { ok: false, reason: `reference could not run: ${baseline.error}` };
  if ('error' in candidate) return { ok: false, reason: `candidate could not run: ${candidate.error}` };
  const a = baseline.tensor;
  const b = candidate.tensor;
  if (a.shape.length !== b.shape.length || a.shape.some((n, i) => n !== b.shape[i]))
    return { ok: false, reason: `expected shape [${a.shape}], got [${b.shape}]` };

  const expectedBits = relation === 'exact' ? words(a.data) : undefined;
  const actualBits = relation === 'exact' ? words(b.data) : undefined;
  for (let i = 0; i < a.data.length; i++) {
    const ref = a.data[i];
    const got = b.data[i];
    const ok =
      expectedBits && actualBits
        ? expectedBits[i] === actualBits[i]
        : Number.isFinite(ref)
          ? Number.isFinite(got) && Math.abs(got - ref) <= 1e-5 + 2e-5 * Math.abs(ref)
          : Object.is(ref, got);
    if (!ok) {
      const detail =
        expectedBits && actualBits
          ? `expected 0x${expectedBits[i].toString(16)}, got 0x${actualBits[i].toString(16)}`
          : `expected ${ref}, got ${got}`;
      return { ok: false, reason: `[${coordinate(i, a.shape)}]: ${detail}` };
    }
  }
  return { ok: true };
}

export function meaningCheck(
  origin: TensorArtifact,
  cases: Cases,
  relation: Relation,
): (before: TensorArtifact, candidate: TensorArtifact) => CheckResult {
  const spec: DifferentialSpec<typeof ports, Case, Outcome> = {
    id: `tensor.meaning.${relation}`,
    version: '1',
    description: 'Compare returned tensors on generated calls',
    inputs: ports,
    baseline: 'baseline',
    subject: 'candidate',
    count: cases.items.length,
    seed,
    cases: () => cases.items,
    run: (side, artifact, input) =>
      run(artifact, input, side === 'baseline' && relation === 'tolerance' ? 'f64' : 'f32'),
    compare: (baseline, candidate) => compare(baseline, candidate, relation),
    describeCase: input => ({ function: input.name, shapes: input.shapes, pattern: input.pattern, seed }),
  };
  return (before, candidate) => {
    if (cases.uncovered.length)
      return { ok: false, reason: 'Missing sampled calls', evidence: { uncovered: cases.uncovered } };
    const baseline = relation === 'exact' ? before : origin;
    const evidence = runDifferential(spec, { baseline, candidate });
    return {
      ok: evidence.status === 'agree',
      reason: `${evidence.agree}/${evidence.total} sampled calls agree`,
      evidence,
    };
  };
}
