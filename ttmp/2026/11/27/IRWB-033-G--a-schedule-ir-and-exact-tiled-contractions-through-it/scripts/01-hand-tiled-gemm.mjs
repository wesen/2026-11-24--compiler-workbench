// Probe: how fast can an exact (separate mul, separate add, k in order) tiled GEMM be on the GB10?
//
// The stage-2 lowering computes c[i,j] = sum(k) a[i,k]*b[k,j] with one thread per output element: 0.21 ms at
// 512^3. This writes a hand-tiled kernel (shared-memory tiles, a register patch per thread) outside the compiler
// and times it against that lowering's mapping, and checks the two agree word for word. It decides the tile sizes
// the schedule IR's strategy will start from, and whether vector loads/stores are worth the extra schedule IR.
//
//   node scripts/01-hand-tiled-gemm.mjs [--size 512,4096] [--tiles 64x64x16x4x4,...] [--vector]
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
};
const sizes = opt('--size', '512,4096').split(',').map(Number);
// each entry is BIxBJxBKxTMxTN, and a trailing v marks vector loads and stores
const tiles = opt('--tiles', '64x64x16x4x4').split(',');
const vector = argv.includes('--vector');
const host = opt('--host', 'bling');

const source = String.raw`
#include <cuda_runtime.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <vector>

using I = int64_t;
static void check(cudaError_t s) { if (s != cudaSuccess) throw std::runtime_error(cudaGetErrorString(s)); }

__global__ static void naive(I M, I N, I K, const float* A, const float* B, float* C) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= M * N) return;
  I i = t / N, j = t % N;
  float acc = 0.0f;
  for (I k = 0; k < K; ++k) acc = __fadd_rn(acc, __fmul_rn(A[i * K + k], B[k * N + j]));
  C[t] = acc;
}

template <int BM, int BN, int BK, int TM, int TN, bool VEC>
__global__ static void tiled(I M, I N, I K, const float* A, const float* B, float* C) {
  __shared__ float As[BM][BK];
  __shared__ float Bs[BK][BN];
  const int lanes = (BM / TM) * (BN / TN);
  const int tid = threadIdx.x;
  const int tcx = tid % (BN / TN), tcy = tid / (BN / TN);
  const I brow = (I)blockIdx.y * BM, bcol = (I)blockIdx.x * BN;
  float acc[TM][TN];
  #pragma unroll
  #pragma unroll
  for (int m = 0; m < TM; ++m) {
    #pragma unroll
    for (int n = 0; n < TN; ++n) acc[m][n] = 0.0f;
  }
  for (I k0 = 0; k0 < K; k0 += BK) {
    // A tile: rows i (block row + tile row), columns k (k0 + tile column); consecutive tid reads consecutive k
    for (int idx = tid; idx < BM * BK; idx += lanes) {
      int i = idx / BK, k = idx % BK;
      I gi = brow + i, gk = k0 + k;
      As[i][k] = (gi < M && gk < K) ? A[gi * K + gk] : 0.0f;
    }
    // B tile: rows k, columns j; consecutive tid reads consecutive j (coalesced)
    if (VEC) {
      const int per = BN / 4;                      // float4 groups per k row
      for (int idx = tid; idx < BK * per; idx += lanes) {
        int k = idx / per, j = (idx % per) * 4;
        I gk = k0 + k, gk2 = bcol + j;
        if (gk < K && gk2 + 3 < N) {
          float4 v = *reinterpret_cast<const float4*>(&B[gk * N + gk2]);
          Bs[k][j] = v.x; Bs[k][j + 1] = v.y; Bs[k][j + 2] = v.z; Bs[k][j + 3] = v.w;
        } else for (int q = 0; q < 4; ++q)
          Bs[k][j + q] = (gk < K && gk2 + q < N) ? B[gk * N + gk2 + q] : 0.0f;
      }
    } else {
      for (int idx = tid; idx < BK * BN; idx += lanes) {
        int k = idx / BN, j = idx % BN;
        I gk = k0 + k, gj = bcol + j;
        Bs[k][j] = (gk < K && gj < N) ? B[gk * N + gj] : 0.0f;
      }
    }
    __syncthreads();
    const int kk = (int)((K - k0) < BK ? (K - k0) : BK);
    for (int k = 0; k < kk; ++k) {
      float a[TM], b[TN];
      #pragma unroll
      for (int m = 0; m < TM; ++m) a[m] = As[tcy * TM + m][k];
      #pragma unroll
      for (int n = 0; n < TN; ++n) b[n] = Bs[k][tcx * TN + n];
      #pragma unroll
      for (int m = 0; m < TM; ++m) {
        #pragma unroll
        for (int n = 0; n < TN; ++n) acc[m][n] = __fadd_rn(acc[m][n], __fmul_rn(a[m], b[n]));
      }
    }
    __syncthreads();
  }
  const I row = brow + tcy * TM, col = bcol + tcx * TN;
  if (VEC && TN == 4) {
    #pragma unroll
    for (int m = 0; m < TM; ++m) {
      I gi = row + m;
      if (gi < M && col + 3 < N) *reinterpret_cast<float4*>(&C[gi * N + col]) = make_float4(acc[m][0], acc[m][1], acc[m][2], acc[m][3]);
      else if (gi < M) for (int n = 0; n < TN; ++n) if (col + n < N) C[gi * N + col + n] = acc[m][n];
    }
  } else {
    #pragma unroll
    for (int m = 0; m < TM; ++m) {
      #pragma unroll
      for (int n = 0; n < TN; ++n) {
        I gi = row + m, gj = col + n;
        if (gi < M && gj < N) C[gi * N + gj] = acc[m][n];
      }
    }
  }
}

struct Event { cudaEvent_t h; Event() { check(cudaEventCreate(&h)); } ~Event() { cudaEventDestroy(h); } };
template <class F> static double timed(const F& launch, int warm, int reps) {
  for (int i = 0; i < warm; ++i) launch();
  std::vector<double> ms;
  Event a, b;
  for (int i = 0; i < reps; ++i) {
    check(cudaEventRecord(a.h)); launch(); check(cudaEventRecord(b.h));
    check(cudaEventSynchronize(b.h));
    float t; check(cudaEventElapsedTime(&t, a.h, b.h));
    ms.push_back(t);
  }
  std::sort(ms.begin(), ms.end());
  return ms[ms.size() / 2];
}

struct Variant { const char* name; int bm, bn, bk, tm, tn; bool vec; };

int main() {
  try {
    const int sizes[] = {{SIZES}};
    const Variant variants[] = {{VARIANTS}};
    int value = 0;
    for (int M : sizes) {
      const I K = M, N = M;
      std::vector<float> ha((size_t)(M * K)), hb((size_t)(K * N)), hc((size_t)(M * N)), hd((size_t)(M * N));
      for (auto& x : ha) { value = (value * 1103515245 + 12345) & 0x7fffffff; x = ((value % 2001) - 1000) * 1e-4f; }
      for (auto& x : hb) { value = (value * 1103515245 + 12345) & 0x7fffffff; x = ((value % 2001) - 1000) * 1e-4f; }
      float *da, *db, *dc;
      check(cudaMalloc(&da, ha.size() * 4)); check(cudaMalloc(&db, hb.size() * 4)); check(cudaMalloc(&dc, hc.size() * 4));
      check(cudaMemcpy(da, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
      check(cudaMemcpy(db, hb.data(), hb.size() * 4, cudaMemcpyHostToDevice));
      const double naiveMs = timed([&] { naive<<<(unsigned)((M * N - 1) / 256 + 1), 256>>>(M, N, K, da, db, dc); check(cudaGetLastError()); }, 1, 3);
      check(cudaMemcpy(hc.data(), dc, hc.size() * 4, cudaMemcpyDeviceToHost));
      printf("size %d naive %.4f ms\n", M, naiveMs);
      for (const auto& v : variants) {
        check(cudaMemset(dc, 0, hc.size() * 4));
        const unsigned gx = (unsigned)((N + v.bn - 1) / v.bn), gy = (unsigned)((M + v.bm - 1) / v.bm);
        const unsigned lanes = (unsigned)((v.bm / v.tm) * (v.bn / v.tn));
        auto launch = [&] {
          #define RUN(BM, BN, BK, TM, TN, VEC) tiled<BM, BN, BK, TM, TN, VEC><<<dim3(gx, gy), lanes>>>(M, N, K, da, db, dc)
          LAUNCH_CASES
          #undef RUN
          check(cudaGetLastError());
        };
        const double ms = timed(launch, 1, 3);
        check(cudaMemcpy(hd.data(), dc, hd.size() * 4, cudaMemcpyDeviceToHost));
        size_t diff = 0, first = 0;
        for (size_t i = 0; i < hc.size(); ++i)
          if (memcmp(&hc[i], &hd[i], 4)) { if (!diff) first = i; ++diff; }
        const double tflops = 2.0 * M * N * K / (ms * 1e-3) / 1e12;
        printf("size %d tile %s %.4f ms %.2f TFLOP/s exact %s (%zu differ, first %zu)\n", M, v.name, ms, tflops,
               diff ? "NO" : "yes", diff, first);
        fflush(stdout);
      }
      cudaFree(da); cudaFree(db); cudaFree(dc);
    }
    return 0;
  } catch (const std::exception& e) { fprintf(stderr, "%s\n", e.what()); return 1; }
}
`;

// Tile variants: BMxBNxBKxTMxTN, one per --tiles entry.
const variants = tiles.map(t => {
  const [bm, bn, bk, tm, tn] = t.replace(/v$/, '').split('x').map(Number);
  return { name: t, bm, bn, bk, tm, tn, vector: vector || t.endsWith('v') };
});
const launchCases = [
  ...variants.map(
    (v, i) =>
      `          ${i ? 'else ' : ''}if (!strcmp(v.name, "${v.name}")) RUN(${v.bm}, ${v.bn}, ${v.bk}, ${v.tm}, ${v.tn}, ${v.vector});`,
  ),
  '          else throw std::runtime_error("unknown tile");',
].join('\n');
const body = source
  .replace('{SIZES}', sizes.join(', '))
  .replace(
    '{VARIANTS}',
    variants.map(v => `{"${v.name}", ${v.bm}, ${v.bn}, ${v.bk}, ${v.tm}, ${v.tn}, ${v.vector}}`).join(',\n      '),
  )
  .replace('          if (!strcmp(v.name, TILE_LIST_HELPER)) {}\n', '')
  .replace('LAUNCH_CASES', launchCases);

const dir = await mkdtemp(join(tmpdir(), 'irwb-033-probe-'));
try {
  await writeFile(join(dir, 'main.cu'), body);
  const { stdout } = await exec(process.execPath, [
    new URL('../../../../../../tools/cuda-remote.mjs', import.meta.url).pathname,
    dir,
    '--timed',
    '--host',
    `manuel@${host}`,
  ]);
  const result = JSON.parse(stdout);
  console.log(result.stdout);
  if (result.exit !== 0) console.error(result.stderr);
} finally {
  await rm(dir, { recursive: true, force: true });
}
