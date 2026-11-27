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

test('IRWB-030-I: the plan stages the reductions whose terms are costly, and records what it refuses', () => {
  const inside = plan(
    `fn layernorm(x: f32[N,D], gamma: f32[D], beta: f32[D], eps: f32[1]): f32[N,D] {
       mean[i] = sum(j) x[i,j] / D;
       variance[i] = sum(j) (x[i,j] - mean[i]) * (x[i,j] - mean[i]) / D;
       y[i,j] = (x[i,j] - mean[i]) / sqrt(variance[i] + eps[0]) * gamma[j] + beta[j];
       return y;
     }`,
    'layernorm',
  );
  // A division per term: the block computes the terms, thread 0 folds them in order.
  assert.deepEqual(
    inside.groups[0].terms.map(t => [t.statement, t.node, t.axes]),
    [
      ['mean', 0, 1],
      ['variance', 0, 1],
    ],
  );
  assert.deepEqual(inside.termRefusals, []);
  // The corpus placement divides the reduced value: its terms are a single load of the staged row, so
  // staging would only copy shared memory.
  const outside = planFusion(corpus('layernorm').current.value.functions[0]);
  assert.deepEqual(outside.groups[0].terms, []);
  assert.deepEqual(
    outside.termRefusals.map(r => [r.statement, r.reason]),
    [
      ['mean', 'its terms are loads of x, already in the row buffer; staging would copy them'],
      ['variance', 'its terms are loads and cheap ops; the fold is not the serial cost'],
    ],
  );
  // softmax's max and sum read the row buffer; attention's row members keep one thread per element.
  const softmax = planFusion(corpus('softmax').current.value.functions[0]);
  assert.deepEqual(softmax.termRefusals.map(r => r.statement), ['m', 's']);
  const attention = planFusion(corpus('attention').current.value.functions[0]);
  assert.deepEqual(attention.termRefusals.map(r => r.statement), ['score', 'shift', 'z', 'out']);
  assert.match(attention.termRefusals[0].reason, /trailing axes/);
  assert.match(attention.termRefusals[1].reason, /already in the row buffer/);
});

test('IRWB-030-I: cheap bodies keep the inline fold; a single load of a global tensor stages', () => {
  const cheap = plan(
    'fn f(x:f32[N,C], w:f32[C]):f32[N,C] { s[i] = sum(j) x[i,j] * w[j]; y[i,j] = x[i,j] - s[i]; return y; }',
    'f',
  );
  assert.deepEqual(cheap.groups[0].terms, []);
  assert.match(cheap.termRefusals[0].reason, /cheap ops/);
  const global = plan(
    'fn f(x:f32[N,C], g:f32[C]):f32[N,C] { m[i]: f32[N] = max(j) g[j]; y[i,j] = x[i,j] - m[i]; return y; }',
    'f',
  );
  // Even a global single load keeps the inline fold: its terms are loads, so there is no costly per-term
  // work to spread (the probe in the ticket's scripts measures whether staging one would pay anyway).
  assert.deepEqual(global.groups[0].terms, []);
  assert.match(global.termRefusals[0].reason, /terms are loads and cheap ops/);
  // a nested reduction keeps the inline fold, and so does a split-sum reduction
  const nested = plan(
    'fn f(x:f32[N,C], z:f32[N,C]):f32[N,C] { s[i] = sum(j) (x[i,j] * sum(k) z[i,k]); y[i,j] = x[i,j] - s[i]; return y; }',
    'f',
  );
  assert.deepEqual(nested.groups[0].terms, []);
  assert.match(nested.termRefusals[0].reason, /cheap ops/);
  assert.match(nested.termRefusals[1].reason, /nested inside another reduction/);
  const split = plan(
    'fn f(x:f32[N,C]):f32[N] { s[i] = sum(j) x[i,j] / C; y[i] = s[i] * 2; return y; }',
    'f',
  );
  assert.deepEqual(split.groups[0].terms, []);
});

test('IRWB-030-I: thread-mode groups and singletons never stage', () => {
  const chain = plan(
    'fn f(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; z[i,j] = y[i,j] / 2; return z; }',
    'f',
  );
  assert.deepEqual(summary(chain), [['thread', 2, 'y,z', 'z']]);
  assert.match(chain.termRefusals[0].reason, /thread mode computes one element per thread/);
  const single = plan('fn f(x:f32[N,C]):f32[N] { s[i] = sum(j) x[i,j] / C; return s; }', 'f');
  assert.deepEqual(single.termRefusals.map(r => r.reason), [
    "a one-statement kernel is stage 2's own emitter; it keeps the inline fold",
  ]);
});

test('IRWB-030-I: with the shape values at launch, a block-mode group with too few rows stays unfused', () => {
  const softmax = corpus('softmax').current.value.functions[0];
  const few = planFusion(softmax, new Map([['N', 8], ['C', 1024]]));
  assert.deepEqual(
    few.groups.map(g => [g.kernel, g.mapping, g.statements.join(',')]),
    [
      ['k0f0', 'thread', 'm'],
      ['k0f1', 'thread', 'e'],
      ['k0f2', 'thread', 's'],
      ['k0f3', 'thread', 'y'],
    ],
  );
  assert.deepEqual(
    few.unfused.map(u => [u.statements, u.rows]),
    [[['m', 'e', 's', 'y'], 8]],
  );
  assert.match(few.unfused[0].reason, /fewer blocks than the machine/);
  const many = planFusion(softmax, new Map([['N', 4096], ['C', 1024]]));
  assert.deepEqual(many.groups.map(g => g.mapping), ['block']);
  assert.deepEqual(many.unfused, []);
  // Without shape values (cudaSource, checkLowering) the plan is stage 3's: one fused kernel.
  assert.equal(kernels(cudaSource(corpus('softmax'), 'softmax')), 1);
  // A gated group's members are stored, so a later group reads them as it reads any parameter.
  const two = compileTix(
    'fn f(x:f32[N,C]):f32[N,C] { m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]); return e; }',
  ).current.value.functions[0];
  const gated = planFusion(two, new Map([['N', 2], ['C', 8]]));
  assert.deepEqual(gated.groups.map(g => g.stored), [['m'], ['e']]);
});
