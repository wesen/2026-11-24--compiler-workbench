/**
 * The Tix checker (IRWB-020): shapes, index extents and single assignment, and the lowering to the IR.
 *
 * Every index gets an extent that is affine in the function's shape names: from its plain uses (a whole subscript),
 * or, for a left-hand index, from the statement's declared type. Affine subscripts are proved in bounds for every
 * binding of the shape names to values of at least 1 (a sufficient test: the slack to each bound is an affine form
 * with non-negative coefficients and a non-negative value at all ones).
 */
import {
  aff,
  affAdd,
  affEqual,
  affName,
  affPlain,
  affScale,
  affText,
  extAff,
  type Aff,
  type CallName,
  type Expr,
  type Fn,
  type Index,
  type Param,
  type Stmt,
  type TixIR,
} from './ir.js';
import { parseTix, TixError, type AExpr, type AFn, type AType, type Named, type Pos } from './syntax.js';

/** An index while its statement is checked: the extent is found at its first plain use. */
interface Binder {
  readonly name: string;
  readonly pos: Pos;
  extent?: Aff;
}

/** An affine form over the names `allowed` accepts (it throws for the others). */
function toAff(e: AExpr, allowed: (n: Named) => void): Aff {
  switch (e.k) {
    case 'num':
      if (!Number.isInteger(e.value) || !/^[0-9]+$/.test(e.text))
        throw new TixError(e.pos, `expected an integer, found ${e.text}`);
      return aff(e.value);
    case 'name':
      allowed({ name: e.name, pos: e.pos });
      return affName(e.name);
    case 'neg':
      return affScale(toAff(e.a, allowed), -1);
    case 'bin': {
      const a = toAff(e.a, allowed),
        b = toAff(e.b, allowed);
      if (e.op === '+') return affAdd(a, b);
      if (e.op === '-') return affAdd(a, b, -1);
      const constant = (x: Aff) => Object.keys(x.terms).length === 0;
      if (e.op === '*' && constant(a)) return affScale(b, a.c);
      if (e.op === '*' && constant(b)) return affScale(a, b.c);
      throw new TixError(e.pos, `not an affine expression: '${e.op}' needs an integer factor`);
    }
    default:
      throw new TixError(e.pos, 'not an affine expression');
  }
}

/** True when the form is at least 0 for every binding of its names to values of at least 1 (sufficient test). */
function nonNegative(a: Aff): boolean {
  let atOnes = a.c;
  for (const k of Object.values(a.terms)) {
    if (k < 0) return false;
    atOnes += k;
  }
  return atOnes >= 0;
}

function checkFn(f: AFn): Fn {
  // shape names: every name in a parameter's dims; each must be a whole dim somewhere, which binds it at a call
  const shapes = new Map<string, Pos>(),
    bound = new Set<string>();
  const tensors = new Map<string, readonly Aff[]>();
  const params: Param[] = [];
  for (const p of f.params) {
    const dims = p.type.dims.map(d => toAff(d, n => void (shapes.has(n.name) || shapes.set(n.name, n.pos))));
    for (const d of dims) {
      const plain = affPlain(d);
      if (plain) bound.add(plain);
    }
    if (tensors.has(p.name)) throw new TixError(p.pos, `parameter '${p.name}' is defined twice`);
    tensors.set(p.name, dims);
    params.push({ name: p.name, dims });
  }
  for (const [n, pos] of shapes) {
    if (!bound.has(n))
      throw new TixError(
        pos,
        `shape name '${n}' is never a whole dim of a parameter, so a call cannot bind it`,
      );
    if (tensors.has(n)) throw new TixError(pos, `'${n}' names both a shape and a parameter`);
  }
  const shapeAff = (t: AType): Aff[] =>
    t.dims.map(d =>
      toAff(d, n => {
        if (!shapes.has(n.name)) throw new TixError(n.pos, `unknown shape name '${n.name}'`);
      }),
    );
  const dimsText = (dims: readonly Aff[]) => `[${dims.map(affText).join(', ')}]`;

  const stmts: Stmt[] = [];
  for (const s of f.stmts) {
    if (tensors.has(s.name)) throw new TixError(s.pos, `'${s.name}' is already defined (single assignment)`);
    if (shapes.has(s.name)) throw new TixError(s.pos, `'${s.name}' is a shape name`);
    const declared = s.type ? shapeAff(s.type) : undefined;
    if (declared && declared.length !== s.indices.length)
      throw new TixError(
        s.type!.pos,
        `'${s.name}' has ${s.indices.length} indices but its type has ${declared.length} dims`,
      );

    const scope = new Map<string, Binder>();
    const bind = (n: Named): Binder => {
      if (scope.has(n.name)) throw new TixError(n.pos, `index '${n.name}' is already bound`);
      if (shapes.has(n.name)) throw new TixError(n.pos, `'${n.name}' is a shape name and cannot be an index`);
      if (tensors.has(n.name) || n.name === s.name)
        throw new TixError(n.pos, `'${n.name}' is a tensor and cannot be an index`);
      const b: Binder = { name: n.name, pos: n.pos };
      scope.set(n.name, b);
      return b;
    };
    /** Bounds of affine subscripts, proved once every extent in scope at the use is known. */
    const pending: (() => void)[] = [];

    const lower = (e: AExpr): Expr => {
      switch (e.k) {
        case 'num':
          if (!Number.isFinite(e.value)) throw new TixError(e.pos, `number ${e.text} is not finite`);
          return { k: 'lit', value: e.value };
        case 'name':
          if (shapes.has(e.name)) return { k: 'shape', name: e.name };
          if (tensors.has(e.name) || scope.has(e.name))
            throw new TixError(e.pos, `'${e.name}' is not a shape name; a tensor needs subscripts`);
          throw new TixError(e.pos, `unknown shape name '${e.name}'`);
        case 'neg':
          return { k: 'neg', a: lower(e.a) };
        case 'bin':
          return { k: 'bin', op: e.op, a: lower(e.a), b: lower(e.b) };
        case 'call':
          return { k: 'call', fn: e.fn as CallName, args: e.args.map(lower) };
        case 'ref': {
          const dims = tensors.get(e.name);
          if (!dims)
            throw new TixError(
              e.pos,
              e.name === s.name ? `'${e.name}' is read in its own definition` : `unknown tensor '${e.name}'`,
            );
          if (dims.length !== e.subs.length)
            throw new TixError(e.pos, `'${e.name}' has ${dims.length} dims but ${e.subs.length} subscripts`);
          const at = e.subs.map((sub, k) => {
            const a = toAff(sub, n => {
              if (!scope.has(n.name)) throw new TixError(n.pos, `unknown index '${n.name}'`);
            });
            const plain = affPlain(a);
            if (plain) {
              const b = scope.get(plain)!;
              if (!b.extent) b.extent = dims[k];
              else if (!affEqual(b.extent, dims[k]))
                throw new TixError(
                  sub.pos,
                  `inconsistent shapes: index '${plain}' ranges over ${affText(b.extent)} but dim ${k} of '${e.name}' is ${affText(dims[k])}`,
                );
              return a;
            }
            const binders = Object.keys(a.terms).map(n => scope.get(n)!);
            pending.push(() => {
              // the largest and smallest value of the subscript over the index extents, affine in the shape names
              let hi = aff(a.c),
                lo = aff(a.c);
              for (const b of binders) {
                const k2 = a.terms[b.name],
                  last = affAdd(b.extent!, aff(1), -1);
                if (k2 > 0) hi = affAdd(hi, last, k2);
                else lo = affAdd(lo, last, k2);
              }
              if (!nonNegative(lo) || !nonNegative(affAdd(affAdd(dims[k], aff(1), -1), hi, -1)))
                throw new TixError(
                  sub.pos,
                  `subscript may be out of bounds: it ranges over ${affText(lo)} .. ${affText(hi)} in dim ${k} of '${e.name}', which is ${affText(dims[k])}`,
                );
            });
            return a;
          });
          return { k: 'ref', tensor: e.name, at };
        }
        case 'reduce': {
          const binders = e.indices.map(bind);
          const body = lower(e.body);
          const indices: Index[] = binders.map(b => {
            if (!b.extent)
              throw new TixError(
                b.pos,
                `the extent of index '${b.name}' cannot be inferred: it has no plain use`,
              );
            return { name: b.name, extent: extAff(b.extent) };
          });
          // the bounds of subscripts under this reduction need its extents, which are final now
          for (const b of binders) scope.delete(b.name);
          return { k: 'reduce', op: e.op, indices, body };
        }
      }
    };

    const lhs = s.indices.map(bind);
    const expr = lower(s.expr);
    const indices: Index[] = lhs.map((b, k) => {
      const typed = declared?.[k];
      if (b.extent && typed && !affEqual(b.extent, typed))
        throw new TixError(
          b.pos,
          `inconsistent shapes: index '${b.name}' ranges over ${affText(b.extent)} but the declared type says ${affText(typed)}`,
        );
      const extent = b.extent ?? typed;
      if (!extent)
        throw new TixError(
          b.pos,
          `the extent of index '${b.name}' cannot be inferred: it has no plain use and '${s.name}' has no declared type`,
        );
      b.extent = extent;
      return { name: b.name, extent: extAff(extent) };
    });
    for (const prove of pending) prove();
    tensors.set(
      s.name,
      indices.map(i => (i.extent as { aff: Aff }).aff),
    );
    stmts.push({ name: s.name, indices, expr });
  }

  const result = shapeAff(f.result);
  const returned = tensors.get(f.ret.name);
  if (!returned) throw new TixError(f.ret.pos, `unknown tensor '${f.ret.name}'`);
  if (returned.length !== result.length || returned.some((d, k) => !affEqual(d, result[k])))
    throw new TixError(
      f.ret.pos,
      `inconsistent shapes: '${f.ret.name}' is f32${dimsText(returned)} but the function returns f32${dimsText(result)}`,
    );
  return { name: f.name, shapes: [...shapes.keys()].sort(), params, stmts, result: f.ret.name };
}

/** Parse and check a Tix program. Throws `TixError` (`line:col: text`) on invalid source. */
export function checkTix(source: string): TixIR {
  const fns: Record<string, Fn> = {};
  for (const f of parseTix(source)) {
    if (Object.hasOwn(fns, f.name)) throw new TixError(f.pos, `function '${f.name}' is defined twice`);
    fns[f.name] = checkFn(f);
  }
  return { fns };
}
