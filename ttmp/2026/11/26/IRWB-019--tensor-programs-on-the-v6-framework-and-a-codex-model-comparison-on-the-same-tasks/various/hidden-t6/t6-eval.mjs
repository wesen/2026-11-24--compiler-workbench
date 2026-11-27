#!/usr/bin/env node
// IRWB-019 stage-6 (exact tiled contractions) hidden evaluation, written from the T6 brief before any T6 work existed.
//   node t6-eval.mjs run <out.json> <worktree>...   one child per worktree, sequentially (run after every agent exited)
//   node t6-eval.mjs worker <worktree>              prints JSON
// Per implementation:
//   t3b: the whole stage-3b hidden evaluation (hidden-t3b/t3b-eval.mjs worker), so nothing that fusion gained is lost:
//        correctness on the corpus, optimized and random programs, checkLowering, and benchmark times on nine programs;
//   contractions: benchmark (median of five calls, the T9 protocol) of the fused default lowering against stage 2's
//        (`fuse: false`), and bits against a reference, for
//          matmul 512^3 and 4096^3 (named in the brief), mlp's and attention's shapes (in the T3 set above),
//          held-out shapes and programs not in the brief: matmul 1000^3, 777x333x555, 1x4096x4096 (a matrix-vector
//          product), 4096x16x4096 (short K), and a batched matmul c[b, i, j] = sum(k) a[b, i, k] * w[b, k, j], 8x256^3;
//        the reference is the merged stage-1 interpreter, except for 4096^3, where it is stage 2's GPU output (bit-exact
//        by construction and by T2's evaluation);
//        plus checkLowering (fused) on each program at its own small cases.
//   TFLOP/s = 2 M N K / time; against cuBLAS (pedantic FP32): 512^3 0.0329 ms, 4096^3 at 19.2 TFLOP/s (diary step 26).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const T3B = path.join(HERE, '..', 'hidden-t3b', 't3b-eval.mjs');
const REF_WT = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-am-irwb-020-b';
const MM = `fn matmul(a: f32[M, K], b: f32[K, N]): f32[M, N] {
  c[i, j] = sum(k) a[i, k] * b[k, j];
  return c;
}`;
const BMM = `fn bmm(a: f32[B, M, K], w: f32[B, K, N]): f32[B, M, N] {
  c[b, i, j] = sum(k) a[b, i, k] * w[b, k, j];
  return c;
}`;
const CASES = [
  { name: 'mm512', src: MM, fn: 'matmul', dims: [512, 512, 512], cublasMs: 0.0329 },
  { name: 'mm4096', src: MM, fn: 'matmul', dims: [4096, 4096, 4096], cublasMs: (2 * 4096 ** 3) / 19.2e9, refFromUnfused: true },
  { name: 'mm1000', src: MM, fn: 'matmul', dims: [1000, 1000, 1000], heldOut: true },
  { name: 'mm777x333x555', src: MM, fn: 'matmul', dims: [777, 333, 555], heldOut: true },
  { name: 'mv1x4096x4096', src: MM, fn: 'matmul', dims: [1, 4096, 4096], heldOut: true },
  { name: 'mm4096x16x4096', src: MM, fn: 'matmul', dims: [4096, 16, 4096], heldOut: true },
  { name: 'bmm8x256', src: BMM, fn: 'bmm', dims: [8, 256, 256, 256], heldOut: true },
];
const flops = c => (c.fn === 'bmm' ? 2 * c.dims.reduce((a, b) => a * b, 1) : 2 * c.dims[0] * c.dims[1] * c.dims[2]);
const inputs = (c, seed) => {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const mk = shape => { const n = shape.reduce((a, b) => a * b, 1), data = new Float32Array(n); for (let j = 0; j < n; j++) data[j] = rnd(); return { shape, data }; };
  if (c.fn === 'bmm') { const [B, M, K, N] = c.dims; return { a: mk([B, M, K]), w: mk([B, K, N]) }; }
  const [M, K, N] = c.dims; return { a: mk([M, K]), b: mk([K, N]) };
};
const bits = a => new Uint32Array(Float32Array.from(a).buffer);
const exact = (got, want) => {
  const g = bits(got.data), w = bits(want.data);
  let k = 0;
  for (let i = 0; i < w.length; i++) if (g[i] === w[i] || (Number.isNaN(got.data[i]) && Number.isNaN(want.data[i]))) k++;
  return { n: w.length, bitExact: k, shapeOk: JSON.stringify(Array.from(got.shape)) === JSON.stringify(Array.from(want.shape)) };
};
const median = xs => { const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const err = e => String(e?.message ?? e).slice(0, 240);
const [mode, ...rest] = process.argv.slice(2);

if (mode === 'worker') {
  const [wt] = rest;
  const t0 = Date.now();
  const r3 = spawnSync(process.execPath, [T3B, 'worker', wt], { encoding: 'utf8', timeout: 10800000, maxBuffer: 1 << 28 });
  let t3b;
  try { t3b = JSON.parse(r3.stdout); } catch { t3b = { error: (r3.stderr || 'no output').slice(-600) }; }
  const api = await import(pathToFileURL(path.join(wt, 'dist/tensor/index.js')).href);
  const ref = await import(pathToFileURL(path.join(REF_WT, 'dist/tensor/index.js')).href);
  const contractions = {};
  for (const c of CASES) {
    const out = { dims: c.dims, heldOut: !!c.heldOut };
    try {
      const inp = inputs(c, 404), p = api.compileTix(c.src);
      const times = {};
      let fusedLast, unfusedLast;
      for (const fuse of [true, false]) {
        const ms = [];
        for (let k = 0; k < 5; k++) {
          const r = await api.runTixCuda(p, c.fn, inp, { fuse, benchmark: true });
          ms.push(r.gpuMs);
          if (fuse) fusedLast = r; else unfusedLast = r;
        }
        times[fuse ? 'fused' : 'unfused'] = { gpuMs: median(ms), runs: ms };
      }
      // The interpreter takes minutes on the larger held-out shapes (about 3.4M multiply-adds per second), so its
      // outputs are computed once and cached beside this script, keyed by case name (inputs are seeded).
      let want;
      if (c.refFromUnfused) want = unfusedLast;
      else {
        const cf = path.join(HERE, 'ref-cache', c.name + '.json');
        if (fs.existsSync(cf)) { const j = JSON.parse(fs.readFileSync(cf, 'utf8')); want = { shape: j.shape, data: new Float32Array(new Uint32Array(j.bits).buffer) }; }
        else {
          const w = ref.runTix(ref.compileTix(c.src), c.fn, inp);
          fs.mkdirSync(path.dirname(cf), { recursive: true });
          fs.writeFileSync(cf, JSON.stringify({ shape: Array.from(w.shape), bits: Array.from(bits(w.data)) }));
          want = w;
        }
      }
      out.fused = { ...times.fused, ...exact(fusedLast, want), tflops: flops(c) / (times.fused.gpuMs * 1e9) };
      out.unfused = { ...times.unfused, ...(c.refFromUnfused ? {} : exact(unfusedLast, want)), tflops: flops(c) / (times.unfused.gpuMs * 1e9) };
      if (c.cublasMs) out.vsCublas = times.fused.gpuMs / c.cublasMs;
      const v = await api.checkLowering(p, c.fn);
      out.check = { accepted: v.accepted, relation: v.relation, reason: v.reason ? String(v.reason).slice(0, 200) : undefined };
    } catch (e) { out.error = err(e); }
    contractions[c.name] = out;
  }
  process.stdout.write(JSON.stringify({ t3b, contractions, seconds: +((Date.now() - t0) / 1000).toFixed(1) }), () => process.exit(0));
} else if (mode === 'run') {
  const [outFile, ...wts] = rest;
  const all = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  for (const wt of wts) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, 'worker', wt], { encoding: 'utf8', timeout: 14400000, maxBuffer: 1 << 28 });
    let res;
    try { res = JSON.parse(r.stdout); } catch { res = { error: (r.stderr || r.error?.message || 'no output').slice(-600) }; }
    all[path.basename(wt)] = res;
    fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
    if (res.error) { console.log(`${path.basename(wt)}: worker failed: ${res.error.slice(-300)}`); continue; }
    const x = Object.entries(res.contractions).map(([n, v]) => v.error ? `${n} error` : `${n} ${v.fused.gpuMs.toFixed(3)}/${v.unfused.gpuMs.toFixed(3)} ms ${v.fused.tflops.toFixed(2)} TF${v.vsCublas ? ` ${v.vsCublas.toFixed(2)}x cuBLAS` : ''}${v.fused.bitExact === v.fused.n ? '' : ' INEXACT'}${v.check.accepted && v.check.relation === 'exact' ? '' : ' CHECK-' + v.check.relation}`).join(' | ');
    console.log(`${path.basename(wt).padEnd(24)} ${res.seconds}s`);
    console.log(`  contractions fused/unfused: ${x}`);
  }
}
