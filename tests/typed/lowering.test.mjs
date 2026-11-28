// IRWB-061 (IRWB-039 phase 4, item 4.2): the Typed lowering as a transformation, `typed.lower-rv32`.
//   - on every corpus project, at r0 and after O2, the transformation's image and correspondence are those of the
//     direct construction (`compileImage`, `createIRArtifact`, `imageCorrespondence`), and `lowerToImage` is that
//     transformation applied with its check pending;
//   - the correspondence composes with the passes' (r0 -> rN -> image) and traces a source entity to instructions;
//   - a planted backend bug (one spill reload dropped) is rejected by `ensures` (`rv32.image-agrees`), with the
//     failing function in the evidence, and nothing is published; the unplanted image is accepted and published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { canonical } = await import('../../dist/framework/core/data.js');
const { AnalysisManager, assuranceOf } = await import('../../dist/framework/contracts/index.js');
const { composeCorrespondence, createIRArtifact, IRStore, traceEntity } = await import(
  '../../dist/framework/ir/index.js'
);
const { applyTransformation, applyTransformationSync, isCross, PassError } = await import(
  '../../dist/framework/passes/index.js'
);
const { projectSource } = await import('../../dist/typed/project.js');
const { Program } = await import('../../dist/typed/program.js');
const B = await import('../../dist/typed/backend/index.js');

const program = id => Program.fromProject(projectSource(id, projectFiles(id)));
/** Today's lowering, built directly: the oracle the transformation's output is compared with. */
const direct = (art, options) => {
  const image = createIRArtifact(B.imageAdapter, `img:${art.value.program}`, B.compileImage(art, options));
  return { image, correspondence: B.imageCorrespondence(art, image) };
};
const PENDING = { pending: { reason: 'test' } };

test('typed.lower-rv32 is a cross-IR transformation with rv32.image-agrees as its ensures', () => {
  const t = B.imageLowering();
  assert.equal(isCross(t), true);
  assert.equal(t.id, 'typed.lower-rv32');
  assert.equal(t.relation, 'exact');
  assert.deepEqual([t.from.ir.id, t.to.ir.id], ['typed.blocks', 'rv32.image']);
  const [contract] = t.obligations.ensures;
  assert.equal(contract, B.loweringContract());
  assert.deepEqual(
    contract.ensures.map(c => c.invariant.id),
    ['rv32.image-agrees'],
  );
  assert.equal(contract.ensures[0].invariant, B.imageAgrees());
  assert.deepEqual(Object.keys(B.imageLowering(undefined, 'needs').needs), ['liveness', 'ranges']);
  assert.equal(B.imageLowering(), t); // one definition per check and facts mode
  assert.notEqual(B.imageLowering({ count: 3 }), t);
});

test('on the whole corpus, at r0 and after O2, the image and the correspondence equal the direct construction', async () => {
  let n = 0;
  for (const id of projectIds()) {
    const p = program(id);
    const arts = [p.artifact()];
    await p.pipeline('O2');
    arts.push(p.artifact());
    for (const art of arts) {
      const want = direct(art);
      const result = applyTransformationSync(B.imageLowering(), art, PENDING);
      assert.equal(result.artifact.revision, want.image.revision, id);
      assert.equal(result.artifact.id, want.image.id, id);
      assert.equal(canonical(result.correspondence), canonical(want.correspondence), id);
      // lowerToImage is that application
      const lowered = B.lowerToImage(art);
      assert.equal(lowered.image.revision, want.image.revision, id);
      assert.equal(canonical(lowered.correspondence), canonical(want.correspondence), id);
      assert.equal(result.pending, 'test');
      assert.deepEqual(
        result.obligations.map(o => [o.id, o.status]),
        [['typed.lower-rv32', 'pending']],
      );
      n++;
    }
  }
  assert.ok(n >= 100, `${n} lowerings compared`);
});

test('backend options, facts and the image id pass through lowerToImage unchanged', () => {
  const art = program('pressure').artifact();
  for (const options of [{ registers: 1 }, { coalesce: true }, { useRanges: false }]) {
    const want = direct(art, options);
    const got = B.lowerToImage(art, options);
    assert.equal(got.image.revision, want.image.revision);
    assert.equal(canonical(got.correspondence), canonical(want.correspondence));
  }
  assert.equal(B.lowerToImage(art, {}, { id: 'img:elsewhere' }).image.id, 'img:elsewhere');
  assert.throws(() => B.lowerToImage(art, { registers: 0 }), /registers/);
});

test('the correspondence composes with the passes: r0 through O2 into the image', async () => {
  const p = program('pressure');
  await p.pipeline('O2');
  const passes = p.revisions.slice(1).map(r => r.correspondence);
  assert.ok(passes.length > 0 && passes.every(Boolean));
  const { image, correspondence } = B.lowerToImage(p.head);
  const whole = [...passes, correspondence].reduce((a, b) => composeCorrespondence(a, b));
  assert.deepEqual(whole.from, { artifact: p.origin.id, revision: p.origin.revision });
  assert.deepEqual(whole.to, { artifact: image.id, revision: image.revision });
  // the same chain with today's image correspondence is the same relation
  const today = [...passes, B.imageCorrespondence(p.head, image)].reduce((a, b) =>
    composeCorrespondence(a, b),
  );
  assert.equal(canonical(whole), canonical(today));
  // some r0 entity is traced through every revision to instructions of the image
  const insns = new Set(image.value.insns.map(m => m.id));
  const source = whole.entries.find(e => e.from.length && e.to.some(id => insns.has(id))).from[0];
  const trace = traceEntity({ artifact: p.origin.id, revision: p.origin.revision, entity: source }, [
    ...passes,
    correspondence,
  ]);
  const reached = trace.steps.at(-1).after.map(r => r.entity);
  assert.ok(reached.length > 0 && reached.every(id => insns.has(id) || id.startsWith('fn:')));
});

/** A copy of the image with one instruction replaced by a nop: the record stays self-consistent (validateImage). */
const nopAt = (image, index) => {
  const code = B.fromBase64(image.code),
    NOP = 0x00000013,
    m = image.insns[index];
  new DataView(code.buffer, code.byteOffset, code.byteLength).setUint32(m.offset, NOP, true);
  const text = B.decode(NOP, m.offset).text;
  const insns = image.insns.map((x, i) =>
    i === index ? { ...x, op: 'addi', word: NOP, text, sym: text, why: 'planted' } : x,
  );
  return { ...image, code: B.toBase64(code), insns };
};

test('a planted wrong image (one spill reload dropped) is rejected by the lowering through its ensures', async () => {
  const art = program('pressure').artifact();
  const options = { registers: 1 }; // a small register budget spills
  const t = B.imageLowering({ count: 20 }, 'needs');
  // the unplanted lowering is accepted, published in the image's own lineage, with sampled evidence
  const manager = new AnalysisManager(),
    store = new IRStore();
  store.retain(art);
  const good = await B.lowerImageChecked(art, options, { manager, store, check: { count: 20 } });
  assert.equal(good.image.revision, direct(art, options).image.revision);
  assert.equal(store.head(good.image.id).revision, good.image.revision);
  assert.equal(store.head(art.id).revision, art.revision);
  const accepted = manager.snapshot().executions.at(-1);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.transformation.id, 'typed.lower-rv32');
  const agreed = accepted.checks.find(c => c.phase === 'ensures');
  assert.equal(agreed.definition.id, 'rv32.image-agrees');
  assert.equal(agreed.ok, true);
  assert.equal(assuranceOf(agreed.evidence), 'checked-sampled');
  assert.ok(accepted.checks.some(c => c.phase === 'correspondence' && c.ok));
  assert.equal(good.result.pending, undefined);
  // the facts were computed through the manager (declared needs)
  assert.ok(manager.snapshot().analyses.some(a => /liveness/.test(a.analysis.id)));

  // the planted bug: the first spill reload of the image becomes a nop
  const index = good.image.value.insns.findIndex(m => m.why === 'spill reload');
  assert.ok(index >= 0);
  const fn = good.image.value.insns[index].fn;
  const planted = {
    ...t,
    prepare: ctx => {
      const r = t.prepare(ctx);
      return { ...r, output: nopAt(r.output, index) };
    },
  };
  const m2 = new AnalysisManager(),
    s2 = new IRStore();
  s2.retain(art);
  let error;
  await applyTransformation(planted, art, { manager: m2, store: s2, params: { options } }).catch(
    e => (error = e),
  );
  assert.ok(error instanceof PassError, String(error));
  assert.equal(error.code, 'contractRejected');
  assert.match(error.message, /typed\.lower-rv32 output rejected/);
  assert.equal(error.cause.code, 'postcondition');
  // nothing was published and the execution is not accepted
  assert.deepEqual(s2.revisions(good.image.id), []);
  const rejected = m2.snapshot().executions.at(-1);
  assert.notEqual(rejected.status, 'accepted');
  const evidence = rejected.checks.find(c => c.phase === 'ensures').evidence;
  assert.ok(evidence.disagree > 0);
  // the failing function is in the evidence
  assert.ok(
    evidence.counterexamples.some(c => c.case.fn === fn),
    `${fn} among ${evidence.counterexamples.map(c => c.case.fn)}`,
  );
  assert.match(evidence.counterexamples[0].reason, /expected .*, got /);
  // the same planted image passes when its check is left pending: the record says so
  const owed = applyTransformationSync(planted, art, { manager: m2, params: { options }, ...PENDING });
  assert.equal(owed.obligations[0].status, 'pending');
});
