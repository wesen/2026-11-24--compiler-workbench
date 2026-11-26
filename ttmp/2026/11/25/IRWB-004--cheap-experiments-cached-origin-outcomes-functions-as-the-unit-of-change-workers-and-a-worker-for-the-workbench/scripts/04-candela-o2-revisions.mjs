// IRWB-004: O2 on Candela, pass by pass, each pass under the meaning contract against r0 (40 cases per function),
// as tools/candela-o2.mjs runs it, without its final check. For every pass: wall time, whether it changed the
// program, the full revision hash, the functions it touched and the contract's evidence counts. Two runs of this
// script on different framework code must print identical revisions and identical evidence.
//   node --max-old-space-size=12288 …/04-candela-o2-revisions.mjs [--pipeline O2] [--passes a,b,c] [--json]
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { runPipeline } = await import(root + 'dist/typed/project.js');
const { PIPELINES } = await import(root + 'dist/typed/passes.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const pipeline = flag('--pipeline', 'O2');
const names = flag('--passes', null)?.split(',') ?? PIPELINES[pipeline];
const t0 = performance.now();
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const inputs = candelaInputs(st);
const openMs = Math.round(performance.now() - t0);
const manager = new AnalysisManager();
const steps = [];
let cur = r0;
for (const name of names) {
  const t = performance.now();
  const one = await runPipeline(r0, [name], { manager, inputs, count: 40, start: cur });
  const s = one.steps[0];
  const ms = Math.round(performance.now() - t);
  cur = one.artifact;
  const checks = (s.result?.contract?.execution?.checks ?? []).map(c => {
    const e = c.evidence ?? {};
    return [e.total, e.agree, e.disagree, e.inconclusive, (e.counterexamples ?? []).length];
  });
  const step = {
    pass: name,
    ms,
    changed: s.changed,
    rev: s.rev,
    revision: cur.revision,
    fns: s.report?.fns?.length ?? 0,
    edits: s.edits,
    checks,
    ...(s.rejected ? { rejected: s.rejected.slice(0, 300) } : {}),
    rssMB: Math.round(process.memoryUsage().rss / 1e6),
  };
  steps.push(step);
  process.stderr.write(JSON.stringify(step) + '\n');
}
const out = {
  pipeline,
  node: process.version,
  r0: r0.revision,
  openMs,
  head: cur.revision,
  steps,
  totalMs: Math.round(performance.now() - t0),
  passesMs: steps.reduce((n, s) => n + s.ms, 0),
};
console.log(JSON.stringify(out, null, 1));
