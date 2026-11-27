// E0: probe the public Tix API from dist/ — compile, run both precisions, optimize, emit CUDA.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..', '..', '..');
const tix = await import(join(repo, 'dist/tensor/index.js'));
const { compileTix, runTix, optimizeTix, cudaSource } = tix;

const src = readFileSync(join(repo, 'corpus/tensor/matmul/main.tix'), 'utf8');
const p = compileTix(src);
const rnd = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32; })();
const M = 8, K = 8, N = 8;
const a = new Float32Array(M * K).map(() => rnd() * 2 - 1);
const b = new Float32Array(K * N).map(() => rnd() * 2 - 1);
const f32 = runTix(p, 'matmul', { a: { shape: [M, K], data: a }, b: { shape: [K, N], data: b } });
const f64 = runTix(p, 'matmul', { a: { shape: [M, K], data: a }, b: { shape: [K, N], data: b } }, { precision: 'f64' });
let maxd = 0;
for (let i = 0; i < f32.data.length; i++) maxd = Math.max(maxd, Math.abs(f32.data[i] - f64.data[i]));
console.log('matmul 8x8 max f32-vs-f64 diff:', maxd);

const opt = optimizeTix(p, ['inline', 'split-sum']);
console.log('optimize steps:', JSON.stringify(opt.steps));

const cu = cudaSource(opt.program, 'matmul');
console.log('cudaSource length:', cu.length, 'kernels:', (cu.match(/__global__/g) || []).length);
console.log('has block index in kernel:', /blocks/.test(cu) || /i2_/.test(cu));
console.log(cu.split('__global__')[1]?.slice(0, 700));
