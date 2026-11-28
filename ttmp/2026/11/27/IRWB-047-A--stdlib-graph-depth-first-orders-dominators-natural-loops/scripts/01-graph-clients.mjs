// IRWB-047-A probe 01: the moved graph algorithms on the real corpus, as executable evidence that
// the adapters answer over `typed.blocks` what the library computes over `Digraph`. For every
// corpus project it checks, per function: the rpo starts at the entry and holds only blocks; the
// entry is its own idom and every other reachable block's idom is a block that dominates it; one
// loop per header, the header dominating every latch and every body node; and ssa's direct call of
// the library agreeing with the published facts.
// Usage: node scripts/01-graph-clients.mjs   (from anywhere; needs `npm run build` first)
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectSource, ingestProject } = await imp('dist/typed/project.js');
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { cfgOf, dominatorsOf, domView, digraphOf } = await imp('dist/typed/analyses.js');
const { storeOf } = await imp('dist/typed/ir.js');
const { dominators, domTree, naturalLoops } = await imp('dist/stdlib/index.js');
const { ssaOf } = await imp('dist/typed/ssa.js');

let fns = 0,
  loops = 0,
  latches = 0,
  bad = [];
const digest = createHash('sha256');
for (const id of projectIds()) {
  const r0 = ingestProject(projectSource(id, projectFiles(id)));
  const st = storeOf(r0.value);
  digest.update(`${id}:${r0.revision};`);
  for (const f of st.fns.values()) {
    fns++;
    const cfg = cfgOf(f),
      dom = dominatorsOf(f),
      view = domView(dom);
    if (cfg.rpo[0] !== cfg.entry || new Set(cfg.rpo).size !== cfg.rpo.length)
      bad.push(`${f.name}: rpo is not an order from the entry`);
    if (cfg.rpo.some(b => !cfg.succ[b])) bad.push(`${f.name}: rpo holds a non-block`);
    const lib = dominators(digraphOf(f));
    if (JSON.stringify(Object.fromEntries(lib.idom)) !== JSON.stringify(dom.idom) || lib.rounds !== dom.rounds)
      bad.push(`${f.name}: the adapter and the library disagree on idom`);
    if (dom.idom[cfg.entry] !== cfg.entry) bad.push(`${f.name}: the entry is not its own idom`);
    for (const b of cfg.rpo)
      if (b !== cfg.entry && !view.dominates(dom.idom[b], b)) bad.push(`${f.name}: ${b}'s idom does not dominate it`);
    const tree = domTree({ idom: new Map(Object.entries(dom.idom)), rpo: dom.rpo });
    for (const l of naturalLoops(digraphOf(f), tree.dominates)) {
      loops++;
      latches += l.latches.length;
      if (new Set(l.latches).size !== l.latches.length) bad.push(`${f.name}: loop ${l.head} repeats a latch`);
      if (!l.body.includes(l.head) || l.latches.some(x => !l.body.includes(x)))
        bad.push(`${f.name}: loop ${l.head} body does not hold its head or a latch`);
      for (const x of l.body) if (!tree.dominates(l.head, x)) bad.push(`${f.name}: ${l.head} does not dominate ${x}`);
    }
    const ssa = ssaOf(st, f);
    for (const [b, x] of Object.entries(ssa.idom))
      if (b === cfg.entry ? x !== '^entry' : x !== dom.idom[b]) bad.push(`${f.name}: ssa's idom of ${b} disagrees`);
  }
}
console.log(JSON.stringify({ fns, loops, latches, bad }, null, 2));
console.log(`corpus digest: ${digest.digest('hex').slice(0, 16)}`);
if (bad.length) process.exit(1);
