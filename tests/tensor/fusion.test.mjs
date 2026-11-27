// Checked fusion (IRWB-029-E), the parts that need no GPU: the kernel plan and its legality rules, the kernel
// counts, the unchanged stage-2 text, and the contract's second run for row kernels (with a stand-in engine).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileTix, cudaSource, kernelPlan, optimizeTix } from '../../dist/tensor/index.js';
import { createCudaLowering, kernelCorrespondence } from '../../dist/tensor/cuda-contract.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { KernelIR, validatePlan } from '../../dist/tensor/kernels.js';
import { createArtifact } from '../../dist/framework/contracts/index.js';
import { randomProgram } from './fixtures/random-programs.mjs';

const corpus = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const load = async name =>
  compileTix(await readFile(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const count = source => (source.match(/__global__ void/g) ?? []).length;
const plan = (source, fn = 'f') => kernelPlan(compileTix(source), fn);

test('fuse: false gives the stage-2 source byte for byte', async () => {
  const expected = JSON.parse(
    await readFile(new URL('./fixtures/stage2-sources.json', import.meta.url), 'utf8'),
  );
  const sha = s => createHash('sha256').update(s).digest('hex');
  for (const name of corpus) {
    const program = await load(name);
    assert.equal(sha(cudaSource(program, name, { fuse: false })), expected[name], name);
    const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
    assert.equal(
      sha(cudaSource(optimized, name, { fuse: false })),
      expected[name + '+inline+split-sum'],
      name,
    );
  }
  // the programs of ticket script 01
  const extra = {
    chain: 'fn chain(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]; return z; }',
    shadow: 'fn shadow(x:f32[N,K], z:f32[N,L]):f32[N] { y[i] = sum(j) x[i,j] + sum(j) z[i,j]; return y; }',
    direct: 'fn direct(x:f32[N]):f32[N] { return x; }',
    transpose: 'fn transpose(x:f32[N,N]):f32[N,N] { z[i,j]=x[i,j]*2; y[i,j]=z[j,i]+1; return y; }',
  };
  for (const [name, source] of Object.entries(extra))
    assert.equal(sha(cudaSource(compileTix(source), name, { fuse: false })), expected[name], name);
});

test('every corpus program is one kernel when fused', async () => {
  const unfused = { matmul: 1, softmax: 4, layernorm: 4, attention: 6, mlp: 3, conv2d: 1 };
  for (const name of corpus) {
    const program = await load(name);
    assert.equal(count(cudaSource(program, name)), 1, name);
    assert.equal(count(cudaSource(program, name, { fuse: true })), 1, name);
    assert.equal(count(cudaSource(program, name, { fuse: false })), unfused[name], name);
    assert.equal(cudaSource(program, name), cudaSource(program, name), name);
  }
  assert.deepEqual(kernelPlan(await load('softmax'), 'softmax').plan.kernels, [
    { mapping: 'row', outer: 1, statements: ['m', 'e', 's', 'y'] },
  ]);
  // the epilogue: h (a contraction read five times at one index) is inlined into g; g and y share rows
  const mlp = kernelPlan(await load('mlp'), 'mlp').plan;
  assert.deepEqual(
    [mlp.inlined, mlp.kernels],
    [['h'], [{ mapping: 'row', outer: 1, statements: ['g', 'y'] }]],
  );
  // nothing to fuse: the lowering is stage 2's
  for (const name of ['matmul', 'conv2d'])
    assert.equal(cudaSource(await load(name), name), cudaSource(await load(name), name, { fuse: false }));
});

test('the planner inlines elementwise chains and epilogues, and reports what it refuses', () => {
  const chain = plan(
    'fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]+y[i]; w[i]=z[i]-y[i]; return w; }',
  );
  assert.deepEqual([chain.plan.inlined, chain.plan.kernels.length], [['y', 'z'], 1]);
  // y is computed once per element although it is read three times
  const source = cudaSource(
    compileTix('fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]+y[i]; w[i]=z[i]-y[i]; return w; }'),
    'f',
  );
  assert.equal(source.match(/exp\(static_cast/g).length, 1);

  const transpose = plan('fn f(x:f32[N,N]):f32[N,N] { z[i,j]=x[i,j]*2; y[i,j]=z[j,i]+1; return y; }');
  assert.deepEqual(transpose.plan.inlined, ['z']);

  // a reduction read by two statements is not repeated: a is inlined into b, and s and b share rows
  const twice = plan(
    'fn f(x:f32[N,K]):f32[N] { s[i]=sum(k) x[i,k]; a[i]=s[i]*2; b[i]=s[i]+a[i]; return b; }',
  );
  assert.deepEqual(twice.plan.inlined, ['a']);
  assert.deepEqual(twice.plan.kernels, [{ mapping: 'row', outer: 1, statements: ['s', 'b'] }]);
  assert.throws(
    () =>
      validatePlan({ ...twice.plan, inlined: ['s', 'a'], kernels: [{ mapping: 'element', statement: 'b' }] }),
    /s cannot be inlined: it contains a reduction and has 2 readers/,
  );

  // a broadcast would evaluate z once per element of y, N times as often: not inlined; and K is not y's row key
  const broadcast = plan(
    'fn f(x:f32[K], w:f32[N,K]):f32[N,K] { z[k]=exp(x[k]); y[i,k]=w[i,k]*z[k]; return y; }',
  );
  assert.deepEqual([broadcast.plan.inlined, broadcast.plan.kernels.length], [[], 2]);
  assert.match(broadcast.refused[0].reason, /one element of it per element/);
  assert.match(broadcast.refused[1].reason, /rows differ/);

  // a column normalisation: the row key would be the last axis
  const column = plan('fn f(x:f32[N,K]):f32[N,K] { s[k]=sum(i) x[i,k]; y[i,k]=x[i,k]/s[k]; return y; }');
  assert.equal(column.plan.kernels.length, 2);
  assert.deepEqual(
    column.refused.map(r => r.fusion),
    ['inline', 'row'],
  );

  // a transposed read: e is inlined into y, which then reads m in another row and cannot share m's block
  const across = plan(
    'fn f(x:f32[N,N]):f32[N,N] { m[i]=max(j) x[i,j]; e[i,j]=x[i,j]-m[i]; y[i,j]=e[j,i]*m[i]; return y; }',
  );
  assert.deepEqual(across.plan.inlined, ['e']);
  assert.deepEqual(
    across.plan.kernels.map(k => k.mapping),
    ['element', 'element'],
  );
  assert.match(across.refused.at(-1).reason, /another row of m/);
});

test('an illegal plan is not an artifact', async () => {
  const fn = (await load('softmax')).current.value.functions[0];
  const artifact = value => createArtifact(KernelIR, 'plan', value);
  const element = statement => ({ mapping: 'element', statement });
  const legal = {
    fn,
    inlined: [],
    kernels: [{ mapping: 'row', outer: 1, statements: ['m', 'e', 's', 'y'] }],
  };
  assert.equal(artifact(legal).kind, 'tensor.kernels');
  const reject = (plan, pattern) => assert.throws(() => artifact({ fn, inlined: [], ...plan }), pattern);
  // e inside s's reduction would be evaluated once per term; m into e would repeat the max per element
  reject({ inlined: ['e'], kernels: ['m', 's', 'y'].map(element) }, /e cannot be inlined: s reads it inside/);
  reject({ inlined: ['m'], kernels: ['e', 's', 'y'].map(element) }, /m cannot be inlined/);
  reject({ inlined: ['y'], kernels: ['m', 'e', 's'].map(element) }, /it is the result/);
  // rows keyed by two axes: m has rank 1
  reject({ kernels: [{ mapping: 'row', outer: 2, statements: ['m', 'e', 's', 'y'] }] }, /rank 1/);
  reject(
    { kernels: [{ mapping: 'row', outer: 1, statements: ['m'] }, ...['e', 's', 'y'].map(element)] },
    /two/,
  );
  reject({ kernels: ['e', 'm', 's', 'y'].map(element) }, /in order/);
  reject({ kernels: ['m', 'e', 's'].map(element) }, /in order/);
  const square = compileTix('fn f(x:f32[N,N]):f32[N,N] { m[i]=max(j) x[i,j]; e[i,j]=x[j,i]-m[j]; return e; }')
    .current.value.functions[0];
  assert.throws(
    () =>
      validatePlan({
        fn: square,
        inlined: [],
        kernels: [{ mapping: 'row', outer: 1, statements: ['m', 'e'] }],
      }),
    /another row of m/,
  );
});

test('random programs: the plan is legal, deterministic and never has more kernels than statements', () => {
  let fusedSomething = 0;
  for (let seed = 0; seed < 300; seed++) {
    const program = compileTix(randomProgram(seed));
    const { plan } = kernelPlan(program, 'f');
    validatePlan(plan);
    const statements = program.current.value.functions[0].statements.length;
    assert.equal(count(cudaSource(program, 'f')), plan.kernels.length);
    assert.equal(count(cudaSource(program, 'f', { fuse: false })), statements);
    assert.ok(plan.kernels.length + plan.inlined.length <= statements);
    if (plan.kernels.length < statements) fusedSomething++;
  }
  assert.ok(fusedSomething > 100, String(fusedSomething));
});

test('the correspondence relates every statement to its kernel, many to one', async () => {
  const program = await load('mlp');
  const { plan } = kernelPlan(program, 'mlp');
  const c = kernelCorrespondence(program.current, createArtifact(KernelIR, 'plan', plan));
  assert.deepEqual(
    c.entities.map((e, i) => [c.evidence.relations[i], e.from, e.to]),
    [
      ['function', ['mlp'], ['mlp']],
      ['no-kernel', ['mlp/bias', 'mlp/outBias', 'mlp/v', 'mlp/w', 'mlp/x'], []],
      ['fused', ['mlp/g', 'mlp/h', 'mlp/y'], ['mlp/k0']],
    ],
  );
});

test('a source with row kernels is checked twice, the second time with spilled rows', async () => {
  const runs = [];
  const engine = wrong => async (_source, f, cases, options) => {
    runs.push(options?.spill === true);
    return cases.map(inputs => {
      const result = evaluate(f, inputs, 'f32');
      if (wrong && options?.spill && result.data.length) result.data[0] += 1;
      return { ...result, gpuMs: 0 };
    });
  };
  const program = await load('softmax');
  const accepted = { accepted: true, relation: 'exact' };
  assert.deepEqual(
    await createCudaLowering('fusion-test-1', engine(false))(program.current, 'softmax'),
    accepted,
  );
  assert.deepEqual(runs.sort(), [false, true]);
  runs.length = 0;
  const unfused = createCudaLowering('fusion-test-2', engine(false));
  assert.deepEqual(await unfused(program.current, 'softmax', undefined, { fuse: false }), accepted);
  assert.deepEqual(runs, [false]);
  const rejected = await createCudaLowering('fusion-test-3', engine(true))(program.current, 'softmax');
  assert.equal(rejected.accepted, false);
  assert.match(rejected.reason, /With spilled rows: At \[0,0\], expected/);
});
