// Per-scene Candela programs under the `speed` pipeline and the new backend options, against the reference
// compiler's `kernel` image (IRWB-001 scripts/13, extended). For each scene: specialize K.scene, constprop, fold,
// cfg, dce, cfg, dfe from the gallery entries (IRWB-001's scene program); then the `speed` pipeline and dfe again
// (callees that lost their last call disappear). Each pass is checked by the program's entry-only contract. The
// head is then checked against the post-dfe scene program on 20 cases per surviving function, lowered with the
// default options and with { chains, coalesce, homes }, rendered at `stride`, and compared bit for bit with the
// reference kernel's frame.
//   node --max-old-space-size=12288 08-candela-scene-speed.mjs [scene ids…] [--stride N] [--base] [--pipeline speed]
// --base: also run O2+ on the scene program (IRWB-001's --o2 row), for a same-build comparison.
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor({ reference: true });
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const T = await import(root + 'tools/candela-render.mjs');
const R = await import(root + 'dist/typed/candela-render.js');
const { Program } = await import(root + 'dist/typed/program.js');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { BindingsIR } = await import(root + 'dist/typed/specialize.js');
const { createArtifact } = await import(root + 'dist/framework/contracts/index.js');
const { lowerToImage, runImage, variantChoices } = await import(root + 'dist/typed/backend/index.js');
const { casesFrom, evaluate, agrees } = await import(root + 'dist/typed/evaluate.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const args = process.argv.slice(2);
const flag = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const stride = +flag('--stride', 4),
  pipeline = flag('--pipeline', 'speed'),
  base = args.includes('--base');
const want = args.filter((a, i) => !a.startsWith('--') && !['--stride', '--pipeline'].includes(args[i - 1]));
const ENTRIES = ['cdlLayout', 'cdlInit', 'cdlSky', 'cdlRenderSpan'];
const OPTIONS = { chains: true, coalesce: true, homes: true };
const source = candelaSource(),
  scenes = T.candelaScenes();
const inputs = candelaInputs(ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE }));
const reference = await T.engineFor('reference', { policy: 'kernel' });
const engine = image => (name, a, mem) => runImage(image, name, a, mem, { limit: 4e9, counts: false });
const render = (e, s) => {
  const t = performance.now();
  const img = R.renderScene(new R.CandelaHost(e), s, { stride });
  return { img, ms: Math.round(performance.now() - t) };
};
const differ = (x, y) => {
  const a = new Uint32Array(x.pixels.buffer),
    b = new Uint32Array(y.pixels.buffer);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
};
const stmts = p => Object.keys(p.head.value.stmts).length;
const check = (from, p) => {
  const st0 = storeOf(from.value),
    head = storeOf(p.head.value);
  let agree = 0,
    disagree = 0,
    inconclusive = 0;
  const bad = [];
  for (const f of p.fns())
    if (st0.fns.has(f))
      for (const c of casesFrom(st0, f, { count: 20, seed: 7, inputs: p.inputs[f] ?? {} })) {
        const e = evaluate(st0, f, c.args, c.memory, { limit: 2e5 }),
          g = evaluate(head, f, c.args, c.memory, { limit: 2e5 });
        if (e.limit || g.limit) inconclusive++;
        else if (agrees(e, g)) agree++;
        else {
          disagree++;
          if (bad.length < 5) bad.push({ f, args: c.args });
        }
      }
  return { agree, disagree, inconclusive, bad };
};
const rows = [];
for (const s of want.map(w => scenes.find(x => x.id === w || String(x.index) === w))) {
  const open = async () => {
    const p = new Program('candela', source, {
      ingest: { tape: true, maxSourceLength: MAX_SOURCE },
      inputs,
      entries: ENTRIES,
    });
    await p.specialize(
      createArtifact(BindingsIR, 'gallery', {
        formatVersion: 1,
        source: 'candela gallery',
        bindings: [{ record: 'K', field: 'scene', value: s.index, entity: `scene/${s.id}` }],
      }),
    );
    for (const x of ['constprop', 'fold', 'cfg', 'dce', 'cfg']) await p.apply(x);
    await p.apply('dfe', { params: { roots: ENTRIES } });
    return p;
  };
  const ref = render(reference, s);
  const px = ref.img.width * ref.img.height;
  const row = { scene: s.id, stride, pixels: px, referenceKernel: +(ref.img.steps / px).toFixed(1) };
  if (base) {
    const p = await open(),
      from = p.head,
      t0 = performance.now();
    await p.pipeline('O2+');
    const img = lowerToImage(p.head).image,
      r = render(engine(img), s);
    row.o2plus = {
      ms: Math.round(performance.now() - t0),
      fns: p.fns().length,
      stmts: stmts(p),
      check: check(from, p),
      bytes: img.value.bytes,
      perPixel: +(r.img.steps / px).toFixed(1),
      differentBits: differ(r.img, ref.img),
    };
    console.error(JSON.stringify({ scene: s.id, o2plus: row.o2plus }));
  }
  const p = await open(),
    from = p.head,
    before = { fns: p.fns().length, stmts: stmts(p) },
    t0 = performance.now();
  const steps = [];
  const names = pipeline.startsWith('[') ? JSON.parse(pipeline) : (await import(root + 'dist/typed/passes.js')).PIPELINES[pipeline];
  for (const name of names) {
    const t = performance.now();
    const r = await p.apply(name);
    steps.push({ pass: name, changed: r.changed, check: r.check, ms: Math.round(performance.now() - t), stmts: stmts(p) });
    console.error(JSON.stringify(steps.at(-1)));
  }
  const d = await p.apply('dfe', { params: { roots: ENTRIES } });
  steps.push({ pass: 'dfe', changed: d.changed, stmts: stmts(p) });
  const ms = Math.round(performance.now() - t0);
  row.scene0 = before;
  row.speed = { pipeline, ms, fns: p.fns().length, stmts: stmts(p), steps, check: check(from, p) };
  for (const [key, o] of [['defaults', {}], ['options', OPTIONS]]) {
    const img = lowerToImage(p.head, o).image,
      r = render(engine(img), s);
    row.speed[key] = {
      bytes: img.value.bytes,
      perPixel: +(r.img.steps / px).toFixed(1),
      differentBits: differ(r.img, ref.img),
      ms: r.ms,
    };
  }
  const choices = Object.values(variantChoices(p.head, OPTIONS));
  row.speed.choices = {
    fns: choices.length,
    chains: choices.filter(c => c.chains).length,
    coalesce: choices.filter(c => c.coalesce).length,
    homes: choices.filter(c => c.homes.length).length,
    homeKeys: choices.reduce((n, c) => n + c.homes.length, 0),
  };
  rows.push(row);
  console.error(JSON.stringify(row));
}
console.log(JSON.stringify(rows, null, 1));
