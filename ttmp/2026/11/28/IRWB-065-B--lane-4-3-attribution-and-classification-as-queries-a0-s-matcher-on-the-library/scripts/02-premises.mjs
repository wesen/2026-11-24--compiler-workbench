// What the cited premises of each O2 `replace` edit are made of: guards, facts, entities of the input revision, or
// entities this application made (and whether a statement or a value). The evidence IRWB-065-B settles the in-place
// policy with: which premises the two `fold-add` edits cite, and what licm's and lvn's premises are.
// usage: node 02-premises.mjs [--pass p] [--verbose]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';

await installVendor();
const ROOT = new URL('../../../../../../', import.meta.url).href;
const { Program } = await import(ROOT + 'dist/typed/program.js');
const { projectSource } = await import(ROOT + 'dist/typed/project.js');

const argv = process.argv.slice(2);
const opt = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const only = opt('--pass');
const verbose = argv.includes('--verbose');

const kindOf = id => (/^([a-z]+):/.exec(id) ?? [])[1] ?? '?';

const rows = [];
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  await p.pipeline('O2');
  for (const r of p.revisions.slice(1)) {
    const input = new Set(r.correspondence.sourceEntities);
    const madeByStep = new Map(); // entity -> the steps that produced it
    for (const [i, s] of r.derivation.steps.entries())
      for (const p2 of s.produces) madeByStep.set(p2, [...(madeByStep.get(p2) ?? []), i]);
    for (const e of r.edits) {
      if (e.kind !== 'replace') continue;
      if (only && e.pass !== only) continue;
      const steps = (e.steps ?? []).map(i => [i, r.derivation.steps[i]]);
      if (!steps.length) continue;
      const premises = [];
      for (const [i, s] of steps)
        for (const pr of s.premises) {
          if (pr.startsWith('guard:')) premises.push({ pr, what: 'guard' });
          else if (pr.startsWith('fact:')) premises.push({ pr, what: 'fact' });
          else if (input.has(pr)) premises.push({ pr, what: `input ${kindOf(pr)}` });
          else
            premises.push({
              pr,
              what: `made ${kindOf(pr)} by ${(madeByStep.get(pr) ?? [])
                .map(j => JSON.stringify(r.derivation.steps[j].by))
                .join('|')}`,
            });
        }
      rows.push({ id, rev: r.rev, pass: e.pass, edit: e.id, by: steps.map(([, s]) => s.by), premises });
    }
  }
}

const tally = new Map();
for (const row of rows) {
  const kinds = [...new Set(row.premises.map(p => p.what))].sort();
  for (const k of kinds) {
    const key = `${row.pass.padEnd(9)} ${k}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
}
console.log('premise kinds per edit (an edit counts once per kind it cites):');
for (const [k, n] of [...tally].sort()) console.log(`${String(n).padStart(5)}  ${k}`);
console.log(`\n${rows.length} replace edits citing steps`);
if (verbose) {
  console.log('\nedits citing an entity this application made (not a rebuild):');
  for (const row of rows) {
    const odd = row.premises.filter(p => p.what.startsWith('made') && !p.what.includes('"rebuild"'));
    if (!odd.length) continue;
    console.log(
      `${row.id} r${row.rev} ${row.edit} ${row.pass}: by ${row.by.map(b => JSON.stringify(b)).join(', ')}\n    ${odd
        .map(p => p.what + ' ' + p.pr)
        .join('\n    ')}`,
    );
  }
}
