// P2.2 evaluator, cases and the meaning check; P2.3 analyses as v6 analyses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor();
const { ingest } = await import('../../dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import('../../dist/typed/ir.js');
const { createIRArtifact } = await import('../../dist/framework/ir/index.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const E = await import('../../dist/typed/evaluate.js');
const A = await import('../../dist/typed/analyses.js');
const { projectSource, ingestProject } = await import('../../dist/typed/project.js');
const { projectFiles } = await import('../../tools/corpus.mjs');

const load = id => {
  const project = JSON.parse(readFileSync(`corpus/projects/${id}/project.json`, 'utf8'));
  const r0 = createIRArtifact(blocksAdapter, id, ingest(id, readFileSync(`corpus/projects/${id}/main.typed`, 'utf8')).toNative());
  return { project, r0, st: storeOf(r0.value) };
};

test('P2.2: Compiler Workbench\'s generator and hash are reproduced', () => {
  // xorshift32 from seed 7: 7 ^ 7<<13 = 0xE007; ^ >>>17 is a no-op; ^ <<5 gives 0x1CE0E7
  assert.equal(E.rng(7)() * 4294967296, 0x1ce0e7);
  assert.equal(E.hash(''), '811c9dc5');
});

test('P2.2: the evaluator runs Blend; cases are deterministic; traps are outcomes', () => {
  const { project, st } = load('blend');
  const a = E.casesFrom(st, 'blend', { count: 5, seed: 7, inputs: project.inputs.blend });
  const b = E.casesFrom(st, 'blend', { count: 5, seed: 7, inputs: project.inputs.blend });
  assert.deepEqual(a.map(c => c.args), b.map(c => c.args));
  const r = E.evaluate(st, 'blend', a[0].args, a[0].memory, { counts: true });
  assert.equal(r.trap, false);
  assert.equal(typeof r.result, 'number');
  assert.ok(r.steps > 0 && r.counts.size > 0);
  // a buffer shorter than n makes the bounds check trap
  const short = E.benchCase(st, 'blend', { work: { cells: [1, 2] }, n: 5, a: 1, b: 1 });
  assert.match(String(E.evaluate(st, 'blend', short.args, short.memory).trap), /unreachable/);
  const limited = E.evaluate(st, 'blend', a[0].args, a[0].memory, { limit: 3 });
  assert.equal(limited.limit, true);
});

test('P2.2: typed.meaning-kept is a framework differential invariant', async () => {
  const { project, r0 } = load('blend');
  const m = new AnalysisManager();
  const check = E.meaningKept({ inputs: project.inputs });
  assert.equal(check, E.meaningKept({ inputs: project.inputs }), 'one definition per parameter set');
  const ev = await m.checkInvariant(check, { origin: r0, candidate: r0 });
  assert.equal(ev.ok, true);
  assert.equal(ev.evidence.method, 'sampled');
  assert.equal(ev.evidence.agree, 40);
});

test('P2.3: Blend facts: one loop with a preheader, liveness, reaching definitions, ranges', async () => {
  const { r0, st } = load('blend');
  const m = new AnalysisManager();
  const loops = (await m.analyse(A.loopsAnalysis, r0)).value.blend;
  assert.equal(loops.length, 1);
  assert.equal(loops[0].head, 'bb:blend.1');
  assert.equal(loops[0].preheader, 'bb:blend.0');
  const dom = A.domView((await m.analyse(A.dominatorsAnalysis, r0)).value.blend);
  assert.ok(dom.dominates('bb:blend.1', 'bb:blend.7'));
  const lv = A.liveView((await m.analyse(A.livenessAnalysis, r0)).value, st, 'blend');
  assert.deepEqual(lv.names(lv.liveIn('bb:blend.1')).sort(), ['a', 'b', 'i', 'n', 's', 'scale', 'work']);
  const rc = A.reachView((await m.analyse(A.reachingAnalysis, r0)).value, st, 'blend');
  assert.deepEqual(rc.reachingAt('s:blend.5', 6).sort(), ['s:blend.11', 's:blend.2']);
  const rg = A.rangeView((await m.analyse(A.rangesAnalysis, r0)).value, st, 'blend');
  assert.deepEqual(rg.at('s:blend.6', 6), [0, 2147483646]); // i: widened, then refined by i < n
  const again = await m.analyse(A.rangesAnalysis, r0);
  assert.equal(again.value, (await m.analyse(A.rangesAnalysis, r0)).value, 'cached per exact revision');
});

test('P2.3: every corpus function gets every fact', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const m = new AnalysisManager();
  let fns = 0;
  for (const id of readdirSync('corpus/projects')) {
    if (!existsSync(`corpus/projects/${id}/main.typed`)) continue;
    // every source file, ingested as project.json says (frame arrays need the tape)
    const r0 = ingestProject(projectSource(id, projectFiles(id))), st = storeOf(r0.value);
    for (const def of Object.values(A.ANALYSES)) await m.analyse(def, r0);
    fns += st.fns.size;
  }
  assert.ok(fns >= 60, `${fns} functions`);
});
