// IRWB-035-G measurement 02: classify every edit O2 and speed make on the corpus.
// Each project is run through Program.pipeline (the meaning gate on, so only accepted applications are counted);
// every revision is lowered with the default backend options; every edit record is classified by
// dist/typed/edit-classes.js and weighted by the instructions it affects. One JSON row per edit.
// `insns` counts the entities where the trees of a `replace` part; `insnsUpper` also the values rebuilt above them.
// usage: node 02-classify-corpus.mjs --json out.json [--projects a,b | --skip a,b] [--pipelines O2,speed]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { lowerToImage } = await import(root + 'dist/typed/backend/index.js');
const { classifyApplication, instructionWeights } = await import(root + 'dist/typed/edit-classes.js');
const { writeFileSync } = await import('node:fs');

const argv = process.argv.slice(2);
const opt = n => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
const skip = (opt('--skip') ?? '').split(',');
const ids = opt('--projects') ? opt('--projects').split(',') : projectIds().filter(id => !skip.includes(id));
const pipelines = (opt('--pipelines') ?? 'O2,speed').split(',');
const edits = [], applications = [], problems = [];
const t0 = performance.now();
for (const project of ids)
  for (const pipeline of pipelines) {
    const p = Program.fromProject(projectSource(project, projectFiles(project)));
    if (p.status !== 'ok') { problems.push(`${project}: ${p.status}`); break; }
    const run = await p.pipeline(pipeline);
    for (const s of run.steps) if (s.rejected) problems.push(`${project} ${pipeline} ${s.pass}: rejected`);
    const images = p.revisions.map(r => lowerToImage(r.artifact).image.value);
    for (let i = 1; i < p.revisions.length; i++) {
      const r = p.revisions[i], before = p.revisions[i - 1].artifact.value, after = r.artifact.value;
      const classified = classifyApplication({ pass: r.pass, before, after, edits: r.edits });
      const weights = instructionWeights(classified, images[i - 1], images[i]);
      const upper = instructionWeights(classified, images[i - 1], images[i], { rebuilt: true });
      // entities the diff changed that no edit claimed or rebuilt (a check on the attribution)
      const claimed = new Set(classified.flatMap(c => [...c.removed, ...c.added, ...(c.rebuilt ?? [])]));
      const gone = [...Object.keys(before.values), ...Object.keys(before.stmts)].filter(x => !(x in after.values) && !(x in after.stmts));
      const made = [...Object.keys(after.values), ...Object.keys(after.stmts)].filter(x => !(x in before.values) && !(x in before.stmts));
      applications.push({
        project, pipeline, rev: i, pass: r.pass, edits: r.edits.length,
        insnsBefore: images[i - 1].insns.length, insnsAfter: images[i].insns.length,
        changedEntities: gone.length + made.length,
        unclaimedEntities: [...gone, ...made].filter(x => !claimed.has(x)).length,
      });
      classified.forEach((c, k) =>
        edits.push({
          project, pipeline, rev: i, pass: c.pass, fn: c.fn, kind: c.kind, class: c.class, sub: c.sub,
          ...(c.rule ? { table: c.rule.table, fired: c.rule.fired, weakest: c.rule.weakest } : {}),
          ...(c.shape ? { shape: c.shape } : {}),
          removed: c.removed.length, added: c.added.length, rebuilt: c.rebuilt?.length ?? 0,
          insns: weights[k], insnsUpper: upper[k],
        }),
      );
    }
    console.error(`${project} ${pipeline}: r${p.rev}, ${Math.round((performance.now() - t0) / 1000)} s`);
  }
const out = { projects: ids, pipelines, ms: Math.round(performance.now() - t0), problems, applications, edits };
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(out) + '\n');
console.log(`${edits.length} edits, ${applications.length} applications, problems ${JSON.stringify(problems)}, ${out.ms} ms`);
