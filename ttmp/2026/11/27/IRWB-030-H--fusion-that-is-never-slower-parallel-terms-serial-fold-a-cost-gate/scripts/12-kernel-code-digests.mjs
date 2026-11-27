// IRWB-030-H script 12: SHA-256 of the corpus lowerings' CUDA source with the plan comment lines removed, fused and
// unfused. Two builds compared this way answer "did this stage change any instruction of these kernels?" without
// the comment noise; `scripts/12-kernel-code-digests.json` holds the answer for the base commit and for this stage.
//   node <ticket>/scripts/12-kernel-code-digests.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const out = {};
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'])
  for (const fuse of [true, false]) {
    const program = compileTix(readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8'));
    const code = cudaSource(program, name, { fuse })
      .split('\n')
      .filter(line => !line.startsWith('// k'))
      .join('\n');
    out[`${name}${fuse ? '+fused' : '+unfused'}`] = createHash('sha256').update(code).digest('hex');
  }
console.log(JSON.stringify(out, null, 1));
