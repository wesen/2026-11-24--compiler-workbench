// IRWB-060-A: print the recorded per-pass revisions for every Tix corpus program (for the terms test).
// Run from the repository root.
import { readFileSync } from 'node:fs';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { inlinePass, splitPass } from '../../../../../../dist/tensor/passes.js';
import { applyNativePassSync } from '../../../../../../dist/framework/passes/index.js';

for (const name of ['attention', 'conv2d', 'layernorm', 'matmul', 'mlp', 'softmax']) {
  const p = compileTix(
    readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'),
  );
  const ok = () => ({ ok: true });
  const inlined = applyNativePassSync(inlinePass, p.current, ok);
  const split = applyNativePassSync(splitPass, inlined.artifact, ok);
  console.log(
    `${name}: inline changed=${inlined.changed} after-inline=${inlined.artifact.revision} after-split=${split.artifact.revision}`,
  );
}
