// IRWB-033-D, IRWB-057: the schedule IR, the legality of its plans and the printer, without the GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { applyTransformationSync } from '../../dist/framework/passes/index.js';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import * as S from '../../dist/tensor/schedule.js';
import { chooseFusion, chooseLoops, lowerSchedule, scheduleFunction } from '../../dist/tensor/strategy.js';
import { variantForm } from '../../dist/tensor/cuda-contraction.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8')).current
    .value.functions[0];
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
      assert.deepEqual(
        k.variants
          .map(variantForm)
          .slice(1)
          .map(f => [f.bm, f.bn, f.bk, f.tm, f.tn]),
        [
          [128, 64, 8, 8, 4],
          [32, 32, 8, 4, 4],
          [32, 32, 8, 2, 2],
        ],
      );
    }
    // IRWB-057: every variant keeps each output's accumulation order (was: `accumulationOrder` by simulation)
    for (const k of s.kernels.filter(k => k.kind === 'contraction'))
      for (const v of k.variants) assert.equal(S.accumulationViolation(v), undefined, name);
  }
  const conv = lowerSchedule(corpus('conv2d'), true).value.kernels[0];
  assert.deepEqual(conv.dims, { b: [], m: ['i0', 'i2', 'i3'], n: ['i1'], r: ['i4', 'i5', 'i6'] });
  // the copy walks along the dim that is contiguous in memory: x along xpos (m), kernel along dx (r)
  assert.deepEqual(
    conv.variants[1].stages.map(s => s.fast),
    ['m', 'r'],
  );
  const score = lowerSchedule(corpus('attention'), true).value.kernels[0];
  assert.deepEqual(
    score.variants[1].stages.map(s => s.fast),
    ['r', 'r'],
  );
  // fuse: false is the unfused schedule: the plan is not run
  const unfused = scheduleFunction(corpus('mlp'), false);
  assert.equal(unfused.execution, undefined);
  assert.deepEqual(summary(unfused.schedule.value), ['pointwise:h', 'pointwise:g', 'pointwise:y']);
});

test('tileable contractions are recognised from the IR, and others say why not', () => {
  const why = text => S.contractionForm(fnOf(text).statements.at(-1));
  assert.match(why('fn f(a:f32[M,K]):f32[M] { y[i] = max(k) a[i,k]; return y; }'), /not exactly one|max/);
  assert.match(
    why('fn f(a:f32[M,K]):f32[M] { y[i] = sum(k) a[i,k]; return y; }'),
    /not a product of two loads/,
  );
  assert.match(
    why('fn f(a:f32[M,K], x:f32[K]):f32[M] { y[i] = sum(k) a[i,k] * x[k]; return y; }'),
    /no output axis/,
  );
  const batched = why(
    'fn f(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }',
  );
  assert.deepEqual(batched.dims, { b: ['i0'], m: ['i1'], n: ['i2'], r: ['i3'] });
});

// IRWB-057: the per-pass `legal` checks became `loopsEligible`, one check of the whole loop plan. The reasons a
// plan is refused for are the ones the passes gave.
const matmulPlan = () => {
  const fn = corpus('matmul');
  const fused = applyTransformationSync(S.fusePass, S.initialSchedule(fn), { params: chooseFusion(fn) });
  // matmul is one statement: the fusion plan is the unfused one, so nothing changed
  assert.equal(fused.changed, false);
  return { schedule: fused.artifact, plan: structuredClone(chooseLoops(fused.artifact.value)) };
};
test('eligible refuses an illegal loop plan before anything is prepared, with the reason', () => {
  const { schedule, plan } = matmulPlan();
  assert.deepEqual(S.loopsEligible(schedule.value, plan), { ok: true });
  const refuse = (change, pattern) => {
    const changed = structuredClone(plan);
    change(changed.kernels[0], changed);
    let prepared = false;
    const probe = { ...S.loopsPass, prepare: () => ((prepared = true), undefined) };
    assert.throws(() => applyTransformationSync(probe, schedule, { params: changed }), {
      code: 'illegal',
      message: pattern,
    });
    assert.equal(prepared, false);
  };
  const loopOf = (k, variant, id) => k.variants[variant].loops.find(l => l.id === id);
  refuse(k => {
    const loops = k.variants[1].loops;
    const [i, j] = [loops.findIndex(l => l.id === 'r.0'), loops.findIndex(l => l.id === 'r.1')];
    [loops[i], loops[j]] = [loops[j], loops[i]];
  }, /k0 variant 1: loop r.1 is outside the loops that order it/);
  refuse(k => (loopOf(k, 0, 'r.0').bind = 'thread'), /r.0 is bound to thread.*reassociation/);
  refuse(k => (loopOf(k, 1, 'r.1').bind = 'block.z'), /block.z is bound twice/);
  refuse(k => (loopOf(k, 1, 'm.0').bind = 'unroll'), /m.0 is bound to unroll and has no fixed number/);
  refuse(k => (loopOf(k, 1, 'm.0').factor = 4), /m.0 has a fixed number of iterations/);
  refuse(k => (k.variants[1].stages[0].at = 'm.0'), /m.0 is not a reduction loop/);
  refuse(k => (k.variants[1].stages[1].operand = 'm'), /the m operand is staged twice/);
  refuse(k => (loopOf(k, 1, 'r.1').factor = 1024), /the tile \(\d+ floats\) does not fit/);
  refuse(k => (k.select = [{ variant: 1, minBlocks: 2 }]), /last entry/);
  refuse(k => (k.select = [{ variant: 7, minBlocks: 0 }]), /names a missing variant/);
  refuse(k => (k.kernel = 'k9'), /k9 is not a pointwise kernel/);
  refuse((k, p) => p.kernels.push(structuredClone(k)), /k0 is scheduled twice/);
  // a kernel without a tileable contraction has no loop nest to plan
  const softmax = lowerSchedule(corpus('softmax'), true).value;
  assert.match(
    S.loopsEligible(softmax, { kernels: [{ ...plan.kernels[0], kernel: 'k0' }] }).reason,
    /k0 is not a pointwise kernel/,
  );
});

// IRWB-057: the order gate (`accumulationOrder` compared before and after each pass, by simulating three extent
// vectors) is gone. `eligible` rejects the plan; `conforms` rejects a `prepare` that does not produce the plan.
test('a prepare that does not realize the plan is rejected, and the plan it realized is not eligible', () => {
  const { schedule, plan } = matmulPlan();
  // a rogue prepare that swaps the levels of r.0 and r.1 (r = r.0 + 8 r.1 instead of 8 r.0 + r.1): no loop moves
  const swap = value => {
    const loops = value.kernels[0].variants[1].loops;
    const r0 = loops.find(l => l.id === 'r.0'),
      r1 = loops.find(l => l.id === 'r.1');
    Object.assign(r0, { id: 'r.1', level: 1, factor: 8, bind: 'unroll' });
    Object.assign(r1, { id: 'r.0', level: 0, factor: null, bind: 'serial' });
    return value;
  };
  const honest = S.loopsPass.prepare({ before: schedule, params: plan });
  const rogue = { ...S.loopsPass, prepare: () => ({ native: swap(structuredClone(honest.native)) }) };
  assert.throws(() => applyTransformationSync(rogue, schedule, { params: plan }), {
    code: 'contractRejected',
    message: /the kernels are not the loop nests of the plan/,
  });
  assert.equal(applyTransformationSync(S.loopsPass, schedule, { params: plan }).changed, true);
  assert.match(
    S.loopsEligible(schedule.value, swap(structuredClone(plan))).reason,
    /loop r.1 is outside the loops that order it/,
  );
  // the same for fusion: softmax's four statements in one kernel is the plan
  const fn = corpus('softmax');
  const initial = S.initialSchedule(fn);
  const apart = {
    ...S.fusePass,
    prepare: () => ({ native: { fn, kernels: [...initial.value.kernels].reverse() } }),
  };
  assert.throws(() => applyTransformationSync(apart, initial, { params: chooseFusion(fn) }), {
    code: 'contractRejected',
    message: /the kernels are not the groups of the plan/,
  });
  const fused = applyTransformationSync(S.fusePass, initial, { params: chooseFusion(fn) });
  assert.deepEqual(summary(fused.artifact.value), ['rows:m,e,s,y']);
  assert.deepEqual(
    fused.correspondence.entries.find(e => e.relation === 'fused'),
    { from: ['k0', 'k1', 'k2', 'k3'], to: ['k0'], relation: 'fused' },
  );
});

test('the printer only prints: a schedule outside its form is rejected, fuse: false is unchanged', () => {
  const s = lowerSchedule(corpus('matmul'), true).value;
  const v = s.kernels[0].variants[1];
  assert.equal(typeof variantForm(v), 'object');
  const swapped = { ...v, loops: [v.loops[0], v.loops[2], v.loops[1], ...v.loops.slice(3)] };
  assert.match(variantForm(swapped), /not printable: expected loop 1 to be m.0/);
  const source = cudaSource(
    compileTix(readFileSync(new URL('../../corpus/tensor/matmul/main.tix', import.meta.url), 'utf8')),
    'matmul',
  );
  assert.equal([...source.matchAll(/__global__/g)].length, 1);
  assert.match(source, /__launch_bounds__\(V == 1 \? 256 : V == 2 \? 64 : V == 3 \? 256 : 256\) k0/);
  assert.match(source, /static int variant_mode = -1;/);
});

test('launch coverage diagnoses a shadowed arm and an uncovered launch', () => {
  const fn = corpus('matmul');
  const schedule = S.initialSchedule(fn).value;
  const plan = structuredClone(chooseLoops(schedule));
  const kernel = plan.kernels[0];
  kernel.select = [{ variant: 1, minBlocks: 1 }, ...kernel.select];
  assert.match(S.loopsEligible(schedule, plan).reason, /k0: unreachable launch arm 1 \(variant 1\)/);
  kernel.select = kernel.select.slice(1, -1);
  assert.match(S.loopsEligible(schedule, plan).reason, /k0: uncovered launch with no tiled variant fitting/);
});

test('schedule validation reports a gate with no reachable fallback', () => {
  const schedule = structuredClone(lowerSchedule(corpus('softmax'), true).value);
  const { guard } = schedule.kernels[0].select[0];
  guard.fullRow = 1;
  guard.heavy = [];
  assert.throws(
    () => createIRArtifact(S.scheduleAdapter, 'always-fused', schedule),
    /unreachable unfused launch arm/,
  );
});
