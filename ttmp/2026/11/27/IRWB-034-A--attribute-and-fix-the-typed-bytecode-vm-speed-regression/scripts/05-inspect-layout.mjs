// git show 0fd67e5:src/typed/passes.ts | node <this file>
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { loopsOf } from '../../../../../../dist/typed/analyses.js';
import { lowerToImage, runImage, variantChoices } from '../../../../../../dist/typed/backend/index.js';
import { casesFrom } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { PIPELINES } from '../../../../../../dist/typed/passes.js';
import { Program } from '../../../../../../dist/typed/program.js';
import { projectSource } from '../../../../../../dist/typed/project.js';

await installVendor();
const oldModule = new URL('../../../../../../dist/typed/irwb034a-original-passes.js', import.meta.url);
const source = readFileSync(0, 'utf8');
writeFileSync(oldModule, ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText);
let oldLicm;
try {
  ({ licm: oldLicm } = await import(oldModule.href));
} finally {
  unlinkSync(oldModule);
}

const id = process.argv[2] ?? 'regex-nfa';
const project = projectSource(id, projectFiles(id));
const configs = {
  default: {},
  chains: { chains: true },
  coalesce: { coalesce: true },
  homes: { homes: true },
  chainsCoalesce: { chains: true, coalesce: true },
  extras: { chains: true, coalesce: true, homes: true },
};

for (const phase of ['before', 'after', 'without LICM']) {
  const p = Program.fromProject(project);
  const store = storeOf(p.origin.value);
  const cases = (project.meta.entries ?? p.fns()).flatMap(fn =>
    casesFrom(store, fn, { inputs: p.inputs[fn], count: 100, seed: 7 }),
  );
  for (const pass of PIPELINES.O2) {
    if (pass === 'licm' && phase === 'without LICM') continue;
    await p.apply(pass === 'licm' && phase === 'before' ? oldLicm : pass);
  }
  const licm = p.revisions.findIndex(r => r.pass === 'licm');
  for (const r of licm < 0 ? [p.revisions.at(-1)] : [p.revisions[licm - 1], p.revisions[licm], p.revisions.at(-1)]) {
    const st = storeOf(r.artifact.value);
    const shapes = [...st.fns.values()].flatMap(f => {
      const heads = new Map();
      for (const loop of loopsOf(st, f)) {
        heads.set(loop.head, (heads.get(loop.head) ?? 0) + 1);
      }
      return [...heads];
    });
    const kinds = {};
    for (const e of r.edits) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    console.log(JSON.stringify({ phase, rev: r.rev, pass: r.pass, shapes, kinds }));
    for (const [name, options] of Object.entries(configs)) {
      const { image } = lowerToImage(r.artifact, options);
      const choices = variantChoices(r.artifact, options);
      const reasons = {};
      let steps = 0;
      for (const c of cases) {
        const run = runImage(image, c.fn, c.args, c.memory);
        steps += run.steps;
        for (const i of image.value.insns) {
          const count = run.counts[i.offset / 4];
          if (!count) continue;
          const reason = i.why ?? i.op;
          reasons[reason] = (reasons[reason] ?? 0) + count;
        }
      }
      console.log(JSON.stringify({ phase, rev: r.rev, pass: r.pass, name, steps, choices, reasons }));
    }
  }
}
