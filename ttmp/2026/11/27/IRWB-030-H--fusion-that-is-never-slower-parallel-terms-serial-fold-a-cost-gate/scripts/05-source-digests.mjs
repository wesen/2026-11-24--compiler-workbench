// IRWB-030-H script 05: SHA-256 of the corpus lowerings' CUDA source, to show which sources a change moves.
//   node <ticket>/scripts/05-source-digests.mjs
// Fused and unfused for the six corpus programs. Run before and after a change and diff the two outputs: the
// unfused digests must never move (stage 2's lowering is fixed), and a fused digest may only move for a program
// whose plan changed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const names = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const out = {};
for (const name of names) {
  const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
  for (const fuse of [true, false])
    out[`${name}${fuse ? '+fused' : '+unfused'}`] = createHash('sha256')
      .update(cudaSource(program, name, { fuse }))
      .digest('hex');
}
console.log(JSON.stringify(out, null, 1));
