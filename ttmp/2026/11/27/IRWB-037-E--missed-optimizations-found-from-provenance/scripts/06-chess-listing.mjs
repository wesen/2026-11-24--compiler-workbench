// The listing of one function of the chess project at the head of speed (tuned options measured separately).
import { projectAllFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { listing } = await import(D + 'typed/listing.js');
const ps = projectSource('chess-search', projectAllFiles('chess-search'));
const p = Program.fromProject(ps);
await p.pipeline('speed', { count: 5 });
const st = storeOf(p.head.value);
const fn = process.argv[2] ?? 'chessPseudoMoves';
console.log(listing(storeOf(p.head.value), fn).split('\n').filter(l => {
  const m = /^(bb:|s:)/.exec(l.trim());
  return true;
}).join('\n'));
