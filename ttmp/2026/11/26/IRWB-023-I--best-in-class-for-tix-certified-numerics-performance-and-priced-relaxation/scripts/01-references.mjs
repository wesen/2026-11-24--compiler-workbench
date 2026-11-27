// E1: purpose-built exact-f32 references for the benchmark shapes.
//
// Each reference mirrors the stage-1 f32 meaning for one corpus program:
// every arithmetic node rounds with Math.fround, sums fold sequentially from +0,
// max folds from -Infinity, and exp/log/tanh follow the stage-2 CUDA path
// (double argument, one rounding), which the coordinator verified equal to
// Math.fround(Math.exp(x)) for all 2^32 f32 inputs.
//
// Outputs (under ../results/):
//   refs/<name>.f32.bin   raw f32 words of the reference output
//   refs/<name>.meta.json shape + provenance
//   inputs/<name>.bin     GPU bench input file (uint32 tensor count; per tensor:
//                         uint32 rank, uint32 dims[rank], f32 data)
//   refs/crossval.json    interpreter cross-validation results at small sizes
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'results');
mkdirSync(join(out, 'refs'), { recursive: true });
mkdirSync(join(out, 'inputs'), { recursive: true });

const fr = Math.fround;
function rng(seed) {
  // mulberry32; same stream family as the probes in earlier tickets
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- references -------------------------------------------------------------
function refMatmul(a, b, M, K, N) {
  const y = new Float32Array(M * N);
  for (let i = 0; i < M; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let k = 0; k < K; k++) acc = fr(acc + fr(a[i * K + k] * b[k * N + j]));
      y[i * N + j] = acc;
    }
  return y;
}
function refSoftmax(x, N, C) {
  const y = new Float32Array(N * C);
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    for (let j = 0; j < C; j++) m = Math.max(m, x[i * C + j]);
    const e = new Float32Array(C);
    let s = 0;
    for (let j = 0; j < C; j++) { e[j] = fr(Math.exp(fr(x[i * C + j] - m))); s = fr(s + e[j]); }
    for (let j = 0; j < C; j++) y[i * C + j] = fr(e[j] / s);
  }
  return y;
}
function refMatmul64(a, b, M, K, N) {
  const y = new Float64Array(M * N);
  for (let i = 0; i < M; i++)
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let k = 0; k < K; k++) acc += a[i * K + k] * b[k * N + j];
      y[i * N + j] = acc;
    }
  return y;
}
function refSoftmax64(x, N, C) {
  const y = new Float64Array(N * C);
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    for (let j = 0; j < C; j++) m = Math.max(m, x[i * C + j]);
    let s = 0;
    for (let j = 0; j < C; j++) s += Math.exp(x[i * C + j] - m);
    for (let j = 0; j < C; j++) y[i * C + j] = Math.exp(x[i * C + j] - m) / s;
  }
  return y;
}
function refLayernorm(x, gamma, beta, eps, N, D) {
  const y = new Float32Array(N * D);
  const epsv = eps[0];
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let j = 0; j < D; j++) sum = fr(sum + x[i * D + j]);
    const mean = fr(sum / fr(D));
    const centered = new Float32Array(D);
    let varsum = 0;
    for (let j = 0; j < D; j++) {
      centered[j] = fr(x[i * D + j] - mean);
      varsum = fr(varsum + fr(centered[j] * centered[j]));
    }
    const variance = fr(varsum / fr(D));
    const denom = fr(Math.sqrt(fr(variance + epsv)));
    for (let j = 0; j < D; j++)
      y[i * D + j] = fr(fr(fr(centered[j] / denom) * gamma[j]) + beta[j]);
  }
  return y;
}
function refAttention(q, k, v, Q, K, D, V) {
  const out = new Float32Array(Q * V);
  const scale = fr(Math.sqrt(D));
  const score = new Float32Array(K);
  for (let i = 0; i < Q; i++) {
    for (let j = 0; j < K; j++) {
      let acc = 0;
      for (let d = 0; d < D; d++) acc = fr(acc + fr(q[i * D + d] * k[j * D + d]));
      score[j] = fr(acc / scale);
    }
    let m = -Infinity;
    for (let j = 0; j < K; j++) m = Math.max(m, score[j]);
    const e = new Float32Array(K);
    let z = 0;
    for (let j = 0; j < K; j++) { e[j] = fr(Math.exp(fr(score[j] - m))); z = fr(z + e[j]); }
    for (let c = 0; c < V; c++) {
      let acc = 0;
      for (let j = 0; j < K; j++) acc = fr(acc + fr(fr(e[j] / z) * v[j * V + c]));
      out[i * V + c] = acc;
    }
  }
  return out;
}

// --- inputs -----------------------------------------------------------------
function fillSigned(n, random) { return Float32Array.from({ length: n }, () => fr(2 * random() - 1)); }
function fillPositive(n, random) { return Float32Array.from({ length: n }, () => fr(0.25 + 0.75 * random())); }

function packInputs(tensors) {
  // uint32 count, then per tensor: uint32 rank, dims, f32 words
  const parts = [];
  let total = 4;
  for (const t of tensors) total += 4 + 4 * t.shape.length + 4 * t.data.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  let off = 0;
  dv.setUint32(off, tensors.length, true); off += 4;
  for (const t of tensors) {
    dv.setUint32(off, t.shape.length, true); off += 4;
    for (const d of t.shape) { dv.setUint32(off, d, true); off += 4; }
    new Uint8Array(buf, off, t.data.length * 4).set(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.length * 4));
    off += t.data.length * 4;
  }
  return Buffer.from(buf);
}

const workloads = {
  // matmul 512^3
  matmul: {
    build: (random) => {
      const M = 512, K = 512, N = 512;
      const a = fillSigned(M * K, random), b = fillSigned(K * N, random);
      return { inputs: [{ shape: [M, K], data: a }, { shape: [K, N], data: b }], ref: refMatmul(a, b, M, K, N), ref64: refMatmul64(a, b, M, K, N) };
    },
    small: (random) => {
      const M = 64, K = 80, N = 48;
      const a = fillSigned(M * K, random), b = fillSigned(K * N, random);
      return { inputs: [{ shape: [M, K], data: a }, { shape: [K, N], data: b }], ref: refMatmul(a, b, M, K, N) };
    },
  },
  softmax: {
    build: (random) => {
      const N = 4096, C = 1024;
      const x = fillSigned(N * C, random);
      return { inputs: [{ shape: [N, C], data: x }], ref: refSoftmax(x, N, C), ref64: refSoftmax64(x, N, C) };
    },
    small: (random) => {
      const N = 128, C = 64;
      const x = fillSigned(N * C, random);
      return { inputs: [{ shape: [N, C], data: x }], ref: refSoftmax(x, N, C) };
    },
  },
  layernorm: {
    build: (random) => {
      const N = 4096, D = 1024;
      const x = fillSigned(N * D, random);
      const gamma = fillPositive(D, random), beta = fillPositive(D, random);
      const eps = Float32Array.of(fr(1e-6));
      return { inputs: [{ shape: [N, D], data: x }, { shape: [D], data: gamma }, { shape: [D], data: beta }, { shape: [1], data: eps }], ref: refLayernorm(x, gamma, beta, eps, N, D) };
    },
    small: (random) => {
      const N = 64, D = 32;
      const x = fillSigned(N * D, random);
      const gamma = fillPositive(D, random), beta = fillPositive(D, random);
      const eps = Float32Array.of(fr(1e-6));
      return { inputs: [{ shape: [N, D], data: x }, { shape: [D], data: gamma }, { shape: [D], data: beta }, { shape: [1], data: eps }], ref: refLayernorm(x, gamma, beta, eps, N, D) };
    },
  },
  attention: {
    build: (random) => {
      const Q = 1024, K = 1024, D = 64, V = 64;
      const q = fillSigned(Q * D, random), k = fillSigned(K * D, random), v = fillSigned(K * V, random);
      return { inputs: [{ shape: [Q, D], data: q }, { shape: [K, D], data: k }, { shape: [K, V], data: v }], ref: refAttention(q, k, v, Q, K, D, V) };
    },
    small: (random) => {
      const Q = 16, K = 24, D = 8, V = 12;
      const q = fillSigned(Q * D, random), k = fillSigned(K * D, random), v = fillSigned(K * V, random);
      return { inputs: [{ shape: [Q, D], data: q }, { shape: [K, D], data: k }, { shape: [K, V], data: v }], ref: refAttention(q, k, v, Q, K, D, V) };
    },
  },
};

const corpus = {
  matmul: 'corpus/tensor/matmul/main.tix',
  softmax: 'corpus/tensor/softmax/main.tix',
  layernorm: 'corpus/tensor/layernorm/main.tix',
  attention: 'corpus/tensor/attention/main.tix',
};
const crossval = {};
for (const [name, path] of Object.entries(corpus)) {
  const root = join(here, '..', '..', '..', '..', '..', '..');
  const program = compileTix(readFileSync(join(root, path), 'utf8'));
  const random = rng(23001);
  const w = workloads[name].small(random);
  const fn = name;
  const inputs = Object.fromEntries(w.inputs.map(t => [t.name ?? '', t]));
  // name tensors as the corpus sources do
  const paramNames = { matmul: ['a', 'b'], softmax: ['x'], layernorm: ['x', 'gamma', 'beta', 'eps'], attention: ['q', 'k', 'v'] }[name];
  const callInputs = Object.fromEntries(paramNames.map((p, i) => [p, w.inputs[i]]));
  const t0 = performance.now();
  const got = runTix(program, fn, callInputs, { precision: 'f32' });
  const ms = performance.now() - t0;
  let mismatch = -1;
  const words = (f) => new Uint32Array(f.buffer, f.byteOffset, f.length);
  const A = words(got.data), B = words(w.ref);
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) { mismatch = i; break; }
  crossval[name] = { elements: got.data.length, mismatches: mismatch, interpreterMs: Math.round(ms) };
  console.log(`crossval ${name}: ${got.data.length} elements, mismatch ${mismatch}, interpreter ${Math.round(ms)} ms`);
}

for (const [name, w] of Object.entries(workloads)) {
  const random = rng(20231126);
  const t0 = performance.now();
  const { inputs, ref, ref64 } = w.build(random);
  const genMs = Math.round(performance.now() - t0);
  writeFileSync(join(out, 'inputs', name + '.bin'), packInputs(inputs));
  writeFileSync(join(out, 'refs', name + '.f32.bin'), Buffer.from(ref.buffer, ref.byteOffset, ref.length * 4));
  if (ref64) writeFileSync(join(out, 'refs', name + '.f64.bin'), Buffer.from(ref64.buffer, ref64.byteOffset, ref64.length * 8));
  writeFileSync(join(out, 'refs', name + '.meta.json'), JSON.stringify({
    name, shapes: inputs.map(t => t.shape), seed: 20231126, generatedMs: genMs, refWords: ref.length,
  }, null, 2));
  console.log(`built ${name}: ${inputs.map(t => t.shape.join('x')).join(', ')} ref ${ref.length} words in ${genMs} ms`);
}
writeFileSync(join(out, 'refs', 'crossval.json'), JSON.stringify(crossval, null, 2));
console.log('E1 done');
