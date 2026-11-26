export interface Aff {
  c: number;
  t: [string, number][];
}
export const constant = (c: number): Aff => ({ c, t: [] });
export const variable = (n: string): Aff => ({ c: 0, t: [[n, 1]] });
export function plus(a: Aff, b: Aff, k = 1): Aff {
  const terms = new Map(a.t);
  for (const [n, v] of b.t) terms.set(n, (terms.get(n) ?? 0) + k * v);
  return { c: a.c + k * b.c, t: [...terms].filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : 1)) };
}
export const plain = (a: Aff) => (a.c === 0 && a.t.length === 1 && a.t[0][1] === 1 ? a.t[0][0] : undefined);
export const same = (a: Aff, b: Aff) => plus(a, b, -1).t.length === 0 && a.c === b.c;
export const subst = (a: Aff, env: Map<string, Aff>) =>
  a.t.reduce((v, [n, k]) => plus(v, env.get(n) ?? variable(n), k), constant(a.c));
export const value = (a: Aff, env: Map<string, number>) =>
  a.t.reduce((v, [n, k]) => v + k * env.get(n)!, a.c);
export interface Axis {
  id: string;
  extent: Aff;
}
export type Expr =
  | { op: 'num'; v: number }
  | { op: 'shape'; name: string }
  | { op: 'read'; name: string; sub: Aff[] }
  | { op: 'calc'; fn: string; args: Expr[] }
  | { op: 'reduce'; fn: 'sum' | 'max' | 'blocked'; axes: Axis[]; body: Expr };
export interface Param {
  name: string;
  dims: Aff[];
}
export interface Stmt extends Param {
  axes: Axis[];
  rhs: Expr;
  at: string;
}
export interface Fn {
  name: string;
  params: Param[];
  defs: Stmt[];
  result: Aff[];
  ret: string;
  at: string;
}
export type Module = Fn[];
export const children = (e: Expr) => (e.op === 'calc' ? e.args : e.op === 'reduce' ? [e.body] : []);
export function* walk(e: Expr): Generator<Expr> {
  yield e;
  for (const c of children(e)) yield* walk(c);
}
export function transform(e: Expr, f: (e: Expr) => Expr): Expr {
  return f(
    e.op === 'calc'
      ? { ...e, args: e.args.map(c => transform(c, f)) }
      : e.op === 'reduce'
        ? { ...e, body: transform(e.body, f) }
        : e,
  );
}
export const arity = new Map(
  Object.entries({
    neg: 1,
    exp: 1,
    log: 1,
    sqrt: 1,
    tanh: 1,
    max: 2,
    min: 2,
    '+': 2,
    '-': 2,
    '*': 2,
    '/': 2,
  }),
);
export function fail(at: string, msg: string): never {
  throw new Error(`${at}: ${msg}`);
}

/** Validate the resolved form independently of the parser (also used for native pass results). */
export function validate(ir: unknown): asserts ir is Module {
  const mod = ir as Module;
  if (!Array.isArray(mod) || !mod.length) fail('1:1', 'expected functions');
  const names = new Set<string>();
  for (const f of mod) {
    let at = f.at;
    const check = (ok: unknown, msg: string) => {
      if (!ok) fail(at, msg);
    };
    check(!names.has(f.name), 'duplicate function');
    names.add(f.name);
    const shapes = new Set(f.params.flatMap(p => p.dims.map(plain)).filter(n => n !== undefined));
    const aff = (a: Aff, scope: Set<string>) => {
      check(Number.isSafeInteger(a.c), 'invalid affine constant');
      let prev: string | undefined;
      for (const [n, k] of a.t) {
        check(
          scope.has(n) && Number.isSafeInteger(k) && k !== 0 && (prev === undefined || prev < n),
          'invalid or unbound affine term ' + n,
        );
        prev = n;
      }
    };
    const dims = (ds: Aff[]) => {
      check(ds.length > 0, 'empty tensor type');
      for (const d of ds) {
        aff(d, shapes);
        check(d.t.length || d.c >= 0, 'negative dimension');
      }
    };
    const tensors = new Map<string, Aff[]>();
    for (const p of f.params) {
      dims(p.dims);
      check(!tensors.has(p.name), 'duplicate parameter');
      tensors.set(p.name, p.dims);
    }
    dims(f.result);
    for (const s of f.defs) {
      at = s.at;
      dims(s.dims);
      check(!tensors.has(s.name), 'duplicate definition');
      const scope = new Map<string, Aff>();
      const bind = (ax: Axis) => {
        dims([ax.extent]);
        check(!scope.has(ax.id), 'duplicate binder');
        scope.set(ax.id, ax.extent);
      };
      check(
        s.axes.length === s.dims.length && s.axes.every((a, i) => same(a.extent, s.dims[i])),
        'incorrect loop domains',
      );
      s.axes.forEach(bind);
      // An executed loop implies extent >= 1. For a one-symbol extent this tightens the symbol's lower bound.
      function nonnegative(a: Aff) {
        const lows = new Map<string, number>();
        for (const d of scope.values())
          if (d.t.length === 1 && d.t[0][1] > 0) {
            const [n, k] = d.t[0];
            lows.set(n, Math.max(lows.get(n) ?? 0, Math.ceil((1 - d.c) / k)));
          }
        return (
          a.t.every(([, k]) => k >= 0) && a.t.reduce((v, [n, k]) => v + k * (lows.get(n) ?? 0), a.c) >= 0
        );
      }
      function expr(e: Expr) {
        switch (e.op) {
          case 'num':
            check(Number.isFinite(e.v), 'invalid literal');
            break;
          case 'shape':
            check(shapes.has(e.name), 'unbound shape ' + e.name);
            break;
          case 'read': {
            const ds = tensors.get(e.name);
            check(ds && ds.length === e.sub.length, 'invalid read ' + e.name);
            e.sub.forEach((a, i) => {
              aff(a, new Set(scope.keys()));
              let lo = constant(a.c),
                hi = lo;
              for (const [n, k] of a.t) {
                const last = plus(scope.get(n)!, constant(-1));
                if (k < 0) lo = plus(lo, last, k);
                else hi = plus(hi, last, k);
              }
              check(
                [...scope.values()].some(d => !d.t.length && d.c === 0) ||
                  (nonnegative(lo) && nonnegative(plus(plus(ds![i], constant(-1)), hi, -1))),
                'subscript not in bounds: ' + e.name,
              );
            });
            break;
          }
          case 'calc':
            check(arity.get(e.fn) === e.args.length, 'invalid operator');
            e.args.forEach(expr);
            break;
          case 'reduce':
            check(
              ['sum', 'max', 'blocked'].includes(e.fn) &&
                e.axes.length > 0 &&
                (e.fn !== 'blocked' || e.axes.length === 1),
              'invalid reduction',
            );
            e.axes.forEach(bind);
            expr(e.body);
            for (const a of e.axes) scope.delete(a.id);
            break;
          default:
            fail(at, 'invalid expression');
        }
      }
      expr(s.rhs);
      tensors.set(s.name, s.dims);
    }
    at = f.at;
    const out = tensors.get(f.ret);
    check(
      out && out.length === f.result.length && out.every((d, i) => same(d, f.result[i])),
      'return type mismatch',
    );
  }
}
