// IRWB-011: three float transformations that the bit-exact contract forbids, applied to Candela r0 outside the
// pass system (a measurement, not a pass), rendered with this compiler's own RV32 image on the emulator, and judged
// against the exact frame (same frame index) and against the Monte Carlo noise floor (scripts/02-noise-floor.mjs).
//
//   node scripts/03-float-candidates.mjs [--scenes B-01,R-01] [--stride 8] [--small-stride 4]
//        [--variants fma,recip,reassoc] [--zpasses 16] [--passes-dir various/01-passes] [--json out.json]
//
// Variants:
//   exact    r0 lowered with the default backend options. Its pass 0 must equal the reference engine's pass 0
//            (scripts/01-render-passes.mjs) bit for bit: that checks this harness.
//   fma      the exact image with every fusable fmul.s / fadd.s (fsub.s) pair turned into one fmadd.s (fmsub.s,
//            fnmsub.s) and a nop. A pair is fused only when the fadd/fsub covers a value whose operand is the value
//            the fmul covers (trees have one user, so the product register dies there), the two are in one function,
//            no branch, jump, call or branch target lies between them, nothing between writes the fmul's operand
//            registers or reads or writes its result register. One rounding instead of two. The nop keeps every
//            address; the instructions a real fusion saves are counted as the nops' executions.
//   recip    fdiv(x, const c), c finite, non-zero and not a power of two, becomes fmul(x, const fl(1/c)).
//   reassoc  fadd(fadd(x, c1), c2) becomes fadd(x, fl(c1 + c2)), and likewise for fmul (constants on either side).
// Per variant and scene: sites changed, instructions per pixel, and pass 0 against the exact pass 0 (floats and
// pixels that differ; linear and display distances as in 02). With --zpasses N, the variant's passes [0, N) are
// compared with the reference passes [N, 2N) (independent frame indices) by the same z statistics as the exact
// passes [0, N) against [N, 2N): if the variant's estimator is the exact one's, the two rows agree.
// Loads, lowers and renders Candela: run under the memory cap, one process at a time.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../../');
const { candelaScenes } = await import(join(root, 'tools/candela-render.mjs'));
const { candelaSource, MAX_SOURCE } = await import(join(root, 'tools/candela.mjs'));
const R = await import(join(root, 'dist/typed/candela-render.js'));
const { ingest } = await import(join(root, 'dist/typed/lift.js'));
const { lowerToImage, runImage } = await import(join(root, 'dist/typed/backend/index.js'));
const { codeBytes, toBase64 } = await import(join(root, 'dist/typed/backend/image.js'));
const { blocksAdapter } = await import(join(root, 'dist/typed/ir.js'));
const { createIRArtifact } = await import(join(root, 'dist/framework/ir/index.js'));
const { f32Op } = await import(join(root, 'dist/typed/f32.js'));
const NF = await import(join(here, '02-noise-floor.mjs'));

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const wanted = flag('--scenes', 'B-01').split(','),
  stride = +flag('--stride', 8),
  smallStride = +flag('--small-stride', 4),
  variants = flag('--variants', 'fma,recip,reassoc').split(','),
  zpasses = +flag('--zpasses', 0),
  passesDir = flag('--passes-dir', join(here, '../various/01-passes'));
const frameIndex = p => (p === 0 ? 0 : p + 1);
const ONE = 0x3f800000;
const isPow2F = b => (b & 0x7fffff) === 0 && ((b >>> 23) & 255) > 0 && ((b >>> 23) & 255) < 255;
const finiteNonZero = b => ((b >>> 23) & 255) !== 255 && (b & 0x7fffffff) !== 0;

// ---------- variants on the store ----------
function recip(st) {
  let n = 0;
  for (const v of st.ents.values()) {
    if (v.kind !== 'value' || v.op !== 'fdiv') continue;
    const c = st.get(v.args[1]);
    if (c.op !== 'const' || c.type !== 'f32' || !finiteNonZero(c.imm | 0) || isPow2F(c.imm | 0)) continue;
    const r = f32Op('fdiv', ONE, c.imm | 0);
    if (!finiteNonZero(r)) continue;
    v.op = 'fmul';
    c.imm = r;
    n++;
  }
  return n;
}
function reassoc(st) {
  let n = 0;
  const isC = x => x && x.op === 'const' && x.type === 'f32';
  for (const v of st.ents.values()) {
    if (v.kind !== 'value' || (v.op !== 'fadd' && v.op !== 'fmul')) continue;
    for (const i of [0, 1]) {
      const inner = st.get(v.args[i]),
        c2 = st.get(v.args[1 - i]);
      if (!inner || inner.op !== v.op || !isC(c2)) continue;
      const k = inner.args.findIndex(id => isC(st.get(id)));
      if (k < 0) continue;
      const c1 = st.get(inner.args[k]),
        x = inner.args[1 - k];
      c2.imm = f32Op(v.op, c1.imm | 0, c2.imm | 0);
      v.args = i === 0 ? [x, c2.id] : [c2.id, x];
      n++;
      break;
    }
  }
  return n;
}

// ---------- fma on the image ----------
const field = (w, lo) => (w >>> lo) & 31;
function fuse(image, values) {
  const code = codeBytes(image).slice();
  const dv = new DataView(code.buffer);
  const word = a => dv.getUint32(a, true);
  const targets = new Set(image.insns.filter(i => i.target !== undefined).map(i => i.target));
  const insns = image.insns;
  const nops = [];
  const writesF = w => {
    const op = w & 127,
      f7 = w >>> 25;
    if (op === 0x07 || op === 0x43 || op === 0x47 || op === 0x4b || op === 0x4f) return field(w, 7);
    if (op === 0x53 && f7 !== 0x50 && f7 !== 0x60 && f7 !== 0x70) return field(w, 7);
    return -1;
  };
  const readsF = w => {
    const op = w & 127,
      f7 = w >>> 25;
    if (op === 0x27) return [field(w, 20)];
    if (op === 0x43 || op === 0x47 || op === 0x4b || op === 0x4f) return [field(w, 15), field(w, 20), field(w, 27)];
    if (op === 0x53 && f7 !== 0x68 && f7 !== 0x78) return [field(w, 15), field(w, 20)];
    return [];
  };
  const control = w => [0x63, 0x6f, 0x67, 0x73].includes(w & 127);
  let fused = 0;
  for (let i = 0; i < insns.length; i++) {
    const m = insns[i];
    if (m.op !== 'fmul.s') continue;
    const v1 = values[m.covers[0]];
    if (!v1 || v1.op !== 'fmul') continue;
    const wm = word(m.offset),
      rT = field(wm, 7),
      ra = field(wm, 15),
      rb = field(wm, 20);
    for (let j = i + 1; j < insns.length && j <= i + 24; j++) {
      const a = insns[j];
      if (a.fn !== m.fn || targets.has(a.offset)) break;
      const wa = word(a.offset);
      const v2 = values[a.covers[0]];
      if ((a.op === 'fadd.s' || a.op === 'fsub.s') && v2 && (v2.op === 'fadd' || v2.op === 'fsub') && v2.args.includes(v1.id)) {
        const x = field(wa, 15),
          y = field(wa, 20),
          rd = field(wa, 7),
          rm = (wa >>> 12) & 7;
        if ((x === rT) === (y === rT)) break;
        const other = x === rT ? y : x;
        const opcode = a.op === 'fadd.s' ? 0x43 : x === rT ? 0x47 : 0x4b; // a*b+c, a*b-c, -(a*b)+c
        const fw = ((other << 27) | (rb << 20) | (ra << 15) | (rm << 12) | (rd << 7) | opcode) >>> 0;
        dv.setUint32(a.offset, fw, true);
        dv.setUint32(m.offset, 0x00000013, true); // addi x0, x0, 0
        nops.push(m.offset);
        fused++;
        break;
      }
      if (control(wa)) break;
      const wf = writesF(wa);
      if (wf === ra || wf === rb || wf === rT) break;
      if (readsF(wa).includes(rT)) break;
    }
  }
  return { image: { ...image, code: toBase64(code) }, fused, nops };
}

// ---------- rendering ----------
const scenes = candelaScenes();
function renderPasses(image, scene, s, passes, countAt) {
  const counts = countAt ? new Float64Array(image.bytes / 4) : null;
  let counting = false;
  const engine = (name, a, mem) => {
    const r = runImage(image, name, a, mem, { limit: 4e9, counts: counting });
    if (counting && r.counts) for (let i = 0; i < r.counts.length; i++) counts[i] += r.counts[i];
    return { ...r, counts: null };
  };
  const host = new R.CandelaHost(engine);
  host.bind(scene);
  const w = Math.ceil(scene.width / s),
    h = Math.ceil(scene.height / s),
    n = w * h;
  const colour = new Float32Array(passes * n * 4);
  const steps = [];
  for (let p = 0; p < passes; p++) {
    counting = !!counts && p === 0;
    const before = host.steps;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) colour.set(host.span(j * s, i * s, i * s + 1, frameIndex(p)).subarray(0, 4), (p * n + j * w + i) * 4);
    steps.push(host.steps - before);
  }
  return { colour, n, steps, counts };
}
const asScene = (meta, colour, passes) => ({
  meta: { ...meta, passes },
  n: meta.size[0] * meta.size[1],
  pass: p => colour.subarray(p * meta.size[0] * meta.size[1] * 4, (p + 1) * meta.size[0] * meta.size[1] * 4),
});

const t0 = performance.now();
const st0 = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
const r0native = st0.toNative();
const lower = native => {
  const art = createIRArtifact(blocksAdapter, 'candela', native);
  const lowered = lowerToImage(art).image;
  return lowered.value ?? lowered;
};
const exactImage = lower(r0native);
const images = { exact: { image: exactImage, sites: 0 } };
if (variants.includes('fma')) {
  const f = fuse(exactImage, r0native.values);
  images.fma = { image: f.image, sites: f.fused, nops: f.nops };
}
for (const [name, edit] of [
  ['recip', recip],
  ['reassoc', reassoc],
]) {
  if (!variants.includes(name)) continue;
  const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
  const sites = edit(st);
  images[name] = { image: sites ? lower(st.toNative()) : null, sites };
}
process.stderr.write(`images ready in ${Math.round(performance.now() - t0)} ms: ${JSON.stringify(Object.fromEntries(Object.entries(images).map(([k, v]) => [k, v.sites])))}\n`);

const out = { sites: Object.fromEntries(Object.entries(images).map(([k, v]) => [k, v.sites])), scenes: [] };
for (const id of wanted) {
  const scene = scenes.find(x => x.id === id);
  const s = scene.width >= 160 ? stride : smallStride;
  const meta = JSON.parse(readFileSync(join(passesDir, `${id}.json`), 'utf8'));
  if (meta.stride !== s) throw new Error(`${id}: passes were rendered at stride ${meta.stride}, not ${s}`);
  const ref = NF.load(passesDir, id);
  const full = NF.meanOf(ref, 0, ref.meta.passes);
  const k = NF.exposureOf(full);
  const refPass0 = NF.meanOf(ref, 0, 1);
  const noise = NF.compare(refPass0, NF.meanOf(ref, 1, 2), k, full);
  const ex = renderPasses(exactImage, scene, s, 1, true);
  const exP0 = ex.colour.subarray(0, ex.n * 4);
  let harness = 0;
  const refRaw = ref.pass(0);
  for (let i = 0; i < exP0.length; i++) if (Object.is(exP0[i], refRaw[i]) === false && !(exP0[i] !== exP0[i] && refRaw[i] !== refRaw[i])) harness++;
  const row = { scene: id, stride: s, pixels: ex.n, exposure: k, harnessDifferentFloats: harness, exactPerPixel: Math.round(ex.steps[0] / ex.n), noise, variants: {} };
  const exRgb = NF.meanOf(asScene(meta, ex.colour, 1), 0, 1);
  for (const [name, v] of Object.entries(images)) {
    if (name === 'exact' || !v.image) continue;
    const r = renderPasses(v.image, scene, s, Math.max(1, zpasses), false);
    const p0 = r.colour.subarray(0, r.n * 4);
    let floats = 0;
    const px = new Set();
    for (let i = 0; i < p0.length; i++)
      if (!Object.is(p0[i], exP0[i])) {
        floats++;
        px.add(i >> 2);
      }
    const vs = asScene(meta, r.colour, Math.max(1, zpasses));
    const rec = {
      perPixel: Math.round(r.steps[0] / r.n),
      differentFloats: floats,
      differentPixels: px.size,
      vsExact: NF.compare(NF.meanOf(vs, 0, 1), exRgb, k, full),
    };
    if (name === 'fma' && ex.counts) rec.savedPerPixel = v.nops.reduce((a, o) => a + ex.counts[o >>> 2], 0) / ex.n;
    if (zpasses && ref.meta.passes >= 2 * zpasses) {
      const z = (A, B, vA, vB, n) => {
        let z3 = 0,
          zz = 0,
          m = 0;
        for (let i = 0; i < A.length; i++) {
          const se = Math.sqrt((vA[i] + vB[i]) / n);
          if (!se) continue;
          const t = (A[i] - B[i]) / se;
          zz += t * t;
          if (Math.abs(t) > 3) z3++;
          m++;
        }
        return { over3Share: z3 / m, meanZ2: zz / m, values: m };
      };
      const variance = (sc, a, b, mean) => {
        const out = new Float64Array(sc.n * 3);
        for (let p = a; p < b; p++) {
          const c = sc.pass(p);
          for (let i = 0; i < sc.n; i++) for (let ch = 0; ch < 3; ch++) out[3 * i + ch] += (c[4 * i + ch] - mean[3 * i + ch]) ** 2;
        }
        return out.map(x => x / (b - a - 1));
      };
      const Bm = NF.meanOf(ref, zpasses, 2 * zpasses),
        vB = variance(ref, zpasses, 2 * zpasses, Bm);
      const Am = NF.meanOf(ref, 0, zpasses),
        vA = variance(ref, 0, zpasses, Am);
      const Cm = NF.meanOf(vs, 0, zpasses),
        vC = variance(vs, 0, zpasses, Cm);
      rec.z = { n: zpasses, exactVsExact: z(Am, Bm, vA, vB, zpasses), variantVsExact: z(Cm, Bm, vC, vB, zpasses) };
      rec.meanVsExactMean = NF.compare(Cm, Am, k, full); // same frame indices: the paired difference of the means
    }
    row.variants[name] = rec;
  }
  out.scenes.push(row);
  console.log(JSON.stringify(row));
}
const j = flag('--json', null);
if (j) writeFileSync(j, JSON.stringify(out, null, 1));
