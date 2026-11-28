#!/usr/bin/env node
// IRWB-046-C probe 02: does the corpus exercise the liveness trap at all?
// The trap is a block that no path from the entry reaches. If no corpus function has one, the baselines
// (images, instruction counts, edit censuses) cannot catch a wrong liveness scope, and tests/stdlib/liveness.test.mjs
// is the only guard. Counts unreachable blocks per function over every corpus project, at r0 and at the `speed` head,
// from the Typed IR's CFG (src/typed/analyses.ts cfgOf: rpo = blocks reached from the entry).
// Run after `npm run build`:  node scripts/02-unreachable-blocks-in-corpus.mjs
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { storeOf } = await imp('dist/typed/ir.js');
const { cfgOf } = await imp('dist/typed/analyses.js');

const rows = [];
for (const id of projectIds()) {
  for (const pipe of ['r0', 'speed']) {
    try {
      const p = Program.fromProject(projectSource(id, projectFiles(id)));
      if (pipe !== 'r0') await p.pipeline(pipe);
      const st = storeOf(p.artifact().value);
      let fns = 0,
        deadFns = 0,
        deadBlocks = 0,
        blocks = 0;
      for (const f of st.fns.values()) {
        fns++;
        blocks += f.blocks.length;
        const live = new Set(cfgOf(f).rpo);
        const dead = f.blocks.filter(b => !live.has(b.id)).length;
        deadBlocks += dead;
        if (dead) deadFns++;
      }
      rows.push({ id, pipe, fns, blocks, deadFns, deadBlocks });
    } catch (e) {
      rows.push({ id, pipe, error: String(e.message).slice(0, 120) });
    }
  }
}
const dead = rows.filter(r => r.deadBlocks > 0);
console.log(`${rows.length} project-pipelines, ${rows.filter(r => r.error).length} errors`);
console.log(`functions with an unreachable block: ${dead.reduce((n, r) => n + r.deadFns, 0)}`);
console.log(`unreachable blocks: ${dead.reduce((n, r) => n + r.deadBlocks, 0)} of ${rows.reduce((n, r) => n + (r.blocks ?? 0), 0)}`);
for (const r of dead) console.log(`  ${r.id} ${r.pipe}: ${r.deadFns} functions, ${r.deadBlocks} blocks`);
for (const r of rows.filter(r => r.error)) console.log(`  error ${r.id} ${r.pipe}: ${r.error}`);
