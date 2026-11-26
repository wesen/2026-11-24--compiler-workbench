import { fail, sameAffine, substituteAffine, variable } from './model.js';
import type { Affine, Binder, Expr, Location, TensorFunction, TensorIR } from './model.js';
import type { ParsedFunction } from './parse.js';

type ParsedExpr = ParsedFunction['statements'][number]['body'];
type Name = ParsedFunction['name'];
interface Inferred {
  id: string;
  extent?: Affine;
  at: Name;
}
type Scope = ReadonlyMap<string, Inferred>;

export const sameShape = (a: readonly Affine[], b: readonly Affine[]) =>
  a.length === b.length && a.every((extent, i) => sameAffine(extent, b[i]));

function checkType(dims: readonly Affine[], names: ReadonlySet<string>, at: Location) {
  for (const dim of dims) {
    for (const [name] of dim.terms) if (!names.has(name)) fail(at, `Unbound shape '${name}'`);
    if (dim.terms.length === 0 && BigInt(dim.constant) < 0n) fail(at, 'Negative tensor extent');
  }
}

function checkFunction(raw: ParsedFunction): TensorFunction {
  const params = raw.params.map(({ name, type }) => ({ name: name.text, shape: type.dims }));
  const shapeNames = new Set(raw.params.flatMap(({ type }) => type.names));
  const direct = new Set(
    params.flatMap(param => param.shape.flatMap(dim => (dim.terms.length === 1 ? [dim.terms[0][0]] : []))),
  );
  for (const name of shapeNames)
    if (!direct.has(name)) fail(raw.name, `Shape '${name}' needs a single-symbol input axis`);
  const tensors = new Map<string, readonly Affine[]>();

  for (const { name, type } of raw.params) {
    if (tensors.has(name.text)) fail(name, `Tensor '${name.text}' is already defined`);
    checkType(type.dims, shapeNames, type.at);
    tensors.set(name.text, type.dims);
  }
  checkType(raw.resultType.dims, shapeNames, raw.resultType.at);
  for (const name of raw.resultType.names)
    if (!shapeNames.has(name)) fail(raw.resultType.at, `Unbound shape '${name}'`);

  let nextBinder = 0;
  function enter(names: readonly Name[], parent: Scope): { scope: Scope; indices: Inferred[] } {
    const scope = new Map(parent);
    const seen = new Set<string>();
    const indices = names.map(at => {
      if (seen.has(at.text)) fail(at, `Duplicate index '${at.text}'`);
      seen.add(at.text);
      const slot: Inferred = { id: `i${nextBinder++}`, at };
      scope.set(at.text, slot);
      return slot;
    });
    return { scope, indices };
  }

  function resolveBinders(indices: readonly Inferred[], annotation?: readonly Affine[]): Binder[] {
    return indices.map(({ id, extent, at }, axis) => {
      const declared = annotation?.[axis];
      if (extent && declared && !sameAffine(extent, declared))
        fail(at, `Declared extent for '${at.text}' conflicts with its uses`);
      const resolved = extent ?? declared;
      if (!resolved) fail(at, `Cannot infer the extent of '${at.text}'`);
      return { id, extent: resolved };
    });
  }

  function resolve(expr: ParsedExpr, scope: Scope): Expr {
    switch (expr.kind) {
      case 'literal':
        return expr;
      case 'shape':
        if (!shapeNames.has(expr.name)) fail(expr.at, `Unbound shape '${expr.name}'`);
        return expr;
      case 'read': {
        const shape = tensors.get(expr.tensor);
        if (!shape) fail(expr.at, `Tensor '${expr.tensor}' is not defined before this use`);
        if (shape.length !== expr.coords.length) fail(expr.at, `Rank mismatch for '${expr.tensor}'`);
        const coords = expr.coords.map(({ affine, names, plain }, axis) => {
          for (const name of names) if (!scope.has(name)) fail(expr.at, `Unbound index '${name}'`);
          if (plain !== undefined) {
            const slot = scope.get(plain)!;
            if (slot.extent && !sameAffine(slot.extent, shape[axis]))
              fail(expr.at, `Conflicting extents for index '${plain}'`);
            slot.extent = shape[axis];
          }
          return substituteAffine(affine, name => variable(scope.get(name)!.id));
        });
        return { ...expr, coords };
      }
      case 'unary':
        return { ...expr, arg: resolve(expr.arg, scope) };
      case 'binary':
        return { ...expr, left: resolve(expr.left, scope), right: resolve(expr.right, scope) };
      case 'reduce': {
        const inner = enter(expr.binders, scope);
        const body = resolve(expr.body, inner.scope);
        return { ...expr, binders: resolveBinders(inner.indices), body };
      }
    }
  }

  const statements = raw.statements.map(({ name, indices, type, body }) => {
    if (tensors.has(name.text)) fail(name, `Tensor '${name.text}' is already defined`);
    if (type) {
      if (type.dims.length !== indices.length) fail(type.at, 'Statement rank differs from its annotation');
      for (const name of type.names) if (!shapeNames.has(name)) fail(type.at, `Unbound shape '${name}'`);
      checkType(type.dims, shapeNames, type.at);
    }
    const local = enter(indices, new Map());
    const checked = resolve(body, local.scope);
    const binders = resolveBinders(local.indices, type?.dims);
    tensors.set(
      name.text,
      binders.map(binder => binder.extent),
    );
    return { name: name.text, binders, body: checked };
  });

  const result = tensors.get(raw.result.text);
  if (!result) fail(raw.result, `Unknown return tensor '${raw.result.text}'`);
  if (!sameShape(result, raw.resultType.dims)) fail(raw.result, 'Returned tensor has a different shape');
  return {
    name: raw.name.text,
    shapeNames: [...shapeNames],
    params,
    resultShape: raw.resultType.dims,
    statements,
    result: raw.result.text,
  };
}

export function checkSource(raw: readonly ParsedFunction[]): TensorIR {
  const names = new Set<string>();
  return {
    functions: raw.map(fn => {
      if (names.has(fn.name.text)) fail(fn.name, `Function '${fn.name.text}' is already defined`);
      names.add(fn.name.text);
      return checkFunction(fn);
    }),
  };
}
