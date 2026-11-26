import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { AnalysisManager, differentialStats } from '../../dist/framework/contracts/index.js';
import { lowerCuda } from '../../dist/tensor/cuda-contract.js';
import {
  checkLowering,
  compileTix,
  cudaSource,
  optimizeTix,
  runTix,
  runTixCuda,
} from '../../dist/tensor/index.js';

const gpu = (name, fn) => test(name, { skip: process.env.TIX_TEST_GPU !== '1' && 'Set TIX_TEST_GPU=1' }, fn);
const buf = (shape, ...data) => ({ shape, data: Float32Array.from(data) });
async function exact(program, fn, inputs, expected, options) {
  const got = await runTixCuda(program, fn, inputs, options);
  const ref = runTix(program, fn, inputs);
  assert.deepEqual(got.shape, ref.shape);
  // Compare NaN by class, but use SameValue for every finite word (including -0).
  assert.deepEqual([...got.data], [...ref.data]);
  if (expected) assert.deepEqual([...got.data], expected);
  assert.ok(Number.isFinite(got.gpuMs) && got.gpuMs >= 0);
  return got;
}

gpu('GPU: no FMA, retain subnormals, and preserve multi-index fold order', async () => {
  const p = compileTix(`
    fn fma(a:f32[N], b:f32[N], c:f32[N]):f32[N] { y[i]=a[i]*b[i]+c[i];return y; }
    fn order(x:f32[M,J,K]):f32[M] { y[i]=sum(j,k) x[i,j,k];return y; }
  `);
  await exact(
    p,
    'fma',
    {
      a: buf([2], 1 + 2 ** -23, 2 ** -149),
      b: buf([2], 1 - 2 ** -23, 1),
      c: buf([2], -1, 2 ** -149),
    },
    [0, 2 ** -148],
    { host: process.env.CUDA_REMOTE_HOST ?? 'manuel@bling' },
  );
  await exact(p, 'order', { x: buf([1, 2, 2], 1e10, -1e10, 1, 1) }, [2]);
});

gpu('GPU: zero extents, parameter return, zero signs, and nonfinite results', async () => {
  const p = compileTix(`
    fn empty(x:f32[M,K]):f32[M,2] { y[i,j]:f32[M,2]=(sum(k) x[i,k]) + (max(k) x[i,k]); return y; }
    fn params(x:f32[N]):f32[N] { return x; }
    fn edge(x:f32[N]):f32[N] { y[i]=min(-0,max(x[i],log(x[i])));return y; }
  `);
  const empty = await exact(p, 'empty', { x: buf([2, 0]) }, [-Infinity, -Infinity, -Infinity, -Infinity]);
  assert.deepEqual(empty.shape, [2, 2]);
  const skipped = await exact(p, 'empty', { x: buf([0, 2]) }, []);
  assert.equal(skipped.gpuMs, 0);
  const passthrough = await exact(p, 'params', { x: buf([2], -0, 2 ** -149) }, [-0, 2 ** -149]);
  assert.equal(passthrough.gpuMs, 0);
  await exact(p, 'edge', { x: buf([3], 0, -1, 2) }, [-0, NaN, -0]);
  assert.equal((await checkLowering(p, 'empty')).accepted, true);
});

gpu('GPU: lower actual inline and split-sum revisions, preserving each rounding site', async () => {
  const p = compileTix(`fn f(x:f32[M,K], b:f32[M,K]):f32[M] {
    p[i,j]=x[i,j]*2;
    out[i]=(sum(j) (p[i,j] + (sum(j) b[i,j])))/2;
    return out;
  }`);
  const { program: inlined } = optimizeTix(p, ['inline']);
  const { program: split } = optimizeTix(inlined, ['split-sum']);
  assert.notEqual(inlined.current.revision, p.current.revision);
  assert.notEqual(split.current.revision, inlined.current.revision);
  const inputs = {
    x: buf([1, 7], 1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24),
    b: buf([1, 7], 0, 0, 0, 0, 0, 0, 0),
  };
  await exact(inlined, 'f', inputs, [1]);
  await exact(split, 'f', inputs, [1 + 2 ** -22]);
  assert.equal((await checkLowering(split, 'f')).accepted, true);
  await exact(split, 'f', { x: buf([1, 0]), b: buf([1, 0]) }, [0]);
});

gpu(
  'GPU: batched verdict reuse, a semantic counterexample, and failed compilation without verdicts',
  async () => {
    const p = compileTix('fn fold(x:f32[M,K]):f32[M]{ y[i]=sum(j) x[i,j];return y; }');
    const fn = 'fold';
    const counts = differentialStats(true);
    assert.equal(typeof counts.delegated, 'number');
    assert.deepEqual(await checkLowering(p, fn), { accepted: true, relation: 'tolerance' });
    const cold = differentialStats(true);
    assert.ok(cold.delegated > 1);
    assert.deepEqual(await checkLowering(p, fn), { accepted: true, relation: 'tolerance' });
    const warm = differentialStats(true);
    assert.equal(warm.delegated, 0);
    assert.equal(warm.replayed, cold.delegated);
    const good = cudaSource(p, fn);
    const wrong = good.replace(/buffers\[1\]\[flat\] = v\d+;/, 'buffers[1][flat] = 0.0f;');
    assert.notEqual(good, wrong);
    const manager = new AnalysisManager();
    const verify = output => manager.verifyTransformation({ input: p.current, fn }, { output }, lowerCuda);
    await assert.rejects(verify(wrong), /expected f64.*got 0; case/);
    assert.equal(differentialStats(true).delegated, cold.delegated);
    await assert.rejects(verify('not a CUDA translation unit'), /CUDA tool failed/);
    const failed = differentialStats(true);
    assert.equal(failed.delegated, 0);
    assert.equal(failed.replayed, 0);
    assert.equal(
      manager.snapshot().executions.some(e => e.status === 'accepted'),
      false,
    );
    assert.equal((await checkLowering(p, fn)).accepted, true);
    assert.equal(differentialStats(true).replayed, cold.delegated);
  },
);

gpu('GPU: the six corpus functions pass the lowering contract', async t => {
  for (const fn of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const p = compileTix(
      await readFile(new URL(`../../corpus/tensor/${fn}/main.tix`, import.meta.url), 'utf8'),
    );
    const manager = new AnalysisManager();
    await manager.execute(lowerCuda, { input: p.current, fn });
    const summary = manager
      .snapshot()
      .events.find(e => e.kind === 'CUDA batch' || JSON.stringify(e).includes('maxBudgetFraction'));
    assert.ok(summary);
    t.diagnostic(
      `${fn} ${JSON.stringify(summary).match(/"count":\d+,.*?"maxBudgetFraction":[\d.e+-]+/)?.[0] ?? JSON.stringify(summary)}`,
    );
  }
});

gpu(
  'remote tool: source-only cache and concurrent output isolation; default keys contain inputs',
  async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'tix-remote-test-'));
    const run = promisify(execFile);
    const source =
      `// ${tmp}\n#include <cstdio>\nint main() {\n` +
      `int c = fgetc(fopen("in", "rb")); fputc(c, fopen("out/value", "wb")); }\n`;
    const dirs = await Promise.all(
      ['A', 'B'].map(async input => {
        const dir = await mkdtemp(join(tmp, 'input-'));
        await Promise.all([writeFile(join(dir, 'main.cu'), source), writeFile(join(dir, 'in'), input)]);
        return dir;
      }),
    );
    const tool = async (dir, flags = []) => {
      const { stdout } = await run(process.execPath, ['tools/cuda-remote.mjs', dir, ...flags]);
      return [JSON.parse(stdout), await readFile(join(dir, 'out/value'), 'utf8')];
    };
    try {
      const [[a, x], [b, y]] = await Promise.all(dirs.map(d => tool(d, ['--cache-main'])));
      assert.equal(x, 'A');
      assert.equal(y, 'B');
      assert.equal(a.hash, b.hash);
      assert.equal(Number(a.compiled) + Number(b.compiled), 1);
      const [[c], [d]] = await Promise.all(dirs.map(d => tool(d)));
      assert.notEqual(c.hash, d.hash);
      assert.ok(c.compiled && d.compiled);
      assert.equal((await tool(dirs[0]))[0].compiled, false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
);
