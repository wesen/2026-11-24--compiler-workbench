// Candela in the workbench (src/workbench/candela.ts, site-src/candela.js): the data the site bundles, the render
// loop on a stand-in host (span pattern, frame indices, accumulation, stopping), a real frame on two engines compared
// bit for bit, and the gallery as a project. Opening the project hashes a 12,358-statement r0 (about 10 s): that
// test runs with IRWB_FULL=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, W, makeWb, widest } from './helpers.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';
import { candelaSource as toolSource } from '../../tools/candela.mjs';

const dir = join(root, 'corpus/candela-gallery');
const manifest = JSON.parse(readFileSync(join(dir, 'VENDOR.json'), 'utf8'));
const data = {
  commit: manifest.commit,
  sources: manifest.sources,
  files: Object.fromEntries(manifest.sources.map(f => [f, readFileSync(join(dir, f), 'utf8')])),
  scenes: readFileSync(join(dir, 'candela_gallery_scenes.c'), 'utf8'),
};

test('the site bundles Candela and the reference compiler as checked, lazily loaded scripts', () => {
  const out = 'dist/site-candela-test';
  rmSync(join(root, out), { recursive: true, force: true });
  const log = execFileSync(process.execPath, [join(root, 'tools/build-site.mjs'), out], { cwd: root }).toString();
  assert.match(log, /Candela on demand \d+ KiB/);
  const lazy = ['vendor/typed-rv32.js', 'vendor/typed-rv32-inline.js', 'vendor/typed-rv32-loops.js', 'vendor/typed-rv32-kernel.js', 'candela/candela-data.js'];
  for (const f of lazy) assert.ok(existsSync(join(root, out, f)), f);
  // not loaded by the page itself: only the bundle names them, each with the integrity hash of the file written
  const html = readFileSync(join(root, out, 'index.html'), 'utf8');
  const app = readFileSync(join(root, out, 'app.js'), 'utf8');
  for (const f of lazy) {
    assert.ok(!html.includes(f), `index.html loads ${f}`);
    const sri = 'sha384-' + createHash('sha384').update(readFileSync(join(root, out, f))).digest('base64');
    assert.ok(app.includes(sri), `app.js carries the integrity hash of ${f}`);
  }
  // the compiler scripts are the vendored bytes
  const vendor = JSON.parse(readFileSync(join(root, 'vendor/ds-js-os/VENDOR.json'), 'utf8'));
  for (const f of lazy.slice(0, 4)) {
    const entry = vendor.files.find(x => x.path === `compiler/typed/${f.slice(7)}`);
    assert.equal(createHash('sha256').update(readFileSync(join(root, out, f))).digest('hex'), entry.sha256, f);
  }
  // the data script is one assignment of JSON (read here as data, never run)
  const text = readFileSync(join(root, out, 'candela/candela-data.js'), 'utf8');
  const m = /^globalThis\.candelaData = (.*);$/m.exec(text);
  assert.ok(m, 'globalThis.candelaData = {...};');
  const bundled = JSON.parse(m[1]);
  assert.deepEqual(bundled.sources, manifest.sources);
  for (const f of [...manifest.sources, 'candela_gallery_scenes.c']) {
    const bytes = f.endsWith('.c') ? bundled.scenes : bundled.files[f];
    const entry = manifest.files.find(x => x.file === f);
    assert.equal(createHash('sha256').update(bytes, 'utf8').digest('hex'), entry.sha256, f);
  }
  const scenes = W.parseSceneTable(bundled.scenes);
  assert.equal(scenes.length, 18);
  assert.equal(scenes[0].id, 'B-01');
  assert.equal(scenes[0].title, 'Hello, sphere');
  assert.equal(new Set(scenes.map(s => s.id)).size, 18);
  rmSync(join(root, out), { recursive: true, force: true });
});

test('the Candela project: its files in app.json order, the same source as tools/candela.mjs, narrow text', () => {
  assert.equal(W.candelaSource(data), toolSource());
  const p = W.candelaProject(data);
  assert.equal(p.id, 'candela');
  assert.deepEqual(Object.keys(p.files), [...manifest.sources, 'project.json', 'notes.md']);
  const meta = JSON.parse(p.files['project.json']);
  assert.deepEqual(meta.sources, manifest.sources);
  assert.deepEqual(meta.ingest, { tape: true, maxSourceLength: 1 << 22 });
  assert.equal(meta.inputsFrom, 'candela');
  assert.ok(meta.slowPasses);
  assert.ok(widest(p.files['project.json']) <= 72);
  assert.ok(widest(p.files['notes.md']) <= 72);
});

// a stand-in host: each output float encodes (pass frame, y, x, channel) so the loop's bookkeeping can be read back
function fakeHost() {
  const calls = [];
  return {
    calls,
    steps: 0,
    bound: null,
    bind(scene) {
      this.bound = scene.id;
      this.steps += 1000;
    },
    span(y, x0, x1, frame) {
      calls.push([y, x0, x1, frame]);
      this.steps += 10 * (x1 - x0);
      const o = new Float32Array(12 * (x1 - x0));
      for (let x = x0; x < x1; x++) for (let c = 0; c < 12; c++) o[12 * (x - x0) + c] = frame * 1e4 + y * 100 + x + c / 16;
      return o;
    },
  };
}
const scene = { id: 'T-01', title: 'test', width: 16, height: 8, spectral: false };
const now = () => Promise.resolve();

test('renderProgressive: one span per row at stride 1, one per pixel otherwise, as renderScene', async () => {
  const h1 = fakeHost();
  const f1 = await W.renderProgressive(h1, scene, { yieldTo: now });
  assert.deepEqual(h1.calls.map(c => c.join()), Array.from({ length: 8 }, (_, y) => `${y},0,16,0`));
  assert.equal(f1.width, 16);
  assert.equal(f1.frame0[12 * (3 * 16 + 5)], 305);
  const h4 = fakeHost();
  const f4 = await W.renderProgressive(h4, scene, { stride: 4, yieldTo: now });
  assert.equal(h4.calls.length, 4 * 2);
  assert.deepEqual(h4.calls[5], [4, 4, 5, 0]);
  assert.equal(f4.width, 4);
  assert.equal(f4.height, 2);
  assert.equal(f4.frame0[12 * (1 * 4 + 1)], 404); // pixel (1, 1) is scene pixel x 4, y 4: 100 y + x
  assert.equal(f4.skySteps, 1000);
  assert.equal(f4.steps, 80);
  assert.equal(f4.pixelsDone, 8);
});

test('renderProgressive: pass p renders frame 0, then p + 1, and colour is summed as f32', async () => {
  const h = fakeHost();
  const f = await W.renderProgressive(h, scene, { stride: 8, passes: 3, yieldTo: now });
  assert.deepEqual([...new Set(h.calls.map(c => c[3]))], [0, 2, 3]);
  assert.deepEqual([0, 1, 2, 3, 4].map(W.frameOf), [0, 2, 3, 4, 5]);
  assert.equal(f.passesDone, 3);
  assert.deepEqual([...f.count], [3]);
  const one = v => Math.fround(v);
  const x = 1; // the second pixel: scene x 8, y 0
  assert.equal(f.acc[4 * x], one(one(one(0 + 8) + one(2e4 + 8)) + one(3e4 + 8)));
  assert.equal(f.frame0[12 * x], 8, 'the other views come from pass 0');
  const rgba = W.frameImage(f, 'colour');
  assert.equal(rgba.length, 4 * f.width * f.height);
});

test('renderProgressive stops when asked, and keeps what it rendered', async () => {
  const h = fakeHost();
  const signal = { aborted: false };
  const seen = [];
  const f = await W.renderProgressive(h, scene, {
    signal,
    slice: 0,
    yieldTo: now,
    onProgress: p => {
      seen.push(p.phase);
      if (p.phase === 'rows' && p.row === 3) signal.aborted = true;
    },
  });
  assert.equal(f.stopped, true);
  assert.equal(f.passesDone, 0);
  assert.deepEqual([...f.count], [1, 1, 1, 0, 0, 0, 0, 0]);
  assert.equal(seen[0], 'sky');
  assert.equal(seen.at(-1), 'stopped');
});

test('compareFrames counts differing bits, and compares the colour sums only over the same passes', async () => {
  const a = await W.renderProgressive(fakeHost(), scene, { stride: 4, yieldTo: now });
  const b = await W.renderProgressive(fakeHost(), scene, { stride: 4, yieldTo: now });
  assert.deepEqual(W.compareFrames(a, b), { floats: 96, different: 0, accFloats: 32, accDifferent: 0 });
  b.frame0[7] = -0; // +0 and -0 are equal as numbers, not as bits
  a.frame0[7] = 0;
  assert.equal(W.compareFrames(a, b).different, 1);
  const c = await W.renderProgressive(fakeHost(), scene, { stride: 4, passes: 2, yieldTo: now });
  assert.equal(W.compareFrames(a, c).accDifferent, null);
  assert.equal(W.compareFrames(a, await W.renderProgressive(fakeHost(), scene, { stride: 8, yieldTo: now })), null);
});

test('B-01 at stride 32: the emulator and the evaluator at r0 give the same floats', async () => {
  await installVendor({ reference: true });
  const scenes = W.parseSceneTable(data.scenes);
  const source = W.candelaSource(data);
  const em = W.referenceEngine(source, 'kernel');
  assert.equal(em.unit, 'instructions');
  const a = await W.renderProgressive(W.candelaHost(em), scenes[0], { stride: 32, yieldTo: now });
  const ev = W.evaluatorEngine(W.liftCandela(source), 'evaluator · r0');
  const b = await W.renderProgressive(W.candelaHost(ev), scenes[0], { stride: 32, yieldTo: now });
  assert.equal(a.width, 5);
  assert.equal(a.skySteps, 5520419); // the sky table on the kernel image, as in the browser
  assert.deepEqual(W.compareFrames(a, b), { floats: 300, different: 0, accFloats: 100, accDifferent: 0 });
  assert.equal(W.referenceEngine(source, 'kernel').setupMs, 0, 'the image is compiled once');
});

test('Candela opens as a project: ingested from the tape, check inputs derived (IRWB_FULL=1)', { skip: !process.env.IRWB_FULL, timeout: 600e3 }, () => {
  const { wb } = makeWb();
  wb._projects.addBuiltin(W.candelaProject(data));
  const pr = wb.projects.open('candela');
  assert.equal(pr.title, 'Candela gallery');
  const p = wb.current;
  assert.equal(p.status, 'ok');
  assert.equal(p.fns().length, 332);
  assert.ok(Object.keys(p._p.k.options.inputs).includes('cdlRenderSpan'));
});
