import {
  affineValue,
  fail,
  plainIndex,
  statementShape,
  type Affine,
  type Binder,
  type Expr,
  type Location,
  type TixFunction,
} from './model.js';

export type Precision = 'f32' | 'f64';
export interface TensorInput {
  readonly shape: readonly number[];
  readonly data: Float32Array | Float64Array;
}
export type TensorInputs = Readonly<Record<string, TensorInput>>;
export interface TensorResult {
  shape: number[];
  data: Float32Array | Float64Array;
}

export class ShapeError extends Error {}
export class EvaluationLimit extends Error {}

const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
function dimension(value: bigint, at: Location): number {
  if (value < 0n || value > maxSafe)
    throw new ShapeError(`${at.line}:${at.col}: expected a nonnegative safe tensor extent`);
  return Number(value);
}

export function tensorSize(shape: readonly number[]): number {
  if (shape.includes(0)) return 0;
  const size = shape.reduce((product, extent) => product * extent, 1);
  if (!Number.isSafeInteger(size)) throw new ShapeError('Tensor size exceeds the safe integer range');
  return size;
}

export function concreteShape(
  shape: readonly Affine[],
  names: ReadonlyMap<string, number>,
  at: Location,
): number[] {
  return shape.map(dim => dimension(affineValue(dim, names), at));
}

export function instantiate(
  fn: TixFunction,
  inputShapes: readonly (readonly number[])[],
): { names: Map<string, number>; statementShapes: number[][] } {
  const names = new Map<string, number>();
  if (fn.params.length !== inputShapes.length) throw new ShapeError('Unexpected input count');
  for (const [index, param] of fn.params.entries()) {
    const shape = inputShapes[index]!;
    if (shape.length !== param.shape.length || shape.some(dim => !Number.isSafeInteger(dim) || dim < 0))
      throw new ShapeError(`${param.at.line}:${param.at.col}: invalid shape for "${param.name}"`);
  }
  for (const { name, param, axis } of fn.anchors) {
    const affine = fn.params[param]!.shape[axis]!;
    const factor = BigInt(affine.terms[0]![1]);
    const offset = BigInt(inputShapes[param]![axis]!) - BigInt(affine.constant);
    if (offset % factor !== 0n) throw new ShapeError(`Noninteger binding for shape name "${name}"`);
    names.set(name, dimension(offset / factor, fn.params[param]!.at));
  }
  for (const [index, param] of fn.params.entries()) {
    const expected = concreteShape(param.shape, names, param.at);
    if (expected.some((dim, axis) => dim !== inputShapes[index]![axis]))
      throw new ShapeError(`${param.at.line}:${param.at.col}: inconsistent shape for "${param.name}"`);
  }
  return {
    names,
    statementShapes: fn.statements.map(statement =>
      concreteShape(statementShape(statement), names, statement.at),
    ),
  };
}

export function evaluate(
  fn: TixFunction,
  inputs: TensorInputs,
  precision: Precision,
  limits?: { readonly work: number; readonly elements: number },
): TensorResult {
  const round = precision === 'f32' ? Math.fround : (x: number) => x;
  const supplied = fn.params.map(param => {
    if (!Object.hasOwn(inputs, param.name)) fail(param.at, `missing tensor "${param.name}"`);
    return inputs[param.name]!;
  });
  const { names, statementShapes } = instantiate(
    fn,
    supplied.map(input => input.shape),
  );
  const tensors = new Map<string, TensorResult>();
  const indices = new Map<string, number>();
  const extents = new Map<Binder, number>();
  let remaining = limits?.work ?? Infinity;
  function step() {
    if (--remaining < 0) throw new EvaluationLimit('Evaluation work limit exceeded');
  }
  function sizeOf(shape: readonly number[]) {
    const size = tensorSize(shape);
    if (limits && size > limits.elements) throw new EvaluationLimit('Tensor element limit exceeded');
    return size;
  }
  function allocate(size: number) {
    return precision === 'f32' ? new Float32Array(size) : new Float64Array(size);
  }
  function words(data: Float32Array | Float64Array) {
    return data instanceof Float32Array
      ? new Uint32Array(data.buffer, data.byteOffset, data.length)
      : undefined;
  }
  function store(tensor: TensorResult['data'], bits: Uint32Array | undefined, i: number, value: number) {
    if (bits && Number.isNaN(value)) bits[i] = 0x7fc00000;
    else tensor[i] = value;
  }

  for (const [index, param] of fn.params.entries()) {
    const input = supplied[index]!;
    if (
      !(input.data instanceof Float32Array || input.data instanceof Float64Array) ||
      input.data.length !== sizeOf(input.shape)
    )
      fail(param.at, `wrong data length or carrier for "${param.name}"`);
    const data = allocate(input.data.length);
    for (let i = 0; i < data.length; i++) {
      const value = input.data[i]!;
      if (!Number.isFinite(value)) fail(param.at, `nonfinite input in "${param.name}"`);
      data[i] = round(value);
    }
    tensors.set(param.name, { shape: [...input.shape], data });
  }

  function extent(axis: Binder, at: Location): number {
    let result = extents.get(axis);
    if (result === undefined) {
      result = dimension(affineValue(axis.extent, names), at);
      extents.set(axis, result);
    }
    return result;
  }

  function visitAxes(axes: readonly Binder[], lengths: readonly number[], visit: () => void) {
    if (lengths.includes(0)) return;
    function loop(depth: number) {
      if (depth === axes.length) {
        visit();
        return;
      }
      const { id } = axes[depth]!;
      for (let i = 0; i < lengths[depth]!; i++) {
        indices.set(id, i);
        loop(depth + 1);
      }
    }
    loop(0);
  }

  function evalExpr(expr: Expr): number {
    step();
    switch (expr.kind) {
      case 'number':
        return round(expr.value);
      case 'shape':
        return round(names.get(expr.name)!);
      case 'ref': {
        const { shape, data } = tensors.get(expr.tensor)!;
        let offset = 0;
        for (const [axis, index] of expr.indices.entries()) {
          const plain = plainIndex(index);
          const coordinate = plain === undefined ? Number(affineValue(index, indices)) : indices.get(plain)!;
          offset = offset * shape[axis]! + coordinate;
        }
        return data[offset]!;
      }
      case 'primitive': {
        const left = evalExpr(expr.args[0]!);
        switch (expr.op) {
          case 'neg':
            return round(-left);
          case 'exp':
            return round(Math.exp(left));
          case 'log':
            return round(Math.log(left));
          case 'sqrt':
            return round(Math.sqrt(left));
          case 'tanh':
            return round(Math.tanh(left));
        }
        const right = evalExpr(expr.args[1]!);
        switch (expr.op) {
          case '+':
            return round(left + right);
          case '-':
            return round(left - right);
          case '*':
            return round(left * right);
          case '/':
            return round(left / right);
          case 'max':
            return round(Math.max(left, right));
          case 'min':
            return round(Math.min(left, right));
        }
        break;
      }
      case 'reduce': {
        let result = expr.op === 'sum' ? 0 : -Infinity;
        visitAxes(
          expr.axes,
          expr.axes.map(axis => extent(axis, expr.at)),
          () => {
            step();
            const value = evalExpr(expr.body);
            result = round(expr.op === 'sum' ? result + value : Math.max(result, value));
          },
        );
        return result;
      }
      case 'blocked-sum': {
        let result = 0;
        const length = extent(expr.axis, expr.at);
        for (let start = 0; start < length; ) {
          const end = start + Math.min(expr.block, length - start);
          let partial = 0;
          for (let i = start; i < end; i++) {
            step();
            indices.set(expr.axis.id, i);
            partial = round(partial + evalExpr(expr.body));
          }
          step();
          result = round(result + partial);
          start = end;
        }
        return result;
      }
    }
    throw new Error('Unknown tensor operation');
  }

  for (const [index, statement] of fn.statements.entries()) {
    const shape = statementShapes[index]!;
    const data = allocate(sizeOf(shape));
    const bits = words(data);
    let offset = 0;
    visitAxes(statement.axes, shape, () => store(data, bits, offset++, evalExpr(statement.expr)));
    tensors.set(statement.name, { shape, data });
  }
  return tensors.get(fn.returns)!;
}
