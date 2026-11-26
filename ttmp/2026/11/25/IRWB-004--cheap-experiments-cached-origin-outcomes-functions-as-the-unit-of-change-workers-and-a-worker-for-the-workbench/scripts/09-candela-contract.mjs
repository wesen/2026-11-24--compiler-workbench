// IRWB-004: the meaning contract alone, on Candela r0 against its cfg revision (13,280 cases), decided on the calling
// thread and on 1, 2 and 4 worker threads, without reuse; then with reuse, cold and warm. Every evidence record must
// equal the calling thread's. Prints one JSON object.
//   node --max-old-space-size=12288 …/09-candela-contract.mjs [--threads 1,2,4]
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { PASSES } = await import(root + 'dist/typed/passes.js');
const { meaningKept } = await import(root + 'dist/typed/evaluate.js');
const { setMeaningExecutor } = await import(root + 'dist/typed/meaning-exec.js');
const { startMeaningPool } = await import(root + 'dist/typed/parallel/node-pool.js');
const { applyPass } = await import(root + 'dist/framework/passes/index.js');
const C = await import(root + 'dist/framework/contracts/index.js');
const { isDeepStrictEqual } = await import('node:util');
const { loadavg } = await import('node:os');
const args = process.argv.slice(2);
const threadList = (args.includes('--threads') ? args[args.indexOf('--threads') + 1] : '1,2,4').split(',').filter(Boolean).map(Number);
const localOnly = args.includes('--local-only'); // just the calling thread, no reuse (for a profile)
const ms = t => Math.round(performance.now() - t);
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const inputs = candelaInputs(st);
const cfg = (await applyPass(PASSES.cfg, r0, { manager: new C.AnalysisManager() })).artifact;
const check = meaningKept({ inputs, count: 40, seed: 7 });
const evidence = async candidate => (await check.check(null, { origin: r0, candidate })).evidence;
const out = { load: loadavg()[0].toFixed(2), runs: [] };
const record = async (label, f, want) => {
  const t = performance.now();
  const ev = await f();
  const row = { label, ms: ms(t), counts: [ev.total, ev.agree, ev.disagree, ev.inconclusive], same: want ? isDeepStrictEqual(ev, want) : true };
  out.runs.push(row);
  process.stderr.write(JSON.stringify(row) + '\n');
  return ev;
};
C.setDifferentialReuse(false);
const want = await record('local, no reuse', () => evidence(cfg));
if (localOnly) {
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
for (const n of threadList) {
  const pool = startMeaningPool({ threads: n });
  setMeaningExecutor(pool);
  await record(`${n} threads, no reuse, cold workers`, () => evidence(cfg), want);
  await record(`${n} threads, no reuse, warm workers`, () => evidence(cfg), want);
  out.runs.at(-1).busyMs = pool.stats.busyMs.map(Math.round);
  setMeaningExecutor(undefined);
  await pool.close();
}
C.setDifferentialReuse(true);
await record('local, reuse, cold', () => evidence(cfg), want);
await record('local, reuse, warm (same candidate)', () => evidence(cfg), want);
out.loadAfter = loadavg()[0].toFixed(2);
console.log(JSON.stringify(out, null, 1));
