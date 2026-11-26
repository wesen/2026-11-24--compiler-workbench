import {
  affineSum,
  constant,
  fail,
  plainIndex,
  sameAffine,
  statementShape,
  type Affine,
  type Anchor,
  type Binder,
  type Expr,
  type Location,
  type Parameter,
  type Statement,
  type TensorIR,
  type TixFunction,
} from './model.js';
import type { SourceFunction, SourceStatement } from './parse.js';

type Shapes = ReadonlyMap<string, readonly Affine[]>;
type PendingBinder = { id: string; extent?: Affine };

function anchorsFor(params: readonly Parameter[]): Anchor[] {
  const mentioned = new Map<string, Location>();
  const anchors = new Map<string, Anchor>();
  params.forEach((param, paramIndex) =>
    param.shape.forEach((dim, axis) => {
      for (const [name] of dim.terms) mentioned.set(name, param.at);
      if (dim.terms.length !== 1) return;
      const name = dim.terms[0]![0];
      const previous = anchors.get(name);
      if (
        !previous ||
        (plainIndex(dim) === name && plainIndex(params[previous.param]!.shape[previous.axis]!) !== name)
      )
        anchors.set(name, { name, param: paramIndex, axis });
    }),
  );
  return [...mentioned.keys()]
    .sort()
    .map(
      name =>
        anchors.get(name) ??
        fail(mentioned.get(name)!, `shape name "${name}" needs a single-name parameter dimension`),
    );
}

function sameShape(left: readonly Affine[], right: readonly Affine[]): boolean {
  return left.length === right.length && left.every((dim, axis) => sameAffine(dim, right[axis]!));
}

function shapeOf(shapes: Shapes, tensor: string, at: Location): readonly Affine[] {
  return shapes.get(tensor) ?? fail(at, `unknown tensor "${tensor}"`);
}

function resolveStatement(source: SourceStatement, shapes: Shapes, nextIndex: () => string): Statement {
  const scope = new Map<string, PendingBinder>();
  function bind(names: readonly string[], at: Location, inScope: Map<string, PendingBinder>) {
    const seen = new Set<string>();
    return names.map(name => {
      if (seen.has(name)) fail(at, `duplicate index "${name}"`);
      seen.add(name);
      const pending = { id: nextIndex() };
      inScope.set(name, pending);
      return pending as PendingBinder;
    });
  }
  function finish(pending: PendingBinder, name: string, at: Location): Binder {
    return { id: pending.id, extent: pending.extent ?? fail(at, `cannot infer extent of index "${name}"`) };
  }
  function resolve(expr: Expr<string>, indices: Map<string, PendingBinder>): Expr {
    switch (expr.kind) {
      case 'ref': {
        const shape = shapeOf(shapes, expr.tensor, expr.at);
        if (shape.length !== expr.indices.length) fail(expr.at, `rank mismatch for "${expr.tensor}"`);
        const offsets = expr.indices.map((index, axis) => {
          const plain = plainIndex(index);
          if (plain !== undefined) {
            const binder = indices.get(plain) ?? fail(expr.at, `unbound index "${plain}"`);
            const extent = shape[axis]!;
            if (binder.extent && !sameAffine(binder.extent, extent))
              fail(expr.at, `inconsistent extents for index "${plain}"`);
            binder.extent = extent;
          }
          return {
            constant: index.constant,
            terms: index.terms
              .map(
                ([name, coefficient]) =>
                  [(indices.get(name) ?? fail(expr.at, `unbound index "${name}"`)).id, coefficient] as const,
              )
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          };
        });
        return { ...expr, indices: offsets };
      }
      case 'primitive':
        return { ...expr, args: expr.args.map(arg => resolve(arg, indices)) };
      case 'reduce': {
        const nested = new Map(indices);
        const pending = bind(expr.axes, expr.at, nested);
        const body = resolve(expr.body, nested);
        return { ...expr, axes: pending.map((axis, i) => finish(axis, expr.axes[i]!, expr.at)), body };
      }
      case 'blocked-sum':
        fail(expr.at, 'blocked sum is an internal expression');
      default:
        return expr;
    }
  }

  const axes = bind(source.axes, source.at, scope);
  if (source.shape) {
    if (source.shape.length !== axes.length) fail(source.at, 'rank mismatch in tensor annotation');
    axes.forEach((axis, index) => {
      axis.extent = source.shape![index];
    });
  }
  const expr = resolve(source.expr, scope);
  return {
    name: source.name,
    at: source.at,
    axes: axes.map((axis, index) => finish(axis, source.axes[index]!, source.at)),
    expr,
  };
}

export function checkSource(functions: readonly SourceFunction[]): TensorIR {
  const value = {
    functions: functions.map(source => {
      const shapes = new Map<string, readonly Affine[]>(
        source.params.map(param => [param.name, param.shape]),
      );
      const anchors = anchorsFor(source.params);
      let index = 0;
      const statements = source.statements.map(statement => {
        if (shapes.has(statement.name)) fail(statement.at, `tensor "${statement.name}" is already defined`);
        const resolved = resolveStatement(statement, shapes, () => `i${index++}`);
        shapes.set(statement.name, statementShape(resolved));
        return resolved;
      });
      return { ...source, anchors, statements };
    }),
  };
  return value;
}

type ShapeFact = { affine: Affine; min: number };

function boundsFor(facts: readonly ShapeFact[]) {
  const result = new Map<string, { low: bigint; high: bigint }>();
  let possible = true;
  for (const { affine, min } of facts) {
    if (affine.terms.length === 0) {
      if (affine.constant < min) possible = false;
      continue;
    }
    if (affine.terms.length !== 1) continue;
    const [name, coefficient] = affine.terms[0]!;
    const bound = result.get(name) ?? { low: 0n, high: BigInt(Number.MAX_SAFE_INTEGER) };
    const distance = BigInt(min) - BigInt(affine.constant);
    const step = BigInt(Math.abs(coefficient));
    if (coefficient > 0 && distance > 0n) {
      const low = (distance + step - 1n) / step;
      if (low > bound.low) bound.low = low;
    } else if (coefficient < 0) {
      const high = distance > 0n ? -1n : -distance / step;
      if (high < bound.high) bound.high = high;
    }
    if (bound.low > bound.high) possible = false;
    result.set(name, bound);
  }
  return { possible, result };
}

function proveBounds(
  expr: Extract<Expr, { kind: 'ref' }>,
  shape: readonly Affine[],
  active: ReadonlyMap<string, Affine>,
  shapeFacts: readonly ShapeFact[],
) {
  for (const index of expr.indices)
    for (const [name] of index.terms) if (!active.has(name)) fail(expr.at, `unbound index "${name}"`);
  const facts = [...shapeFacts, ...[...active.values()].map(affine => ({ affine, min: 1 }))];
  const bounds = boundsFor(facts);
  if (!bounds.possible) return;

  function nonnegative(affine: Affine) {
    if (facts.some(fact => sameAffine(fact.affine, affine))) return true;
    let low = BigInt(affine.constant);
    for (const [name, coefficient] of affine.terms) {
      const bound = bounds.result.get(name);
      low +=
        BigInt(coefficient) *
        (coefficient > 0 ? (bound?.low ?? 0n) : (bound?.high ?? BigInt(Number.MAX_SAFE_INTEGER)));
    }
    return low >= 0n;
  }

  expr.indices.forEach((access, axis) => {
    const minTerms: [Affine, number][] = [[constant(access.constant), 1]];
    const maxTerms: [Affine, number][] = [[constant(access.constant), 1]];
    for (const [name, coefficient] of access.terms) {
      const range = affineSum(expr.at, [
        [active.get(name)!, 1],
        [constant(1), -1],
      ]);
      (coefficient < 0 ? minTerms : maxTerms).push([range, coefficient]);
    }
    const room = affineSum(expr.at, [
      [shape[axis]!, 1],
      [constant(1), -1],
      ...maxTerms.map(([term, factor]) => [term, -factor] as const),
    ]);
    if (!nonnegative(affineSum(expr.at, minTerms)) || !nonnegative(room))
      fail(expr.at, `cannot establish bounds for "${expr.tensor}" axis ${axis + 1}`);
  });
}

function validateFunction(fn: TixFunction): void {
  const names = new Set(fn.anchors.map(anchor => anchor.name));
  const actualAnchors = anchorsFor(fn.params);
  if (
    actualAnchors.length !== fn.anchors.length ||
    actualAnchors.some((a, i) => {
      const b = fn.anchors[i]!;
      return a.name !== b.name || a.axis !== b.axis || a.param !== b.param;
    })
  )
    fail(fn.at, 'invalid shape anchors');

  function checkShape(shape: readonly Affine[], at: Location) {
    if (!shape.length) fail(at, 'expected a tensor shape');
    for (const dim of shape) {
      if (
        !Number.isSafeInteger(dim.constant) ||
        dim.terms.some(
          ([name, coefficient], index) =>
            !names.has(name) ||
            !Number.isSafeInteger(coefficient) ||
            !coefficient ||
            (index > 0 && name <= dim.terms[index - 1]![0]),
        )
      )
        fail(at, 'invalid affine dimension or unbound shape name');
      if (!dim.terms.length && dim.constant < 0) fail(at, 'negative tensor extent');
    }
  }

  if (!fn.params.length) fail(fn.at, 'expected at least one parameter');
  const tensors = new Map<string, readonly Affine[]>();
  for (const param of fn.params) {
    if (tensors.has(param.name)) fail(param.at, `tensor "${param.name}" is already defined`);
    checkShape(param.shape, param.at);
    tensors.set(param.name, param.shape);
  }
  checkShape(fn.result, fn.at);
  const facts = [...tensors.values(), ...fn.statements.map(statementShape), fn.result].flatMap(shape =>
    shape.map(affine => ({ affine, min: 0 })),
  );
  if (!boundsFor(facts).possible) fail(fn.at, 'inconsistent tensor dimensions');

  function extend(active: ReadonlyMap<string, Affine>, axes: readonly Binder[], at: Location) {
    checkShape(
      axes.map(axis => axis.extent),
      at,
    );
    const nested = new Map(active);
    for (const axis of axes) {
      if (nested.has(axis.id)) fail(at, 'duplicate IR binder');
      nested.set(axis.id, axis.extent);
    }
    return nested;
  }

  function checkExpr(expr: Expr, active: ReadonlyMap<string, Affine>): void {
    switch (expr.kind) {
      case 'number':
        if (!Number.isFinite(expr.value)) fail(expr.at, 'invalid number in IR');
        return;
      case 'shape':
        if (!names.has(expr.name)) fail(expr.at, `unbound shape name "${expr.name}"`);
        return;
      case 'ref': {
        const shape = shapeOf(tensors, expr.tensor, expr.at);
        if (shape.length !== expr.indices.length) fail(expr.at, `rank mismatch for "${expr.tensor}"`);
        for (const index of expr.indices) {
          if (
            !Number.isSafeInteger(index.constant) ||
            index.terms.some(
              ([name, coefficient], order) =>
                !Number.isSafeInteger(coefficient) ||
                !coefficient ||
                (order > 0 && name <= index.terms[order - 1]![0]),
            )
          )
            fail(expr.at, 'invalid affine index');
        }
        proveBounds(expr, shape, active, facts);
        return;
      }
      case 'primitive': {
        const unary = ['neg', 'exp', 'log', 'sqrt', 'tanh'].includes(expr.op);
        const binary = ['+', '-', '*', '/', 'min', 'max'].includes(expr.op);
        if (!((unary && expr.args.length === 1) || (binary && expr.args.length === 2)))
          fail(expr.at, 'invalid primitive in IR');
        expr.args.forEach(arg => checkExpr(arg, active));
        return;
      }
      case 'reduce':
        if (expr.op !== 'sum' && expr.op !== 'max') fail(expr.at, 'invalid reduction in IR');
        checkExpr(expr.body, extend(active, expr.axes, expr.at));
        return;
      case 'blocked-sum':
        if (!Number.isSafeInteger(expr.block) || expr.block < 1) fail(expr.at, 'invalid sum block width');
        checkExpr(expr.body, extend(active, [expr.axis], expr.at));
        return;
      default:
        throw new Error('Invalid tensor expression kind');
    }
  }

  for (const statement of fn.statements) {
    if (tensors.has(statement.name)) fail(statement.at, `tensor "${statement.name}" is already defined`);
    checkExpr(statement.expr, extend(new Map(), statement.axes, statement.at));
    tensors.set(statement.name, statementShape(statement));
  }
  if (!sameShape(fn.result, shapeOf(tensors, fn.returns, fn.returnAt)))
    fail(fn.returnAt, 'returned tensor does not match the declared type');
}

export function validateTensorIR(value: unknown): asserts value is TensorIR {
  const program = value as TensorIR;
  if (!program || !Array.isArray(program.functions) || !program.functions.length)
    throw new Error('Expected a tensor program with at least one function');
  const seen = new Set<string>();
  for (const fn of program.functions as readonly TixFunction[]) {
    if (
      !fn ||
      typeof fn.name !== 'string' ||
      !fn.name ||
      !Array.isArray(fn.params) ||
      !Array.isArray(fn.statements) ||
      !Array.isArray(fn.anchors) ||
      !Array.isArray(fn.result)
    )
      throw new Error('Invalid tensor function in IR');
    if (seen.has(fn.name)) fail(fn.at, `function "${fn.name}" is already defined`);
    seen.add(fn.name);
    validateFunction(fn);
  }
}
