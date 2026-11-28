// The differential probe: the tools as they were at HEAD (the tree this ticket started from), bundled from git,
// against the tools as they are now, on the same revisions of every corpus program under O2 and speed.
// usage: node 06-differential.mjs [pipeline...]        (default: O2 speed; writes ../various/06-differential-<pipeline>.txt)
//
// The old tree is exported with `git archive HEAD src` and bundled with esbuild as one module (so the three old
// tools share the old tree's own vendor slot), and the old attribute.ts, missed.ts and edit-classes.ts then run
// against the same Program revisions the new ones do: only the tools differ.
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = execSync('git rev-parse --show-toplevel', { cwd: here }).toString().trim();
const old = mkdtempSync(join(tmpdir(), 'irwb065-old-'));
execSync(`git archive HEAD src | tar -x -C ${old}`, { cwd: root });
const esbuild = execSync('node -p "require.resolve(\'esbuild/package.json\')"', { cwd: root })
  .toString()
  .trim()
  .replace(/package\.json$/, 'bin/esbuild');
writeFileSync(
  join(old, 'src/old-tools.ts'),
  [
    "export * as attribute from './typed/attribute.js';",
    "export * as missed from './typed/missed.js';",
    "export * as editClasses from './typed/edit-classes.js';",
    "export { setVendor } from './typed/vendor.js';",
    '',
  ].join('\n'),
);
execSync(
  `${JSON.stringify(esbuild)} --bundle --format=esm --platform=node ${join(old, 'src/old-tools.ts')} --outfile=${join(old, 'old-tools.mjs')}`,
  { cwd: root, stdio: 'inherit' },
);

const { installVendor } = await import('../../../../../../tools/node-vendor.mjs');
const { projectIds, projectFiles } = await import('../../../../../../tools/corpus.mjs');
await installVendor();
const { Program } = await import('../../../../../../dist/typed/program.js');
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const { storeOf } = await import('../../../../../../dist/typed/ir.js');
const { casesFrom } = await import('../../../../../../dist/typed/evaluate.js');
const newAttribute = await import('../../../../../../dist/typed/attribute.js');
const newMissed = await import('../../../../../../dist/typed/missed.js');
const newEC = await import('../../../../../../dist/typed/edit-classes.js');
const oldTools = await import(`file://${join(old, 'old-tools.mjs')}`);
const oldAttribute = oldTools.attribute,
  oldMissed = oldTools.missed,
  oldEC = oldTools.editClasses;
// the bundled old emulator reads the vendor slot of its own bundled copy: install it there too
oldTools.setVendor({
  typedTape: globalThis.typedTape,
  typedWasm: globalThis.typedWasm,
  typedRv32Interp: globalThis.typedRv32Interp,
});
const { SIMPLIFY_RULES } = await import('../../../../../../dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import('../../../../../../dist/typed/rules/fold.js');

const pipelines = process.argv.slice(2).length ? process.argv.slice(2) : ['O2', 'speed'];
const rules = [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules];
const differences = [];
let comparisons = 0;

for (const pipeline of pipelines) {
  for (const id of projectIds()) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    const run = await p.pipeline(pipeline, { count: 5 });
    if (run.steps.some(s => s.rejected)) continue;
    const st = storeOf(p.origin.value);
    const calls = [];
    for (const fn of p.head.value.fnOrder.slice(0, 3))
      for (const c of casesFrom(st, fn, { count: 3, seed: 7, inputs: p.inputs[fn] ?? {} })) calls.push(c);
    if (!calls.length) continue;

    // D1: the same revisions, attributed by both tools
    for (const call of calls.slice(0, 2)) {
      try {
        const a = oldAttribute.attributeSteps(p.revisions, call, { backend: { coalesce: true } });
        const b = newAttribute.attributeSteps(p.revisions, call, { backend: { coalesce: true } });
        comparisons++;
        if (JSON.stringify(a) !== JSON.stringify(b))
          differences.push(`${id} ${pipeline} ${call.fn}: attributeSteps differs`);
      } catch (e) {
        if (!/did not finish/.test(e.message)) differences.push(`${id} ${pipeline} ${call.fn}: threw ${e.message}`);
      }
    }

    // D2: the same head, both provenance walks (calls that overrun the limit are skipped for both)
    const chain = p.revisions.slice(1).map(r => ({ pass: r.pass, correspondence: r.correspondence }));
    try {
      const ho = oldMissed.hotShapes(p.head, calls, { rules, limit: 2e4 });
      const hn = newMissed.hotShapes(p.head, calls, { chain, rules, limit: 2e4 });
      comparisons++;
      if (JSON.stringify(ho) !== JSON.stringify(hn))
        differences.push(
          `${id} ${pipeline}: hotShapes differs\n  old ${JSON.stringify(ho).slice(0, 400)}\n  new ${JSON.stringify(hn).slice(0, 400)}`,
        );
    } catch (e) {
      if (!/did not finish/.test(e.message)) throw e;
    }

    // A0: the same applications, classified by both tools
    for (let i = 1; i < p.revisions.length; i++) {
      const r = p.revisions[i];
      const app = {
        pass: r.pass,
        before: p.revisions[i - 1].artifact.value,
        after: r.artifact.value,
        edits: r.edits,
      };
      const a = oldEC.classifyApplication(app);
      const b = newEC.classifyApplication({ ...app, derivation: r.derivation });
      comparisons++;
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        const first = a.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(b[k]));
        differences.push(
          `${id} ${pipeline} r${r.rev} ${r.pass}: classifyApplication differs at ${a[first].id}\n  old ${JSON.stringify(a[first])}\n  new ${JSON.stringify(b[first])}`,
        );
      }
    }
  }
  const out = `${here}../various/06-differential-${pipeline}.txt`;
  writeFileSync(out, `${comparisons} comparisons, ${differences.length} differences\n\n${differences.join('\n\n')}\n`);
  console.log(`${pipeline}: ${comparisons} comparisons, ${differences.length} differences (see ${out})`);
}
if (differences.length) {
  console.log(differences.join('\n\n'));
  process.exitCode = 1;
}
