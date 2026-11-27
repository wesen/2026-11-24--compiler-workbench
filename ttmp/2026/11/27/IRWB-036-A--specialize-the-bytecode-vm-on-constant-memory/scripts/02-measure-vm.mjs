import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';

await installVendor();
const { promoteFrame } = await import('../../../../../../dist/typed/passes.js');
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase, evaluate } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');

const project = projectSource('bytecode-vm', projectFiles('bytecode-vm'));
const inputs = project.meta.inputs.runVm;
const testSource = readFileSync(new URL('../../../../../../tests/typed/bytecode-vm.test.mjs', import.meta.url), 'utf8');
const handSource = testSource.match(/const specializedSource = `([^]*?)`;/)[1];
const hand = new Program('hand', handSource, {
  inputs: { seededFib: { n: inputs.n, seed: inputs.seed }, rollingChecksum: { n: inputs.n, seed: inputs.seed } },
});
async function optimize(p, pipeline = 'speed') {
  const run = await p.pipeline(pipeline);
  for (const step of run.steps) {
    assert.ok(!step.rejected, step.rejected);
    if (step.changed) assert.equal(step.check, `${40 * p.fns().length}/${40 * p.fns().length}`, step.pass);
  }
}
await optimize(hand);
const general = Program.fromProject(project);
const base = storeOf(general.head.value);
const image = p => lowerToImage(p.head, { coalesce: true }).image;
const generalImage = image(general);
await optimize(general);
const speedImage = image(general);
const handImage = image(hand);
const runner = (img, c) => runImage(img, c.fn, c.args, c.memory, { counts: false });
const binding = (param, value) => ({ fn: 'runVm', param, entity: `fixture/${param}`, ...value });
const artifact = bindings => createArtifact(BindingsIR, 'fixture', { formatVersion: 1, source: 'corpus', bindings });
const rows = [];
for (const [entry, handName] of [[0, 'seededFib'], [34, 'rollingChecksum']]) {
  const example = benchCase(base, 'runVm', { code: inputs.code, entry, n: 12, seed: 8 });
  function measure(stage, img, call = example, extras = {}) {
    const run = runner(img, call);
    assert.equal(run.trap, false);
    assert.equal(run.limit, false);
    rows.push({ entry, stage, instructions: run.steps, bytes: img.value.fns[call.fn].bytes,
      imageBytes: img.value.bytes, result: run.result, ...extras });
  }
  measure('general r0', generalImage);
  measure('general speed', speedImage);
  const scalar = Program.fromProject(project);
  const scalarBinding = binding('entry', { value: entry });
  assert.equal((await scalar.specialize(artifact([scalarBinding]))).check, '40/40');
  await optimize(scalar);
  measure('entry scalar + speed', image(scalar));

  const p = Program.fromProject(project);
  const facts = artifact([scalarBinding, binding('code', inputs.code)]);
  const rejected = Program.fromProject(project);
  await assert.rejects(rejected.specialize(facts, { maxVariants: 1 }), /block budget/);
  assert.equal(rejected.rev, 0);
  assert.deepEqual(rejected.assumptions, {});
  const specialized = await p.specialize(facts);
  assert.equal(specialized.check, '40/40');
  const stateBlocks = Object.keys(p.head.value.blocks).length;
  const stateStatements = Object.keys(p.head.value.stmts).length;
  const rewritten = Object.values(p.head.value.values);
  const foldedLoads = rewritten.filter(v => v.op === 'const' && p.origin.value.values[v.origin[0]?.from]?.op === 'load16u').length;
  const staticBranches = Object.values(p.head.value.stmts).filter(
    s => s.op === 'br' && p.origin.value.stmts[s.origin[0]?.from]?.op === 'br_if',
  ).length;
  measure('dispatch raw', image(p), example, { stateBlocks, stateStatements, foldedLoads, staticBranches });
  await optimize(p);
  const images = [['dispatch + speed', image(p), storeOf(p.head.value)]];
  if (process.argv.includes('--promote')) {
    const latePromotion = await p.apply(promoteFrame);
    if (!latePromotion.changed) console.error(`entry ${entry}: promotion after speed was inapplicable`);
    p.checkout(specialized.rev);
    await optimize(p, ['dce', 'cfg']);
    const promoted = await p.apply(promoteFrame);
    assert.equal(promoted.check, '40/40');
    await optimize(p);
    images.push(['dispatch + promotion + speed', image(p), storeOf(p.head.value)]);
  }
  if (process.argv.includes('--listing')) console.error(p.listing('runVm'));
  for (const [stage, img, store] of images) {
    let cases = 0;
    for (let n = inputs.n[0]; n <= inputs.n[1]; n++) {
      for (let seed = inputs.seed[0]; seed <= inputs.seed[1]; seed++) {
        const c = benchCase(base, 'runVm', { code: inputs.code, entry, n, seed });
        const before = runner(generalImage, c);
        const evalBefore = evaluate(base, c.fn, c.args, c.memory);
        const after = runner(img, c);
        const evalAfter = evaluate(store, c.fn, c.args, c.memory);
        const handwritten = runner(handImage, benchCase(storeOf(hand.head.value), handName, { n, seed }));
        assert.equal(handwritten.result, before.result);
        assert.equal(evalBefore.result, before.result);
        for (const got of [after, evalAfter]) {
          assert.equal(got.limit, false);
          assert.equal(got.trap, false);
          assert.ok(!got.fault);
          assert.equal(got.result, before.result);
          assert.deepEqual(got.bytes, c.memory);
        }
        cases++;
      }
    }
    measure(stage, img, example, { cases, blocks: store.fn('runVm').blocks.length });
  }
  measure('hand speed', handImage, benchCase(storeOf(hand.head.value), handName, { n: 12, seed: 8 }));
}
console.log(JSON.stringify(rows, null, 2));
