// IRWB-011: render several passes of Candela gallery scenes, as the gallery accumulates them, and save the colour
// output of every pass, so that the Monte Carlo noise floor can be measured (scripts/02-noise-floor.mjs).
//
//   node scripts/01-render-passes.mjs --scenes B-01,R-01 [--passes 16] [--stride 8] [--small-stride 4]
//        [--engine reference|evaluator] [--policy kernel] [--out-dir various/01-passes]
//
// A pass is one sample per pixel. Pass p uses Candela's frame index 0 for p = 0 and p + 1 afterwards, as the gallery
// does (ds-js-os firmware/nucleus/candela_gallery.c: cg_frame_index). The frame index seeds each pixel's random
// sequence (corpus/candela-gallery/kernel.typed:2603), and nothing else differs between passes.
// Each scene is bound once (cdlSky once), then every pass renders every stride-th pixel with cdlRenderSpan.
// Output per scene: <out-dir>/<scene>.f32 (passes x pixels x 4 colour floats, little-endian) and <scene>.json.
//
// Candela-scale: run under the memory cap, one process at a time:
//   systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const { engineFor, candelaScenes } = await import(join(root, 'tools/candela-render.mjs'));
const R = await import(join(root, 'dist/typed/candela-render.js'));

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const wanted = flag('--scenes', 'B-01').split(',');
const passes = +flag('--passes', 16),
  stride = +flag('--stride', 8),
  smallStride = +flag('--small-stride', 4),
  kind = flag('--engine', 'reference'),
  policy = flag('--policy', 'kernel'),
  outDir = flag('--out-dir', join(here, '../various/01-passes'));
mkdirSync(outDir, { recursive: true });

const frameIndex = p => (p === 0 ? 0 : p + 1);
const scenes = candelaScenes();
const t0 = performance.now();
const engine = await engineFor(kind, { policy });
const host = new R.CandelaHost(engine);
process.stderr.write(`engine ${kind}/${policy} ready in ${Math.round(performance.now() - t0)} ms\n`);

for (const id of wanted) {
  const scene = scenes.find(s => s.id === id);
  if (!scene) throw new Error(`no scene ${id}`);
  const s = scene.width >= 160 ? stride : smallStride;
  const w = Math.ceil(scene.width / s),
    h = Math.ceil(scene.height / s),
    n = w * h;
  const tb = performance.now();
  host.bind(scene);
  const bindMs = performance.now() - tb;
  const colour = new Float32Array(passes * n * 4);
  const perPass = [];
  for (let p = 0; p < passes; p++) {
    const frame = frameIndex(p),
      before = host.steps,
      tp = performance.now();
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const px = host.span(j * s, i * s, i * s + 1, frame);
        colour.set(px.subarray(0, 4), (p * n + j * w + i) * 4);
      }
    perPass.push({ pass: p, frame, steps: host.steps - before, ms: Math.round(performance.now() - tp) });
    process.stderr.write(`\r${id} pass ${p + 1}/${passes} frame ${frame}`);
  }
  process.stderr.write('\n');
  writeFileSync(join(outDir, `${id}.f32`), Buffer.from(colour.buffer));
  const meta = {
    scene: id,
    title: scene.title,
    index: scene.index,
    spectral: scene.spectral,
    sceneSize: [scene.width, scene.height],
    stride: s,
    size: [w, h],
    passes,
    frames: perPass.map(x => x.frame),
    engine: kind,
    policy: kind === 'reference' ? policy : undefined,
    layout: 'Float32 little-endian, [pass][pixel row-major][r, g, b, a] (cdl_pixout colour)',
    bindMs: Math.round(bindMs),
    stepsPerPass: perPass.map(x => x.steps),
    msPerPass: perPass.map(x => x.ms),
    nonFinite: colour.filter(x => !Number.isFinite(x)).length,
  };
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify(meta, null, 1));
  console.log(JSON.stringify({ scene: id, stride: s, size: [w, h], passes, bindMs: meta.bindMs, msTotal: perPass.reduce((a, x) => a + x.ms, 0), stepsPass0: perPass[0].steps, nonFinite: meta.nonFinite }));
}
