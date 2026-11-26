import {
  affineSum,
  constant,
  fail,
  variable,
  type Affine,
  type Expr,
  type Location,
  type Parameter,
} from './model.js';

interface Token extends Location {
  readonly text: string;
  readonly kind: 'name' | 'number' | 'symbol' | 'end';
}

export interface SourceStatement {
  readonly name: string;
  readonly axes: readonly string[];
  readonly shape?: readonly Affine[];
  readonly expr: Expr<string>;
  readonly at: Location;
}

export interface SourceFunction {
  readonly name: string;
  readonly at: Location;
  readonly params: readonly Parameter[];
  readonly statements: readonly SourceStatement[];
  readonly result: readonly Affine[];
  readonly returns: string;
  readonly returnAt: Location;
}

const keywords = new Set(['fn', 'return', 'f32', 'exp', 'log', 'sqrt', 'tanh', 'max', 'min', 'sum']);
const binary = { '+': 1, '-': 1, '*': 2, '/': 2 } as const;
const unaryCalls = new Set(['exp', 'log', 'sqrt', 'tanh']);
const location = ({ line, col }: Token): Location => ({ line, col });

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lexer =
    /([ \t\f\v]+|\r\n?|\n|\/\/[^\r\n]*)|([a-zA-Z_][a-zA-Z_0-9]*)|([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)|([()[\]{},:;=+*/-])/y;
  let line = 1;
  let col = 1;
  let offset = 0;
  while (offset < source.length) {
    const match = lexer.exec(source);
    if (!match) fail({ line, col }, `unexpected character ${JSON.stringify(source[offset])}`);
    const [text, space, name, number] = match;
    if (!space) tokens.push({ text, line, col, kind: name ? 'name' : number ? 'number' : 'symbol' });
    if (text[0] === '\r' || text[0] === '\n') {
      line++;
      col = 1;
    } else {
      col += text.length;
    }
    offset = lexer.lastIndex;
  }
  tokens.push({ text: '', kind: 'end', line, col });
  return tokens;
}

class Parser {
  private index = 0;
  private shapeNames = new Set<string>();

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private pop(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index++;
    return token;
  }

  private expect(text: string): Token {
    const token = this.pop();
    if (token.text !== text) fail(token, `expected "${text}"`);
    return token;
  }

  private name(): Token {
    const token = this.pop();
    if (token.kind !== 'name' || keywords.has(token.text)) fail(token, 'expected a name');
    return token;
  }

  private list<T>(item: () => T, end: string): T[] {
    const items = [item()];
    while (this.peek().text === ',') {
      this.pop();
      items.push(item());
    }
    this.expect(end);
    return items;
  }

  private affine(min = 1, checkName?: (token: Token) => void): Affine {
    const token = this.pop();
    let value: Affine;
    if (token.text === '-') {
      value = affineSum(token, [[this.affine(3, checkName), -1]]);
    } else if (token.text === '(') {
      value = this.affine(1, checkName);
      this.expect(')');
    } else if (token.kind === 'number' && /^[0-9]+$/.test(token.text)) {
      const integer = Number(token.text);
      if (!Number.isSafeInteger(integer)) fail(token, 'expected a safe integer');
      value = constant(integer);
    } else if (token.kind === 'name' && !keywords.has(token.text)) {
      checkName?.(token);
      value = variable(token.text);
    } else {
      fail(token, 'expected an affine expression');
    }

    while (true) {
      const op = this.peek();
      if (op.text !== '+' && op.text !== '-' && op.text !== '*') return value;
      const precedence = binary[op.text];
      if (precedence < min) return value;
      this.pop();
      const right = this.affine(precedence + 1, checkName);
      if (op.text === '*') {
        if (value.terms.length && right.terms.length) fail(op, 'affine multiplication requires a constant');
        value = value.terms.length
          ? affineSum(op, [[value, right.constant]])
          : affineSum(op, [[right, value.constant]]);
      } else {
        value = affineSum(op, [
          [value, 1],
          [right, op.text === '+' ? 1 : -1],
        ]);
      }
    }
  }

  private type(checkName?: (token: Token) => void): Affine[] {
    this.expect('f32');
    this.expect('[');
    return this.list(() => this.affine(1, checkName), ']');
  }

  private boundType(): Affine[] {
    return this.type(token => {
      if (!this.shapeNames.has(token.text)) fail(token, `unbound shape name "${token.text}"`);
    });
  }

  private maxReduction(): boolean {
    const axes: string[] = [];
    let end = this.index;
    while (true) {
      const token = this.tokens[end]!;
      if (token.kind !== 'name' || keywords.has(token.text)) return false;
      axes.push(token.text);
      const separator = this.tokens[++end]!.text;
      if (separator === ')') break;
      if (separator !== ',') return false;
      end++;
    }
    if (axes.length !== 2) return true;
    const next = this.tokens[end + 1]!;
    if (next.text === '-') return !axes.every(axis => this.shapeNames.has(axis));
    return next.kind === 'number' || next.text === '(' || next.kind === 'name';
  }

  private atom(indices: ReadonlySet<string>): Expr<string> {
    const token = this.pop();
    const at = location(token);
    if (token.text === '-') return { at, kind: 'primitive', op: 'neg', args: [this.expr(indices, 3)] };
    if (token.text === '(') {
      const value = this.expr(indices);
      this.expect(')');
      return value;
    }
    if (token.kind === 'number') {
      const value = Number(token.text);
      if (!Number.isFinite(value)) fail(at, 'literal must be a finite number');
      return { at, kind: 'number', value };
    }
    if (token.text === 'sum' || token.text === 'max') {
      this.expect('(');
      if (token.text === 'sum' || this.maxReduction()) {
        const axes = this.list(() => this.name().text, ')');
        return { at, kind: 'reduce', op: token.text, axes, body: this.expr(new Set([...indices, ...axes])) };
      }
      const left = this.expr(indices);
      this.expect(',');
      const right = this.expr(indices);
      this.expect(')');
      return { at, kind: 'primitive', op: 'max', args: [left, right] };
    }
    if (token.text === 'min' || unaryCalls.has(token.text)) {
      const op = token.text as 'min' | 'exp' | 'log' | 'sqrt' | 'tanh';
      this.expect('(');
      const args = [this.expr(indices)];
      if (op === 'min') {
        this.expect(',');
        args.push(this.expr(indices));
      }
      this.expect(')');
      return { at, kind: 'primitive', op, args };
    }
    if (token.kind !== 'name' || keywords.has(token.text)) fail(at, 'expected a scalar expression');
    if (this.peek().text !== '[') return { at, kind: 'shape', name: token.text };
    this.pop();
    const offsets = this.list(
      () =>
        this.affine(1, name => {
          if (!indices.has(name.text)) fail(name, `unbound index "${name.text}"`);
        }),
      ']',
    );
    return { at, kind: 'ref', tensor: token.text, indices: offsets };
  }

  private expr(indices: ReadonlySet<string>, min = 1): Expr<string> {
    let left = this.atom(indices);
    while (Object.hasOwn(binary, this.peek().text)) {
      const token = this.peek();
      const op = token.text as keyof typeof binary;
      if (binary[op] < min) break;
      this.pop();
      left = { at: location(token), kind: 'primitive', op, args: [left, this.expr(indices, binary[op] + 1)] };
    }
    return left;
  }

  private param(): Parameter {
    const name = this.name();
    this.expect(':');
    return { name: name.text, at: location(name), shape: this.type() };
  }

  private statement(): SourceStatement {
    const name = this.name();
    this.expect('[');
    const axes = this.list(() => this.name().text, ']');
    const shape = this.peek().text === ':' ? (this.pop(), this.boundType()) : undefined;
    this.expect('=');
    const expr = this.expr(new Set(axes));
    this.expect(';');
    return { at: location(name), name: name.text, axes, shape, expr };
  }

  private function(): SourceFunction {
    this.expect('fn');
    const name = this.name();
    this.expect('(');
    const params = this.list(() => this.param(), ')');
    this.shapeNames = new Set(
      params.flatMap(param => param.shape.flatMap(dim => dim.terms.map(([key]) => key))),
    );
    this.expect(':');
    const result = this.boundType();
    this.expect('{');
    const statements: SourceStatement[] = [];
    while (this.peek().text !== 'return') statements.push(this.statement());
    this.expect('return');
    const returns = this.name();
    this.expect(';');
    this.expect('}');
    return {
      name: name.text,
      at: location(name),
      params,
      statements,
      result,
      returns: returns.text,
      returnAt: location(returns),
    };
  }

  program(): SourceFunction[] {
    const functions = [this.function()];
    while (this.peek().kind !== 'end') functions.push(this.function());
    return functions;
  }
}

export function parse(source: string): SourceFunction[] {
  return new Parser(tokenize(source)).program();
}
