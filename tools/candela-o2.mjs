// O2 on the Candela gallery program, each pass gated by the meaning check against r0 (Compiler Workbench's
// checkEach), then a final check of the head against r0. Reports what each pass did.
//   node tools/candela-o2.mjs [--count N] [--final N] [--final-limit S] [--pipeline O2] [--save head.json] [--json]
// --count: cases per function for each pass's check (default 40); --final: for the final check (default 100), whose
// step limit is --final-limit statements (default 2e5); --limit is the per-pass checks' (default the check's 2e4).
import { installVendor } from './node-vendor.mjs';
import { candelaInputs, candelaSource, MAX_SOURCE } from './candela.mjs';

await installVendor();
const { ingest } = await import('../dist/typed/lift.js');
const { blocksAdapter } = await import('../dist/typed/ir.js');
const { createIRArtifact } = await import('../dist/framework/ir/index.js');
const { runPipeline } = await import('../dist/typed/project.js');
const { meaningKept } = await import('../dist/typed/evaluate.js');
const { AnalysisManager } = await import('../dist/framework/contracts/index.js');

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const count = +flag('--count', 40), final = +flag('--final', 100), pipeline = flag('--pipeline', 'O2');
const finalLimit = +flag('--final-limit', 2e5), save = flag('--save', null);
const limit = args.includes('--limit') ? +flag('--limit') : undefined;
const t0 = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const inputs = candelaInputs(st);
const size = a => ({
  blocks: Object.keys(a.value.blocks).length,
  stmts: Object.keys(a.value.stmts).length,
  values: Object.keys(a.value.values).length,
  locals: Object.values(a.value.fns).reduce((n, f) => n + f.locals.length, 0),
});
const manager = new AnalysisManager();
const steps = [];
let before = size(r0), last = performance.now();
// one pass at a time (runPipeline's `start`), each still checked against r0, so progress can be reported
const { PIPELINES } = await import('../dist/typed/passes.js');
const run = { artifact: r0, steps: [] };
for (const name of PIPELINES[pipeline]) {
  const t = performance.now();
  const one = await runPipeline(r0, [name], { manager, inputs, count, limit, start: run.artifact });
  run.artifact = one.artifact;
  run.steps.push(...one.steps);
  const s = one.steps[0];
  process.stderr.write(`${name} ${s.changed ? 'r' + s.rev : '-'}${s.rejected ? ' REJECTED' : ''} ${Math.round(performance.now() - t)} ms\n`);
}
for (const s of run.steps) {
  const after = s.result?.artifact ? size(s.result.artifact) : before;
  steps.push({
    pass: s.pass,
    changed: s.changed,
    rev: s.rev,
    edits: s.edits,
    kinds: s.report?.kinds,
    fns: s.report?.fns?.length,
    check: s.result?.contract ? 'agree' : undefined,
    rejected: s.rejected?.slice(0, 400),
    stmts: [before.stmts, after.stmts],
  });
  if (s.changed) before = after;
}
const pipelineMs = Math.round(performance.now() - last);
last = performance.now();
if (save) (await import('node:fs')).writeFileSync(save, JSON.stringify(run.artifact.value));
const ev = (
  await manager.checkInvariant(meaningKept({ inputs, count: final, limit: finalLimit }), { origin: r0, candidate: run.artifact })
).evidence;
const out = {
  pipeline,
  r0: size(r0),
  head: size(run.artifact),
  rev: run.artifact.value.rev,
  steps,
  final: { total: ev.total, agree: ev.agree, disagree: ev.disagree, inconclusive: ev.inconclusive, counterexamples: ev.counterexamples },
  ms: { pipeline: pipelineMs, final: Math.round(performance.now() - last), total: Math.round(performance.now() - t0) },
};
if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  for (const s of steps)
    console.log(
      `${s.pass.padEnd(10)} ${s.changed ? `r${s.rev}` : '  '} ${s.rejected ? 'REJECTED ' + s.rejected : s.changed ? `${s.edits} edits ${JSON.stringify(s.kinds)} in ${s.fns} fns, stmts ${s.stmts[0]} -> ${s.stmts[1]}` : '-'}`,
    );
  console.log(JSON.stringify({ r0: out.r0, head: out.head, final: out.final, ms: out.ms }));
}
