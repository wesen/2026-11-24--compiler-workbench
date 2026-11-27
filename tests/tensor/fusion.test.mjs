import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { createCudaLowering } from '../../dist/tensor/cuda-contract.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { planFusion } from '../../dist/tensor/fusion.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const plan = (source, fn) => planFusion(compileTix(source).current.value.functions.find(f => f.name === fn));
const kernels = source => (source.match(/__global__ void/g) ?? []).length;
const summary = p => p.groups.map(g => [g.mapping, g.depth, g.statements.join(','), g.stored.join(',')]);

test('every corpus program is one kernel; the row programs run one block per row', () => {
  const expected = {
    matmul: [['thread', 2, 'y', 'y']],
    softmax: [['block', 1, 'm,e,s,y', 'y']],
    layernorm: [['block', 1, 'mean,centered,variance,y', 'y']],
    attention: [['block', 1, 'score,shift,e,z,weight,out', 'out']],
    mlp: [['block', 1, 'h,g,y', 'y']],
    conv2d: [['thread', 4, 'out', 'out']],
  };
  for (const [name, groups] of Object.entries(expected)) {
    const program = corpus(name);
    const p = planFusion(program.current.value.functions[0]);
    assert.deepEqual(summary(p), groups, name);
    assert.deepEqual(p.refusals, [], name);
    assert.equal(kernels(cudaSource(program, name)), 1, name);
  }
  const softmax = planFusion(corpus('softmax').current.value.functions[0]).groups[0];
  assert.deepEqual([softmax.buffered, softmax.staged], [['m', 'e', 's'], ['x']]);
  assert.ok(softmax.reasons.some(r => /thread 0 computes m/.test(r)));
});

test('fuse: false is stage 2 byte for byte, and a one-statement program is the same either way', () => {
  const digests = JSON.parse(
    readFileSync(
      new URL(
        '../../ttmp/2026/11/26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/scripts/02-stage2-source-digests.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const sha = text => createHash('sha256').update(text).digest('hex');
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const program = corpus(name);
    assert.equal(sha(cudaSource(program, name, { fuse: false })), digests[name], name);
    const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
    assert.equal(sha(cudaSource(optimized, name, { fuse: false })), digests[name + '+inline+split'], name);
  }
  for (const name of ['matmul', 'conv2d']) {
    const program = corpus(name);
    assert.equal(cudaSource(program, name), cudaSource(program, name, { fuse: false }));
  }
  assert.equal(kernels(cudaSource(corpus('softmax'), 'softmax', { fuse: false })), 4);
});

test('elementwise chains and epilogues share one thread per element', () => {
  const chain = plan('fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]; return z; }', 'f');
  assert.deepEqual(summary(chain), [['thread', 1, 'y,z', 'z']]);
  const epilogue = plan(
    'fn f(a:f32[M,K], b:f32[K,N], c:f32[N]):f32[M,N] { y[i,j] = sum(k) a[i,k]*b[k,j]; z[i,j] = tanh(y[i,j] + c[j]) * y[i,j]; return z; }',
    'f',
  );
  assert.deepEqual(summary(epilogue), [['thread', 2, 'y,z', 'z']]);
  const source = compileTix(
    'fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]; w[i]=z[i]+y[i]; return w; }',
  );
  assert.equal(kernels(cudaSource(source, 'f')), 1);
  assert.equal(kernels(cudaSource(source, 'f', { fuse: false })), 3);
});

test('a statement that needs another row, other extents or nothing from the kernel starts a new one', () => {
  const transposed = plan(
    'fn f(x:f32[N,N]):f32[N,N] { a[i,j] = x[i,j] * 2; b[i,j] = a[j,i] + 1; return b; }',
    'f',
  );
  assert.equal(transposed.groups.length, 2);
  assert.match(transposed.refusals[0].reason, /reads a at index .* in position 0, not its own axis/);
  const extents = plan(
    'fn f(x:f32[N,M]):f32[M] { a[i,j] = x[i,j] * 2; b[j] = sum(i) a[i,j]; return b; }',
    'f',
  );
  assert.equal(extents.groups.length, 2);
  assert.match(extents.refusals[0].reason, /axis 0 has extent M, the kernel's N/);
  const independent = plan('fn f(x:f32[N]):f32[N] { a[i] = x[i] * 2; b[i] = x[i] + 1; return b; }', 'f');
  assert.deepEqual(
    independent.refusals.map(r => [r.statement, r.kernel]),
    [['b', 'k0']],
  );
  assert.match(independent.refusals[0].reason, /no horizontal fusion/);
  // a and b are separate, so a is stored for nobody: a singleton keeps stage 2's store
  assert.deepEqual(summary(independent), [
    ['thread', 1, 'a', 'a'],
    ['thread', 1, 'b', 'b'],
  ]);
});

test('a stencil narrows the block domain to the axes it reads plainly; middle members are stored when read later', () => {
  const stencil = plan(
    `fn f(x:f32[N,C,H,W]):f32[N,C,H-2,W-2] {
       a[n,c,y,w] = x[n,c,y,w] * 2;
       b[n,c,y,w]: f32[N,C,H-2,W-2] = a[n,c,y+1,w+1] + a[n,c,y+2,w+2];
       return b;
     }`,
    'f',
  );
  assert.deepEqual(summary(stencil), [['block', 2, 'a,b', 'b']]);
  assert.match(stencil.groups[0].reasons.join(' '), /b narrows the block domain to 2 axes/);
  const reused = plan(
    'fn f(x:f32[N,N]):f32[N,N] { m[i] = max(j) x[i,j]; e[i,j] = x[i,j] - m[i]; t[i] = m[i] * 2; y[i,j] = e[j,i] + t[i]; return y; }',
    'f',
  );
  assert.deepEqual(summary(reused), [
    ['block', 1, 'm,e,t', 'e,t'],
    ['thread', 2, 'y', 'y'],
  ]);
});

test('a staged row needs the block domain as its leading extents, not just a plain address', () => {
  // t[i+0,k] is plain in the IR, but the checker never unified t's first extent with N
  const p = plan(
    'fn f(x:f32[N], t:f32[M,K]):f32[N] { a[i] = x[i] * 2; y[i] = a[i] + sum(k) t[i+0,k]; return y; }',
    'f',
  );
  assert.deepEqual(p.groups[0].staged, []);
  const q = plan(
    'fn f(x:f32[N], t:f32[N,K]):f32[N] { a[i] = x[i] * 2; y[i] = a[i] + sum(k) t[i,k]; return y; }',
    'f',
  );
  assert.deepEqual(summary(q), [['thread', 1, 'a,y', 'y']]);
});

test('the lowering records which statements each kernel computes, and fused and unfused share their cases', async () => {
  const batches = [];
  const engine = async (source, f, cases) => {
    batches.push({ fused: /max_nan/.test(source), count: cases.length });
    return cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
  };
  const check = createCudaLowering('tensor-test-fusion', engine);
  const program = corpus('softmax');
  for (const fuse of [true, false]) {
    const manager = new AnalysisManager();
    assert.deepEqual(await check(program.current, 'softmax', undefined, { fuse, manager }), {
      accepted: true,
      relation: 'exact',
    });
    const checks = manager.snapshot().executions.at(-1).checks;
    const correspondence = checks.find(c => c.phase === 'correspondence');
    assert.equal(correspondence.ok, true);
    assert.equal(correspondence.evidence.relation, 'statements-to-kernels');
    assert.deepEqual(
      correspondence.evidence.entities,
      fuse
        ? [{ from: ['softmax/m', 'softmax/e', 'softmax/s', 'softmax/y'], to: ['k0'] }]
        : ['m', 'e', 's', 'y'].map((s, i) => ({ from: ['softmax/' + s], to: ['k' + i] })),
    );
  }
  assert.deepEqual(
    batches.map(b => b.fused),
    [true, false],
  );
  assert.equal(batches[0].count, batches[1].count);
  assert.ok(batches[0].count > 10);
});

test('ordered staging is local to the body of a row-scalar reduction', () => {
  const p = plan(`fn f(x:f32[N,D]):f32[N,D] {
    a[i] = (sum(j) x[i,j]) / D;
    b[i,j] = x[i,j] - a[i];
    v[i] = sum(j) b[i,j] / D;
    y[i,j] = b[i,j] - v[i];
    return y;
  }`, 'f');
  assert.deepEqual(Object.keys(p.groups[0].parallelTerms), ['v']);
});

test('a divided cross-row contraction leaves the block and keeps both live inputs', () => {
  const p = plan(`fn f(x:f32[N,K], v:f32[K,V]):f32[N,V] {
    m[i] = max(k) x[i,k]; a[i,k] = x[i,k] - m[i];
    z[i] = sum(k) a[i,k]; y[i,c] = sum(k) a[i,k] * v[k,c] / z[i]; return y;
  }`, 'f');
  assert.deepEqual(summary(p), [['block', 1, 'm,a,z', 'a,z'], ['thread', 2, 'y', 'y']]);
  assert.match(p.refusals[0].reason, /divided cross-row contraction/);
});
