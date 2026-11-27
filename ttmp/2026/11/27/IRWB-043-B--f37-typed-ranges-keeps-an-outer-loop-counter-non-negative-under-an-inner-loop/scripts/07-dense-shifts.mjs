// Probe: in chess-search after speed, where dense's division went: remaining ` / 8` divisions vs shift/mask
// rewrites (the two extra strength edits of the new baseline census).
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { listing } = await import(D + 'typed/listing.js');
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
await p.pipeline('speed');
const st = storeOf(p.head.value);
for (const f of st.fns.values()) {
  if (f.name !== 'chessPseudoMoves') continue;
  const text = listing(st, f.name);
  for (const l of text.split('\n'))
    if (/ >> 3 | & 7 | \/ 8 /.test(l)) console.log(f.name, l.trim());
}
// which strength edits mention dense (they carry their why in the value's note)
for (const r of p.revisions)
  if (r.pass === 'strength')
    for (const e of r.edits ?? [])
      if (JSON.stringify(e).includes('dense')) console.log(r.rev, JSON.stringify(e).slice(0, 220));
