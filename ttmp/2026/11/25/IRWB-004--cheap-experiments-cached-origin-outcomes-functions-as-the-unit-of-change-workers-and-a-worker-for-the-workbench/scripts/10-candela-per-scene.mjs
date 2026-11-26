// Per-scene Candela kernels (design-doc 05 §7, task ckco): specialize on K.scene, clean up, remove what the
// gallery slot's entries no longer reach, then render the scene with the evaluator on the specialized program and
// compare every pixel output bit for bit with the emulator running the reference compiler's general image.
//   node …/12-candela-per-scene.mjs [scene ids or indices…] [--stride N] [--json]
// IRWB-004: a copy of IRWB-001 scripts/12-candela-per-scene.mjs that runs against IRWB_ROOT (default: this
// worktree), so one scene can be timed on the base build and on this build back to back. Unchanged otherwise.
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor({ reference: true });
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const T = await import(root + 'tools/candela-render.mjs');
const R = await import(root + 'dist/typed/candela-render.js');
const { Program } = await import(root + 'dist/typed/program.js');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { evaluate } = await import(root + 'dist/typed/evaluate.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { BindingsIR } = await import(root + 'dist/typed/specialize.js');
const { createArtifact } = await import(root + 'dist/framework/contracts/index.js');
const args = process.argv.slice(2);
const stride = args.includes('--stride') ? +args[args.indexOf('--stride') + 1] : 8;
const want = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--stride');
const ENTRIES = ['cdlLayout', 'cdlInit', 'cdlSky', 'cdlRenderSpan'];
const source = candelaSource(), scenes = T.candelaScenes();
const st0 = ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE });
const inputs = candelaInputs(st0);
const emulator = await T.engineFor('reference', { policy: 'kernel' });
const size = p => { const v = p.head.value; return { fns: v.fnOrder.length, stmts: Object.keys(v.stmts).length, blocks: Object.keys(v.blocks).length }; };
const rows = [];
for (const s of want.length ? want.map(w => scenes.find(x => x.id === w || String(x.index) === w)) : scenes) {
  const t0 = performance.now(), log = [];
  const p = new Program('candela', source, { ingest: { tape: true, maxSourceLength: MAX_SOURCE }, inputs, entries: ENTRIES });
  const before = size(p);
  const facts = createArtifact(BindingsIR, 'gallery', { formatVersion: 1, source: 'candela gallery', bindings: [{ record: 'K', field: 'scene', value: s.index, entity: `scene/${s.id}` }] });
  const step = async (name, f) => { const t = performance.now(); const r = await f(); log.push(`${name} ${r.changed ? r.rev : '-'} ${Math.round(performance.now() - t)}ms`); process.stderr.write(`${s.id} ${log.at(-1)}\n`); };
  await step('specialize', () => p.specialize(facts));
  for (const x of ['constprop', 'fold', 'cfg', 'dce', 'cfg']) await step(x, () => p.apply(x));
  await step('dfe', () => p.apply('dfe', { params: { roots: ENTRIES } }));
  const after = size(p);
  // the frame: evaluator on the specialized program against the emulator on the general reference image
  const head = storeOf(p.head.value);
  const mine = R.renderScene(new R.CandelaHost((n, a, m) => evaluate(head, n, a, m, { limit: 2e9 })), s, { stride });
  const ref = R.renderScene(new R.CandelaHost(emulator), s, { stride });
  const a = new Uint32Array(mine.pixels.buffer), b = new Uint32Array(ref.pixels.buffer);
  let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  const row = { scene: s.id, index: s.index, before, after, removedFns: before.fns - after.fns, stmtCut: +(100 * (1 - after.stmts / before.stmts)).toFixed(1),
    frame: { stride, floats: a.length, differentBits: diff, evaluatorSteps: mine.steps, emulatorInstructions: ref.steps }, ms: Math.round(performance.now() - t0), log };
  rows.push(row);
  console.error(JSON.stringify({ scene: row.scene, fns: `${before.fns}->${after.fns}`, stmts: `${before.stmts}->${after.stmts}`, differentBits: diff, ms: row.ms }));
}
console.log(JSON.stringify(rows, null, 1));
