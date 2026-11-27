import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  test('GB10 checks ' + name + ' before and after optimization', async () => {
    const source = await readFile(
      new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url),
      'utf8',
    );
    const program = compileTix(source);
    const optimized = optimizeTix(program, ['inline', 'split-sum']);
    assert.ok(optimized.steps.every(s => s.accepted));
    for (const revision of [program, optimized.program]) {
      const verdict = await checkLowering(revision, name);
      assert.equal(verdict.accepted, true, verdict.reason);
      assert.equal(verdict.relation, 'exact');
    }
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

const small = {
  matmul: [
    ['a', [3, 4]],
    ['b', [4, 5]],
  ],
  softmax: [['x', [3, 5]]],
  layernorm: [
    ['x', [3, 4]],
    ['gamma', [4]],
    ['beta', [4]],
    ['eps', [1]],
  ],
  attention: [
    ['q', [2, 3]],
    ['k', [4, 3]],
    ['v', [4, 2]],
  ],
  mlp: [
    ['x', [2, 3]],
    ['w', [3, 4]],
    ['bias', [4]],
    ['v', [4, 2]],
    ['outBias', [2]],
  ],
  conv2d: [
    ['x', [1, 2, 4, 5]],
    ['kernel', [2, 2, 3, 3]],
  ],
};
function inputs(spec) {
  let state = 7;
  const out = {};
  for (const [name, shape] of spec) {
    const n = shape.reduce((x, y) => x * y, 1);
    out[name] = {
      shape,
      data: Float32Array.from({ length: n }, (_, i) => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const v = state / 2 ** 32;
        // positive eps and gamma so layernorm's root stays finite
        return name === 'eps' ? 1e-3 : name === 'gamma' ? 0.5 + v : 2 * v - 1;
      }),
    };
  }
  return out;
}

const edge = {
  'row then contraction':
    'fn f(x:f32[N,K], v:f32[K,O]):f32[N,O]{s[i]=sum(j) x[i,j];y[i,o]=sum(k) (x[i,k]-s[i])*v[k,o];return y;}',
  'two rows of different extents':
    'fn f(x:f32[N,K], z:f32[P,M]):f32[N,K]{a[p]=sum(m) z[p,m];b[i]=sum(k) x[i,k];c[i,j]=b[i]*x[i,j];return c;}',
  'permuted read of a reduction':
    'fn f(x:f32[N,K]):f32[N,N]{s[i,j]=sum(k) x[i,k]*x[j,k];t[i,j]=s[j,i]+1;return t;}',
  'nested reduction': 'fn f(x:f32[N,K]):f32[N]{y[i]=sum(j) (x[i,j]*(sum(k) x[i,k]));return y;}',
  'empty lanes and rows':
    'fn f(x:f32[N,K]):f32[N,K]{m[i]=max(j) x[i,j];s[i]=sum(j) exp(x[i,j]-m[i]);y[i,j]=exp(x[i,j]-m[i])/s[i];return y;}',
  'dead and staged':
    'fn f(x:f32[N,K]):f32[N]{d[i,j]=x[i,j]*0;s[i]=sum(j) x[i,j];y[i]=s[i]*s[i]+d[i,0];return y;}',
};
for (const [label, source] of Object.entries(edge)) {
  test('GB10 fused lowering equals the unfused one word for word: ' + label, async () => {
    const program = compileTix(source);
    const shapes = {
      N: 3,
      K: 4,
      P: 2,
      M: 5,
      O: 3,
    };
    const params = program.current.value.functions[0].params;
    const x = {};
    for (const p of params) {
      const shape = p.shape.map(d => (d.terms.length ? shapes[d.terms[0][0]] : d.constant));
      x[p.name] = inputs([[p.name, shape]])[p.name];
    }
    const reference = runTix(program, 'f', x);
    for (const fuse of [true, false]) {
      const result = await runTixCuda(program, 'f', x, { fuse });
      assert.deepEqual(result.shape, reference.shape, label);
      assert.deepEqual([...words(result)], [...words(reference)], label + ' fuse=' + fuse);
    }
  });
}

test('GB10 fused lowering equals the f32 meaning on the corpus at small sizes', async () => {
  for (const [name, spec] of Object.entries(small)) {
    const program = compileTix(
      readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8'),
    );
    const x = inputs(spec);
    const reference = runTix(program, name, x);
    const result = await runTixCuda(program, name, x);
    assert.deepEqual(result.shape, reference.shape, name);
    assert.deepEqual([...words(result)], [...words(reference)], name);
  }
});

test('GB10 rejects a fused kernel whose fold drops its last lane', async () => {
  const program = compileTix(
    await readFile(new URL('../../corpus/tensor/softmax/main.tix', import.meta.url), 'utf8'),
  );
  const source = cudaSource(program, 'softmax');
  const mutant = source.replace('const I end_r1 = (d1);', 'const I end_r1 = (d1) - 1;');
  assert.notEqual(mutant, source);
  assert.equal((await checkLowering(program, 'softmax')).accepted, true);
  const verdict = await checkCudaLowering(program.current, 'softmax', cudaArtifact('softmax', mutant));
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /At \[.*\], expected/);
});
