// Design witness only. Run from the repository root with Node 24.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const dir = mkdtempSync(join(tmpdir(), 'tix-cuda-probe-'));
const n = 32768;
const words = new Float32Array(n + 2048);
let seed = 20;
function next() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
for (let i = 0; i < n; i++) words[i] = 20 * next() - 10;
for (let i = n; i < words.length; i++) words[i] = 2 * next() - 1;
try {
  writeFileSync(join(dir, 'input.bin'), Buffer.from(words.buffer));
  writeFileSync(join(dir, 'main.cu'), `
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>
#define CK(e) do { auto s = (e); if (s != cudaSuccess) { fprintf(stderr,"%s\\n",cudaGetErrorString(s)); exit(1); } } while (0)
constexpr int n = ${n};
__global__ void probe(const float* in, float* out) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  float x = in[i], p = __fadd_rn(fabsf(x), 0.001f);
  out[4*i] = expf(x);
  out[4*i+1] = logf(p);
  out[4*i+2] = tanhf(x);
  out[4*i+3] = __fsqrt_rn(p);
  if (i != 0) return;
  float acc = 0;
  for (int j = 0; j < 1024; ++j) acc = __fadd_rn(acc, __fmul_rn(in[n+j], in[n+1024+j]));
  out[4*n] = acc;
  float half = 0;
  for (int j = 0; j < 7; ++j) half = __fadd_rn(half, j == 0 ? 1.f : j < 4 ? 0.f : 0x1p-24f);
  out[4*n+1] = half;
  out[4*n+2] = __fmul_rn(0x1p-126f, 0.5f);
  out[4*n+3] = __fadd_rn(-0.f, -0.f);
  out[4*n+4] = __fdiv_rn(1.f, 3.f);
}
int main() {
  float *in, *out;
  static float hi[n+2048], ho[4*n+5];
  FILE* f = fopen("input.bin", "rb");
  if (!f || fread(hi, sizeof(float), n+2048, f) != n+2048) return 2;
  fclose(f);
  cudaDeviceProp p{};
  CK(cudaGetDeviceProperties(&p, 0));
  printf("%s sm_%d%d nvcc %d.%d.%d\\n", p.name, p.major, p.minor,
    __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__);
  CK(cudaMalloc(&in, sizeof hi)); CK(cudaMalloc(&out, sizeof ho));
  CK(cudaMemcpy(in, hi, sizeof hi, cudaMemcpyHostToDevice));
  cudaEvent_t start, stop;
  CK(cudaEventCreate(&start)); CK(cudaEventCreate(&stop));
  CK(cudaEventRecord(start));
  probe<<<n/128, 128>>>(in, out);
  CK(cudaGetLastError());
  CK(cudaEventRecord(stop)); CK(cudaEventSynchronize(stop));
  float ms;
  CK(cudaEventElapsedTime(&ms, start, stop));
  printf("event interval usable: %s\\n", ms > 0 ? "yes" : "no");
  CK(cudaEventDestroy(start)); CK(cudaEventDestroy(stop));
  CK(cudaMemcpy(ho, out, sizeof ho, cudaMemcpyDeviceToHost));
  f = fopen("out/results.bin", "wb");
  if (!f || fwrite(ho, sizeof(float), 4*n+5, f) != 4*n+5) return 3;
  return fclose(f) != 0;
}`);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['tools/cuda-remote.mjs', dir], {
    timeout: 60_000,
  });
  if (stderr) process.stderr.write(stderr);
  const result = JSON.parse(stdout);
  const bytes = readFileSync(join(dir, 'out/results.bin'));
  const metrics = [Math.exp, Math.log, Math.tanh, Math.sqrt].map((op, j) => {
    let bitMismatches = 0, worstBudgetFraction = 0, first;
    for (let i = 0; i < n; i++) {
      const x = j % 2 ? Math.fround(Math.abs(words[i]) + Math.fround(0.001)) : words[i];
      const ref = op(x), got = bytes.readFloatLE(4 * (4 * i + j));
      if (!Object.is(Math.fround(ref), got)) {
        bitMismatches++;
        first ??= { x, f32: Math.fround(ref), gpu: got };
      }
      worstBudgetFraction = Math.max(worstBudgetFraction, Math.abs(ref - got) / (2e-6 + 2e-5 * Math.abs(ref)));
    }
    return { op: op.name, bitMismatches, worstBudgetFraction, first };
  });
  let f32 = 0, f64 = 0;
  for (let j = 0; j < 1024; j++) {
    const product = words[n + j] * words[n + 1024 + j];
    f32 = Math.fround(f32 + Math.fround(product));
    f64 += product;
  }
  console.log(JSON.stringify({ remote: result.stdout.trim(), n, metrics,
    dot: { f32, f64, gpu: bytes.readFloatLE(16 * n) },
    extras: Array.from({ length: 4 }, (_, i) => '0x' + bytes.readUInt32LE(16 * n + 4 * (i + 1)).toString(16)),
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
