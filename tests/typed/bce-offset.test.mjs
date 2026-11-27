// IRWB-037-D: bounds-check elimination through affine indices (`bce`) and the linear forms it reads.
// The project bounds-offset exists for this: its loop test is `i + 1 < work.length` and the two reads check
// `i + 1` and `i`. The check on `i + 1` goes (the same value the test compared); the check on `i` stays, because
// proving `i < length` from `i + 1 < length` needs `i`'s lower bound, which `ranges` loses when `i + 1` leaves the
// signed domain (`i` is widened to [0, MAX], and MAX + 1 is not an i32 interval).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { projectSource, ingestProject, runPipeline } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { listing } = await import('../../dist/typed/listing.js');
const { linearForm, formDifference } = await import('../../dist/typed/linear.js');
const { reachView } = await import('../../dist/typed/analyses.js');
const { Program } = await import('../../dist/typed/program.js');
const { lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { benchCase } = await import('../../dist/typed/evaluate.js');
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');

const id = 'bounds-offset';
const project = projectSource(id, projectFiles(id));

const traps = st => {
  const out = [];
  for (const f of st.fns.values())
    for (const b of f.blocks) for (const s of b.stmts) if (st.get(s).op === 'trap') out.push(b.id);
  return out;
};

/** A read's name: its reaching definition's value, or the definitions that reach it (as `bce`'s reader does). */
const readerOf = (st, reach) => ({
  read(site, local) {
    const defs = reach.reachingAt(site, local);
    if (defs.length === 1 && defs[0].startsWith('s:')) return { value: st.get(defs[0]).value, site: defs[0] };
    return defs.length ? { name: `${local}@${[...defs].sort().join(',')}` } : null;
  },
});

test('IRWB-037-D: bce removes the check on the tested index, and keeps the one it cannot prove', async () => {
  const r0 = ingestProject(project);
  assert.equal(traps(storeOf(r0.value)).length, 2, 'at r0 both reads are checked');
  const run = await runPipeline(r0, project.meta.pipeline, {
    manager: new AnalysisManager(),
    inputs: project.meta.inputs,
  });
  assert.deepEqual(
    run.steps.filter(s => s.rejected),
    [],
  );
  const st = storeOf(run.artifact.value);
  const text = listing(st, 'rises');
  // the check on `t3 = i + 1` is gone; the test that proves it is still there
  assert.match(text, /if \(\(i \+ 1\) >= load32\[work\+0\]\) goto \.2 else \.3/);
  assert.ok(!/if \(t3 >=u load32\[work\+0\]\)/.test(text), text);
  // the check on `i` stays, for the reason recorded in the pass's note
  assert.match(text, /if \(t4 >=u load32\[work\+0\]\)/);
  assert.equal(traps(st).length, 1);
});

test('IRWB-037-D: the eliminated check is worth 140 instructions on the project cases', async () => {
  const p = Program.fromProject(project);
  const call = benchCase(storeOf(p.origin.value), 'rises', {
    work: { cells: Array.from({ length: 20 }, (_, i) => i % 10) },
  });
  const steps = art => {
    const { image } = lowerToImage(art);
    const r = runImage(image, 'rises', call.args, call.memory, { limit: 2e5 });
    assert.equal(r.trap, false);
    return r.steps;
  };
  const before = steps(p.head);
  await p.pipeline(project.meta.pipeline, { count: 5 });
  assert.ok(steps(p.head) < before, `${steps(p.head)} should be fewer than ${before}`);
});

test('IRWB-037-D: a linear form names locals by their reaching definitions, so two indices compare', async () => {
  const p = Program.fromProject(project);
  await p.pipeline(project.meta.pipeline, { count: 5 });
  const st = storeOf(p.head.value);
  const manager = new AnalysisManager();
  const { reachingAnalysis } = await import('../../dist/typed/analyses.js');
  const reach = reachView((await manager.analyse(reachingAnalysis, p.head)).value, st, 'rises');
  const reader = readerOf(st, reach);
  const all = st.fn('rises').blocks.flatMap(b => b.stmts);
  const ge = all.filter(s => st.get(s).op === 'br_if' && st.get(st.get(s).cond).op === 'ge');
  const geu = all.filter(s => st.get(s).op === 'br_if' && st.get(st.get(s).cond).op === 'geu');
  assert.equal(ge.length, 1, 'the loop test `(i + 1) >= work.length`');
  assert.equal(geu.length, 1, 'the check on `i` survives');
  const tested = linearForm(st, reader, ge[0], st.get(st.get(ge[0]).cond).args[0]);
  const checked = linearForm(st, reader, geu[0], st.get(st.get(geu[0]).cond).args[0]);
  assert.ok(tested && checked);
  // i + 1 was tested, i is checked: the same names, one constant apart
  assert.equal(formDifference(tested, checked), 1);
  // a load is not a linear form (the loop reads the buffer's length)
  const loaded = all
    .map(s => st.get(s))
    .flatMap(s => [s.value, s.addr])
    .filter(v => v && st.get(v).op.startsWith('load'));
  assert.ok(loaded.length > 0);
  assert.equal(linearForm(st, reader, all[0], loaded[0]), null);
});
