// The corpus under a pipeline and backend options: every project's head lowered with the options, run on 100
// generated cases per function against the evaluator of r0 (the meaning), with emulator instructions summed over
// the decided cases and image bytes; rejected pass applications are listed.
//   node 05-corpus-options.mjs [--pipeline O2] [--options '{"layout":"loops"}'] [--base O2] [--json out.json]
// --base: a second pipeline and default options to compare with, per project (instructions over the same cases).
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const B = await import(root + 'dist/typed/backend/index.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { casesFrom, evaluate, agrees } = await import(root + 'dist/typed/evaluate.js');
const { writeFileSync } = await import('node:fs');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const pipeArg = arg('--pipeline', 'O2'),
  pipeline = pipeArg.startsWith('[') ? JSON.parse(pipeArg) : pipeArg,
  options = JSON.parse(arg('--options', '{}')),
  base = arg('--base', null);

async function measure(id, pipe, opts) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  const t0 = performance.now();
  const run = await p.pipeline(pipe);
  const ms = Math.round(performance.now() - t0);
  const image = B.lowerToImage(p.head, opts).image;
  // the image against r0's evaluator directly: the passes and the backend in one comparison
  const st0 = storeOf(p.origin.value);
  let instructions = 0,
    agree = 0,
    decided = 0,
    inconclusive = 0,
    disagree = 0;
  for (const fn of p.fns())
    for (const k of casesFrom(st0, fn, { count: 100, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const e = evaluate(st0, fn, k.args, k.memory, { limit: 2e4 });
      const r = B.runImage(image, fn, k.args, k.memory, { limit: 2e5 });
      if (e.limit || r.limit) {
        inconclusive++;
        continue;
      }
      decided++;
      instructions += r.steps;
      if (agrees(e, r)) agree++;
      else disagree++;
    }
  const rejected = run.steps.filter(s => s.rejected).map(s => `${s.pass}: ${s.rejected}`);
  return { id, revs: p.rev, ms, bytes: image.value.bytes, instructions, agree, decided, inconclusive, disagree, rejected };
}

const rows = [];
for (const id of projectIds()) {
  const row = await measure(id, pipeline, options);
  if (base) row.base = await measure(id, base, {});
  rows.push(row);
  const d = row.base ? ` base ${row.base.instructions} (${row.instructions - row.base.instructions >= 0 ? '+' : ''}${row.instructions - row.base.instructions}) bytes ${row.base.bytes}` : '';
  console.log(
    `${id.padEnd(22)} r${row.revs} ${String(row.instructions).padStart(8)} instr ${String(row.bytes).padStart(5)} B  ${row.agree}/${row.decided}${row.disagree ? ` DISAGREE ${row.disagree}` : ''}${row.rejected.length ? ` REJECTED ${row.rejected.join('; ')}` : ''}${d}`,
  );
}
const sum = k => rows.reduce((s, r) => s + r[k], 0);
const total = { instructions: sum('instructions'), bytes: sum('bytes'), agree: sum('agree'), decided: sum('decided'), inconclusive: sum('inconclusive'), disagree: sum('disagree'), rejected: rows.flatMap(r => r.rejected.map(x => `${r.id}: ${x}`)) };
if (base) {
  total.base = { instructions: rows.reduce((s, r) => s + r.base.instructions, 0), bytes: rows.reduce((s, r) => s + r.base.bytes, 0) };
  total.faster = rows.filter(r => r.instructions < r.base.instructions).length;
  total.slower = rows.filter(r => r.instructions > r.base.instructions).map(r => `${r.id} +${r.instructions - r.base.instructions}`);
}
console.log(JSON.stringify({ pipeline, options, ...total }));
if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ pipeline, options, base, total, rows }, null, 1));
