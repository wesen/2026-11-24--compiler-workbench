// IRWB-004: the meaning contract's full evidence on every corpus project, pass by pass through O2, as Program.apply
// checks it (40 cases per function, seed 7, the project's inputs and entries, against r0). One line per project: its
// id, the head revision, the summed counts, and a SHA-256 of the JSON of every step's evidence (counts, status and
// counterexamples, in order). Two builds, or reuse on and off, must print identical lines.
//   [IRWB_ROOT=<build root>/] [IRWB_REUSE=0] node …/08-corpus-evidence.mjs [--only id,id]
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const C = await import(root + 'dist/framework/contracts/index.js');
const { createHash } = await import('node:crypto');
if (process.env.IRWB_REUSE === '0') {
  if (!C.setDifferentialReuse) throw new Error('this build has no setDifferentialReuse');
  C.setDifferentialReuse(false);
}
const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const t0 = performance.now();
for (const id of projectIds()) {
  if (only && !only.has(id)) continue;
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  const contract = optimizationContract({
    inputs: p.inputs,
    count: 40,
    seed: 7,
    ...(p.options.entries ? { roots: p.options.entries } : {}),
  });
  let cur = p.head;
  const evidence = [];
  const sum = [0, 0, 0, 0];
  for (const name of PIPELINES.O2) {
    let r;
    try {
      r = await applyPass(PASSES[name], cur, { manager: p.manager, contract, contractInputs: { origin: p.origin } });
    } catch (e) {
      evidence.push({ pass: name, rejected: String(e.message).split('\n')[0] });
      continue;
    }
    const checks = (r.contract?.execution?.checks ?? []).map(c => ({ phase: c.phase, ok: c.ok, evidence: c.evidence ?? null }));
    for (const c of checks)
      if (c.evidence?.method === 'sampled') {
        sum[0] += c.evidence.total;
        sum[1] += c.evidence.agree;
        sum[2] += c.evidence.disagree;
        sum[3] += c.evidence.inconclusive;
      }
    evidence.push({ pass: name, changed: r.changed, revision: r.artifact.revision, checks });
    cur = r.artifact;
  }
  const digest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 16);
  console.log(id, cur.revision.slice(0, 12), sum.join('/'), digest);
}
process.stderr.write(`total ${Math.round(performance.now() - t0)} ms\n`);
