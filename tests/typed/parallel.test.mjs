// IRWB-004 F4: the meaning check with its cases decided on worker threads gives the evidence of deciding them on the
// calling thread: for candidates that agree, for one that disagrees, with reuse and without.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../../dist/typed/project.js');
const P = await import('../../dist/typed/passes.js');
const { meaningKept } = await import('../../dist/typed/evaluate.js');
const { setMeaningExecutor } = await import('../../dist/typed/meaning-exec.js');
const { startMeaningPool } = await import('../../dist/typed/parallel/node-pool.js');
const C = await import('../../dist/framework/contracts/index.js');
const { applyPass } = await import('../../dist/framework/passes/index.js');

const project = id => projectSource(id, projectFiles(id));
const evidenceOf = async (check, origin, candidate) => (await check.check(null, { origin, candidate })).evidence;

test('IRWB-004 F4: workers decide the same verdicts as the calling thread', async () => {
  const subjects = [];
  for (const [id, passes] of [
    ['blend', 'O2'],
    ['across-calls', 'O2'],
    ['strength', 'O2'],
  ]) {
    const p = project(id),
      r0 = ingestProject(p);
    const run = await runPipeline(r0, passes, { manager: new C.AnalysisManager(), inputs: p.meta.inputs });
    const check = meaningKept({ inputs: p.meta.inputs });
    for (const s of [r0, ...run.steps.filter(s => s.changed).map(s => s.result.artifact)]) subjects.push([id, check, r0, s]);
  }
  const p = project('wrong-shift'),
    r0 = ingestProject(p);
  const bad = await applyPass(P.PASSES['div-to-shift'], r0, { manager: new C.AnalysisManager() });
  subjects.push(['wrong-shift', meaningKept({ inputs: p.meta.inputs }), r0, bad.artifact]);

  for (const reuse of [false, true]) {
    C.setDifferentialReuse(false);
    const want = [];
    for (const [, check, origin, s] of subjects) want.push(await evidenceOf(check, origin, s));
    C.setDifferentialReuse(reuse);
    const pool = startMeaningPool({ threads: 3, minCases: 1 });
    setMeaningExecutor(pool);
    try {
      for (let round = 0; round < 2; round++)
        for (let i = 0; i < subjects.length; i++) {
          const [id, check, origin, s] = subjects[i];
          assert.deepEqual(await evidenceOf(check, origin, s), want[i], `${id} subject ${i}, reuse ${reuse}, round ${round}`);
        }
      assert.ok(pool.stats.jobs > 0 && pool.stats.cases > 0, JSON.stringify(pool.stats));
      // after the first round, every worker has every part it needs: the second round sends none
      assert.ok(pool.stats.partsSent > 0);
    } finally {
      setMeaningExecutor(undefined);
      await pool.close();
    }
    assert.ok(want.at(-1).disagree > 0, 'the wrong pass disagrees');
  }
  C.setDifferentialReuse(true);
});

test('IRWB-004 F4: small jobs stay on the calling thread', async () => {
  const p = project('blend'),
    r0 = ingestProject(p);
  const pool = startMeaningPool({ threads: 2, minCases: 1e9 });
  setMeaningExecutor(pool);
  try {
    C.setDifferentialReuse(false);
    const ev = await evidenceOf(meaningKept({ inputs: p.meta.inputs }), r0, r0);
    assert.equal(ev.status, 'agree');
    assert.equal(pool.stats.jobs, 0);
    assert.equal(pool.stats.local, 1);
  } finally {
    setMeaningExecutor(undefined);
    C.setDifferentialReuse(true);
    await pool.close();
  }
});
