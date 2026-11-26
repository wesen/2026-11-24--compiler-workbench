// IRWB-004: immutable() and canonical() of the base build against this build, on Candela r0's native value and on its
// ranges analysis result: time, and identical output (the same JSON text, key order included, and the same
// canonical text).
//   IRWB_BASE=<base build root>/ node --max-old-space-size=8192 …/07-immutable-bench.mjs
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const base = process.env.IRWB_BASE;
if (!base) throw new Error('set IRWB_BASE to the base build root (with a trailing slash)');
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const NEW = await import(root + 'dist/framework/core/data.js');
const OLD = await import(base + 'dist/framework/core/data.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');
const { ANALYSES } = await import(root + 'dist/typed/analyses.js');
const ms = t => Math.round(performance.now() - t);
const out = {};
const time = (label, f) => {
  const t = performance.now();
  const r = f();
  out[label] = ms(t);
  return r;
};
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const nativeA = st.toNative(),
  nativeB = st.toNative();
const a = time('immutableOld', () => OLD.immutable(nativeA));
const b = time('immutableNew', () => NEW.immutable(nativeB));
out.sameJson = JSON.stringify(a) === JSON.stringify(b);
const ta = time('canonicalOld', () => OLD.canonical(nativeA));
const tb = time('canonicalNew', () => NEW.canonical(b));
const tc = time('canonicalNewCached', () => NEW.canonical(b));
out.sameText = ta === tb && tb === tc;
// a dataflow result: many small records and arrays
const r0 = createIRArtifact(blocksAdapter, 'candela', st.toNative());
const raw = ANALYSES.ranges.solveArtifact; // solveArtifact freezes with this build's immutable; measure on a thawed copy
const solved = raw(r0);
const thawA = JSON.parse(JSON.stringify(solved)),
  thawB = JSON.parse(JSON.stringify(solved));
const ra = time('rangesImmutableOld', () => OLD.immutable(thawA));
const rb = time('rangesImmutableNew', () => NEW.immutable(thawB));
out.rangesSameJson = JSON.stringify(ra) === JSON.stringify(rb);
out.rangesSameText = OLD.canonical(thawA) === NEW.canonical(rb);
console.log(JSON.stringify(out));
