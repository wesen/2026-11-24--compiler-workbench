// Probe: why does chessPseudoMoves' `dense` (a loop counter from 0 to 63) lose its lower bound before `strength`?
// Prints the blocks of chessPseudoMoves after the passes before strength, the loop heads the solver found, and the
// range fact for `dense` at every block's in and out.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { listing } = await import(D + 'typed/listing.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
  await p.apply(pass, { count: 3 });
const st = storeOf(p.head.value),
  f = st.fn('chessPseudoMoves');
console.log('passes before strength:', PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')).join(' '));
console.log(listing(st, 'chessPseudoMoves'));
const ranges = (await p.fact('ranges', 'chessPseudoMoves')).value;
const dense = String(f.locals.findIndex(l => l.name === 'dense'));
console.log('dense local =', dense);
for (const b of f.blocks)
  console.log(
    b.id,
    'preds', JSON.stringify(b.preds ?? []),
    'succ', JSON.stringify(b.succ ?? []),
    'dense in', JSON.stringify(ranges.in[b.id]?.[dense]),
    'out', JSON.stringify(ranges.out[b.id]?.[dense]),
  );
