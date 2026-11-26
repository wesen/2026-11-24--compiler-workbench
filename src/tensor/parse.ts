import { add, constant, scale, variable, type Aff } from './affine.js';

export interface Token {
  text: string;
  at: string;
}
export const fail = (at: string, message: string): never => {
  throw Error(`${at}: ${message}`);
};
const ident = /^[A-Za-z_]\w*$/;
const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function lex(s: string): Token[] {
  const re = /\s+|\/\/[^\r\n]*|[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[(){}\[\],:;=+*/-]/gy;
  const tokens: Token[] = [];
  let pos = 0,
    line = 1,
    col = 1;
  while (pos < s.length) {
    const m = re.exec(s);
    if (!m) fail(`${line}:${col}`, 'unexpected character');
    const text = m![0];
    if (!/^\s|^\/\//.test(text)) tokens.push({ text, at: `${line}:${col}` });
    const parts = text.split(/\r\n|[\r\n]/);
    line += parts.length - 1;
    col = parts.length > 1 ? 1 + parts.at(-1)!.length : col + text.length;
    pos += text.length;
  }
  return [...tokens, { at: `${line}:${col}`, text: '' }];
}
export interface Subscript {
  form: Aff;
  names: Token[];
  direct?: string;
}
export interface Expr extends Token {
  op: string;
  args: Expr[];
  indices?: Subscript[];
  binders?: Token[];
}
interface Param extends Token {
  dims: Subscript[];
}
interface Stmt extends Token {
  axes: Token[];
  dims?: Subscript[];
  expr: Expr;
}
export interface Fn extends Param {
  params: Param[];
  stmts: Stmt[];
  ret: Token;
}

export function parse(source: string): Fn[] {
  const tokens = lex(source);
  let i = 0;
  const here = () => tokens[i],
    peek = () => here().text;
  const eat = (s: string) => (peek() === s ? (i++, true) : false);
  const need = (s: string) => {
    if (!eat(s)) fail(here().at, `expected '${s}'`);
  };
  const name = () => {
    if (!ident.test(peek()) || ['fn', 'return', 'f32'].includes(peek())) fail(here().at, 'expected name');
    return tokens[i++];
  };
  function list<T>(end: string, one: () => T): T[] {
    const out = [one()];
    while (eat(',')) out.push(one());
    need(end);
    return out;
  }
  function sub(): Subscript {
    const start = i,
      names: Token[] = [];
    function atom(): Aff {
      if (eat('-')) return scale(atom(), -1);
      if (eat('(')) {
        const a = sum();
        need(')');
        return a;
      }
      if (/^\d+$/.test(peek())) {
        const t = tokens[i++],
          n = Number(t.text);
        if (!Number.isSafeInteger(n)) fail(t.at, 'expected safe integer');
        return constant(n);
      }
      const t = name();
      names.push(t);
      return variable(t.text);
    }
    function product() {
      let a = atom();
      while (eat('*')) {
        const b = atom();
        if (a.terms.length && b.terms.length) fail(tokens[start].at, 'non-affine product');
        a = b.terms.length ? scale(b, a.c) : scale(a, b.c);
      }
      return a;
    }
    function sum() {
      let a = product();
      while (peek() === '+' || peek() === '-') {
        const k = eat('+') ? 1 : (i++, -1);
        a = add(a, product(), k);
      }
      return a;
    }
    try {
      const form = sum();
      return { form, names, ...(i === start + 1 && names.length ? { direct: names[0].text } : {}) };
    } catch (e) {
      if ((e as Error).message === 'affine integer overflow') fail(tokens[start].at, (e as Error).message);
      throw e;
    }
  }
  const type = () => {
    need('f32');
    need('[');
    return list(']', sub);
  };
  const shapes = new Set<string>();
  function prefix(): Expr {
    const t = here();
    if (eat('-')) return { ...t, op: 'neg', args: [prefix()] };
    if (eat('(')) {
      const x = expr();
      need(')');
      return x;
    }
    if (number.test(peek())) {
      i++;
      return { ...t, op: 'literal', args: [] };
    }
    name();
    if (eat('[')) return { ...t, op: 'load', indices: list(']', sub), args: [] };
    if (!eat('(')) return { ...t, op: 'shape', args: [] };
    if (t.text === 'max' || t.text === 'sum') {
      let j = i;
      const ns: Token[] = [];
      while (ident.test(tokens[j].text)) {
        ns.push(tokens[j++]);
        if (tokens[j].text !== ',') break;
        j++;
      }
      const next = tokens[j + 1]?.text ?? '';
      const body = number.test(next) || ident.test(next) || next === '(' || next === '-';
      if (
        t.text === 'sum' ||
        (ns.length &&
          tokens[j].text === ')' &&
          body &&
          !(next === '-' && ns.length === 2 && ns.every(n => shapes.has(n.text))))
      ) {
        const binders = list(')', name);
        return { ...t, op: `reduce.${t.text}`, binders, args: [expr()] };
      }
    }
    const args = list(')', () => expr());
    const arity = ['max', 'min'].includes(t.text)
      ? 2
      : ['exp', 'log', 'sqrt', 'tanh'].includes(t.text)
        ? 1
        : 0;
    if (!arity || args.length !== arity) fail(t.at, `invalid call ${t.text}`);
    return { ...t, op: t.text, args };
  }
  function expr(min = 0): Expr {
    let x = prefix();
    for (;;) {
      const t = here(),
        p = ['+', '-'].includes(t.text) ? 1 : ['*', '/'].includes(t.text) ? 2 : 0;
      if (!p || p < min) return x;
      i++;
      x = { ...t, op: t.text, args: [x, expr(p + 1)] };
    }
  }
  const fns: Fn[] = [];
  do {
    need('fn');
    const fn = name();
    need('(');
    const params = list(')', () => {
      const t = name();
      need(':');
      return { ...t, dims: type() };
    });
    shapes.clear();
    for (const p of params) for (const d of p.dims) for (const n of d.names) shapes.add(n.text);
    need(':');
    const dims = type();
    need('{');
    const stmts: Stmt[] = [];
    while (!eat('return')) {
      const t = name();
      need('[');
      const axes = list(']', name),
        annotation = eat(':') ? type() : undefined;
      need('=');
      const x = expr();
      need(';');
      stmts.push({ ...t, axes, dims: annotation, expr: x });
    }
    const ret = name();
    need(';');
    need('}');
    fns.push({ ...fn, params, dims, stmts, ret });
  } while (peek());
  return fns;
}
