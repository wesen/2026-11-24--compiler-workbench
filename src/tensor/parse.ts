import {
  arity,
  constant,
  fail,
  plus,
  same,
  variable,
  type Aff,
  type Axis,
  type Expr,
  type Fn,
  type Module,
  type Stmt,
} from './model.js';
const ident = /^[A-Za-z_][A-Za-z_0-9]*$/;
function lex(src: string) {
  const tokens: { s: string; at: string }[] = [];
  let row = 1,
    col = 1;
  for (const [s] of src.matchAll(
    /\/\/[^\n]*|\s+|[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|./gs,
  )) {
    if (!s.startsWith('//') && !/^\s/.test(s)) tokens.push({ s, at: `${row}:${col}` });
    for (const ch of s) {
      if (ch === '\n') {
        row++;
        col = 1;
      } else col++;
    }
  }
  tokens.push({ s: '<eof>', at: `${row}:${col}` });
  return tokens;
}
export function parse(source: string): Module {
  const ts = lex(source);
  let pos = 0,
    serial = 0;
  const cur = () => ts[pos].s,
    loc = () => ts[pos].at,
    err = (m: string): never => fail(loc(), m);
  const eat = (s: string) => cur() === s && (pos++, true),
    need = (s: string) => {
      if (!eat(s)) err('expected ' + s);
    };
  const name = () => (ident.test(cur()) ? ts[pos++].s : err('expected name'));
  function list<T>(end: string, fn: () => T) {
    const out = [fn()];
    while (eat(',')) out.push(fn());
    need(end);
    return out;
  }
  function affine(resolve: (s: string) => string, prec = 0): Aff {
    let a: Aff;
    if (eat('-')) a = plus(constant(0), affine(resolve, 3), -1);
    else if (eat('(')) {
      a = affine(resolve);
      need(')');
    } else if (/^\d+$/.test(cur())) a = constant(Number(ts[pos++].s));
    else a = variable(resolve(name()));
    while (true) {
      const op = cur(),
        p = op === '*' ? 2 : op === '+' || op === '-' ? 1 : 0;
      if (p <= prec) break;
      pos++;
      const b = affine(resolve, p);
      if (op === '*') {
        if (a.t.length && b.t.length) err('non-affine product');
        a = a.t.length ? plus(constant(0), a, b.c) : plus(constant(0), b, a.c);
      } else a = plus(a, b, op === '+' ? 1 : -1);
    }
    return a;
  }
  const type = () => {
    need('f32');
    need('[');
    return list(']', () => affine(s => s));
  };
  function fn(): Fn {
    const at = loc();
    need('fn');
    const fname = name();
    need('(');
    const params = list(')', () => {
      const n = name();
      need(':');
      return { name: n, dims: type() };
    });
    need(':');
    const result = type();
    need('{');
    const defs: Stmt[] = [],
      tensors = new Map(params.map(p => [p.name, p.dims])),
      shapes = new Set(params.flatMap(p => p.dims.flatMap(d => d.t.map(([n]) => n))));
    type Binder = { id: string; extent?: Aff };
    let scope = new Map<string, Binder>();
    function bind(ns: string[]) {
      if (new Set(ns).size !== ns.length) err('duplicate index');
      return ns.map(n => {
        const b: Binder = { id: `i${serial++}` };
        scope.set(n, b);
        return b;
      });
    }
    function finish(bs: Binder[]): Axis[] {
      return bs.map(b => ({ id: b.id, extent: b.extent ?? err('cannot infer index extent') }));
    }
    function infer(b: Binder, d: Aff) {
      if (b.extent && !same(b.extent, d)) err('inconsistent index extent');
      b.extent = d;
    }
    function maxBinder() {
      let i = pos + 1;
      const ns = [];
      while (ident.test(ts[i]?.s)) {
        ns.push(ts[i++].s);
        if (ts[i].s !== ',') break;
        i++;
      }
      if (ts[i]?.s !== ')' || !ns.length) return false;
      const next = ts[i + 1]?.s ?? '';
      // Only '-' can both start a reduction body and continue a completed max call.
      if (next === '-') return !(ns.length === 2 && ns.every(n => shapes.has(n)));
      return next === '(' || ident.test(next) || /^[.\d]/.test(next);
    }
    function expr(prec = 0): Expr {
      let a: Expr;
      const start = cur();
      if (eat('-')) a = { op: 'calc', fn: 'neg', args: [expr(3)] };
      else if (eat('(')) {
        a = expr();
        need(')');
      } else if (/^[.\d]/.test(start)) {
        pos++;
        a = { op: 'num', v: Number(start) };
      } else {
        const n = name();
        if (eat('[')) {
          const ds = tensors.get(n) ?? err('undefined tensor ' + n);
          let i = 0;
          const sub = list(']', () => {
            const begin = pos;
            const idx = affine(s => scope.get(s)?.id ?? err('unbound index ' + s));
            if (!ds[i]) err('too many indices');
            if (pos === begin + 1 && ident.test(ts[begin].s)) infer(scope.get(ts[begin].s)!, ds[i]);
            i++;
            return idx;
          });
          if (sub.length !== ds.length) err('wrong number of indices');
          a = { op: 'read', name: n, sub };
        } else if (cur() === '(') {
          if (n === 'sum' || (n === 'max' && maxBinder())) {
            need('(');
            const ns = list(')', name),
              old = scope;
            scope = new Map(scope);
            const bs = bind(ns),
              body = expr();
            a = { op: 'reduce', fn: n, axes: finish(bs), body };
            scope = old;
          } else {
            need('(');
            const args = list(')', () => expr());
            if (n === 'neg' || arity.get(n) !== args.length) err('unknown intrinsic or wrong arity: ' + n);
            a = { op: 'calc', fn: n, args };
          }
        } else {
          if (!shapes.has(n)) err('unknown shape ' + n);
          a = { op: 'shape', name: n };
        }
      }
      while (true) {
        const op = cur(),
          p = op === '*' || op === '/' ? 2 : op === '+' || op === '-' ? 1 : 0;
        if (p <= prec) break;
        pos++;
        a = { op: 'calc', fn: op, args: [a, expr(p)] };
      }
      return a;
    }
    while (cur() !== 'return') {
      const at = loc(),
        n = name();
      if (tensors.has(n)) fail(at, 'tensor already defined: ' + n);
      need('[');
      scope.clear();
      const bs = bind(list(']', name));
      if (eat(':')) {
        const ds = type();
        if (ds.length !== bs.length) err('annotation rank');
        bs.forEach((b, i) => infer(b, ds[i]));
      }
      need('=');
      const rhs = expr(),
        axes = finish(bs),
        dims = axes.map(a => a.extent);
      need(';');
      defs.push({ at, name: n, rhs, axes, dims });
      tensors.set(n, dims);
    }
    need('return');
    const ret = name();
    need(';');
    need('}');
    return { at, name: fname, params, result, ret, defs };
  }
  const mod = [fn()];
  while (cur() !== '<eof>') mod.push(fn());
  return mod;
}
