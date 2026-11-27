// Instruction attribution for a corpus project: which pass decisions hold the executed RV32 instructions, and which
// decisions cost the difference against r0 (IRWB-034-D). The measurement is `src/typed/attribution.ts`; this is the
// command that prints it.
//
//   node tools/attribution.mjs bytecode-vm --case '{"code":{"cells":[...]},"entry":0,"n":12,"seed":8}'
//   node tools/attribution.mjs blend --fn blend --case '{"work":{"buffer":[40,40],"cell":[0,255]},"n":40,"a":3,"b":5}'
//   node tools/attribution.mjs chess-search --pipeline speed --json
//
// Options: --pipeline NAME (default: the project's), --fn NAME (default: the first function), --case JSON (the
// benchCase inputs; default: the first generated case), --top N (rows to print, default 12, 0 for all),
// --backend coalesce|homes|chains (comma separated), --json (the whole result as JSON).
import { installVendor } from './node-vendor.mjs';
import { projectFiles } from './corpus.mjs';

await installVendor();
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const { storeOf } = await import('../dist/typed/ir.js');
const { benchCase, casesFrom } = await import('../dist/typed/evaluate.js');
const { lowerToImage, runImage } = await import('../dist/typed/backend/index.js');
const A = await import('../dist/typed/attribution.js');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : fallback;
};
const id = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
if (!id) {
  console.error('usage: node tools/attribution.mjs <project> [--pipeline NAME] [--fn NAME] [--case JSON]');
  process.exit(2);
}
const json = opt('json', false) === true;
const top = Number(opt('top', 12));
const backend = {
  coalesce: true,
  ...(opt('backend') ? JSON.parse(`{"${String(opt('backend')).split(',').join('":true,"')}":true}`) : {}),
};

const project = projectSource(id, projectFiles(id));
const pipeline = opt('pipeline', project.meta.pipeline);
if (typeof pipeline !== 'string') throw new Error(`${id}: no pipeline in project.json; give --pipeline`);
const p = Program.fromProject(project);
const steps = await p.pipeline(pipeline, { count: opt('count', 10) });
const fn = opt('fn', p.fns()[0]);
const st0 = storeOf(p.origin.value);
const given = opt('case');
const call = given
  ? benchCase(st0, fn, JSON.parse(String(given)))
  : casesFrom(st0, fn, { count: 1, seed: 7, inputs: p.inputs[fn] ?? {} })[0];
if (!call) throw new Error(`${id}: no case for ${fn}; give --case`);

const chain = A.chainOf(p);
const lineage = A.lineageOf(chain);
const imageAt = at => lowerToImage(chain[at].artifact, backend).image;
const runAt = at => runImage(imageAt(at), fn, call.args, call.memory);
const at = chain.length - 1;
const base = runAt(0),
  head = runAt(at);
const a0 = A.attributeRun(lineage, 0, { image: imageAt(0), counts: base.counts });
const aN = A.attributeRun(lineage, at, { image: imageAt(at), counts: head.counts });
const deltas = A.deltaBetween(a0, aN);
const result = {
  project: id,
  pipeline,
  fn,
  args: call.args,
  revisions: chain.map(s => s.pass),
  changed: p
    .revisionList()
    .slice(1)
    .map(r => r.pass),
  rejected: steps.steps.filter(s => s.rejected).map(s => `${s.pass}: ${s.rejected}`),
  steps: { r0: base.steps, head: head.steps, delta: head.steps - base.steps },
  attribution: { total: aN.total, unattributed: aN.unattributed, byPass: aN.byPass, credits: aN.credits },
  deltas: { byPass: A.deltaByPass(deltas), rows: deltas },
  skips: chain
    .flatMap(s =>
      (s.edits ?? []).filter(e => e.kind === 'skip').map(e => ({ rev: s.rev, pass: s.pass, ...e })),
    )
    .filter(e => e.pass === 'licm'),
};
if (json) {
  console.log(JSON.stringify(result, null, 1));
  process.exit(0);
}
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `${id} / ${pipeline} / ${fn}${given ? '' : ' (first generated case)'} args ${JSON.stringify(call.args)}`,
);
console.log(
  `revisions: ${result.changed.join(' ')}${result.rejected.length ? ` (rejected: ${result.rejected.join('; ')})` : ''}`,
);
console.log(
  `instructions: r0 ${base.steps} -> head ${head.steps} (${head.steps - base.steps >= 0 ? '+' : ''}${head.steps - base.steps}); attributed ${aN.total}, unattributed ${aN.unattributed}`,
);
console.log(
  `\ninstructions by the pass that made each statement: ${aN.byPass.map(r => `${r.pass} ${r.insns}`).join(', ')}`,
);
console.log(`\nlargest credits at the head (statement, pass, r0 roots, note):`);
for (const c of aN.credits.slice(0, top || aN.credits.length))
  console.log(
    `  ${String(c.insns).padStart(6)}  ${pad(c.statement, 16)} ${pad(c.pass + (c.touchedBy ? `+${c.touchedBy}` : ''), 12)} ${c.roots.join(',')}${c.note ? ` — ${c.note}` : ''}`,
  );
console.log(
  `\ndifference against r0 by pass: ${result.deltas.byPass.map(r => `${r.pass} ${r.delta >= 0 ? '+' : ''}${r.delta} (${r.rows} rows)`).join(', ')}`,
);
console.log(`difference against r0 by r0 statement:`);
for (const d of deltas.slice(0, top || deltas.length))
  console.log(
    `  ${(d.delta >= 0 ? '+' : '') + String(d.delta).padStart(6)}  ${pad(d.root, 16)} ${pad(d.pass, 12)} r0 ${d.base} -> head ${d.next}`,
  );
if (result.skips.length)
  console.log(
    `\nlicm decisions not taken: ${result.skips.length} (${[...new Set(result.skips.map(s => s.why))].join('; ')})`,
  );
