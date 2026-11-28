#!/usr/bin/env node
// IRWB-056-B probe 03, the decision point: what does recording derivations cost the O2 corpus?
//  (a) the corpus under O2, best of five runs, with the derivations on (today's build);
//  (b) the same with the pass's steps thrown away (`noDerivation`, a copy of each pass whose prepare returns no
//      derivation, so the runner computes the correspondence as it did before) — the same code otherwise;
//  (c) the share of (a) spent computing the correspondence the old way (`revisionCorrespondence` + completion).
// usage: node 03-cost.mjs [O2]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { PASSES, PIPELINES, revisionCorrespondence } = await import(root + 'dist/typed/passes.js');
const { applyTransformation } = await import(root + 'dist/framework/passes/transformation.js');
const { makeCorrespondence } = await import(root + 'dist/framework/ir/correspondence.js');
const { entityIdSet } = await import(root + 'dist/typed/ir.js');
const pipeline = process.argv[2] ?? 'O2';

/** A copy of the pass that returns its native value only: the runner fills the correspondence from the projections. */
const withoutDerivation = pass => ({
  ...pass,
  prepare: ctx => {
    const r = pass.prepare(ctx);
    if (!r || !r.derivation) return r;
    const { derivation, ...rest } = r;
    return { ...rest, correspondence: revisionCorrespondence(ctx.before.value, r.native, r.report?.edits ?? []) };
  },
});

/** One corpus run: every project through its pipeline, gated as the baselines are. */
async function corpus(prepare) {
  const t = performance.now();
  let applications = 0;
  for (const id of projectIds()) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    if (!prepare) {
      await p.pipeline(pipeline);
      applications += p.revisions.length - 1;
      continue;
    }
    const src = projectSource(id, projectFiles(id));
    const { optimizationContract } = await import(root + 'dist/typed/passes.js');
    const contract = optimizationContract({ inputs: src.meta.inputs, count: 40, seed: 7 });
    let head = p.head;
    for (const name of PIPELINES[pipeline]) {
      const r = await applyTransformation(prepare(PASSES[name]), head, {
        manager: p.manager,
        ensures: [contract],
        inputs: { origin: p.origin },
      });
      if (r.changed) {
        head = r.artifact;
        applications++;
      }
    }
  }
  return { ms: performance.now() - t, applications };
}
const best = async (f, n = 5) => {
  let out;
  for (let i = 0; i < n; i++) {
    const r = await f();
    if (!out || r.ms < out.ms) out = r;
  }
  return out;
};

const withSteps = await best(() => corpus(null));
const without = await best(() => corpus(withoutDerivation));

// (c) the correspondence the old way, on every revision of one run
let correspondenceMs = 0,
  revisions = 0;
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  await p.pipeline(pipeline);
  for (const r of p.revisions.slice(1)) {
    const t = performance.now();
    const ids = entityIdSet(r.artifact.value);
    makeCorrespondence(
      r.correspondence.from,
      r.correspondence.to,
      r.correspondence.sourceEntities,
      r.correspondence.targetEntities,
      revisionCorrespondence(p.revisions[r.rev - 1].artifact.value, r.artifact.value, r.edits),
    );
    void ids;
    correspondenceMs += performance.now() - t;
    revisions++;
  }
}
console.log(`${pipeline} corpus, best of 5:`);
console.log(`  as built (one derivation per application): ${withSteps.ms.toFixed(0)} ms, ${withSteps.applications} applications`);
console.log(`  with the steps discarded (correspondence from origins as before): ${without.ms.toFixed(0)} ms, ${without.applications} applications`);
console.log(`  ratio: ${(withSteps.ms / without.ms).toFixed(2)}x`);
console.log(
  `  today's correspondence (revisionCorrespondence + completion) over ${revisions} revisions: ${correspondenceMs.toFixed(0)} ms = ${(100 * correspondenceMs / withSteps.ms).toFixed(1)} % of the run`,
);
