import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter, type IREntity, type IRRelation } from '../framework/ir/index.js';
import {
  addScaled,
  children,
  constant,
  equalForm,
  equalShape,
  singleName,
  walk,
  numericLiteral,
  type Affine,
  type Expr,
  type Range,
  type TensorModule,
  type Axis,
} from './model.js';

type Diagnose = (node: object, why: string) => never;
const invalid: Diagnose = (_node, why) => {
  throw new Error(why);
};
const nonnegative = (x: Affine) => x.constant >= 0 && x.terms.every(([, c]) => c >= 0);

/** Extrema over a rectangular iteration space. The within-block index covers a subset of its original axis. */
export function indexBounds(index: Affine, axes: ReadonlyMap<string, Axis>): [Affine, Affine] {
  let lo = constant(index.constant),
    hi = lo;
  for (const [id, c] of index.terms) {
    const last = addScaled(axes.get(id)!.extent, constant(-1));
    if (c < 0) lo = addScaled(lo, last, c);
    else hi = addScaled(hi, last, c);
  }
  return [lo, hi];
}

export function checkModule(m: TensorModule, fail: Diagnose = invalid): void {
  if (!Array.isArray(m.functions) || !m.functions.length) fail(m, 'expected tensor functions');
  const names = new Set<string>();
  for (const fn of m.functions) {
    const symbols = new Set(fn.symbols),
      tensors = new Map<string, Affine[]>(),
      anchors = new Set<string>();
    if (!fn.name || names.has(fn.name) || symbols.size !== fn.symbols.length || !fn.params.length)
      fail(fn, 'invalid function signature');
    names.add(fn.name);
    const checkForm = (a: Affine, known: ReadonlySet<string> | ReadonlyMap<string, unknown>) => {
      let last: string | undefined;
      if (!Number.isSafeInteger(a.constant) || !Array.isArray(a.terms))
        fail(a, 'invalid affine constant or terms');
      for (const [id, c] of a.terms) {
        if (!known.has(id) || !Number.isSafeInteger(c) || c === 0 || (last !== undefined && last >= id))
          fail(a, 'invalid affine coefficient or name');
        last = id;
      }
    };
    const dimension = (a: Affine) => {
      checkForm(a, symbols);
      if (a.constant < 0 && a.terms.every(([, c]) => c <= 0)) fail(a, 'negative dimension');
    };
    const bind = (name: string, shape: Affine[]) => {
      if (!name || tensors.has(name) || !shape.length) fail(fn, `invalid tensor definition ${name}`);
      shape.forEach(dimension);
      tensors.set(name, shape);
    };
    for (const p of fn.params) {
      bind(p.name, p.shape);
      for (const a of p.shape) {
        const id = singleName(a);
        if (id !== undefined) anchors.add(id);
      }
    }
    if (fn.symbols.some(s => !anchors.has(s))) fail(fn, 'unbound shape symbol');
    function expression(e: Expr, scope: Map<string, Axis | Range>) {
      switch (e.kind) {
        case 'literal':
          if (!numericLiteral.test(e.text)) fail(e, 'invalid number');
          break;
        case 'shape':
          if (!symbols.has(e.name)) fail(e, 'unbound shape');
          break;
        case 'read': {
          const shape = tensors.get(e.tensor);
          if (!shape || e.indices.length !== shape.length)
            return fail(e, 'unknown tensor or wrong read rank');
          const empty = [...scope.values()].some(a => !a.extent.terms.length && a.extent.constant === 0);
          e.indices.forEach((a, i) => {
            checkForm(a, scope);
            if (empty) return;
            const [lo, hi] = indexBounds(a, scope);
            // A negative minimum or a maximum >= the dimension for every symbolic assignment.
            if (
              (lo.constant < 0 && lo.terms.every(([, c]) => c <= 0)) ||
              nonnegative(addScaled(hi, shape[i], -1))
            )
              fail(e, `subscript outside axis ${i} of ${e.tensor}`);
          });
          break;
        }
        case 'fold': {
          if (!['sum', 'max'].includes(e.op) || !e.axes.length) fail(e, 'invalid reduction');
          const inner = new Map(scope);
          for (const r of e.axes) {
            dimension(r.extent);
            if (!r.id || inner.has(r.id)) fail(e, 'duplicate reduction binder');
            if (r.kind !== 'full') {
              if (!['blocks', 'within'].includes(r.kind) || !Number.isSafeInteger(r.size) || r.size < 1)
                fail(e, 'invalid block range');
              if (r.kind === 'within') {
                const outer = inner.get(r.outer);
                if (
                  !outer ||
                  !('kind' in outer) ||
                  outer.kind !== 'blocks' ||
                  outer.size !== r.size ||
                  !equalForm(outer.extent, r.extent)
                )
                  fail(e, 'incompatible enclosing block');
              }
            }
            inner.set(r.id, r);
          }
          expression(e.body, inner);
          return;
        }
        case 'binary':
          if (!['+', '-', '*', '/', 'min', 'max'].includes(e.op)) fail(e, 'invalid scalar operator');
          break;
        case 'exp':
        case 'log':
        case 'sqrt':
        case 'tanh':
        case 'neg':
          break;
        default:
          fail(e, 'invalid tensor expression');
      }
      for (const child of children(e)) expression(child, scope);
    }
    for (const d of fn.definitions) {
      const scope = new Map(d.axes.map(a => [a.id, a]));
      if (
        scope.size !== d.axes.length ||
        !equalShape(
          d.axes.map(a => a.extent),
          d.shape,
        )
      )
        fail(d, 'invalid free axes');
      d.shape.forEach(dimension);
      expression(d.body, scope);
      bind(d.name, d.shape);
    }
    const actual = tensors.get(fn.result);
    if (!actual || !equalShape(actual, fn.resultShape)) fail(fn, 'invalid return tensor shape');
  }
}
export const TensorIR = defineIR<TensorModule>({
  id: 'tensor.indexed',
  version: '1',
  description: 'Checked ordered tensor definitions and index folds',
  validate(value: unknown): asserts value is TensorModule {
    checkModule(value as TensorModule);
  },
});
export const tensorId = (fn: string, name: string) => fn + '/' + name;
function entities(m: TensorModule): IREntity[] {
  const out: IREntity[] = [];
  for (const [order, f] of m.functions.entries()) {
    out.push({
      id: f.name,
      kind: 'function',
      attributes: { order, symbols: f.symbols, resultShape: f.resultShape },
    });
    for (const p of f.params) out.push({ id: tensorId(f.name, p.name), kind: 'param', attributes: { ...p } });
    for (const d of f.definitions)
      out.push({ id: tensorId(f.name, d.name), kind: 'definition', attributes: { ...d } });
  }
  return out;
}
export const tensorAdapter = defineAdapter<TensorModule>({
  id: 'tensor.indexed.adapter',
  version: '1',
  kind: TensorIR.id,
  schemaVersion: TensorIR.version,
  description: TensorIR.description,
  validate: TensorIR.validate,
  relationKinds: { member: 'containment', read: 'dependency', result: 'binding' },
  entities,
  resolve: (m, id) => entities(m).find(e => e.id === id),
  describe: (_m, id) => ({ label: id }),
  roots: m => m.functions.map(f => f.name),
  relations(m) {
    const edges: IRRelation[] = [];
    for (const f of m.functions) {
      for (const [order, d] of [...f.params, ...f.definitions].entries()) {
        const id = tensorId(f.name, d.name);
        edges.push({
          id: 'member:' + id,
          from: f.name,
          to: id,
          kind: 'member',
          category: 'containment',
          order,
        });
      }
      for (const d of f.definitions) {
        const from = tensorId(f.name, d.name),
          reads = new Set<string>();
        walk(d.body, e => {
          if (e.kind === 'read') reads.add(e.tensor);
        });
        for (const name of reads)
          edges.push({
            id: from + ':read:' + name,
            from,
            to: tensorId(f.name, name),
            kind: 'read',
            category: 'dependency',
          });
      }
      edges.push({
        id: 'return:' + f.name,
        from: f.name,
        to: tensorId(f.name, f.result),
        kind: 'result',
        category: 'binding',
      });
    }
    return edges;
  },
});
