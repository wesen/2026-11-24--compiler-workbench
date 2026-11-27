// Reproduction of IRWB-038-D scripts/03 (Fable), unchanged except for the import root, plus a cyclic case.
// Claim (C, D): the framework's dataflow solver runs a binding-time analysis on a Tix function.
// Probe: can the framework's dataflow layer (written for control-flow graphs of blocks) solve a monotone problem
// over a different graph? Here: a binding-time analysis of a Tix function over its read (dependency) graph, with
// the two-point lattice S < D (Jones, Gomard, Sestoft 1993, ch. 4-5: a division must be congruent, i.e. anything
// computed from a dynamic value is dynamic). It is registered as an ordinary framework analysis and cached.
// usage: node 03-binding-times-on-the-dataflow-layer.mjs   (after `npm run build`)
import { dist } from './00-root.mjs';
const { compileTix } = await dist('tensor/index.js');
const { adapter, TixIR } = await dist('tensor/ir.js');
const { dataflow } = await dist('framework/dataflow/analysis.js');
const { AnalysisManager } = await dist('framework/contracts/analysis-manager.js');

// the two-point lattice, 9 lines; the framework's lattices.ts has set, flat, interval and map but not this one
const two = { name: 'binding-time', infiniteHeight: false, bottom: () => 'S', join: (a, b) => (a === 'D' || b === 'D' ? 'D' : 'S'),
  equal: (a, b) => a === b, encode: v => v, decode: j => j };

const bindingTimes = dataflow({
  id: 'probe.tix.binding-times', version: '1', description: 'S/D per tensor, given the dynamic parameters',
  input: TixIR, adapter, direction: 'forward', lattice: two,
  reads: { entities: ['tensor'], relations: ['reads'] },
  // one region per function; nodes are tensors, edges go from a tensor to its readers. The solver wants one entry,
  // so a virtual node precedes every tensor (the workaround a dependency graph with several sources needs).
  regions(view, params) {
    const dynamic = new Set(params?.dynamic ?? []);
    return view.entities().filter(e => view.resolve(e).kind === 'function').map(f => {
      const fn = f.entity, nodes = view.children(f).map(c => c.entity), rel = view.relations().filter(r => r.kind === 'reads');
      const succ = new Map(nodes.map(n => [n, []])), preds = new Map(nodes.map(n => [n, ['^']]));
      for (const r of rel) if (succ.has(r.to) && succ.has(r.from)) { succ.get(r.to).push(r.from); preds.get(r.from).push(r.to); }
      const graph = { entry: '^', blocks: ['^', ...nodes], succ: b => (b === '^' ? nodes : succ.get(b)), preds: b => (b === '^' ? [] : preds.get(b)) };
      return { id: fn, graph, context: { dynamic, fn } };
    });
  },
  transfer: (node, input, ctx) => (ctx.dynamic.has(node.slice(ctx.fn.length + 1)) ? 'D' : input),
});

const { origin } = compileTix(`fn affine(x: f32[N,D], w: f32[D], b: f32[D]): f32[N,D] {
  scale[j] = w[j] * w[j];
  shift[j] = b[j] + scale[j];
  norm[i] = sum(j) x[i,j] * scale[j];
  y[i,j] = x[i,j] * scale[j] + shift[j] - norm[i];
  return y;
}`);
const direct = bindingTimes.solveArtifact(origin, { dynamic: ['x'] });
console.log('binding times with x dynamic, w and b static:', JSON.stringify(direct.regions.affine.out));
console.log('visits', direct.regions.affine.iterations, '(nodes: 8)');
// through the analysis manager: computed once per revision and parameters, then reused
const manager = new AnalysisManager();
const a = await manager.analyse(bindingTimes, origin, { dynamic: ['x'] });
const b = await manager.analyse(bindingTimes, origin, { dynamic: ['x'] });
console.log('manager: same record reused', a.id === b.id, '| has', manager.hasAnalysis(bindingTimes, origin, { dynamic: ['x'] }));
const c = await manager.analyse(bindingTimes, origin, { dynamic: ['w'] });
console.log('with w dynamic instead:', JSON.stringify(c.value.regions.affine.out));

// C's probe 04 ran on a hand-made def-use table, not on Tix; this is the Tix case, plus a check that the solver
// reaches the least fixpoint when the dependency graph has a cycle (Tix is single-assignment, so its read graph is
// acyclic; the cyclic case uses the solver directly, as a B1 division over a VM loop would).
const { solve } = await dist('framework/dataflow/solver.js');
const deps = { pc: ['pc'], op: ['pc'], acc: ['acc', 'op', 'x'], x: [], t: ['acc'] }, dyn = new Set(['x']);
const ks = Object.keys(deps), users = k => ks.filter(u => deps[u].includes(k));
const g = { entry: '^', blocks: ['^', ...ks], succ: b => (b === '^' ? ks : users(b)), preds: b => (b === '^' ? [] : ['^', ...deps[b]]) };
const s = solve(g, { direction: 'forward', lattice: two, boundary: 'S', transfer: (b, i) => (b !== '^' && dyn.has(b) ? 'D' : i) });
console.log('cyclic VM-shaped division:', JSON.stringify(Object.fromEntries(ks.map(k => [k, s.out.get(k)]))), '| iterations', s.iterations);
