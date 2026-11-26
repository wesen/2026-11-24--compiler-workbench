import { combine, constant, equal, nonnegative, variables, type Affine } from './affine.js';
import {
  builtins,
  children,
  errorAt,
  namePattern,
  numberPattern,
  operators,
  type Axis,
  type Expr,
  type Shape,
  type Span,
  type TensorFn,
  type TensorIR,
} from './model.js';
import { parse, type RawExpr, type RawFn } from './parser.js';

export function sameShape(a: Shape, b: Shape): boolean {
  return a.length === b.length && a.every((dim, i) => equal(dim, b[i]));
}

export function shapeNames(fn: Pick<TensorFn, 'params'>): string[] {
  return [...new Set(fn.params.flatMap(p => p.shape.flatMap(d => d.terms.map(([n]) => n))))].sort();
}

interface Binding {
  id: string;
  extent?: Affine;
  at: Span;
}

function lower(fn: RawFn): TensorFn {
  const tensors = new Map(fn.params.map(p => [p.name, p.shape]));
  const shapes = new Set(shapeNames(fn));
  let nextId = 0;
  const statements = fn.statements.map(stmt => {
    if (tensors.has(stmt.name)) errorAt(stmt.at, `tensor '${stmt.name}' is already defined`);
    if (stmt.shape && stmt.shape.length !== stmt.axes.length)
      errorAt(stmt.at, 'declared output rank mismatch');
    // Keep declaration and every plain-use candidate on the same binder, even across nested scopes.
    const bind = (names: typeof stmt.axes, declared?: Shape): Map<string, Binding> => {
      const frame = new Map<string, Binding>();
      names.forEach((token, i) => {
        if (frame.has(token.text)) errorAt(token, `duplicate index '${token.text}'`);
        frame.set(token.text, { id: String(nextId++), extent: declared?.[i], at: token });
      });
      return frame;
    };
    const axes = (frame: Map<string, Binding>): Axis[] =>
      [...frame].map(([name, b]) => {
        if (!b.extent) errorAt(b.at, `cannot infer extent for '${name}' from a plain use or declaration`);
        return { id: b.id, extent: b.extent, range: { kind: 'full' } };
      });
    const outer = bind(stmt.axes, stmt.shape);
    function expr(e: RawExpr, scope: ReadonlyMap<string, Binding>): Expr {
      switch (e.tag) {
        case 'literal':
          return e;
        case 'shape':
          if (!shapes.has(e.text)) errorAt(e.at, `unbound shape name '${e.text}'`);
          return e;
        case 'neg':
          return { ...e, body: expr(e.body, scope) };
        case 'binary':
          return { ...e, left: expr(e.left, scope), right: expr(e.right, scope) };
        case 'call':
          return { ...e, args: e.args.map(arg => expr(arg, scope)) };
        case 'fold': {
          const frame = bind(e.axes);
          const body = expr(e.body, new Map([...scope, ...frame]));
          return { ...e, axes: axes(frame), body };
        }
        case 'load': {
          const { tensor, subscripts } = e.load;
          const shape = tensors.get(tensor);
          if (!shape) errorAt(e.at, `unknown or not yet defined tensor '${tensor}'`);
          if (subscripts.length !== shape.length) errorAt(e.at, `subscript rank mismatch for '${tensor}'`);
          const get = (n: string) => scope.get(n) ?? errorAt(e.at, `unbound index '${n}'`);
          return {
            ...e,
            load: {
              tensor,
              subscripts: subscripts.map(({ form, names, plain }, i) => {
                for (const name of names) get(name);
                if (plain !== null) {
                  const b = get(plain),
                    dim = shape[i];
                  if (b.extent && !equal(b.extent, dim)) errorAt(e.at, `inconsistent extent for '${plain}'`);
                  b.extent = dim;
                }
                return variables(form, n => get(n).id, e.at);
              }),
            },
          };
        }
      }
    }
    const body = expr(stmt.expr, outer),
      indexes = axes(outer),
      shape = indexes.map(a => a.extent);
    tensors.set(stmt.name, shape);
    return { name: stmt.name, at: stmt.at, shape, axes: indexes, expr: body };
  });
  const shape = tensors.get(fn.returned.text);
  if (!shape || !sameShape(shape, fn.result))
    errorAt(fn.returned, 'unknown return tensor or return shape mismatch');
  return {
    name: fn.name,
    at: fn.at,
    params: fn.params,
    result: fn.result,
    statements,
    return: fn.returned.text,
  };
}

export const lowerSource = (source: string): TensorIR => ({ functions: parse(source).map(lower) });

function requireAt(condition: unknown, span: Span, message: string): asserts condition {
  if (!condition) errorAt(span, message);
}

export class UnprovenBounds extends Error {
  constructor(span: Span, tensor: string, axis: number) {
    super(`${span.line}:${span.col}: cannot prove subscript ${axis} is in bounds for '${tensor}'`);
  }
}

/** Shared source/native verifier. Access bounds are proven on the (possibly larger) full logical index range. */
export function validateTensor(value: unknown): asserts value is TensorIR {
  const ir = value as TensorIR;
  if (!Array.isArray(ir?.functions) || !ir.functions.length) throw new Error('1:1: expected a Tix function');
  const names = new Set<string>();
  for (const fn of ir.functions as readonly TensorFn[]) {
    const { at } = fn;
    const nameOK = (name: string) => typeof name === 'string' && namePattern.exec(name)?.[0] === name;
    requireAt(nameOK(fn.name) && !names.has(fn.name), at, `invalid or duplicate function '${fn.name}'`);
    names.add(fn.name);
    requireAt(fn.params.length > 0, at, 'expected a parameter');
    const dimNames = new Set(shapeNames(fn));
    const boundNames = new Set(
      fn.params.flatMap(p => p.shape.filter(d => d.terms.length === 1).map(d => d.terms[0][0])),
    );
    for (const name of dimNames)
      requireAt(boundNames.has(name), at, `no parameter axis binds shape name '${name}' independently`);
    const knownDims = fn.params.flatMap(p => p.shape);
    const tensors = new Map<string, Shape>();
    const seenIds = new Set<string>();
    const scope = new Map<string, Axis>();
    function affine(a: Affine, valid: (key: string) => boolean, span: Span) {
      requireAt(Number.isSafeInteger(a.constant) && Array.isArray(a.terms), span, 'invalid affine form');
      let last: string | undefined;
      for (const [name, n] of a.terms) {
        requireAt(
          typeof name === 'string' &&
            (last === undefined || last < name) &&
            Number.isSafeInteger(n) &&
            n !== 0 &&
            valid(name),
          span,
          'invalid affine term',
        );
        last = name;
      }
    }
    function extent(d: Affine, span: Span) {
      affine(d, n => nameOK(n) && dimNames.has(n), span);
      requireAt(d.constant >= 0 || d.terms.some(([, coeff]) => coeff > 0), span, 'negative extent');
    }
    function shape(s: Shape, span: Span) {
      requireAt(Array.isArray(s) && s.length > 0, span, 'expected a tensor shape');
      for (const d of s) extent(d, span);
    }
    function withAxes(axes: readonly Axis[], span: Span, visit: () => void, blocked: boolean) {
      requireAt(Array.isArray(axes) && axes.length > 0, span, 'expected index axes');
      for (const axis of axes) {
        const { id, range } = axis;
        requireAt(
          typeof id === 'string' && id.length > 0 && !seenIds.has(id),
          span,
          `invalid or duplicate binder '${id}'`,
        );
        seenIds.add(id);
        extent(axis.extent, span);
        if (range.kind !== 'full') {
          requireAt(
            blocked && axes.length === 1 && Number.isSafeInteger(range.size) && range.size > 0,
            span,
            'invalid block size or range',
          );
          if (range.kind === 'within') {
            const outer = scope.get(range.block);
            requireAt(
              outer?.range.kind === 'blocks' &&
                outer.range.size === range.size &&
                equal(outer.extent, axis.extent),
              span,
              'no matching block binder',
            );
          } else requireAt(range.kind === 'blocks', span, 'unknown loop range');
        }
        scope.set(id, axis);
      }
      visit();
      for (const a of axes) scope.delete(a.id);
    }
    function validateExpr(e: Expr) {
      const span = e.at;
      switch (e.tag) {
        case 'literal':
          requireAt(
            typeof e.text === 'string' && numberPattern.exec(e.text)?.[0] === e.text,
            span,
            'invalid literal',
          );
          return;
        case 'shape':
          requireAt(dimNames.has(e.text), span, 'unknown shape name');
          return;
        case 'neg':
          break;
        case 'binary':
          requireAt(operators.includes(e.op), span, 'invalid binary operator');
          break;
        case 'call':
          requireAt(
            builtins.includes(e.op) && e.args.length === (e.op === 'min' || e.op === 'max' ? 2 : 1),
            span,
            'invalid call',
          );
          break;
        case 'fold':
          requireAt(e.op === 'sum' || e.op === 'max', span, 'invalid reduction');
          withAxes(e.axes, span, () => validateExpr(e.body), true);
          return;
        case 'load': {
          const target = tensors.get(e.load.tensor);
          requireAt(
            target && target.length === e.load.subscripts.length,
            span,
            'unknown tensor or rank mismatch',
          );
          const active = [...scope.values()];
          const empty = active.some(a => equal(a.extent, constant(0)));
          const facts = empty
            ? knownDims
            : [...knownDims, ...active.map(a => combine(a.extent, constant(1), -1, span))];
          e.load.subscripts.forEach((sub, i) => {
            affine(sub, n => scope.has(n) && scope.get(n)!.range.kind !== 'blocks', span);
            if (empty) return;
            let lo = constant(sub.constant),
              hi = lo;
            for (const [id, coeff] of sub.terms) {
              const last = combine(scope.get(id)!.extent, constant(1), -1, span);
              if (coeff > 0) hi = combine(hi, last, coeff, span);
              else lo = combine(lo, last, coeff, span);
            }
            const upperSlack = combine(combine(target[i], constant(1), -1, span), hi, -1, span);
            if (!nonnegative(lo, facts, span) || !nonnegative(upperSlack, facts, span))
              throw new UnprovenBounds(span, e.load.tensor, i + 1);
          });
          return;
        }
        default:
          errorAt(span, 'unknown expression');
      }
      for (const child of children(e)) validateExpr(child);
    }
    function tensor(t: { name: string; shape: Shape; at: Span }) {
      requireAt(nameOK(t.name) && !tensors.has(t.name), t.at, `invalid or duplicate tensor '${t.name}'`);
      shape(t.shape, t.at);
      tensors.set(t.name, t.shape);
    }
    for (const p of fn.params) tensor(p);
    for (const stmt of fn.statements) {
      requireAt(
        sameShape(
          stmt.shape,
          stmt.axes.map(a => a.extent),
        ),
        stmt.at,
        'statement shape does not match its axes',
      );
      withAxes(stmt.axes, stmt.at, () => validateExpr(stmt.expr), false);
      tensor(stmt);
    }
    shape(fn.result, at);
    const returned = tensors.get(fn.return);
    requireAt(
      returned && sameShape(returned, fn.result),
      at,
      'unknown return tensor or return shape mismatch',
    );
  }
}
