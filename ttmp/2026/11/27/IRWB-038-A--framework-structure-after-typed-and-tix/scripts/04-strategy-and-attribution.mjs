import './02-source-loader.mjs';
import assert from 'node:assert/strict';

const root = new URL('../../../../../../', import.meta.url);
const source = path => import(new URL(path, root));

const { compileTix, optimizeTix } = await source('src/tensor/index.ts');
const { inlinePass, splitPass } = await source('src/tensor/passes.ts');
const { meaningGate } = await source('src/tensor/contract.ts');
const { applyNativePassSync } = await source('src/framework/passes/define-pass.ts');
const S = await source('src/framework/strategy/index.ts');
const program = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
const definitions = [
  { pass: inlinePass, relation: 'exact' },
  { pass: splitPass, relation: 'tolerance' },
];
const plan = S.plan('038-a-tix', S.chooseBest(
  'choose',
  S.fork('alternatives', definitions.map(({ pass }, index) => ({
    name: pass.id,
    strategy: S.apply('candidate-' + index, S.algorithm(pass.id)),
  }))),
  { metric: 'statements', direction: 'min' },
  { metrics: S.algorithm('size') },
));
const registry = new S.AlgorithmRegistry();
for (const { pass, relation } of definitions) {
  registry.register({
    id: pass.id, version: '1', kind: 'transform', description: pass.description,
    run: (_ctx, current) => applyNativePassSync(pass, current, meaningGate(program.origin, relation)).artifact,
  });
}
registry.register({
  id: 'size', version: '1', kind: 'metrics', description: 'Tix statement count',
  run: (_ctx, a) => ({ statements: a.value.functions[0].statements.length }),
});
const result = await S.execute(plan, registry, program.current);
assert.equal(result.value.revision, optimizeTix(program, ['inline']).program.current.revision);
console.log('stock strategy fork/chooseBest with native Tix callbacks: inline chosen');

const cells = [
  ['t6-fa-irwb-033-e', 'executeSync', /does not run chooseBest/],
  ['t6-ds-x-irwb-033-h', 'runPlanSync', /chooseBest.*asynchronous interpreter/],
];
for (const [tree, entry, reason] of cells) {
  const runners = await source('../' + tree + '/src/framework/strategy/sync.ts');
  assert.throws(() => runners[entry](plan, registry, program.current), reason);
  console.log(tree + ': rejected chooseBest');
}

const { loadVendorFile } = await source('tools/node-vendor.mjs');
for (const path of [
  'compiler/typed/tape.js', 'compiler/typed/typed-wasm.js', 'bench/host/rv32-interp.js',
]) loadVendorFile(path);
const { setVendor } = await source('src/typed/vendor.ts');
setVendor({
  typedTape: globalThis.typedTape,
  typedWasm: globalThis.typedWasm,
  typedRv32Interp: globalThis.typedRv32Interp,
});
const { Program } = await source('src/typed/program.ts');
const { projectSource } = await source('src/typed/project.ts');
const { storeOf } = await source('src/typed/ir.ts');
const { benchCase } = await source('src/typed/evaluate.ts');
const { attributeSteps } = await source('src/typed/attribute.ts');

const fixture = `
  function steps(n: i32, k: i32): i32 {
    let acc = 0;
    let i = 0;
    while (true) {
      if (i >= n) {
        break;
      } else if ((i & 1) === 0) {
        acc = acc + k * 3;
        i = i + 1;
      } else {
        acc = acc - k * 5;
        i = i + 1;
      }
    }
    return acc;
  }
`;
const open = () => Program.fromProject(projectSource('038-a-two-latches', {
  'main.typed': fixture,
  'project.json': JSON.stringify({ inputs: { steps: { n: [0, 30], k: [-9, 9] } } }),
}));
const cfgOnly = open();
await cfgOnly.apply('cfg');
const { value: loops } = await cfgOnly.fact('loops', 'steps');
assert.equal(loops.length, 1);
assert.equal(loops[0].latches.length, 2);
assert(loops[0].preheader && !loops[0].body.includes(loops[0].preheader));
const compiled = open();
const applied = await compiled.pipeline('O2');
assert.equal(applied.steps.filter(step => step.rejected).length, 0);
const call = benchCase(storeOf(compiled.origin.value), 'steps', { n: 20, k: 7 });
const attribution = attributeSteps(compiled.revisions, call);
const { totals, rows } = attribution;
for (const [index, after] of totals.entries()) {
  if (!index) continue;
  const totalDelta = after.instructions - totals[index - 1].instructions;
  assert.equal(rows.filter(row => row.rev === after.rev).reduce((n, row) => n + row.delta, 0), totalDelta);
}
const licm = totals.findIndex(step => step.pass === 'licm');
assert(totals[licm].instructions < totals[licm - 1].instructions);
console.log('Typed:', JSON.stringify({
  loops: loops.length, latches: loops[0].latches.length, initial: totals[0].instructions,
  final: totals.at(-1).instructions,
  licmDelta: totals[licm].instructions - totals[licm - 1].instructions,
}));
