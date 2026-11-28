// IRWB-060-A probe: what does today's inline pass's correspondence say for the merged statement,
// and what would F40 have to change? Also: the current derivation steps.
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { inlinePass } from '../../../../../../dist/tensor/passes.js';
import { applyNativePassSync } from '../../../../../../dist/framework/passes/index.js';

const p = compileTix('fn f(x:f32[N]):f32[N]{a[i]=x[i]*2;b[i]=a[i]+1;return b;}');
const r = applyNativePassSync(inlinePass, p.current, () => ({ ok: true }));
console.log('changed', r.changed);
console.log('steps', JSON.stringify(r.derivation?.steps, null, 1));
for (const e of r.correspondence.entries) console.log(JSON.stringify(e));
