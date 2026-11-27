import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { seededRandom } from '../../dist/framework/contracts/index.js';
import {
  checkLowering,
  compileTix,
  cudaSource,
  optimizeTix,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';
import { checkCudaLowering, cudaArtifact } from '../../dist/tensor/cuda-contract.js';

const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
// The exact relation compares NaN as a class: the GB10 and V8 write different NaN words.
const identical = (a, b) =>
  JSON.stringify(a.shape) === JSON.stringify(b.shape) &&
  words(a).length === words(b).length &&
  words(a).every((w, i) => w === words(b)[i] || (Number.isNaN(a.data[i]) && Number.isNaN(b.data[i])));
const inputs = (fn, assignment, fill) => {
  const tensors = {};
  const dims = new Map(Object.entries(assignment));
  for (const p of fn.params) {
    const shape = p.shape.map(d =>
      d.terms.length === 1 && d.terms[0][1] === 1 && d.constant === 0
        ? (dims.get(d.terms[0][0]) ?? 1)
        : d.constant,
    );
    shape.forEach((v, i) => {
      const key = p.shape[i].terms[0]?.[0];
      if (key && !dims.has(key)) dims.set(key, v);
    });
    tensors[p.name] = buf(
      shape,
      Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => fill()),
    );
  }
  return tensors;
};

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const sizes = {
    matmul: { M: 32, K: 16, N: 24 },
    softmax: { N: 64, C: 32 },
    layernorm: { N: 64, D: 32 },
    attention: { Q: 32, K: 24, D: 8, V: 12 },
    mlp: { N: 32, D: 16, H: 24, O: 12 },
    conv2d: { N: 2, C: 3, H: 8, W: 8, O: 3 },
  }[name];
  test('GB10 checks ' + name + ' fused and unfused, before and after optimization', async () => {
    const source = await readFile(
      new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url),
      'utf8',
    );
    const program = compileTix(source);
    const optimized = optimizeTix(program, ['inline', 'split-sum']);
    assert.ok(optimized.steps.every(s => s.accepted));
    const fn = program.current.value.functions[0];
    const random = seededRandom(29);
    const data = inputs(fn, sizes, () => 2 * random() - 1);
    if (name === 'layernorm') data.eps = buf([1], [1e-5]);
    const reference = runTix(program, name, data);
    const fused = await runTixCuda(program, name, data);
    assert.ok(identical(reference, fused), name + ' fused run differs from the f32 meaning');
    for (const revision of [program, optimized.program]) {
      const verdict = await checkLowering(revision, name);
      assert.equal(verdict.accepted, true, verdict.reason);
      assert.equal(verdict.relation, 'exact');
    }
    const unfused = await checkLowering(program, name, { fuse: false });
    assert.equal(unfused.accepted, true, unfused.reason);
    assert.equal(unfused.relation, 'exact');
  });
}

test('GB10 preserves split rounding and a partial final block', async () => {
  const p = compileTix('fn f(x:f32[N,K]):f32[N] { y[i] = sum(k) x[i,k]; return y; }');
  const { program, steps } = optimizeTix(p, ['split-sum']);
  assert.equal(steps[0].accepted, true);
  assert.notEqual(program.current.revision, p.current.revision);
  const inputs = { x: buf([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) };
  const reference = runTix(program, 'f', inputs);
  assert.equal(reference.data[0], 1 + 2 ** -22);
  const result = await runTixCuda(program, 'f', inputs);
  assert.deepEqual(result.shape, [1]);
  assert.deepEqual(words(result), words(reference));
  assert.ok(Number.isFinite(result.gpuMs) && result.gpuMs >= 0);

  const source = cudaSource(program, 'f');
  const mutant = source.replace(' + ((d1) % 4 != 0)', '');
  assert.notEqual(mutant, source);
  assert.equal((await checkLowering(program, 'f')).accepted, true);
  const verdict = await checkCudaLowering(program.current, 'f', cudaArtifact('f', mutant));
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /At \[.*\], expected/);
});

test('GB10 checks composed inline addresses and rejects a valid index mutant', async () => {
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N] { z[i,j]=x[i,j]*2; y[i,j]=z[j,i]+1; return y; }');
  const { program } = optimizeTix(p, ['inline']);
  assert.notEqual(p.current.revision, program.current.revision);
  const x = { x: buf([2, 2], [1, 2, 3, 4]) };
  assert.deepEqual((await runTixCuda(program, 'f', x)).data, Float32Array.of(3, 7, 5, 9));

  const source = cudaSource(program, 'f');
  const mutant = source.replace('t0[((i0) * (d0) + (i1))]', 't0[((i1) * (d0) + (i0))]');
  assert.notEqual(mutant, source);
  const verdict = await checkCudaLowering(program.current, 'f', cudaArtifact('f', mutant));
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /At \[.*\], expected/);
});

test('GB10 handles shadowing, empty reductions and outputs, intrinsic edges, and direct returns', async () => {
  const program = compileTix(`
    fn shadow(x:f32[N,K], z:f32[N,L]):f32[N] { y[i] = sum(j) x[i,j] + sum(j) z[i,j]; return y; }
    fn empty(x:f32[N,K]):f32[N,2] {
      s[i] = sum(k) x[i,k]; m[i] = max(k) x[i,k];
      y[i,j]:f32[N,2] = max(s[i], m[i]) + (log(1) * 0);
      return y;
    }
    fn intrinsic(x:f32[N]):f32[N] { y[i]=min(sqrt(x[i]), 0); return y; }
    fn direct(x:f32[N]):f32[N] { return x; }
  `);
  const cases = [
    ['shadow', { x: buf([1, 2], [1, 2]), z: buf([1, 3], [4, 5, 6]) }, [33]],
    ['empty', { x: buf([3, 0], []) }, [0, 0, 0, 0, 0, 0]],
    ['empty', { x: buf([0, 3], []) }, []],
    ['intrinsic', { x: buf([3], [-1, -0, 2]) }, [NaN, -0, 0]],
    ['direct', { x: buf([1], [-0]) }, [-0]],
  ];
  for (const [name, inputs, expected] of cases) {
    const result = await runTixCuda(program, name, inputs);
    assert.deepEqual([...result.data], expected);
    assert.deepEqual(result.shape, runTix(program, name, inputs).shape);
    if (name === 'direct' || !expected.length) assert.equal(result.gpuMs, 0);
  }
  const max = compileTix('fn f(x:f32[N,K]):f32[N] { y[i] = max(k) x[i,k]; return y; }');
  assert.deepEqual(
    (await runTixCuda(max, 'f', { x: buf([2, 0], []) })).data,
    Float32Array.of(-Infinity, -Infinity),
  );
});

test('remote runner links repeated libraries and keys the build by their order', async () => {
  const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
  // a 2x2 cublasSgemm checked against a CPU product (from IRWB-024's probe, scripts/01-cublas-product)
  const dir = fileURLToPath(new URL('./fixtures/cublas-product/', import.meta.url));
  async function run(first, second) {
    const { stdout } = await promisify(execFile)(process.execPath, [
      tool,
      dir,
      '--link',
      first,
      '--link',
      second,
    ]);
    const result = JSON.parse(stdout);
    assert.deepEqual(JSON.parse(result.stdout), [
      [19, 22],
      [43, 50],
    ]);
    return result.hash;
  }
  assert.notEqual(await run('m', 'cublas'), await run('cublas', 'm'));
});

test('remote runner shares a compile across isolated jobs and invalidates on build input changes', async () => {
  const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
  const exec = promisify(execFile);
  const dirs = await Promise.all(['A', 'B'].map(() => mkdtemp(join(tmpdir(), 'irwb-cuda-runner-test-'))));
  const source = `// ${randomUUID()}
#include <cstdio>
#include "header.h"
int main() {
  FILE* in = fopen("input.txt", "r");
  FILE* out = fopen("out/answer.txt", "w");
  fputc(fgetc(in), out);
  fputc(EXTRA, out);
  fclose(in);
  return fclose(out);
}
`;
  try {
    await Promise.all(
      dirs.map(async (dir, i) => {
        await writeFile(join(dir, 'main.cu'), source);
        await writeFile(join(dir, 'header.h'), "#define EXTRA '1'\n");
        await writeFile(join(dir, 'input.txt'), i ? 'B' : 'A');
      }),
    );
    async function run(dir) {
      const { stdout } = await exec(process.execPath, [tool, dir, '--runtime-input', 'input.txt']);
      return { ...JSON.parse(stdout), answer: await readFile(join(dir, 'out', 'answer.txt'), 'utf8') };
    }
    const [a, b] = await Promise.all(dirs.map(run));
    assert.equal(a.hash, b.hash);
    assert.deepEqual([a.compiled, b.compiled].sort(), [false, true]);
    assert.deepEqual([a.answer, b.answer], ['A1', 'B1']);
    await writeFile(join(dirs[0], 'header.h'), "#define EXTRA '2'\n");
    const changed = await run(dirs[0]);
    assert.equal(changed.compiled, true);
    assert.notEqual(changed.hash, a.hash);
    assert.equal(changed.answer, 'A2');
  } finally {
    await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
  }
});

test('GB10 fuses a row group beyond the shared cap through the global staging fallback', async () => {
  // One row needs 2 x 13000 floats > the 12288-float stage, so the kernel stages in the statement buffers.
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i]=max(j)x[i,j]; e[i,j]=exp(x[i,j]-m[i]); s[i]=sum(j)e[i,j]; y[i,j]=e[i,j]/s[i]; return y; }',
  );
  const fn = p.current.value.functions[0];
  const random = seededRandom(31);
  const data = inputs(fn, { N: 4, C: 13000 }, () => 2 * random() - 1);
  const source = cudaSource(p, 'f');
  assert.equal((source.match(/__global__ void/g) ?? []).length, 1);
  const reference = runTix(p, 'f', data);
  const result = await runTixCuda(p, 'f', data);
  assert.ok(identical(reference, result), 'fallback staging differs from the f32 meaning');
  const verdict = await checkLowering(p, 'f');
  assert.equal(verdict.accepted, true, verdict.reason);
});

test('GB10 fuses an elementwise chain into one kernel, bit-identically', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]+y[i]; return z; }');
  const fn = p.current.value.functions[0];
  const random = seededRandom(37);
  const data = inputs(fn, { N: 1024 }, () => 2 * random() - 1);
  assert.equal((cudaSource(p, 'f').match(/__global__ void/g) ?? []).length, 1);
  assert.ok(identical(runTix(p, 'f', data), await runTixCuda(p, 'f', data)));
  assert.equal((await checkLowering(p, 'f')).accepted, true);
});

test('GB10 rejects a fused-source mutant under the exact relation', async () => {
  const p = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i]=max(j)x[i,j]; e[i,j]=exp(x[i,j]-m[i]); s[i]=sum(j)e[i,j]; y[i,j]=e[i,j]/s[i]; return y; }',
  );
  const source = cudaSource(p, 'f');
  // A valid mutant: the row maximum folds as a minimum, so the fused kernel compiles but computes wrong bits.
  const mutant = source.replace('), true);', '), false);');
  assert.notEqual(mutant, source);
  const verdict = await checkCudaLowering(p.current, 'f', cudaArtifact('f', mutant));
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /At \[.*\], expected/);
});

test('runTixCuda exposes the benchmark option: warm-up plus the median of three timed intervals', async () => {
  const p = compileTix('fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]+y[i]; return z; }');
  const fn = p.current.value.functions[0];
  const random = seededRandom(41);
  const data = inputs(fn, { N: 4096 }, () => 2 * random() - 1);
  const result = await runTixCuda(p, 'f', data, { benchmark: true });
  assert.ok(Number.isFinite(result.gpuMs) && result.gpuMs > 0, 'gpuMs ' + result.gpuMs);
  assert.ok(identical(runTix(p, 'f', data), result));
});
