import './02-source-loader.mjs';
import assert from 'node:assert/strict';

const root = new URL('../../../../../../', import.meta.url);
const source = (path, tree = '') => import(new URL(tree ? '../' + tree + '/' + path : path, root));
const { loadVendorFile } = await source('tools/node-vendor.mjs');
for (const path of [
  'compiler/typed/tape.js', 'compiler/typed/typed-wasm.js', 'bench/host/rv32-interp.js',
]) loadVendorFile(path);
const { projectFiles } = await source('tools/corpus.mjs');

async function loadTyped(tree = '') {
  const typed = path => source('src/typed/' + path, tree);
  const { setVendor } = await typed('vendor.ts');
  setVendor({
    typedTape: globalThis.typedTape,
    typedWasm: globalThis.typedWasm,
    typedRv32Interp: globalThis.typedRv32Interp,
  });
  const { Program } = await typed('program.ts');
  const { projectSource } = await typed('project.ts');
  return {
    typed,
    open: name => Program.fromProject(projectSource(name, projectFiles(name))),
  };
}

const { open } = await loadTyped();
const blend = open('blend');
const pipeline = await blend.pipeline('O2');
assert(!pipeline.steps.some(step => step.rejected));
const index = blend.revisions.findIndex(revision => revision.pass === 'constprop');
assert(index > 0);
const prior = blend.revisions[index - 1].artifact.value;
const { pass, artifact, correspondence, edits } = blend.revisions[index];
const { classifyEdits } = await source('src/typed/edit-classification.ts', 'a0-sm-irwb-035-a');
const { classifyApplication } = await source('src/typed/edit-classes.ts', 'a0-fa-irwb-035-g');
const a0A = classifyEdits(prior, artifact.value, correspondence, edits);
const a0G = classifyApplication({ pass, before: prior, after: artifact.value, edits });
assert.deepEqual(a0A.map(edit => edit.classification), ['other']);
assert.deepEqual(a0G.map(edit => [edit.class, edit.sub]), [['local', 'fact']]);
console.log('same constprop event: A0-A says other; A0-G says local/fact');

const treeA = 'b1-sm-irwb-036-a';
const a = await loadTyped(treeA);
const pA = a.open('bytecode-vm');
const { BindingsIR: bindingsA } = await a.typed('specialize.ts');
const { cells } = pA.inputs.runVm.code;
const { createArtifact: createA } = await source('src/framework/contracts/index.ts', treeA);
const factset = (entries) => ({
  formatVersion: 1, source: '038-a',
  bindings: [
    { fn: 'runVm', param: 'code', cells, entity: 'code' },
    { fn: 'runVm', param: 'entry', ...entries, entity: 'entry' },
  ],
});
await assert.rejects(
  pA.specialize(createA(bindingsA, 'facts', factset({ value: 0 })), { maxVariants: 1 }),
  /block budget/,
);
assert.equal(pA.rev, 0);
assert.deepEqual(pA.assumptions, {});

const treeG = 'b1-fa-irwb-036-g';
const g = await loadTyped(treeG);
const pG = g.open('bytecode-vm');
const { BindingsIR: bindingsG } = await g.typed('specialize.ts');
const { createArtifact: createG } = await source('src/framework/contracts/index.ts', treeG);
const facts = createG(bindingsG, 'facts', factset({ oneOf: [0] }));
const step = await pG.specializeBuffer(facts, { budget: 1 });
assert.equal(step.check, '40/40');
const edit = pG.revisions.flatMap(revision => revision.edits).find(edit => edit.kind === 'specialized');
assert.equal(edit.variants, 1);
assert(edit.overBudget > 0);
assert.match(pG.listing('runVm'), /caddr/);
console.log('one residual variant: B1-A refuses and preserves revision and assumptions; B1-G keeps a checked fallback');
