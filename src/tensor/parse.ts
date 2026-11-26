import { constant, fail, integer, minus, plus, scale, variable } from './model.js';
import type { Affine, Binary, Expr, Intrinsic, Loc, Named } from './model.js';

interface Token extends Loc {
  kind: 'name' | 'number' | 'punct' | 'eof';
  text: string;
}
const namePattern = /[A-Za-z_][A-Za-z_0-9]*/y;
export const numberText = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const reserved = new Set(['fn', 'return', 'f32', 'sum', 'max', 'min', 'exp', 'log', 'sqrt', 'tanh']);
const calls = new Set(['max', 'min', 'exp', 'log', 'sqrt', 'tanh']);

function* lex(source: string): Iterable<Token> {
  const number = new RegExp(numberText.source.slice(1, -1), 'y');
  const name = new RegExp(namePattern);
  let i = 0,
    line = 1,
    col = 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\r' || ch === '\n') {
      i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1;
      line++;
      col = 1;
    } else if (/\s/.test(ch)) {
      i++;
      col++;
    } else if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\r' && source[i] !== '\n') i++;
    } else {
      name.lastIndex = number.lastIndex = i;
      const n = name.exec(source),
        v = n ? null : number.exec(source);
      const kind = n ? 'name' : v ? 'number' : 'punct';
      const text = n?.[0] ?? v?.[0] ?? ch;
      if (kind === 'punct' && !'():[]{};,=+-*/'.includes(ch)) fail({ line, col }, `unexpected '${ch}'`);
      yield { kind, text, line, col };
      i += text.length;
      col += text.length;
    }
  }
  yield { kind: 'eof', text: '', line, col };
}

export interface RawSub {
  readonly form: Affine;
  readonly at: Loc;
  readonly names: readonly Named[];
  readonly plain?: string;
}
export type RawExpr = Expr<Named, RawSub>;
interface RawParam extends Named {
  shape: RawSub[];
}
export interface RawStmt extends Named {
  axes: Named[];
  shape?: RawSub[];
  expr: RawExpr;
}
export interface RawFn extends Named {
  params: RawParam[];
  resultShape: RawSub[];
  statements: RawStmt[];
  result: Named;
}

const precedence = (text: string) =>
  text === '+' || text === '-' ? 1 : text === '*' || text === '/' ? 2 : 0;
const loc = ({ line, col }: Loc): Loc => ({ line, col });

class Parser {
  private i = 0;
  private serial = 0;
  private shapeNames = new Set<string>();
  constructor(private readonly tokens: Token[]) {}
  private get token() {
    return this.tokens[this.i];
  }
  private take(text: string): boolean {
    if (this.token.text !== text) return false;
    this.i++;
    return true;
  }
  private need(text: string): void {
    if (!this.take(text)) fail(this.token, `expected '${text}'`);
  }
  private name(): Named {
    const tok = this.token;
    if (tok.kind !== 'name' || reserved.has(tok.text)) fail(tok, 'expected a name');
    this.i++;
    return { name: tok.text, at: loc(tok) };
  }
  private list<T>(parse: () => T): T[] {
    const values = [parse()];
    while (this.take(',')) values.push(parse());
    return values;
  }
  private type(): RawSub[] {
    this.need('f32');
    this.need('[');
    const dims = this.list(() => this.affine());
    this.need(']');
    return dims;
  }
  parse(): RawFn[] {
    const fns = [this.fn()];
    while (this.token.kind !== 'eof') fns.push(this.fn());
    return fns;
  }
  private fn(): RawFn {
    this.need('fn');
    const named = this.name();
    this.need('(');
    const params = this.list(() => {
      const param = this.name();
      this.need(':');
      return { ...param, shape: this.type() };
    });
    this.shapeNames = new Set(params.flatMap(p => p.shape.flatMap(d => d.names.map(n => n.name))));
    this.need(')');
    this.need(':');
    const resultShape = this.type();
    this.need('{');
    const statements = [];
    while (!this.take('return')) statements.push(this.stmt());
    const result = this.name();
    this.need(';');
    this.need('}');
    return { ...named, params, resultShape, statements, result };
  }
  private stmt(): RawStmt {
    const named = this.name();
    this.need('[');
    const axes = this.list(() => this.name());
    this.need(']');
    const shape = this.take(':') ? this.type() : undefined;
    this.need('=');
    const expr = this.expr();
    this.need(';');
    return { ...named, axes, shape, expr };
  }
  private affine(min = 1): RawSub {
    const tok = this.token,
      at = loc(tok);
    let a: RawSub;
    if (this.take('(')) {
      a = this.affine();
      this.need(')');
    } else if (this.take('-')) {
      const x = this.affine(3);
      a = { at, names: x.names, form: scale(x.form, -1, at) };
    } else if (tok.kind === 'number') {
      if (!/^\d+$/.test(tok.text)) fail(tok, 'expected an integer in an affine expression');
      this.i++;
      a = { at, names: [], form: constant(integer(Number(tok.text), at)) };
    } else {
      const n = this.name();
      a = { at, names: [n], plain: n.name, form: variable(n.name) };
    }
    for (;;) {
      const op = this.token,
        p = precedence(op.text);
      if (p < min) return a;
      if (op.text === '/') fail(op, 'division is not affine');
      this.i++;
      const b = this.affine(p + 1);
      let form: Affine;
      if (op.text === '+') form = plus(a.form, b.form, op);
      else if (op.text === '-') form = minus(a.form, b.form, op);
      else if (!a.form.terms.length) form = scale(b.form, a.form.c, op);
      else if (!b.form.terms.length) form = scale(a.form, b.form.c, op);
      else return fail(op, 'product of two variable expressions is not affine');
      a = { form, at, names: [...a.names, ...b.names] };
    }
  }
  private node(at: Loc) {
    return { id: `e${this.serial++}`, at: loc(at) };
  }
  private expr(min = 1): RawExpr {
    let a = this.atom();
    for (;;) {
      const op = this.token,
        p = precedence(op.text);
      if (p < min) return a;
      this.i++;
      a = { ...this.node(op), op: op.text as Binary, left: a, right: this.expr(p + 1) };
    }
  }
  /** For `max`, a names-only list plus a following body denotes a reduction. */
  private maxReduction(): boolean {
    let i = this.i;
    const names: string[] = [];
    do {
      const t = this.tokens[i++];
      if (t?.kind !== 'name' || reserved.has(t.text)) return false;
      names.push(t.text);
    } while (this.tokens[i++]?.text === ',');
    if (this.tokens[i - 1]?.text !== ')') return false;
    const t = this.tokens[i];
    if (names.length === 2 && t?.text === '-' && names.every(n => this.shapeNames.has(n))) return false;
    return (
      (t?.kind === 'name' && t.text !== 'return') ||
      t?.kind === 'number' ||
      t?.text === '(' ||
      t?.text === '-'
    );
  }
  private atom(): RawExpr {
    const tok = this.token;
    if (this.take('-')) return { ...this.node(tok), op: 'neg', arg: this.expr(3) };
    if (this.take('(')) {
      const expr = this.expr();
      this.need(')');
      return expr;
    }
    if (tok.kind === 'number') {
      this.i++;
      return { ...this.node(tok), op: 'literal', text: tok.text };
    }
    if (tok.text === 'sum' || calls.has(tok.text)) {
      this.i++;
      this.need('(');
      if (tok.text === 'sum' || (tok.text === 'max' && this.maxReduction())) {
        const axes = this.list(() => this.name());
        this.need(')');
        return { ...this.node(tok), op: tok.text, axes, body: this.expr() };
      }
      const args = [this.expr()];
      if (tok.text === 'max' || tok.text === 'min') {
        this.need(',');
        args.push(this.expr());
      }
      this.need(')');
      return { ...this.node(tok), op: 'call', fn: tok.text as Intrinsic, args };
    }
    const name = this.name();
    if (!this.take('[')) return { ...this.node(tok), op: 'shape', name: name.name };
    const subs = this.list(() => this.affine());
    this.need(']');
    return { ...this.node(tok), op: 'load', tensor: name.name, subs };
  }
}

export const parse = (source: string): RawFn[] => new Parser([...lex(source)]).parse();
