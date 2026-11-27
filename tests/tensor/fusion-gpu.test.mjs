// Checked fusion on the GB10 (IRWB-029-E). tests/tensor/cuda-gpu.test.mjs checks the corpus with the default
// (fused) lowering; this file checks stage 2's lowering beside it, rows longer than a block and than shared
// memory, mutants of a fused kernel, random programs, and the benchmark option.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  checkLowering,
  compileTix,
  cudaSource,
  optimizeTix,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';
import { rowThreads } from '../../dist/tensor/cuda-source.js';
import { randomProgram } from './fixtures/random-programs.mjs';

const corpus = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const load = async name =>
  compileTix(await readFile(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const tensor = (shape, f) => ({
  shape,
  data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, (_, i) => f(i)),
});
const noise = i => Math.sin(i * 12.9898) * 0.7;

test('GB10 accepts both lowerings of every corpus program as exact', async () => {
  await Promise.all(
    corpus.map(async name => {
      const program = await load(name);
      for (const revision of [program, optimizeTix(program, ['inline', 'split-sum']).program])
        for (const fuse of [true, false]) {
          const verdict = await checkLowering(revision, name, { fuse });
          assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, `${name} fuse=${fuse}`);
        }
    }),
  );
});

test('GB10 fused rows longer than a block, and longer than shared memory, give the meaning’s bits', async () => {
  const softmax = await load('softmax'),
    layernorm = await load('layernorm');
  // 13000 floats per row exceed the 48 KB a block may stage: the rows go to global scratch
  for (const shape of [
    [3, 5 * rowThreads + 7],
    [2, 13000],
  ]) {
    const x = { x: tensor(shape, noise) };
    for (const fuse of [true, false])
      assert.deepEqual(
        words(await runTixCuda(softmax, 'softmax', x, { fuse })),
        words(runTix(softmax, 'softmax', x)),
      );
    const [n, d] = shape;
    const inputs = {
      x: tensor([n, d], noise),
      gamma: tensor([d], i => 1 + noise(i)),
      beta: tensor([d], i => noise(i + 3)),
      eps: tensor([1], () => 1e-5),
    };
    assert.deepEqual(
      words(await runTixCuda(layernorm, 'layernorm', inputs)),
      words(runTix(layernorm, 'layernorm', inputs)),
    );
  }
});

test('GB10 a step that stores nothing in the block still ends with a barrier', async () => {
  // p reads the staged row of x at j + 1 and is read only outside the kernel; q then takes x's slot. Without a
  // barrier after p, a thread already computing q would overwrite elements another thread's p still reads.
  const program = compileTix(`fn f(x:f32[N,M], w:f32[M]):f32[M-1] {
    m[i] = max(j) x[i,j];
    p[i,j]:f32[N,M-1] = x[i,j+1] - m[i];
    q[i,j] = m[i] * w[j];
    r[i] = sum(j) q[i,j];
    fin[j] = sum(i) p[i,j] * r[i];
    return fin;
  }`);
  const source = cudaSource(program, 'f');
  assert.equal(source.match(/__global__ void/g).length, 2);
  assert.equal(source.match(/__syncthreads/g).length, 4);
  assert.deepEqual(await checkLowering(program, 'f'), { accepted: true, relation: 'exact' });
  const inputs = { x: tensor([3, 500], noise), w: tensor([500], i => noise(i + 1)) };
  assert.deepEqual(words(await runTixCuda(program, 'f', inputs)), words(runTix(program, 'f', inputs)));
});

test('GB10 rejects mutants of a fused kernel: fold order, the stride, and the spilled rows only', async () => {
  const program = await load('softmax');
  const source = cudaSource(program, 'softmax');
  assert.equal(source.match(/__global__ void/g).length, 1);
  const mutants = {
    // the sum of e accumulates from the last element down
    order: [
      /for \(I (i\d+) = 0; \1 < (end_\1); \+\+\1\) \{\n(\s+v\d+ = __fadd_rn)/,
      'for (I $1 = $2 - 1; $1 >= 0; --$1) {\n$3',
    ],
    // a thread computes only its first element of e: seen only by the cases with a row longer than a block
    stride: [/(exp\(static_cast<double>\(v\d+\)\)\);\n\s+staged\[0 \+ i\d+\] = v\d+;\n)/, '$1    break;\n'],
    // every block uses the first row's scratch: seen only by the run with spilled rows
    spill: ['spill + row * ', 'spill + 0 * '],
  };
  // shape values are in the symbols' sorted order: C, N
  const long = new RegExp(`"shapeValues":\\[${rowThreads + 3},2\\].*At \\[`);
  const reasons = { order: /^\{.*At \[/, stride: long, spill: /With spilled rows: At \[/ };
  for (const [name, [from, to]] of Object.entries(mutants)) {
    const mutant = source.replace(from, to);
    assert.notEqual(mutant, source, name);
    const verdict = await checkCudaLowering(program.current, 'softmax', cudaArtifact('softmax', mutant));
    assert.equal(verdict.accepted, false, name);
    assert.match(verdict.reason, reasons[name], name);
  }
});

test('GB10 accepts the fused lowering of random programs', async () => {
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);
  let fused = 0;
  // three at a time: each check opens several ssh connections, and the machine's sshd resets a burst
  for (let i = 0; i < seeds.length; i += 3)
    await Promise.all(
      seeds.slice(i, i + 3).map(async seed => {
        const source = randomProgram(seed),
          program = compileTix(source);
        if (cudaSource(program, 'f') !== cudaSource(program, 'f', { fuse: false })) fused++;
        const verdict = await checkLowering(program, 'f');
        assert.deepEqual(verdict, { accepted: true, relation: 'exact' }, source);
      }),
    );
  assert.ok(fused >= 12, String(fused));
});

test('GB10 benchmark option reports a kernel time and the same bits', async () => {
  const program = await load('softmax');
  const x = { x: tensor([64, 256], noise) };
  const result = await runTixCuda(program, 'softmax', x, { benchmark: true });
  assert.ok(result.gpuMs > 0 && result.gpuMs < 100);
  assert.deepEqual(words(result), words(runTix(program, 'softmax', x)));
});
