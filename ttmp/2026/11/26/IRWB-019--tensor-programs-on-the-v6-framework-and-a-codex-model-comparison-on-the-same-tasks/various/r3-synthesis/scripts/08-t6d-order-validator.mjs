// Claim (B): T6-D's order validator (`orderViolation`, t6-op-irwb-033-d src/tensor/schedule.ts:298) misses a
// permutation that changes an f32 sum; the reorder pass's own precondition refuses it.
// Method (after IRWB-038-B scripts/05, Astra): bundle T6-D's schedule.ts in memory with the cell's esbuild
// (write: false, so the worktree stays untouched); swap the strip-mined reduction loops (outer r.1 of factor 16 inside
// the inner r.0); ask the validator; simulate the order at R = 17; fold three f32 terms in both orders.
// The validator simulates R in {11, 1, 0} only (schedule.ts:312-316), all below the factor 16.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { worktree } from './00-root.mjs';
const cell = worktree('t6-op-irwb-033-d');
const { build } = createRequire(resolve(cell, 'package.json'))('esbuild');
const { outputFiles } = await build({ entryPoints: [resolve(cell, 'src/tensor/schedule.ts')], format: 'esm', platform: 'node', bundle: true, write: false });
const { simulate, orderViolation, reorderPass } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
const loop = (dim, level = 0, factor = null) => ({ dim, level, factor, bind: 'serial', id: dim + '.' + level });
const swapped = { loops: [loop('b'), loop('m'), loop('n'), loop('r', 1, 16), loop('r')], stages: [] };
console.log('orderViolation(swapped strip-mined reduction):', orderViolation(swapped) ?? 'undefined (accepted)');
for (const R of [11, 16, 17, 33]) {
  const order = [];
  simulate(swapped.loops, { b: 1, m: 1, n: 1, r: R }, p => { if (p.r < R) order.push(p.r); });
  const inOrder = order.every((k, i) => k === i);
  console.log(`R=${R}: order ${order.slice(0, 6).join(',')}${order.length > 6 ? ',...' : ''} | the source order: ${inOrder}`);
  if (R === 17) {
    const terms = new Float32Array(17); terms[0] = 2 ** 24; terms[1] = -(2 ** 24); terms[16] = 1;
    const fold = ix => ix.reduce((s, k) => Math.fround(s + terms[k]), 0);
    console.log(`   f32 sum of [2^24, -2^24, 0 x14, 1]: source order ${fold([...terms.keys()])}, scheduled order ${fold(order)}`);
  }
}
const canonical = { loops: [loop('b'), loop('m'), loop('n'), loop('r'), loop('r', 1, 16)], stages: [] };
const guard = reorderPass.legal({ before: { value: { kernels: [{ name: 'k', kind: 'contraction', variants: [canonical] }] } }, params: { kernel: 'k', variant: 0, order: swapped.loops.map(l => l.id) } });
console.log('reorderPass.legal on the same permutation:', JSON.stringify(guard));
