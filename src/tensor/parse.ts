import { add, constant, sourceError, variable } from './model.js';
import type { Affine, BinaryOp, Intrinsic, Location } from './model.js';

type Token = Location & { readonly kind: 'name' | 'number' | 'symbol' | 'end'; readonly text: string };
export type Name = Location & { readonly text: string };
export type Axis = { readonly value: Affine; readonly at: Location; readonly plain?: Name };
interface AstType {
  readonly at: Location;
  readonly axes: readonly Axis[];
}

export type AstExpression = Location &
  (
    | { readonly kind: 'literal'; readonly spelling: string }
    | { readonly kind: 'shape'; readonly name: string }
    | { readonly kind: 'read'; readonly tensor: string; readonly indices: readonly Axis[] }
    | { readonly kind: 'negate'; readonly operand: AstExpression }
    | {
        readonly kind: 'binary';
        readonly op: BinaryOp;
        readonly left: AstExpression;
        readonly right: AstExpression;
      }
    | { readonly kind: 'call'; readonly op: Intrinsic; readonly args: readonly AstExpression[] }
    | {
        readonly kind: 'reduce';
        readonly op: 'sum' | 'max';
        readonly indices: readonly Name[];
        readonly body: AstExpression;
      }
  );

export interface AstFunction {
  readonly name: Name;
  readonly parameters: readonly { readonly name: Name; readonly type: AstType }[];
  readonly result: AstType;
  readonly statements: readonly {
    readonly name: Name;
    readonly indices: readonly Name[];
    readonly type?: AstType;
    readonly body: AstExpression;
  }[];
  readonly returns: Name;
}

const numberPattern = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
const namePattern = /[A-Za-z_][A-Za-z0-9_]*/y;
const intrinsics = new Set<string>(['exp', 'log', 'sqrt', 'tanh', 'max', 'min']);
const reserved = new Set(['fn', 'return', 'f32', 'sum', ...intrinsics]);

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let col = 1;
  for (let i = 0; i < source.length; ) {
    const char = source[i];
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      i++;
      line++;
      col = 1;
      continue;
    }
    if (/\s/.test(char)) {
      i++;
      col++;
      continue;
    }
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
      continue;
    }
    numberPattern.lastIndex = namePattern.lastIndex = i;
    const number = numberPattern.exec(source);
    const name = number ? null : namePattern.exec(source);
    const kind = number ? 'number' : name ? 'name' : 'symbol';
    const text = number?.[0] ?? name?.[0] ?? char;
    if (kind === 'symbol' && !'()[]{}:;,=+-*/'.includes(char))
      sourceError({ line, col }, `unexpected character '${char}'`);
    tokens.push({ kind, text, line, col });
    i += text.length;
    col += text.length;
  }
  tokens.push({ kind: 'end', text: '', line, col });
  return tokens;
}

function precedence(op: string): number {
  if (op === '+' || op === '-') return 1;
  if (op === '*' || op === '/') return 2;
  return 0;
}

class Parser {
  private pos = 0;
  private shapeNames = new Set<string>();

  constructor(private readonly tokens: readonly Token[]) {}

  private get token(): Token {
    return this.tokens[this.pos];
  }

  private take(text: string): boolean {
    if (this.token.text !== text) return false;
    this.pos++;
    return true;
  }

  private expect(text: string): Token {
    const token = this.token;
    if (!this.take(text)) sourceError(token, `expected '${text}'`);
    return token;
  }

  private name(): Name {
    const token = this.token;
    if (token.kind !== 'name' || reserved.has(token.text)) sourceError(token, 'expected a name');
    this.pos++;
    return token;
  }

  private list<T>(item: () => T): T[] {
    const values = [item()];
    while (this.take(',')) values.push(item());
    return values;
  }

  parse(): AstFunction[] {
    if (this.token.kind === 'end') sourceError(this.token, 'expected a function');
    const functions = [];
    while (this.pos < this.tokens.length - 1) functions.push(this.parseFunction());
    return functions;
  }

  private parseFunction(): AstFunction {
    this.expect('fn');
    const name = this.name();
    this.expect('(');
    const parameters = this.list(() => {
      const name = this.name();
      this.expect(':');
      return { name, type: this.type() };
    });
    this.expect(')');
    this.shapeNames = new Set(
      parameters.flatMap(p => p.type.axes.flatMap(axis => axis.value.terms.map(t => t.name))),
    );
    this.expect(':');
    const result = this.type();
    this.expect('{');
    const statements = [];
    while (!this.take('return')) {
      const name = this.name();
      this.expect('[');
      const indices = this.list(() => this.name());
      this.expect(']');
      const type = this.take(':') ? this.type() : undefined;
      this.expect('=');
      const body = this.expression();
      this.expect(';');
      statements.push({ name, indices, type, body });
    }
    const returns = this.name();
    this.expect(';');
    this.expect('}');
    return { name, parameters, result, statements, returns };
  }

  private type(): AstType {
    const at = this.expect('f32');
    this.expect('[');
    const axes = this.list(() => this.axis());
    this.expect(']');
    return { at, axes };
  }

  private axis(): Axis {
    const at = this.token;
    const start = this.pos;
    const value = this.affine();
    const plain = this.pos === start + 1 && at.kind === 'name' ? at : undefined;
    return { value, at, plain };
  }

  private affine(minimum = 1): Affine {
    const token = this.token;
    let value: Affine;
    if (this.take('-')) {
      value = this.affineAdd(token, constant(0), this.affine(3), -1);
    } else if (this.take('(')) {
      value = this.affine();
      this.expect(')');
    } else if (token.kind === 'number' && /^[0-9]+$/.test(token.text)) {
      this.pos++;
      const integer = Number(token.text);
      if (!Number.isSafeInteger(integer)) sourceError(token, 'expected a safe affine integer');
      value = constant(integer);
    } else {
      value = variable(this.name().text);
    }
    while (precedence(this.token.text) >= minimum) {
      const op = this.token;
      this.pos++;
      const right = this.affine(precedence(op.text) + 1);
      switch (op.text) {
        case '+':
        case '-':
          value = this.affineAdd(op, value, right, op.text === '+' ? 1 : -1);
          break;
        case '*':
          if (!value.terms.length) value = this.affineAdd(op, constant(0), right, value.constant);
          else if (!right.terms.length) value = this.affineAdd(op, constant(0), value, right.constant);
          else sourceError(op, 'an affine product needs a constant operand');
          break;
        default:
          sourceError(op, 'division is not an affine operator');
      }
    }
    return value;
  }

  private affineAdd(at: Location, a: Affine, b: Affine, scale: number): Affine {
    try {
      return add(a, b, scale);
    } catch (error) {
      sourceError(at, (error as Error).message);
    }
  }

  private expression(minimum = 1): AstExpression {
    let left = this.primary();
    while (precedence(this.token.text) >= minimum) {
      const op = this.token;
      this.pos++;
      const right = this.expression(precedence(op.text) + 1);
      left = { ...op, kind: 'binary', op: op.text as BinaryOp, left, right };
    }
    return left;
  }

  private maxIsReduction(): boolean {
    let look = this.pos;
    const names: string[] = [];
    do {
      const token = this.tokens[look++];
      if (token.kind !== 'name' || reserved.has(token.text)) return false;
      names.push(token.text);
    } while (this.tokens[look++].text === ',');
    if (this.tokens[look - 1].text !== ')') return false;
    const next = this.tokens[look];
    if (next.text === '-' && names.length === 2 && names.every(name => this.shapeNames.has(name)))
      return false;
    return next.kind === 'number' || next.kind === 'name' || next.text === '(' || next.text === '-';
  }

  private primary(): AstExpression {
    const token = this.token;
    if (this.take('-')) return { ...token, kind: 'negate', operand: this.expression(3) };
    if (this.take('(')) {
      const inner = this.expression();
      this.expect(')');
      return inner;
    }
    if (token.kind === 'number') {
      this.pos++;
      if (!Number.isFinite(Number(token.text))) sourceError(token, 'expected a finite number literal');
      return { ...token, kind: 'literal', spelling: token.text };
    }
    if (token.text === 'sum' || intrinsics.has(token.text)) {
      const op = token.text as Intrinsic | 'sum';
      this.pos++;
      this.expect('(');
      if (op === 'sum' || (op === 'max' && this.maxIsReduction())) {
        const indices = this.list(() => this.name());
        this.expect(')');
        return { ...token, kind: 'reduce', op, indices, body: this.expression() };
      }
      const args = [this.expression()];
      if (op === 'max' || op === 'min') {
        this.expect(',');
        args.push(this.expression());
      }
      this.expect(')');
      return { ...token, kind: 'call', op, args };
    }
    const name = this.name();
    if (!this.take('[')) return { ...name, kind: 'shape', name: name.text };
    const indices = this.list(() => this.axis());
    this.expect(']');
    return { ...name, kind: 'read', tensor: name.text, indices };
  }
}

export function parse(source: string): AstFunction[] {
  return new Parser(lex(source)).parse();
}
