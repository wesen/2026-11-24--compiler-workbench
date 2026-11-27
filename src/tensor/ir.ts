import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { plain, visit, type Affine, type Axis, type Expr, type Fn, type Module } from './model.js';

function requireIR(condition: unknown, reason: string): asserts condition {
  if (!condition) throw Error(reason);
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function checkForm(a: Affine, names: Set<string>) {
  requireIR(
    Number.isSafeInteger(a.constant) && a.terms.every(([n, k]) => names.has(n) && Number.isSafeInteger(k)),
    'Invalid affine form',
  );
}
/** The Tix function validator, reused by the schedule IR, which embeds a copy of the function. */
export function validateTixFn(fn: Fn) {
  validateFn(fn);
}
function validateFn(fn: Fn) {
  const shapes = new Set(fn.params.flatMap(p => p.shape.map(plain).filter((s): s is string => !!s)));
  const tensors = new Map<string, Affine[]>();
  const declare = (t: { name: string; shape: Affine[] }) => {
    requireIR(!tensors.has(t.name) && t.shape.length, 'Invalid tensor definition');
    for (const d of t.shape) {
      checkForm(d, shapes);
      requireIR(d.terms.length || d.constant >= 0, 'Negative dimension');
    }
    tensors.set(t.name, t.shape);
  };
  fn.params.forEach(declare);
  function bind(axes: Axis[], outer: Set<string>) {
    const scope = new Set(outer);
    requireIR(axes.length, 'Missing axes');
    for (const a of axes) {
      requireIR(!scope.has(a.id), 'Duplicate binder');
      const e = a.extent;
      checkForm(e.dim, shapes);
      requireIR(
        e.kind === 'dim' ||
          (e.kind === 'blocks' && ['ceil', 'floor'].includes(e.rounding)) ||
          (e.kind === 'tail' && scope.has(e.block)),
        'Invalid reduction bound',
      );
      scope.add(a.id);
    }
    return scope;
  }
  function expr(e: Expr, scope: Set<string>) {
    switch (e.kind) {
      case 'literal':
        requireIR(!Number.isNaN(Number(e.text)), 'Invalid literal');
        break;
      case 'shape':
        requireIR(shapes.has(e.name), 'Unknown shape');
        break;
      case 'load':
        requireIR(tensors.get(e.name)?.length === e.indices.length, 'Invalid tensor read');
        e.indices.forEach(a => checkForm(a, scope));
        break;
      case 'op':
        requireIR(
          (['neg', 'exp', 'log', 'tanh', 'sqrt'].includes(e.op) && e.args.length === 1) ||
            (['+', '-', '*', '/', 'min', 'max'].includes(e.op) && e.args.length === 2),
          'Invalid operation',
        );
        e.args.forEach(x => expr(x, scope));
        break;
      case 'reduce':
        requireIR(e.op === 'sum' || e.op === 'max', 'Invalid reduction');
        expr(e.body, bind(e.axes, scope));
        break;
      default:
        throw Error('Invalid expression');
    }
  }
  for (const s of fn.statements) {
    requireIR(
      s.axes.length === s.shape.length &&
        s.axes.every((a, i) => a.extent.kind === 'dim' && same(a.extent.dim, s.shape[i])),
      'Invalid result axes',
    );
    expr(s.expr, bind(s.axes, new Set()));
    declare(s);
  }
  requireIR(same(tensors.get(fn.result), fn.shape), 'Invalid result');
}
function validate(value: unknown) {
  const m = value as Module;
  requireIR(
    Array.isArray(m.functions) &&
      m.functions.length &&
      new Set(m.functions.map(f => f.name)).size === m.functions.length,
    'Invalid functions',
  );
  m.functions.forEach(validateFn);
}
export const TixIR = defineIR<Module>({
  id: 'tensor.tix',
  version: '1',
  description: 'Ordered tensor definitions with affine reads',
  validate,
  entities: m => m.functions.flatMap(f => f.statements.map(s => f.name + '/' + s.name)),
});
function* entities(m: Module): Generator<IREntity> {
  for (const { name, statements, params, shape, result } of m.functions) {
    yield { id: name, kind: 'function', attributes: { shape, result } };
    for (const t of [...params, ...statements])
      yield { id: name + '/' + t.name, kind: 'tensor', attributes: { ...t } };
  }
}
function* relations(m: Module): Generator<IRRelation> {
  for (const f of m.functions) {
    let order = 0;
    for (const t of [...f.params, ...f.statements]) {
      const to = f.name + '/' + t.name;
      yield {
        id: 'contains/' + to,
        from: f.name,
        to,
        kind: 'contains',
        category: 'containment',
        order: order++,
      };
    }
    for (const s of f.statements) {
      const from = f.name + '/' + s.name;
      const reads = new Set<string>();
      visit(s.expr, e => {
        if (e.kind === 'load') reads.add(e.name);
      });
      for (const n of reads)
        yield {
          id: 'reads/' + from + '/' + n,
          from,
          to: f.name + '/' + n,
          kind: 'reads',
          category: 'dependency',
        };
    }
  }
}
export const adapter = defineAdapter<Module>({
  id: 'tensor.adapter',
  version: '1',
  description: 'Functions, tensor definitions and reads',
  kind: TixIR.id,
  schemaVersion: TixIR.version,
  validate,
  relationKinds: { contains: 'containment', reads: 'dependency' },
  entities,
  relations,
  resolve: (m, id) => [...entities(m)].find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
});
