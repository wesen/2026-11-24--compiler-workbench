// Probe: which strength edits the more precise ranges add in chess-search under speed (the baseline census
// moved strength 58 -> 60, guards 4 -> 2). Prints the `why` of every strength edit.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
await p.pipeline('speed');
for (const r of p.revisions)
  if (r.pass === 'strength')
    for (const e of r.edits ?? []) console.log(r.rev, e.because?.join(' | '));
for (const r of p.revisions)
  if (r.pass === 'guards')
    for (const e of r.edits ?? []) console.log('guards', r.rev, e.because?.join(' | '));
