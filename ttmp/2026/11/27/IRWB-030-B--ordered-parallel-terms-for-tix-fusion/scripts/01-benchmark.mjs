import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { corpusInputs, sizes } from '../../../26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/scripts/04-benchmark.mjs';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';

export function workload(label) {
  const name = label.split('-')[0];
  const fixture = corpusInputs(name);
  if (!label.endsWith('-inside')) return { name, ...fixture };
  let text = readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8');
  text = text.replaceAll('(sum(j) x[i,j])', 'sum(j) x[i,j]')
    .replace('(sum(j) centered[i,j] * centered[i,j])', 'sum(j) centered[i,j] * centered[i,j]')
    .replace('(sum(d) q[i,d] * k[j,d])', 'sum(d) q[i,d] * k[j,d]')
    .replace('weight[i,j] = e[i,j] / z[i];', '').replace('weight[i,j] * v[j,c]', 'e[i,j] * v[j,c] / z[i]');
  return { ...fixture, name, program: compileTix(text) };
}
if (import.meta.url === 'file://' + process.argv[1]) {
  const [repeats, mode, ...labels] = process.argv.slice(2);
  for (const label of labels.length ? labels : [...Object.keys(sizes), 'layernorm-inside', 'attention-inside']) {
    const { name, program, inputs } = workload(label);
    for (let rep = 0; rep < Number(repeats); rep++) {
      for (const fuse of mode === 'both' ? [true, false] : [mode === 'fused']) {
        const source = cudaSource(program, name, { fuse });
        const { data, gpuMs } = await runTixCuda(program, name, inputs, { fuse, benchmark: true });
        console.log(JSON.stringify({ label, rep, fuse, kernels: source.match(/__global__ void/g).length,
          gpuMs, digest: createHash('sha256').update(data).digest('hex') }));
      }
    }
  }
}
