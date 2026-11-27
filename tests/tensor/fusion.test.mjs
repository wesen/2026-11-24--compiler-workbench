import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AnalysisManager } from '../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, optimizeTix } from '../../dist/tensor/index.js';
import { takesGate } from '../../dist/tensor/cuda-source.js';
import { createCudaLowering } from '../../dist/tensor/cuda-contract.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { gate, planFusion } from '../../dist/tensor/fusion.js';

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
  for (const name of ['conv2d']) {
    const program = corpus(name);
    assert.equal(cudaSource(program, name), cudaSource(program, name, { fuse: false }));
  }
  // IRWB-033-J: matmul's fused lowering is now a tiled gemm kernel, so it is no longer stage 2's bytes; its
  // stage-2 bytes are pinned above by the digest
  assert.match(cudaSource(corpus('matmul'), 'matmul'), /aS\[/);
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
  const engine = async (source, f, cases, options) => {
    batches.push({ fused: /max_nan/.test(source), count: cases.length, gate: options?.gate });
    return cases.map(inputs => ({ ...evaluate(f, inputs, 'f32'), gpuMs: 0 }));
  };
  const totals = [];
  const check = createCudaLowering('tensor-test-fusion', engine);
  const program = corpus('softmax');
  for (const fuse of [true, false]) {
    const manager = new AnalysisManager();
    assert.deepEqual(await check(program.current, 'softmax', undefined, { fuse, manager }), {
      accepted: true,
      relation: 'exact',
    });
    const checks = manager.snapshot().executions.at(-1).checks;
    totals.push(checks.find(c => c.phase === 'ensures').evidence.total);
    const correspondence = checks.find(c => c.phase === 'correspondence');
    assert.equal(correspondence.ok, true);
    assert.equal(correspondence.evidence.relation, 'statements-to-kernels');
    // IRWB-030-E: the record says which kernels the host may also run statement by statement
    assert.deepEqual(correspondence.evidence.evidence.gated, fuse ? [true] : [false, false, false, false]);
    assert.deepEqual(
      correspondence.evidence.entities,
      fuse
        ? [{ from: ['softmax/m', 'softmax/e', 'softmax/s', 'softmax/y'], to: ['k0'] }]
        : ['m', 'e', 's', 'y'].map((s, i) => ({ from: ['softmax/' + s], to: ['k' + i] })),
    );
  }
  // IRWB-030-E: the fused softmax kernel has a gate, so every sample is a case on each side and the program
  // runs once per side; the unfused lowering has no gate and one case per sample
  assert.deepEqual(
    batches.map(b => [b.fused, b.gate]),
    [
      [true, 'fused'],
      [true, 'unfused'],
      [false, undefined],
    ],
  );
  assert.ok(batches.every(b => b.count === batches[0].count));
  assert.ok(batches[0].count > 10);
  assert.deepEqual(totals, [2 * batches[0].count, batches[0].count]);
});

// IRWB-030-E
const fnOf = (source, name = 'f') => compileTix(source).current.value.functions.find(f => f.name === name);
const inside = `fn f(x:f32[N,C]):f32[N,C] {
  m[i] = max(j) x[i,j];
  s[i] = sum(j) exp(x[i,j] - m[i]);
  y[i,j] = exp(x[i,j] - m[i]) / s[i];
  return y;
}`;

test('terms are staged for reductions of one-element members, unless the terms are a row already', () => {
  const p = planFusion(fnOf(inside));
  // m's body is a load of the staged row of x: its terms are in shared memory already
  assert.deepEqual(p.groups[0].terms, [{ statement: 's', reduction: 0 }]);
  assert.deepEqual(p.termRefusals, []);
  assert.ok(p.groups[0].gated);
  assert.match(p.groups[0].reasons.join('; '), /all threads compute the terms of s's reduction 0/);
  const source = cudaSource(compileTix(inside), 'f');
  // a term pass over the body's scalar code, then thread 0's fold over the term buffer in increasing order
  assert.match(
    source,
    /for \(U e = threadIdx\.x; e < c2_0; e \+= blockDim\.x\) \{[^}]*exp\([^}]*q2_0\[e\] = v\d+;/,
  );
  assert.match(source, /for \(U t = 0; t < c2_0; \+\+t\) \{\s*(v\d+) = __fadd_rn\(\1, q2_0\[t\]\);/);

  // two reductions of one member share the term area; a costly max is staged too; the corpus programs with
  // the division outside keep stage 3's kernels except where a body does work
  const two = planFusion(
    fnOf(
      'fn f(x:f32[N,C]):f32[N,C] { s[i] = (sum(j) x[i,j] / C) + max(j) sqrt(x[i,j]); y[i,j] = x[i,j] - s[i]; return y; }',
    ),
  );
  assert.deepEqual(two.groups[0].terms, [
    { statement: 's', reduction: 0 },
    { statement: 's', reduction: 1 },
  ]);
  // only the outer reduction of a nest is staged: the inner one is part of each term
  const nested = planFusion(
    fnOf(
      'fn f(x:f32[N,C], z:f32[N,C]):f32[N,C] { s[i] = sum(j) (x[i,j] * sum(j) z[i,j]); y[i,j] = x[i,j] / s[i]; return y; }',
    ),
  );
  assert.deepEqual(nested.groups[0].terms, [{ statement: 's', reduction: 0 }]);
});

test('terms are refused for members whose row occupies the block, and thread-mode kernels have none', () => {
  const attention = planFusion(corpus('attention').current.value.functions[0]);
  assert.deepEqual(attention.groups[0].terms, []);
  assert.deepEqual(
    attention.termRefusals.map(r => [r.statement, r.kernel]),
    [
      ['score', 'k0'],
      ['out', 'k0'],
    ],
  );
  assert.match(
    attention.termRefusals[0].reason,
    /sum 0: every thread of the block computes elements of the row/,
  );
  const chain = planFusion(
    fnOf('fn f(x:f32[N,C]):f32[N] { s[i] = sum(j) exp(x[i,j]); t[i] = s[i] * 2; return t; }'),
  );
  assert.deepEqual(
    [chain.groups[0].mapping, chain.groups[0].terms, chain.groups[0].gated],
    ['thread', [], false],
  );
  assert.deepEqual(chain.termRefusals, []);
});

test('after split-sum the outer block reduction is staged and each term is a tail sum', () => {
  const { program } = optimizeTix(
    compileTix('fn f(x:f32[N,C]):f32[N,C] { s[i] = sum(j) x[i,j] / C; y[i,j] = x[i,j] - s[i]; return y; }'),
    ['split-sum'],
  );
  const p = planFusion(program.current.value.functions[0]);
  assert.deepEqual(p.groups[0].terms, [{ statement: 's', reduction: 0 }]);
  const source = cudaSource(program, 'f');
  assert.match(source, /const U c1_0 = \(static_cast<U>\(\(\(d1\) \/ 4 \+ \(\(d1\) % 4 != 0\) > 0 \?/);
});

test('a block-mode kernel is one definition that also holds its statements in stage 2 form, behind a gate', () => {
  const program = corpus('softmax');
  const source = cudaSource(program, 'softmax');
  assert.equal(kernels(source), 1);
  assert.match(source, /template <int Mode>\n__global__ void k0\(/);
  // one instantiation per member with stage 2's mapping, launched in order when the gate says no
  for (const mode of [2, 3, 4, 5]) {
    assert.ok(source.includes(`if (Mode == ${mode}) {`), 'mode ' + mode);
    assert.ok(
      source.includes(`if (!fused_k0 && elements(shape_t${mode - 1})) k0<${mode}><<<`),
      'launch ' + mode,
    );
  }
  assert.match(source, /const bool fused_k0 = gate_mode \? gate_mode == 1 : /);
  assert.match(source, /"--gate=fused"/);
  assert.equal(takesGate(source), true);
  // thread-mode fusion and the unfused lowering have no gate and keep stage 2's main
  const chain = compileTix('fn f(x:f32[N]):f32[N] { y[i]=exp(x[i]); z[i]=y[i]*x[i]; return z; }');
  for (const plain of [cudaSource(chain, 'f'), cudaSource(program, 'softmax', { fuse: false })]) {
    assert.equal(takesGate(plain), false);
    assert.doesNotMatch(plain, /gate/);
  }
});

test('the check runs every sample on both sides of the gate and names the side that disagrees', async () => {
  const program = compileTix(inside);
  const calls = [];
  const engine = wrong => async (source, f, cases, options) => {
    calls.push(options?.gate);
    return cases.map(inputs => {
      const out = evaluate(f, inputs, 'f32');
      if (options?.gate === wrong && out.data.length) out.data[0] += 1;
      return { ...out, gpuMs: 0 };
    });
  };
  assert.deepEqual(await createCudaLowering('tensor-test-gate-ok', engine())(program.current, 'f'), {
    accepted: true,
    relation: 'exact',
  });
  assert.deepEqual(calls.sort(), ['fused', 'unfused']);
  for (const side of ['fused', 'unfused']) {
    const verdict = await createCudaLowering('tensor-test-gate-' + side, engine(side))(program.current, 'f');
    assert.equal(verdict.accepted, false);
    assert.match(verdict.reason, new RegExp(`"gate":"${side}".*: At \\[`));
  }
});

test('a member is written over the row it is computed from when nothing reads that row afterwards', () => {
  const inPlace = name => planFusion(corpus(name).current.value.functions[0]).groups[0].inPlace;
  assert.deepEqual(inPlace('attention'), [
    { statement: 'e', over: 'score' },
    { statement: 'weight', over: 'e' },
  ]);
  assert.deepEqual(inPlace('softmax'), [{ statement: 'e', over: 'x' }]);
  assert.deepEqual(inPlace('layernorm'), [{ statement: 'centered', over: 'x' }]);
  assert.deepEqual(inPlace('mlp'), [{ statement: 'g', over: 'h' }]);
  const source = cudaSource(corpus('attention'), 'attention');
  // score, e and weight share one row; the block's row area is q, that row and the two scalars
  assert.match(source, /float\* const r5 = r3;/);
  assert.match(source, /float\* const r7 = r5;/);
  assert.match(source, /scratch \+ point \* \(n0 \+ n3 \+ n4 \+ n6\);/);
  // refused: x is read again by y; e is read at another element; the rows have different extents
  const none = source => planFusion(fnOf(source)).groups[0].inPlace;
  assert.deepEqual(
    none(
      'fn f(x:f32[N,C]):f32[N,C] { e[i,j] = x[i,j] * 2; m[i] = max(j) e[i,j]; y[i,j] = e[i,j] - m[i] + x[i,j]; return y; }',
    ),
    [],
  );
  for (const read of ['e[i,j+1]', 'e[i,j+0]'])
    assert.deepEqual(
      none(`fn f(x:f32[N,C]):f32[N,C-1] {
        e[i,j] = x[i,j] * 2; m[i] = max(j) x[i,j]; d[i,j]: f32[N,C-1] = ${read} * m[i]; t[i] = max(j) d[i,j];
        y[i,j]: f32[N,C-1] = d[i,j] - t[i]; return y; }`),
      [],
      read,
    );
});

test('the gate is a host condition on the grid, the longest row and the lanes of heavy members', () => {
  assert.deepEqual(gate, { fullRow: 96, smallGrid: 1024, heavyLanes: [19, 24] });
  // softmax has no heavy member: long rows, or few rows
  const softmax = cudaSource(corpus('softmax'), 'softmax');
  assert.ok(
    softmax.includes(
      'const bool fused_k0 = gate_mode ? gate_mode == 1 : (longest_k0 >= 96 || grid_k0 <= 1024);',
    ),
  );
  assert.match(
    softmax,
    /threads_k0 = static_cast<unsigned>\(std::min<U>\(128, \(longest_k0 \+ 31\) \/ 32 \* 32\)\);/,
  );
  // attention with the division inside each term: score and out carry divisions that cannot be staged, so the
  // block is as wide as the narrower of their rows and the gate asks for 19/24 of an SM's lanes on each
  const inner = `fn f(q:f32[Q,D], k:f32[K,D], v:f32[K,V]):f32[Q,V] {
    score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D);
    z[i] = sum(j) score[i,j];
    out[i,c] = sum(j) score[i,j] * v[j,c] / z[i];
    return out;
  }`;
  const plan = planFusion(fnOf(inner));
  assert.deepEqual(plan.groups[0].heavy, ['score', 'out']);
  const source = cudaSource(compileTix(inner), 'f');
  assert.match(
    source,
    /threads_k0 = static_cast<unsigned>\(std::min<U>\(256, \(std::max<U>\(std::min<U>\(\{/,
  );
  assert.match(
    source,
    /resident_k0 = std::min<U>\(\{sm_blocks, sm_threads \/ threads_k0, shared_k0 \? sm_shared \/ \(row_k0 \+ tiles_k0 \+ sm_reserved\) : sm_blocks\}\);/,
  );
  assert.equal(source.match(/\* 24 >= 19 \* sm_threads/g).length, 2);
  // the corpus attention multiplies inside and divides outside: one multiplication per term is not heavy
  assert.deepEqual(planFusion(corpus('attention').current.value.functions[0]).groups[0].heavy, []);
});
