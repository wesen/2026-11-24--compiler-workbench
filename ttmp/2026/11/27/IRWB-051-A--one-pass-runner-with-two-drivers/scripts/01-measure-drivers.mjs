import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../../../../', import.meta.url);
const load = file => import(new URL(file, root));
const { installVendor } = await load('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await load('tools/corpus.mjs');
const { AnalysisManager } = await load('dist/framework/contracts/index.js');
const { applyNativePassSync, applyPass, applyTransformation, applyTransformationSync } = await load(
  'dist/framework/passes/index.js',
);
const { meaningGate } = await load('dist/tensor/contract.js');
const { compileTix } = await load('dist/tensor/index.js');
const { inlinePass, inlineTransformation } = await load('dist/tensor/passes.js');
const { constprop, constpropTransformation, optimizationContract } = await load('dist/typed/passes.js');
const { Program } = await load('dist/typed/program.js');
const { projectSource } = await load('dist/typed/project.js');

const read = path => readFileSync(new URL(path, root), 'utf8');

// Use process CPU time to set the batch length on a shared host. A 30 ms batch
// amortizes the clock's microsecond granularity. Run two complete rotations after
// warm-up so every mode leads twice, then report the median and observed range.
async function measure(title, modes) {
  const values = modes.map(() => []);
  for (let round = -modes.length; round < modes.length * 2; round++)
    for (let i = 0; i < modes.length; i++) {
      const index = (round + i + modes.length) % modes.length;
      const [name, make] = modes[index];
      const apply = make(new AnalysisManager());
      const isAsync = name.endsWith('async');
      const start = performance.now();
      const cpuStart = process.cpuUsage();
      let iterations = 0;
      let cpuMs;
      do {
        const result = isAsync ? await apply() : apply();
        assert.equal(result.changed, true);
        iterations++;
        const usage = process.cpuUsage(cpuStart);
        cpuMs = (usage.user + usage.system) / 1000;
      } while (cpuMs < 30);
      if (round >= 0)
        values[index].push({ wall: (performance.now() - start) / iterations, cpu: cpuMs / iterations });
    }
  console.log(title);
  for (const [index, [name]] of modes.entries()) {
    console.log(`  ${name}`);
    for (const clock of ['cpu', 'wall']) {
      const sorted = values[index].map(value => value[clock]).sort((a, b) => a - b);
      const center = sorted.length / 2;
      const median = (sorted[center - 1] + sorted[center]) / 2;
      console.log(`    ${clock}: ${median.toFixed(3)} ms/app [${sorted.map(v => v.toFixed(3)).join(', ')}]`);
    }
  }
}

const { origin } = compileTix(read('corpus/tensor/attention/main.tix'));
const gate = meaningGate(origin, inlinePass.relation);
const accept = () => ({ ok: true });
for (const [label, candidateGate, tx] of [
  [
    'coordinator timing gate',
    accept,
    {
      ...inlineTransformation,
      obligations: { ...inlineTransformation.obligations, ensures: accept },
    },
  ],
  ['sampled meaning gate', gate, inlineTransformation],
]) {
  await measure(`Tix attention (${label})`, [
    ['legacy sync', () => () => applyNativePassSync(inlinePass, origin, candidateGate)],
    ['prototype sync', manager => () => applyTransformationSync(tx, origin, { manager, origin })],
    ['prototype async', manager => () => applyTransformation(tx, origin, { manager, origin })],
  ]);
}

assert.ok(projectIds().includes('constants'));
const program = Program.fromProject(projectSource('constants', projectFiles('constants')));
assert.equal(program.status, 'ok');
const before = program.artifact();
const meaning = { inputs: program.inputs, roots: program.options.entries };
const tx = constpropTransformation(meaning);
const contract = optimizationContract(meaning);
const options = { origin: before, auditPreservation: true };
await measure('Typed constants (sampled meaning, audit all preservation claims)', [
  [
    'legacy async',
    manager => () =>
      applyPass(constprop, before, {
        ...options,
        manager,
        contract,
        contractInputs: { origin: before },
      }),
  ],
  ['prototype sync', manager => () => applyTransformationSync(tx, before, { ...options, manager })],
  ['prototype async', manager => () => applyTransformation(tx, before, { ...options, manager })],
]);

const source = read('src/framework/contracts/analysis-manager.ts');
const body = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const loc = text => text.split('\n').filter(line => line.trim() && !line.trim().startsWith('/**')).length;
console.log('Nonblank source lines, including signatures and closing braces');
console.log('  analyseSync entry:', loc(body('  analyseSync<', '  private analyseInternal<')));
console.log(
  '  analyse/analysisWork shared lifecycle:',
  loc(body('  private *analysisWork<', '  hasAnalysis<')),
);
console.log('  preserveSync entry:', loc(body('  preserveSync<', '  private preserveInternal<')));
console.log(
  '  preserve/preservationWork shared lifecycle:',
  loc(body('  private *preservationWork<', '  async evaluateObjective<')),
);
console.log('  shared effect driver:', loc(read('src/framework/contracts/effect-driver.ts')));
