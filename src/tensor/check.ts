import { children, constant, equalAffine, fail, minus, plus, scale, substitute, variable } from './model.js';
import type { Affine, Axis, Expr, Loc, Named, Param, TensorFn, TensorModule } from './model.js';
import { numberText, parse } from './parse.js';
import type { RawExpr, RawSub } from './parse.js';

interface PendingAxis extends Named {
  id: string;
  extent?: Affine;
}
const sameShape = (a: readonly Affine[], b: readonly Affine[]): boolean =>
  a.length === b.length && a.every((d, i) => equalAffine(d, b[i]));

function unique(names: readonly Named[], kind: string): void {
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n.name)) fail(n.at, `duplicate ${kind} '${n.name}'`);
    seen.add(n.name);
  }
}

function requireName<V>(env: ReadonlyMap<string, V>, name: string, at: Loc, kind: string): V {
  return env.get(name) ?? fail(at, `unknown ${kind} '${name}'`);
}

function resolveBody(
  e: RawExpr,
  indices: ReadonlyMap<string, PendingAxis>,
  tensors: ReadonlyMap<string, Param>,
  shapeNames: ReadonlySet<string>,
): Expr {
  const sub = (e: RawExpr) => resolveBody(e, indices, tensors, shapeNames);
  switch (e.op) {
    case 'literal':
      return e;
    case 'shape':
      if (!shapeNames.has(e.name)) fail(e.at, `unknown shape name '${e.name}'`);
      return e;
    case 'load': {
      const t = requireName(tensors, e.tensor, e.at, 'tensor');
      if (t.shape.length !== e.subs.length) fail(e.at, `rank mismatch for '${t.name}'`);
      const subs = e.subs.map(({ form, at, names, plain }, i) => {
        for (const n of names) requireName(indices, n.name, n.at, 'index');
        if (plain !== undefined) {
          const axis = requireName(indices, plain, at, 'index');
          const extent = t.shape[i];
          if (axis.extent && !equalAffine(axis.extent, extent))
            fail(at, `inconsistent extents for index '${axis.name}'`);
          axis.extent = extent;
        }
        return substitute(form, name => variable(requireName(indices, name, at, 'index').id), at);
      });
      return { ...e, subs, tensor: t.id };
    }
    case 'sum':
    case 'max': {
      unique(e.axes, 'reduction index');
      const axes: PendingAxis[] = e.axes.map((a, i) => ({ ...a, id: `${e.id}:r${i}` }));
      const local = new Map(indices);
      for (const a of axes) local.set(a.name, a);
      const body = resolveBody(e.body, local, tensors, shapeNames);
      return { ...e, axes: requireExtents(axes), body };
    }
    case 'blockedSum':
      return fail(e.at, 'blockedSum is not a source expression');
    case 'neg':
      return { ...e, arg: sub(e.arg) };
    case '+':
    case '-':
    case '*':
    case '/':
      return { ...e, left: sub(e.left), right: sub(e.right) };
    case 'call':
      return { ...e, args: e.args.map(sub) };
  }
}

function requireExtents(axes: readonly PendingAxis[]): readonly Axis[] {
  return axes.map(a => ({
    ...a,
    extent: a.extent ?? fail(a.at, `cannot infer extent of index '${a.name}'`),
  }));
}

export function checkSource(source: string): TensorModule {
  const fns = parse(source);
  unique(fns, 'function');
  const functions = fns.map((f, i): TensorFn => {
    const id = `f${i}`;
    const shapeNames = new Set(f.params.flatMap(p => p.shape.flatMap(d => d.names.map(n => n.name))));
    const shape = (dims: readonly RawSub[]) =>
      dims.map(d => {
        for (const n of d.names) if (!shapeNames.has(n.name)) fail(n.at, `unknown shape name '${n.name}'`);
        if (!d.form.terms.length && d.form.c < 0) fail(d.at, 'negative extent');
        return d.form;
      });
    unique([...f.params, ...f.statements], 'tensor definition');
    const params = f.params.map(({ name, at, shape: types }, j) => ({
      name,
      at,
      id: `${id}:p${j}`,
      shape: shape(types),
    }));
    const tensors = new Map(params.map(p => [p.name, p]));
    const statements = f.statements.map((s, j) => {
      const sid = `${id}:s${j}`;
      unique(s.axes, 'output index');
      const declared = s.shape && shape(s.shape);
      if (declared && declared.length !== s.axes.length) fail(s.at, 'rank mismatch in statement type');
      const axes: PendingAxis[] = s.axes.map((a, k) => ({ ...a, id: `${sid}:a${k}`, extent: declared?.[k] }));
      const expr = resolveBody(s.expr, new Map(axes.map(a => [a.name, a])), tensors, shapeNames);
      const resolved = requireExtents(axes);
      const statement = {
        name: s.name,
        at: s.at,
        id: sid,
        axes: resolved,
        shape: resolved.map(a => a.extent),
        expr,
      };
      tensors.set(s.name, statement);
      return statement;
    });
    const result = requireName(tensors, f.result.name, f.result.at, 'return tensor');
    const resultShape = shape(f.resultShape);
    if (!sameShape(resultShape, result.shape))
      fail(f.result.at, 'return tensor shape does not match signature');
    return {
      name: f.name,
      at: f.at,
      id,
      shapes: [...shapeNames],
      params,
      statements,
      result: result.id,
      resultShape,
    };
  });
  return { functions };
}

/** An isolated input axis gives an integer binding without solving a coupled system. */
export function shapeAnchors(fn: TensorFn): Map<string, { param: Param; axis: number }> {
  const anchors = new Map<string, { param: Param; axis: number }>();
  for (const param of fn.params)
    param.shape.forEach((d, axis) => {
      if (d.terms.length !== 1) return;
      const [name, coefficient] = d.terms[0];
      if (!anchors.has(name) || (d.c === 0 && coefficient === 1)) anchors.set(name, { param, axis });
    });
  for (const name of fn.shapes)
    if (!anchors.has(name)) fail(fn.at, `no isolating input axis for shape '${name}'`);
  return anchors;
}

/** Sufficient affine proof using an orthant and at most two known nonnegative forms. */
function nonnegative(q: Affine, facts: readonly Affine[], at: Loc, depth = 2): boolean {
  if (q.c >= 0 && q.terms.every(([, n]) => n >= 0)) return true;
  if (depth === 0) return false;
  return facts.some(f => {
    // Try a fact only if it cancels part of a negative coefficient or constant.
    if (
      !(q.c < 0 && f.c < 0) &&
      !f.terms.some(([key, n]) => n < 0 && q.terms.some(([k, m]) => k === key && m < 0))
    )
      return false;
    return nonnegative(minus(q, f, at), facts, at, depth - 1);
  });
}

export class AffineBoundsError extends Error {
  constructor(at: Loc, message: string) {
    super(`${at.line}:${at.col}: ${message}`);
  }
}

function checkLoad(
  e: Extract<Expr, { op: 'load' }>,
  axes: ReadonlyMap<string, Axis>,
  t: Param,
  facts: Affine[],
): void {
  if (e.subs.length !== t.shape.length) fail(e.at, `rank mismatch for '${t.name}'`);
  for (const sub of e.subs) checkForm(sub, id => axes.has(id), e.at);
  const active = [...axes.values()].map(a => minus(a.extent, constant(1), a.at));
  if (active.some(d => d.c < 0 && !d.terms.length)) return;
  const assumptions = [...facts, ...active];
  e.subs.forEach((sub, i) => {
    let lo = constant(sub.c),
      hi = lo;
    for (const [id, n] of sub.terms) {
      const a = axes.get(id)!;
      const v = scale(minus(a.extent, constant(1), a.at), n, e.at);
      if (n < 0) lo = plus(lo, v, e.at);
      else hi = plus(hi, v, e.at);
    }
    const slack = minus(minus(t.shape[i], constant(1), e.at), hi, e.at);
    if (!nonnegative(lo, assumptions, e.at) || !nonnegative(slack, assumptions, e.at))
      throw new AffineBoundsError(e.at, `cannot prove affine subscript ${i + 1} in bounds of '${t.name}'`);
  });
}

function checkForm(a: Affine, key: (name: string) => boolean, at: Loc): void {
  if (!a || !Number.isSafeInteger(a.c) || !Array.isArray(a.terms)) fail(at, 'invalid affine form');
  let previous = '';
  for (const [name, n] of a.terms) {
    if (typeof name !== 'string' || previous >= name || !key(name) || !Number.isSafeInteger(n) || n === 0)
      fail(at, `invalid affine term '${name}'`);
    previous = name;
  }
}

/** Native validation is shared by the adapter and framework contract IR port. */
export function validateModule(m: TensorModule): void {
  if (!m || !Array.isArray(m.functions) || !m.functions.length)
    throw new Error('expected a nonempty Tix module');
  const ids = new Set<string>();
  const add = ({ id, at }: { id: string; at: Loc }) => {
    if (!Number.isSafeInteger(at?.line) || !Number.isSafeInteger(at?.col) || at.line < 1 || at.col < 1)
      throw new Error('invalid Tix source location');
    if (typeof id !== 'string' || !id || ids.has(id)) fail(at, `invalid or duplicate entity '${id}'`);
    ids.add(id);
  };
  unique(m.functions, 'function');
  for (const f of m.functions as readonly TensorFn[]) {
    add(f);
    const shapeNames = new Set(f.shapes);
    if (shapeNames.size !== f.shapes.length || !f.params.length) fail(f.at, 'invalid signature');
    const extent = (d: Affine, at: Loc) => {
      checkForm(d, n => shapeNames.has(n), at);
      if (d.c < 0 && !d.terms.length) fail(at, 'negative extent');
    };
    const tensors = new Map<string, Param>();
    const facts: Affine[] = [];
    const addTensor = (t: Param) => {
      add(t);
      if (!t.shape.length) fail(t.at, 'empty tensor rank');
      for (const d of t.shape) extent(d, t.at);
      tensors.set(t.id, t);
      facts.push(...t.shape);
    };
    unique([...f.params, ...f.statements], 'tensor definition');
    for (const t of f.params) addTensor(t);
    shapeAnchors(f);
    const withAxes = (env: ReadonlyMap<string, Axis>, axes: readonly Axis[]) => {
      if (!axes.length) fail(f.at, 'missing index binders');
      unique(axes, 'index');
      const next = new Map(env);
      for (const a of axes) {
        add(a);
        extent(a.extent, a.at);
        next.set(a.id, a);
      }
      return next;
    };
    const body = (e: Expr, env: ReadonlyMap<string, Axis>): void => {
      add(e);
      switch (e.op) {
        case 'literal':
          if (typeof e.text !== 'string' || !numberText.test(e.text)) fail(e.at, 'invalid literal');
          return;
        case 'shape':
          if (!shapeNames.has(e.name)) fail(e.at, 'unknown shape name');
          return;
        case 'load':
          checkLoad(e, env, requireName(tensors, e.tensor, e.at, 'tensor'), facts);
          return;
        case 'sum':
        case 'max':
          body(e.body, withAxes(env, e.axes));
          return;
        case 'blockedSum':
          if (!Number.isSafeInteger(e.blockSize) || e.blockSize <= 0) fail(e.at, 'invalid block size');
          body(e.body, withAxes(env, [e.axis]));
          return;
        case 'call': {
          const arity =
            e.fn === 'max' || e.fn === 'min' ? 2 : ['exp', 'log', 'sqrt', 'tanh'].includes(e.fn) ? 1 : 0;
          if (!arity || e.args.length !== arity) fail(e.at, 'invalid intrinsic call');
          break;
        }
        case '+':
        case '-':
        case '*':
        case '/':
        case 'neg':
          break;
        default:
          fail((e as Expr).at, 'unknown expression kind');
      }
      for (const child of children(e)) body(child, env);
    };
    for (const s of f.statements) {
      const env = withAxes(new Map(), s.axes);
      if (
        !sameShape(
          s.axes.map(a => a.extent),
          s.shape,
        )
      )
        fail(s.at, 'statement axis shape mismatch');
      body(s.expr, env);
      addTensor(s);
    }
    for (const d of f.resultShape) extent(d, f.at);
    const result = requireName(tensors, f.result, f.at, 'return tensor');
    if (!sameShape(result.shape, f.resultShape)) fail(f.at, 'return tensor shape does not match signature');
  }
}
