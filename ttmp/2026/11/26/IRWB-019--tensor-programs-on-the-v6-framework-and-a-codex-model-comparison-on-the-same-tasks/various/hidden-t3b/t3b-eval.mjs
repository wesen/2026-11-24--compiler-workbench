#!/usr/bin/env node
// IRWB-019 stage-3b (fusion that is never slower) hidden evaluation, written from the T3b brief before any T3b work
// existed (diary step 41).
//   node t3b-eval.mjs run <out.json> <worktree>...   one child per worktree, sequentially (run after every agent exited)
//   node t3b-eval.mjs worker <worktree>              prints JSON
// Per implementation:
//   t3: the whole stage-3 hidden evaluation (hidden-t3/t3-eval.mjs worker): correctness on the corpus, optimized and
//       random programs, checkLowering, kernel counts, and benchmark times on the T1 hidden programs, whose layernorm
//       and attention divide inside their reductions (the brief's "inside" variants);
//   extra: benchmark (median of three `benchmark` calls), fused and unfused, and fused bits against the f32 meaning
//       (the merged stage-1 interpreter) at large sizes, for
//         the brief's "outside" layernorm and attention (named in the brief),
//         three held-out programs, not in the brief: rmsnorm and centering with the division inside the reduction, and
//         log-softmax, whose reduction body is an exp;
//       plus checkLowering (fused) on each, at its own small cases.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const T3 = path.join(HERE, '..', 'hidden-t3', 't3-eval.mjs');
const REF_WT = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-am-irwb-020-b';
const EXTRA = {
  layernorm_out: {
    fn: 'layernorm', params: [['x', [4096, 1024], 3], ['g', [1024], 1], ['b', [1024], 1]],
    src: `fn layernorm(x: f32[N, D], g: f32[D], b: f32[D]): f32[N, D] {
  mu[i] = (sum(d) x[i, d]) / D;
  xc[i, d] = x[i, d] - mu[i];
  vr[i] = (sum(d) xc[i, d] * xc[i, d]) / D;
  y[i, d] = xc[i, d] / sqrt(vr[i] + 0.00001) * g[d] + b[d];
  return y;
}`,
  },
  attention_out: {
    fn: 'attention', params: [['q', [1024, 64], 1], ['k', [1024, 64], 1], ['v', [1024, 64], 1]],
    src: `fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = (sum(d) q[i, d] * k[j, d]) / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  w[i, j] = e[i, j] / l[i];
  o[i, x] = sum(j) w[i, j] * v[j, x];
  return o;
}`,
  },
  rmsnorm_in: {
    fn: 'rmsnorm', params: [['x', [4096, 1024], 3], ['g', [1024], 1]],
    src: `fn rmsnorm(x: f32[N, D], g: f32[D]): f32[N, D] {
  ms[i] = sum(d) x[i, d] * x[i, d] / D;
  y[i, d] = x[i, d] / sqrt(ms[i] + 0.00001) * g[d];
  return y;
}`,
  },
  center_in: {
    fn: 'center', params: [['x', [4096, 1024], 3]],
    src: `fn center(x: f32[N, D]): f32[N, D] {
  mu[i] = sum(d) x[i, d] / D;
  y[i, d] = x[i, d] - mu[i];
  return y;
}`,
  },
  logsoftmax: {
    fn: 'logsoftmax', params: [['x', [4096, 1024], 6]],
    src: `fn logsoftmax(x: f32[N, C]): f32[N, C] {
  m[i] = max(j) x[i, j];
  s[i] = sum(j) exp(x[i, j] - m[i]);
  y[i, j] = x[i, j] - m[i] - log(s[i]);
  return y;
}`,
  },
};
const inputs = (spec, seed) => {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  return Object.fromEntries(spec.params.map(([p, shape, scale]) => {
    const n = shape.reduce((a, b) => a * b, 1), data = new Float32Array(n);
    for (let j = 0; j < n; j++) data[j] = rnd() * scale;
    return [p, { shape, data }];
  }));
};
const bits = a => new Uint32Array(Float32Array.from(a).buffer);
const exactCount = (got, want) => {
  const g = bits(got.data), w = bits(want.data);
  let k = 0;
  for (let i = 0; i < w.length; i++) if (g[i] === w[i] || (Number.isNaN(got.data[i]) && Number.isNaN(want.data[i]))) k++;
  return { n: w.length, bitExact: k, shapeOk: JSON.stringify(Array.from(got.shape)) === JSON.stringify(Array.from(want.shape)) };
};
const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const err = e => String(e?.message ?? e).slice(0, 240);
const [mode, ...rest] = process.argv.slice(2);

if (mode === 'worker') {
  const [wt] = rest;
  const t0 = Date.now();
  const r3 = spawnSync(process.execPath, [T3, 'worker', wt], { encoding: 'utf8', timeout: 7200000, maxBuffer: 1 << 28 });
  let t3;
  try { t3 = JSON.parse(r3.stdout); } catch { t3 = { error: (r3.stderr || 'no output').slice(-600) }; }
  const api = await import(pathToFileURL(path.join(wt, 'dist/tensor/index.js')).href);
  const ref = await import(pathToFileURL(path.join(REF_WT, 'dist/tensor/index.js')).href);
  const extra = {};
  for (const [name, spec] of Object.entries(EXTRA)) {
    const out = {};
    try {
      const inp = inputs(spec, 303);
      const want = ref.runTix(ref.compileTix(spec.src), spec.fn, inp);
      out.kernels = (String(api.cudaSource(api.compileTix(spec.src), spec.fn)).match(/__global__/g) ?? []).length;
      for (const fuse of [true, false]) {
        const ms = [];
        let last;
        for (let k = 0; k < 3; k++) {
          last = await api.runTixCuda(api.compileTix(spec.src), spec.fn, inp, { fuse, benchmark: true });
          ms.push(last.gpuMs);
        }
        out[fuse ? 'fused' : 'unfused'] = { gpuMs: median(ms), runs: ms, ...exactCount(last, want) };
      }
      const v = await api.checkLowering(api.compileTix(spec.src), spec.fn);
      out.check = { accepted: v.accepted, relation: v.relation, reason: v.reason ? String(v.reason).slice(0, 200) : undefined };
    } catch (e) { out.error = err(e); }
    extra[name] = out;
  }
  process.stdout.write(JSON.stringify({ t3, extra, seconds: +((Date.now() - t0) / 1000).toFixed(1) }), () => process.exit(0));
} else if (mode === 'run') {
  const [outFile, ...wts] = rest;
  const all = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  for (const wt of wts) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, 'worker', wt], { encoding: 'utf8', timeout: 10800000, maxBuffer: 1 << 28 });
    let res;
    try { res = JSON.parse(r.stdout); } catch { res = { error: (r.stderr || r.error?.message || 'no output').slice(-600) }; }
    all[path.basename(wt)] = res;
    fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
    if (res.error) { console.log(`${path.basename(wt)}: worker failed: ${res.error.slice(-300)}`); continue; }
    const t = Object.entries(res.t3.large ?? {}).map(([n, v]) => `${n} ${v.fused?.gpuMs?.toFixed(3) ?? 'err'}/${v.unfused?.gpuMs?.toFixed(3) ?? 'err'}${v.fused?.bitExact === v.fused?.n ? '' : ' INEXACT'}`).join(' ');
    const x = Object.entries(res.extra).map(([n, v]) => v.error ? `${n} error` : `${n} ${v.fused.gpuMs.toFixed(3)}/${v.unfused.gpuMs.toFixed(3)} k${v.kernels}${v.fused.bitExact === v.fused.n ? '' : ' INEXACT'}${v.check.accepted && v.check.relation === 'exact' ? '' : ' CHECK-' + v.check.relation}`).join(' ');
    const checks = Object.values(res.t3.check ?? {});
    console.log(`${path.basename(wt).padEnd(24)} t3 check accepted ${checks.filter(c => c.accepted && c.relation === 'exact').length}/16 exact  ${res.seconds}s`);
    console.log(`  hidden ms fused/unfused: ${t}`);
    console.log(`  extra ms fused/unfused: ${x}`);
  }
}
