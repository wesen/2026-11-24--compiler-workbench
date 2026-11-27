// What the contract costs, per program, with the tiling's extra cases. Wall time of one `checkLowering` with the
// binary already in the remote build cache (a new source also pays one nvcc run, ~1 s), and the case count of the
// differential for each program.
//
//   node scripts/04-contract-cost.mjs
import { readFileSync } from 'node:fs';
import { compileTix, checkLowering, cudaSource } from '../../../../../../dist/tensor/index.js';
import { takesGate, takesTile } from '../../../../../../dist/tensor/cuda-source.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const names = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
for (const name of names) {
  for (const fuse of [true, false]) {
    const program = corpus(name);
    const source = cudaSource(program, name, { fuse });
    const started = process.hrtime.bigint();
    const verdict = await checkLowering(program, name, { fuse });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const repeat = process.hrtime.bigint();
    await checkLowering(program, name, { fuse });
    const repeatMs = Number(process.hrtime.bigint() - repeat) / 1e6;
    console.log(
      JSON.stringify({
        program: name,
        fuse,
        accepted: verdict.accepted,
        relation: verdict.relation,
        gates: takesGate(source),
        tiles: takesTile(source),
        firstMs: +ms.toFixed(0),
        repeatMs: +repeatMs.toFixed(0),
      }),
    );
  }
}
