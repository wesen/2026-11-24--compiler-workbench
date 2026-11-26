// IRWB-004: one corpus project through O2 as Program.apply checks it, as a job for src/typed/parallel/job-pool.ts;
// returns the line 08-corpus-evidence.mjs prints for it (head revision, summed counts, SHA-256 of the evidence).
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES, optimizationContract } = await import(root + 'dist/typed/passes.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const { createHash } = await import('node:crypto');

export async function o2Evidence(id) {
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
  return `${id} ${cur.revision.slice(0, 12)} ${sum.join('/')} ${digest}`;
}
