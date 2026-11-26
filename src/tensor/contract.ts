import type { Artifact } from '../framework/core/types.js';
import {
  differential,
  differentialSpec,
  runDifferential,
  type CheckResult,
} from '../framework/contracts/index.js';
import { evaluate, sizeOf, type Inputs, type Tensor } from './evaluate.js';
import { indexBounds, TensorIR } from './ir.js';
import { children, valueOf, type Axis, type Expr, type TensorFn, type TensorModule } from './model.js';

export type Relation = 'exact' | 'tolerance';
type Ports = { origin: typeof TensorIR; before: typeof TensorIR; candidate: typeof TensorIR };
interface Sample {
  fn: string;
  dims: number[];
  fill: string;
  inputs?: Inputs;
}
type Observation = { output: Tensor } | { error: string };
const motif = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 0, 0];
const patterns = ['ones', 'motif', 'signed'] as const;

/** Check the concrete instantiation of the original program before allocating any example data. */
function legal(fn: TensorFn, dims: Map<string, number>): boolean {
  const tensors = new Map<string, number[]>();
  function validRead(e: Expr, axes: Map<string, Axis>): boolean {
    if (e.kind === 'read') {
      return e.indices.every((a, i) => {
        const [lo, hi] = indexBounds(a, axes);
        return valueOf(lo, dims) >= 0 && valueOf(hi, dims) < tensors.get(e.tensor)![i];
      });
    }
    if (e.kind === 'fold') {
      const inner = new Map(axes);
      const extents = e.axes.map(r => valueOf(r.extent, dims));
      if (extents.some(n => !Number.isSafeInteger(n) || n < 0)) return false;
      if (extents.includes(0)) return true;
      for (const axis of e.axes) inner.set(axis.id, axis);
      return validRead(e.body, inner);
    }
    return children(e).every(child => validRead(child, axes));
  }
  for (const d of [...fn.params, ...fn.definitions]) {
    const shape = d.shape.map(a => valueOf(a, dims));
    if (shape.some(n => !Number.isSafeInteger(n) || n < 0) || !Number.isSafeInteger(sizeOf(shape)))
      return false;
    tensors.set(d.name, shape);
  }
  if (!sizeOf(tensors.get(fn.result)!)) return false;
  return fn.definitions.every(
    d => !sizeOf(tensors.get(d.name)!) || validRead(d.body, new Map(d.axes.map(a => [a.id, a]))),
  );
}
export function samples(origin: TensorModule, random: () => number): Sample[] {
  const cases: Sample[] = [];
  for (const f of origin.functions) {
    const start = cases.length,
      seen = new Set<string>();
    for (const size of [1, 8, 9, 0]) {
      const bindings = new Map(f.symbols.map((s, i) => [s, size || [3, 5, 9][i % 3]]));
      const dims = [...bindings.values()];
      if (seen.has(dims.join(',')) || !legal(f, bindings)) continue;
      seen.add(dims.join(','));
      for (const [pattern, fill] of patterns.entries()) {
        const inputs: Inputs = Object.create(null);
        for (const p of f.params) {
          const shape = p.shape.map(a => valueOf(a, bindings)),
            data = new Float32Array(sizeOf(shape));
          if (p.shape.length === 1 && !p.shape[0].terms.length && p.shape[0].constant === 1)
            data.fill([1, 2 ** -10, 2 ** -5][pattern]);
          else
            for (let i = 0; i < data.length; i++)
              data[i] = fill === 'ones' ? 1 : fill === 'motif' ? motif[i % motif.length] : random() * 2 - 1;
          inputs[p.name] = { shape, data };
        }
        cases.push({ fn: f.name, dims, fill, inputs });
      }
    }
    if (cases.length === start) cases.push({ fn: f.name, dims: [], fill: 'no legal sample' });
  }
  return cases;
}

function compare(relation: Relation, a: Observation, b: Observation): CheckResult {
  if ('error' in a) return { ok: false, reason: a.error };
  if ('error' in b) return { ok: false, reason: b.error };
  const ref = a.output,
    actual = b.output;
  if (ref.shape.length !== actual.shape.length || ref.shape.some((n, i) => n !== actual.shape[i]))
    return { ok: false, reason: 'returned shape differs' };
  if (relation === 'exact') {
    const words = (t: Tensor) => new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.length);
    const x = words(ref),
      y = words(actual);
    for (let i = 0; i < x.length; i++)
      if (x[i] !== y[i])
        return { ok: false, reason: `element ${i}: 0x${x[i].toString(16)} vs 0x${y[i].toString(16)}` };
  } else {
    for (let i = 0; i < ref.data.length; i++) {
      const x = ref.data[i],
        y = actual.data[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y - x) > 1e-5 + 1e-5 * Math.abs(x))
        return { ok: false, reason: `element ${i}: reference ${x}, candidate ${y}` };
    }
  }
  return { ok: true };
}
function invariant(relation: Relation) {
  return differential<Ports, Sample, Observation>({
    id: 'tensor.meaning.' + relation,
    version: '1',
    description: 'Compare every returned element on origin-derived examples',
    inputs: { origin: TensorIR, before: TensorIR, candidate: TensorIR },
    baseline: relation === 'exact' ? 'before' : 'origin',
    subject: 'candidate',
    count: 12,
    seed: 20,
    cases: ({ origin }, random) => samples(origin.value, random),
    describeCase: ({ fn, dims, fill }) => ({ fn, dims, fill, seed: 20 }),
    run(side, artifact, sample) {
      if (!sample.inputs) return { error: `no legal sample for ${sample.fn}` };
      const f = artifact.value.functions.find(f => f.name === sample.fn);
      if (!f) return { error: `missing function ${sample.fn}` };
      try {
        return {
          output: evaluate(f, sample.inputs, relation === 'tolerance' && side === 'baseline' ? 'f64' : 'f32'),
        };
      } catch (e) {
        return { error: String(e) };
      }
    },
    compare: (a, b) => compare(relation, a, b),
  });
}
const invariants = { exact: invariant('exact'), tolerance: invariant('tolerance') };
export function checkMeaning(
  relation: Relation,
  origin: Artifact<TensorModule>,
  before: Artifact<TensorModule>,
  candidate: Artifact<TensorModule>,
): CheckResult {
  const evidence = runDifferential(differentialSpec(invariants[relation]), { origin, before, candidate });
  return { ok: evidence.status === 'agree', evidence, reason: evidence.counterexamples[0]?.reason };
}
