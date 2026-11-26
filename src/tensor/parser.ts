import {
  add,
  constant,
  plain,
  variable,
  type Affine,
  type Axis,
  type Expr,
  type Fn,
  type Module,
  type Op,
  type Statement,
  type Tensor,
} from './model.js';

interface Token {
  text: string;
  line: number;
  col: number;
}
function fail(t: Token, message: string): never {
  throw Error(`${t.line}:${t.col} ${message}`);
}
const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const name = /^[A-Za-z_]\w*$/;
function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const parts =
    /\/\/[^\r\n]*|\r\n|[\r\n]|[^\S\r\n]+|[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|./gy;
  let line = 1,
    col = 1;
  for (const [text] of source.matchAll(parts)) {
    if (text === '\n' || text === '\r' || text === '\r\n') {
      line++;
      col = 1;
      continue;
    }
    if (!/^\s|^\/\//.test(text)) tokens.push({ text, line, col });
    col += text.length;
  }
  return [...tokens, { text: '<end>', line, col }];
}
interface Binder {
  id: string;
  token: Token;
  dim?: Affine;
}
interface Access {
  index: Affine;
  extent: Affine;
  token: Token;
  binders: Map<string, Binder>;
}
function checkBounds({ index, extent, token, binders }: Access) {
  if ([...binders.values()].some(b => b.dim && !b.dim.terms.length && b.dim.constant === 0)) return;
  let lo = constant(index.constant),
    hi = constant(index.constant),
    excess: Affine;
  try {
    for (const [id, k] of index.terms) {
      const last = add(binders.get(id)!.dim!, constant(-1));
      if (k < 0) lo = add(lo, last, k);
      else hi = add(hi, last, k);
    }
    excess = add(hi, extent, -1);
  } catch (error) {
    fail(token, (error as Error).message);
  }
  if ((!lo.terms.length && lo.constant < 0) || (!excess.terms.length && excess.constant >= 0))
    fail(token, 'Index outside axis');
}
export function parse(source: string): Module {
  return new Parser(lex(source)).program();
}
class Parser {
  private pos = 0;
  private nextId = 0;
  private tensors = new Map<string, Tensor>();
  private symbols = new Set<string>();
  private scope = new Map<string, Binder>();
  // Extents can be inferred by a later read in the same RHS.
  private accesses: Access[] = [];
  constructor(private tokens: Token[]) {}
  private get t() {
    return this.tokens[this.pos];
  }
  private take(s: string) {
    if (this.t.text !== s) return false;
    this.pos++;
    return true;
  }
  private expect(s: string) {
    if (!this.take(s)) fail(this.t, `Expected ${s}`);
  }
  private ident() {
    const t = this.t;
    if (!name.test(t.text)) fail(t, 'Expected name');
    this.pos++;
    return t;
  }
  private list<T>(read: () => T): T[] {
    const out = [read()];
    while (this.take(',')) out.push(read());
    return out;
  }
  program(): Module {
    const functions: Fn[] = [];
    do {
      const t = this.t;
      const fn = this.fn();
      if (functions.some(f => f.name === fn.name)) fail(t, 'Duplicate function');
      functions.push(fn);
    } while (this.t.text !== '<end>');
    return { functions };
  }
  private affine(index: boolean, min = 0): Affine {
    const start = this.t;
    let a: Affine;
    if (this.take('-')) a = add(constant(0), this.affine(index, 3), -1);
    else if (this.take('(')) {
      a = this.affine(index);
      this.expect(')');
    } else if (/^\d+$/.test(start.text)) {
      this.pos++;
      a = constant(Number(start.text));
      if (!Number.isSafeInteger(a.constant)) fail(start, 'Invalid integer');
    } else {
      const n = this.ident();
      const binder = this.scope.get(n.text);
      if (index && !binder) fail(n, 'Unknown index');
      a = variable(index ? binder!.id : n.text);
    }
    while (true) {
      const op = this.t,
        prec = op.text === '*' ? 2 : ['+', '-'].includes(op.text) ? 1 : 0;
      if (prec <= min) break;
      this.pos++;
      const b = this.affine(index, prec);
      try {
        if (op.text === '*') {
          if (a.terms.length && b.terms.length) fail(op, 'Non-affine product');
          a = a.terms.length ? add(constant(0), a, b.constant) : add(constant(0), b, a.constant);
        } else a = add(a, b, op.text === '+' ? 1 : -1);
      } catch (error) {
        fail(op, (error as Error).message);
      }
    }
    return a;
  }
  private type(input = false) {
    this.expect('f32');
    this.expect('[');
    const dims = this.list(() => {
      const t = this.t,
        d = this.affine(false);
      if (!d.terms.length && d.constant < 0) fail(t, 'Negative dimension');
      if (!input) for (const [n] of d.terms) if (!this.symbols.has(n)) fail(t, 'Unbound shape ' + n);
      return d;
    });
    this.expect(']');
    return dims;
  }
  private fn(): Fn {
    this.tensors.clear();
    this.symbols.clear();
    this.nextId = 0;
    this.expect('fn');
    const fn = this.ident().text;
    this.expect('(');
    const positions: Token[] = [];
    const params = this.list(() => {
      const n = this.ident();
      positions.push(n);
      if (this.tensors.has(n.text)) fail(n, 'Duplicate parameter');
      this.expect(':');
      const p = { name: n.text, shape: this.type(true) };
      this.tensors.set(p.name, p);
      return p;
    });
    for (const p of params)
      for (const d of p.shape) {
        const n = plain(d);
        if (n) this.symbols.add(n);
      }
    params.forEach((p, i) => {
      for (const d of p.shape)
        for (const [n] of d.terms) if (!this.symbols.has(n)) fail(positions[i], 'No input axis binds ' + n);
    });
    this.expect(')');
    this.expect(':');
    const shape = this.type();
    this.expect('{');
    const statements: Statement[] = [];
    while (!this.take('return')) statements.push(this.statement());
    const result = this.ident(),
      tensor = this.tensors.get(result.text);
    if (!tensor || JSON.stringify(tensor.shape) !== JSON.stringify(shape))
      fail(result, 'Invalid return tensor or shape');
    this.expect(';');
    this.expect('}');
    return { name: fn, params, statements, result: result.text, shape };
  }
  private binders() {
    const seen = new Set<string>();
    return this.list(() => {
      const token = this.ident();
      if (seen.has(token.text)) fail(token, 'Duplicate binder');
      seen.add(token.text);
      const b: Binder = { token, id: 'i' + this.nextId++ };
      this.scope.set(token.text, b);
      return b;
    });
  }
  private axes(binders: Binder[]): Axis[] {
    return binders.map(b => ({
      id: b.id,
      extent: { kind: 'dim', dim: b.dim ?? fail(b.token, 'Cannot infer extent') },
    }));
  }
  private statement(): Statement {
    this.scope.clear();
    this.accesses = [];
    const t = this.ident();
    if (this.tensors.has(t.text)) fail(t, 'Tensor already assigned');
    this.expect('[');
    const binders = this.binders();
    this.expect(']');
    if (this.take(':')) {
      const dims = this.type();
      if (dims.length !== binders.length) fail(t, 'Declared rank mismatch');
      binders.forEach((b, i) => (b.dim = dims[i]));
    }
    this.expect('=');
    const expr = this.expr();
    this.expect(';');
    const axes = this.axes(binders),
      shape = binders.map(b => b.dim!);
    this.accesses.forEach(checkBounds);
    const s = { name: t.text, shape, axes, expr };
    this.tensors.set(s.name, s);
    return s;
  }
  private expr(min = 0): Expr {
    let e = this.primary();
    while (true) {
      const op = this.t.text,
        prec = ['+', '-'].includes(op) ? 1 : ['*', '/'].includes(op) ? 2 : 0;
      if (prec <= min) return e;
      this.pos++;
      e = { kind: 'op', op: op as Op, args: [e, this.expr(prec)] };
    }
  }
  private maxBinderList() {
    let i = this.pos,
      names: string[] = [];
    while (name.test(this.tokens[i].text)) {
      names.push(this.tokens[i++].text);
      if (this.tokens[i].text !== ',') break;
      i++;
    }
    if (this.tokens[i].text !== ')') return false;
    const next = this.tokens[i + 1]?.text ?? '';
    return (
      (next === '(' || next === '-' || name.test(next) || number.test(next)) &&
      !(next === '-' && names.length === 2 && names.every(n => this.symbols.has(n)))
    );
  }
  private primary(): Expr {
    const t = this.t;
    if (this.take('-')) return { kind: 'op', op: 'neg', args: [this.expr(2)] };
    if (this.take('(')) {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (number.test(t.text)) {
      this.pos++;
      return { kind: 'literal', text: t.text };
    }
    const n = this.ident().text;
    if (this.take('[')) {
      const tensor = this.tensors.get(n);
      if (!tensor) fail(t, 'Unknown tensor ' + n);
      let axis = 0;
      const indices = this.list(() => {
        const start = this.pos,
          tok = this.t,
          a = this.affine(true);
        const d = tensor.shape[axis++];
        if (!d) fail(tok, 'Too many axes');
        if (this.pos === start + 1 && name.test(tok.text)) {
          const b = this.scope.get(tok.text)!;
          if (b.dim && JSON.stringify(b.dim) !== JSON.stringify(d)) fail(tok, 'Inconsistent extent');
          b.dim = d;
        }
        const binders = new Map([...this.scope.values()].map(b => [b.id, b]));
        this.accesses.push({ index: a, extent: d, token: tok, binders });
        return a;
      });
      this.expect(']');
      if (indices.length !== tensor.shape.length) fail(t, 'Wrong reference rank');
      return { kind: 'load', name: n, indices };
    }
    if (this.take('(')) {
      if (n === 'sum' || (n === 'max' && this.maxBinderList())) {
        const outer = this.scope;
        this.scope = new Map(outer);
        const binders = this.binders();
        this.expect(')');
        const body = this.expr(),
          axes = this.axes(binders);
        this.scope = outer;
        return { kind: 'reduce', op: n, axes, body };
      }
      const args = this.list(() => this.expr());
      this.expect(')');
      const arity = ['exp', 'log', 'sqrt', 'tanh'].includes(n) ? 1 : ['max', 'min'].includes(n) ? 2 : 0;
      if (!arity || args.length !== arity) fail(t, 'Invalid intrinsic call');
      return { kind: 'op', op: n as Op, args };
    }
    if (!this.symbols.has(n)) fail(t, 'Unknown shape ' + n);
    return { kind: 'shape', name: n };
  }
}
