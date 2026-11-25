// Strategy experiment over the corpus: O2, the best of four pass orderings per program, and per-function search
// over the same four, by emulator instructions on 10 seeded cases per function. node tools/search-experiment.mjs
import { installVendor } from './node-vendor.mjs';
import { projectIds, projectFiles } from './corpus.mjs';
await installVendor();
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const S = await import('../dist/typed/strategies.js');
const { PIPELINES } = await import('../dist/typed/passes.js');
const O2 = PIPELINES.O2;
const candidates = {
  O2: 'O2',
  O2x2: [...O2, ...O2],
  'loops+O2': [...PIPELINES.loops, ...O2],
  'O2+more': [...O2, 'lvn', 'subst', 'subst', 'dce', 'cfg', 'licm', 'subst', 'dce', 'cfg'],
};
const rows = [];
const total = { o2: 0, program: 0, fn: 0, o2Bytes: 0, programBytes: 0, fnBytes: 0 };
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id)), t0 = Date.now();
  const a = Program.fromProject(ps);
  await a.pipeline('O2');
  const o2 = S.measure(a, a.head);
  const b = Program.fromProject(ps);
  const rb = await S.runStrategy(b, S.choosePlan('per-program', candidates, { metric: 'instructions' }));
  const prog = S.measure(b, b.head);
  const c = Program.fromProject(ps);
  const rc = await S.runStrategy(c, S.searchPlan('per-function', c.fns(), candidates));
  const fn = S.measure(c, c.head);
  const ok = [a, b, c].every(p => p.check({ count: 40 }).status !== 'disagree');
  rows.push({ id, o2: o2.instructions, program: prog.instructions, fn: fn.instructions, bytes: [o2.bytes, prog.bytes, fn.bytes], status: [rb.status, rc.status], ok, ms: Date.now() - t0 });
  total.o2 += o2.instructions; total.program += prog.instructions; total.fn += fn.instructions;
  total.o2Bytes += o2.bytes; total.programBytes += prog.bytes; total.fnBytes += fn.bytes;
  console.error(`${id.padEnd(18)} O2 ${o2.instructions}  per-program ${prog.instructions}  per-function ${fn.instructions}  ${ok ? '' : 'CHECK FAILED'}`);
}
const pct = (x, y) => `${(100 * (1 - x / y)).toFixed(2)}%`;
console.log(JSON.stringify({
  projects: rows.length,
  fasterPerProgram: rows.filter(r => r.program < r.o2).length,
  fasterPerFunction: rows.filter(r => r.fn < r.o2).length,
  fnBeatsProgram: rows.filter(r => r.fn < r.program).length,
  programBeatsFn: rows.filter(r => r.program < r.fn).length,
  totals: total,
  perProgramGain: pct(total.program, total.o2),
  perFunctionGain: pct(total.fn, total.o2),
  allChecksAgree: rows.every(r => r.ok),
  rows,
}, null, 1));
