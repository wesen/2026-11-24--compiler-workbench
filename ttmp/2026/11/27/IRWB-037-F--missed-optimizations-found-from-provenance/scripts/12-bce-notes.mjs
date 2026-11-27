// Which bce cases fire on the corpus: run a pass list on every project and count bce's replacements by the note of
// the new branch (`already proved` is the dominating-branch case; `already checked x + c` the dominating check with
// an offset; `already checked x` without). usage: node 12-bce-notes.mjs [passes a,b,c]
const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
const { projectIds, projectFiles } = await import(new URL('tools/corpus.mjs', root));
await installVendor();
const { Program } = await import(new URL('dist/typed/program.js', root));
const { projectSource } = await import(new URL('dist/typed/project.js', root));
const passes = (process.argv[2] ?? 'inline,inline,cfg,fold,simplify,constprop,fold,simplify,dce,cfg,licm,lvn,strength,bce').split(',');
const count = {};
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') continue;
  await p.pipeline(passes, { count: 3 });
  for (const r of p.revisions.filter(r => r.pass === 'bce'))
    for (const e of r.edits.filter(e => e.kind === 'replaceStmt')) {
      const note = p.lookup(e.to).entity.origin[0].note ?? '';
      const kind = /already proved .* < length/.test(note) ? (/\+/.test(note) ? 'branch, offset' : 'branch') : /checked \S+ \+ /.test(note) ? 'check, offset' : 'check';
      (count[kind] ??= []).push(`${id}:${e.fn}`);
    }
}
for (const [k, v] of Object.entries(count)) console.log(k.padEnd(16), v.length, [...new Set(v)].join(' '));
