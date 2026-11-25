// Render a Candela gallery scene with the Typed Candela program and write a PNG.
//   node tools/candela-render.mjs [--scene B-01|0] [--engine reference|evaluator] [--policy kernel|stock]
//                                 [--stride N] [--head head.json] [--exposure E] [--view colour|albedo|normal|depth]
//                                 [--out file.png] [--list]   (writes one PNG per view when --view all)
// reference: the reference compiler's RV32 image on the RV32 interpreter (the emulator).
// evaluator: this compiler's evaluator on typed.blocks (r0, or the revision saved by candela-o2.mjs --save).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { installVendor } from './node-vendor.mjs';
import { candelaDir, candelaManifest, candelaSource, MAX_SOURCE } from './candela.mjs';

await installVendor({ reference: true });
const R = await import('../dist/typed/candela-render.js');

/** The vendored scene table, digest-checked against VENDOR.json. */
export function candelaScenes() {
  const f = 'candela_gallery_scenes.c', entry = candelaManifest.files.find(x => x.file === f);
  const text = readFileSync(join(candelaDir, f));
  const digest = createHash('sha256').update(text).digest('hex');
  if (!entry || digest !== entry.sha256) throw new Error(`${f}: sha256 ${digest} does not match VENDOR.json`);
  return R.parseSceneTable(text.toString('utf8'));
}

export async function engineFor(kind, { policy = 'kernel', head = null } = {}) {
  const source = candelaSource();
  if (kind === 'reference') {
    const { referenceCompile, referenceRun } = await import('../dist/typed/reference.js');
    const program = referenceCompile(source, { maxSourceLength: MAX_SOURCE, policy });
    return (name, args, mem) => referenceRun(program, name, args, mem, { limit: 4e9 });
  }
  if (kind === 'evaluator') {
    const { evaluate } = await import('../dist/typed/evaluate.js');
    const { Store } = await import('../dist/typed/model.js');
    let st;
    if (head) st = Store.from(JSON.parse(readFileSync(head, 'utf8')).value ?? JSON.parse(readFileSync(head, 'utf8')));
    else st = (await import('../dist/typed/lift.js')).ingest('candela', source, { tape: true, maxSourceLength: MAX_SOURCE });
    return (name, args, mem) => evaluate(st, name, args, mem, { limit: 2e9 });
  }
  throw new Error(`unknown engine ${kind}`);
}

export function png(width, height, rgba8) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((4 * width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (4 * width + 1)] = 0; Buffer.from(rgba8.buffer, rgba8.byteOffset + 4 * width * y, 4 * width).copy(raw, y * (4 * width + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const scenes = candelaScenes();
  if (args.includes('--list')) { for (const s of scenes) console.log(s.index, s.id, `${s.width}x${s.height}`, s.spectral ? 'spectral' : '', s.title); process.exit(0); }
  const want = flag('--scene', 'B-01'), scene = scenes.find(s => s.id === want || String(s.index) === want);
  if (!scene) throw new Error(`no scene ${want}`);
  const kind = flag('--engine', 'reference'), stride = +flag('--stride', 4);
  const exposure = args.includes('--exposure') ? +flag('--exposure') : undefined, view = flag('--view', 'all');
  const t0 = performance.now();
  const engine = await engineFor(kind, { policy: flag('--policy', 'kernel'), head: flag('--head', null) });
  const t1 = performance.now();
  const host = new R.CandelaHost(engine);
  const img = R.renderScene(host, scene, { stride, onRow: (y, done, rows) => process.stderr.write(`\r${scene.id} row ${done}/${rows}`) });
  const t2 = performance.now();
  process.stderr.write('\n');
  const out = flag('--out', `candela-${scene.id}-${kind}.png`);
  const views = view === 'all' ? ['colour', 'albedo', 'normal', 'depth'] : [view];
  const files = views.map(v => { const f = views.length > 1 ? out.replace(/\.png$/, `-${v}.png`) : out; writeFileSync(f, png(img.width, img.height, R.viewImage(img, v, exposure))); return f; });
  const nan = img.pixels.filter(x => !Number.isFinite(x)).length;
  console.log(JSON.stringify({ scene: scene.id, title: scene.title, engine: kind, size: [img.width, img.height], stride, steps: img.steps, stepsPerPixel: Math.round(img.steps / (img.width * img.height)), setupMs: Math.round(t1 - t0), renderMs: Math.round(t2 - t1), nonFinite: nan, files }));
}
