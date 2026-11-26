import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { cudaLowering, verifyCudaLowering } from '../../dist/tensor/cuda-contract.js';
import { executeCuda } from '../../dist/tensor/cuda-run.js';
import {
  checkLowering,
  compileTix,
  cudaSource,
  optimizeTix,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';

const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
const check = async (program, name) => {
  const result = await checkLowering(program, name);
  assert.equal(result.relation, 'tolerance');
  assert.equal(result.accepted, true, result.reason);
};

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  test(name + ' passes the GB10 batch contract', async () => {
    const path = new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url);
    const program = compileTix(readFileSync(path, 'utf8'));
    await check(program, name);
  });
}

test('GB10 preserves ordered and split reductions on the same f32 input bits', async () => {
  const program = compileTix('fn f(x: f32[N,K]): f32[N] { y[i] = sum(j) x[i,j]; return y; }');
  const optimized = optimizeTix(program, ['split-sum']).program;
  assert.notEqual(optimized.current.revision, program.current.revision);
  const inputs = { x: buf([1, 7], [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24]) };
  const ordered = await runTixCuda(program, 'f', inputs);
  const split = await runTixCuda(optimized, 'f', inputs);
  assert.deepEqual(ordered.shape, [1]);
  assert.equal(ordered.data[0], 1);
  assert.equal(split.data[0], 1 + 2 ** -22);
  assert.ok(ordered.gpuMs > 0);
  await check(optimized, 'f');
});

test('GB10 preserves affine inline, scoped reductions, and multi-axis fold order', async () => {
  const inline = compileTix(`fn f(x: f32[N,N]): f32[N,N] {
    p[i,j] = x[i,j] + 1;
    y[i,j] = p[j,i] * 2;
    return y;
  }`);
  const optimized = optimizeTix(inline, ['inline']).program;
  assert.notEqual(optimized.current.revision, inline.current.revision);
  const result = await runTixCuda(optimized, 'f', { x: buf([2, 2], [1, 2, 3, 4]) });
  assert.deepEqual([...result.data], [4, 8, 6, 10]);
  await check(optimized, 'f');

  const nested = compileTix(`fn f(x: f32[N,K], y: f32[N,J]): f32[N] {
    t[i] = sum(j) x[i,j] + sum(j) y[i,j];
    return t;
  }`);
  const inputs = { x: buf([2, 2], [1, 2, 3, 4]), y: buf([2, 1], [5, 6]) };
  const got = await runTixCuda(nested, 'f', inputs);
  assert.deepEqual([...got.data], [...runTix(nested, 'f', inputs).data]);

  const multi = compileTix('fn f(x: f32[N,K,J]): f32[N] { t[i] = sum(k,j) x[i,k,j]; return t; }');
  const folded = await runTixCuda(multi, 'f', { x: buf([1, 2, 2], [2 ** 24, 1, -(2 ** 24), 0]) });
  assert.deepEqual([...folded.data], [0]);
});

test('GB10 handles no-launch runs, nonfinite results and empty reduction identities', async () => {
  const program = compileTix(`
    fn identity(x: f32[N]): f32[N] { return x; }
    fn logs(x: f32[N]): f32[N] { y[i] = log(x[i]); return y; }
    fn maxes(x: f32[N,K]): f32[N] { y[i] = max(j) x[i,j]; return y; }
    fn sums(x: f32[N,K]): f32[N] { y[i] = sum(j) x[i,j]; return y; }
  `);
  const [identity, empty] = await Promise.all([
    runTixCuda(program, 'identity', { x: buf([2], [-0, 1]) }),
    runTixCuda(program, 'identity', { x: buf([0], []) }),
  ]);
  assert.deepEqual([...identity.data], [-0, 1]);
  assert.equal(identity.gpuMs, 0);
  assert.deepEqual(empty.shape, [0]);
  assert.equal(empty.gpuMs, 0);
  const logs = await runTixCuda(program, 'logs', { x: buf([2], [-1, 0]) });
  assert.deepEqual([...logs.data], [NaN, -Infinity]);
  const noTerms = { x: buf([2, 0], []) };
  assert.deepEqual([...(await runTixCuda(program, 'maxes', noTerms)).data], [-Infinity, -Infinity]);
  assert.deepEqual([...(await runTixCuda(program, 'sums', noTerms)).data], [0, 0]);
  await check(program, 'logs');
  await check(program, 'maxes');
});

test('GB10 postcondition rejects a valid CUDA mutant that changes tensor reads', async () => {
  const program = compileTix('fn f(x: f32[N]): f32[N] { y[i] = x[i] * 3; return y; }');
  const original = cudaSource(program, 'f');
  const mutant = original.replace(/p0\[\(0LL \* .*?\)\]/, 'p0[0]');
  assert.notEqual(mutant, original);
  const result = await verifyCudaLowering(
    program.current,
    'f',
    cudaLowering(() => mutant),
  );
  assert.equal(result.accepted, false);
  assert.match(result.reason, /at \[1\].*f32=.*f64=.*GPU=/);
});

test('a successful executable without the result file fails decoding', async () => {
  const program = compileTix('fn f(x: f32[N]): f32[N] { return x; }');
  const [fn] = program.current.value.functions;
  await assert.rejects(
    executeCuda('int main() { return 0; }', fn, [{ id: 0, inputs: { x: buf([1], [1]) } }]),
    /results\.bin/,
  );
});

test('the standalone source cache serializes builds and isolates concurrent payloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'irwb-cuda-cache-test-'));
  const source = `// ${randomUUID()}
    #include <cstdio>
    int main() {
      auto* in = std::fopen("payload", "rb");
      auto* out = std::fopen("out/result", "wb");
      if (!in || !out) return 1;
      std::fputc(std::fgetc(in), out);
      std::fclose(in);
      return std::fclose(out);
    }
  `;
  const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
  const run = promisify(execFile);
  try {
    const work = await Promise.all(
      ['A', 'B'].map(async payload => {
        const cwd = join(dir, payload);
        await mkdir(cwd);
        await Promise.all([
          writeFile(join(cwd, 'main.cu'), source),
          writeFile(join(cwd, 'payload'), payload),
        ]);
        return { cwd, payload };
      }),
    );
    const results = await Promise.all(
      work.map(async ({ cwd, payload }) => {
        const { stdout } = await run(process.execPath, [tool, cwd, '--source-only']);
        assert.equal(await readFile(join(cwd, 'out', 'result'), 'utf8'), payload);
        return JSON.parse(stdout);
      }),
    );
    assert.equal(results[0].hash, results[1].hash);
    assert.equal(results.filter(r => r.compiled).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the remote tool reports a fetch failure when the executable removes out/', async () => {
  const program = compileTix('fn f(x: f32[N]): f32[N] { return x; }');
  const [fn] = program.current.value.functions;
  const source = '#include <cstdio>\nint main() { return std::remove("out"); }';
  await assert.rejects(executeCuda(source, fn, [{ id: 0, inputs: { x: buf([1], [1]) } }]), /fetch outputs/);
});
