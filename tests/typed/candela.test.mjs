// IRWB-001 P4.2: Candela at r0 against the reference. The gallery program compiled by the repository's own RV32
// compiler (typed-rv32.js, policy stock) runs on the reference interpreter; the evaluator must agree with it on the
// generated cases of every function (tools/candela-oracle.mjs runs more cases and reports per function).
// IRWB_CANDELA=1 also runs O2 on the whole program with the meaning check (about half an hour; tools/candela-o2.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { candelaInputs, candelaSource, MAX_SOURCE } from '../../tools/candela.mjs';

await installVendor({ reference: true });
const { ingest } = await import('../../dist/typed/lift.js');
const { casesFrom, evaluate, agrees, meaningKept } = await import('../../dist/typed/evaluate.js');
const { referenceCompile, referenceRun } = await import('../../dist/typed/reference.js');

const source = candelaSource();
const st = ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE });

test('P4.2: the evaluator at r0 agrees with the reference compiler\'s image on every Candela function', () => {
  const program = referenceCompile(source, { maxSourceLength: MAX_SOURCE, policy: 'stock' });
  const inputs = candelaInputs(st);
  const t = { values: 0, traps: 0, inconclusive: 0, valueFns: 0 };
  for (const fn of st.fns.keys()) {
    let values = 0;
    for (const c of casesFrom(st, fn, { count: 8, inputs: inputs[fn] ?? {} })) {
      const ours = evaluate(st, fn, c.args, c.memory, { limit: 2e5 });
      const ref = referenceRun(program, fn, c.args, c.memory, { limit: 2e7 });
      if (ours.limit || ref.limit) {
        t.inconclusive++;
        continue;
      }
      assert.ok(agrees(ref, ours), `${fn}#${c.n}(${c.args}): reference ${ref.trap || ref.result}, evaluator ${ours.trap || ours.result}`);
      if (ref.trap) t.traps++;
      else values++;
    }
    t.values += values;
    if (values) t.valueFns++;
  }
  assert.ok(t.valueFns >= 320, JSON.stringify(t));
});

test('P4.2: O2 on Candela keeps its meaning (IRWB_CANDELA=1)', { skip: process.env.IRWB_CANDELA !== '1', timeout: 4 * 3600e3 }, async () => {
  const { blocksAdapter } = await import('../../dist/typed/ir.js');
  const { createIRArtifact } = await import('../../dist/framework/ir/index.js');
  const { runPipeline } = await import('../../dist/typed/project.js');
  const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
  const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative()), manager = new AnalysisManager();
  const inputs = candelaInputs(st);
  const run = await runPipeline(r0, 'O2', { manager, inputs, count: 40 });
  assert.deepEqual(run.steps.filter(s => s.rejected).map(s => s.pass), []);
  const ev = (await manager.checkInvariant(meaningKept({ inputs, count: 100 }), { origin: r0, candidate: run.artifact })).evidence;
  assert.equal(ev.disagree, 0, JSON.stringify(ev.counterexamples));
});
