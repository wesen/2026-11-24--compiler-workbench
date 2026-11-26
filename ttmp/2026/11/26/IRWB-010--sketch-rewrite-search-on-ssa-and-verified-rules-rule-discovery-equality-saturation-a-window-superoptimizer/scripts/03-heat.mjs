// IRWB-010: where a frame's executed instructions go, per function and per kind of value, in this compiler's own
// RV32 image of Candela r0 and of the O2 head (default backend options), for scenes that call fbm3 and noise3.
//
//   node scripts/03-heat.mjs --dir <dir with r0.json, o2.json> [--scenes X-03,V-04] [--stride 8] [--json out.json]
//
// The frame is pass 0 (frame index 0), every stride-th pixel; counts are taken after the scene is bound, so the
// layout, init and sky-table calls are excluded. Each instruction's count is attributed to its function (ImageInsn.fn)
// and to the value it covers (covers[0], a typed.blocks value id) where it covers one. Reported per revision:
//   - instructions per pixel; the share of the frame in noise3, fbm3, gnoise, hash3, q_floor, q_fract;
//   - in those functions: executions of instructions that build f32 constants (they cover a const value), of calls,
//     and of fadd.s/fsub.s whose value has an fmul operand (each is one instruction a fused multiply-add saves);
//   - the same fusable count over the whole frame.
// Loads, lowers and renders Candela: run under the memory cap, one process at a time.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { engineFor: _unused, candelaScenes } = await import(root + 'tools/candela-render.mjs');
const R = await import(root + 'dist/typed/candela-render.js');
const { lowerToImage, runImage } = await import(root + 'dist/typed/backend/index.js');
const { blocksAdapter } = await import(root + 'dist/typed/ir.js');
const { createIRArtifact } = await import(root + 'dist/framework/ir/index.js');

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dir = flag('--dir', '.'),
  stride = +flag('--stride', 8),
  wanted = flag('--scenes', 'X-03,V-04').split(',');
const FOCUS = ['noise3', 'fbm3', 'gnoise', 'hash3', 'q_floor', 'q_fract'];
const scenes = candelaScenes();
const out = [];

for (const [rev, file] of [
  ['r0', 'r0.json'],
  ['O2', 'o2.json'],
]) {
  const native = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const t0 = performance.now();
  const art = createIRArtifact(blocksAdapter, 'candela', native);
  const lowered = lowerToImage(art).image;
  const image = lowered.value ?? lowered;
  const lowerMs = Math.round(performance.now() - t0);
  const values = native.values;
  const counts = new Float64Array(image.bytes / 4);
  let counting = false;
  const engine = (name, a, mem) => {
    const r = runImage(image, name, a, mem, { limit: 4e9, counts: counting });
    if (counting && r.counts) for (let i = 0; i < r.counts.length; i++) counts[i] += r.counts[i];
    return { ...r, counts: null };
  };
  const host = new R.CandelaHost(engine);
  for (const id of wanted) {
    const scene = scenes.find(s => s.id === id);
    const s = scene.width >= 160 ? stride : stride / 2;
    const w = Math.ceil(scene.width / s),
      h = Math.ceil(scene.height / s);
    host.bind(scene);
    counts.fill(0);
    counting = true;
    const before = host.steps,
      tr = performance.now();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) host.span(j * s, i * s, i * s + 1, 0);
    counting = false;
    const steps = host.steps - before;
    const byFn = {},
      focus = Object.fromEntries(FOCUS.map(f => [f, { insns: 0, constBuild: 0, calls: 0, fusable: 0, byOp: {} }]));
    let fusableAll = 0,
      constAll = 0,
      total = 0;
    for (const ins of image.insns) {
      const n = counts[ins.offset >>> 2];
      if (!n) continue;
      total += n;
      byFn[ins.fn] = (byFn[ins.fn] || 0) + n;
      const v = ins.covers[0] && values[ins.covers[0]];
      const isConst = v && v.op === 'const' && v.type === 'f32';
      const fusable =
        (ins.op === 'fadd.s' || ins.op === 'fsub.s') &&
        v &&
        (v.op === 'fadd' || v.op === 'fsub') &&
        v.args.some(a => values[a]?.op === 'fmul');
      if (fusable) fusableAll += n;
      if (isConst) constAll += n;
      const f = focus[ins.fn];
      if (f) {
        f.insns += n;
        f.byOp[ins.op] = (f.byOp[ins.op] || 0) + n;
        if (isConst) f.constBuild += n;
        if (ins.op === 'call' || ins.op === 'jal') f.calls += n;
        if (fusable) f.fusable += n;
      }
    }
    const top = Object.entries(byFn)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([fn, n]) => ({ fn, n, share: n / total }));
    for (const f of Object.values(focus)) f.byOp = Object.fromEntries(Object.entries(f.byOp).sort((a, b) => b[1] - a[1]).slice(0, 10));
    const row = {
      rev,
      scene: id,
      stride: s,
      pixels: w * h,
      lowerMs,
      renderMs: Math.round(performance.now() - tr),
      steps,
      counted: total,
      perPixel: Math.round(steps / (w * h)),
      focusShare: FOCUS.reduce((a, f) => a + focus[f].insns, 0) / total,
      focus,
      fusableAll,
      fusableShare: fusableAll / total,
      f32ConstBuildAll: constAll,
      top,
      imageBytes: image.bytes,
    };
    out.push(row);
    console.log(
      JSON.stringify({ rev, scene: id, perPixel: row.perPixel, focusShare: +row.focusShare.toFixed(4), fusableShare: +row.fusableShare.toFixed(4), noise3: focus.noise3.insns, fbm3: focus.fbm3.insns, top3: top.slice(0, 3) }),
    );
  }
}
const j = flag('--json', null);
if (j) writeFileSync(j, JSON.stringify(out, null, 1));
