import { combine, constant, variable, type Affine } from './affine.js';
import {
  builtins,
  errorAt,
  namePattern,
  numberPattern,
  type Builtin,
  type Expr,
  type Op,
  type Param,
  type Span,
  type TensorFn,
} from './model.js';

interface Token extends Span {
  readonly kind: 'name' | 'number' | 'punct' | 'eof';
  readonly text: string;
}
interface Subscript {
  readonly form: Affine;
  readonly names: readonly string[];
  readonly plain: string | null;
}
interface RawLoad {
  readonly tensor: string;
  readonly subscripts: readonly Subscript[];
}
export type RawExpr = Expr<RawLoad, Token>;
export interface RawStmt {
  readonly name: string;
  readonly at: Span;
  readonly axes: readonly Token[];
  readonly shape?: Param['shape'];
  readonly expr: RawExpr;
}
export interface RawFn extends Omit<TensorFn, 'statements' | 'return'> {
  readonly statements: readonly RawStmt[];
  readonly returned: Token;
}

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0,
    line = 1,
    col = 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\r' || ch === '\n') {
      i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1;
      line++;
      col = 1;
      continue;
    }
    if (/[\t \f]/.test(ch)) {
      i++;
      col++;
      continue;
    }
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
      continue;
    }
    const tail = source.slice(i);
    const name = namePattern.exec(tail)?.[0],
      number = numberPattern.exec(tail)?.[0];
    const kind = name ? 'name' : number ? 'number' : 'punct';
    const text = name ?? number ?? ch;
    if (kind === 'punct' && !'()[],;:{}=+-*/'.includes(ch)) errorAt({ line, col }, `unexpected ${ch}`);
    tokens.push({ kind, text, line, col });
    i += text.length;
    col += text.length;
  }
  tokens.push({ kind: 'eof', text: '', line, col });
  return tokens;
}

const span = ({ line, col }: Span): Span => ({ line, col });
const precedence = new Map<string, number>([
  ['+', 1],
  ['-', 1],
  ['*', 2],
  ['/', 2],
]);

class Parser {
  private pos = 0;
  private shapes = new Set<string>();
  constructor(private tokens: Token[]) {}
  private get current() {
    return this.tokens[this.pos];
  }
  private take(text: string): boolean {
    if (this.current.text !== text) return false;
    this.pos++;
    return true;
  }
  private expect(text: string): void {
    if (!this.take(text)) errorAt(this.current, `expected '${text}'`);
  }
  private name(): Token {
    const t = this.current;
    if (t.kind !== 'name') errorAt(t, 'expected a name');
    this.pos++;
    return t;
  }
  private list<T>(read: () => T): T[] {
    const list = [read()];
    while (this.take(',')) list.push(read());
    return list;
  }
  private affine(min = 1): Subscript {
    const t = this.current;
    let left: Subscript;
    if (this.take('-')) {
      const a = this.affine(3);
      left = { form: combine(constant(0), a.form, -1, t), names: a.names, plain: null };
    } else if (this.take('(')) {
      left = { ...this.affine(), plain: null };
      this.expect(')');
    } else if (t.kind === 'number') {
      this.pos++;
      if (!/^\d+$/.test(t.text) || !Number.isSafeInteger(Number(t.text)))
        errorAt(t, 'expected an integer in affine expression');
      left = { form: constant(Number(t.text)), names: [], plain: null };
    } else {
      const { text } = this.name();
      left = { form: variable(text), names: [text], plain: text };
    }
    for (;;) {
      const op = this.current;
      const p = precedence.get(op.text) ?? 0;
      if (p < min || op.text === '/') break;
      this.pos++;
      const right = this.affine(p + 1);
      const a = left.form,
        b = right.form;
      let form: Affine;
      if (op.text === '*') {
        if (a.terms.length && b.terms.length) errorAt(op, 'non-affine multiplication');
        form = a.terms.length
          ? combine(constant(0), a, b.constant, op)
          : combine(constant(0), b, a.constant, op);
      } else form = combine(a, b, op.text === '+' ? 1 : -1, op);
      left = { form, names: [...left.names, ...right.names], plain: null };
    }
    return left;
  }
  private type(onNames?: (names: readonly string[]) => void): Param['shape'] {
    this.expect('f32');
    this.expect('[');
    const shape = this.list(() => {
      const t = this.current;
      const { form, names } = this.affine();
      if (onNames) onNames(names);
      else for (const name of names) if (!this.shapes.has(name)) errorAt(t, `unknown shape name '${name}'`);
      return form;
    });
    this.expect(']');
    return shape;
  }
  /** `max(a,b)` needs one lookahead past a potential binder list. */
  private maxReduction(): boolean {
    let i = this.pos + 1;
    const names = [];
    for (;;) {
      if (this.tokens[i]?.kind !== 'name') return false;
      names.push(this.tokens[i++].text);
      if (this.tokens[i].text !== ',') break;
      i++;
    }
    if (this.tokens[i++].text !== ')') return false;
    const body = this.tokens[i];
    if (body.text === '-') return names.length !== 2 || !names.every(n => this.shapes.has(n));
    return body.text === '(' || body.kind === 'number' || body.kind === 'name';
  }
  private atom(): RawExpr {
    const t = this.current,
      at = span(t);
    if (this.take('-')) return { tag: 'neg', at, body: this.atom() };
    if (this.take('(')) {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.kind === 'number') {
      this.pos++;
      return { tag: 'literal', at, text: t.text };
    }
    const { text } = this.name();
    if (this.take('[')) {
      const subscripts = this.list(() => this.affine());
      this.expect(']');
      return { tag: 'load', at, load: { tensor: text, subscripts } };
    }
    if (this.current.text === '(') {
      const reduce = text === 'sum' || (text === 'max' && this.maxReduction());
      this.expect('(');
      if (reduce) {
        const axes = this.list(() => this.name());
        this.expect(')');
        return { tag: 'fold', at, op: text as 'sum' | 'max', axes, body: this.expr() };
      }
      if (!(builtins as readonly string[]).includes(text)) errorAt(t, `unknown function '${text}'`);
      const args = this.list(() => this.expr());
      this.expect(')');
      const arity = text === 'max' || text === 'min' ? 2 : 1;
      if (args.length !== arity) errorAt(t, `${text} needs ${arity} arguments`);
      return { tag: 'call', at, op: text as Builtin, args };
    }
    return { tag: 'shape', at, text };
  }
  private expr(min = 1): RawExpr {
    let left = this.atom();
    while ((precedence.get(this.current.text) ?? 0) >= min) {
      const token = this.current;
      this.pos++;
      const right = this.expr(precedence.get(token.text)! + 1);
      left = { tag: 'binary', at: span(token), op: token.text as Op, left, right };
    }
    return left;
  }
  private fn(): RawFn {
    this.expect('fn');
    const name = this.name();
    this.shapes.clear();
    this.expect('(');
    const params = this.list(() => {
      const param = this.name();
      this.expect(':');
      return {
        name: param.text,
        at: span(param),
        shape: this.type(names => names.forEach(n => this.shapes.add(n))),
      };
    });
    this.expect(')');
    this.expect(':');
    const result = this.type();
    this.expect('{');
    const statements: RawStmt[] = [];
    while (!this.take('return')) {
      const stmt = this.name();
      this.expect('[');
      const axes = this.list(() => this.name());
      this.expect(']');
      const shape = this.take(':') ? this.type() : undefined;
      this.expect('=');
      const expr = this.expr();
      this.expect(';');
      statements.push({ name: stmt.text, at: span(stmt), axes, shape, expr });
    }
    const returned = this.name();
    this.expect(';');
    this.expect('}');
    return { name: name.text, at: span(name), params, result, statements, returned };
  }
  parse(): RawFn[] {
    const fns = [this.fn()];
    while (this.current.kind !== 'eof') fns.push(this.fn());
    return fns;
  }
}

export const parse = (source: string): RawFn[] => new Parser(lex(source)).parse();
