// Probe: two chess shapes the after-table still shows. (1) chessAttacked: `chessOnBoard_t2 = ((at & 15) < 8);
// goto J` where J was not threaded: what is J? (2) chessPseudoMoves: `dense / 8` with dense a loop counter from 0
// to 63: why did strength not make it a shift? Prints the blocks and the range of dense before strength.
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
const show = (fn, re, around = 6) => {
  const lines = listing(storeOf(p.head.value), fn).split('\n');
  lines.forEach((l, i) => re.test(l) && console.log(lines.slice(Math.max(0, i - around), i + around).join('\n') + '\n   ...'));
};
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength') + 1)) {
  if (pass === 'strength') {
    console.log('--- before strength, chessPseudoMoves');
    show('chessPseudoMoves', /dense \/ 8/, 8);
    const st = storeOf(p.head.value), f = st.fn('chessPseudoMoves');
    const ranges = (await p.fact('ranges', 'chessPseudoMoves')).value;
    const dense = String(f.locals.findIndex(l => l.name === 'dense'));
    for (const b of ['bb:chessPseudoMoves.1', 'bb:chessPseudoMoves.3'])
      console.log(b, 'dense in', JSON.stringify(ranges.in[b]?.[dense]), 'out', JSON.stringify(ranges.out[b]?.[dense]));
    console.log('assignments to dense:', f.blocks.flatMap(b => b.stmts).map(s => st.get(s)).filter(s => s.op === 'set' && String(s.local) === dense).map(s => s.id).join(' '));
  }
  await p.apply(pass, { count: 3 });
}

