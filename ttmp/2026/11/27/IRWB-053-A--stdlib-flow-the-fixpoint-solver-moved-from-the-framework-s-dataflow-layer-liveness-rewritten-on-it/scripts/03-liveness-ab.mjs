// IRWB-053-A: the fair liveness A/B. The machine is shared (load average over 20 while measuring),
// so separate before/after processes are not comparable: this probe interleaves the two
// implementations in one process over the same LiveGraphs — the old hand-rolled liveness (copied
// verbatim from src/stdlib/flow/liveness.ts before the rewrite) against the dist build's (the
// solver-based one) — alternating rounds on the machine CFGs of the 5 biggest corpus projects under
// `speed`, the workload regalloc and coalesce see (scope 'all-blocks'). Median and min per project
// are both reported, so a load spike on either side cannot masquerade as a difference.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..', '..', '..', '..', '..', '..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { storeOf } = await imp('dist/typed/ir.js');
const { livenessAnalysis, liveView } = await imp('dist/typed/analyses.js');
const { backendDefaults } = await imp('dist/typed/backend/options.js');
const { select } = await imp('dist/typed/backend/select.js');
const { machineBlocks, usesOf, defsOf } = await imp('dist/typed/backend/regalloc.js');
const { liveness: newLiveness } = await imp('dist/stdlib/index.js');

// the old liveness, verbatim from src/stdlib/flow/liveness.ts before the rewrite (IRWB-046-B)
function oldLiveness(graph, scope) {
  const blocks = graph.blocks;
  const reach = scope === 'all-blocks' ? null : reachable(graph);
  const use = blocks.map(b => b.uses),
    def = blocks.map(b => b.defs);
  const IN = blocks.map(() => new Set()),
    OUT = blocks.map(() => new Set());
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = blocks.length - 1; k >= 0; k--) {
      if (reach && !reach.has(k)) continue;
      const out = new Set();
      for (const s of blocks[k].succ) for (const r of IN[s]) out.add(r);
      const inn = new Set(use[k]);
      for (const r of out) if (!def[k].has(r)) inn.add(r);
      if (inn.size !== IN[k].size || out.size !== OUT[k].size) {
        IN[k] = inn;
        OUT[k] = out;
        changed = true;
      }
    }
  }
  return { in: IN, out: OUT };
}
function reachable(graph) {
  const seen = new Set(),
    stack = [graph.entry ?? 0];
  while (stack.length) {
    const b = stack.pop();
    if (seen.has(b)) continue;
    seen.add(b);
    for (const s of graph.blocks[b].succ) if (!seen.has(s)) stack.push(s);
  }
  return seen;
}

const ids = projectIds().filter(id => (projectFiles(id)['main.typed'] ?? '').length > 1500);
// one LiveGraph per function, built the way regalloc builds it (usesOf/defsOf are regalloc's own)
const graphs = new Map();
let fns = 0;
for (const id of ids) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  await p.pipeline('speed');
  const st = storeOf(p.artifact().value);
  const live = livenessAnalysis.solveArtifact(p.artifact());
  const gs = [...st.fns.values()].map(f => {
    const sel = select({ st, f, o: backendDefaults, live: liveView(live, st, f.name), ranges: null });
    const blocks = machineBlocks(sel.code);
    const use = blocks.map(() => new Set()),
      def = blocks.map(() => new Set());
    blocks.forEach((b, k) => {
      for (let i = b.start; i <= b.end; i++) {
        for (const r of usesOf(sel.code[i])) if (!def[k].has(r)) use[k].add(r);
        for (const r of defsOf(sel.code[i])) def[k].add(r);
      }
    });
    return { blocks: blocks.map((b, k) => ({ uses: use[k], defs: def[k], succ: b.succ })) };
  });
  fns += gs.length;
  graphs.set(id, gs);
}

// equal answers first: the A/B is only meaningful if the two solve the same graphs
for (const [id, gs] of graphs)
  for (const g of gs) {
    const a = oldLiveness(g, 'all-blocks'),
      b = newLiveness(g, 'all-blocks');
    for (let k = 0; k < g.blocks.length; k++) {
      if (
        [...a.in[k]].sort().join() !== [...b.in[k]].sort().join() ||
        [...a.out[k]].sort().join() !== [...b.out[k]].sort().join()
      )
        throw new Error(`${id}: the two liveness implementations disagree`);
    }
  }

const one = (gs, fn) => {
  const t0 = performance.now();
  for (const g of gs) fn(g, 'all-blocks');
  return performance.now() - t0;
};
for (const fn of [oldLiveness, newLiveness]) for (const gs of graphs.values()) one(gs, fn);
const R = 200;
const times = { new: new Map(), old: new Map() };
for (let r = 0; r < R; r++) {
  for (const [tag, fn] of [['old', oldLiveness], ['new', newLiveness]])
    for (const [id, gs] of graphs) {
      const dt = one(gs, fn);
      const a = times[tag].get(id) ?? [];
      a.push(dt);
      times[tag].set(id, a);
    }
}
const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const min = a => Math.min(...a);
let totNew = 0,
  totOld = 0,
  totNewMin = 0,
  totOldMin = 0;
for (const id of ids) {
  const n = med(times.new.get(id)),
    o = med(times.old.get(id));
  totNew += n;
  totOld += o;
  totNewMin += min(times.new.get(id));
  totOldMin += min(times.old.get(id));
  console.log(
    `${id}\told median ${o.toFixed(3)} min ${min(times.old.get(id)).toFixed(3)}\tnew median ${n.toFixed(3)} min ${min(times.new.get(id)).toFixed(3)}`,
  );
}
console.log(
  `${fns} fns, ${R} rounds: TOTAL old ${totOld.toFixed(2)}ms (min ${totOldMin.toFixed(2)})\tnew ${totNew.toFixed(2)}ms (min ${totNewMin.toFixed(2)})\tratio median ${(totNew / totOld).toFixed(2)}\tmin ${min ? (totNewMin / totOldMin).toFixed(2) : '-'}`,
);
