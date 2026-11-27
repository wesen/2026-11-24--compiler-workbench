// IRWB-029-D script 11: what the lowering contract checks and what it costs, per corpus program (fused):
//   - the case set (shape assignments x input streams) and its size, and the local time to build it with the
//     f32 references (cudaCases, the contract's own recipe);
//   - one cold batch through tools/cuda-remote.mjs with a unique comment appended to the source, so nvcc runs:
//     the runner's compile and run milliseconds;
//   - checkLowering wall time in this process, first call and repeated call (the framework memo replays it).
//   node <ticket>/scripts/11-contract-cost.mjs [name ...]
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { encodeCudaCases } from '../../../../../../dist/tensor/cuda-runtime.js';
import { checkLowering, cudaSource } from '../../../../../../dist/tensor/index.js';
import { corpusInputs, sizes } from './04-benchmark.mjs';

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(sizes)) {
  const { program, fn } = corpusInputs(name);
  let start = performance.now();
  const cases = cudaCases(fn, seededRandom(seed));
  const casesMs = performance.now() - start;
  const elements = cases.reduce(
    (n, c) => n + Object.values(c.inputs).reduce((m, t) => m + t.data.length, 0) + c.reference.data.length,
    0,
  );
  const dir = await mkdtemp(join(tmpdir(), 'irwb-029-cost-'));
  let runner;
  try {
    await writeFile(join(dir, 'main.cu'), cudaSource(program, name) + `\n// cold ${randomUUID()}\n`);
    await writeFile(join(dir, 'inputs.bin'), encodeCudaCases(fn, cases.map(c => c.inputs)));
    start = performance.now();
    const { stdout } = await promisify(execFile)(process.execPath, [
      'tools/cuda-remote.mjs',
      dir,
      '--runtime-input',
      'inputs.bin',
    ]);
    const { compiled, compileMs, runMs } = JSON.parse(stdout);
    runner = { compiled, compileMs, runMs, wallMs: Math.round(performance.now() - start) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  start = performance.now();
  const first = await checkLowering(program, name);
  const firstMs = performance.now() - start;
  start = performance.now();
  const again = await checkLowering(program, name);
  const againMs = performance.now() - start;
  const shapes = new Set(cases.map(c => JSON.stringify(c.shapeValues))).size;
  console.log(
    JSON.stringify({
      name,
      cases: cases.length,
      shapeAssignments: shapes,
      elements,
      casesMs: Math.round(casesMs),
      coldBatch: runner,
      check: { ...first, wallMs: Math.round(firstMs) },
      repeat: { ...again, wallMs: Math.round(againMs) },
    }),
  );
}
