/**
 * IRWB-020-N: Tix lexer and parser. Produces a positioned syntax tree; every error is `line:col: message`.
 *
 * Precedence: unary minus, then `*` `/`, then `+` `-`, all left-associative. A reduction's body is a full
 * expression, so it extends as far right as possible (to the enclosing `)`, `,` or `;`). `max(a, b)` is a call
 * and `max(j) body` a reduction: when every name in the parentheses is a shape name of the function it is a call
 * (shape names cannot be indices), otherwise a reduction.
 */
export interface Pos {
  readonly line: number;
  readonly col: number;
}
export class TixError extends Error {
  constructor(
    readonly pos: Pos,
    message: string,
  ) {
    super(`${pos.line}:${pos.col}: ${message}`);
    this.name = 'TixError';
  }
}

type TokKind = 'name' | 'num' | 'punct' | 'eof';
interface Tok {
  readonly kind: TokKind;
  readonly text: string;
  readonly pos: Pos;
}

const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', ':', ';', '=', '+', '-', '*', '/']);
function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0,
    line = 1,
    col = 1;
  const adv = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      adv(1);
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') adv(1);
      continue;
    }
    const pos = { line, col };
    const rest = src.slice(i);
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      toks.push({ kind: 'name', text: name[0], pos });
      adv(name[0].length);
      continue;
    }
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      toks.push({ kind: 'num', text: num[0], pos });
      adv(num[0].length);
      continue;
    }
    if (PUNCT.has(ch)) {
      toks.push({ kind: 'punct', text: ch, pos });
      adv(1);
      continue;
    }
    throw new TixError(pos, `unexpected character '${ch}'`);
  }
  toks.push({ kind: 'eof', text: '<end of input>', pos: { line, col } });
  return toks;
}

// ---------- syntax tree ----------

export type Ex =
  | { readonly k: 'num'; readonly pos: Pos; readonly value: number; readonly text: string }
  | { readonly k: 'name'; readonly pos: Pos; readonly name: string }
  | { readonly k: 'ref'; readonly pos: Pos; readonly name: string; readonly args: readonly Ex[] }
  | { readonly k: 'neg'; readonly pos: Pos; readonly a: Ex }
  | {
      readonly k: 'bin';
      readonly pos: Pos;
      readonly op: '+' | '-' | '*' | '/';
      readonly a: Ex;
      readonly b: Ex;
    }
  | { readonly k: 'call'; readonly pos: Pos; readonly fn: string; readonly args: readonly Ex[] }
  | {
      readonly k: 'reduce';
      readonly pos: Pos;
      readonly kind: 'sum' | 'max';
      readonly indices: readonly { readonly name: string; readonly pos: Pos }[];
      readonly body: Ex;
    };
export interface TypeAst {
  readonly pos: Pos;
  readonly dims: readonly Ex[];
}
export interface StmtAst {
  readonly pos: Pos;
  readonly name: string;
  readonly indices: readonly { readonly name: string; readonly pos: Pos }[];
  readonly type?: TypeAst;
  readonly rhs: Ex;
}
export interface FnAst {
  readonly pos: Pos;
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly pos: Pos; readonly type: TypeAst }[];
  readonly result: TypeAst;
  readonly stmts: readonly StmtAst[];
  readonly ret: { readonly name: string; readonly pos: Pos };
}

const CALLS1 = new Set(['exp', 'log', 'sqrt', 'tanh']);
const CALLS2 = new Set(['max', 'min']);

export function parse(src: string): FnAst[] {
  const toks = lex(src);
  let p = 0;
  let shapes = new Set<string>();
  const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)];
  const next = () => toks[p++];
  const is = (text: string, o = 0) =>
    peek(o).kind !== 'num' && peek(o).text === text && peek(o).kind !== 'eof';
  const expect = (text: string): Tok => {
    const t = peek();
    if (!is(text)) throw new TixError(t.pos, `expected '${text}', found '${t.text}'`);
    return next();
  };
  const name = (what: string): Tok => {
    const t = peek();
    if (t.kind !== 'name') throw new TixError(t.pos, `expected ${what}, found '${t.text}'`);
    return next();
  };
  const type = (): TypeAst => {
    const t = name("'f32'");
    if (t.text !== 'f32') throw new TixError(t.pos, `expected 'f32', found '${t.text}'`);
    expect('[');
    const dims = [expr()];
    while (is(',')) {
      next();
      dims.push(expr());
    }
    expect(']');
    return { pos: t.pos, dims };
  };
  const nameList = () => {
    const out = [name('an index name')];
    while (is(',')) {
      next();
      out.push(name('an index name'));
    }
    return out.map(t => ({ name: t.text, pos: t.pos }));
  };

  function expr(): Ex {
    let a = term();
    while (is('+') || is('-')) {
      const op = next();
      a = { k: 'bin', pos: op.pos, op: op.text as '+' | '-', a, b: term() };
    }
    return a;
  }
  function term(): Ex {
    let a = unary();
    while (is('*') || is('/')) {
      const op = next();
      a = { k: 'bin', pos: op.pos, op: op.text as '*' | '/', a, b: unary() };
    }
    return a;
  }
  function unary(): Ex {
    if (is('-')) {
      const t = next();
      return { k: 'neg', pos: t.pos, a: unary() };
    }
    return primary();
  }
  /** Is `max(` at the cursor followed by a parenthesised list of names that are not all shape names? */
  function maxIsReduce(): boolean {
    let o = 2;
    const names: string[] = [];
    for (;;) {
      if (peek(o).kind !== 'name') return false;
      names.push(peek(o).text);
      if (is(')', o + 1)) break;
      if (!is(',', o + 1)) return false;
      o += 2;
    }
    return !names.every(n => shapes.has(n));
  }
  function primary(): Ex {
    const t = peek();
    if (t.kind === 'num') {
      next();
      return { k: 'num', pos: t.pos, value: Number(t.text), text: t.text };
    }
    if (is('(')) {
      next();
      const e = expr();
      expect(')');
      return e;
    }
    if (t.kind !== 'name') throw new TixError(t.pos, `expected an expression, found '${t.text}'`);
    if ((t.text === 'sum' || (t.text === 'max' && maxIsReduce())) && is('(', 1)) {
      next();
      next();
      const indices = nameList();
      expect(')');
      return { k: 'reduce', pos: t.pos, kind: t.text as 'sum' | 'max', indices, body: expr() };
    }
    if ((CALLS1.has(t.text) || CALLS2.has(t.text)) && is('(', 1)) {
      next();
      next();
      const args = [expr()];
      if (CALLS2.has(t.text)) {
        expect(',');
        args.push(expr());
      }
      expect(')');
      return { k: 'call', pos: t.pos, fn: t.text, args };
    }
    next();
    if (is('[')) {
      next();
      const args = [expr()];
      while (is(',')) {
        next();
        args.push(expr());
      }
      expect(']');
      return { k: 'ref', pos: t.pos, name: t.text, args };
    }
    return { k: 'name', pos: t.pos, name: t.text };
  }

  const fns: FnAst[] = [];
  do {
    const kw = name("'fn'");
    if (kw.text !== 'fn') throw new TixError(kw.pos, `expected 'fn', found '${kw.text}'`);
    const fname = name('a function name');
    expect('(');
    const params: FnAst['params'][number][] = [];
    for (;;) {
      const pn = name('a parameter name');
      expect(':');
      params.push({ name: pn.text, pos: pn.pos, type: type() });
      if (!is(',')) break;
      next();
    }
    expect(')');
    shapes = new Set(params.flatMap(q => q.type.dims.flatMap(d => (d.k === 'name' ? [d.name] : []))));
    expect(':');
    const result = type();
    expect('{');
    const stmts: StmtAst[] = [];
    while (!(peek().kind === 'name' && peek().text === 'return' && !is('[', 1))) {
      const sn = name("a statement or 'return'");
      expect('[');
      const indices = nameList();
      expect(']');
      let ty: TypeAst | undefined;
      if (is(':')) {
        next();
        ty = type();
      }
      expect('=');
      const rhs = expr();
      expect(';');
      stmts.push({ pos: sn.pos, name: sn.text, indices, type: ty, rhs });
    }
    next();
    const rn = name('the returned tensor');
    expect(';');
    expect('}');
    fns.push({ pos: kw.pos, name: fname.text, params, result, stmts, ret: { name: rn.text, pos: rn.pos } });
  } while (peek().kind !== 'eof');
  return fns;
}
