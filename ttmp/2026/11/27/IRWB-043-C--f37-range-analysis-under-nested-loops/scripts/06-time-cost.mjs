// Probe: where does the time of the F37 shape go? Times each pass of `speed` up to `strength` on chess-search and
// the ranges fact of chessPseudoMoves (with its iteration count), so a slowdown can be told from pre-existing cost.
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const t0 = Date.now();
const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
console.log(`load ${Date.now() - t0}ms`);
for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength'))) {
  const t = Date.now();
  await p.apply(pass, { count: 3 });
  console.log(`${pass} ${Date.now() - t}ms`);
}
const t = Date.now();
const r = (await p.fact('ranges', 'chessPseudoMoves')).value;
console.log(`fact ranges ${Date.now() - t}ms, rounds ${r.rounds}, iterations ${r.iterations}, loop heads ${r.loopHeads.length}`);
