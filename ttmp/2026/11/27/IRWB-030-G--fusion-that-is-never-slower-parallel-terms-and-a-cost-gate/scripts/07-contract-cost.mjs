// IRWB-030-G script 07: what the lowering contract checks and what it costs, per program.
//
// The contract of a Tix lowering is one differential invariant: `tensor.cuda-meaning` (version 2) compares every
// case's GPU output with the current revision's f32 meaning, word for word, with NaN compared as a class. This
// script reports, per program and per lowering:
//   - the case set (shape assignments x input streams) and its size, and the local time to build it with the f32
//     references (cudaCases, the contract's own recipe);
//   - one cold batch through tools/cuda-remote.mjs with a unique comment appended to the source, so nvcc runs;
//   - checkLowering wall time in this process, first call and repeated call (the framework memo replays it).
//
//   node <ticket>/scripts/07-contract-cost.mjs [--fuse=false] [program ...]
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
import { corpusSizes, load } from './01-bench.mjs';

const here = new URL('./', import.meta.url).pathname;
const programs = {
  matmul: { program: 'matmul' },
  softmax: { program: 'softmax' },
  layernorm: { program: 'layernorm' },
  attention: { program: 'attention' },
  mlp: { program: 'mlp' },
  conv2d: { program: 'conv2d' },
  layernorm_inside: { program: here + '01-layernorm-inside.tix', fn: 'layernorm_inside', sizes: { N: 4096, D: 1024 } },
  attention_inside: {
    program: here + '01-attention-inside.tix',
    fn: 'attention_inside',
    sizes: { Q: 1024, K: 1024, D: 64, V: 64 },
  },
};
const args = process.argv.slice(2);
const fuse = !args.includes('--fuse=false');
const names = args.filter(a => !a.startsWith('--'));
for (const name of names.length ? names : Object.keys(programs)) {
  const spec = programs[name];
  const { program, fn } = load(spec.program, spec.fn);
  let start = performance.now();
  const cases = cudaCases(program.current.value.functions.find(f => f.name === fn), seededRandom(seed));
  const casesMs = performance.now() - start;
  const elements = cases.reduce(
    (n, c) => n + Object.values(c.inputs).reduce((m, t) => m + t.data.length, 0) + c.reference.data.length,
    0,
  );
  const source = cudaSource(program, fn, { fuse });
  const dir = await mkdtemp(join(tmpdir(), 'irwb-030-cost-'));
  let runner;
  try {
    await writeFile(join(dir, 'main.cu'), source + `\n// cold ${randomUUID()}\n`);
    await writeFile(
      join(dir, 'inputs.bin'),
      encodeCudaCases(
        program.current.value.functions.find(f => f.name === fn),
        cases.map(c => c.inputs),
      ),
    );
    start = performance.now();
    const { stdout } = await promisify(execFile)(process.execPath, [
      'tools/cuda-remote.mjs',
      dir,
      '--runtime-input',
      'inputs.bin',
      ...(args.includes('--benchmark') ? ['--timed', '--', '--benchmark'] : []),
    ]);
    const { compiled, compileMs, runMs } = JSON.parse(stdout);
    runner = { compiled, compileMs, runMs, wallMs: Math.round(performance.now() - start) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  start = performance.now();
  const first = await checkLowering(program, fn, { fuse });
  const firstMs = performance.now() - start;
  start = performance.now();
  const again = await checkLowering(program, fn, { fuse });
  const againMs = performance.now() - start;
  console.log(
    JSON.stringify({
      name,
      fuse,
      kernels: (source.match(/__global__ void/g) ?? []).length,
      sourceBytes: source.length,
      cases: cases.length,
      shapeAssignments: new Set(cases.map(c => JSON.stringify(c.shapeValues))).size,
      elements,
      casesMs: Math.round(casesMs),
      coldBatch: runner,
      check: { ...first, wallMs: Math.round(firstMs) },
      repeat: { ...again, wallMs: Math.round(againMs) },
    }),
  );
}
void corpusSizes;
