// Probe the worktree LICM body against the already built compiler.
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { lowerToImage, runImage, variantChoices } from '../../../../../../dist/typed/backend/index.js';
import { benchCase, casesFrom } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { PIPELINES } from '../../../../../../dist/typed/passes.js';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';

await installVendor();
const source = new URL('../../../../../../src/typed/passes.ts', import.meta.url);
const module = new URL('../../../../../../dist/typed/irwb034a-licm-candidate.js', import.meta.url);
writeFileSync(module, ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText);
let licm;
try {
  ({ licm } = await import(module.href));
} finally {
  unlinkSync(module);
}

const configs = { default: {}, coalesce: { coalesce: true }, extras: { chains: true, coalesce: true, homes: true } };
for (const id of ['bytecode-vm', 'regex-nfa']) {
  const project = projectSource(id, projectFiles(id));
  for (const name of ['O2', 'speed']) {
    const p = Program.fromProject(project);
    const store = storeOf(p.origin.value);
    const cases = (project.meta.entries ?? p.fns()).flatMap(fn =>
      casesFrom(store, fn, { inputs: p.inputs[fn], count: 100, seed: 7 }),
    );
    if (id === 'bytecode-vm') {
      const input = p.inputs.runVm;
      for (const entry of input.entry.oneOf)
        cases.push(benchCase(store, 'runVm', { code: input.code, entry, n: 12, seed: 8 }));
    }
    for (const pass of PIPELINES[name]) await p.apply(pass === 'licm' ? licm : pass);
    for (const [config, options] of Object.entries(configs)) {
      const { image } = lowerToImage(p.head, options);
      const counts = cases.map(c => runImage(image, c.fn, c.args, c.memory).steps);
      const fixtures = id === 'bytecode-vm' ? counts.splice(-2) : [];
      console.log(JSON.stringify({ id, name, config, steps: counts.reduce((a, n) => a + n, 0), fixtures,
        choices: variantChoices(p.head, options) }));
    }
  }
}
