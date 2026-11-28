import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createIRArtifact } from '../../dist/framework/ir/index.js';
import { cudaArtifact, createCudaLowering } from '../../dist/tensor/cuda-contract.js';
import { emitScheduleProgram } from '../../dist/tensor/cuda-source.js';
import { evaluate } from '../../dist/tensor/evaluate.js';
import { compileTix } from '../../dist/tensor/index.js';
import { scheduleAdapter } from '../../dist/tensor/schedule.js';
import { lowerSchedule } from '../../dist/tensor/strategy.js';

const corpus = new URL('../../corpus/tensor/', import.meta.url);
const programOf = name => compileTix(readFileSync(new URL(`${name}/main.tix`, corpus), 'utf8'));

function previousModes(kernels) {
  const gate = kernels.some(k => k.gated);
  const variants = Math.max(0, ...kernels.map(k => k.variants ?? 0));
  if (variants)
    return Array.from({ length: variants }, (_, variant) => ({
      variant,
      ...(gate && { gate: variant % 2 ? 'unfused' : 'fused' }),
    }));
  return gate ? [{ gate: 'fused' }, { gate: 'unfused' }] : [{}];
}

let nextProfile = 0;

async function checkedModes(program, schedule) {
  const emitted = emitScheduleProgram(schedule);
  const { name } = schedule.fn;
  const modes = [];
  const check = createCudaLowering(
    `staged-choice-test-${nextProfile++}`,
    async (_source, fn, cases, { gate, variant }) => {
      modes.push({ ...(gate && { gate }), ...(variant !== undefined && { variant }) });
      return cases.map(inputs => ({ ...evaluate(fn, inputs, 'f32'), gpuMs: 0 }));
    },
  );
  const verdict = await check(program.current, name, cudaArtifact(name, emitted.source, emitted.kernels));
  assert.deepEqual(verdict, { accepted: true, relation: 'exact' });
  return modes;
}

test('the differential derives the previous modes for the corpus and schedule kernel forms', async () => {
  const programs = readdirSync(corpus, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => programOf(entry.name));
  const scheduleFixtures = [
    'fn f(a:f32[M,K]):f32[M] { y[i] = max(k) a[i,k]; return y; }',
    'fn f(a:f32[M,K]):f32[M] { y[i] = sum(k) a[i,k]; return y; }',
    'fn f(a:f32[M,K], x:f32[K]):f32[M] { y[i] = sum(k) a[i,k] * x[k]; return y; }',
    'fn mm(a:f32[M,K], b:f32[K,N]):f32[M,N] { y[i,j] = sum(k) a[i,k] * b[k,j]; return y; }',
    readFileSync(new URL('./fixtures/schedule-features.tix', import.meta.url), 'utf8'),
  ];
  programs.push(...scheduleFixtures.map(text => compileTix(text)));
  for (const program of programs)
    for (const fn of program.current.value.functions)
      for (const fuse of [true, false]) {
        const schedule = lowerSchedule(fn, fuse).value;
        const { kernels } = emitScheduleProgram(schedule);
        assert.deepEqual(
          await checkedModes(program, schedule),
          previousModes(kernels),
          `${fn.name}, fuse=${fuse}`,
        );
      }
});

test('adding a variant arm adds a differential batch', async () => {
  const program = programOf('matmul');
  const schedule = structuredClone(lowerSchedule(program.current.value.functions[0], true).value);
  const kernel = schedule.kernels[0];
  const variant = kernel.variants.length;
  kernel.variants.push(structuredClone(kernel.variants[1]));
  kernel.select.unshift({ variant, minBlocks: kernel.select[0].minBlocks + 1 });
  const revised = createIRArtifact(scheduleAdapter, 'extra-arm', schedule).value;
  assert.match(emitScheduleProgram(revised).source, /\? 4 : fits_k0_1/);
  assert.deepEqual(
    await checkedModes(program, revised),
    [0, 1, 2, 3, 4].map(variant => ({ variant })),
  );
});

test('one contraction variant still checks both gate arms', async () => {
  const program = programOf('attention');
  const schedule = structuredClone(lowerSchedule(program.current.value.functions[0], true).value);
  for (const kernel of schedule.kernels.filter(k => k.kind === 'contraction')) {
    kernel.variants = kernel.variants.slice(0, 1);
    kernel.select = kernel.select.filter(arm => arm.variant === 0);
  }
  const revised = createIRArtifact(scheduleAdapter, 'one-variant', schedule).value;
  assert.deepEqual(await checkedModes(program, revised), [
    { gate: 'fused', variant: 0 },
    { gate: 'unfused', variant: 0 },
  ]);
});
