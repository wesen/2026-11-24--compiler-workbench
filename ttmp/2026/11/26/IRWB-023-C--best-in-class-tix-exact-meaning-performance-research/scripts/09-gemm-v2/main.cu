// IRWB-023-C experiment 09: the price of exactness measured on one better-tuned kernel.
//
// A 128x128x8 register-blocked SGEMM with float4 global and shared loads (Boehm's kernel 6 layout), for
// M, N multiples of 128 and K a multiple of 8. EXACT folds RN(acc + RN(a*b)) in increasing k (the Tix
// meaning); FMA folds RN(acc + a*b) in the same order. Both are compared word for word with a naive
// oracle of their own meaning, and timed against cuBLAS (dlopen) in the same process.
#include <cuda_runtime.h>
#include <dlfcn.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>
#define CHECK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e_)); exit(1); } } while (0)

template <bool FMA> __global__ void naive(int M, int N, int K, const float* A, const float* B, float* C) {
  const int64_t t = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= (int64_t)M * N) return;
  const int j = t % N, i = t / N;
  float v = 0.0f;
  for (int k = 0; k < K; ++k) {
    const float a = A[(int64_t)i * K + k], b = B[(int64_t)k * N + j];
    v = FMA ? __fmaf_rn(a, b, v) : __fadd_rn(v, __fmul_rn(a, b));
  }
  C[t] = v;
}

template <bool FMA> __global__ void __launch_bounds__(256) gemm128(int M, int N, int K, const float* __restrict__ A,
                                                                 const float* __restrict__ B, float* __restrict__ C) {
  __shared__ __align__(16) float As[8][128];
  __shared__ __align__(16) float Bs[8][128];
  const int tid = threadIdx.x, tr = tid / 16, tc = tid % 16;
  const int row0 = blockIdx.y * 128, col0 = blockIdx.x * 128;
  const int ar = tid / 2, ac = (tid % 2) * 4;   // A tile: 128 rows x 2 float4
  const int br = tid / 32, bc = (tid % 32) * 4;  // B tile: 8 rows x 32 float4
  float acc[8][8];
#pragma unroll
  for (int m = 0; m < 8; ++m)
#pragma unroll
    for (int n = 0; n < 8; ++n) acc[m][n] = 0.0f;
  for (int k0 = 0; k0 < K; k0 += 8) {
    const float4 av = *reinterpret_cast<const float4*>(&A[(int64_t)(row0 + ar) * K + k0 + ac]);
    As[ac + 0][ar] = av.x; As[ac + 1][ar] = av.y; As[ac + 2][ar] = av.z; As[ac + 3][ar] = av.w;
    *reinterpret_cast<float4*>(&Bs[br][bc]) = *reinterpret_cast<const float4*>(&B[(int64_t)(k0 + br) * N + col0 + bc]);
    __syncthreads();
#pragma unroll
    for (int kk = 0; kk < 8; ++kk) {
      float a[8], b[8];
      *reinterpret_cast<float4*>(&a[0]) = *reinterpret_cast<const float4*>(&As[kk][tr * 8]);
      *reinterpret_cast<float4*>(&a[4]) = *reinterpret_cast<const float4*>(&As[kk][tr * 8 + 4]);
      *reinterpret_cast<float4*>(&b[0]) = *reinterpret_cast<const float4*>(&Bs[kk][tc * 8]);
      *reinterpret_cast<float4*>(&b[4]) = *reinterpret_cast<const float4*>(&Bs[kk][tc * 8 + 4]);
#pragma unroll
      for (int m = 0; m < 8; ++m)
#pragma unroll
        for (int n = 0; n < 8; ++n) acc[m][n] = FMA ? __fmaf_rn(a[m], b[n], acc[m][n]) : __fadd_rn(acc[m][n], __fmul_rn(a[m], b[n]));
    }
    __syncthreads();
  }
#pragma unroll
  for (int m = 0; m < 8; ++m) {
    float* out = &C[(int64_t)(row0 + tr * 8 + m) * N + col0 + tc * 8];
    *reinterpret_cast<float4*>(out) = make_float4(acc[m][0], acc[m][1], acc[m][2], acc[m][3]);
    *reinterpret_cast<float4*>(out + 4) = make_float4(acc[m][4], acc[m][5], acc[m][6], acc[m][7]);
  }
}

typedef int (*CreateFn)(void**);
typedef int (*SgemmFn)(void*, int, int, int, int, int, const float*, const float*, int, const float*, int, const float*, float*, int);
template <class F> static float median_ms(F launch, int reps) {
  cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
  launch(); CHECK(cudaDeviceSynchronize()); CHECK(cudaGetLastError());
  std::vector<float> ms(reps);
  for (int i = 0; i < reps; ++i) {
    CHECK(cudaEventRecord(s)); launch(); CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e));
    CHECK(cudaEventElapsedTime(&ms[i], s, e));
  }
  std::sort(ms.begin(), ms.end());
  return ms[reps / 2];
}
static long long diffs(const float* a, const float* b, size_t n) {
  long long d = 0; for (size_t i = 0; i < n; ++i) d += memcmp(a + i, b + i, 4) != 0; return d;
}

int main(int argc, char** argv) {
  void* lib = dlopen("libcublas.so.13", RTLD_NOW);
  void* handle = nullptr;
  SgemmFn sgemm = nullptr;
  if (lib && ((CreateFn)dlsym(lib, "cublasCreate_v2"))(&handle) == 0) sgemm = (SgemmFn)dlsym(lib, "cublasSgemm_v2");
  for (int ai = 1; ai < argc; ++ai) {
    const int S = atoi(argv[ai]), M = S, N = S, K = S;
    std::vector<float> ha((size_t)M * K), hb((size_t)K * N);
    uint64_t r = 0x9E3779B97F4A7C15ull;
    for (auto* v : {&ha, &hb})
      for (auto& x : *v) { r ^= r << 13; r ^= r >> 7; r ^= r << 17; x = (float)((r >> 40) / 16777216.0 * 2.0 - 1.0); }
    float *A, *B, *C0, *C1;
    const size_t MN = (size_t)M * N;
    CHECK(cudaMalloc(&A, ha.size() * 4)); CHECK(cudaMalloc(&B, hb.size() * 4));
    CHECK(cudaMalloc(&C0, MN * 4)); CHECK(cudaMalloc(&C1, MN * 4));
    CHECK(cudaMemcpy(A, ha.data(), ha.size() * 4, cudaMemcpyHostToDevice));
    CHECK(cudaMemcpy(B, hb.data(), hb.size() * 4, cudaMemcpyHostToDevice));
    const dim3 grid(N / 128, M / 128);
    const int reps = S >= 4096 ? 5 : 11;
    std::vector<float> ref(MN), got(MN);
    long long d[2];
    float t[2];
    for (int f = 0; f < 2; ++f) {
      if (f == 0) naive<false><<<(MN + 255) / 256, 256>>>(M, N, K, A, B, C0);
      else naive<true><<<(MN + 255) / 256, 256>>>(M, N, K, A, B, C0);
      CHECK(cudaDeviceSynchronize());
      CHECK(cudaMemcpy(ref.data(), C0, MN * 4, cudaMemcpyDeviceToHost));
      t[f] = f == 0 ? median_ms([&] { gemm128<false><<<grid, 256>>>(M, N, K, A, B, C1); }, reps)
                    : median_ms([&] { gemm128<true><<<grid, 256>>>(M, N, K, A, B, C1); }, reps);
      CHECK(cudaMemcpy(got.data(), C1, MN * 4, cudaMemcpyDeviceToHost));
      d[f] = diffs(ref.data(), got.data(), MN);
    }
    const float one = 1.0f, zero = 0.0f;
    const float tc = sgemm ? median_ms([&] { sgemm(handle, 0, 0, N, M, K, &one, B, N, A, K, &zero, C1, N); }, reps) : -1;
    const double fl = 2.0 * M * N * K;
    printf("{\"size\":%d,\"reps\":%d,\"ms\":{\"exact\":%.4f,\"fma\":%.4f,\"cublas\":%.4f},\"tflops\":{\"exact\":%.2f,\"fma\":%.2f,\"cublas\":%.2f},"
           "\"wordsDifferentFromOwnOracle\":{\"exact\":%lld,\"fma\":%lld}}\n",
           S, reps, t[0], t[1], tc, fl / t[0] / 1e9, fl / t[1] / 1e9, tc > 0 ? fl / tc / 1e9 : -1.0, d[0], d[1]);
    cudaFree(A); cudaFree(B); cudaFree(C0); cudaFree(C1);
  }
  return 0;
}
