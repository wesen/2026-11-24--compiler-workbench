/**
 * IRWB-020-N: the Tix checker. Turns the syntax tree into the IR, checking names, ranks, extents, bounds and the
 * return shape (design §3); every error is `line:col: message` at the offending token.
 */
import {
  A,
  boundsProblem,
  type Affine,
  type Expr,
  type Fn,
  type ScopeIndex,
  type Stmt,
  type TixModule,
} from './ir.js';
import { parse, TixError, type Ex, type FnAst, type Pos, type StmtAst, type TypeAst } from './syntax.js';

const err = (pos: Pos, msg: string): never => {
  throw new TixError(pos, msg);
};

/** An affine form of names accepted by `ok` and integers; `what` names those names in errors. */
function affine(e: Ex, ok: (n: string) => boolean, what: string): Affine {
  switch (e.k) {
    case 'num':
      if (!Number.isInteger(e.value) || /[.eE]/.test(e.text))
        err(e.pos, `expected an integer, found ${e.text}`);
      return A.num(e.value);
    case 'name':
      if (!ok(e.name)) err(e.pos, `${e.name} is not ${what}`);
      return A.name(e.name);
    case 'neg':
      return A.scale(affine(e.a, ok, what), -1);
    case 'bin': {
      const a = affine(e.a, ok, what),
        b = affine(e.b, ok, what);
      if (e.op === '+') return A.add(a, b);
      if (e.op === '-') return A.sub(a, b);
      if (e.op === '*') {
        if (!A.names(a).length) return A.scale(b, a.c);
        if (!A.names(b).length) return A.scale(a, b.c);
        return err(e.pos, 'not affine: a product of two names');
      }
      return err(e.pos, 'not affine: division');
    }
    default:
      return err(e.pos, `expected an affine expression of ${what} and integers`);
  }
}

class FnChecker {
  readonly shapes: string[] = [];
  readonly shapeSet = new Set<string>();
  readonly params = new Map<string, readonly Affine[]>();
  /** Statement tensors: name -> statement id and shape. */
  readonly tensors = new Map<string, { id: string; dims: readonly Affine[] }>();
  readonly stmts: Stmt[] = [];
  constructor(
    readonly f: FnAst,
    readonly exprs: Record<string, Expr>,
    readonly ids: { next: number },
  ) {}

  private fresh(p: string) {
    return `${p}${this.ids.next++}`;
  }
  private dims(t: TypeAst): Affine[] {
    return t.dims.map(d => affine(d, n => this.shapeSet.has(n), 'a shape name'));
  }
  private taken(n: string): string | undefined {
    if (this.shapeSet.has(n)) return 'a shape name';
    if (this.params.has(n)) return 'a parameter';
    if (this.tensors.has(n)) return 'a tensor defined earlier';
    return undefined;
  }

  check(): Fn {
    const f = this.f;
    // shape names: those that are a plain dimension of some parameter
    for (const p of f.params)
      for (const d of p.type.dims)
        if (d.k === 'name' && !this.shapeSet.has(d.name)) {
          this.shapeSet.add(d.name);
          this.shapes.push(d.name);
        }
    for (const p of f.params) {
      if (this.params.has(p.name)) err(p.pos, `duplicate parameter ${p.name}`);
      if (this.shapeSet.has(p.name)) err(p.pos, `${p.name} is a shape name`);
      this.params.set(p.name, this.dims(p.type));
    }
    const result = this.dims(f.result);
    for (const s of f.stmts) this.stmt(s);
    const ret = this.tensors.get(f.ret.name);
    if (!ret)
      err(
        f.ret.pos,
        this.params.has(f.ret.name)
          ? 'a function must return a statement tensor'
          : `unknown tensor ${f.ret.name}`,
      );
    if (ret!.dims.length !== result.length || ret!.dims.some((d, i) => !A.eq(d, result[i])))
      err(
        f.ret.pos,
        `${f.ret.name} has shape [${ret!.dims.map(A.show).join(', ')}], but the result type is [${result.map(A.show).join(', ')}]`,
      );
    return {
      name: f.name,
      shapes: this.shapes,
      params: f.params.map(p => ({ name: p.name, dims: this.params.get(p.name)! })),
      result,
      body: this.stmts.map(s => s.id),
      returns: ret!.id,
    };
  }

  private stmt(s: StmtAst): void {
    const why = this.taken(s.name);
    if (why) err(s.pos, `${s.name} is already ${why}; each tensor is assigned once`);
    const lhs = new Set<string>();
    for (const ix of s.indices) {
      if (lhs.has(ix.name)) err(ix.pos, `index ${ix.name} appears twice`);
      const t = this.taken(ix.name);
      if (t) err(ix.pos, `index ${ix.name} is ${t}`);
      lhs.add(ix.name);
    }
    // extents from plain uses: index -> [extent, position of the use]
    const plain = new Map<string, { extent: Affine; pos: Pos }>();
    const notePlain = (n: string, extent: Affine, pos: Pos) => {
      const prev = plain.get(n);
      if (!prev) plain.set(n, { extent, pos });
      else if (!A.eq(prev.extent, extent))
        err(
          pos,
          `index ${n} has extent ${A.show(extent)} here but ${A.show(prev.extent)} at ${prev.pos.line}:${prev.pos.col}`,
        );
    };
    // first walk: scoping, ranks and plain uses (reduction indices are recorded under their binder)
    const reduceExtents = new Map<Ex, Map<string, Affine>>();
    const scan = (e: Ex, scope: ReadonlySet<string>, binders: Map<string, Map<string, Affine>>): void => {
      switch (e.k) {
        case 'num':
          return;
        case 'name':
          if (!this.shapeSet.has(e.name))
            err(
              e.pos,
              scope.has(e.name) ? `index ${e.name} used outside brackets` : `${e.name} is not a shape name`,
            );
          return;
        case 'ref': {
          const dims = this.params.get(e.name) ?? this.tensors.get(e.name)?.dims;
          if (!dims)
            err(e.pos, e.name === s.name ? `${e.name} refers to itself` : `unknown tensor ${e.name}`);
          if (e.args.length !== dims!.length)
            err(
              e.pos,
              `${e.name} has ${dims!.length} dimension(s), but ${e.args.length} index(es) are given`,
            );
          e.args.forEach((a, d) => {
            const af = affine(a, n => scope.has(n), 'an index in scope');
            const n = A.plain(af);
            if (n === undefined) return;
            const b = binders.get(n);
            if (b) {
              const prev = b.get(n);
              if (prev && !A.eq(prev, dims![d]))
                err(a.pos, `index ${n} has extent ${A.show(dims![d])} here but ${A.show(prev)} elsewhere`);
              b.set(n, dims![d]);
            } else notePlain(n, dims![d], a.pos);
          });
          return;
        }
        case 'neg':
          return scan(e.a, scope, binders);
        case 'bin':
          scan(e.a, scope, binders);
          return scan(e.b, scope, binders);
        case 'call':
          return e.args.forEach(a => scan(a, scope, binders));
        case 'reduce': {
          const inner = new Set(scope);
          const mine = new Map<string, Affine>();
          const nb = new Map(binders);
          for (const ix of e.indices) {
            if (inner.has(ix.name)) err(ix.pos, `index ${ix.name} is already bound`);
            const t = this.taken(ix.name);
            if (t || ix.name === s.name) err(ix.pos, `index ${ix.name} is ${t ?? 'the statement tensor'}`);
            inner.add(ix.name);
            nb.set(ix.name, mine);
          }
          scan(e.body, inner, nb);
          for (const ix of e.indices)
            if (!mine.has(ix.name))
              err(ix.pos, `the extent of reduction index ${ix.name} cannot be inferred: it has no plain use`);
          reduceExtents.set(e, mine);
          return;
        }
      }
    };
    scan(s.rhs, lhs, new Map());
    // left-hand extents: plain uses, else the declared type
    const declared = s.type ? this.dims(s.type) : undefined;
    if (declared && declared.length !== s.indices.length)
      err(
        s.type!.pos,
        `the declared type has ${declared.length} dimension(s), but ${s.name} has ${s.indices.length} index(es)`,
      );
    const indices = s.indices.map((ix, d) => {
      const p = plain.get(ix.name);
      if (p && declared && !A.eq(p.extent, declared[d]))
        err(
          s.type!.pos,
          `the declared dimension ${A.show(declared[d])} of ${ix.name} differs from its inferred extent ${A.show(p.extent)}`,
        );
      const extent = p?.extent ?? declared?.[d];
      if (!extent)
        err(
          ix.pos,
          `the extent of index ${ix.name} cannot be inferred: it has no plain use; declare the statement's type`,
        );
      return { name: ix.name, extent: extent! };
    });
    // second walk: bounds and the IR
    const scope = new Map<string, ScopeIndex>(indices.map(i => [i.name, { extent: { aff: i.extent } }]));
    const build = (e: Ex, sc: Map<string, ScopeIndex>): string => {
      const id = this.fresh('e');
      let node: Expr;
      switch (e.k) {
        case 'num':
          node = { op: 'num', value: e.value };
          break;
        case 'name':
          node = { op: 'shape', name: e.name };
          break;
        case 'ref': {
          const at = e.args.map(a => affine(a, n => sc.has(n), 'an index in scope'));
          const isParam = this.params.has(e.name);
          const dims = isParam ? this.params.get(e.name)! : this.tensors.get(e.name)!.dims;
          const why = boundsProblem(at, dims, { indices: sc, guards: [] });
          if (why) err(e.pos, `${e.name}: ${why}`);
          node = isParam
            ? { op: 'ref', kind: 'param', name: e.name, at }
            : { op: 'ref', kind: 'stmt', name: this.tensors.get(e.name)!.id, at };
          break;
        }
        case 'neg':
          node = { op: 'neg', a: build(e.a, sc) };
          break;
        case 'bin': {
          const op = ({ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' } as const)[e.op];
          node = { op, a: build(e.a, sc), b: build(e.b, sc) };
          break;
        }
        case 'call':
          node =
            e.args.length === 1
              ? { op: e.fn as 'exp', a: build(e.args[0], sc) }
              : { op: e.fn as 'max', a: build(e.args[0], sc), b: build(e.args[1], sc) };
          break;
        case 'reduce': {
          const mine = reduceExtents.get(e)!;
          const axes = e.indices.map(ix => ({ name: ix.name, extent: { aff: mine.get(ix.name)! } }));
          const inner = new Map(sc);
          for (const ax of axes) inner.set(ax.name, { extent: ax.extent });
          node = { op: 'reduce', kind: e.kind, axes, body: build(e.body, inner) };
          break;
        }
      }
      this.exprs[id] = node;
      return id;
    };
    const id = this.fresh('s');
    const root = build(s.rhs, scope);
    this.stmts.push({ id, fn: this.f.name, tensor: s.name, indices, root, at: `${s.pos.line}:${s.pos.col}` });
    this.tensors.set(s.name, { id, dims: indices.map(i => i.extent) });
  }
}

/** Parse and check a Tix program, building its IR module. Throws `TixError` (`line:col: message`). */
export function checkProgram(source: string): TixModule {
  const asts = parse(source);
  const fns: Record<string, Fn> = {},
    stmts: Record<string, Stmt> = {},
    exprs: Record<string, Expr> = {};
  const ids = { next: 1 };
  for (const f of asts) {
    if (fns[f.name]) err(f.pos, `duplicate function ${f.name}`);
    const c = new FnChecker(f, exprs, ids);
    fns[f.name] = c.check();
    for (const s of c.stmts) stmts[s.id] = s;
  }
  return { fns, stmts, exprs, next: ids.next };
}
