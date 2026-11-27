// E2/E3/E4/E6 driver: generate, correctness-check and time prototype kernels on the GB10.
//
//   node scripts/05-gpu-bench.mjs gen      # write prototype/bench/main.cu + bench.bin
//   node scripts/05-gpu-bench.mjs check    # untimed correctness run + word comparison vs E1 refs
//   node scripts/05-gpu-bench.mjs time     # --timed run, median of 20 event-timed reps per config
//
// The baseline configs are the *actual* stage-2 emitted kernels and host code
// (extracted from cudaSource and renamed), so baseline numbers come from the real
// lowering, not a re-implementation. My kernels are new; each is compared word-for-word
// against the exact-f32 references from scripts/01-references.mjs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ticket = join(here, '..');
const root = join(ticket, '..', '..', '..', '..', '..');
const benchDir = join(ticket, 'prototype', 'bench');
const results = join(ticket, 'results');
mkdirSync(benchDir, { recursive: true });
mkdirSync(results, { recursive: true });

// ---------------------------------------------------------------------------
// Baseline extraction: paste the real emitted kernels + host per program.
// ---------------------------------------------------------------------------
function topLevelBlocks(text) {
  // split a translation unit into top-level blocks (functions/declarations)
  const blocks = [];
  let depth = 0, current = [];
  for (const line of text.split('\n')) {
    const starts = depth === 0 && /^(?:__global__ void k\d+\(|static void run_case\(|int main\()/.test(line);
    if (starts && current.length) { blocks.push(current.join('\n')); current = []; }
    current.push(line);
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && current.length && /\}/.test(line)) {
      // block complete only if it opened at depth 0; otherwise keep accumulating
      const opened = current.some(l => l.includes('{'));
      if (opened) { blocks.push(current.join('\n')); current = []; }
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}
function extractUnit(name) {
  const src = readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8');
  const program = compileTix(src);
  const unit = cudaSource(program, name);
  const blocks = topLevelBlocks(unit);
  const support = [];
  const kernels = [];
  let host = null;
  for (const b of blocks) {
    if (b.startsWith('__global__ void k')) kernels.push(b);
    else if (b.startsWith('static void run_case')) host = b;
    else if (b.startsWith('int main')) continue;
    else support.push(b);
  }
  if (!host || !kernels.length) throw Error(name + ': unexpected emitted structure');
  const renamedKernels = kernels.map(k => k.replace(/\bk(\d+)\b/g, `${name}_k$1`));
  const renamedHost = host
    .replace('static void run_case', `static void run_case_${name}`)
    .replace(/\bk(\d+)\b/g, `${name}_k$1`);
  return { support: support.join('\n\n'), kernels: renamedKernels, host: renamedHost };
}
const programs = ['matmul', 'softmax', 'layernorm', 'attention'];
const units = Object.fromEntries(programs.map(p => [p, extractUnit(p)]));

// ---------------------------------------------------------------------------
// My prototype kernels.
// ---------------------------------------------------------------------------
const mine = String.raw`
#include <functional>
#include <string>

// ---------------- prototype kernels (ticket IRWB-023-I) ----------------

// mm_smem: one thread per output (same meaning mapping), tiles staged in shared
// memory. The per-thread k loop is still sequential, multiply and add still round
// separately: exact tier.
#define SMB 16
__global__ void mm_smem(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[SMB][SMB + 1];
  __shared__ float Bs[SMB + 1][SMB];
  const int tx = threadIdx.x % SMB, ty = threadIdx.x / SMB;
  const int row = blockIdx.y * SMB + ty;
  const int col = blockIdx.x * SMB + tx;
  if ((U)row >= (U)d0 || (U)col >= (U)d2) return;
  float acc = 0.0f;
  for (int kt = 0; kt < d1; kt += SMB) {
    for (int idx = threadIdx.x; idx < SMB * SMB; idx += blockDim.x) {
      int r = idx / SMB, c = idx % SMB;
      As[r][c] = t0[(I)(blockIdx.y * SMB + r) * d1 + (kt + c)];
      Bs[r][c] = t1[(I)(kt + r) * d2 + (blockIdx.x * SMB + c)];
    }
    __syncthreads();
    for (int kk = 0; kk < SMB; ++kk) acc = __fadd_rn(acc, __fmul_rn(As[ty][kk], Bs[kk][tx]));
    __syncthreads();
  }
  result[(I)row * d2 + col] = acc;
}

// mm_rt32: register-tiled exact matmul. BM=BN=32, BK=32, 8x8 threads, 4x4 per thread.
// Per output element the k order is unchanged and both operations round: exact tier.
__global__ void mm_rt32(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[32][33];
  __shared__ float Bs[33][32];
  const int tx = threadIdx.x % 8, ty = threadIdx.x / 8;
  const int row0 = blockIdx.y * 32 + ty * 4;
  const int col0 = blockIdx.x * 32 + tx * 4;
  float acc[4][4];
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) acc[r][c] = 0.0f;
  const int tid = threadIdx.x;
  for (int kt = 0; kt < d1; kt += 32) {
    for (int idx = tid; idx < 32 * 32; idx += 64) {
      int r = idx / 32, c = idx % 32;
      As[r][c] = t0[(I)(blockIdx.y * 32 + r) * d1 + (kt + c)];
      Bs[r][c] = t1[(I)(kt + r) * d2 + (blockIdx.x * 32 + c)];
    }
    __syncthreads();
    for (int kk = 0; kk < 32; ++kk) {
      float af[4], bf[4];
      for (int r = 0; r < 4; r++) af[r] = As[ty * 4 + r][kk];
      for (int c = 0; c < 4; c++) bf[c] = Bs[kk][tx * 4 + c];
      for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++)
          acc[r][c] = __fadd_rn(acc[r][c], __fmul_rn(af[r], bf[c]));
    }
    __syncthreads();
  }
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) {
      int gr = row0 + r, gc = col0 + c;
      if (gr < d0 && gc < d2) result[(I)gr * d2 + gc] = acc[r][c];
    }
}

// mm_rt32_fma: identical schedule, but the multiply-add contracts (nvcc default
// --fmad=true). Budget tier: measures the price of the two-rounding meaning.
__global__ void mm_rt32_fma(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[32][33];
  __shared__ float Bs[33][32];
  const int tx = threadIdx.x % 8, ty = threadIdx.x / 8;
  const int row0 = blockIdx.y * 32 + ty * 4;
  const int col0 = blockIdx.x * 32 + tx * 4;
  float acc[4][4];
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) acc[r][c] = 0.0f;
  const int tid = threadIdx.x;
  for (int kt = 0; kt < d1; kt += 32) {
    for (int idx = tid; idx < 32 * 32; idx += 64) {
      int r = idx / 32, c = idx % 32;
      As[r][c] = t0[(I)(blockIdx.y * 32 + r) * d1 + (kt + c)];
      Bs[r][c] = t1[(I)(kt + r) * d2 + (blockIdx.x * 32 + c)];
    }
    __syncthreads();
    for (int kk = 0; kk < 32; ++kk) {
      float af[4], bf[4];
      for (int r = 0; r < 4; r++) af[r] = As[ty * 4 + r][kk];
      for (int c = 0; c < 4; c++) bf[c] = Bs[kk][tx * 4 + c];
      for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++) acc[r][c] += af[r] * bf[c];
    }
    __syncthreads();
  }
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) {
      int gr = row0 + r, gc = col0 + c;
      if (gr < d0 && gc < d2) result[(I)gr * d2 + gc] = acc[r][c];
    }
}

// sm_fused_exact: one warp per row; m by lane tree (order-free for max, exact),
// e per lane with the double-exp path, s by lane 0 as a sequential fold over the
// shared row (same order as the meaning), y per lane. Exact tier.
#define SM_WARPS 8
__global__ void sm_fused_exact(I d0, I d1, const float* t0, float* result, U count) {
  __shared__ float esh[SM_WARPS][1024];
  __shared__ float ssh[SM_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + warp;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  float lm = -INFINITY;
#pragma unroll
  for (int t = 0; t < 32; t++) lm = minmax(lm, xreg[t], true);
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
#pragma unroll
  for (int t = 0; t < 32; t++)
    esh[warp][lane + 32 * t] = __double2float_rn(exp((double)__fsub_rn(xreg[t], lm)));
  __syncwarp();
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) s = __fadd_rn(s, esh[warp][j]);
    ssh[warp] = s;
  }
  __syncwarp();
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++)
    yrow[lane + 32 * t] = __fdiv_rn(esh[warp][lane + 32 * t], ssh[warp]);
}

// sm_fused_tree: same structure, but the row sum is a per-lane partial followed by a
// butterfly tree: the sum's evaluation tree changes (budget tier).
__global__ void sm_fused_tree(I d0, I d1, const float* t0, float* result, U count) {
  const int lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + threadIdx.x / 32;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  float lm = -INFINITY;
#pragma unroll
  for (int t = 0; t < 32; t++) lm = minmax(lm, xreg[t], true);
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
  float part = 0.0f;
  float ereg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) {
    ereg[t] = __double2float_rn(exp((double)__fsub_rn(xreg[t], lm)));
    part = __fadd_rn(part, ereg[t]);
  }
  for (int off = 16; off > 0; off >>= 1)
    part = __fadd_rn(part, __shfl_down_sync(0xffffffffu, part, off));
  const float s = __shfl_sync(0xffffffffu, part, 0);
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++) yrow[lane + 32 * t] = __fdiv_rn(ereg[t], s);
}

// sm_fused_expf: exact structure, but expf instead of the double-exp path (budget tier).
__global__ void sm_fused_expf(I d0, I d1, const float* t0, float* result, U count) {
  __shared__ float esh[SM_WARPS][1024];
  __shared__ float ssh[SM_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + warp;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  float lm = -INFINITY;
#pragma unroll
  for (int t = 0; t < 32; t++) lm = minmax(lm, xreg[t], true);
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
#pragma unroll
  for (int t = 0; t < 32; t++) esh[warp][lane + 32 * t] = expf(__fsub_rn(xreg[t], lm));
  __syncwarp();
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) s = __fadd_rn(s, esh[warp][j]);
    ssh[warp] = s;
  }
  __syncwarp();
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++) yrow[lane + 32 * t] = __fdiv_rn(esh[warp][lane + 32 * t], ssh[warp]);
}

// ln_fused: one warp per row; mean and variance by lane-0 sequential folds over the
// row (exact), centered kept in registers + shared for the variance walk. Exact tier.
#define LN_WARPS 4
__global__ void ln_fused(I d0, I d1, const float* t0, const float* t1, const float* t2, const float* t3, float* result, U count) {
  __shared__ float csh[LN_WARPS][1024];
  __shared__ float rsh[LN_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * LN_WARPS + warp;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) s = __fadd_rn(s, xrow[j]);
    rsh[warp] = __fdiv_rn(s, __ll2float_rn(d1));
  }
  __syncwarp();
  const float mean = rsh[warp];
  float c[32];
#pragma unroll
  for (int t = 0; t < 32; t++) {
    c[t] = __fsub_rn(xreg[t], mean);
    csh[warp][lane + 32 * t] = c[t];
  }
  __syncwarp();
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) {
      float v = csh[warp][j];
      s = __fadd_rn(s, __fmul_rn(v, v));
    }
    const float variance = __fdiv_rn(s, __ll2float_rn(d1));
    rsh[warp] = __fsqrt_rn(__fadd_rn(variance, __ldg(&t3[0])));
  }
  __syncwarp();
  const float denom = rsh[warp];
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    yrow[j] = __fadd_rn(__fmul_rn(__fdiv_rn(c[t], denom), __ldg(&t1[j])), __ldg(&t2[j]));
  }
}

// attn_sm: fused score + softmax per row (one warp), weight written to global.
// Score dots keep the d order; m is a warp tree (exact); z a lane-0 sequential
// fold (exact). Exact tier.
__global__ void attn_sm(I dq, I dk, I dd, const float* q, const float* k, float* w, U count) {
  __shared__ float ssh[SM_WARPS][1024];
  __shared__ float qsh[SM_WARPS][64];
  __shared__ float rsh[SM_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + warp;
  if (row >= dq) return;
  if (lane < 32) {
    for (int d = lane; d < dd; d += 32) qsh[warp][d] = q[(size_t)row * dd + d];
  }
  __syncwarp();
  const float scale = __fsqrt_rn(__ll2float_rn(dd));
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) {
      float acc = 0.0f;
      for (int d = 0; d < dd; d++) acc = __fadd_rn(acc, __fmul_rn(qsh[warp][d], k[(size_t)j * dd + d]));
      ssh[warp][j] = __fdiv_rn(acc, scale);
    }
  }
  __syncwarp();
  float lm = -INFINITY;
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) lm = minmax(lm, ssh[warp][j], true);
  }
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) ssh[warp][j] = __double2float_rn(exp((double)__fsub_rn(ssh[warp][j], lm)));
  }
  __syncwarp();
  if (lane == 0) {
    float z = 0.0f;
    for (int j = 0; j < dk; j++) z = __fadd_rn(z, ssh[warp][j]);
    rsh[warp] = z;
  }
  __syncwarp();
  const float z = rsh[warp];
  float* wrow = w + (size_t)row * dk;
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) wrow[j] = __fdiv_rn(ssh[warp][j], z);
  }
}
`;

const main = String.raw`
// ---------------- bench driver ----------------
struct Case {
  int config;
  int nTensors;
  std::vector<std::vector<I>> shapes;
  std::vector<std::vector<float>> data;
};

static Case readCase(FILE* f) {
  Case c;
  if (fread(&c.config, 4, 1, f) != 1) throw std::runtime_error("bench: short config");
  if (fread(&c.nTensors, 4, 1, f) != 1) throw std::runtime_error("bench: short tensor count");
  for (int t = 0; t < c.nTensors; ++t) {
    int rank;
    if (fread(&rank, 4, 1, f) != 1) throw std::runtime_error("bench: short rank");
    std::vector<unsigned> dims32(rank);
    if (rank && fread(dims32.data(), 4, rank, f) != (size_t)rank) throw std::runtime_error("bench: short dims");
    std::vector<I> dims(rank);
    for (int i = 0; i < rank; ++i) dims[i] = dims32[i];
    U n = 1;
    for (I d : dims) n *= (U)d;
    std::vector<float> data(n);
    if (n && fread(data.data(), 4, n, f) != n) throw std::runtime_error("bench: short data");
    c.shapes.push_back(dims);
    c.data.push_back(data);
  }
  return c;
}

static void writeResult(const char* name, const std::vector<I>& shape, const std::vector<float>& data) {
  std::string path = std::string("out/") + name + ".bin";
  FILE* f = fopen(path.c_str(), "wb");
  if (!f) throw std::runtime_error("bench: cannot open " + path);
  U rank = shape.size();
  fwrite(&rank, 8, 1, f);
  if (rank) fwrite(shape.data(), 8, rank, f);
  if (!data.empty()) fwrite(data.data(), 4, data.size(), f);
  fclose(f);
}

static double median(std::vector<float>& v) { std::sort(v.begin(), v.end()); return v[v.size() / 2]; }

static void timeLoop(const char* name, int reps, const std::function<void()>& body) {
  for (int i = 0; i < 3; ++i) body();
  check(cudaDeviceSynchronize());
  Event start, stop;
  std::vector<float> ms;
  for (int i = 0; i < reps; ++i) {
    check(cudaEventRecord(start.handle));
    body();
    check(cudaEventRecord(stop.handle));
    check(cudaEventSynchronize(stop.handle));
    float one;
    check(cudaEventElapsedTime(&one, start.handle, stop.handle));
    ms.push_back(one);
  }
  printf("%s,%.6f,%.6f,%.6f,%d\n", name, median(ms), *std::min_element(ms.begin(), ms.end()), *std::max_element(ms.begin(), ms.end()), reps);
}

static float* upload(const std::vector<float>& host) {
  float* p = nullptr;
  check(cudaMalloc(&p, sizeof(float) * (host.size() ? host.size() : 1)));
  if (!host.empty()) check(cudaMemcpy(p, host.data(), host.size() * sizeof(float), cudaMemcpyHostToDevice));
  return p;
}

// One TIXCUDA1 case built in memory, so the pasted stage-2 host code runs unchanged.
static void runEmitted(void (*run)(FILE*, FILE*, bool), const Case& c, bool benchmark, const char* outName, double* gpuMs, const std::vector<I>& resultShape) {
  std::vector<char> bytes;
  auto put = [&bytes](const void* p, size_t n) { const char* b = (const char*)p; bytes.insert(bytes.end(), b, b + n); };
  // run_case reads each parameter's shape then its words, interleaved; the magic
  // and case count belong to the emitted main(), which this bench does not use.
  for (size_t t = 0; t < c.shapes.size(); ++t) {
    put(c.shapes[t].data(), 8 * c.shapes[t].size());
    put(c.data[t].data(), 4 * c.data[t].size());
  }
  FILE* in = tmpfile();
  FILE* out = tmpfile();
  if (!in || !out) throw std::runtime_error("bench: tmpfile failed");
  if (fwrite(bytes.data(), 1, bytes.size(), in) != bytes.size()) throw std::runtime_error("bench: short request write");
  fflush(in);
  rewind(in);
  fprintf(stderr, "[bench] runEmitted bytes=%zu\n", bytes.size());
  (*run)(in, out, benchmark);
  fprintf(stderr, "[bench] runEmitted done\n");
  rewind(out);
  std::vector<I> shape(resultShape.size());
  if (!shape.empty() && fread(shape.data(), 8, shape.size(), out) != shape.size())
    throw std::runtime_error("bench: short response shape");
  U n = 1;
  for (I d : shape) n *= (U)d;
  std::vector<float> data(n);
  if (n && fread(data.data(), 4, n, out) != n) throw std::runtime_error("bench: short response data");
  double ms = 0;
  if (fread(&ms, 8, 1, out) != 1) throw std::runtime_error("bench: short response ms");
  fclose(in);
  fclose(out);
  if (gpuMs) *gpuMs = ms;
  else writeResult(outName, shape, data);
}

int main(int argc, char** argv) {
  try {
    cudaDeviceProp prop;
    check(cudaGetDeviceProperties(&prop, 0));
    int clockKhz = 0;
    cudaDeviceGetAttribute(&clockKhz, cudaDevAttrClockRate, 0);
    printf("# device %s sm_%d%d SMs=%d clock=%d kHz sharedOptin=%zu regsPerBlock=%d\n",
           prop.name, prop.major, prop.minor, prop.multiProcessorCount, clockKhz,
           (size_t)prop.sharedMemPerBlockOptin, prop.regsPerBlock);
    const bool timing = argc == 2 && std::string(argv[1]) == "--timing";
    const bool big = argc == 2 && std::string(argv[1]) == "--big";
    FILE* in = fopen("bench.bin", "rb");
    if (!in) throw std::runtime_error("bench: no bench.bin");
    int mode;
    if (fread(&mode, 4, 1, in) != 1) throw std::runtime_error("bench: short mode");
    int caseCount;
    if (fread(&caseCount, 4, 1, in) != 1) throw std::runtime_error("bench: short case count");
    for (int ci = 0; ci < caseCount; ++ci) {
      Case c = readCase(in);
      fprintf(stderr, "[bench] case %d config %d tensors %zu\n", ci, c.config, c.shapes.size());
      const char* name = 0;
      switch (c.config) {
        case 0: name = "mm_base_rn"; break;
        case 1: name = "mm_base_fma"; break;
        case 2: name = "mm_smem_rn"; break;
        case 3: name = "mm_rt32_rn"; break;
        case 4: name = "mm_rt32_fma"; break;
        case 5: name = "sm_base"; break;
        case 6: name = "sm_fused_exact"; break;
        case 7: name = "sm_fused_tree"; break;
        case 8: name = "sm_fused_expf"; break;
        case 9: name = "ln_base"; break;
        case 10: name = "ln_fused"; break;
        case 11: name = "attn_base"; break;
        case 12: name = "attn_fused"; break;
      }
      if (!name) throw std::runtime_error("bench: unknown config");
      if (big && c.config != 3 && c.config != 4) continue;  // big run: only the tiled kernels
      if (c.config <= 4) {
        const I M = c.shapes[0][0], K = c.shapes[0][1], N = c.shapes[1][1];
        float* a = upload(c.data[0]);
        float* b = upload(c.data[1]);
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)M * N));
        auto body = [&]() {
          if (c.config == 0 || c.config == 1)
            matmul_k0<<<(U)((I)M * N - 1) / 256 + 1, 256>>>(M, K, N, a, b, y, (U)((I)M * N));
          else if (c.config == 2) {
            dim3 grid((N + SMB - 1) / SMB, (M + SMB - 1) / SMB);
            mm_smem<<<grid, 256>>>(M, K, N, a, b, y, (U)((I)M * N));
          } else {
            dim3 grid((N + 31) / 32, (M + 31) / 32);
            if (c.config == 3) mm_rt32<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
            else mm_rt32_fma<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
          }
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        if (c.config == 0 || c.config == 1) check(cudaFuncGetAttributes(&attr, matmul_k0));
        else if (c.config == 2) check(cudaFuncGetAttributes(&attr, mm_smem));
        else if (c.config == 3) check(cudaFuncGetAttributes(&attr, mm_rt32));
        else check(cudaFuncGetAttributes(&attr, mm_rt32_fma));
        if (timing) {
          char label[64];
          snprintf(label, sizeof label, "%s@%dx%dx%d", name, (int)M, (int)K, (int)N);
          timeLoop(label, big ? 10 : 20, body);
        } else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)M * N);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {M, N}, host);
        }
        check(cudaFree(a)); check(cudaFree(b)); check(cudaFree(y));
      } else if (c.config == 5 || c.config == 9 || c.config == 11) {
        const char* prog = c.config == 5 ? "softmax" : c.config == 9 ? "layernorm" : "attention";
        void (*run)(FILE*, FILE*, bool) = prog == "softmax" ? run_case_softmax : prog == "layernorm" ? run_case_layernorm : run_case_attention;
        std::vector<I> resultShape = prog == "softmax" ? std::vector<I>{c.shapes[0][0], c.shapes[0][1]}
          : prog == "layernorm" ? std::vector<I>{c.shapes[0][0], c.shapes[0][1]}
          : std::vector<I>{c.shapes[0][0], c.shapes[2][1]};
        double ms = 0;
        if (timing) {
          char label[64];
          snprintf(label, sizeof label, "%s_base", name);
          std::vector<float> samples;
          for (int rep = 0; rep < 5; ++rep) {
            runEmitted(run, c, true, name, &ms, resultShape);
            samples.push_back((float)ms);
          }
          std::sort(samples.begin(), samples.end());
          printf("%s,%.6f,%.6f,%.6f,5x3\n", label, (double)samples[2], (double)samples[0], (double)samples[4]);
        } else {
          runEmitted(run, c, false, name, 0, resultShape);
        }
      } else if (c.config == 6 || c.config == 7 || c.config == 8) {
        const I N = c.shapes[0][0], C = c.shapes[0][1];
        float* x = upload(c.data[0]);
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)N * C));
        auto body = [&]() {
          if (c.config == 6) sm_fused_exact<<<(N + SM_WARPS - 1) / SM_WARPS, 256>>>(N, C, x, y, (U)((I)N * C));
          else if (c.config == 7) sm_fused_tree<<<(N + SM_WARPS - 1) / SM_WARPS, 256>>>(N, C, x, y, (U)((I)N * C));
          else sm_fused_expf<<<(N + SM_WARPS - 1) / SM_WARPS, 256>>>(N, C, x, y, (U)((I)N * C));
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        if (c.config == 6) check(cudaFuncGetAttributes(&attr, sm_fused_exact));
        else if (c.config == 7) check(cudaFuncGetAttributes(&attr, sm_fused_tree));
        else check(cudaFuncGetAttributes(&attr, sm_fused_expf));
        if (timing) timeLoop(name, 20, body);
        else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)N * C);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {N, C}, host);
        }
        check(cudaFree(x)); check(cudaFree(y));
      } else if (c.config == 10) {
        const I N = c.shapes[0][0], D = c.shapes[0][1];
        float* x = upload(c.data[0]);
        float* g = upload(c.data[1]);
        float* be = upload(c.data[2]);
        float* ep = upload(c.data[3]);
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)N * D));
        auto body = [&]() {
          ln_fused<<<(N + LN_WARPS - 1) / LN_WARPS, LN_WARPS * 32>>>(N, D, x, g, be, ep, y, (U)((I)N * D));
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        check(cudaFuncGetAttributes(&attr, ln_fused));
        if (timing) timeLoop(name, 20, body);
        else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)N * D);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {N, D}, host);
        }
        check(cudaFree(x)); check(cudaFree(g)); check(cudaFree(be)); check(cudaFree(ep)); check(cudaFree(y));
      } else {
        // attention fused: kernel A (score+softmax) then the tiled GEMM for out
        const I Q = c.shapes[0][0], Dd = c.shapes[0][1], Kd = c.shapes[1][0], V = c.shapes[2][1];
        float* q = upload(c.data[0]);
        float* k = upload(c.data[1]);
        float* v = upload(c.data[2]);
        float* w;
        check(cudaMalloc(&w, sizeof(float) * (size_t)Q * Kd));
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)Q * V));
        auto body = [&]() {
          attn_sm<<<(Q + SM_WARPS - 1) / SM_WARPS, 256>>>(Q, Kd, Dd, q, k, w, (U)((I)Q * Kd));
          dim3 grid((V + 31) / 32, (Q + 31) / 32);
          mm_rt32<<<grid, 64>>>(Q, Kd, V, w, v, y, (U)((I)Q * V));
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        check(cudaFuncGetAttributes(&attr, attn_sm));
        check(cudaFuncGetAttributes(&attr, mm_rt32));
        if (timing) timeLoop(name, 20, body);
        else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)Q * V);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {Q, V}, host);
        }
        check(cudaFree(q)); check(cudaFree(k)); check(cudaFree(v)); check(cudaFree(w)); check(cudaFree(y));
      }
    }
    if (big) {
      // 4096^3 timing-only: uninitialized device buffers, values irrelevant
      const I M = 4096, K = 4096, N = 4096;
      float* a; float* b; float* y;
      check(cudaMalloc(&a, sizeof(float) * (size_t)M * K));
      check(cudaMalloc(&b, sizeof(float) * (size_t)K * N));
      check(cudaMalloc(&y, sizeof(float) * (size_t)M * N));
      auto body = [&]() {
        dim3 grid((N + 31) / 32, (M + 31) / 32);
        mm_rt32<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
        check(cudaGetLastError());
      };
      cudaFuncAttributes attr;
      check(cudaFuncGetAttributes(&attr, mm_rt32));
      timeLoop("mm_rt32_rn@4096", 10, body);
      auto bodyFma = [&]() {
        dim3 grid((N + 31) / 32, (M + 31) / 32);
        mm_rt32_fma<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
        check(cudaGetLastError());
      };
      timeLoop("mm_rt32_fma@4096", 10, bodyFma);
      check(cudaFree(a)); check(cudaFree(b)); check(cudaFree(y));
    }
    fclose(in);
    check(cudaDeviceSynchronize());
    return 0;
  } catch (const std::exception& e) {
    fprintf(stderr, "%s\n", e.what());
    return 1;
  }
}
`;

// remove the placeholder from the template
const mainFixed = main.replace('          sm_fused_exact ? 0 : 0;\n', '');

// matmul baseline kernel name: the emitted matmul unit has exactly one kernel k0.
// Its renamed form is matmul_k0.
const baselines = units.matmul.support + '\n\n' +
  units.matmul.kernels.join('\n\n') + '\n\n' +
  units.softmax.kernels.join('\n\n') + '\n\n' +
  units.layernorm.kernels.join('\n\n') + '\n\n' +
  units.attention.kernels.join('\n\n') + '\n\n' +
  units.matmul.host + '\n\n' +
  units.softmax.host + '\n\n' +
  units.layernorm.host + '\n\n' +
  units.attention.host;

function rnStripped(text) {
  // matmul kernel call arguments contain no commas; a top-level comma split is safe here
  return text
    .replace(/__fadd_rn\(([^,]+), ([^)]+)\)/g, '($1) + ($2)')
    .replace(/__fsub_rn\(([^,]+), ([^)]+)\)/g, '($1) - ($2)')
    .replace(/__fmul_rn\(([^,]+), ([^)]+)\)/g, '($1) * ($2)');
}
// mm_base_fma: the pasted matmul kernel with contraction enabled (default --fmad=true)
const matmulFmaBody = rnStripped(units.matmul.kernels[0].replace(/\bmatmul_k0\b/g, 'matmul_k0_fma'));

const unit = [baselines, matmulFmaBody, mine, mainFixed].join('\n\n');

function gen() {
  writeFileSync(join(benchDir, 'main.cu'), unit);
  // bench.bin: mode + caseCount + cases (config 0..12)
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const tensorsFor = {
    matmul: 'matmul', softmax: 'softmax', layernorm: 'layernorm', attention: 'attention',
  };
  const programOf = c => (c <= 4 ? 'matmul' : c <= 8 ? 'softmax' : c <= 10 ? 'layernorm' : 'attention');
  const parts = [];
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0, 0); // mode placeholder; check mode writes 0, time mode writes 1
  header.writeUInt32LE(order.length, 4);
  parts.push(header);
  for (const config of order) {
    const name = programOf(config);
    const raw = readFileSync(join(results, 'inputs', name + '.bin'));
    // strip the outer uint32 count wrapper: tensors are stored in param order
    const count = raw.readUInt32LE(0);
    let off = 4;
    const tensors = [];
    for (let t = 0; t < count; t++) {
      const rank = raw.readUInt32LE(off); off += 4;
      const dims = [];
      for (let i = 0; i < rank; i++) { dims.push(raw.readUInt32LE(off)); off += 4; }
      const n = dims.reduce((a, b) => a * b, 1);
      const data = raw.subarray(off, off + 4 * n); off += 4 * n;
      tensors.push({ dims, data });
    }
    const caseBuf = [];
    const cfg = Buffer.alloc(8);
    cfg.writeUInt32LE(config, 0);
    cfg.writeUInt32LE(tensors.length, 4);
    caseBuf.push(cfg);
    for (const t of tensors) {
      const r = Buffer.alloc(4); r.writeUInt32LE(t.dims.length, 0);
      caseBuf.push(r);
      const d = Buffer.alloc(4 * t.dims.length);
      t.dims.forEach((x, i) => d.writeUInt32LE(x, 4 * i));
      caseBuf.push(d);
      caseBuf.push(t.data);
    }
    parts.push(...caseBuf);
  }
  writeFileSync(join(benchDir, 'bench.bin'), Buffer.concat(parts));
  console.log('generated main.cu (' + (unit.length / 1024).toFixed(0) + ' KiB) and bench.bin');
}

function run(cliArg, timed) {
  const args = [join(root, 'tools', 'cuda-remote.mjs'), benchDir, '--runtime-input', 'bench.bin'];
  if (timed) args.push('--timed');
  args.push('--', cliArg);
  const out = execFileSync('node', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  return JSON.parse(out.slice(out.indexOf('{')));
}

function check() {
  rmSync(join(benchDir, 'out'), { recursive: true, force: true });
  const json = run('--correctness', false);
  console.log('compileMs', json.compileMs, 'exit', json.exit);
  if (json.exit !== 0) {
    console.log('STDOUT:', json.stdout);
    console.log('STDERR:', json.stderr);
    process.exit(1);
  }
  // compare outputs against the references
  const expectations = {
    mm_base_rn: ['matmul', 'f32'], mm_base_fma: ['matmul', 'f64budget'], mm_smem_rn: ['matmul', 'f32'],
    mm_rt32_rn: ['matmul', 'f32'], mm_rt32_fma: ['matmul', 'f64budget'],
    sm_base: ['softmax', 'f32'], sm_fused_exact: ['softmax', 'f32'],
    sm_fused_tree: ['softmax', 'f64budget'], sm_fused_expf: ['softmax', 'f64budget'],
    ln_base: ['layernorm', 'f32'], ln_fused: ['layernorm', 'f32'],
    attn_base: ['attention', 'f32'], attn_fused: ['attention', 'f32'],
  };
  const rows = [];
  for (const [config, [prog, relation]] of Object.entries(expectations)) {
    const raw = readFileSync(join(benchDir, 'out', config + '.bin'));
    const rank = raw.readBigUInt64LE(0);
    const dims = [];
    for (let i = 0; i < rank; i++) dims.push(Number(raw.readBigUInt64LE(8 + 8 * i)));
    const n = dims.reduce((a, b) => a * b, 1);
    const got = new Uint32Array(n);
    for (let i = 0; i < n; i++) got[i] = raw.readUInt32LE(8 + 8 * Number(rank) + 4 * i);
    const refRaw = readFileSync(join(results, 'refs', prog + '.f32.bin'));
    const ref = new Uint32Array(refRaw.buffer, refRaw.byteOffset, refRaw.length / 4);
    let mismatches = 0, first = -1, maxAbs = 0, maxUlp = 0;
    let budgetFail = 0, worstFraction = 0, ref64 = null;
    if (relation === 'f64budget') {
      const ref64Raw = readFileSync(join(results, 'refs', prog + '.f64.bin'));
      ref64 = new Float64Array(ref64Raw.buffer, ref64Raw.byteOffset, ref64Raw.length / 8);
    }
    for (let i = 0; i < n; i++) {
      if (got[i] !== ref[i]) {
        mismatches++;
        if (first < 0) first = i;
        const g = viewF32(got[i]), r = viewF32(ref[i]);
        if (Number.isFinite(g) && Number.isFinite(r)) {
          maxAbs = Math.max(maxAbs, Math.abs(g - r));
          maxUlp = Math.max(maxUlp, Math.abs(got[i] - ref[i]));
          if (relation === 'f64budget') {
            const allowed = 2e-6 + 2e-5 * Math.abs(ref64[i]);
            worstFraction = Math.max(worstFraction, Math.abs(g - ref64[i]) / allowed);
            if (Math.abs(g - ref64[i]) > allowed) budgetFail++;
          }
        }
      }
    }
    rows.push({ config, elements: n, mismatches, first, maxAbs, maxUlp, budgetFail, worstFraction });
    console.log(`${config}: ${mismatches}/${n} word mismatches` +
      (mismatches ? ` (first ${first}, maxAbs ${maxAbs.toExponential(2)}, maxUlp ${maxUlp}${relation === 'f64budget' ? `, budgetFail ${budgetFail}, worst ${worstFraction.toExponential(2)}x budget` : ''})` : ' [bit-exact]'));
  }
  writeFileSync(join(results, 'bench-correctness.json'), JSON.stringify(rows, null, 2));
  console.log('check done; compileMs', json.compileMs);
}

function viewF32(word) {
  const b = new ArrayBuffer(4); new Uint32Array(b)[0] = word; return new Float32Array(b)[0];
}

function time(big) {
  const json = run(big ? '--big' : '--timing', true);
  console.log('# compileMs', json.compileMs, 'exit', json.exit);
  if (json.exit !== 0) {
    console.log('STDOUT:', json.stdout);
    console.log('STDERR:', json.stderr);
    process.exit(1);
  }
  writeFileSync(join(results, big ? 'bench-timing-big.csv' : 'bench-timing.csv'), json.stdout);
  for (const line of json.stdout.split('\n')) if (line && !line.startsWith('#')) console.log(line);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'gen') gen();
else if (cmd === 'check') check();
else if (cmd === 'time') time(arg === '--big');
else { console.log('usage: gen | check | time [--big]'); process.exit(2); }
