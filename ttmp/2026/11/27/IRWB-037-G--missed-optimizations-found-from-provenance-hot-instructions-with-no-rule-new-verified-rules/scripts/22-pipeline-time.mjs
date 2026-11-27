// What the longer `speed` list costs to run: wall time of the checked pipeline (5 cases per function per pass)
// for the old list and the new one, and the revisions each makes. The machine is shared, so read the ratio.
// usage: node 22-pipeline-time.mjs [id...]
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles } from '../../../../../../tools/corpus.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const NEW = ['thread', 'copies', 'guards', 'identities'];
const S = PIPELINES.speed, OLD = S.filter(n => !NEW.includes(n)).map(n => (n === 'subst-mem' ? 'subst' : n));
const ids = process.argv.slice(2);
for (const id of ids.length ? ids : ['regex-nfa', 'lz-roundtrip', 'sha-chacha', 'chess-search']) {
  const ps = projectSource(id, projectFiles(id));
  const row = {};
  for (const [name, list] of [['old', OLD], ['new', S], ['old again', OLD], ['new again', S]]) {
    const p = Program.fromProject(ps);
    const t = performance.now();
    let changed = 0;
    for (const pass of list) if ((await p.apply(pass, { count: 5 })).changed) changed++;
    row[name] = `${Math.round(performance.now() - t)} ms, ${changed} of ${list.length} passes changed the program`;
  }
  console.log(id, JSON.stringify(row, null, 1));
}
