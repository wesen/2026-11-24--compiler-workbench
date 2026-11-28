#!/usr/bin/env node
// IRWB-056-B probe 01, run on the base commit (before any change): (a) how long the O2 corpus takes today, so the
// decision point ("more than about 2x today's correspondence computation") has a number; (b) what today's
// correspondence actually says about a `simplify` edit; (c) simplify's and fold's edit records and rule firings.
// usage: node 01-today-timing-and-shape.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { revisionCorrespondence } = await import(root + 'dist/typed/passes.js');
const { search } = await import(root + 'dist/typed/search.js').catch(() => ({}));

// (a) the whole corpus under O2, three runs, the best kept
const t0 = performance.now();
let edits = 0,
  applications = 0;
let best = Infinity;
for (let run = 0; run < 3; run++) {
  const t = performance.now();
  edits = 0;
  applications = 0;
  for (const id of projectIds()) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    await p.pipeline('O2');
    for (const r of p.revisions.slice(1)) {
      edits += r.edits.length;
      applications++;
    }
  }
  best = Math.min(best, performance.now() - t);
}
console.log(`(a) O2 corpus: ${projectIds().length} projects, ${applications} applications, ${edits} edit records, ${best.toFixed(0)} ms (best of 3)`);

// (b) what the correspondence of one simplify edit says
{
  const { meaningKept } = await import(root + 'dist/typed/evaluate.js');
  const { Program: P, PASSES } = await import(root + 'dist/typed/program.js');
  const src = `function f(x: i32): i32 {\n  return (x * 1) + 0;\n}`;
  const p = new P('probe', src);
  await p.apply('simplify', { check: false });
  const r = p.revisions.at(-1);
  console.log('(b) edits:', JSON.stringify(r.edits));
  console.log('    entries:', JSON.stringify(r.correspondence.entries));
  console.log('    before values:', Object.keys(p.revisions.at(-2).artifact.value.values).join(' '));
  console.log('    after  values:', Object.keys(r.artifact.value.values).join(' '));
  console.log('    originson after:', JSON.stringify(Object.values(r.artifact.value.values).map(v => [v.id, v.origin])));
}

// (c) rule firings against edit records, per pass, on the corpus
{
  const { tableBody } = await import(root + 'dist/typed/rules/compile.js');
  const { FOLD_RULES } = await import(root + 'dist/typed/rules/fold.js');
  const { SIMPLIFY_RULES } = await import(root + 'dist/typed/rules/simplify.js');
  const { IDENTITY_RULES } = await import(root + 'dist/typed/rules/identities.js');
  const { typedPass, simplify, fold } = await import(root + 'dist/typed/passes.js');
  const counts = {};
  for (const [name, base, rules] of [
    ['simplify', simplify, SIMPLIFY_RULES],
    ['fold', fold, FOLD_RULES],
  ]) {
    const firings = new Map();
    const pass = typedPass({ ...base.typed, body: tableBody(rules.rules, firings) });
    let records = 0;
    const perProject = {};
    for (const id of projectIds()) {
      const p = Program.fromProject(projectSource(id, projectFiles(id)));
      if (p.status !== 'ok') continue;
      const before = p.head;
      const out = await (await import(root + 'dist/framework/passes/transformation.js')).applyTransformation(pass, before, { manager: p.manager });
      if (out.changed) {
        records += out.edits;
        perProject[id] = out.edits;
      }
    }
    counts[name] = { records, firings: [...firings.values()].reduce((a, b) => a + b, 0), byRule: Object.fromEntries(firings), perProject };
  }
  console.log('(c) records vs firings on the first O2 application of each pass (no pipeline):');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k}: ${v.records} records, ${v.firings} firings`, JSON.stringify(v.byRule));
}
console.log(`total ${(performance.now() - t0).toFixed(0)} ms`);
