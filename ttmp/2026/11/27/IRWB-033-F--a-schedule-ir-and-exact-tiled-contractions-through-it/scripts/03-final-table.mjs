// IRWB-033-F script 03: the final table. Every corpus program at the brief's sizes, fused and unfused,
// alternating A B A B (five benchmark calls each, each the median of three timed launches), with output
// digests compared in every call. The device clock is read before and after the 4096^3 matmul to check for
// thermal drift. The base's numbers (commit 0f45d04, the T3b merge) are IRWB-030-E script 13's table,
// measured with this protocol on 2026-11-27.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';

const sizes = {
  matmul: [512, 512, 512],
  softmax: [4096, 1024],
  layernorm: [4096, 1024],
  attention: [1024, 64, 1024, 64],
  mlp: [1024, 256, 1024, 256],
  conv2d: [8, 16, 64, 64, 32],
};
const run = promisify(execFile);
async function clock() {
  const dir = await mkdtemp(join(tmpdir(), 'irwb-clock-'));
  try {
    await writeFile(
      join(dir, 'main.cu'),
      `#include <cuda_runtime.h>
#include <cstdio>
int main() {
  cudaDeviceProp prop;
  cudaGetDeviceProperties(&prop, 0);
  int clock = 0;
  cudaDeviceGetAttribute(&clock, cudaDevAttrClockRate, 0);
  printf("%d kHz (%s)\\n", clock, prop.name);
  return 0;
}`,
    );
    const runner = fileURLToPath(new URL('../../../../../../tools/cuda-remote.mjs', import.meta.url));
    const { stdout } = await run('node', [runner, dir]);
    const result = JSON.parse(stdout);
    return (JSON.parse(result.stdout ?? "{}").stdout || "").trim() || "no clock output";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sha = b => createHash('sha256').update(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).digest('hex');
const inputsFor = (fn, sizesList) => {
  let s = 20;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const symbols = [...new Set(fn.params.flatMap(p => p.shape.map(d => d.terms[0]?.[0]).filter(Boolean)))];
  const dims = new Map(symbols.map((n, i) => [n, sizesList[i]]));
  return Object.fromEntries(
    fn.params.map(p => [
      p.name,
      {
        shape: p.shape.map(d => (d.terms[0]?.[0] ? dims.get(d.terms[0][0]) : d.constant)),
        data: Float32Array.from(
          { length: p.shape.reduce((n, d) => n * (d.terms[0]?.[0] ? dims.get(d.terms[0][0]) : d.constant), 1) },
          () => 0.1 * rnd(),
        ),
      },
    ]),
  );
};

const rows = [];
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
  const fn = program.current.value.functions[0];
  const inputs = inputsFor(fn, sizes[name]);
  if (name === 'matmul') console.log('clock before 4096:', await clock());
  const row = { program: name, sizes: sizes[name], kernelsFused: (cudaSource(program, name).match(/__global__ void/g) ?? []).length, kernelsUnfused: (cudaSource(program, name, { fuse: false }).match(/__global__ void/g) ?? []).length };
  const fusedTimes = [], unfusedTimes = [], digests = [];
  for (let i = 0; i < 5; i++) {
    const fused = await runTixCuda(program, name, inputs, { benchmark: true });
    const unfused = await runTixCuda(program, name, inputs, { benchmark: true, fuse: false });
    fusedTimes.push(fused.gpuMs);
    unfusedTimes.push(unfused.gpuMs);
    digests.push(sha(fused.data) === sha(unfused.data));
  }
  const median = t => [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)];
  row.fusedMs = median(fusedTimes);
  row.unfusedMs = median(unfusedTimes);
  row.fusedAll = fusedTimes.map(t => Math.round(t * 1000) / 1000);
  row.unfusedAll = unfusedTimes.map(t => Math.round(t * 1000) / 1000);
  row.digestsEqual = digests.every(Boolean);
  rows.push(row);
  console.log(JSON.stringify(row));
  if (name === 'matmul') console.log('clock after 512:', await clock());
}

// matmul at 4096^3, fused and unfused, with the clock read around it
{
  const program = compileTix(readFileSync(new URL('../../../../../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8'));
  const fn = program.current.value.functions[0];
  const inputs = inputsFor(fn, [4096, 4096, 4096]);
  console.log('clock before 4096:', await clock());
  const fusedTimes = [], unfusedTimes = [], digests = [];
  for (let i = 0; i < 5; i++) {
    const fused = await runTixCuda(program, 'matmul', inputs, { benchmark: true });
    const unfused = await runTixCuda(program, 'matmul', inputs, { benchmark: true, fuse: false });
    fusedTimes.push(fused.gpuMs);
    unfusedTimes.push(unfused.gpuMs);
    digests.push(sha(fused.data) === sha(unfused.data));
  }
  const median = t => [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)];
  console.log(
    JSON.stringify({
      program: 'matmul',
      sizes: [4096, 4096, 4096],
      fusedMs: median(fusedTimes),
      unfusedMs: median(unfusedTimes),
      fusedAll: fusedTimes.map(t => Math.round(t * 100) / 100),
      unfusedAll: unfusedTimes.map(t => Math.round(t * 100) / 100),
      digestsEqual: digests.every(Boolean),
    }),
  );
  console.log('clock after 4096:', await clock());
}
