import { defineIR } from '../framework/contracts/definitions.js';
import { defineAdapter, type IRGraph, type IREntity, type IRRelation } from '../framework/ir/index.js';
import { add, constant, equal, isAff, nonnegative, plain, type Aff } from './affine.js';
import { fail } from './parse.js';
export const kinds = {
  param: 'containment',
  stmt: 'containment',
  axis: 'containment',
  arg: 'containment',
  reads: 'binding',
  returns: 'binding',
  block: 'binding',
} as const;
export type Edge = keyof typeof kinds;
export class Index {
  nodes: Map<string, IREntity>;
  private links = new Map<string, IRRelation[]>();
  constructor(readonly graph: IRGraph) {
    this.nodes = new Map(graph.entities.map(n => [n.id, n]));
    for (const r of graph.relations) {
      const k = r.from + '\0' + r.kind;
      const a = this.links.get(k) ?? [];
      a.push(r);
      this.links.set(k, a);
    }
    for (const a of this.links.values()) a.sort((x, y) => x.order! - y.order!);
  }
  edges(id: string, k: Edge) {
    return this.links.get(id + '\0' + k) ?? [];
  }
  kids(id: string, k: Edge) {
    return this.edges(id, k).map(r => r.to);
  }
  one(id: string, k: Edge) {
    return this.edges(id, k)[0].to;
  }
  n(id: string) {
    return this.nodes.get(id)!;
  }
  a(id: string) {
    return this.n(id).attributes;
  }
  name(id: string) {
    return this.a(id).name as string;
  }
  dims(id: string) {
    return this.a(id).dims as Aff[];
  }
  extent(id: string) {
    return this.a(id).extent as Aff;
  }
  indices(id: string) {
    return this.a(id).indices as Aff[];
  }
}
export const sameDims = (a: Aff[], b: Aff[]) => a.length === b.length && a.every((x, i) => equal(x, b[i]));
const arities = new Map(
  Object.entries({
    literal: 0,
    shape: 0,
    load: 0,
    neg: 1,
    exp: 1,
    log: 1,
    sqrt: 1,
    tanh: 1,
    'reduce.sum': 1,
    'reduce.max': 1,
    '+': 2,
    '-': 2,
    '*': 2,
    '/': 2,
    min: 2,
    max: 2,
  }),
);
function validate(value: unknown): asserts value is IRGraph {
  const g = value as IRGraph,
    ix = new Index(g),
    seen = new Set<string>(),
    functions = new Set<string>();
  const err = (id: string, s: string) => fail(String(ix.nodes.get(id)?.attributes.at ?? '1:1'), s);
  function visit(id: string, kind: string, allowed: Edge[]) {
    const e = ix.n(id);
    if (!e || seen.has(id) || kind !== e.kind) err(id, `bad containment or kind for ${id}`);
    seen.add(id);
    for (const k of Object.keys(kinds) as Edge[]) {
      const edges = ix.edges(id, k);
      if (
        edges.length &&
        (!allowed.includes(k) ||
          edges.some(
            (r, i) =>
              r.category !== kinds[k] ||
              !Number.isSafeInteger(r.order) ||
              r.order! < 0 ||
              (i && edges[i - 1].order === r.order),
          ))
      )
        err(id, `bad ${k} slots`);
    }
  }
  if (
    !g.roots.length ||
    g.relations.some(r => !Object.hasOwn(kinds, r.kind) || !ix.nodes.has(r.from) || !ix.nodes.has(r.to))
  )
    throw Error('invalid tensor graph');
  for (const fn of g.roots) {
    visit(fn, 'fn', ['param', 'stmt', 'returns']);
    if (functions.has(ix.name(fn))) err(fn, 'duplicate function');
    functions.add(ix.name(fn));
    const params = ix.kids(fn, 'param'),
      defs = ix.kids(fn, 'stmt'),
      available = new Set<string>(),
      names = new Set<string>();
    const symbols = new Set<string>();
    for (const p of params)
      for (const d of ix.dims(p)) {
        if (isAff(d) && plain(d)) symbols.add(plain(d)!);
      }
    function dim(id: string, a: Aff) {
      if (!isAff(a) || (!a.terms.length && a.c < 0) || a.terms.some(([s]) => !symbols.has(s)))
        err(id, 'invalid dimension or unbound shape');
    }
    function axes(owner: string, scope: Map<string, Aff>, output: boolean) {
      const ids = ix.kids(owner, 'axis');
      if (!ids.length) err(owner, 'missing axis');
      for (const [j, id] of ids.entries()) {
        visit(id, 'axis', ['block']);
        const d = ix.extent(id);
        dim(id, d);
        if (output && !equal(ix.dims(owner)[j], d)) err(id, 'axis shape mismatch');
        const mode = ix.a(id).mode,
          blocks = ix.kids(id, 'block');
        if (
          !['range', 'starts', 'inner'].includes(String(mode)) ||
          (output && mode !== 'range') ||
          blocks.length !== (mode === 'inner' ? 1 : 0)
        )
          err(id, 'invalid loop domain');
        if (mode === 'starts' && (!Number.isSafeInteger(ix.a(id).width) || Number(ix.a(id).width) <= 0))
          err(id, 'invalid block width');
        if (
          mode === 'inner' &&
          (!scope.has(blocks[0]) || ix.a(blocks[0]).mode !== 'starts' || !equal(ix.extent(blocks[0]), d))
        )
          err(id, 'unbound block start');
        scope.set(id, d);
      }
      return ids;
    }
    function expr(id: string, scope: Map<string, Aff>) {
      const op = ix.n(id).kind.slice(5),
        red = op.startsWith('reduce.');
      visit(id, 'expr.' + op, red ? ['axis', 'arg'] : op === 'load' ? ['reads'] : ['arg']);
      const args = ix.kids(id, 'arg');
      if (arities.get(op) !== args.length) err(id, 'unknown expression or arity');
      if (
        op === 'literal' &&
        !(
          typeof ix.a(id).text === 'string' &&
          /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(ix.a(id).text))
        )
      )
        err(id, 'invalid literal');
      if (op === 'shape' && !symbols.has(ix.name(id))) err(id, 'unknown shape');
      if (red) {
        scope = new Map(scope);
        axes(id, scope, false);
      }
      if (op === 'load') {
        const reads = ix.kids(id, 'reads');
        if (reads.length !== 1 || !available.has(reads[0])) err(id, 'invalid or forward read');
        const dims = ix.dims(reads[0]),
          indices = ix.indices(id);
        if (!Array.isArray(indices) || dims.length !== indices.length) err(id, 'load rank mismatch');
        for (const [j, a] of indices.entries()) {
          if (!isAff(a)) err(id, 'invalid subscript');
          let lo = constant(a.c),
            hi = lo;
          for (const [s, k] of a.terms) {
            const extent = scope.get(s) ?? err(id, 'out-of-scope index');
            const end = add(extent, constant(-1));
            if (k < 0) lo = add(lo, end, k);
            else hi = add(hi, end, k);
          }
          // On a nonempty iteration every enclosing extent is at least one.
          const bounds = [...scope.values()].map(d => add(d, constant(-1)));
          const proves = (v: Aff) => nonnegative(v) || bounds.some(b => nonnegative(add(v, b, -1)));
          if (
            ![...scope.values()].some(d => equal(d, constant(0))) &&
            (!proves(lo) || !proves(add(add(dims[j], constant(-1)), hi, -1)))
          )
            err(id, 'subscript not provably in bounds');
        }
      }
      for (const a of args) expr(a, scope);
    }
    for (const id of [...params, ...defs]) {
      const param = ix.n(id).kind === 'param';
      visit(id, params.includes(id) ? 'param' : 'def', param ? [] : ['axis', 'arg']);
      const dims = ix.dims(id);
      if (!Array.isArray(dims) || !dims.length || names.has(ix.name(id)))
        err(id, 'invalid or repeated tensor');
      names.add(ix.name(id));
      dims.forEach(d => dim(id, d));
      if (!param) {
        if (ix.kids(id, 'axis').length !== dims.length || ix.kids(id, 'arg').length !== 1)
          err(id, 'invalid tensor definition');
        const scope = new Map<string, Aff>();
        axes(id, scope, true);
        expr(ix.one(id, 'arg'), scope);
      }
      available.add(id);
    }
    const ret = ix.kids(fn, 'returns');
    if (
      !params.length ||
      ret.length !== 1 ||
      !available.has(ret[0]) ||
      !sameDims(ix.dims(fn), ix.dims(ret[0]))
    )
      err(fn, 'invalid return');
  }
  if (seen.size !== g.entities.length) throw Error('orphan or duplicate tensor entity');
}
export const TixIR = defineIR<IRGraph>({
  id: 'tensor.index',
  version: '1',
  description: 'Checked index notation',
  validate,
});
export const adapter = defineAdapter<IRGraph>({
  id: 'tensor.graph',
  version: '1',
  kind: TixIR.id,
  schemaVersion: TixIR.version,
  description: 'Native index graph',
  relationKinds: kinds,
  validate,
  entities: g => g.entities,
  relations: g => g.relations,
  roots: g => g.roots,
  resolve: (g, id) => g.entities.find(n => n.id === id),
  describe: (_g, id) => ({ label: id }),
  rebuild: (_base, g) => ({
    entities: g.entities,
    relations: g.relations,
    roots: g.entities
      .filter(n => n.kind === 'fn')
      .map(n => n.id)
      .sort(),
  }),
});
