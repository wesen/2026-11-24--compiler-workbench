#!/usr/bin/env node
// IRWB-046-B probe: the unreachable-block trap case, under both scopes of the standard library's
// liveness primitive. R3's case: block 0 jumps to the join; block 1, which no path from the entry
// reaches, also jumps to the join; the join uses registers 64 and 65.
//   'all-blocks'       -> block 1 live-out {64, 65}: machine liveness (what regalloc and coalesce pass)
//   'entry-reachable'  -> block 1 live-out {}: the framework solver's answer
// Run from any directory; needs `npm run build` first (it measures the checkout it lives in).
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const { liveness, reachableBlocks } = await import(
  pathToFileURL(resolve(root, 'dist/stdlib/index.js')).href
);

const g = {
  blocks: [
    { uses: new Set(), defs: new Set(), succ: [2] },
    { uses: new Set(), defs: new Set(), succ: [2] },
    { uses: new Set([64, 65]), defs: new Set(), succ: [] },
  ],
};
const show = s => (s.size ? `{ ${[...s].join(', ')} }` : '{ }');
console.log(`reachable from entry: ${[...reachableBlocks(g)].join(', ')}`);
for (const scope of ['all-blocks', 'entry-reachable']) {
  const r = liveness(g, scope);
  console.log(`${scope}:`);
  for (let k = 0; k < g.blocks.length; k++)
    console.log(`  block ${k}: in ${show(r.in[k])}, out ${show(r.out[k])}`);
}
