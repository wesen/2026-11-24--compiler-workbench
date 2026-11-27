// Which simplify rules fire on the corpus, under O2 and speed, before and after IRWB-037-E's two new rules.
// A counting simplify pass runs the same table with a Firings map; every other pass is the real checked one.
// usage: node 12-rule-firings.mjs [--before]     (before: simulate the old speed by dropping the post-strength simplify)
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { PASSES, PIPELINES, typedPass } = await import(D + 'typed/passes.js');
const { tableBody } = await import(D + 'typed/rules/compile.js');
const { SIMPLIFY_RULES } = await import(D + 'typed/rules/simplify.js');

const before = process.argv.includes('--before');
const firings = new Map();
const countSimplify = typedPass({
  ...PASSES.simplify.typed,
  name: 'simplify',
  about: 'the simplify table, counting rule firings',
  body: tableBody(SIMPLIFY_RULES.rules, firings),
});
const pipelines = before
  ? { O2: PIPELINES.O2, speed: PIPELINES.speed.filter((n, i, a) => !(n === 'simplify' && a[i - 1] === 'strength')) }
  : { O2: PIPELINES.O2, speed: PIPELINES.speed };
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  for (const pl of ['O2', 'speed']) {
    const p = Program.fromProject(ps);
    try {
      for (const name of pipelines[pl]) {
        const pass = name === 'simplify' ? countSimplify : PASSES[name];
        await p.apply(pass, { count: 5 });
      }
    } catch (e) {
      if (e.code !== 'contractRejected') throw e;
    }
  }
}
const rows = [...firings].sort((a, b) => b[1] - a[1]);
const never = SIMPLIFY_RULES.rules.filter(r => !firings.get(r.name)).map(r => r.name);
console.log(`fired: ${rows.map(([n, c]) => `${n}:${c}`).join(' ')}`);
console.log(`never fired (${never.length} of ${SIMPLIFY_RULES.rules.length}): ${never.join(', ')}`);
