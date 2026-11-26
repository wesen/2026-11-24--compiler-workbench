// The JavaScript side of the exhaustive check: per function and chunk of 2^20 f32 inputs, the same hash as the GPU
// (sum of canonical bits(fround(Math.f(x))) * (2i + 1) mod 2^32). Prints the chunks whose hashes differ.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
const FNS = [Math.exp, Math.log, Math.tanh];
if (isMainThread) {
  const gpu = new Uint32Array(fs.readFileSync(new URL('./gpu-hash/out/hashes.bin', import.meta.url)).buffer.slice(0));
  const W = 8, js = new Uint32Array(3 * 4096), t0 = Date.now();
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise((res, rej) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { w, W } });
    wk.on('message', m => { for (const [k, v] of m) js[k] = v; res(); });
    wk.on('error', rej);
  })));
  const bad = { exp: [], log: [], tanh: [] };
  ['exp', 'log', 'tanh'].forEach((n, fn) => { for (let c = 0; c < 4096; c++) if (js[fn * 4096 + c] !== gpu[fn * 4096 + c]) bad[n].push(c); });
  console.log(`seconds ${((Date.now() - t0) / 1000).toFixed(0)}; chunks with differing hashes:`, JSON.stringify(bad));
  fs.writeFileSync(new URL('./bad-chunks.json', import.meta.url), JSON.stringify(bad));
} else {
  const { w, W } = workerData, u = new Uint32Array(1), fl = new Float32Array(u.buffer), out = [];
  for (let fn = 0; fn < 3; fn++) {
    const F = FNS[fn];
    for (let c = w; c < 4096; c += W) {
      let h = 0;
      for (let i = 0; i < 1 << 20; i++) {
        u[0] = (c << 20 | i) >>> 0;
        const y = Math.fround(F(fl[0]));
        fl[0] = y;
        const b = y !== y ? 0x7fc00000 : u[0];
        h = (h + Math.imul(b, 2 * i + 1)) | 0;
      }
      out.push([fn * 4096 + c, h >>> 0]);
    }
  }
  parentPort.postMessage(out);
}
