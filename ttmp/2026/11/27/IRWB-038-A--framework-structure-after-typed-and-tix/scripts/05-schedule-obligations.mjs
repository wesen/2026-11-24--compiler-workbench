import './02-source-loader.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cell = new URL('../../../../../../../t6-op-irwb-033-d/', import.meta.url);
const source = path => import(new URL('src/' + path, cell));
const S = await source('tensor/schedule.ts');
const { compileTix } = await source('tensor/index.ts');
const { planFusion } = await source('tensor/fusion.ts');
const { applyNativePassSync, applyPass, definePass } = await source('framework/passes/define-pass.ts');
const { AnalysisManager } = await source('framework/contracts/analysis-manager.ts');

const { functions: [fn] } = compileTix(
  readFileSync(new URL('corpus/tensor/matmul/main.tix', cell), 'utf8'),
).current.value;
let schedule = S.initialSchedule(fn, planFusion(fn));
const step = (pass, params) => { schedule = S.applyStep(pass, schedule, params).artifact; };
const variant = { kernel: 'k0', variant: 1 };
step(S.contractionPass, { kernel: 'k0' });
step(S.variantPass, { kernel: 'k0' });
step(S.splitPass, { ...variant, loop: 'r.0', factor: 4 });

const refusals = [];
const refusingPass = definePass({
  ...S.reorderPass,
  run() { refusals.push('kernel ran'); throw new Error('precondition allowed the kernel'); },
});
const bad = { ...variant, order: ['b.0', 'm.0', 'n.0', 'r.1', 'r.0'] };
assert.throws(() => S.applyStep(refusingPass, schedule, bad), { code: 'illegal' });
await assert.rejects(
  applyPass(refusingPass, schedule, { manager: new AnalysisManager(), params: bad }),
  { code: 'illegal' },
);
assert.deepEqual(refusals, []);
console.log('T6-D: both runners reject a reordered reduction before invoking the kernel');

const incorrectPass = definePass({
  ...S.reorderPass,
  id: '038-a-incorrect',
  legal: () => ({ ok: true }),
  run: ({ before }) => {
    const native = structuredClone(before.value);
    const loops = native.kernels[0].variants[1].loops;
    const outer = loops.find(loop => loop.id === 'r.0');
    const inner = loops.find(loop => loop.id === 'r.1');
    Object.assign(outer, { id: 'r.1', level: 1, factor: 4 });
    Object.assign(inner, { id: 'r.0', level: 0, factor: null });
    return { native };
  },
});
assert.throws(() => applyNativePassSync(incorrectPass, schedule, S.orderGate, variant), {
  code: 'contractRejected',
  message: /accumulation order of y changed/,
});
console.log('T6-D: post-check rejects the wrong reduction even when eligibility succeeds');
