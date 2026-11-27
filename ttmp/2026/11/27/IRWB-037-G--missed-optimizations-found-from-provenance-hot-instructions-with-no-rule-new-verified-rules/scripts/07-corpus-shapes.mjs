// hotShapes over the whole corpus (10 seeded cases per function, seed 7, as `measure`), summed per shape, plus the
// simplify and fold rule firings of the pipeline: which rules fire at all, and the hot patterns no pass touched.
// usage: node 07-corpus-shapes.mjs out.json [--pipeline speed] [--depth 2] [id...]
import { writeFileSync } from 'node:fs';
import { projectIds, projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor();
const D = '../../../../../../dist/';
const { Program } = await import(D + 'typed/program.js');
const { projectSource } = await import(D + 'typed/project.js');
const { storeOf } = await import(D + 'typed/ir.js');
const { casesFrom, evaluate } = await import(D + 'typed/evaluate.js');
const { hotShapes } = await import(D + 'typed/missed.js');
const { PIPELINES } = await import(D + 'typed/passes.js');
const R = await import(D + 'typed/rules/passes.js');
const { SIMPLIFY_RULES } = await import(D + 'typed/rules/simplify.js');
const { FOLD_RULES } = await import(D + 'typed/rules/fold.js');

const argv = process.argv.slice(2);
const pipeline = argv.includes('--pipeline') ? argv[argv.indexOf('--pipeline') + 1] : 'speed';
const [out, ...only] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pipeline');
const firings = new Map();
const counting = { simplify: R.tablePass('simplify', firings), fold: R.tablePass('fold', firings) };
const sum = { statements: new Map(), nodes: new Map() };
let total = 0, untouched = 0;
for (const id of only.length ? only : projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const p = Program.fromProject(ps);
  if (p.status !== 'ok') continue;
  for (const pass of PIPELINES[pipeline]) {
    try { await p.apply(counting[pass] ?? pass, { count: 5 }); }
    catch (e) { if (e.code !== 'contractRejected') throw e; }
  }
  const st = storeOf(p.origin.value), calls = [];
  for (const fn of p.head.value.fnOrder)
    for (const c of casesFrom(st, fn, { count: 10, seed: 7, inputs: p.inputs[fn] ?? {} })) {
      const r = evaluate(st, c.fn, c.args, c.memory, { limit: 2e4 });
      if (!r.trap && !r.limit) calls.push(c);
    }
  let h;
  try { h = hotShapes(p.head, calls, { rules: [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules] }); }
  catch (e) { console.log(id, 'skipped:', e.message); continue; }
  total += h.total;
  for (const k of ['statements', 'nodes'])
    for (const r of h[k]) {
      let a = sum[k].get(r.shape);
      if (!a) sum[k].set(r.shape, (a = { shape: r.shape, instructions: 0, untouched: 0, sites: 0, projects: [], rules: r.rules, example: r.example, exampleIn: id }));
      a.instructions += r.instructions; a.untouched += r.untouched; a.sites += r.sites; a.projects.push(id);
      if (r.example.instructions > a.example.instructions) { a.example = r.example; a.exampleIn = id; }
      if (k === 'statements') untouched += r.untouched;
    }
  console.log(id.padEnd(20), h.total);
}
const rows = k => [...sum[k].values()].sort((a, b) => b.instructions - a.instructions);
const fired = Object.fromEntries([...firings].sort((a, b) => b[1] - a[1]));
const silent = [...SIMPLIFY_RULES.rules].filter(r => !firings.has(r.name)).map(r => r.name);
writeFileSync(out, JSON.stringify({ pipeline, total, untouched, fired, silentSimplify: silent, statements: rows('statements'), nodes: rows('nodes') }, null, 1) + '\n');
console.log(`\n${pipeline}: ${total} instructions, ${untouched} untouched (${(100 * untouched / total).toFixed(1)}%)`);
console.log(`simplify rules that never fire: ${silent.length} of ${SIMPLIFY_RULES.rules.length}: ${silent.join(' ')}`);
console.log('fired:', JSON.stringify(fired));
console.log('\n   instr untouched sites proj rules  node pattern');
for (const r of rows('nodes').slice(0, 45))
  console.log(`${String(r.instructions).padStart(8)} ${String(r.untouched).padStart(9)} ${String(r.sites).padStart(5)} ${String(r.projects.length).padStart(4)} ${String(r.rules ?? '').padStart(5)}  ${r.shape.padEnd(28)} ${r.exampleIn}: ${r.example.text.slice(0, 70)}`);
