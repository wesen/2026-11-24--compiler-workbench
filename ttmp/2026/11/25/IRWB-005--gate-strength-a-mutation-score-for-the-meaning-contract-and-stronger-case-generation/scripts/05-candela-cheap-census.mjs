// Which Candela functions are cheap enough to mutate? For every function: r0's steps on its 40 default gate cases
// (limit 2e4, Candela's check inputs), inconclusive count, |affected| (itself and every function reaching it), and
// whether every affected function is cheap too ("closed"). Prints a summary and writes JSON.
//   node --max-old-space-size=12288 ttmp/2026/11/25/IRWB-005--*/scripts/05-candela-cheap-census.mjs <out.json> [maxSteps]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { casesFrom, evaluate } = await import(root + 'dist/typed/evaluate.js');
const M = await import(root + 'dist/typed/mutate.js');
const out = process.argv[2], maxSteps = +(process.argv[3] ?? 2000);
let t = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const inputs = candelaInputs(st);
console.error(`ingest ${Math.round(performance.now() - t)} ms, ${st.fns.size} functions`);
t = performance.now();
const rows = {};
for (const f of st.fns.values()) {
  const cases = casesFrom(st, f.name, { count: 40, seed: 7, inputs: inputs[f.name] ?? {} });
  let steps = 0, max = 0, limited = 0;
  for (const c of cases) {
    const r = evaluate(st, f.name, c.args, c.memory, { limit: 2e4 });
    steps += r.steps; max = Math.max(max, r.steps); if (r.limit) limited++;
  }
  const f32 = [...f.blocks].some(b => b.stmts.some(s => JSON.stringify(st.get(s)).includes('"type":"f32"')));
  rows[f.name] = { mean: Math.round(steps / 40), max, limited, blocks: f.blocks.length };
}
console.error(`r0 on 40 cases per function: ${Math.round(performance.now() - t)} ms`);
const cheap = n => rows[n].limited === 0 && rows[n].max <= maxSteps;
for (const n of Object.keys(rows)) {
  const A = M.affected(st, n);
  rows[n].affected = A.length;
  rows[n].closed = A.every(cheap);
}
const closed = Object.keys(rows).filter(n => rows[n].closed);
console.log(JSON.stringify({ functions: st.fns.size, cheap: Object.keys(rows).filter(cheap).length, closed: closed.length, maxSteps, limitedFns: Object.keys(rows).filter(n => rows[n].limited).map(n => [n, rows[n].limited]) }));
if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(rows, null, 1));
