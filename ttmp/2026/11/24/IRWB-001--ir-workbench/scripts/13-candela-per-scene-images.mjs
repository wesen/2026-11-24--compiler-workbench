// Per-scene kernels compiled to RV32 by this compiler's backend (tasks ckco and owi2): for each scene, lower the
// general r0 and the scene's specialized program (specialize K.scene, constprop, fold, cfg, dce, cfg, dfe from the
// gallery entries) to images; render the scene at `stride` with both images and with the reference kernel image;
// report image bytes, instructions per pixel, and whether every output float is bit-identical.
//   node …/13-candela-per-scene-images.mjs [scene ids…] [--stride N] [--o2]
// --o2: after dfe, also run O2+ on the scene's program, check every surviving function against the post-dfe
// revision on 20 cases each (the assumption K.scene = v is in every function's inputs, so these cases are valid),
// and lower, render and compare that revision too.
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor({ reference: true });
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const T = await import(root + 'tools/candela-render.mjs');
const R = await import(root + 'dist/typed/candela-render.js');
const { Program } = await import(root + 'dist/typed/program.js');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { BindingsIR } = await import(root + 'dist/typed/specialize.js');
const { createArtifact } = await import(root + 'dist/framework/contracts/index.js');
const { lowerToImage, runImage } = await import(root + 'dist/typed/backend/index.js');
const { casesFrom, evaluate, agrees } = await import(root + 'dist/typed/evaluate.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const o2 = process.argv.includes('--o2');
const args = process.argv.slice(2);
const stride = args.includes('--stride') ? +args[args.indexOf('--stride') + 1] : 4;
const want = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--stride');
const ENTRIES = ['cdlLayout', 'cdlInit', 'cdlSky', 'cdlRenderSpan'];
const source = candelaSource(), scenes = T.candelaScenes();
const inputs = candelaInputs(ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE }));
const reference = await T.engineFor('reference', { policy: 'kernel' });
const engine = image => (name, a, mem) => runImage(image, name, a, mem, { limit: 4e9, counts: false });
const render = (e, s) => { const t = performance.now(); const img = R.renderScene(new R.CandelaHost(e), s, { stride }); return { img, ms: Math.round(performance.now() - t) }; };
const same = (x, y) => { const a = new Uint32Array(x.pixels.buffer), b = new Uint32Array(y.pixels.buffer); let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
const general = new Program('candela', source, { ingest: { tape: true, maxSourceLength: MAX_SOURCE }, inputs, entries: ENTRIES });
const r0image = lowerToImage(general.head).image;
const rows = [];
for (const s of want.map(w => scenes.find(x => x.id === w || String(x.index) === w))) {
  const p = new Program('candela', source, { ingest: { tape: true, maxSourceLength: MAX_SOURCE }, inputs, entries: ENTRIES });
  await p.specialize(createArtifact(BindingsIR, 'gallery', { formatVersion: 1, source: 'candela gallery', bindings: [{ record: 'K', field: 'scene', value: s.index, entity: `scene/${s.id}` }] }));
  for (const x of ['constprop', 'fold', 'cfg', 'dce', 'cfg']) await p.apply(x);
  await p.apply('dfe', { params: { roots: ENTRIES } });
  const kimage = lowerToImage(p.head).image;
  const ref = render(reference, s), gen = render(engine(r0image), s), spec = render(engine(kimage), s);
  const px = ref.img.width * ref.img.height;
  const row = { scene: s.id, stride, pixels: px, rev: p.rev, fns: p.fns().length,
    bytes: { general: r0image.value.bytes, scene: kimage.value.bytes },
    perPixel: { referenceKernel: +(ref.img.steps / px).toFixed(1), oursGeneral: +(gen.img.steps / px).toFixed(1), oursScene: +(spec.img.steps / px).toFixed(1) },
    differentBits: { generalVsReference: same(gen.img, ref.img), sceneVsReference: same(spec.img, ref.img) } };
  if (o2) {
    const base = storeOf(p.head.value), stmts = Object.keys(p.head.value.stmts).length, t0 = performance.now();
    const steps = await p.pipeline('O2+');
    const ms = Math.round(performance.now() - t0), head = storeOf(p.head.value);
    let agree = 0, disagree = 0, inconclusive = 0; const bad = [];
    for (const f of p.fns())
      for (const c of casesFrom(base, f, { count: 20, seed: 7, inputs: p.inputs[f] ?? {} })) {
        const e = evaluate(base, f, c.args, c.memory, { limit: 2e5 }), g = evaluate(head, f, c.args, c.memory, { limit: 2e5 });
        if (e.limit || g.limit) inconclusive++; else if (agrees(e, g)) agree++; else { disagree++; if (bad.length < 5) bad.push({ f, args: c.args }); }
      }
    const oimage = lowerToImage(p.head).image, opt = render(engine(oimage), s);
    row.o2 = { rev: p.rev, ms, stmts: `${stmts}->${Object.keys(p.head.value.stmts).length}`, rejected: (steps?.steps ?? steps ?? []).filter?.(x => x.rejected).map(x => x.pass) ?? [],
      check: { agree, disagree, inconclusive, bad }, bytes: oimage.value.bytes, perPixel: +(opt.img.steps / px).toFixed(1), differentBits: same(opt.img, ref.img) };
  }
  rows.push(row); console.error(JSON.stringify(row));
}
console.log(JSON.stringify(rows, null, 1));
