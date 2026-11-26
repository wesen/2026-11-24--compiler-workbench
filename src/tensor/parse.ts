import {
  add,
  arities,
  constant,
  fail,
  plain,
  same,
  variable,
  type Aff,
  type Binder,
  type Def,
  type Expr,
  type Fn,
  type Program,
  type Stmt,
} from './model.js';

interface Token {
  text: string;
  at: string;
}
const ident = /^[a-zA-Z_]\w*$/;
function lex(source: string): Token[] {
  const re = /\s+|\/\/[^\r\n]*|[a-zA-Z_]\w*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[()[\]{},:;=+*/-]/y;
  const out: Token[] = [];
  let i = 0,
    line = 1,
    col = 1;
  while (i < source.length) {
    re.lastIndex = i;
    const text = re.exec(source)?.[0] ?? fail(`${line}:${col}`, 'unexpected character');
    if (!/^\s|^\/\//.test(text)) out.push({ text, at: `${line}:${col}` });
    const lines = text.split(/\r\n|\n|\r/);
    line += lines.length - 1;
    col = lines.length > 1 ? lines.at(-1)!.length + 1 : col + text.length;
    i += text.length;
  }
  out.push({ text: '<EOF>', at: `${line}:${col}` });
  return out;
}
export function parse(source: string): Program {
  const tokens = lex(source);
  let pos = 0,
    serial = 0;
  const peek = () => tokens[pos],
    eat = (s: string) => peek().text === s && (++pos, true);
  function expect(s: string) {
    if (!eat(s)) fail(peek().at, `expected ${s}, found ${peek().text}`);
  }
  function name() {
    const t = peek();
    if (!ident.test(t.text)) fail(t.at, 'expected name');
    pos++;
    return t;
  }
  const node = (t: Token) => ({ at: t.at, id: `n${++serial}` });
  function list<T>(item: () => T, end: string) {
    const xs = [item()];
    while (eat(',')) xs.push(item());
    expect(end);
    return xs;
  }
  function affine(resolve: (t: Token) => string): Aff {
    function primary(): Aff {
      const t = peek();
      if (eat('-')) return add(constant(0), primary(), -1);
      if (eat('(')) {
        const a = sum();
        expect(')');
        return a;
      }
      if (/^\d+$/.test(t.text)) {
        pos++;
        return constant(Number(t.text));
      }
      return variable(resolve(name()));
    }
    function product() {
      let a = primary();
      while (eat('*')) {
        const t = peek(),
          b = primary();
        if (a.terms.length && b.terms.length) fail(t.at, 'non-affine product');
        a = a.terms.length ? add(constant(0), a, b.c) : add(constant(0), b, a.c);
      }
      return a;
    }
    function sum() {
      let a = product();
      while (peek().text === '+' || peek().text === '-') {
        const sign = tokens[pos++].text;
        a = add(a, product(), sign === '+' ? 1 : -1);
      }
      return a;
    }
    return sum();
  }
  function type(known?: Set<string>) {
    expect('f32');
    expect('[');
    return list(
      () => affine(t => (!known || known.has(t.text) ? t.text : fail(t.at, `unknown variable ${t.text}`))),
      ']',
    );
  }
  const functions: Fn[] = [];
  do {
    expect('fn');
    const ft = name();
    if (functions.some(f => f.name === ft.text)) fail(ft.at, 'duplicate function');
    expect('(');
    const defs = new Map<string, Def>();
    function freshDef() {
      const t = name();
      if (defs.has(t.text)) fail(t.at, 'tensor already defined');
      return { ...node(t), name: t.text };
    }
    const params = list(() => {
      const p = freshDef();
      expect(':');
      const d = { ...p, shape: type() };
      defs.set(d.name, d);
      return d;
    }, ')');
    expect(':');
    const shapeNames = new Set(params.flatMap(p => p.shape.flatMap(a => a.terms.map(([k]) => k))));
    const shape = type(shapeNames);
    expect('{');
    const stmts: Stmt[] = [];
    while (peek().text !== 'return') {
      const s = freshDef();
      let scope = new Map<string, Binder>();
      const inferred = new Set<string>();
      function bind(end: string) {
        const local = new Set<string>();
        return list(() => {
          const t = name();
          if (local.has(t.text)) fail(t.at, 'duplicate index');
          local.add(t.text);
          const b = { ...node(t), name: t.text, dim: constant(0) };
          scope.set(t.text, b);
          return b;
        }, end);
      }
      function constrain(b: Binder, dim: Aff, at: string) {
        if (inferred.has(b.id) && !same(b.dim, dim)) fail(at, `conflicting extent for ${b.name}`);
        b.dim = dim;
        inferred.add(b.id);
      }
      function finish(bs: Binder[]) {
        for (const b of bs) if (!inferred.has(b.id)) fail(b.at, `cannot infer extent of ${b.name}`);
      }
      expect('[');
      const axes = bind(']');
      if (eat(':')) {
        const ann = type(shapeNames);
        if (ann.length !== axes.length) fail(s.at, 'annotation rank mismatch');
        axes.forEach((b, i) => constrain(b, ann[i], s.at));
      }
      expect('=');
      function maxBinder() {
        let i = pos;
        const ns: string[] = [];
        while (ident.test(tokens[i].text)) {
          ns.push(tokens[i++].text);
          if (tokens[i].text !== ',') break;
          i++;
        }
        if (tokens[i].text !== ')') return false;
        return (
          ns.length !== 2 ||
          !ns.every(n => shapeNames.has(n)) ||
          ![';', ',', ')', '+', '-', '*', '/'].includes(tokens[i + 1]?.text)
        );
      }
      function prefix(): Expr {
        const t = peek(),
          base = node(t);
        if (eat('-')) return { ...base, tag: 'op', op: 'neg', args: [prefix()] };
        if (eat('(')) {
          const e = expr();
          expect(')');
          return e;
        }
        if (/^[.\d]/.test(t.text)) {
          pos++;
          return { ...base, tag: 'literal', text: t.text };
        }
        const n = name().text;
        if (eat('[')) {
          const d = defs.get(n) ?? fail(t.at, `undefined tensor ${n}`);
          let axis = 0;
          const subs = list(() => {
            const start = pos,
              b = scope.get(peek().text);
            const a = affine(k => (scope.get(k.text) ?? fail(k.at, `unbound index ${k.text}`)).id);
            if (axis >= d.shape.length) fail(t.at, 'subscript rank mismatch');
            if (pos === start + 1 && b) constrain(b, d.shape[axis], tokens[start].at);
            axis++;
            return a;
          }, ']');
          if (axis !== d.shape.length) fail(t.at, 'subscript rank mismatch');
          return { ...base, tag: 'load', def: d.id, subs };
        }
        if (eat('(')) {
          if (n === 'sum' || (n === 'max' && maxBinder())) {
            const outer = scope;
            scope = new Map(scope);
            const bs = bind(')'),
              body = expr();
            finish(bs);
            scope = outer;
            return { ...base, tag: 'reduce', op: n, axes: bs, body };
          }
          const args = list(() => expr(), ')');
          if (!['exp', 'log', 'sqrt', 'tanh', 'min', 'max'].includes(n) || args.length !== arities.get(n))
            fail(t.at, 'unknown call or wrong arity');
          return { ...base, tag: 'op', op: n, args };
        }
        if (!shapeNames.has(n)) fail(t.at, `unknown shape ${n}`);
        return { ...base, tag: 'shape', name: n };
      }
      function expr(min = 0): Expr {
        let e = prefix();
        while (true) {
          const t = peek(),
            p = ['+', '-'].includes(t.text) ? 1 : ['*', '/'].includes(t.text) ? 2 : -1;
          if (p < min) break;
          pos++;
          e = { ...node(t), tag: 'op', op: t.text, args: [e, expr(p + 1)] };
        }
        return e;
      }
      const body = expr();
      expect(';');
      finish(axes);
      const stmt = { ...s, axes, shape: axes.map(b => b.dim), body };
      defs.set(s.name, stmt);
      stmts.push(stmt);
    }
    expect('return');
    const result = name();
    const d = defs.get(result.text) ?? fail(result.at, 'unknown returned tensor');
    if (shape.length !== d.shape.length || !shape.every((a, i) => same(a, d.shape[i])))
      fail(result.at, 'return shape mismatch');
    expect(';');
    expect('}');
    functions.push({ ...node(ft), name: ft.text, shape, params, stmts, result: d.id });
  } while (peek().text !== '<EOF>');
  return { functions };
}
