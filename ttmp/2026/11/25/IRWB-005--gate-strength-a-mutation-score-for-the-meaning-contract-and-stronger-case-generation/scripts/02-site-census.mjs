// Census before design: per corpus project, after its pipeline, how many candidate mutation sites of each family
// exist, and what one 40-case meaning check of the head against r0 costs. Read-only; prints one line per project.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/02-site-census.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { meaningKept } = await import(root + 'dist/typed/evaluate.js');

const CMP = new Set(['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu']);
const NONCOMM = new Set(['sub', 'div', 'rem', 'shl', 'shr', 'shru', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu']);
const SHIFT = new Set(['shl', 'shr', 'shru']);
const TRAPPING = new Set(['div', 'rem', 'load', 'load16u', 'caddr', 'call']);
const tot = {};
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  if (p.status !== 'ok') { console.log(id, p.status); continue; }
  await p.pipeline(JSON.parse(projectFiles(id)['project.json']).pipeline ?? 'O2');
  const v = p.head.value, c = {};
  const inc = k => ((c[k] = (c[k] || 0) + 1), (tot[k] = (tot[k] || 0) + 1));
  for (const x of Object.values(v.values)) {
    if (x.op === 'const' && !x.type) inc('const');
    if (CMP.has(x.op)) inc('cmp');
    if (NONCOMM.has(x.op)) inc('noncomm');
    if (SHIFT.has(x.op)) inc('shift');
    if (TRAPPING.has(x.op)) inc('trapping');
    if (x.op === 'caddr') inc('caddr');
    if (x.type === 'f32') inc('f32');
  }
  for (const s of Object.values(v.stmts)) {
    if (s.op === 'store') inc('store');
    if (s.op === 'br_if' && v.blocks[s.then]?.stmts.length && v.stmts[v.blocks[s.then].stmts[0]]?.op === 'trap') inc('check');
  }
  const t0 = performance.now();
  const ev = (await p.manager.checkInvariant(meaningKept({ inputs: p.inputs, count: 40, seed: 7 }), { origin: p.origin, candidate: p.head })).evidence;
  const ms = performance.now() - t0;
  console.log(id.padEnd(16), `r${p.rev}`, `fns ${p.fns().length}`, JSON.stringify(c), `check40 ${ev.agree}/${ev.total} ${ms.toFixed(1)} ms`);
}
console.log('total', JSON.stringify(tot));
