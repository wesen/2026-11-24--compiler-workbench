// A pass must be applicable to any revision: run a second lvn (before rotate, as the F38 test does) over every
// corpus project's speed pipeline, and an extra lvn after the first one in O2, and report any throw or rejected
// step, plus the instruction delta (must never be more instructions than without the second lvn).
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const { projectIds, projectFiles } = await import('../../../../../../tools/corpus.mjs');
const { measure } = await import(D + 'typed/strategies.js');
const insertLvn = (pipe, at) => {
  const list = [...PIPELINES[pipe]];
  list.splice(at === 'before rotate' ? list.indexOf('rotate') : list.indexOf('lvn') + 1, 0, 'lvn');
  return list;
};
let thrown = 0, rejected = 0, slower = 0, faster = 0;
for (const id of projectIds()) {
  for (const [pipe, at] of [['speed', 'before rotate'], ['O2', 'after lvn']]) {
    const plain = Program.fromProject(projectSource(id, projectFiles(id)));
    await plain.pipeline(pipe, { count: 3 });
    const twice = Program.fromProject(projectSource(id, projectFiles(id)));
    let run;
    try {
      run = await twice.pipeline(insertLvn(pipe, at), { count: 3 });
    } catch (e) {
      thrown++;
      console.log(`THROWN ${id} ${pipe} ${at}: ${String(e.message).split('\n')[0]}`);
      continue;
    }
    const bad = run.steps.filter(s => s.rejected).map(s => s.pass);
    if (bad.length) { rejected++; console.log(`REJECTED ${id} ${pipe} ${at}: ${bad.join(',')}`); }
    const m = p => measure(p, p.artifact(), { count: 10, seed: 7 }).instructions;
    const d = m(twice) - m(plain);
    if (d > 0) { slower++; console.log(`SLOWER ${id} ${pipe} ${at}: +${d}`); }
    else if (d < 0) faster++;
  }
}
console.log(`projects x pipelines run, thrown=${thrown} rejected=${rejected} slower=${slower} faster=${faster}`);
