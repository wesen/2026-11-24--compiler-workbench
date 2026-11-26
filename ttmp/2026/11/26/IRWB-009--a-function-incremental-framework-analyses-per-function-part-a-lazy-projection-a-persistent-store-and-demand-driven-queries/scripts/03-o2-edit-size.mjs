// IRWB-009: the size of each edit O2 makes to Candela, in the units a function-incremental framework would work in.
//
// O2 is replayed pass by pass with applyPass and no contract (every O2 pass on Candela was accepted by the meaning
// check, IRWB-004 various/04, so the revisions are the same; the script checks each against that file). For each
// pass it records:
//   fns          the functions whose transaction recorded an edit (report.fns)
//   partsChanged functions whose part hash differs from the previous revision's (plus added and removed functions)
//   records      how many records of the new value are not the previous value's frozen objects, of how many
//   closureKeys  functions whose closure key changed: the functions whose meaning-check cases must be evaluated again
//   needsMs      the analyses the pass reads, solved on its input (the per-function part of these is what F1-A saves)
//   applyMs      applyPass itself (pass body, artifact, diff, correspondence, preservation claims)
//
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 \
//     node --max-old-space-size=10240 …/03-o2-edit-size.mjs > …/various/03-o2-edit-size.json
import { readFileSync } from 'node:fs';
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { AnalysisManager } = await import(root + 'dist/framework/contracts/index.js');
const { applyPass } = await import(root + 'dist/framework/passes/define-pass.js');
const { PASSES, PIPELINES } = await import(root + 'dist/typed/passes.js');
const { partsOf, partHash, closureKey } = await import(root + 'dist/typed/parts.js');
const baseline = JSON.parse(
  readFileSync(new URL('../../../25/IRWB-004--cheap-experiments-cached-origin-outcomes-functions-as-the-unit-of-change-workers-and-a-worker-for-the-workbench/various/04-candela-o2-baseline.json', import.meta.url), 'utf8'),
);

const ms = t => Math.round(performance.now() - t);
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const manager = new AnalysisManager();
const out = { node: process.version, r0: r0.revision, r0Matches: r0.revision === baseline.r0, steps: [] };
const tables = ['fns', 'blocks', 'stmts', 'values', 'ops'];
let cur = r0;
const everTouched = new Set();
for (const [i, name] of PIPELINES.O2.entries()) {
  const pass = PASSES[name];
  let t = performance.now();
  for (const def of Object.values(pass.needs ?? {})) await manager.analyse(def, cur);
  const needsMs = ms(t);
  t = performance.now();
  const r = await applyPass(pass, cur, { manager });
  const applyMs = ms(t);
  const next = r.artifact;
  const step = { pass: name, changed: r.changed, needs: Object.keys(pass.needs ?? {}), needsMs, applyMs, revision: next.revision, matches: next.revision === baseline.steps[i].revision };
  if (r.changed) {
    const fns = r.report.fns;
    fns.forEach(f => everTouched.add(f));
    const a = partsOf(cur.value), b = partsOf(next.value);
    let partsChanged = 0;
    for (const [n, p] of b) if (!a.has(n) || partHash(a.get(n)) !== partHash(p)) partsChanged++;
    const removed = [...a.keys()].filter(n => !b.has(n)).length;
    let records = 0, fresh = 0;
    for (const k of tables) {
      const before = cur.value[k], after = next.value[k];
      for (const [id, rec] of Object.entries(after)) {
        records++;
        if (before[id] !== rec) fresh++;
      }
    }
    let keys = 0;
    for (const n of b.keys()) if (!a.has(n) || closureKey(cur.value, n) !== closureKey(next.value, n)) keys++;
    Object.assign(step, { fns: fns.length, partsChanged, removed, records, freshRecords: fresh, closureKeys: keys, functions: b.size });
  }
  out.steps.push(step);
  process.stderr.write(JSON.stringify(step) + '\n');
  cur = next;
}
out.head = cur.revision;
out.headMatches = cur.revision === baseline.head;
out.distinctFunctionsTouched = everTouched.size;
out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
console.log(JSON.stringify(out, null, 1));
