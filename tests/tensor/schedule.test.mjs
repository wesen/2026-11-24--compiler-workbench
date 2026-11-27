import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { scheduleFunction } from '../../dist/tensor/schedule.js';
import { planFusion, unfusedPlan } from '../../dist/tensor/fusion.js';

const source = `fn main(x: f32[N]) : f32[N] {
  a[i] = x[i] + 1;
  b[i] = a[i] * 2;
  return b;
}`;
test('schedule revisions retain the function and use the existing fusion analysis', () => {
  const program = compileTix(source);
  const fn = program.current.value.functions[0];
  const initial = scheduleFunction(fn, false);
  const fused = scheduleFunction(fn, true);
  assert.equal(initial.kind, 'tensor.schedule');
  assert.deepEqual(initial.value.plan, unfusedPlan(fn));
  assert.deepEqual(fused.value.plan, planFusion(fn));
  assert.deepEqual(fused.value.fn, fn);
  assert.notEqual(initial.revision, fused.revision);
  assert.equal((cudaSource(program, 'main').match(/__global__ void/g) ?? []).length, 1);
});
