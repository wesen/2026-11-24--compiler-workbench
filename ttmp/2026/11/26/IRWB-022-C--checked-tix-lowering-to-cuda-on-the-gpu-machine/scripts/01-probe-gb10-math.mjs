// Standalone design experiment, not the Tix backend. Run from the worktree root.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cu = String.raw`
#include <cuda_runtime.h>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>
#define CUDA(call) do { auto s = (call); if (s != cudaSuccess) { \
  fprintf(stderr, "%s: %s\n", #call, cudaGetErrorString(s)); exit(2); } } while (0)

__device__ float tix_minmax(float x, float y, bool maximum) {
  if (isnan(x) || isnan(y)) return __uint_as_float(0x7fc00000u);
  if (x == 0.0f && y == 0.0f) {
    unsigned a = __float_as_uint(x), b = __float_as_uint(y);
    return __uint_as_float(maximum ? (a & b) : (a | b));
  }
  return maximum ? (x > y ? x : y) : (x < y ? x : y);
}

__global__ void intrinsic_probe(const float *in, float *out, unsigned n) {
  unsigned i = blockDim.x * blockIdx.x + threadIdx.x;
  if (i >= n) return;
  float x = in[i];
  double d = double(x);
  out += 8 * i;
  out[0] = expf(x); out[1] = __double2float_rn(exp(d));
  out[2] = logf(x); out[3] = __double2float_rn(log(d));
  out[4] = sqrtf(x); out[5] = __double2float_rn(__dsqrt_rn(d));
  out[6] = tanhf(x); out[7] = __double2float_rn(tanh(d));
}

__global__ void flags_probe(const float *in, float *out) {
  float a = in[0], b = in[1], c = in[2], sub = in[3], nz = in[4], pz = in[5];
  out[0] = __fadd_rn(__fmul_rn(a, b), c);
  out[1] = __fmaf_rn(a, b, c);
  out[2] = __fadd_rn(sub, sub);
  out[3] = __fdiv_rn(sub, sub);
  out[4] = tix_minmax(nz, pz, false);
  out[5] = tix_minmax(nz, pz, true);
  float nan = __fdiv_rn(pz, pz);
  out[6] = fmaxf(nan, a);
  out[7] = tix_minmax(nan, a, true);
}

int main(int argc, char **argv) {
  if (argc != 2) return 1;
  unsigned n = strtoul(argv[1], nullptr, 10);
  std::vector<float> in(n + 6), out(8 * n + 8);
  FILE *f = fopen("inputs.bin", "rb");
  if (!f || fread(in.data(), sizeof(float), in.size(), f) != in.size()) return 1;
  fclose(f);
  float *din, *dout;
  CUDA(cudaMalloc(&din, 4 * in.size()));
  CUDA(cudaMalloc(&dout, 4 * out.size()));
  CUDA(cudaMemcpy(din, in.data(), 4 * in.size(), cudaMemcpyHostToDevice));
  cudaEvent_t start, stop;
  CUDA(cudaEventCreate(&start));
  CUDA(cudaEventCreate(&stop));
  CUDA(cudaEventRecord(start));
  intrinsic_probe<<<(n + 127) / 128, 128>>>(din, dout, n);
  CUDA(cudaGetLastError());
  flags_probe<<<1, 1>>>(din + n, dout + 8 * n);
  CUDA(cudaGetLastError());
  CUDA(cudaEventRecord(stop));
  CUDA(cudaEventSynchronize(stop));
  float elapsed;
  CUDA(cudaEventElapsedTime(&elapsed, start, stop));
  if (!std::isfinite(elapsed) || elapsed < 0) return 1;
  CUDA(cudaEventDestroy(start));
  CUDA(cudaEventDestroy(stop));
  CUDA(cudaMemcpy(out.data(), dout, 4 * out.size(), cudaMemcpyDeviceToHost));
  cudaDeviceProp p;
  int runtime, driver;
  CUDA(cudaGetDeviceProperties(&p, 0));
  CUDA(cudaRuntimeGetVersion(&runtime));
  CUDA(cudaDriverGetVersion(&driver));
  printf("%s sm_%d%d nvcc %d.%d.%d runtime %d driver %d\n", p.name, p.major, p.minor,
         __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__, runtime, driver);
  f = fopen("out/math.bin", "wb");
  if (!f || fwrite(out.data(), sizeof(float), out.size(), f) != out.size() || fclose(f)) return 1;
  return 0;
}
`;

let state = 0x0306b10;
function randomWord() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}
const buf = new ArrayBuffer(4);
const u32 = new Uint32Array(buf);
const f32 = new Float32Array(buf);
const word = x => ((f32[0] = x), u32[0]);
const fromWord = x => ((u32[0] = x), f32[0]);
const hex = x => `0x${x.toString(16).padStart(8, '0')}`;
const inputs = [0, -0, 1, -1, 2 ** -149, -(2 ** -149), 2 ** -126, 2 ** 127, 89, -104, 0.5, -0.5];
for (let i = 0; i < 32768; i++) {
  const x = fromWord(randomWord());
  if (Number.isFinite(x)) inputs.push(x);
  inputs.push(Math.fround((randomWord() / 2 ** 31 - 1) * 110));
  inputs.push(Math.fround((randomWord() / 2 ** 31 - 1) * 12));
}
const n = inputs.length;
inputs.push(1 + 2 ** -23, 1 - 2 ** -23, -1, 2 ** -149, -0, 0);
const dir = mkdtempSync(join(tmpdir(), 'tix-gb10-math-'));
try {
  writeFileSync(join(dir, 'main.cu'), cu);
  const bytes = Buffer.alloc(4 * inputs.length);
  inputs.forEach((x, i) => bytes.writeFloatLE(x, 4 * i));
  writeFileSync(join(dir, 'inputs.bin'), bytes);
  const remote = spawnSync(process.execPath, ['tools/cuda-remote.mjs', dir, '--', String(n)], {
    encoding: 'utf8',
  });
  if (remote.error || remote.status !== 0) {
    throw Error(`CUDA probe failed: ${remote.error ?? remote.status}\n${remote.stdout}\n${remote.stderr}`);
  }
  const meta = JSON.parse(remote.stdout);
  const results = readFileSync(join(dir, 'out/math.bin'));
  if (results.length !== 4 * (8 * n + 8)) throw Error('Probe output size mismatch');
  const ops = ['exp', 'log', 'sqrt', 'tanh'];
  const reports = ops.map(op => ({
    op,
    floatMismatch: 0,
    widenedMismatch: 0,
    maxWidenedBudgetFraction: 0,
  }));
  for (let i = 0; i < n; i++) {
    const x = inputs[i];
    for (const [j, op] of ops.entries()) {
      const ref = Math[op](x);
      const expected = Math.fround(ref);
      const offset = (8 * i + 2 * j) * 4;
      const r = reports[j];
      for (const [k, mode] of ['float', 'widened'].entries()) {
        const got = results.readFloatLE(offset + 4 * k);
        if (!Object.is(got, expected)) {
          r[`${mode}Mismatch`]++;
          r[`${mode}Witness`] ??= { x, expected: hex(word(expected)), got: hex(word(got)) };
        }
        if (mode === 'widened' && Number.isFinite(expected) && Number.isFinite(got)) {
          r.maxWidenedBudgetFraction = Math.max(
            r.maxWidenedBudgetFraction,
            Math.abs(ref - got) / (2e-6 + 2e-5 * Math.abs(ref)),
          );
        }
      }
    }
  }
  console.log(JSON.stringify({
    node: process.version,
    v8: process.versions.v8,
    gpu: meta.stdout.trim(),
    hash: meta.hash,
    n,
    reports,
    flagWords: Array.from({ length: 8 }, (_, i) => hex(results.readUInt32LE((8 * n + i) * 4))),
  }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
