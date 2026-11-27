// IRWB-033-D: the schedule IR, its passes' legality, the order analysis and the printer, without the GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { applyNativePassSync, definePass } from '../../dist/framework/passes/index.js';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { planFusion } from '../../dist/tensor/fusion.js';
import * as S from '../../dist/tensor/schedule.js';
import { lowerSchedule, scheduleFunction } from '../../dist/tensor/strategy.js';
import { variantForm } from '../../dist/tensor/cuda-contraction.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8')).current.value
    .functions[0];
const fnOf = text => compileTix(text).current.value.functions[0];
const summary = schedule => schedule.kernels.map(k => `${k.kind}:${k.group.statements.join(',')}`);

test('the corpus schedules: contractions leave block mode and become tiled kernels with four variants', () => {
  const expected = {
    matmul: ['contraction:y'],
    softmax: ['rows:m,e,s,y'],
    layernorm: ['rows:mean,centered,variance,y'],
    attention: ['contraction:score', 'rows:shift,e,z,weight', 'contraction:out'],
    mlp: ['contraction:h,g', 'contraction:y'],
    conv2d: ['contraction:out'],
  };
  for (const [name, kernels] of Object.entries(expected)) {
    const s = lowerSchedule(corpus(name), true).value;
    assert.deepEqual(summary(s), kernels, name);
    for (const k of s.kernels.filter(k => k.kind === 'contraction')) {
      assert.equal(k.variants.length, 4, name);
      assert.deepEqual(k.variants.map(variantForm).slice(1).map(f => [f.bm, f.bn, f.bk, f.tm, f.tn]), [
        [128, 64, 8, 8, 4],
        [32, 32, 8, 4, 4],
        [32, 32, 8, 2, 2],
      ]);
    }
    assert.ok(Object.values(S.accumulationOrder(s)).flat().every(o => o.startsWith('lexicographic(')), name);
  }
  const conv = lowerSchedule(corpus('conv2d'), true).value.kernels[0];
  assert.deepEqual(conv.dims, { b: [], m: ['i0', 'i2', 'i3'], n: ['i1'], r: ['i4', 'i5', 'i6'] });
  // the copy walks along the dim that is contiguous in memory: x along xpos (m), kernel along dx (r)
  assert.deepEqual(conv.variants[1].stages.map(s => s.fast), ['m', 'r']);
  const score = lowerSchedule(corpus('attention'), true).value.kernels[0];
  assert.deepEqual(score.variants[1].stages.map(s => s.fast), ['r', 'r']);
  // fuse: false is the unfused plan, no pass applied
  assert.deepEqual(scheduleFunction(corpus('mlp'), planFusion(corpus('mlp')), false).steps, []);
});

test('tileable contractions are recognised from the IR, and others say why not', () => {
  const why = text => S.contractionForm(fnOf(text).statements.at(-1));
  assert.match(why('fn f(a:f32[M,K]):f32[M] { y[i] = max(k) a[i,k]; return y; }'), /not exactly one|max/);
  assert.match(why('fn f(a:f32[M,K]):f32[M] { y[i] = sum(k) a[i,k]; return y; }'), /not a product of two loads/);
  assert.match(why('fn f(a:f32[M,K], x:f32[K]):f32[M] { y[i] = sum(k) a[i,k] * x[k]; return y; }'), /no output axis/);
  const batched = why('fn f(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }');
  assert.deepEqual(batched.dims, { b: ['i0'], m: ['i1'], n: ['i2'], r: ['i3'] });
});

test('each pass refuses an illegal step before it runs, with the reason', () => {
  let s = S.initialSchedule(corpus('matmul'), planFusion(corpus('matmul')));
  assert.throws(() => S.applyStep(S.isolatePass, s, {}), { code: 'illegal', message: /no block-mode kernel/ });
  s = S.applyStep(S.contractionPass, s, { kernel: 'k0' }).artifact;
  s = S.applyStep(S.variantPass, s, { kernel: 'k0' }).artifact;
  const v = { kernel: 'k0', variant: 1 };
  s = S.applyStep(S.splitPass, s, { ...v, loop: 'r.0', factor: 8 }).artifact;
  const refuse = (pass, params, pattern) => assert.throws(() => S.applyStep(pass, s, params), { code: 'illegal', message: pattern });
  refuse(S.splitPass, { ...v, loop: 'r.1', factor: 3 }, /3 does not divide 8/);
  refuse(S.reorderPass, { ...v, order: ['b.0', 'm.0', 'n.0', 'r.1', 'r.0'] }, /reduction loops r.0,r.1 would become r.1,r.0/);
  refuse(S.bindPass, { ...v, loop: 'r.1', target: 'thread.x' }, /reassociate/);
  refuse(S.bindPass, { ...v, loop: 'm.0', target: 'unroll' }, /no fixed number/);
  refuse(S.stagePass, { ...v, operand: 'm', at: 'm.0', fast: 'r' }, /not a reduction loop/);
  refuse(S.selectPass, { kernel: 'k0', rule: [{ variant: 1, minBlocks: 2 }] }, /last entry/);
  const split = S.applyStep(S.splitPass, s, { ...v, loop: 'r.0', factor: 2 });
  const entry = split.correspondence.entries.find(e => e.relation === 'split');
  assert.deepEqual(entry, { from: ['k0/v1/r.0'], to: ['k0/v1/r.0', 'k0/v1/r.1'], relation: 'split' });
  assert.ok(split.correspondence.entries.some(e => e.relation === 'renamed' && e.to[0] === 'k0/v1/r.2'));
});

test('the order gate rejects a step that changes any output accumulation order, which legality would not see', () => {
  let s = S.initialSchedule(corpus('matmul'), planFusion(corpus('matmul')));
  s = S.applyStep(S.contractionPass, s, { kernel: 'k0' }).artifact;
  s = S.applyStep(S.variantPass, s, { kernel: 'k0' }).artifact;
  s = S.applyStep(S.splitPass, s, { kernel: 'k0', variant: 1, loop: 'r.0', factor: 4 }).artifact;
  // a rogue pass that swaps the factors of r.0 and r.1 (r = r.0 + 4 r.1 instead of 4 r.0 + r.1): no loop moves
  const rogue = definePass({
    id: 'rogue',
    version: '1',
    description: 'swap reduction levels',
    ir: S.ScheduleIR,
    adapter: S.scheduleAdapter,
    writes: { entities: ['kernel', 'variant', 'loop', 'stage'], relations: ['contains'] },
    run: ({ before }) => {
      const value = structuredClone(before.value);
      const loops = value.kernels[0].variants[1].loops;
      const r0 = loops.find(l => l.id === 'r.0'),
        r1 = loops.find(l => l.id === 'r.1');
      Object.assign(r0, { id: 'r.1', level: 1, factor: 4 });
      Object.assign(r1, { id: 'r.0', level: 0, factor: null });
      return { native: value };
    },
  });
  assert.throws(() => applyNativePassSync(rogue, s, S.orderGate), {
    code: 'contractRejected',
    message: /accumulation order of y changed.*r in the order 0 4 8 1 5 9/,
  });
  assert.match(
    S.orderViolation({ loops: [{ id: 'r.0', dim: 'r', level: 0, factor: null, bind: 'thread.x' }], stages: [] }),
    /bound to thread.x/,
  );
});

test('the printer only prints: a schedule outside its form is rejected, fuse: false is unchanged', () => {
  const s = lowerSchedule(corpus('matmul'), true).value;
  const v = s.kernels[0].variants[1];
  assert.equal(typeof variantForm(v), 'object');
  const swapped = { ...v, loops: [v.loops[0], v.loops[2], v.loops[1], ...v.loops.slice(3)] };
  assert.match(variantForm(swapped), /not printable: expected loop 1 to be m.0/);
  const source = cudaSource(compileTix(readFileSync(new URL('../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8')), 'matmul');
  assert.equal([...source.matchAll(/__global__/g)].length, 1);
  assert.match(source, /__launch_bounds__\(V == 1 \? 256 : V == 2 \? 64 : V == 3 \? 256 : 256\) k0/);
  assert.match(source, /static int variant_mode = -1;/);
});
