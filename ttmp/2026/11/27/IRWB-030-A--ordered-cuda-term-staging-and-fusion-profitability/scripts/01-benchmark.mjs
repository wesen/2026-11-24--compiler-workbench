import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { plain, value } from '../../../../../../dist/tensor/model.js';

export const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
export const programs = [...Object.keys(sizes), 'layernorm-inside', 'attention-inside'];

export function workload(label, overrides = {}) {
  const [name, inside] = label.split('-');
  const dims = new Map(Object.entries({ ...sizes[name], ...overrides }));
  let text = readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8');
  if (inside && name === 'layernorm') {
    text = text.replace('(sum(j) x[i,j]) / D', 'sum(j) x[i,j] / D')
      .replace('(sum(j) centered[i,j] * centered[i,j]) / D', 'sum(j) centered[i,j] * centered[i,j] / D');
  }
  if (inside && name === 'attention') {
    text = text.replace('(sum(d) q[i,d] * k[j,d]) / sqrt(D)', 'sum(d) q[i,d] * k[j,d] / sqrt(D)')
      .replace('  weight[i,j] = e[i,j] / z[i];\n', '')
      .replace('sum(j) weight[i,j] * v[j,c]', 'sum(j) e[i,j] * v[j,c] / z[i]');
  }
  const program = compileTix(text);
  const fn = program.current.value.functions[0];
  let seed = 20;
  const random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.2;
  const inputs = Object.fromEntries(fn.params.map(p => {
    const shape = p.shape.map(d => value(d, dims));
    const data = Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) },
      p.name === 'eps' && p.shape.every(d => plain(d) === undefined) ? () => 1e-5 : random);
    return [p.name, { shape, data }];
  }));
  return { name, program, fn, inputs };
}

export function digest(result) {
  return createHash('sha256').update(Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength)).digest('hex');
}

if (import.meta.main) {
  const labels = process.argv.slice(2);
  for (const label of labels.length ? labels : programs) {
    const { name, program, inputs } = workload(label);
    const results = [];
    for (const fuse of [true, false]) {
      const source = cudaSource(program, name, { fuse });
      const ms = [], hashes = [];
      for (let retry = 0; retry < 3; ++retry) {
        const result = await runTixCuda(program, name, inputs, { fuse, benchmark: true });
        ms.push(result.gpuMs);
        hashes.push(digest(result));
      }
      assert.ok(hashes.every(hash => hash === hashes[0]));
      results.push({
        fuse, kernels: (source.match(/__global__ void/g) ?? []).length,
        staged: [...source.matchAll(/Parallel terms for ([^.]+)\./g)].map(m => m[1]),
        ms, median: ms.toSorted((a, b) => a - b)[1], hash: hashes[0],
      });
    }
    assert.equal(results[0].hash, results[1].hash, label);
    console.log(JSON.stringify({ label, results }));
  }
}
