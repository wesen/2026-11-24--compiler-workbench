#!/usr/bin/env node
// IRWB-056-B probe 02: does the derivation compute the correspondence the domains computed before it, and what does
// it record? Runs every corpus project through its pipeline the way the baselines do (gate on), then, per revision:
//  (a) correspondenceFromDerivation(steps) === makeCorrespondence(revisionCorrespondence(...)) — the whole
//      correspondence, entry for entry, under coverage 'partial' and 'source';
//  (b) edit records that cite a rule (R3's count: 0 before this step, 183 under O2);
//  (c) the two locality policies over the same records (R3: A0 203 and G 395 local edits of O2).
// usage: node 02-derivation-equals-today.mjs [O2,speed]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { PIPELINES, revisionCorrespondence } = await import(root + 'dist/typed/passes.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { correspondenceFromDerivation, locality, validateDerivation } = await import(
  root + 'dist/framework/ir/derivation.js'
);
const { canonical } = await import(root + 'dist/framework/core/data.js');
const { makeCorrespondence } = await import(root + 'dist/framework/ir/correspondence.js');

const pipelines = (process.argv[2] ?? 'O2,speed').split(',');
const diffs = [],
  rejections = [];
const tally = {};
let applications = 0,
  records = 0,
  citing = 0,
  steps = 0,
  ruleSteps = 0;
for (const pipeline of pipelines) tally[pipeline] = { records: 0, citing: 0, local: {}, steps: 0 };
for (const id of projectIds())
  for (const pipeline of pipelines) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    const run = await p.pipeline(pipeline);
    for (const step of run.steps) if (step.rejected) rejections.push(`${id} ${pipeline} ${step.pass}: ${step.rejected}`);
    for (const r of p.revisions.slice(1)) {
      applications++;
      const c = r.correspondence,
        source = new Set(c.sourceEntities);
      // (a) the correspondence from the derivation, against the one revisionCorrespondence gives today
      const today = makeCorrespondence(
        c.from,
        c.to,
        c.sourceEntities,
        c.targetEntities,
        revisionCorrespondence(p.revisions[r.rev - 1].artifact.value, r.artifact.value, r.edits),
      );
      if (canonical(today) !== canonical(c))
        diffs.push(`${id} ${pipeline} ${r.pass}: the derivation's correspondence differs from today's`);
      for (const coverage of ['partial', 'source', 'target', 'both']) {
        let again;
        try {
          again = correspondenceFromDerivation(r.derivation, c.from, c.to, c.sourceEntities, c.targetEntities, {
            coverage,
          });
        } catch (e) {
          diffs.push(`${id} ${pipeline} ${r.pass}: coverage ${coverage}: ${e.message}`);
          continue;
        }
        if (canonical(again) !== canonical(c))
          diffs.push(`${id} ${pipeline} ${r.pass}: coverage ${coverage} gives another correspondence`);
      }
      try {
        validateDerivation(r.derivation, c.sourceEntities, c.targetEntities);
      } catch (e) {
        diffs.push(`${id} ${pipeline} ${r.pass}: ${e.message}`);
      }
      // (b) and (c)
      for (const edit of r.edits) {
        records++;
        tally[pipeline].records++;
        const cited = (edit.steps ?? []).map(i => r.derivation.steps[i]);
        if (cited.some(s => s && 'rule' in s.by)) {
          citing++;
          tally[pipeline].citing++;
        }
        if (edit.kind !== 'replace' || !cited.length) continue;
        for (const policy of ['scoped', 'in-place']) {
          const local = cited.every(s => locality(s, source, policy) === 'local');
          const key = `${policy}`;
          tally[pipeline].local[key] = (tally[pipeline].local[key] ?? 0) + (local ? 1 : 0);
        }
      }
      steps += r.derivation.steps.length;
      ruleSteps += r.derivation.steps.filter(s => 'rule' in s.by).length;
      tally[pipeline].steps += r.derivation.steps.length;
    }
  }
console.log(
  `applications ${applications}, edit records ${records}, citing a rule ${citing}, steps ${steps} (${ruleSteps} from a rule)`,
);
for (const [pipeline, t] of Object.entries(tally))
  console.log(
    `${pipeline}: records ${t.records}, citing a rule ${t.citing}, steps ${t.steps}, local: ${JSON.stringify(t.local)}`,
  );
console.log(
  diffs.length
    ? `DIFFERENCES (${diffs.length}):\n${diffs.slice(0, 20).join('\n')}`
    : 'no differences: the derivation computes the same correspondence as revisionCorrespondence on every revision',
);
if (rejections.length) console.log(`REJECTED APPLICATIONS (${rejections.length}):\n${rejections.slice(0, 10).join('\n')}`);
