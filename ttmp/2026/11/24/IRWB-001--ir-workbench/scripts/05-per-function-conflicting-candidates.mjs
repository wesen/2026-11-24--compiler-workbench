const root = '/home/manuel/code/wesen/2026-11-24--compiler-workbench';
const { installVendor } = await import(root + '/tools/node-vendor.mjs'); await installVendor();
const { projectIds, projectFiles } = await import(root + '/tools/corpus.mjs');
const { Program } = await import(root + '/dist/typed/program.js');
const { projectSource } = await import(root + '/dist/typed/project.js');
const S = await import(root + '/dist/typed/strategies.js');
const { PIPELINES } = await import(root + '/dist/typed/passes.js');
const cands = { O1: 'O1', O2: 'O2', loops: 'loops', 'O2-licm': PIPELINES.O2.filter(x => x !== 'licm') };
let t = { prog: 0, fn: 0 }, rows = [];
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  if (Program.fromProject(ps).fns().length < 2) continue;
  const b = Program.fromProject(ps); await S.runStrategy(b, S.choosePlan('p', cands, { metric: 'instructions' }));
  const c = Program.fromProject(ps); const rc = await S.runStrategy(c, S.searchPlan('f', c.fns(), cands));
  const mb = S.measure(b, b.head).instructions, mc = S.measure(c, c.head).instructions;
  t.prog += mb; t.fn += mc;
  const winners = rc.decisions.map(d => `${d.nodeId.replace('choose:', '')}=${d.winner}`).join(' ');
  rows.push(`${id.padEnd(16)} per-program ${mb}  per-function ${mc}  ${mc < mb ? 'FN WINS' : mc > mb ? 'prog wins' : ''}  ${winners}`);
  console.error(rows.at(-1));
}
console.log(rows.join('\n')); console.log(JSON.stringify(t));
