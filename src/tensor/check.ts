import { createIRArtifact, type IRGraph, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { equal, plain, variable, subst, type Aff } from './affine.js';
import { adapter, kinds, sameDims, type Edge } from './ir.js';
import { parse, fail, type Expr, type Token, type Subscript } from './parse.js';

export function compile(source: string) {
  const entities: IREntity[] = [],
    relations: IRRelation[] = [],
    roots: string[] = [];
  function node(id: string, kind: string, attributes: Record<string, unknown>) {
    entities.push({ id, kind, attributes });
    return id;
  }
  function link(from: string, kind: Edge, to: string, order = 0) {
    relations.push({ id: `${from}:${kind}:${order}`, kind, category: kinds[kind], from, to, order });
  }
  for (const f of parse(source)) {
    const root = 'fn:' + f.text;
    if (roots.includes(root)) fail(f.at, 'duplicate function');
    roots.push(root);
    let seq = 0;
    const fresh = () => `${root}/${seq++}`,
      bound = new Set(f.params.flatMap(p => p.dims.map(d => plain(d.form))).filter(Boolean));
    function dims(ds: Subscript[], at: string) {
      for (const d of ds) {
        for (const n of d.names) if (!bound.has(n.text)) fail(n.at, 'shape lacks plain input axis');
        if (!d.form.terms.length && d.form.c < 0) fail(at, 'negative extent');
      }
      return ds.map(d => d.form);
    }
    const result = dims(f.dims, f.at);
    node(root, 'fn', { name: f.text, at: f.at, dims: result });
    const tensors = new Map<string, { id: string; dims: Aff[] }>();
    const declare = (t: Token, id: string, dims: Aff[]) => {
      if (tensors.has(t.text)) fail(t.at, 'tensor already assigned');
      tensors.set(t.text, { id, dims });
    };
    f.params.forEach((p, j) => {
      const shape = dims(p.dims, p.at),
        id = node(fresh(), 'param', { name: p.text, at: p.at, dims: shape });
      declare(p, id, shape);
      link(root, 'param', id, j);
    });
    for (const [j, s] of f.stmts.entries()) {
      const id = fresh(),
        ann = s.dims && dims(s.dims, s.at);
      if (ann && ann.length !== s.axes.length) fail(s.at, 'declared rank mismatch');
      type Axis = { id: string; t: Token; extent?: Aff };
      const all: Axis[] = [];
      function bind(owner: string, ts: Token[], parent: Map<string, Axis>, decl?: Aff[]) {
        const scope = new Map(parent),
          local = new Set<string>();
        ts.forEach((t, j) => {
          if (local.has(t.text)) fail(t.at, 'duplicate index');
          local.add(t.text);
          const a = { id: fresh(), t, extent: decl?.[j] };
          scope.set(t.text, a);
          all.push(a);
          link(owner, 'axis', a.id, j);
        });
        return scope;
      }
      const output = bind(id, s.axes, new Map(), ann);
      function expr(x: Expr, scope: Map<string, Axis>): string {
        const e = fresh(),
          attrs: Record<string, unknown> = { at: x.at };
        if (x.op === 'load') {
          const src = tensors.get(x.text) ?? fail(x.at, `unknown tensor ${x.text}`);
          if (src.dims.length !== x.indices!.length) fail(x.at, 'load rank mismatch');
          link(e, 'reads', src.id);
          attrs.indices = x.indices!.map((sub, j) => {
            for (const n of sub.names) if (!scope.has(n.text)) fail(n.at, `unbound index ${n.text}`);
            if (sub.direct) {
              const a = scope.get(sub.direct)!;
              if (a.extent && !equal(a.extent, src.dims[j])) fail(x.at, 'inconsistent index extent');
              a.extent = src.dims[j];
            }
            return subst(sub.form, n => variable(scope.get(n)!.id));
          });
        }
        if (x.op === 'shape') {
          if (!bound.has(x.text)) fail(x.at, 'unknown scalar shape value');
          attrs.name = x.text;
        }
        if (x.op === 'literal') attrs.text = x.text;
        if (x.binders) scope = bind(e, x.binders, scope);
        node(e, 'expr.' + x.op, attrs);
        x.args.forEach((arg, n) => link(e, 'arg', expr(arg, scope), n));
        return e;
      }
      link(id, 'arg', expr(s.expr, output));
      for (const a of all) {
        if (!a.extent) fail(a.t.at, `cannot infer extent of ${a.t.text}`);
        node(a.id, 'axis', { name: a.t.text, at: a.t.at, extent: a.extent, mode: 'range' });
      }
      const shape = [...output.values()].map(a => a.extent!);
      declare(s, id, shape);
      node(id, 'def', { at: s.at, name: s.text, dims: shape });
      link(root, 'stmt', id, j);
    }
    const ret = tensors.get(f.ret.text) ?? fail(f.ret.at, 'undefined return tensor');
    if (!sameDims(result, ret.dims)) fail(f.ret.at, 'return shape mismatch');
    link(root, 'returns', ret.id);
  }
  const graph: IRGraph = {
    entities: entities.sort((a, b) => (a.id < b.id ? -1 : 1)),
    relations: relations.sort((a, b) => (a.id < b.id ? -1 : 1)),
    roots: roots.sort(),
  };
  try {
    return createIRArtifact(adapter, 'tix', graph);
  } catch (e) {
    if (!/\d+:\d+:/.test(String(e))) fail('1:1', String(e));
    throw e;
  }
}
