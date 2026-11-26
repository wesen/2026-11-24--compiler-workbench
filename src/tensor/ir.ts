import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter } from '../framework/ir/adapters.js';
import type { IREntity, IRRelation } from '../framework/ir/types.js';
import { add, constant, echelon, equal, negative, scale, value, type Affine } from './affine.js';

export interface Location {
  readonly line: number;
  readonly col: number;
}
export const errorAt = (at: Location, message: string) => new Error(`${at.line}:${at.col}: ${message}`);
interface Node {
  readonly id: string;
  readonly at: Location;
}
export interface Binder extends Node {
  readonly extent: Affine;
}
export const arity = {
  neg: 1,
  '+': 2,
  '-': 2,
  '*': 2,
  '/': 2,
  exp: 1,
  log: 1,
  sqrt: 1,
  tanh: 1,
  min: 2,
  max: 2,
} as const;
export type Operator = keyof typeof arity;
export type Expr = Node &
  (
    | { readonly kind: 'literal'; readonly text: string }
    | { readonly kind: 'shape'; readonly name: string }
    | { readonly kind: 'load'; readonly tensor: string; readonly access: readonly Affine[] }
    | { readonly kind: 'op'; readonly op: Operator; readonly args: readonly Expr[] }
    | {
        readonly kind: 'reduce';
        readonly op: 'sum' | 'max';
        readonly binders: readonly Binder[];
        readonly body: Expr;
      }
    | {
        readonly kind: 'blockedSum';
        readonly blockSize: number;
        readonly binders: readonly [Binder];
        readonly body: Expr;
      }
  );
export type Reduction = Extract<Expr, { kind: 'reduce' | 'blockedSum' }>;
export interface Parameter extends Node {
  readonly name: string;
  readonly shape: readonly Affine[];
}
export interface Definition extends Parameter {
  readonly binders: readonly Binder[];
  readonly expr: Expr;
}
export interface TensorFunction extends Node {
  readonly name: string;
  readonly shapeNames: readonly string[];
  readonly params: readonly Parameter[];
  readonly resultShape: readonly Affine[];
  readonly definitions: readonly Definition[];
  readonly result: string;
}
export interface TensorModule {
  readonly functions: readonly TensorFunction[];
}
export const literalPattern = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export const namePattern = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
export const sameShape = (a: readonly Affine[], b: readonly Affine[]) =>
  a.length === b.length && a.every((dim, i) => equal(dim, b[i]));
export function visit(expr: Expr, enter: (node: Expr) => void) {
  enter(expr);
  if (expr.kind === 'op') for (const arg of expr.args) visit(arg, enter);
  if (expr.kind === 'reduce' || expr.kind === 'blockedSum') visit(expr.body, enter);
}

/** Min and max for nonempty rectangular domains. With zero extent the caller skips the access. */
export function bounds(map: Affine, scope: ReadonlyMap<string, Binder>) {
  let lo = constant(BigInt(map.constant)),
    hi = lo;
  for (const [id, text] of map.terms) {
    const k = BigInt(text);
    const extreme = scale(add(scope.get(id)!.extent, constant(-1n)), k);
    if (k < 0n) lo = add(lo, extreme);
    else hi = add(hi, extreme);
  }
  return { lo, hi };
}

const integerText = /^(?:0|-?[1-9][0-9]*)$/;
const fields = (x: object, expected: string) => {
  const keys = expected.split(' ');
  return Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
};

export function validateModule(input: unknown): asserts input is TensorModule {
  const bad = (at: Location | undefined, text: string): never => {
    throw errorAt(at ?? { line: 1, col: 1 }, text);
  };
  const module = input as TensorModule;
  if (!module || !fields(module, 'functions') || !Array.isArray(module.functions) || !module.functions.length)
    bad(undefined, 'expected a nonempty tensor module');
  const usedIds = new Set<string>();
  function node(n: Node, expected: string) {
    if (
      !n?.at ||
      !fields(n, `id at ${expected}`) ||
      !fields(n.at, 'line col') ||
      !Number.isSafeInteger(n.at.line) ||
      !Number.isSafeInteger(n.at.col) ||
      n.at.line < 1 ||
      n.at.col < 1 ||
      typeof n.id !== 'string' ||
      !n.id ||
      usedIds.has(n.id)
    )
      bad(undefined, 'invalid or duplicate IR node');
    usedIds.add(n.id);
  }
  function affine(a: Affine, at: Location, visible: ReadonlySet<string> | ReadonlyMap<string, Binder>) {
    if (
      !a ||
      !fields(a, 'constant terms') ||
      typeof a.constant !== 'string' ||
      !integerText.test(a.constant) ||
      !Array.isArray(a.terms)
    )
      bad(at, 'invalid affine expression');
    let prev = '';
    for (const term of a.terms) {
      if (
        !Array.isArray(term) ||
        term.length !== 2 ||
        typeof term[0] !== 'string' ||
        term[0] <= prev ||
        !visible.has(term[0]) ||
        typeof term[1] !== 'string' ||
        term[1] === '0' ||
        !integerText.test(term[1])
      )
        bad(at, 'invalid affine term');
      prev = term[0];
    }
  }
  const fnNames = new Set<string>();
  for (const fn of module.functions as readonly TensorFunction[]) {
    node(fn, 'name shapeNames params resultShape definitions result');
    if (typeof fn.name !== 'string' || !namePattern.test(fn.name) || fnNames.has(fn.name))
      bad(fn.at, 'invalid or duplicate function name');
    fnNames.add(fn.name);
    if (
      !Array.isArray(fn.shapeNames) ||
      fn.shapeNames.some(
        (n, i, ns) => typeof n !== 'string' || !namePattern.test(n) || (i > 0 && n <= ns[i - 1]),
      )
    )
      bad(fn.at, 'invalid shape names');
    const shapeNames = new Set(fn.shapeNames);
    function dimension(d: Affine, at: Location) {
      affine(d, at, shapeNames);
      if (negative(d)) bad(at, 'negative tensor or index extent');
    }
    function shape(s: readonly Affine[], at: Location) {
      if (!Array.isArray(s) || !s.length) bad(at, 'expected a tensor shape');
      for (const d of s) dimension(d, at);
    }
    function binders(bs: readonly Binder[], at: Location, parent: ReadonlyMap<string, Binder>) {
      if (!Array.isArray(bs) || !bs.length) bad(at, 'expected index binders');
      const scope = new Map(parent);
      for (const b of bs as readonly Binder[]) {
        node(b, 'extent');
        dimension(b.extent, b.at);
        scope.set(b.id, b);
      }
      return scope;
    }
    const tensors = new Map<string, Parameter>();
    const names = new Set<string>();
    function tensor(t: Parameter, definition: boolean) {
      node(t, definition ? 'name shape binders expr' : 'name shape');
      if (typeof t.name !== 'string' || !namePattern.test(t.name) || names.has(t.name))
        bad(t.at, 'duplicate or invalid tensor name');
      shape(t.shape, t.at);
      names.add(t.name);
    }
    function expr(e: Expr, scope: ReadonlyMap<string, Binder>) {
      switch (e?.kind) {
        case 'literal':
          node(e, 'kind text');
          if (typeof e.text !== 'string' || !literalPattern.test(e.text)) bad(e.at, 'invalid literal');
          break;
        case 'shape':
          node(e, 'kind name');
          if (!shapeNames.has(e.name)) bad(e.at, 'unknown shape value');
          break;
        case 'load': {
          node(e, 'kind tensor access');
          const t = tensors.get(e.tensor) ?? bad(e.at, 'undefined or forward tensor read');
          if (!Array.isArray(e.access) || e.access.length !== t.shape.length)
            bad(e.at, 'incorrect tensor reference rank');
          const empty = [...scope.values()].some(b => equal(b.extent, constant(0n)));
          for (let i = 0; i < e.access.length; i++) {
            affine(e.access[i], e.at, scope);
            if (empty) continue;
            const { lo, hi } = bounds(e.access[i], scope);
            if (negative(lo) || negative(add(add(t.shape[i], constant(-1n)), scale(hi, -1n))))
              bad(e.at, `out-of-bounds access on axis ${i + 1} of ${t.name}`);
          }
          break;
        }
        case 'op':
          node(e, 'kind op args');
          if (!Object.hasOwn(arity, e.op) || !Array.isArray(e.args) || e.args.length !== arity[e.op])
            bad(e.at, 'invalid operator or arity');
          for (const a of e.args) expr(a, scope);
          break;
        case 'reduce':
          node(e, 'kind op binders body');
          if (e.op !== 'sum' && e.op !== 'max') bad(e.at, 'invalid reduction');
          expr(e.body, binders(e.binders, e.at, scope));
          break;
        case 'blockedSum':
          node(e, 'kind blockSize binders body');
          if (e.binders?.length !== 1 || !Number.isSafeInteger(e.blockSize) || e.blockSize < 1)
            bad(e.at, 'invalid blocked sum');
          expr(e.body, binders(e.binders, e.at, scope));
          break;
        default:
          bad((e as Expr | undefined)?.at, 'unknown scalar expression');
      }
    }
    shape(fn.resultShape, fn.at);
    if (!Array.isArray(fn.params) || !fn.params.length || !Array.isArray(fn.definitions))
      bad(fn.at, 'invalid tensors');
    for (const p of fn.params as readonly Parameter[]) {
      tensor(p, false);
      tensors.set(p.id, p);
    }
    if (
      !echelon(
        fn.shapeNames,
        fn.params.flatMap(p => p.shape),
      )
    )
      bad(fn.at, 'inputs do not uniquely bind shape names');
    for (const d of fn.definitions as readonly Definition[]) {
      tensor(d, true);
      const scope = binders(d.binders, d.at, new Map());
      if (
        !sameShape(
          d.shape,
          d.binders.map(b => b.extent),
        )
      )
        bad(d.at, 'definition shape disagrees with index extents');
      expr(d.expr, scope);
      tensors.set(d.id, d);
    }
    const result = tensors.get(fn.result) ?? bad(fn.at, 'unknown return tensor');
    if (!sameShape(result.shape, fn.resultShape)) bad(fn.at, 'return shape disagrees with signature');
  }
}

export function shapeOf(shape: readonly Affine[], names: ReadonlyMap<string, bigint>) {
  return shape.map(d => value(d, id => names.get(id)!));
}

export const TensorIR = defineIR<TensorModule>({
  id: 'tensor.tix',
  version: '1',
  description: 'Checked Tix tensor definitions and index expressions',
  validate: validateModule,
});

const relationKinds = {
  contains: 'containment',
  reads: 'dependency',
  returns: 'dependency',
  binds: 'binding',
} as const;
function project(module: TensorModule) {
  const entities = new Map<string, IREntity>(),
    relations: IRRelation[] = [];
  function entity(n: Node, kind: string, attributes: IREntity['attributes']) {
    entities.set(n.id, { id: n.id, kind, attributes: { ...attributes, at: n.at } });
  }
  function edge(from: Node, to: string, kind: keyof typeof relationKinds, order?: number) {
    relations.push({
      id: `${kind}/${from.id}/${order ?? ''}/${to}`,
      from: from.id,
      to,
      kind,
      category: relationKinds[kind],
      ...(order === undefined ? {} : { order }),
    });
  }
  function binder(owner: Node, b: Binder, i: number) {
    entity(b, 'binder', { extent: b.extent });
    edge(owner, b.id, 'contains', i);
  }
  function expr(owner: Node, e: Expr, i: number) {
    edge(owner, e.id, 'contains', i);
    const kind = `expr.${e.kind}`;
    switch (e.kind) {
      case 'literal':
        entity(e, kind, { text: e.text });
        break;
      case 'shape':
        entity(e, kind, { name: e.name });
        break;
      case 'load':
        entity(e, kind, { access: e.access });
        edge(e, e.tensor, 'reads');
        for (const id of new Set(e.access.flatMap(a => a.terms.map(([id]) => id)))) edge(e, id, 'binds');
        break;
      case 'op':
        entity(e, kind, { op: e.op });
        e.args.forEach((a, j) => expr(e, a, j));
        break;
      case 'reduce':
      case 'blockedSum':
        entity(e, kind, e.kind === 'reduce' ? { op: e.op } : { blockSize: e.blockSize });
        e.binders.forEach((b, j) => binder(e, b, j));
        expr(e, e.body, e.binders.length);
        break;
    }
  }
  module.functions.forEach((fn, order) => {
    entity(fn, 'function', { name: fn.name, order, shapeNames: fn.shapeNames, resultShape: fn.resultShape });
    edge(fn, fn.result, 'returns');
    fn.params.forEach((t, i) => {
      entity(t, 'tensor.parameter', { name: t.name, shape: t.shape });
      edge(fn, t.id, 'contains', i);
    });
    fn.definitions.forEach((t, i) => {
      entity(t, 'tensor.definition', { name: t.name, shape: t.shape });
      edge(fn, t.id, 'contains', fn.params.length + i);
      t.binders.forEach((b, j) => binder(t, b, j));
      expr(t, t.expr, t.binders.length);
    });
  });
  return { entities, relations };
}

const views = new WeakMap<TensorModule, ReturnType<typeof project>>();
function projection(module: TensorModule) {
  const prior = views.get(module);
  if (prior) return prior;
  const result = project(module);
  views.set(module, result);
  return result;
}
export const tensorAdapter = defineAdapter<TensorModule>({
  id: 'tensor.index-tree',
  version: '1',
  kind: TensorIR.id,
  schemaVersion: TensorIR.version,
  description: 'Tix functions, tensors, scalar trees and index bindings',
  relationKinds,
  validate: validateModule,
  entities: m => projection(m).entities.values(),
  resolve: (m, id) => projection(m).entities.get(id),
  relations: m => projection(m).relations,
  describe: (m, id) => {
    const e = projection(m).entities.get(id)!;
    return { label: String(e.attributes.name ?? e.attributes.op ?? e.kind) };
  },
  roots: m => m.functions.map(f => f.id),
});
