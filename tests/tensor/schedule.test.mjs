import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyNativePassSync } from '../../dist/framework/passes/index.js';
import { traceEntity } from '../../dist/framework/ir/index.js';
import { compileTix, cudaSource } from '../../dist/tensor/index.js';
import { compileCudaPipeline } from '../../dist/tensor/cuda-contract.js';
import { ScheduleIR, schedulePasses, orderCheck } from '../../dist/tensor/schedule.js';

const corpus = name =>
  compileTix(readFileSync(new URL(`../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
test('the compiler exposes connected Tix, schedule revisions and CUDA, including individual folds', () => {
  const p = corpus('mlp');
  const { initial, schedule, cuda, steps, correspondence } = compileCudaPipeline(p.current, 'mlp', true);
  assert.equal(cuda.value.source, cudaSource(p, 'mlp'));
  assert.equal(initial.kind, ScheduleIR.id);
  assert.ok(steps.filter(s => s.changed).every(s => s.contract.ok && s.correspondence));
  const g = schedule.value.groups[0];
  assert.deepEqual(
    g.phases.map(p => [p.kind, p.statements, p.outputs]),
    [
      ['tile', ['h', 'g'], ['g']],
      ['tile', ['y'], ['y']],
    ],
  );
  let last = { artifact: p.current.id, revision: p.current.revision };
  for (const c of correspondence) {
    assert.deepEqual(c.from, last);
    last = c.to;
  }
  assert.deepEqual(last, { artifact: cuda.id, revision: cuda.revision });
  assert.equal(applyNativePassSync(schedulePasses.vectorize, initial).changed, false);
  assert.deepEqual(
    steps.find(s => s.pass.id.endsWith('stage-panels')).contract.evidence.panels.map(p => p.statement),
    ['h', 'y'],
  );
  const fold = 'fold/h/0';
  assert.ok(correspondence[0].entries.some(e => e.from.includes('mlp/h') && e.to.includes(fold)));
  const trace = traceEntity(
    { artifact: initial.id, revision: initial.revision, entity: fold },
    correspondence.slice(1),
  );
  assert.deepEqual(
    trace.current.map(r => r.entity),
    ['k0'],
  );
});
test('schedule checks reject a changed algorithm, swapped panel address map, and missing phase store', () => {
  const { initial, schedule } = compileCudaPipeline(corpus('attention').current, 'attention', true);
  const mutate = fn => {
    const v = structuredClone(schedule.value);
    fn(v);
    return v;
  };
  assert.equal(
    orderCheck(initial, {
      value: mutate(s => {
        s.fn.statements[0].expr = { kind: 'literal', text: '0' };
      }),
    }).ok,
    false,
  );
  assert.throws(
    () =>
      ScheduleIR.validate(
        mutate(s => {
          s.groups[0].tiles.score.transposed = false;
        }),
      ),
    /operands/,
  );
  assert.throws(
    () =>
      ScheduleIR.validate(
        mutate(s => {
          s.groups[0].phases[1].outputs = [];
        }),
      ),
    /phase/,
  );
  assert.throws(
    () =>
      ScheduleIR.validate(
        mutate(s => {
          s.groups[0].tiles.out.depth = 0;
        }),
      ),
    /partition/,
  );
});
test('matching uses resolved affine indices, including transposed operands and a register epilogue', () => {
  const fn =
    'fn f(a:f32[K,M], b:f32[N,K], c:f32[N]):f32[M,N] { p[i,j]=sum(k)b[j,k]*a[k,i]; z[i,j]=p[i,j]+c[j]; return z; }';
  const { schedule } = compileCudaPipeline(compileTix(fn).current, 'f', true);
  const g = schedule.value.groups[0];
  assert.deepEqual(
    g.phases.map(p => p.statements),
    [['p', 'z']],
  );
  assert.equal(g.tiles.p.transposed, true);
  assert.equal(g.tiles.p.leftTransposed, true);
});
