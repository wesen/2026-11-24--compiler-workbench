// Run from this worktree after npm run build. Each measurement lowers exactly one function.
import assert from 'node:assert/strict';
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { benchCase } = await import('../../../../../../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../../../../../../dist/typed/backend/index.js');
const { BindingsIR } = await import('../../../../../../dist/typed/specialize.js');
const { createArtifact } = await import('../../../../../../dist/framework/contracts/index.js');

const project = projectSource('bytecode-vm', projectAllFiles('bytecode-vm'));
const inputs = project.meta.inputs.runVm;
const general = Program.fromProject(project);
function image(p) {
  return lowerToImage(p.head, { coalesce: true }).image;
}
function measure(img, c) {
  const r = runImage(img, c.fn, c.args, c.memory, { counts: false });
  assert.equal(r.trap, false);
  assert.equal(r.limit, false);
  assert.ok(!r.fault);
  assert.deepEqual(r.bytes, c.memory);
  return { instructions: r.steps, bytes: img.value.bytes, result: r.result };
}
const base = image(general);
const checked = async (p, strategy) => {
  const result = await p.pipeline(strategy);
  for (const step of result.steps) {
    assert.ok(!step.rejected, JSON.stringify(step));
    if (step.changed) assert.equal(step.check, '40/40');
  }
};
const bodies = [
  'let a = 0; let b = seed; for (let remaining = n; remaining > 0; remaining = remaining - 1) { const next = a + b; a = b; b = next; } return a;',
  'let h = seed; for (let remaining = n; remaining > 0; remaining = remaining - 1) { h = h * 33 + remaining; } return h;',
];
for (const [index, entry] of inputs.entry.oneOf.entries()) {
  const vm = Program.fromProject(project);
  const art = createArtifact(BindingsIR, 'fixture', { formatVersion: 1, source: 'bytecode-vm', bindings: [
    { fn: 'runVm', param: 'entry', value: entry, entity: 'entry/' + entry },
    { fn: 'runVm', param: 'code', value: inputs.code, entity: 'code' },
  ] });
  const call = (n, seed) => benchCase(storeOf(general.head.value), 'runVm', { code: inputs.code, entry, n, seed });
  const c = call(12, 8);
  const before = measure(base, c);
  const onlyEntry = Program.fromProject(project);
  const scalarFact = createArtifact(BindingsIR, 'entry', {
    ...art.value, bindings: [art.value.bindings[0]],
  });
  assert.equal((await onlyEntry.specialize(scalarFact)).check, '40/40');
  const onlyEntryResult = measure(image(onlyEntry), c);
  const spec = await vm.specialize(art);
  assert.equal(spec.check, '40/40');
  const raw = measure(image(vm), c);
  await checked(vm, 'speed');
  let candidate = image(vm);
  const after = measure(candidate, c);
  const speedRevision = vm.rev;
  let copies = 0;
  while (true) {
    const step = await vm.apply('subst');
    if (!step.changed) break;
    assert.equal(step.check, '40/40');
    copies += step.edits;
  }
  const afterCopies = measure(image(vm), c);
  let splitResult, substitutions;
  if (process.argv.includes('--split')) {
    vm.checkout(speedRevision);
    const { splitRanges } = await import('./04-split-ranges.mjs');
    substitutions = await splitRanges(vm);
    await checked(vm, 'speed');
    candidate = image(vm);
    splitResult = measure(candidate, c);
  }
  console.log(vm.listing());
  const hand = Program.fromProject(projectSource('hand', {
    'main.typed': 'function hand(n:i32, seed:i32):i32 {' + bodies[index] + '}',
    'project.json': JSON.stringify({ inputs: { hand: { n: inputs.n, seed: inputs.seed } } }),
  }));
  await checked(hand, 'speed');
  const handImage = image(hand);
  if (splitResult) {
    for (const [name, img] of [['residual', candidate], ['hand', handImage]]) {
      console.log(name, img.value.insns.map(i => i.text).join(' | '));
    }
  }
  const scalar = measure(handImage, benchCase(storeOf(hand.head.value), 'hand', { n: 12, seed: 8 }));
  assert.equal(after.result, scalar.result);
  let calls = 0;
  for (let n = 0; n <= 12; n++) for (let seed = -8; seed <= 8; seed++) {
    const test = call(n, seed);
    assert.equal(measure(candidate, test).result, measure(base, test).result);
    calls++;
  }
  console.log(JSON.stringify({ entry, states: spec.kinds.block, before, onlyEntryResult, raw, after, copies, afterCopies, substitutions, splitResult, hand: scalar, calls,
    gapClosed: (before.instructions - (splitResult ?? after).instructions) / (before.instructions - scalar.instructions) }));
}
