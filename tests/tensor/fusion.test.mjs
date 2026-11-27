// Fusion decisions are visible from the lowering alone: kernel counts, what was inlined, what was staged, and which
// legal-looking fusions were refused. No GPU is needed for any of this.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { planFusion } from '../../dist/tensor/fusion.js';

const corpus = name => readFileSync(new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url), 'utf8');
const kernels = text => (text.match(/__global__ void/g) ?? []).length;

// Statements per program and kernels per lowering: stage 2 emits one kernel per statement, the fused lowering one
// per group. matmul and conv2d are single statements, so nothing can be fused in them.
const counts = {
  matmul: [1, 1],
  softmax: [4, 1],
  layernorm: [4, 1],
  attention: [6, 1],
  mlp: [3, 1],
  conv2d: [1, 1],
};
// sha256 (first 16 hex digits) of `fuse: false`'s text, recorded in IRWB-029-G after checking it byte for byte
// against the pre-fusion emitter (see reference/01-implementation-diary.md): stage 2's lowering is unchanged.
const stage2 = {
  matmul: '552001b91a3986e0',
  softmax: '852a2b98180d1c2b',
  layernorm: '5ffd80fbe9bd7475',
  attention: '4ccc5799d20ba87b',
  mlp: '48a27e1a42ae7196',
  conv2d: '4f9e943af078cf38',
};

for (const name of Object.keys(counts)) {
  test('fused lowering of ' + name + ': kernel count, and stage 2\'s text when fusion is off', () => {
    const program = compileTix(corpus(name));
    assert.equal(kernels(cudaSource(program, name, { fuse: false })), counts[name][0]);
    assert.equal(kernels(cudaSource(program, name)), counts[name][1]);
    const hash = createHash('sha256')
      .update(cudaSource(program, name, { fuse: false }))
      .digest('hex')
      .slice(0, 16);
    assert.equal(hash, stage2[name], 'stage-2 text for ' + name);
    // fusion is a lowering decision, so it survives stage 1's rewrites: the optimized program still fuses
    const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
    assert.equal(kernels(cudaSource(optimized, name)), counts[name][1]);
  });
}

test('a fused chain is one kernel, and the intermediate is never read from global memory', () => {
  const p = compileTix('fn f(x:f32[N]):f32[N] { a[i]=x[i]*2; b[i]=a[i]+1; c[i]=exp(b[i]); return c; }');
  const plan = planFusion(p.current.value.functions[0]);
  assert.deepEqual(
    plan.map(kernel => [kernel.kind, kernel.kind === 'flat' ? kernel.inline.map(s => s.name) : kernel.phases]),
    [['flat', ['a', 'b']]],
  );
  const text = cudaSource(p, 'f');
  assert.equal(kernels(text), 1);
  assert.match(text, /const float\* t0/);
  assert.doesNotMatch(text, /float\* t1/, 'the intermediate a is never a kernel argument');
});

test('a per-row value read at another row is refused: no mapping can serve it in this block', () => {
  // square input, so the program is well formed: m[j] is a legal read but not the block's own row
  const p = compileTix('fn f(x:f32[N,N]):f32[N,N] { m[i]=max(k) x[i,k]; y[i,j]=m[j]+x[i,j]; return y; }');
  assert.equal(planFusion(p.current.value.functions[0]).length, 2);
  assert.equal(kernels(cudaSource(p, 'f')), 2);
});

test('a per-row value is not inlined into a per-element consumer; the row policy stages it instead', () => {
  const p = compileTix('fn f(x:f32[N,K]):f32[N,K] { m[i]=max(k) x[i,k]; y[i,j]=exp(x[i,j]-m[i]); return y; }');
  const plan = planFusion(p.current.value.functions[0]);
  assert.equal(plan.length, 1);
  const [kernel] = plan;
  assert.equal(kernel.kind, 'row');
  assert.deepEqual(
    kernel.phases.map(phase => (phase.kind === 'stage' ? 'stage:' + phase.tensor : phase.kind + ':' + phase.statement.name)),
    ['stage:x', 'scalar:m', 'vector:y'],
  );
  const text = cudaSource(p, 'f');
  assert.match(text, /extern __shared__ float smem\[\]/);
  assert.match(text, /__syncthreads\(\)/);
  // the row is copied in once, strided over the block's threads, and after that read from shared memory
  assert.match(text, /for \(U lane = threadIdx\.x; \(I\)lane < \(d1\); lane \+= blockDim\.x\) \{\n {4}const I stage0/);
  assert.match(text, /v\d+ = __fsub_rn\(smem\[so0 \+ \(i\d\)\], smem\[so1\]\)/);
});

test('mlp stages the contraction row, reads it in the second contraction, and writes y once', () => {
  const p = compileTix(corpus('mlp'));
  const plan = planFusion(p.current.value.functions[0]);
  assert.equal(plan.length, 1);
  const [kernel] = plan;
  assert.equal(kernel.kind, 'row');
  assert.deepEqual(
    kernel.phases.filter(phase => phase.dest && phase.dest.kind === 'global').map(phase => phase.statement.name),
    ['y'],
  );
  assert.ok(kernel.staged.has('g'), 'g is staged in shared memory');
  assert.match(cudaSource(p, 'mlp'), /smem\[so\d \+ \(i\d\)\]/, 'the second contraction reads the staged row');
});

test('a load inside a reduction is not inlined: that would re-evaluate a reduction per term', () => {
  // the flat rule maps a producer onto the consumer's *free* axes; k is a reduction binder here
  const p = compileTix(
    'fn f(x:f32[N,K], v:f32[K,N]):f32[N,N] { g[i,j]=x[i,j]*2; y[i,j]=sum(k) g[i,k]*v[k,j]; return y; }',
  );
  const plan = planFusion(p.current.value.functions[0]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'row', 'g is staged instead of inlined');
  assert.equal(kernels(cudaSource(p, 'f')), 1);
});

test('statements whose row axes disagree are not merged', () => {
  const p = compileTix(
    'fn f(x:f32[N,K], z:f32[M,N]):f32[M,N] { s[i]=sum(k) x[i,k]; y[j,i]:f32[M,N]=s[i]+z[j,i]; return y; }',
  );
  assert.equal(planFusion(p.current.value.functions[0]).length, 2);
});

test('a producer read twice is not inlined, and a transposed read at free coordinates is', () => {
  // the flat rule allows one use per member; here the row policy stages p once and both reads share it, so the two
  // statements still make one kernel, but by staging rather than by duplicating the producer's tree
  const twice = compileTix('fn f(x:f32[N]):f32[N] { p[i]=x[i]*2; y[i]=p[i]+p[i]; return y; }');
  assert.deepEqual(planFusion(twice.current.value.functions[0]).map(k => k.kind), ['row']);
  // a transposed use makes both policies inapplicable: no staging layout and no single-use inlining
  const mixed = compileTix('fn f(x:f32[N,N]):f32[N,N] { p[i,j]=x[i,j]*2; y[i,j]=p[i,j]+p[j,i]; return y; }');
  assert.deepEqual(planFusion(mixed.current.value.functions[0]).map(k => k.kind), ['flat', 'flat']);
  const transposed = compileTix('fn f(x:f32[N,N]):f32[N,N] { p[i,j]=x[i,j]*2; y[i,j]=p[j,i]+1; return y; }');
  const [kernel] = planFusion(transposed.current.value.functions[0]);
  assert.equal(kernel.kind, 'flat');
  assert.deepEqual(kernel.inline.map(s => s.name), ['p']);
  // the inlined address is the transposed one, exactly as stage 1's inline pass would compose it
  assert.match(cudaSource(transposed, 'f'), /t0\[\(\(i0\) \* \(d0\) \+ \(i1\)\)\]/);
});
