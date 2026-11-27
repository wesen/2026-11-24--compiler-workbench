// What does Tix's exact f32 meaning cost a matrix multiply?
//
// Three measurements in one translation unit, on the machine that runs Tix's stage-2 lowering:
//
//  1. Peak throughput of the two MAC forms. `fma.rn.f32` rounds once; Tix's meaning needs
//     `fl(fl(a*b) + c)`, i.e. `mul.rn.f32` then `add.rn.f32`. Both are timed by register-only loops with
//     eight independent accumulators, so the ratio is the pure issue-rate price of the second rounding.
//  2. A tiled SGEMM (128x128 block, 8x8 register tile, shared memory) in both MAC forms, plus cuBLAS
//     SGEMM loaded through dlopen so the comparison needs no extra link flags. cuBLAS is the vendor
//     ceiling; the fma variant isolates how much of the remaining gap is *not* the extra rounding.
//  3. A 128^3 numeric dump from the exact kernel, so the JS side can check bit identity against the Tix
//     f32 interpreter (see 03-check-gemm-bits.mjs).
//
// Usage: ./prog [--quick]
#include <cuda_runtime.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <vector>

#define CK(x)                                                                        \
  do {                                                                              \
    cudaError_t e_ = (x);                                                            \
    if (e_ != cudaSuccess) {                                                         \
      fprintf(stderr, "CUDA %s at %d\n", cudaGetErrorString(e_), __LINE__);          \
      exit(1);                                                                       \
    }                                                                                \
  } while (0)

static float median(std::vector<float> v) {
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

// ---------------------------------------------------------------- 1. MAC issue rate

__global__ void macRate(float* out, int iterations, int useFma) {
  float a0 = out[threadIdx.x & 7] + 1.000001f, b = 0.9999999f;
  float acc[8];
#pragma unroll
  for (int i = 0; i < 8; ++i) acc[i] = 1.0f + i * 1e-7f;
  for (int it = 0; it < iterations; ++it) {
#pragma unroll
    for (int i = 0; i < 8; ++i) {
      if (useFma)
        acc[i] = __fmaf_rn(acc[i], b, a0);
      else
        acc[i] = __fadd_rn(__fmul_rn(acc[i], b), a0);
    }
  }
  float s = 0;
#pragma unroll
  for (int i = 0; i < 8; ++i) s += acc[i];
  if (s == 12345.0f) out[0] = s;
}

static double macTflops(int useFma, int blocks, int iterations) {
  std::vector<float> host(256, 1.0f), dev(256);
  CK(cudaMemcpy(dev.data(), host.data(), 256 * sizeof(float), cudaMemcpyHostToDevice));
  // Eight accumulators, one MAC each per iteration, two flops per MAC.
  double flops = 2.0 * blocks * 256.0 * 8.0 * iterations;
  auto run = [&] { macRate<<<blocks, 256>>>(dev.data(), iterations, useFma); };
  run();
  CK(cudaDeviceSynchronize());
  cudaEvent_t s, e;
  CK(cudaEventCreate(&s));
  CK(cudaEventCreate(&e));
  std::vector<float> ms;
  for (int r = 0; r < 5; ++r) {
    CK(cudaEventRecord(s));
    for (int i = 0; i < 20; ++i) run();
    CK(cudaEventRecord(e));
    CK(cudaEventSynchronize(e));
    float t;
    CK(cudaEventElapsedTime(&t, s, e));
    ms.push_back(t / 20);
  }
  return flops / (median(ms) * 1e-3) / 1e12;
}

// ---------------------------------------------------------------- 2. tiled SGEMM

// 128x128 block tile, 256 threads, 8x8 registers per thread, BK=16.
#define BM 128
#define BN 128
#define BK 16
#define TM 8
#define TN 8
#define APAD 8   // As row stride: BM + APAD floats, 16-byte aligned
#define BPAD 8   // Bs row stride: BN + BPAD floats, 16-byte aligned

// mode 0: fma.rn (one rounding, not Tix's meaning).  mode 1: mul.rn then add.rn (Tix's meaning).
__global__ __launch_bounds__(256) void sgemm(const float* __restrict__ A, const float* __restrict__ B,
                                             float* __restrict__ C, int M, int N, int K, int mode) {
  __shared__ float As[BK][BM + APAD];
  __shared__ float Bs[BK][BN + BPAD];
  const int tid = threadIdx.x;
  const int tx = tid % 16, ty = tid / 16;
  const int rowStart = blockIdx.y * BM, colStart = blockIdx.x * BN;
  const int aRow = ty * TM, aCol = tx * TN;
  float acc[TM][TN];
#pragma unroll
  for (int i = 0; i < TM; ++i)
#pragma unroll
    for (int j = 0; j < TN; ++j) acc[i][j] = 0.0f;

  for (int k0 = 0; k0 < K; k0 += BK) {
    // A tile: coalesced float4 along k, stored transposed as As[k][m].
#pragma unroll
    for (int i = 0; i < 2; ++i) {
      const int f = i * 256 + tid;
      const int m = f >> 2, k4 = (f & 3) * 4;
      const float4 v = *reinterpret_cast<const float4*>(A + (size_t)(rowStart + m) * K + k0 + k4);
      As[k4 + 0][m] = v.x;
      As[k4 + 1][m] = v.y;
      As[k4 + 2][m] = v.z;
      As[k4 + 3][m] = v.w;
    }
    // B tile: natural layout Bs[k][n], coalesced float4 along n.
#pragma unroll
    for (int i = 0; i < 2; ++i) {
      const int f = i * 256 + tid;
      const int k = f >> 5, n4 = (f & 31) * 4;  // 32 float4 per row of BN=128
      *reinterpret_cast<float4*>(&Bs[k][n4]) =
          *reinterpret_cast<const float4*>(B + (size_t)(k0 + k) * N + colStart + n4);
    }
    __syncthreads();
#pragma unroll
    for (int kk = 0; kk < BK; ++kk) {
      float a[TM], b[TN];
#pragma unroll
      for (int i = 0; i < TM; ++i) a[i] = As[kk][aRow + i];
#pragma unroll
      for (int j = 0; j < TN; j += 4) {
        const float4 v = *reinterpret_cast<const float4*>(&Bs[kk][aCol + j]);
        b[j + 0] = v.x;
        b[j + 1] = v.y;
        b[j + 2] = v.z;
        b[j + 3] = v.w;
      }
#pragma unroll
      for (int i = 0; i < TM; ++i)
#pragma unroll
        for (int j = 0; j < TN; ++j)
          acc[i][j] = mode ? __fadd_rn(acc[i][j], __fmul_rn(a[i], b[j])) : __fmaf_rn(a[i], b[j], acc[i][j]);
    }
    __syncthreads();
  }
#pragma unroll
  for (int i = 0; i < TM; ++i)
#pragma unroll
    for (int j = 0; j < TN; ++j) C[(size_t)(rowStart + aRow + i) * N + colStart + aCol + j] = acc[i][j];
}

static float gemmMs(float* A, float* B, float* C, int M, int N, int K, int mode) {
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM);
  auto run = [&] { sgemm<<<grid, 256>>>(A, B, C, M, N, K, mode); };
  run();
  CK(cudaDeviceSynchronize());
  cudaEvent_t s, e;
  CK(cudaEventCreate(&s));
  CK(cudaEventCreate(&e));
  std::vector<float> ms;
  for (int r = 0; r < 7; ++r) {
    CK(cudaEventRecord(s));
    for (int i = 0; i < 3; ++i) run();
    CK(cudaEventRecord(e));
    CK(cudaEventSynchronize(e));
    float t;
    CK(cudaEventElapsedTime(&t, s, e));
    ms.push_back(t / 3);
  }
  return median(ms);
}

// ---------------------------------------------------------------- 3. cuBLAS through dlopen

typedef void* cublasHandle_t_;
typedef int (*create_t)(cublasHandle_t_*);
typedef int (*gemm_t)(cublasHandle_t_, int, int, int, int, int, const float*, const float*, int,
                      const float*, int, const float*, float*, int);
typedef int (*destroy_t)(cublasHandle_t_);
struct Cublas {
  void* lib = nullptr;
  create_t create = nullptr;
  gemm_t gemm = nullptr;
  destroy_t destroy = nullptr;
  cublasHandle_t_ handle = nullptr;
  bool load() {
    const char* names[] = {"libcublas.so", "libcublas.so.13", "libcublas.so.12", "libcublas.so.12.0"};
    for (const char* n : names) {
      lib = dlopen(n, RTLD_NOW);
      if (lib) break;
    }
    if (!lib) return false;
    create = (create_t)dlsym(lib, "cublasCreate_v2");
    gemm = (gemm_t)dlsym(lib, "cublasSgemm_v2");
    destroy = (destroy_t)dlsym(lib, "cublasDestroy_v2");
    if (!create || !gemm || !destroy) return false;
    return create(&handle) == 0;
  }
};

static float cublasMs(Cublas& c, float* A, float* B, float* C, int M, int N, int K) {
  const float one = 1.0f, zero = 0.0f;
  // Row-major C = A*B equals column-major C^T = B^T A^T: swap operands and dimensions.
  auto run = [&] { c.gemm(c.handle, 0, 0, N, M, K, &one, B, N, A, K, &zero, C, N); };
  run();
  CK(cudaDeviceSynchronize());
  cudaEvent_t s, e;
  CK(cudaEventCreate(&s));
  CK(cudaEventCreate(&e));
  std::vector<float> ms;
  for (int r = 0; r < 7; ++r) {
    CK(cudaEventRecord(s));
    for (int i = 0; i < 3; ++i) run();
    CK(cudaEventRecord(e));
    CK(cudaEventSynchronize(e));
    float t;
    CK(cudaEventElapsedTime(&t, s, e));
    ms.push_back(t / 3);
  }
  return median(ms);
}

// ---------------------------------------------------------------- driver

static void fill(std::vector<float>& v, unsigned seed) {
  unsigned x = seed;
  for (auto& f : v) {
    x = x * 1664525u + 1013904223u;
    f = 0.2f * ((float)(x >> 8) / 16777216.0f) - 0.1f;
  }
}

int main(int argc, char** argv) {
  bool quick = argc > 1 && strcmp(argv[1], "--quick") == 0;
  cudaDeviceProp prop;
  CK(cudaGetDeviceProperties(&prop, 0));
  printf("{\n\"device\": \"%s\", \"sm\": \"%d.%d\", \"sms\": %d,\n", prop.name, prop.major,
         prop.minor, prop.multiProcessorCount);

  // 1. MAC issue rate.
  const int blocks = prop.multiProcessorCount * 4, iterations = quick ? 200 : 2000;
  const double fma = macTflops(1, blocks, iterations), muladd = macTflops(0, blocks, iterations);
  printf("\"mac\": {\"fmaTflops\": %.3f, \"mulAddTflops\": %.3f, \"ratio\": %.3f},\n", fma, muladd,
         fma / muladd);

  // 2. SGEMM.
  Cublas cublas;
  const bool haveCublas = cublas.load();
  printf("\"cublas\": %s,\n", haveCublas ? "true" : "false");
  printf("\"gemm\": [");
  const int sizes[] = {512, 1024, 2048, 4096};
  bool first = true;
  for (int n : sizes) {
    if (quick && n > 1024) continue;
    const size_t elems = (size_t)n * n;
    std::vector<float> hA(elems), hB(elems);
    fill(hA, 1u + n);
    fill(hB, 7u + n);
    float *A, *B, *C;
    CK(cudaMalloc(&A, elems * 4));
    CK(cudaMalloc(&B, elems * 4));
    CK(cudaMalloc(&C, elems * 4));
    CK(cudaMemcpy(A, hA.data(), elems * 4, cudaMemcpyHostToDevice));
    CK(cudaMemcpy(B, hB.data(), elems * 4, cudaMemcpyHostToDevice));
    const double flops = 2.0 * n * (double)n * n;
    const float exactMs = gemmMs(A, B, C, n, n, n, 1);
    const float fmaMs = gemmMs(A, B, C, n, n, n, 0);
    float cbMs = 0;
    if (haveCublas) cbMs = cublasMs(cublas, A, B, C, n, n, n);
    // How many outputs differ between the two MAC forms?
    size_t differ = 0;
    if (n <= 1024) {
      std::vector<float> x(elems), y(elems);
      sgemm<<<dim3(n / BN, n / BM), 256>>>(A, B, C, n, n, n, 1);
      CK(cudaDeviceSynchronize());
      CK(cudaMemcpy(x.data(), C, elems * 4, cudaMemcpyDeviceToHost));
      sgemm<<<dim3(n / BN, n / BM), 256>>>(A, B, C, n, n, n, 0);
      CK(cudaDeviceSynchronize());
      CK(cudaMemcpy(y.data(), C, elems * 4, cudaMemcpyDeviceToHost));
      for (size_t i = 0; i < elems; ++i) {
        unsigned a, b;
        memcpy(&a, &x[i], 4);
        memcpy(&b, &y[i], 4);
        differ += a != b;
      }
    }
    printf("%s{\"n\": %d, \"exactMs\": %.4f, \"exactTflops\": %.2f, \"fmaMs\": %.4f, \"fmaTflops\": %.2f, "
           "\"cublasMs\": %.4f, \"cublasTflops\": %.2f, \"wordsDiffering\": %zu, \"nSquared\": %zu}",
           first ? "" : ", ", n, exactMs, flops / exactMs / 1e9, fmaMs, flops / fmaMs / 1e9, cbMs,
           cbMs > 0 ? flops / cbMs / 1e9 : 0.0, differ, (size_t)n * n);
    first = false;
    cudaFree(A);
    cudaFree(B);
    cudaFree(C);
  }
  printf("],\n");

  // 3. A 128^3 dump from the exact kernel for the JS bit check.
  {
    const int n = 128;
    const size_t elems = (size_t)n * n;
    std::vector<float> hA(elems), hB(elems), hC(elems);
    fill(hA, 100u + n);
    fill(hB, 200u + n);
    float *A, *B, *C;
    CK(cudaMalloc(&A, elems * 4));
    CK(cudaMalloc(&B, elems * 4));
    CK(cudaMalloc(&C, elems * 4));
    CK(cudaMemcpy(A, hA.data(), elems * 4, cudaMemcpyHostToDevice));
    CK(cudaMemcpy(B, hB.data(), elems * 4, cudaMemcpyHostToDevice));
    sgemm<<<dim3(n / BN, n / BM), 256>>>(A, B, C, n, n, n, 1);
    CK(cudaDeviceSynchronize());
    CK(cudaMemcpy(hC.data(), C, elems * 4, cudaMemcpyDeviceToHost));
    struct Dump { const char* path; const std::vector<float>* data; };
    for (const Dump& d : {Dump{"out/gemm128-A.bin", &hA}, Dump{"out/gemm128-B.bin", &hB},
                          Dump{"out/gemm128-C.bin", &hC}}) {
      FILE* f = fopen(d.path, "wb");
      if (!f) { fprintf(stderr, "cannot write %s\n", d.path); exit(1); }
      fwrite(&n, sizeof(int), 1, f);
      fwrite(d.data->data(), sizeof(float), elems, f);
      fclose(f);
    }
    printf("\"dump\": \"out/gemm128-A.bin,gemm128-B.bin,gemm128-C.bin\",\n");
    cudaFree(A);
    cudaFree(B);
    cudaFree(C);
  }
  printf("\"ok\": true\n}\n");
  return 0;
}
