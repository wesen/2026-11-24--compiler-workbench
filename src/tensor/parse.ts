import { add, constant, fail, scale, subtract, variable } from './model.js';
import type { Affine, Binary, Expression, Location, Unary } from './model.js';

type Token = Location & { text: string; kind: 'name' | 'number' | 'symbol' | 'eof' };
type Type = { at: Token; dims: Affine[]; names: string[] };
interface Coordinate {
  affine: Affine;
  names: string[];
  plain?: string;
}
type ParsedExpr = Expression<{ tensor: string; coords: Coordinate[]; at: Token }, Token>;
interface ParsedStatement {
  name: Token;
  indices: Token[];
  type?: Type;
  body: ParsedExpr;
}
export interface ParsedFunction {
  name: Token;
  params: { name: Token; type: Type }[];
  resultType: Type;
  statements: ParsedStatement[];
  result: Token;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\/\/[^\r\n]*|\r\n|[\r\n]|[^\S\r\n]+|[A-Za-z_][A-Za-z_0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()[\]{}:,;=+*/-]/y;
  let line = 1;
  let col = 1;
  while (pattern.lastIndex < source.length) {
    const at = { line, col };
    const match = pattern.exec(source);
    if (!match) fail(at, 'Unexpected character');
    const text = match[0];
    if (text === '\r\n' || text === '\r' || text === '\n') {
      line++;
      col = 1;
      continue;
    }
    col += text.length;
    if (/^\s/.test(text) || text.startsWith('//')) continue;
    const kind = /^[A-Za-z_]/.test(text) ? 'name' : /^[\d.]/.test(text) ? 'number' : 'symbol';
    tokens.push({ ...at, text, kind });
  }
  tokens.push({ line, col, text: '<end of source>', kind: 'eof' });
  return tokens;
}

const precedence: Readonly<Record<string, number>> = { '+': 1, '-': 1, '*': 2, '/': 2 };
const unaryCalls: readonly string[] = ['exp', 'log', 'sqrt', 'tanh'];

class Parser {
  private cursor = 0;
  private shapeNames = new Set<string>();

  constructor(private readonly tokens: Token[]) {}

  private peek() {
    return this.tokens[this.cursor];
  }

  private take(text: string): boolean {
    if (this.peek().text !== text) return false;
    this.cursor++;
    return true;
  }

  private expect(text: string): Token {
    const token = this.peek();
    if (!this.take(text)) fail(token, `Expected '${text}', got '${token.text}'`);
    return token;
  }

  private name(): Token {
    const token = this.peek();
    if (token.kind !== 'name') fail(token, 'Expected a name');
    this.cursor++;
    return token;
  }

  private list<T>(item: () => T): T[] {
    const items = [item()];
    while (this.take(',')) items.push(item());
    return items;
  }

  private affineAtom(): Affine {
    const token = this.peek();
    if (this.take('-')) return scale(this.affineAtom(), -1n);
    if (this.take('(')) {
      const value = this.affine();
      this.expect(')');
      return value;
    }
    if (token.kind === 'name') return variable(this.name().text);
    if (token.kind !== 'number' || !/^\d+$/.test(token.text))
      fail(token, 'Expected an affine integer or name');
    this.cursor++;
    return constant(BigInt(token.text));
  }

  private affineProduct(): Affine {
    let left = this.affineAtom();
    while (this.peek().text === '*') {
      const at = this.expect('*');
      const right = this.affineAtom();
      if (!left.terms.length) left = scale(right, BigInt(left.constant));
      else if (!right.terms.length) left = scale(left, BigInt(right.constant));
      else fail(at, 'An affine product needs an integer constant factor');
    }
    return left;
  }

  private affine(): Affine {
    let left = this.affineProduct();
    while (this.peek().text === '+' || this.peek().text === '-') {
      const op = this.tokens[this.cursor++].text;
      const right = this.affineProduct();
      left = op === '+' ? add(left, right) : subtract(left, right);
    }
    return left;
  }

  private coordinate(): Coordinate {
    const start = this.cursor;
    const affine = this.affine();
    const token = this.tokens[start];
    const names = this.namesSince(start);
    return this.cursor === start + 1 && token.kind === 'name'
      ? { affine, names, plain: token.text }
      : { affine, names };
  }

  private namesSince(start: number): string[] {
    return this.tokens
      .slice(start, this.cursor)
      .filter(token => token.kind === 'name')
      .map(token => token.text);
  }

  private type(): Type {
    const at = this.expect('f32');
    this.expect('[');
    const start = this.cursor;
    const dims = this.list(() => this.affine());
    const names = this.namesSince(start);
    this.expect(']');
    return { at, dims, names };
  }

  private maxIsReduction(): boolean {
    let i = this.cursor;
    const names: Token[] = [];
    while (this.tokens[i].kind === 'name') {
      names.push(this.tokens[i++]);
      if (this.tokens[i].text !== ',') break;
      i++;
    }
    if (this.tokens[i].text !== ')' || names.length === 0) return false;
    if (names.length !== 2) return true;
    const next = this.tokens[i + 1];
    if (next.text === '-') return !names.every(name => this.shapeNames.has(name.text));
    return next.kind === 'name' || next.kind === 'number' || next.text === '(';
  }

  private atom(): ParsedExpr {
    const at = this.peek();
    if (this.take('-')) return { kind: 'unary', op: '-', arg: this.atom() };
    if (this.take('(')) {
      const expr = this.expression();
      this.expect(')');
      return expr;
    }
    if (at.kind === 'number') {
      this.cursor++;
      return { kind: 'literal', text: at.text };
    }
    const name = this.name().text;
    if (this.take('[')) {
      const coords = this.list(() => this.coordinate());
      this.expect(']');
      return { kind: 'read', tensor: name, coords, at };
    }
    if (!this.take('(')) return { kind: 'shape', name, at };
    if (name === 'sum' || (name === 'max' && this.maxIsReduction())) {
      const binders = this.list(() => this.name());
      this.expect(')');
      return { kind: 'reduce', op: name, binders, body: this.expression() };
    }
    if (unaryCalls.includes(name)) {
      const arg = this.expression();
      this.expect(')');
      return { kind: 'unary', op: name as Unary, arg };
    }
    if (name !== 'max' && name !== 'min') fail(at, `Unknown operation '${name}'`);
    const left = this.expression();
    this.expect(',');
    const right = this.expression();
    this.expect(')');
    return { kind: 'binary', op: name, left, right };
  }

  private expression(min = 1): ParsedExpr {
    let left = this.atom();
    while ((precedence[this.peek().text] ?? 0) >= min && Object.hasOwn(precedence, this.peek().text)) {
      const op = this.tokens[this.cursor++].text as Binary;
      left = { kind: 'binary', op, left, right: this.expression(precedence[op] + 1) };
    }
    return left;
  }

  private statement(): ParsedStatement {
    const name = this.name();
    this.expect('[');
    const indices = this.list(() => this.name());
    this.expect(']');
    const type = this.take(':') ? this.type() : undefined;
    this.expect('=');
    const body = this.expression();
    this.expect(';');
    return { name, indices, type, body };
  }

  private fn(): ParsedFunction {
    this.expect('fn');
    const name = this.name();
    this.expect('(');
    const params = this.list(() => {
      const name = this.name();
      this.expect(':');
      return { name, type: this.type() };
    });
    this.expect(')');
    this.shapeNames = new Set(params.flatMap(param => param.type.names));
    this.expect(':');
    const resultType = this.type();
    this.expect('{');
    const statements: ParsedStatement[] = [];
    while (this.peek().text !== 'return') statements.push(this.statement());
    this.expect('return');
    const result = this.name();
    this.expect(';');
    this.expect('}');
    return { name, params, resultType, statements, result };
  }

  program(): ParsedFunction[] {
    const functions = [this.fn()];
    while (this.peek().kind !== 'eof') functions.push(this.fn());
    return functions;
  }
}

export function parseTix(source: string): ParsedFunction[] {
  return new Parser(tokenize(source)).program();
}
