import { add, constant, fail, plain, same, sameShape, scale, variable } from './model.js';
import type { Affine, Axis, Binary, Expr, Fn, Module, Param, Statement, Unary } from './model.js';

type Token = { text: string; at: string };
type Binder = { token: Token; id: string; extent?: Affine };
const ident = /^[A-Za-z_]\w*$/;
const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function tokens(source: string): Token[] {
  const result: Token[] = [];
  const lex = /\/\/[^\n]*|\s+|[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()[\]{},:;=+*/-]|./gy;
  let line = 1,
    col = 1;
  for (const [text] of source.matchAll(lex)) {
    if (!/^\s|^\/\//.test(text)) result.push({ text, at: line + ':' + col });
    for (const c of text) {
      if (c === '\n') {
        line++;
        col = 1;
      } else col++;
    }
  }
  result.push({ text: '<end>', at: line + ':' + col });
  return result;
}
class Parser {
  private pos = 0;
  private serial = 0;
  private shapes = new Set<string>();
  private shapeTokens = new Map<string, Token>();
  private tensors = new Map<string, Affine[]>();
  private scope = new Map<string, Binder>();
  constructor(private input: Token[]) {}
  private get t() {
    return this.input[this.pos];
  }
  private take(text: string) {
    if (this.t.text !== text) return false;
    this.pos++;
    return true;
  }
  private expect(text: string) {
    if (!this.take(text)) fail(this.t.at, 'expected ' + text + ', found ' + this.t.text);
  }
  private name() {
    const t = this.t;
    if (!ident.test(t.text)) fail(t.at, 'expected name');
    this.pos++;
    return t;
  }
  private list<T>(end: string, item: () => T) {
    const items = [item()];
    while (this.take(',')) items.push(item());
    this.expect(end);
    return items;
  }
  private affine(resolve: (t: Token) => string): Affine {
    const atom = (): Affine => {
      const t = this.t;
      if (this.take('-')) return scale(atom(), -1);
      if (this.take('(')) {
        const a = this.affine(resolve);
        this.expect(')');
        return a;
      }
      if (/^\d+$/.test(t.text)) {
        this.pos++;
        return constant(Number(t.text));
      }
      return variable(resolve(this.name()));
    };
    const product = () => {
      let a = atom();
      while (this.take('*')) {
        const t = this.t,
          b = atom();
        if (a.terms.length && b.terms.length) fail(t.at, 'non-affine product');
        a = a.terms.length ? scale(a, b.constant) : scale(b, a.constant);
      }
      return a;
    };
    let a = product();
    while (this.t.text === '+' || this.t.text === '-') {
      const sign = this.t.text === '-' ? -1 : 1;
      this.pos++;
      a = add(a, scale(product(), sign));
    }
    if (!Number.isSafeInteger(a.constant) || a.terms.some(([, k]) => !Number.isSafeInteger(k)))
      fail(this.t.at, 'affine integer out of range');
    return a;
  }
  private type(input = false): Affine[] {
    this.expect('f32');
    this.expect('[');
    return this.list(']', () => {
      const t = this.t;
      const dim = this.affine(n => {
        if (input) this.shapeTokens.set(n.text, n);
        if (!input && !this.shapes.has(n.text)) fail(n.at, 'unknown shape ' + n.text);
        return n.text;
      });
      if (!dim.terms.length && dim.constant < 0) fail(t.at, 'negative extent');
      return dim;
    });
  }
  private bind(names: Token[], declared?: Affine[]): Binder[] {
    if (declared && declared.length !== names.length) fail(names[0].at, 'axis rank mismatch');
    const seen = new Set<string>();
    return names.map((token, i) => {
      if (seen.has(token.text)) fail(token.at, 'duplicate index ' + token.text);
      seen.add(token.text);
      const b = { token, id: token.text + '@' + this.serial++, extent: declared?.[i] };
      this.scope.set(token.text, b);
      return b;
    });
  }
  private axes(bs: Binder[]): Axis[] {
    return bs.map(b => ({
      id: b.id,
      extent: b.extent ?? fail(b.token.at, 'cannot infer extent of ' + b.token.text),
    }));
  }
  private reductionHead(): boolean {
    // Two scalar shape arguments of max form a call, including when followed by subtraction.
    let p = this.pos;
    const names: string[] = [];
    if (this.input[p++].text !== '(') return false;
    while (ident.test(this.input[p].text)) {
      names.push(this.input[p++].text);
      if (this.input[p].text === ')') return names.length !== 2 || !names.every(n => this.shapes.has(n));
      if (this.input[p++].text !== ',') return false;
    }
    return false;
  }
  private primary(): Expr {
    const t = this.t,
      at = t.at;
    if (this.take('-')) return { kind: 'unary', op: '-', at, arg: this.primary() };
    if (this.take('(')) {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (number.test(t.text)) {
      this.pos++;
      return { kind: 'literal', at, value: t.text };
    }
    const n = this.name().text;
    if (this.take('[')) {
      const shape = this.tensors.get(n) ?? fail(at, 'unknown tensor ' + n);
      const indices = this.list(']', () => {
        const start = this.pos;
        const index = this.affine(
          name => this.scope.get(name.text)?.id ?? fail(name.at, 'unbound index ' + name.text),
        );
        return { index, binder: this.pos === start + 1 ? this.scope.get(this.input[start].text) : undefined };
      });
      if (indices.length !== shape.length) fail(at, 'rank mismatch for ' + n);
      indices.forEach(({ binder }, i) => {
        if (!binder) return;
        if (binder.extent && !same(binder.extent, shape[i]))
          fail(at, 'inconsistent extent of ' + binder.token.text);
        binder.extent = shape[i];
      });
      return { kind: 'load', at, tensor: n, indices: indices.map(i => i.index) };
    }
    if (n === 'sum' || (n === 'max' && this.reductionHead())) {
      this.expect('(');
      const names = this.list(')', () => this.name());
      const outer = this.scope;
      this.scope = new Map(outer);
      const bs = this.bind(names),
        body = this.expr();
      this.scope = outer;
      return { kind: 'reduce', at, op: n, axes: this.axes(bs), body };
    }
    if (this.take('(')) {
      const args = this.list(')', () => this.expr());
      if (['sqrt', 'exp', 'log', 'tanh'].includes(n) && args.length === 1)
        return { kind: 'unary', at, op: n as Unary, arg: args[0] };
      if ((n === 'max' || n === 'min') && args.length === 2)
        return { kind: 'binary', at, op: n, left: args[0], right: args[1] };
      fail(at, 'unknown function or wrong arity: ' + n);
    }
    if (!this.shapes.has(n)) fail(at, 'unknown shape ' + n);
    return { kind: 'shape', at, name: n };
  }
  private expr(min = 0): Expr {
    let left = this.primary();
    for (;;) {
      const { text, at } = this.t;
      const prec = text === '+' || text === '-' ? 1 : text === '*' || text === '/' ? 2 : 0;
      if (!prec || prec < min) return left;
      this.pos++;
      left = { kind: 'binary', at, op: text as Binary, left, right: this.expr(prec + 1) };
    }
  }
  private fn(): Fn {
    this.expect('fn');
    const name = this.name().text;
    this.tensors.clear();
    this.shapes.clear();
    this.shapeTokens.clear();
    this.expect('(');
    const params: Param[] = this.list(')', () => {
      const t = this.name();
      if (this.tensors.has(t.text)) fail(t.at, 'duplicate parameter ' + t.text);
      this.expect(':');
      const shape = this.type(true);
      this.tensors.set(t.text, shape);
      return { name: t.text, shape };
    });
    for (const p of params)
      for (const d of p.shape) {
        const n = plain(d);
        if (n) this.shapes.add(n);
      }
    for (const p of params)
      for (const d of p.shape)
        for (const [n] of d.terms)
          if (!this.shapes.has(n))
            fail(this.shapeTokens.get(n)!.at, 'shape ' + n + ' needs a plain parameter axis');
    this.expect(':');
    const shape = this.type();
    this.expect('{');
    const statements: Statement[] = [];
    while (!this.take('return')) {
      const t = this.name();
      if (this.tensors.has(t.text)) fail(t.at, 'tensor already assigned: ' + t.text);
      this.expect('[');
      const names = this.list(']', () => this.name());
      this.scope.clear();
      const bs = this.bind(names, this.take(':') ? this.type() : undefined);
      this.expect('=');
      const expr = this.expr();
      this.expect(';');
      const axes = this.axes(bs);
      statements.push({ name: t.text, axes, expr });
      this.tensors.set(
        t.text,
        axes.map(a => a.extent),
      );
    }
    const ret = this.name();
    const actual = this.tensors.get(ret.text) ?? fail(ret.at, 'unknown return tensor');
    if (!sameShape(actual, shape)) fail(ret.at, 'return shape mismatch');
    this.expect(';');
    this.expect('}');
    return { name, params, statements, result: ret.text, shape };
  }
  program(): Module {
    const functions: Fn[] = [],
      names = new Set<string>();
    do {
      const at = this.t.at,
        fn = this.fn();
      if (names.has(fn.name)) fail(at, 'duplicate function ' + fn.name);
      names.add(fn.name);
      functions.push(fn);
    } while (this.t.text !== '<end>');
    return { functions };
  }
}
export function parse(source: string): Module {
  return new Parser(tokens(source)).program();
}
