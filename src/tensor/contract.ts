import type { Artifact } from '../framework/core/types.js';
import { canonical } from '../framework/core/data.js';
import { differential, differentialSpec, runDifferential } from '../framework/contracts/differential.js';
import { defineType } from '../framework/contracts/definitions.js';
import type { CheckResult } from '../framework/contracts/types.js';
import { evaluate, volume } from './evaluate.js';
import type { Inputs, Tensor } from './evaluate.js';
import { TixIR } from './ir.js';
import { endpoints, symbols, value } from './model.js';
import type { Affine, Axis, Bindings, Expr, Fn, Module } from './model.js';

export type Relation = 'exact' | 'tolerance';
type Pattern = 'ramp' | 'mixed' | 'witness';
type Sample = { fn: string; sizes: Record<string, number>; pattern: Pattern; inputs: Inputs };
const entry = defineType<string>({
  id: 'tix.entry',
  version: '1',
  description: 'Tix function name',
  validate(name) {
    if (typeof name !== 'string') throw Error('expected a function name');
  },
});
const ports = { origin: TixIR, baseline: TixIR, candidate: TixIR, entry };
const witness = [1, 0, 2 ** -24, 2 ** -24, 0.25];

// Check admissibility and estimate loop work before allocating any generated input.
function fits(fn: Fn, sizes: Bindings): boolean {
  const tensors = new Map<string, number[]>(),
    boxes = new Map<string, Affine>();
  let visits = 0;
  function tensor(name: string, shape: Affine[]) {
    const dims = shape.map(d => value(d, sizes));
    tensors.set(name, dims);
    return dims.every(d => Number.isSafeInteger(d) && d >= 0) && volume(dims) <= 4096;
  }
  function iterations(axes: Axis[], count: number) {
    for (const a of axes) {
      boxes.set(a.id, a.extent);
      const n = value(a.extent, sizes);
      if (!Number.isSafeInteger(n) || n < 0) return Infinity;
      count *= n;
      visits += count;
    }
    return count;
  }
  function valid(e: Expr, count: number): boolean {
    visits += count;
    if (visits > 65536) return false;
    switch (e.kind) {
      case 'load':
        return (
          count === 0 ||
          e.indices.every((idx, i) => {
            const [lo, hi] = endpoints(idx, boxes);
            return value(lo, sizes) >= 0 && value(hi, sizes) < tensors.get(e.tensor)![i];
          })
        );
      case 'unary':
        return valid(e.arg, count);
      case 'binary':
        return valid(e.left, count) && valid(e.right, count);
      case 'reduce':
      case 'blocked':
        return valid(e.body, iterations(e.axes, count));
      default:
        return true;
    }
  }
  return (
    fn.params.every(p => tensor(p.name, p.shape)) &&
    fn.statements.every(
      s =>
        tensor(
          s.name,
          s.axes.map(a => a.extent),
        ) && valid(s.expr, iterations(s.axes, 1)),
    )
  );
}
export function samples(fn: Fn, random: () => number): Sample[] {
  const names = symbols(fn),
    cases: Sample[] = [],
    seen = new Set<string>();
  const settings = [1, 3, 5].map(n => names.map(() => n));
  names.forEach((_, i) => settings.push(names.map((_, j) => (i === j ? 5 : 3))));
  for (const setting of settings) {
    const key = setting.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const sizes = new Map(names.map((n, i) => [n, setting[i]]));
    if (!fits(fn, sizes)) continue;
    for (const pattern of ['ramp', 'mixed', 'witness'] as const) {
      const inputs: Inputs = Object.create(null);
      fn.params.forEach((p, ordinal) => {
        const shape = p.shape.map(d => value(d, sizes)),
          data = new Float32Array(volume(shape));
        for (let i = 0; i < data.length; i++) {
          switch (pattern) {
            case 'ramp':
              data[i] = (1 + ((i + 3 * ordinal) % 16)) / 16;
              break;
            case 'mixed':
              data[i] = 2 * random() - 1;
              break;
            case 'witness':
              data[i] = witness[(i % shape[shape.length - 1]) % witness.length];
              break;
          }
        }
        inputs[p.name] = { shape, data };
      });
      cases.push({ fn: fn.name, sizes: Object.fromEntries(sizes), pattern, inputs });
    }
  }
  return cases;
}
const words = (t: Tensor) => new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.length);
function compare(a: Tensor, b: Tensor, relation: Relation) {
  if (a.shape.length !== b.shape.length || a.shape.some((n, i) => n !== b.shape[i]))
    return { ok: false, reason: 'output shape mismatch' };
  const exact = relation === 'exact',
    left = exact ? words(a) : a.data,
    right = exact ? words(b) : b.data;
  for (let i = 0; i < left.length; i++) {
    const ref = left[i],
      got = right[i],
      bound = 1e-6 + 1e-5 * Math.abs(ref);
    if (exact ? ref === got : Number.isFinite(got) && Math.abs(got - ref) <= bound) continue;
    let offset = i;
    const coord = a.shape.map(() => 0);
    for (let j = coord.length - 1; j >= 0; j--) {
      coord[j] = offset % a.shape[j];
      offset = Math.floor(offset / a.shape[j]);
    }
    const detail = exact
      ? 'words 0x' + ref.toString(16) + ' vs 0x' + got.toString(16)
      : ref + ' vs ' + got + ' (bound ' + bound + ')';
    return { ok: false, reason: 'output [' + coord.join(',') + '] ' + detail };
  }
  return true;
}
function signature(m: Module) {
  return canonical(m.functions.map(f => ({ name: f.name, params: f.params, shape: f.shape })));
}
function invariant(relation: Relation) {
  return differential<typeof ports, Sample, { output: Tensor; skip: boolean }>({
    id: 'tix.' + relation,
    version: '1',
    description: 'Sampled elementwise Tix output comparison',
    inputs: ports,
    baseline: 'baseline',
    subject: 'candidate',
    count: 3,
    seed: 7,
    cases: ({ origin, entry }, random) =>
      samples(origin.value.functions.find(f => f.name === entry)!, random),
    run: (side, _value, c, inputs) => {
      const artifact = side === 'subject' ? inputs.candidate : inputs.baseline;
      const reference = relation === 'tolerance' && side === 'baseline';
      const f = artifact.value.functions.find(f => f.name === c.fn)!;
      const output = evaluate(f, c.inputs, reference ? 'f64' : 'f32');
      return { output, skip: reference && !output.data.every(Number.isFinite) };
    },
    inconclusive: o => o.skip,
    compare: (a, b) => compare(a.output, b.output, relation),
    describeCase: ({ fn, sizes, pattern }) => ({ fn, sizes, pattern }),
  });
}
const invariants = { exact: invariant('exact'), tolerance: invariant('tolerance') };
export function checkMeaning(
  origin: Artifact<Module>,
  before: Artifact<Module>,
  candidate: Artifact<Module>,
  relation: Relation,
): CheckResult {
  if (signature(origin.value) !== signature(candidate.value))
    return { ok: false, reason: 'function interface changed' };
  const reports = [];
  for (const fn of origin.value.functions) {
    const inv = invariants[relation];
    const evidence = runDifferential(differentialSpec(inv), {
      origin,
      entry: fn.name,
      baseline: relation === 'exact' ? before : origin,
      candidate,
    });
    reports.push({ fn: fn.name, version: inv.version, ...evidence });
    if (evidence.status !== 'agree')
      return {
        ok: false,
        reason: evidence.counterexamples[0]?.reason ?? 'no eligible cases for ' + fn.name,
        evidence: reports,
      };
  }
  return { ok: true, evidence: reports };
}
