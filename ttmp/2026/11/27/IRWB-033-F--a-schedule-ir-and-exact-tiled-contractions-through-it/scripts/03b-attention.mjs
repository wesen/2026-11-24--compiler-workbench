// IRWB-033-F script 03b: attention at the brief's sizes (the symbol order is Q, D, K, V), because script 03's
// first run had them in the wrong order. Same protocol: five interleaved benchmark calls per lowering.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileTix, runTixCuda } from '../../../../../../dist/tensor/index.js';

const sha = b => createHash('sha256').update(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).digest('hex');
const program = compileTix(readFileSync(new URL('../../../../../../corpus/tensor/attention/main.tix', import.meta.url), 'utf8'));
const fn = program.current.value.functions[0];
let s = 20;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const dims = new Map([
  ['Q', 1024],
  ['D', 64],
  ['K', 1024],
  ['V', 64],
]);
const inputs = Object.fromEntries(
  fn.params.map(p => [
    p.name,
    {
      shape: p.shape.map(d => (d.terms[0]?.[0] ? dims.get(d.terms[0][0]) : d.constant)),
      data: Float32Array.from(
        {
          length: p.shape.reduce((n, d) => n * (d.terms[0]?.[0] ? dims.get(d.terms[0][0]) : d.constant), 1),
        },
        () => 0.1 * rnd(),
      ),
    },
  ]),
);
const fusedTimes = [], unfusedTimes = [], digests = [];
for (let i = 0; i < 5; i++) {
  const fused = await runTixCuda(program, 'attention', inputs, { benchmark: true });
  const unfused = await runTixCuda(program, 'attention', inputs, { benchmark: true, fuse: false });
  fusedTimes.push(fused.gpuMs);
  unfusedTimes.push(unfused.gpuMs);
  digests.push(sha(fused.data) === sha(unfused.data));
}
const median = t => [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)];
console.log(
  JSON.stringify({
    program: 'attention',
    sizes: { Q: 1024, K: 1024, D: 64, V: 64 },
    fusedMs: median(fusedTimes),
    unfusedMs: median(unfusedTimes),
    fusedAll: fusedTimes,
    unfusedAll: unfusedTimes,
    digestsEqual: digests.every(Boolean),
  }),
);
