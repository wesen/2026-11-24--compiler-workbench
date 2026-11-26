// Inspection aid for classifying a surviving mutant by hand: print a function of a project's pipeline head
// (the base the corpus run mutates) and, for each matching site, the mutant's listing as a line diff.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/15-show-mutant.mjs <project> <fn> [operator] [variant] [text-substring]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { ANALYSES, liveView } = await import(root + 'dist/typed/analyses.js');
const { listing } = await import(root + 'dist/typed/listing.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const M = await import(root + 'dist/typed/mutate.js');
const [id, fn, op, variant, text] = process.argv.slice(2);
const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
await p.pipeline(ps.meta.pipeline ?? 'O2');
const st = storeOf(p.head.value), live = (await p.manager.analyse(ANALYSES.liveness, p.head)).value;
const base = listing(st, fn).split('\n');
console.log(`== ${id}.${fn} at r${p.rev} (spec ${JSON.stringify(p.inputs[fn] ?? {})})`);
console.log(base.join('\n'));
const sites = M.mutationSites(st, { fns: [fn], live: f => liveView(live, st, f) }).filter(
  s => (!op || s.operator === op) && (!variant || s.variant === variant) && (!text || s.text.includes(text)),
);
for (const site of sites) {
  const m = (await applyPass(M.mutantPass, p.head, { manager: p.manager, params: { site } })).artifact;
  const lines = listing(storeOf(m.value), fn).split('\n');
  console.log(`-- ${site.operator} ${site.variant} ${JSON.stringify(site.text)}`);
  for (let i = 0; i < Math.max(lines.length, base.length); i++)
    if (lines[i] !== base[i]) console.log(`   - ${base[i] ?? ''}\n   + ${lines[i] ?? ''}`);
}
