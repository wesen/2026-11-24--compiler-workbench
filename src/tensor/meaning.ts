import { canonical } from '../framework/core/data.js';
import type { CheckResult } from '../framework/contracts/types.js';
import { validateArtifact } from '../framework/contracts/definitions.js';
import { differential, differentialSpec, runDifferential } from '../framework/contracts/differential.js';
import { dimensions, elementCount, evaluate, plan, type Plan, type Tensor } from './evaluate.js';
import { TensorIR, type TensorFunction } from './ir.js';
import type { TixProgram } from './program.js';

const values = [1, 3, 4, 5, 6, 8, 9, 2];
const r0Limit = 250_000n,
  candidateLimit = 500_000n,
  elements = 16_384;
const atol = 2e-5,
  rtol = 2e-5;

function* nonuniform(rank: number) {
  for (const base of values)
    for (let axis = 0; axis < rank; axis++)
      for (const next of values) {
        if (next === base) continue;
        yield Array.from({ length: rank }, (_, i) => (i === axis ? next : base));
      }
  const digits = Array(rank).fill(0);
  while (true) {
    if (!digits.every(d => d === digits[0])) yield digits.map(d => values[d]);
    let i = rank - 1;
    for (; i >= 0; i--) {
      if (++digits[i] < values.length) break;
      digits[i] = 0;
    }
    if (i < 0) return;
  }
}

interface ShapeCase {
  readonly shapes: readonly number[][];
  readonly r0Plan: Plan;
}
export function sampledShapes(fn: TensorFunction): ShapeCase[] {
  const seen = new Set<string>();
  const rank = fn.shapeNames.length;
  function screen(assignments: Iterable<number[]>) {
    const valid: ShapeCase[] = [];
    for (const tuple of assignments) {
      const key = tuple.join(',');
      if (seen.has(key)) continue;
      if (seen.size >= 256) break;
      seen.add(key);
      try {
        const shapes = dimensions(fn, new Map(fn.shapeNames.map((name, i) => [name, BigInt(tuple[i])])));
        const r0Plan = plan(fn, shapes, elements);
        if (r0Plan.steps <= r0Limit) valid.push({ shapes, r0Plan });
      } catch (e) {
        if (!(e instanceof Error)) throw e;
      }
      if (valid.length === 8) break;
    }
    return valid;
  }
  const uniform = screen(rank ? values.map(v => Array<number>(rank).fill(v)) : [[]]);
  if (rank < 2) return uniform;
  const mixed = screen(nonuniform(rank));
  return [...uniform.slice(0, 4), ...mixed.slice(0, 4), ...uniform.slice(4), ...mixed.slice(4)].slice(0, 8);
}

type Sample = { readonly fn: string } & (
  | { readonly missing: true }
  | {
      readonly missing: false;
      readonly shape: ShapeCase;
      readonly pattern: string;
      readonly data: readonly Float32Array[];
    }
);

function casesFor(origin: TixProgram, random: () => number) {
  const cases: Sample[] = [];
  for (const fn of origin.value.functions) {
    const shapes = sampledShapes(fn);
    if (!shapes.length) cases.push({ fn: fn.name, missing: true });
    for (const shape of shapes) {
      const sizes = shape.shapes.map(s => Number(elementCount(s)));
      function add(pattern: string, sample: (i: number, param: number) => number) {
        const data = sizes.map((size, param) =>
          Float32Array.from({ length: size }, (_, i) => sample(i, param)),
        );
        cases.push({ fn: fn.name, missing: false, shape, pattern, data });
      }
      add('zeros', () => 0);
      add('signed-zeros', i => (i % 2 ? 0 : -0));
      add('ones', () => 1);
      add('ramp', (i, p) => (((i + 3 * p) % 29) - 14) / 16);
      add('alternating', (i, p) => ((i + p) % 2 ? -1 : 1));
      add('random', () => 2 * random() - 1);
      shape.shapes.forEach((dims, p) =>
        dims.forEach((d, a) => {
          if (d !== 6 || sizes[p] === 0) return;
          const stride = Number(elementCount(dims.slice(a + 1)));
          const row = [1, 0, 0, 0, 2 ** -24, 2 ** -24];
          add(`half-ulp:${p}:${a}`, (i, param) =>
            param === p && i % stride === 0 ? (row[i / stride] ?? 0) : 0,
          );
        }),
      );
    }
  }
  return cases;
}

export type Relation = 'exact' | 'tolerance';
type Outcome = { readonly tensor: Tensor } | { readonly error: string };
const ports = { origin: TensorIR, baseline: TensorIR, candidate: TensorIR } as const;
const invariants = { exact: meaning('exact'), tolerance: meaning('tolerance') };

function meaning(relation: Relation) {
  const tolerant = relation === 'tolerance';
  return differential<typeof ports, Sample, Outcome>({
    id: `tensor.meaning.${relation}`,
    version: '1',
    description: tolerant
      ? `Sampled f32 error against r0's f64 output (${atol} + ${rtol} * |ref|)`
      : 'Sampled bit-identical f32 results',
    inputs: ports,
    baseline: 'baseline',
    subject: 'candidate',
    count: 8,
    seed: 7,
    cases: ({ origin }, random) => casesFor(origin, random),
    run(side, art, sample, { origin }) {
      if (sample.missing) return { error: `no sampled shape for ${sample.fn}` };
      const fn = art.value.functions.find(f => f.name === sample.fn)!;
      const isOrigin = art.revision === origin.revision;
      const limit = isOrigin ? r0Limit : candidateLimit;
      let shape: Plan;
      try {
        shape = isOrigin ? sample.shape.r0Plan : plan(fn, sample.shape.shapes, elements);
      } catch (error) {
        return { error: (error as Error).message };
      }
      if (shape.steps > limit) return { error: `step budget ${limit} exhausted (cost ${shape.steps})` };
      return { tensor: evaluate(fn, shape, sample.data, side === 'baseline' && tolerant ? 'f64' : 'f32') };
    },
    compare(a, b) {
      if ('error' in a || 'error' in b)
        return { ok: false, reason: 'error' in a ? a.error : (b as { error: string }).error };
      if (
        a.tensor.shape.length !== b.tensor.shape.length ||
        a.tensor.shape.some((n, i) => n !== b.tensor.shape[i])
      )
        return { ok: false, reason: `output shape ${b.tensor.shape} != ${a.tensor.shape}` };
      if (tolerant) {
        for (let i = 0; i < a.tensor.data.length; i++) {
          const ref = a.tensor.data[i],
            got = b.tensor.data[i];
          const bound = atol + rtol * Math.abs(ref);
          if (!Number.isFinite(ref) || !Number.isFinite(got) || Math.abs(ref - got) > bound)
            return { ok: false, reason: `element ${i}: ${got} vs f64 ${ref} (bound ${bound})` };
        }
      } else {
        const bits = (t: Tensor) => new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.length);
        const ref = bits(a.tensor),
          got = bits(b.tensor);
        for (let i = 0; i < ref.length; i++)
          if (ref[i] !== got[i])
            return {
              ok: false,
              reason: `element ${i}: 0x${got[i].toString(16)} != 0x${ref[i].toString(16)}`,
            };
      }
      return true;
    },
    describeCase: s => (s.missing ? { fn: s.fn } : { fn: s.fn, shapes: s.shape.shapes, pattern: s.pattern }),
  });
}

function signature(program: TixProgram) {
  return canonical(
    program.value.functions.map(fn => ({
      name: fn.name,
      result: fn.resultShape,
      params: fn.params.map(p => ({ name: p.name, shape: p.shape })),
    })),
  );
}

export function checkMeaning(
  origin: TixProgram,
  before: TixProgram,
  candidate: TixProgram,
  relation: Relation,
): CheckResult {
  for (const artifact of [origin, before, candidate]) validateArtifact(TensorIR, artifact);
  const sig = signature(origin);
  if (signature(before) !== sig || signature(candidate) !== sig)
    return { ok: false, reason: 'function signatures altered' };
  const baseline = relation === 'exact' ? before : origin;
  const evidence = runDifferential(differentialSpec(invariants[relation]), { origin, baseline, candidate });
  return {
    ok: evidence.status === 'agree',
    reason: `${evidence.agree}/${evidence.total} sampled cases agree`,
    evidence,
  };
}
