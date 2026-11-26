/**
 * Tix source to a syntax tree with positions (IRWB-020). The grammar is the fixed core of the task; the open points
 * are resolved as the design's section 3 says. Errors are `Error` whose message starts with `line:col:`.
 */
export interface Pos {
  readonly line: number;
  readonly col: number;
}
export interface Named {
  readonly name: string;
  readonly pos: Pos;
}
export type AExpr = { readonly pos: Pos } & (
  | { readonly k: 'num'; readonly value: number; readonly text: string }
  | { readonly k: 'name'; readonly name: string }
  | { readonly k: 'ref'; readonly name: string; readonly subs: readonly AExpr[] }
  | { readonly k: 'neg'; readonly a: AExpr }
  | { readonly k: 'bin'; readonly op: '+' | '-' | '*' | '/'; readonly a: AExpr; readonly b: AExpr }
  | { readonly k: 'call'; readonly fn: string; readonly args: readonly AExpr[] }
  | {
      readonly k: 'reduce';
      readonly op: 'sum' | 'max';
      readonly indices: readonly Named[];
      readonly body: AExpr;
    }
);
export interface AType {
  readonly pos: Pos;
  readonly dims: readonly AExpr[];
}
export interface AStmt extends Named {
  readonly indices: readonly Named[];
  readonly type?: AType;
  readonly expr: AExpr;
}
export interface AFn extends Named {
  readonly params: readonly (Named & { readonly type: AType })[];
  readonly result: AType;
  readonly stmts: readonly AStmt[];
  readonly ret: Named;
}

export class TixError extends Error {
  constructor(
    readonly pos: Pos,
    readonly text: string,
  ) {
    super(`${pos.line}:${pos.col}: ${text}`);
    this.name = 'TixError';
  }
}

interface Token extends Pos {
  readonly t: 'name' | 'num' | 'punct' | 'eof';
  readonly text: string;
}
const PUNCT = '()[]{},:;=+-*/';
const NUMBER = /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

function tokens(source: string): Token[] {
  const out: Token[] = [];
  let i = 0,
    line = 1,
    col = 1;
  const advance = (n: number) => {
    for (; n > 0; n--) {
      if (source[i++] === '\n') (line++, (col = 1));
      else col++;
    }
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') advance(1);
    else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') advance(1);
    } else {
      let text: string | undefined,
        t: Token['t'] = 'punct';
      NUMBER.lastIndex = NAME.lastIndex = i;
      const num = NUMBER.exec(source),
        name = num ? null : NAME.exec(source);
      if (num) ((text = num[0]), (t = 'num'));
      else if (name) ((text = name[0]), (t = 'name'));
      else if (PUNCT.includes(ch)) text = ch;
      if (text === undefined) throw new TixError({ line, col }, `unexpected character ${JSON.stringify(ch)}`);
      out.push({ t, text, line, col });
      advance(text.length);
    }
  }
  out.push({ t: 'eof', text: 'end of input', line, col });
  return out;
}

const UNARY_CALLS = new Set(['exp', 'log', 'sqrt', 'tanh']);

/** The names an expression mentions bare (in a parameter's dims these are the shape names). */
function bareNames(e: AExpr, out: Set<string>): void {
  if (e.k === 'name') out.add(e.name);
  else if (e.k === 'neg') bareNames(e.a, out);
  else if (e.k === 'bin') (bareNames(e.a, out), bareNames(e.b, out));
}

export function parseTix(source: string): AFn[] {
  const toks = tokens(source);
  let p = 0;
  let shapes = new Set<string>();
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const pos = (t: Token): Pos => ({ line: t.line, col: t.col });
  const is = (text: string, k = 0) => peek(k).t !== 'num' && peek(k).t !== 'eof' && peek(k).text === text;
  const expect = (text: string): Token => {
    if (!is(text)) throw new TixError(pos(peek()), `expected '${text}', found '${peek().text}'`);
    return toks[p++];
  };
  const name = (what: string): Named => {
    const t = peek();
    if (t.t !== 'name') throw new TixError(pos(t), `expected ${what}, found '${t.text}'`);
    p++;
    return { name: t.text, pos: pos(t) };
  };
  const list = <T>(item: () => T): T[] => {
    const out = [item()];
    while (is(',')) (p++, out.push(item()));
    return out;
  };

  const type = (): AType => {
    const t = peek();
    if (!is('f32')) throw new TixError(pos(t), `expected a type 'f32[...]', found '${t.text}'`);
    p++;
    expect('[');
    const dims = list(expr);
    expect(']');
    return { pos: pos(t), dims };
  };

  /** After `max` at `(`: is the parenthesised part a list of bare names, and which? */
  const nameList = (): string[] | undefined => {
    const out: string[] = [];
    for (let k = 1; ; k += 2) {
      if (peek(k).t !== 'name') return undefined;
      out.push(peek(k).text);
      if (is(')', k + 1)) return out;
      if (!is(',', k + 1)) return undefined;
    }
  };
  const reduction = (op: 'sum' | 'max', at: Token): AExpr => {
    expect('(');
    const indices = list(() => name('an index name'));
    expect(')');
    // the body extends as far right as possible
    return { k: 'reduce', op, indices, body: expr(), pos: pos(at) };
  };
  const primary = (): AExpr => {
    const t = peek();
    if (t.t === 'num') {
      p++;
      return { k: 'num', value: Number(t.text), text: t.text, pos: pos(t) };
    }
    if (is('(')) {
      p++;
      const e = expr();
      expect(')');
      return e;
    }
    if (t.t !== 'name') throw new TixError(pos(t), `expected an expression, found '${t.text}'`);
    p++;
    if (is('(')) {
      if (t.text === 'sum') return reduction('sum', t);
      if (t.text === 'max') {
        // `max(N, D)` on shape values is a call; any other list of bare names binds reduction indices
        const names = nameList();
        if (names && !(names.length >= 2 && names.every(n => shapes.has(n)))) return reduction('max', t);
      }
      const arity = UNARY_CALLS.has(t.text) ? 1 : t.text === 'max' || t.text === 'min' ? 2 : 0;
      if (!arity) throw new TixError(pos(t), `unknown function '${t.text}'`);
      p++;
      const args = list(expr);
      expect(')');
      if (args.length !== arity)
        throw new TixError(
          pos(t),
          `'${t.text}' takes ${arity} argument${arity > 1 ? 's' : ''}, found ${args.length}`,
        );
      return { k: 'call', fn: t.text, args, pos: pos(t) };
    }
    if (is('[')) {
      p++;
      const subs = list(expr);
      expect(']');
      return { k: 'ref', name: t.text, subs, pos: pos(t) };
    }
    return { k: 'name', name: t.text, pos: pos(t) };
  };
  const unary = (): AExpr => {
    if (is('-')) {
      const t = toks[p++];
      return { k: 'neg', a: unary(), pos: pos(t) };
    }
    return primary();
  };
  const binary = (ops: string, next: () => AExpr) => (): AExpr => {
    let a = next();
    while (peek().t === 'punct' && ops.includes(peek().text)) {
      const t = toks[p++];
      a = { k: 'bin', op: t.text as '+', a, b: next(), pos: pos(t) };
    }
    return a;
  };
  const term = binary('*/', unary);
  const sum = binary('+-', term);
  function expr(): AExpr {
    return sum();
  }

  const fn = (): AFn => {
    expect('fn');
    const id = name('a function name');
    shapes = new Set();
    expect('(');
    const params = list(() => {
      const n = name('a parameter name');
      expect(':');
      const ty = type();
      return { ...n, type: ty };
    });
    expect(')');
    for (const q of params) for (const d of q.type.dims) bareNames(d, shapes);
    expect(':');
    const result = type();
    expect('{');
    const stmts: AStmt[] = [];
    while (!is('return')) {
      const n = name("a statement or 'return'");
      expect('[');
      const indices = list(() => name('an index name'));
      expect(']');
      let ty: AType | undefined;
      if (is(':')) (p++, (ty = type()));
      expect('=');
      const e = expr();
      expect(';');
      stmts.push({ ...n, indices, type: ty, expr: e });
    }
    p++;
    const ret = name('a tensor name');
    expect(';');
    expect('}');
    return { ...id, params, result, stmts, ret };
  };

  const fns = [fn()];
  while (peek().t !== 'eof') fns.push(fn());
  return fns;
}
