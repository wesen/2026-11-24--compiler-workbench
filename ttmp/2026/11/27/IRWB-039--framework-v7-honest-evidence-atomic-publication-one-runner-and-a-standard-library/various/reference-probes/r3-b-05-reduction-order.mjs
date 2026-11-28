// Load T6-D source in memory so the sibling checkout is strictly read-only.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const cell = resolve('../t6-op-irwb-033-d');
const { build } = createRequire(resolve(cell, 'package.json'))('esbuild');
const { outputFiles } = await build({entryPoints:[resolve(cell, 'src/tensor/schedule.ts')],
  format:'esm', platform:'node', bundle:true, write:false});
const {simulate, orderViolation, reorderPass} = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'));
const loop = (dim, level = 0, factor = null) => ({dim, level, factor, bind:'serial', id:dim+'.'+level});
const variant = {loops:[loop('b'), loop('m'), loop('n'), loop('r', 1, 16), loop('r')], stages:[]};
assert.equal(orderViolation(variant), undefined);
const order = [];
simulate(variant.loops, {b:1, m:1, n:1, r:17}, p => { if (p.r < 17) order.push(p.r); });
assert.deepEqual(order.slice(0,3), [0,16,1]);
const terms = new Float32Array(17);
terms[0] = 2**24;
terms[1] = -(2**24);
terms[16] = 1;
const fold = indices => indices.reduce((sum,k) => Math.fround(sum + terms[k]), 0);
assert.equal(fold([...terms.keys()]), 1);
assert.equal(fold(order), 0);
console.log('T6-D orderViolation returned undefined; R=17 order', order.join(','), 'source=1 scheduled=0');
// The ordinary reorder pass has a stronger precondition than this output checker.
const canonical = {loops:[...variant.loops.slice(0,3),loop('r'),loop('r',1,16)], stages:[]};
const before = {value:{kernels:[{name:'k',kind:'contraction',variants:[canonical]}]}};
const guard = reorderPass.legal({before, params:{kernel:'k', variant:0, order:variant.loops.map(l=>l.id)}});
assert.equal(guard.ok, false);
console.log('ordinary reorder guard:', guard.reason);
