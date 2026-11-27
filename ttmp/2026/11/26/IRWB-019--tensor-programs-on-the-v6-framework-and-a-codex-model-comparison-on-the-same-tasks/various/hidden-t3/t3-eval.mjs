#!/usr/bin/env node
// IRWB-019 stage-3 (checked fusion) hidden evaluation, written from the T3 brief before any stage-3 work existed.
// Adapted from hidden-t2/t2-eval.mjs.
//   node t3-eval.mjs run <out.json> <worktree>...      one child process per worktree, sequentially (no GPU contention
//                                                      between implementations; run it after every agent has exited)
//   node t3-eval.mjs worker <worktree>                 prints JSON
// Reference: the merged stage-1 interpreter (IRWB-020-B's dist); the random programs carry their own reference bits.
// It measures, per implementation, on the brief's fixed API:
//   corpus (six programs, small sizes): fused (the default) and unfused GPU bits against the f32 meaning;
//   optimized: optimizeTix(['inline', 'split-sum']) then the fused lowering, against the implementation's own f32 run;
//   random (the first 20 cross-check programs, case 0): fused bits against the reference bits;
//   check: checkLowering (fused, the default) on the six programs and 10 random ones: accepted, relation, time;
//   kernels: `__global__` definitions in cudaSource, fused and with { fuse: false };
//   large (the brief's sizes): benchmark GPU time, fused and unfused, the median of three benchmark calls (each itself
//     a warm-up and the median of three timed runs), and fused bits against the f32 meaning on every element.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const T1 = path.join(HERE, '..', 'hidden-t1');
const REF_WT = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-am-irwb-020-b';
const [mode, ...rest] = process.argv.slice(2);

const suiteText = fs.readFileSync(path.join(T1, 'acceptance.test.mjs'), 'utf8');
const SRC = new Function(`return ${suiteText.match(/const SRC = (\{[\s\S]*?\n\});/)[1]}`)();
const PARAMS = { matmul: ['a', 'b'], softmax: ['x'], layernorm: ['x', 'g', 'b'], attention: ['q', 'k', 'v'], mlp: ['x', 'w1', 'b1', 'w2', 'b2'], conv: ['a', 'w'] };
const SMALL = { matmul: [[5, 33], [33, 7]], softmax: [[4, 19]], layernorm: [[3, 24], [24], [24]], attention: [[9, 8], [9, 8], [9, 8]], mlp: [[3, 8], [8, 12], [12], [12, 8], [8]], conv: [[2, 3, 7, 6], [4, 3, 3, 3]] };
const LARGE = { matmul: [[512, 512], [512, 512]], softmax: [[4096, 1024]], layernorm: [[4096, 1024], [1024], [1024]], attention: [[1024, 64], [1024, 64], [1024, 64]], mlp: [[1024, 256], [256, 1024], [1024], [1024, 256], [256]], conv: [[8, 16, 64, 64], [32, 16, 3, 3]] };

function inputsFor(name, shapes, seed) {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const scale = { softmax: 6, layernorm: 3 }[name] ?? 1, shift = name === 'layernorm' ? 0.5 : 0;
  return Object.fromEntries(PARAMS[name].map((p, i) => {
    const n = shapes[i].reduce((a, b) => a * b, 1), data = new Float32Array(n);
    for (let j = 0; j < n; j++) data[j] = i === 0 ? rnd() * scale + shift : rnd();
    return [p, { shape: shapes[i], data }];
  }));
}
const bits = a => new Uint32Array(Float32Array.from(a).buffer);
// bit-exact count; NaN as a class (the GB10 and V8 produce different NaN words)
function compare(got, want32) {
  const out = { shapeOk: JSON.stringify(Array.from(got.shape)) === JSON.stringify(Array.from(want32.shape)), bitExact: 0, n: want32.data.length, max32: 0 };
  if (!out.shapeOk) return out;
  const g = bits(got.data), w = bits(want32.data);
  for (let i = 0; i < out.n; i++) {
    if (g[i] === w[i] || (Number.isNaN(got.data[i]) && Number.isNaN(want32.data[i]))) out.bitExact++;
    const d = Math.abs(got.data[i] - want32.data[i]) / Math.max(1, Math.abs(want32.data[i]));
    out.max32 = Math.max(out.max32, Number.isNaN(d) ? (Number.isNaN(got.data[i]) && Number.isNaN(want32.data[i]) ? 0 : Infinity) : d);
  }
  return out;
}
const withTimeout = (p, ms, label) => {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: timeout ${ms} ms`)), ms); t.unref?.(); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
};
const err = e => String(e?.message ?? e).slice(0, 240);
const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const kernels = src => (String(src).match(/__global__/g) ?? []).length;

if (mode === 'worker') {
  const [wt] = rest;
  const api = await import(pathToFileURL(path.join(wt, 'dist/tensor/index.js')).href);
  const ref = await import(pathToFileURL(path.join(REF_WT, 'dist/tensor/index.js')).href);
  const res = { api: ['cudaSource', 'runTixCuda', 'checkLowering'].filter(k => typeof api[k] === 'function'), corpus: {}, unfused: {}, optimized: {}, random: [], check: {}, kernels: {}, large: {} };
  const t0 = Date.now();
  for (const name of Object.keys(SRC)) {
    const inp = inputsFor(name, SMALL[name], 101), rp = ref.compileTix(SRC[name]);
    const w32 = ref.runTix(rp, name, inp);
    for (const [key, opts] of [['corpus', {}], ['unfused', { fuse: false }]]) {
      try {
        const g = await withTimeout(api.runTixCuda(api.compileTix(SRC[name]), name, inp, opts), 300000, `${name} ${key}`);
        res[key][name] = compare(g, w32);
      } catch (e) { res[key][name] = { error: err(e) }; }
    }
    try {
      const p = api.compileTix(SRC[name]);
      res.kernels[name] = { fused: kernels(api.cudaSource(p, name)), unfused: kernels(api.cudaSource(p, name, { fuse: false })) };
    } catch (e) { res.kernels[name] = { error: err(e) }; }
    if (['matmul', 'softmax', 'attention', 'mlp'].includes(name)) {
      try {
        const o = api.optimizeTix(api.compileTix(SRC[name]), ['inline', 'split-sum']);
        const own32 = api.runTix(o.program, name, inp);
        const g = await withTimeout(api.runTixCuda(o.program, name, inp), 300000, `${name} optimized`);
        res.optimized[name] = { steps: o.steps.map(s => `${s.pass}:${s.accepted}:${s.changed}`), ...compare(g, own32) };
      } catch (e) { res.optimized[name] = { error: err(e) }; }
    }
  }
  const programs = JSON.parse(fs.readFileSync(path.join(T1, 'programs.json'), 'utf8'));
  const INPUTS = { x: ['N', 'C'], u: ['N'], v: ['C'] };
  for (const [i, p] of programs.slice(0, 20).entries()) {
    const c = p.cases[0];
    const inp = Object.fromEntries(Object.entries(INPUTS).map(([k, dims]) => [k, { shape: dims.map(d => c.sizes[d]), data: Float32Array.from(c.inputs[k]) }]));
    const w32 = { shape: c.shape, data: new Float32Array(new Uint32Array(c.f32bits).buffer) };
    try {
      const g = await withTimeout(api.runTixCuda(api.compileTix(p.source), 'g', inp), 300000, `random ${i}`);
      res.random.push({ i, ...compare(g, w32) });
    } catch (e) { res.random.push({ i, error: err(e) }); }
  }
  const checks = [...Object.keys(SRC).map(n => [n, SRC[n], n]), ...programs.slice(0, 10).map((p, i) => [`random${i}`, p.source, 'g'])];
  for (const [label, src, fn] of checks) {
    const t = Date.now();
    try { const v = await withTimeout(api.checkLowering(api.compileTix(src), fn), 600000, `check ${label}`); res.check[label] = { accepted: v.accepted, relation: v.relation, reason: v.reason ? String(v.reason).slice(0, 160) : undefined, ms: Date.now() - t }; }
    catch (e) { res.check[label] = { error: err(e), ms: Date.now() - t }; }
  }
  const cache = path.join(HERE, 'large-ref');
  fs.mkdirSync(cache, { recursive: true });
  for (const name of Object.keys(SRC)) {
    const inp = inputsFor(name, LARGE[name], 202);
    const cf = path.join(cache, `${name}.f32`);
    let w32;
    if (fs.existsSync(cf)) w32 = JSON.parse(fs.readFileSync(cf, 'utf8')), w32.data = new Float32Array(new Uint32Array(w32.bits).buffer);
    else { const r = ref.runTix(ref.compileTix(SRC[name]), name, inp); fs.writeFileSync(cf, JSON.stringify({ shape: Array.from(r.shape), bits: Array.from(bits(r.data)) })); w32 = { shape: Array.from(r.shape), data: Float32Array.from(r.data) }; }
    const out = {};
    for (const [key, fuse] of [['fused', true], ['unfused', false]]) {
      try {
        const ms = [];
        let last;
        for (let k = 0; k < 3; k++) {
          last = await withTimeout(api.runTixCuda(api.compileTix(SRC[name]), name, inp, { fuse, benchmark: true }), 600000, `${name} large ${key}`);
          ms.push(last.gpuMs);
        }
        out[key] = { gpuMs: median(ms), runs: ms, ...(fuse ? compare(last, w32) : {}) };
      } catch (e) { out[key] = { error: err(e) }; }
    }
    res.large[name] = out;
  }
  res.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(JSON.stringify(res), () => process.exit(0));
} else if (mode === 'run') {
  const [outFile, ...wts] = rest;
  const all = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  for (const wt of wts) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, 'worker', wt], { encoding: 'utf8', timeout: 7200000, maxBuffer: 1 << 28 });
    let res;
    try { res = JSON.parse(r.stdout); } catch { res = { error: (r.stderr || r.error?.message || 'no output').slice(-600) }; }
    all[path.basename(wt)] = res;
    fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
    if (res.error) { console.log(`${path.basename(wt)}: worker failed: ${res.error.slice(-300)}`); continue; }
    const exact = xs => xs.filter(x => x.shapeOk && x.bitExact === x.n).length;
    const checks = Object.values(res.check);
    const k = Object.entries(res.kernels).map(([n, v]) => `${n} ${v.fused ?? '?'}/${v.unfused ?? '?'}`).join(' ');
    const t = Object.entries(res.large).map(([n, v]) => `${n} ${v.fused?.gpuMs?.toFixed(3) ?? 'err'}/${v.unfused?.gpuMs?.toFixed(3) ?? 'err'}`).join(' ');
    console.log(`${path.basename(wt).padEnd(24)} api ${res.api.length}/3  fused exact ${exact(Object.values(res.corpus))}/6  unfused exact ${exact(Object.values(res.unfused))}/6  optimized exact ${exact(Object.values(res.optimized))}/4  random exact ${exact(res.random)}/20  check accepted ${checks.filter(c => c.accepted).length}/16 [${[...new Set(checks.map(c => c.relation ?? 'err'))].join(',')}]  large exact ${exact(Object.values(res.large).map(v => v.fused ?? {}))}/6  ${res.seconds}s`);
    console.log(`  kernels fused/unfused: ${k}`);
    console.log(`  benchmark ms fused/unfused: ${t}`);
  }
}
