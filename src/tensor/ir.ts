import { defineIR } from '../framework/contracts/index.js';
import { defineAdapter } from '../framework/ir/index.js';
import type { IREntity, IRRelation } from '../framework/ir/index.js';
import { sameShape } from './check.js';
import { add, constant, expressions, sameAffine, scale, subtract } from './model.js';
import type { Affine, Binder, Expr, Read, Statement, TensorFunction, TensorIR } from './model.js';

const zero = constant(0n);
const one = constant(1n);
const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/;
const integer = /^(0|-?[1-9]\d*)$/;
const numberLiteral = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function requireIR(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validateAffine(a: Affine, names: ReadonlySet<string>) {
  requireIR(
    typeof a.constant === 'string' && integer.test(a.constant) && Array.isArray(a.terms),
    'Invalid affine extent or coordinate',
  );
  let last = '';
  for (const [name, n] of a.terms) {
    requireIR(
      names.has(name) && last < name && typeof n === 'string' && n !== '0' && integer.test(n),
      'Invalid affine coefficient',
    );
    last = name;
  }
}

function floorDiv(n: bigint, positive: bigint) {
  return n / positive - (n % positive < 0n ? 1n : 0n);
}

function nonnegative(value: Affine, constraints: readonly Affine[]): boolean {
  if (constraints.some(a => sameAffine(value, a))) return true;
  let min = BigInt(value.constant);
  for (const [name, n] of value.terms) {
    const coefficient = BigInt(n);
    let lower = 0n;
    let upper: bigint | undefined;
    for (const a of constraints) {
      if (a.terms.length !== 1 || a.terms[0][0] !== name) continue;
      const slope = BigInt(a.terms[0][1]);
      const offset = BigInt(a.constant);
      if (slope > 0n) {
        const bound = -floorDiv(offset, slope);
        if (bound > lower) lower = bound;
      } else {
        const bound = floorDiv(offset, -slope);
        if (upper === undefined || bound < upper) upper = bound;
      }
    }
    if (coefficient < 0n && upper === undefined) return false;
    min += coefficient * (coefficient > 0n ? lower : upper!);
  }
  return min >= 0n;
}

export class UnprovedAccess extends Error {
  constructor(read: Read, axis: number) {
    super(`${read.at.line}:${read.at.col}: Cannot prove index ${axis + 1} of '${read.tensor}' is in bounds`);
  }
}

function validateRead(
  read: Read,
  scope: ReadonlyMap<string, Affine>,
  tensors: ReadonlyMap<string, readonly Affine[]>,
  paramExtents: readonly Affine[],
) {
  const shape = tensors.get(read.tensor);
  requireIR(shape?.length === read.coords.length, 'Invalid tensor read rank');
  const names = new Set(scope.keys());
  const empty = [...scope.values()].some(extent => sameAffine(extent, zero));
  const constraints = [...paramExtents, ...scope.values(), ...shape];
  read.coords.forEach((coord, axis) => {
    validateAffine(coord, names);
    if (empty) return;
    let min = constant(BigInt(coord.constant));
    let max = min;
    for (const [id, coeff] of coord.terms) {
      const n = BigInt(coeff);
      const end = scale(subtract(scope.get(id)!, one), n);
      if (n < 0n) min = add(min, end);
      else max = add(max, end);
    }
    if (
      !nonnegative(min, constraints) ||
      !nonnegative(subtract(subtract(shape[axis], one), max), constraints)
    )
      throw new UnprovedAccess(read, axis);
  });
}

export function validateFunction(fn: TensorFunction) {
  requireIR(
    identifier.test(fn.name) && Array.isArray(fn.params) && fn.params.length && Array.isArray(fn.statements),
    'Invalid tensor function',
  );
  const names = new Set(fn.shapeNames);
  requireIR(
    names.size === fn.shapeNames.length && fn.shapeNames.every(n => identifier.test(n)),
    'Invalid shape names',
  );
  const tensors = new Map<string, readonly Affine[]>();
  const paramExtents = fn.params.flatMap(param => param.shape);
  const bindable = new Set(paramExtents.flatMap(dim => (dim.terms.length === 1 ? [dim.terms[0][0]] : [])));
  requireIR(
    fn.shapeNames.every(name => bindable.has(name)),
    'Unbound shape name',
  );

  function extent(a: Affine) {
    validateAffine(a, names);
    requireIR(a.terms.length || BigInt(a.constant) >= 0n, 'Negative constant extent');
  }

  function declare(name: string, dims: readonly Affine[]) {
    requireIR(identifier.test(name) && !tensors.has(name) && dims.length, 'Invalid tensor definition');
    for (const dim of dims) extent(dim);
    tensors.set(name, dims);
  }

  function enter(binders: readonly Binder[], scope: ReadonlyMap<string, Affine>) {
    requireIR(Array.isArray(binders) && binders.length, 'Expected index binders');
    const nested = new Map(scope);
    for (const binder of binders) {
      requireIR(identifier.test(binder.id) && !nested.has(binder.id), 'Invalid index binder');
      extent(binder.extent);
      nested.set(binder.id, binder.extent);
    }
    return nested;
  }

  function validateExpr(node: Expr, scope: ReadonlyMap<string, Affine>) {
    switch (node.kind) {
      case 'literal':
        requireIR(numberLiteral.test(node.text), 'Invalid literal');
        break;
      case 'shape':
        requireIR(names.has(node.name), 'Invalid shape expression');
        break;
      case 'read':
        validateRead(node, scope, tensors, paramExtents);
        break;
      case 'unary':
        requireIR(['-', 'exp', 'log', 'sqrt', 'tanh'].includes(node.op), 'Invalid unary operator');
        validateExpr(node.arg, scope);
        break;
      case 'binary':
        requireIR(['+', '-', '*', '/', 'max', 'min'].includes(node.op), 'Invalid binary operator');
        validateExpr(node.left, scope);
        validateExpr(node.right, scope);
        break;
      case 'reduce':
        requireIR(node.op === 'sum' || node.op === 'max', 'Invalid reduction');
        if (node.block !== undefined)
          requireIR(
            node.op === 'sum' &&
              node.binders.length === 1 &&
              Number.isSafeInteger(node.block) &&
              node.block > 0,
            'Invalid blocked sum',
          );
        validateExpr(node.body, enter(node.binders, scope));
        break;
      default:
        throw new Error('Unknown tensor expression');
    }
  }

  for (const param of fn.params) declare(param.name, param.shape);
  const statements: readonly Statement[] = fn.statements;
  for (const stmt of statements) {
    validateExpr(stmt.body, enter(stmt.binders, new Map()));
    declare(
      stmt.name,
      stmt.binders.map(binder => binder.extent),
    );
  }
  const result = tensors.get(fn.result);
  requireIR(result && sameShape(fn.resultShape, result), 'Invalid tensor return shape');
}

function validate(value: unknown): asserts value is TensorIR {
  const ir = value as TensorIR;
  requireIR(ir && Array.isArray(ir.functions) && ir.functions.length, 'Expected tensor functions');
  const seen = new Set<string>();
  for (const fn of ir.functions) {
    requireIR(!seen.has(fn.name), 'Duplicate tensor function');
    seen.add(fn.name);
    validateFunction(fn);
  }
}

type Projection = { entities: Map<string, IREntity>; relations: IRRelation[] };
const projections = new WeakMap<TensorIR, Projection>();

function projection(value: TensorIR): Projection {
  const cached = projections.get(value);
  if (cached) return cached;
  const entities = new Map<string, IREntity>();
  const relations: IRRelation[] = [];
  for (const fn of value.functions) {
    const id = `fn/${fn.name}`;
    entities.set(id, {
      id,
      kind: 'function',
      attributes: {
        name: fn.name,
        shapeNames: fn.shapeNames,
        result: fn.result,
        resultShape: fn.resultShape,
      },
    });
    const tensors = new Map<string, string>();
    const attach = (kind: 'parameter' | 'statement', name: string, attributes: Record<string, unknown>) => {
      const child = `${id}/${kind}/${name}`;
      tensors.set(name, child);
      entities.set(child, { id: child, kind, attributes });
      relations.push({
        id: `contains:${child}`,
        kind: 'contains',
        category: 'containment',
        from: id,
        to: child,
      });
      return child;
    };
    for (const param of fn.params) attach('parameter', param.name, { ...param });
    let previous: string | undefined;
    for (const stmt of fn.statements) {
      const child = attach('statement', stmt.name, { ...stmt });
      if (previous)
        relations.push({
          id: `next:${previous}`,
          kind: 'next',
          category: 'adjacency',
          from: previous,
          to: child,
        });
      previous = child;
      const reads = new Set<string>();
      for (const expr of expressions(stmt.body)) if (expr.kind === 'read') reads.add(expr.tensor);
      for (const name of reads) {
        const to = tensors.get(name)!;
        relations.push({
          id: `reads:${child}:${to}`,
          kind: 'reads',
          category: 'dependency',
          from: child,
          to,
        });
      }
    }
  }
  const graph = { entities, relations };
  if (Object.isFrozen(value)) projections.set(value, graph);
  return graph;
}

export const TensorType = defineIR<TensorIR>({
  id: 'tensor.tix',
  version: '1',
  description: 'Checked Tix tensor functions',
  validate,
});

export const tensorAdapter = defineAdapter<TensorIR>({
  id: 'tensor.tix.adapter',
  version: '1',
  kind: TensorType.id,
  schemaVersion: TensorType.version,
  description: 'Functions and ordered tensor definitions with read dependencies',
  relationKinds: { contains: 'containment', reads: 'dependency', next: 'adjacency' },
  validate,
  entities: value => projection(value).entities.values(),
  resolve: (value, id) => projection(value).entities.get(id),
  relations: value => projection(value).relations,
  describe: (value, id) => ({ label: String(projection(value).entities.get(id)?.attributes.name ?? id) }),
});
