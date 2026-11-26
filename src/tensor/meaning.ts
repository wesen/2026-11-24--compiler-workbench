import { canonical } from '../framework/core/data.js';
import type { Artifact } from '../framework/core/types.js';
import type { CheckResult } from '../framework/contracts/index.js';
import { differential, differentialSpec, runDifferential } from '../framework/contracts/differential.js';
import { shapeNames } from './check.js';
import {
  admits,
  cellCount,
  concreteShape,
  EvaluationLimit,
  evaluate,
  InvalidExtent,
  type Inputs,
  type Tensor,
} from './evaluate.js';
import { IndexedIR } from './ir.js';
import type { TensorFn, TensorIR } from './model.js';

export type MeaningRelation = 'exact' | 'tolerant';
const admission = { cells: 65_536, work: 100_000 };
const execution = { cells: admission.cells, work: 800_000 };
const extents = [0, 1, 2, 3, 4, 5, 7, 8, 9] as const;
const h = 2 ** -24;
const witness = [1, 0, 0, 0, h, h, h, h, 0.125] as const;
const signature = (p: TensorIR) =>
  p.functions.map(f => [f.name, f.params.map(p => [p.name, p.shape]), f.result]);
const ports = { origin: IndexedIR, baseline: IndexedIR, candidate: IndexedIR };

type Sample = {
  readonly fn: string;
  readonly binding: readonly (readonly [string, number])[];
  readonly pattern: string;
  readonly inputs: Inputs;
};
type MissingSample = { readonly fn: string; readonly issue: string };
type Case = Sample | MissingSample;
type Observation = Tensor | { readonly issue: string };

function samples(program: TensorIR, random: () => number, mixed: number, relation: MeaningRelation): Case[] {
  const cases: Case[] = [];
  for (const fn of program.functions) {
    const vars = shapeNames(fn);
    const shapes = [...extents.map(d => vars.map(() => d))];
    for (let i = 0; i < mixed; i++)
      shapes.push(vars.map(() => extents[Math.floor(random() * extents.length)]));
    const seen = new Set<string>();
    let count = 0,
      nonempty = false;
    for (const tuple of shapes) {
      const key = tuple.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const binding = vars.map((name, i) => [name, tuple[i]] as const),
        env = new Map(binding);
      if (!admits(fn, env, admission)) continue;
      const params = fn.params.map(p => ({ name: p.name, shape: concreteShape(p.shape, env) }));
      const result = concreteShape(fn.result, env);
      nonempty ||= cellCount(result) > 0;
      count++;
      const add = (pattern: string, value: (cell: number, shape: readonly number[]) => number) => {
        const inputs = Object.fromEntries(
          params.map(({ name, shape }) => {
            const data = new Float32Array(cellCount(shape));
            for (let i = 0; i < data.length; i++) data[i] = name === 'eps' ? 1e-5 : value(i, shape);
            return [name, { shape, data }];
          }),
        );
        cases.push({ fn: fn.name, binding, pattern, inputs });
      };
      add('ones', () => 1);
      add('signed zeros', i => (i % 2 === 0 ? 0 : -0));
      add('signed random', () => 2 * random() - 1);
      for (let j = 0; j < Math.max(...params.map(p => p.shape.length)); j++) {
        add(`precision axis ${j}`, (i, shape) => {
          const axis = j < shape.length ? j : 0;
          const stride = cellCount(shape.slice(axis + 1));
          const index = Math.floor(i / stride) % shape[axis];
          return witness[index % witness.length];
        });
      }
    }
    if (count === 0 || (!nonempty && relation === 'tolerant')) {
      cases.push({
        fn: fn.name,
        issue: count === 0 ? 'no admissible origin shapes' : 'no nonempty origin observations',
      });
    }
  }
  return cases;
}

function observe(fn: TensorFn, kase: Sample, precision: 'f32' | 'f64'): Observation {
  try {
    return evaluate(fn, kase.inputs, precision, execution);
  } catch (e) {
    if (e instanceof EvaluationLimit || e instanceof InvalidExtent) return { issue: e.message };
    throw e;
  }
}

function checkCells(a: Observation, b: Observation, relation: MeaningRelation): CheckResult {
  if ('issue' in a) return { ok: false, reason: `baseline: ${a.issue}` };
  if ('issue' in b) return { ok: false, reason: `candidate: ${b.issue}` };
  if (a.shape.length !== b.shape.length || a.shape.some((d, i) => d !== b.shape[i]))
    return { ok: false, reason: `shape [${a.shape}] vs [${b.shape}]` };
  if (relation === 'exact') {
    const bits = (d: Float32Array | Float64Array) => new Uint32Array(d.buffer, d.byteOffset, d.length);
    const x = bits(a.data),
      y = bits(b.data);
    const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;
    for (let i = 0; i < x.length; i++)
      if (x[i] !== y[i]) return { ok: false, reason: `cell ${i}: ${hex(x[i])} vs ${hex(y[i])}` };
  } else {
    for (let i = 0; i < a.data.length; i++) {
      const r = a.data[i],
        c = b.data[i];
      if (!Number.isFinite(r) || !Number.isFinite(c))
        return { ok: false, reason: `cell ${i}: nonfinite comparison (f64 ${r}, f32 ${c})` };
      const bound = 2e-6 + 2e-5 * Math.abs(r);
      if (Math.abs(c - r) > bound)
        return { ok: false, reason: `cell ${i}: f64 ${r}, f32 ${c}, bound ${bound}` };
    }
  }
  return { ok: true };
}

function spec(relation: MeaningRelation) {
  return differential<typeof ports, Case, Observation>({
    id: `tensor.meaning-${relation}`,
    version: '1',
    description: `Sampled ${relation} equality of row-major tensor results`,
    inputs: ports,
    baseline: 'baseline',
    subject: 'candidate',
    count: 24,
    seed: 7,
    cases: ({ origin }, random, count) => samples(origin.value, random, count, relation),
    describeCase: c => ('issue' in c ? c : { fn: c.fn, binding: c.binding, pattern: c.pattern }),
    run(side, artifact, c) {
      if ('issue' in c) return c;
      const fn = artifact.value.functions.find(f => f.name === c.fn)!;
      return observe(fn, c, side === 'baseline' && relation === 'tolerant' ? 'f64' : 'f32');
    },
    compare: (a, b) => checkCells(a, b, relation),
  });
}
const specs = { exact: spec('exact'), tolerant: spec('tolerant') };

export function checkMeaning(
  relation: MeaningRelation,
  origin: Artifact<TensorIR>,
  before: Artifact<TensorIR>,
  candidate: Artifact<TensorIR>,
): CheckResult {
  if (canonical(signature(origin.value)) !== canonical(signature(candidate.value)))
    return { ok: false, reason: 'candidate changed the origin signature' };
  const evidence = runDifferential(differentialSpec(specs[relation]), {
    origin,
    baseline: relation === 'exact' ? before : origin,
    candidate,
  });
  return {
    ok: evidence.status === 'agree',
    reason: `${evidence.agree}/${evidence.total} sampled cases agree`,
    evidence,
  };
}
