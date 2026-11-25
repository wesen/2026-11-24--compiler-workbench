// Call sites per function in the general Candela r0 and in a scene's program after specialize + cleanup + dfe:
// how many functions have exactly one static call site (candidates for inlining without growth).
//   node …/14-candela-call-sites.mjs [scene id]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor();
const { candelaInputs, candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const T = await import(root + 'tools/candela-render.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { BindingsIR } = await import(root + 'dist/typed/specialize.js');
const { createArtifact } = await import(root + 'dist/framework/contracts/index.js');
const ENTRIES = ['cdlLayout', 'cdlInit', 'cdlSky', 'cdlRenderSpan'];
const sceneId = process.argv[2] ?? 'B-01';
const source = candelaSource(), s = T.candelaScenes().find(x => x.id === sceneId);
const inputs = candelaInputs(ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE }));
function sites(st) {
  const n = new Map(), size = new Map();
  for (const f of st.fns.values()) {
    let stmts = 0;
    const walk = id => { if (!id) return; const v = st.get(id); if (v.op === 'call') n.set(v.imm, (n.get(v.imm) ?? 0) + 1); v.args.forEach(walk); };
    for (const b of f.blocks) for (const sid of b.stmts) { stmts++; const x = st.get(sid); walk(x.value); walk(x.cond); walk(x.addr); }
    size.set(f.name, stmts);
  }
  const fns = [...st.fns.keys()].filter(f => !ENTRIES.includes(f));
  const one = fns.filter(f => n.get(f) === 1);
  return { functions: st.fns.size, calledOnce: one.length, calledOnceSmall: one.filter(f => size.get(f) <= 20).length,
    calledTwiceOrMore: fns.filter(f => (n.get(f) ?? 0) >= 2).length, uncalledNonEntries: fns.filter(f => !n.get(f)).length };
}
const p = new Program('candela', source, { ingest: { tape: true, maxSourceLength: MAX_SOURCE }, inputs, entries: ENTRIES });
const general = sites(storeOf(p.head.value));
await p.specialize(createArtifact(BindingsIR, 'gallery', { formatVersion: 1, source: 'candela gallery', bindings: [{ record: 'K', field: 'scene', value: s.index, entity: `scene/${s.id}` }] }));
for (const x of ['constprop', 'fold', 'cfg', 'dce', 'cfg']) await p.apply(x);
await p.apply('dfe', { params: { roots: ENTRIES } });
console.log(JSON.stringify({ scene: s.id, general, scene: sites(storeOf(p.head.value)) }));
