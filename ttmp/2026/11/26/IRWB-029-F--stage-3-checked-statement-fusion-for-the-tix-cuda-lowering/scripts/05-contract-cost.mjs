// IRWB-029-F script 05: what the exact lowering contract checks and what it costs per corpus program.
// A cold check generates the stage 1 sample cases, runs the f64 reference, and sends the undecided cases to
// the GB10 in one batch; a repeat check replays the recorded verdicts. Times are wall clock on this host.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const { compileTix, checkLowering } = await import(join(root, 'dist/tensor/index.js'));

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));
  const cold = await (async () => {
    const start = performance.now();
    const verdict = await checkLowering(program, name);
    return { seconds: (performance.now() - start) / 1000, verdict };
  })();
  const warm = await (async () => {
    const start = performance.now();
    const verdict = await checkLowering(program, name);
    return { seconds: (performance.now() - start) / 1000, verdict };
  })();
  console.log(
    name.padEnd(10),
    'cold', cold.seconds.toFixed(2) + 's',
    'warm', warm.seconds.toFixed(3) + 's',
    'accepted', cold.verdict.accepted, cold.verdict.relation,
  );
}
