import { add, constant, equalAffine, equalShape, sourceError, variable } from './model.js';
import type {
  Affine,
  Binder,
  Expression,
  Location,
  ShapeWitness,
  Statement,
  TensorFunction,
  TensorModule,
} from './model.js';
import type { AstExpression, AstFunction, Axis, Name } from './parse.js';

interface PendingBinder {
  readonly id: string;
  readonly name: Name;
  extent?: Affine;
}

interface Access {
  readonly tensor: string;
  readonly shape: readonly Affine[];
  readonly indices: readonly Affine[];
  readonly enclosing: readonly PendingBinder[];
  readonly at: readonly Axis[];
}

function checkType(axes: readonly Axis[], known: ReadonlySet<string>): Affine[] {
  return axes.map(({ value, at }) => {
    if (!value.terms.length && value.constant < 0) sourceError(at, 'negative tensor extent');
    for (const { name } of value.terms)
      if (!known.has(name)) sourceError(at, `shape name '${name}' has no input binding`);
    return value;
  });
}

function shapeWitnesses(fn: AstFunction, names: ReadonlySet<string>): ShapeWitness[] {
  const remaining = new Set(names);
  const witnesses: ShapeWitness[] = [];
  while (remaining.size) {
    let progress = false;
    fn.parameters.forEach(({ type }, parameter) => {
      type.axes.forEach(({ value }, axis) => {
        const unknown = value.terms.filter(t => remaining.has(t.name));
        if (unknown.length !== 1) return;
        const [{ name }] = unknown;
        witnesses.push({ name, parameter, axis });
        remaining.delete(name);
        progress = true;
      });
    });
    if (!progress) {
      const name = [...remaining][0];
      const axis = fn.parameters
        .flatMap(p => p.type.axes)
        .find(a => a.value.terms.some(t => t.name === name))!;
      sourceError(axis.at, `cannot bind shape name '${name}' from a parameter axis`);
    }
  }
  return witnesses;
}

function resolved(binder: PendingBinder): Binder {
  if (binder.extent === undefined)
    sourceError(binder.name, `cannot infer extent of index '${binder.name.text}'`);
  return { id: binder.id, extent: binder.extent };
}

function manifestlyNonnegative(value: Affine): boolean {
  return value.constant >= 0 && value.terms.every(term => term.coefficient > 0);
}

function nonnegative(value: Affine, known: readonly Affine[]): boolean {
  if (manifestlyNonnegative(value)) return true;
  return known.some(fact => manifestlyNonnegative(add(value, fact, -1)));
}

function checkBounds(access: Access, parameterAxes: readonly Affine[]): void {
  const binders = access.enclosing.map(resolved);
  if (binders.some(({ extent }) => !extent.terms.length && extent.constant === 0)) return;
  const last = new Map(binders.map(b => [b.id, add(b.extent, constant(-1))]));
  const nonnegativeFacts = [...parameterAxes, ...access.shape, ...last.values()];

  access.indices.forEach((index, axis) => {
    const at = access.at[axis].at;
    try {
      let minimum = constant(index.constant);
      let maximum = minimum;
      for (const term of index.terms) {
        if (term.coefficient < 0) minimum = add(minimum, last.get(term.name)!, term.coefficient);
        else maximum = add(maximum, last.get(term.name)!, term.coefficient);
      }
      const margin = add(add(access.shape[axis], constant(-1)), maximum, -1);
      if (nonnegative(minimum, nonnegativeFacts) && nonnegative(margin, nonnegativeFacts)) return;
    } catch (error) {
      sourceError(at, (error as Error).message);
    }
    sourceError(at, `cannot establish bounds for axis ${axis + 1} of '${access.tensor}'`);
  });
}

function checkFunction(ast: AstFunction): TensorFunction {
  const shapeNames = new Set(
    ast.parameters.flatMap(p => p.type.axes.flatMap(axis => axis.value.terms.map(term => term.name))),
  );
  const tensorShapes = new Map<string, readonly Affine[]>();
  const defineTensor = (name: Name, shape: readonly Affine[]) => {
    if (tensorShapes.has(name.text)) sourceError(name, `tensor '${name.text}' is already assigned`);
    tensorShapes.set(name.text, shape);
  };
  const parameters = ast.parameters.map(({ name, type }) => {
    const shape = checkType(type.axes, shapeNames);
    defineTensor(name, shape);
    return { name: name.text, shape };
  });
  const witnesses = shapeWitnesses(ast, shapeNames);
  const result = checkType(ast.result.axes, shapeNames);
  const parameterAxes = parameters.flatMap(p => p.shape);
  let nextBinder = 0;

  const makeBinders = (names: readonly Name[], extents?: readonly Affine[]): PendingBinder[] => {
    const seen = new Set<string>();
    return names.map((name, index) => {
      if (seen.has(name.text)) sourceError(name, `duplicate index '${name.text}'`);
      seen.add(name.text);
      return { id: `i${nextBinder++}`, name, extent: extents?.[index] };
    });
  };

  const statements: Statement[] = [];
  for (const stmt of ast.statements) {
    if (tensorShapes.has(stmt.name.text))
      sourceError(stmt.name, `tensor '${stmt.name.text}' is already assigned`);
    const annotation = stmt.type && checkType(stmt.type.axes, shapeNames);
    if (annotation && annotation.length !== stmt.indices.length)
      sourceError(stmt.type!.at, 'statement annotation rank does not match its index list');
    const output = makeBinders(stmt.indices, annotation);
    const accesses: Access[] = [];

    const lower = (expr: AstExpression, scope: readonly PendingBinder[]): Expression => {
      const findBinder = (name: string, at: Location): PendingBinder => {
        const binder = scope.findLast(candidate => candidate.name.text === name);
        if (!binder) sourceError(at, `unbound index '${name}'`);
        return binder;
      };

      switch (expr.kind) {
        case 'literal':
          return { kind: expr.kind, spelling: expr.spelling };
        case 'shape':
          if (!shapeNames.has(expr.name)) sourceError(expr, `unknown shape name '${expr.name}'`);
          return { kind: expr.kind, name: expr.name };
        case 'read': {
          const shape = tensorShapes.get(expr.tensor);
          if (!shape) sourceError(expr, `unknown or later tensor '${expr.tensor}'`);
          if (expr.indices.length !== shape.length)
            sourceError(expr, `tensor '${expr.tensor}' has rank ${shape.length}`);
          const indices = expr.indices.map(({ value, plain, at }, axis) => {
            if (plain) {
              const binder = findBinder(plain.text, at);
              if (binder.extent && !equalAffine(binder.extent, shape[axis]))
                sourceError(at, `conflicting extents for index '${plain.text}'`);
              binder.extent = shape[axis];
            }
            return value.terms.reduce(
              (index, term) => add(index, variable(findBinder(term.name, at).id), term.coefficient),
              constant(value.constant),
            );
          });
          accesses.push({ tensor: expr.tensor, shape, indices, enclosing: scope, at: expr.indices });
          return { kind: expr.kind, tensor: expr.tensor, indices };
        }
        case 'negate':
          return { kind: expr.kind, operand: lower(expr.operand, scope) };
        case 'binary':
          return {
            kind: expr.kind,
            op: expr.op,
            left: lower(expr.left, scope),
            right: lower(expr.right, scope),
          };
        case 'call':
          return { kind: expr.kind, op: expr.op, args: expr.args.map(arg => lower(arg, scope)) };
        case 'reduce': {
          const indices = makeBinders(expr.indices);
          const body = lower(expr.body, [...scope, ...indices]);
          return { kind: expr.kind, op: expr.op, indices: indices.map(resolved), body };
        }
      }
    };

    const body = lower(stmt.body, output);
    const indices = output.map(resolved);
    for (const access of accesses) checkBounds(access, parameterAxes);
    defineTensor(
      stmt.name,
      indices.map(binder => binder.extent),
    );
    statements.push({ name: stmt.name.text, order: statements.length, indices, body });
  }

  const returns = tensorShapes.get(ast.returns.text);
  if (!returns) sourceError(ast.returns, `unknown return tensor '${ast.returns.text}'`);
  if (!equalShape(returns, result))
    sourceError(ast.returns, 'return tensor does not match the declared shape');
  return { name: ast.name.text, parameters, witnesses, result, statements, returns: ast.returns.text };
}

export function checkModule(ast: readonly AstFunction[]): TensorModule {
  const names = new Set<string>();
  const functions = ast.map(fn => {
    if (names.has(fn.name.text)) sourceError(fn.name, `duplicate function '${fn.name.text}'`);
    names.add(fn.name.text);
    return checkFunction(fn);
  });
  return { functions };
}
