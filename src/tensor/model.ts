export interface Location {
  readonly line: number;
  readonly col: number;
}

export function fail(at: Location, message: string): never {
  throw new Error(`${at.line}:${at.col}: ${message}`);
}

export interface Affine {
  readonly constant: number;
  readonly terms: readonly (readonly [name: string, coefficient: number])[];
}

export const constant = (value: number): Affine => ({ constant: value, terms: [] });
export const variable = (name: string): Affine => ({ constant: 0, terms: [[name, 1]] });

export function affineSum(at: Location, parts: readonly (readonly [Affine, number])[]): Affine {
  let offset = 0n;
  const coefficients = new Map<string, bigint>();
  for (const [affine, multiplier] of parts) {
    const scale = BigInt(multiplier);
    offset += BigInt(affine.constant) * scale;
    for (const [name, coefficient] of affine.terms)
      coefficients.set(name, (coefficients.get(name) ?? 0n) + BigInt(coefficient) * scale);
  }
  const safe = (value: bigint) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      fail(at, 'affine coefficient or constant exceeds the safe integer range');
    return number;
  };
  const terms = [...coefficients.keys()].sort().flatMap(name => {
    const coefficient = coefficients.get(name)!;
    return coefficient ? [[name, safe(coefficient)] as const] : [];
  });
  return { constant: safe(offset), terms };
}

export function affineValue(affine: Affine, bindings: ReadonlyMap<string, number>): bigint {
  let value = BigInt(affine.constant);
  for (const [name, coefficient] of affine.terms) value += BigInt(coefficient) * BigInt(bindings.get(name)!);
  return value;
}

export function sameAffine(left: Affine, right: Affine): boolean {
  return (
    left.constant === right.constant &&
    left.terms.length === right.terms.length &&
    left.terms.every(
      ([name, coefficient], index) =>
        name === right.terms[index]![0] && coefficient === right.terms[index]![1],
    )
  );
}

export function plainIndex(affine: Affine): string | undefined {
  if (affine.constant === 0 && affine.terms.length === 1 && affine.terms[0]![1] === 1)
    return affine.terms[0]![0];
}

export interface Binder {
  readonly id: string;
  readonly extent: Affine;
}

type Primitive = '+' | '-' | '*' | '/' | 'neg' | 'exp' | 'log' | 'sqrt' | 'tanh' | 'max' | 'min';

export type Expr<B = Binder> = { readonly at: Location } & (
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'shape'; readonly name: string }
  | { readonly kind: 'ref'; readonly tensor: string; readonly indices: readonly Affine[] }
  | { readonly kind: 'primitive'; readonly op: Primitive; readonly args: readonly Expr<B>[] }
  | {
      readonly kind: 'reduce';
      readonly op: 'sum' | 'max';
      readonly axes: readonly B[];
      readonly body: Expr<B>;
    }
  | {
      readonly kind: 'blocked-sum';
      readonly axis: B;
      readonly block: number;
      readonly body: Expr<B>;
    }
);

export function visitExpr<B>(expr: Expr<B>, visit: (expr: Expr<B>) => void): void {
  visit(expr);
  if (expr.kind === 'primitive') expr.args.forEach(arg => visitExpr(arg, visit));
  if (expr.kind === 'reduce' || expr.kind === 'blocked-sum') visitExpr(expr.body, visit);
}

export interface Parameter {
  readonly name: string;
  readonly shape: readonly Affine[];
  readonly at: Location;
}

export interface Statement {
  readonly name: string;
  readonly axes: readonly Binder[];
  readonly expr: Expr;
  readonly at: Location;
}

export interface Anchor {
  readonly name: string;
  readonly param: number;
  readonly axis: number;
}

export interface TixFunction {
  readonly name: string;
  readonly at: Location;
  readonly anchors: readonly Anchor[];
  readonly params: readonly Parameter[];
  readonly statements: readonly Statement[];
  readonly result: readonly Affine[];
  readonly returns: string;
  readonly returnAt: Location;
}

export interface TensorIR {
  readonly functions: readonly TixFunction[];
}

export const statementShape = (statement: Statement) => statement.axes.map(axis => axis.extent);
