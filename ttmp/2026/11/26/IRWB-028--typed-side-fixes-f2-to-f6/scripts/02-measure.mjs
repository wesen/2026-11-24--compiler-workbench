// Collect per-project observations using the same compiler and checker paths as the corpus tests.
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url);
const load = path => import(new URL(path, root));
const { installVendor } = await load('tools/node-vendor.mjs');
const { projectIds, projectFiles } = await load('tools/corpus.mjs');
await installVendor({ reference: true });
const { projectSource, ingestProject, runPipeline } = await load('dist/typed/project.js');
const { Program } = await load('dist/typed/program.js');
const { ingest, LiftError } = await load('dist/typed/lift.js');
const { blocksAdapter, storeOf } = await load('dist/typed/ir.js');
const { createIRArtifact } = await load('dist/framework/ir/index.js');
const { AnalysisManager } = await load('dist/framework/contracts/index.js');
const { meaningKept } = await load('dist/typed/evaluate.js');
const A = await load('dist/typed/analyses.js');
const S = await load('dist/typed/ssa.js');
const B = await load('dist/typed/backend/index.js');
const rows = {};
for (const id of projectIds()) {
  const ps = projectSource(id, projectFiles(id));
  const r0 = createIRArtifact(blocksAdapter, id, ingest(id, ps.source, ps.meta.ingest ?? {}).toNative());
  const st = storeOf(r0.value), m = new AnalysisManager();
  const p24 = (await m.checkInvariant(B.imageAgrees({ inputs: ps.meta.inputs ?? {} }), { program: r0, image: B.lowerToImage(r0).image })).evidence;
  const ssa = (await m.analyse(S.ssaAnalysis, r0)).value, reach = (await m.analyse(A.reachingAnalysis, r0)).value;
  const gets = [...st.fns.values()].reduce((n, f) => n + S.checkSsa(st, f, ssa[f.name], A.reachView(reach, st, f.name)).gets, 0);
  let tape;
  try {
    ingest(ps.name, ps.source).toNative();
    const t = ingest(ps.name, ps.source, { tape: true }).toNative();
    tape = Object.values(t.ops).some(o => o.op.startsWith('text.') || o.op.startsWith('array.')) ? 'checked' : 'identical';
  } catch (e) { if (!(e instanceof LiftError)) throw e; tape = 'skipped'; }
  const program = Program.fromProject(ps), compiled = globalThis.typedRv32.compile(ps.source, [], undefined);
  const image = B.imageFromCode(id, compiled.image, compiled.entries, compiled.signatures);
  const checks = program.check({ count: 100, against: (fn, k) => B.runImage(image, fn, k.args, k.memory, { limit: 2e5 }) }).fns;
  const ref = { fns: checks.length, decided: checks.reduce((n, f) => n + f.total, 0), inconclusive: checks.reduce((n, f) => n + f.inconclusive, 0) };
  const origin = ingestProject(ps), manager = new AnalysisManager();
  const run = await runPipeline(origin, ps.meta.pipeline, { manager, inputs: ps.meta.inputs });
  const parity = (await manager.checkInvariant(meaningKept({ inputs: ps.meta.inputs, count: 100 }), { origin, candidate: run.artifact })).evidence;
  await program.pipeline('O2');
  rows[id] = { fns: st.fns.size, p24: p24.inconclusive, gets, tape, ref, parity: { fns: Object.keys(origin.value.fns).length, total: parity.total, agree: parity.agree, inconclusive: parity.inconclusive }, bytes: [B.lowerToImage(program.head).image.value.bytes, image.bytes] };
  console.log(id, JSON.stringify(rows[id]));
  writeFileSync(new URL('02-measurements.json', import.meta.url), JSON.stringify(rows, null, 2) + '\n');
}
