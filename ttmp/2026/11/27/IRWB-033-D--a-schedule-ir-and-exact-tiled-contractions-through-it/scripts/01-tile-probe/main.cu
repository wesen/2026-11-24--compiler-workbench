// IRWB-033-D probe 01: exact tiled GEMM variants (separate __fmul_rn/__fadd_rn, k ascending per output) against
// the one-thread-per-output kernel: bit equality and time (warm-up + median of 3 CUDA-event runs), per shape.
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>
#include <algorithm>
#define CK(x) do { cudaError_t s = (x); if (s != cudaSuccess) { printf("err %s line %d\n", cudaGetErrorString(s), __LINE__); exit(1);} } while (0)
__global__ void naive(const float* A, const float* B, float* C, long M, long N, long K) {
  long t = (long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= M * N) return;
  long i = t / N, j = t % N; float acc = 0.0f;
  for (long k = 0; k < K; ++k) acc = __fadd_rn(acc, __fmul_rn(A[i * K + k], B[k * N + j]));
  C[t] = acc;
}
template <int BM, int BN, int BK, int TM, int TN>
__global__ void __launch_bounds__((BM / TM) * (BN / TN)) tiled(const float* A, const float* B, float* C, long M, long N, long K) {
  constexpr int TX = BN / TN, T = (BM / TM) * TX;
  __shared__ __align__(16) float As[BK][BM + 4];
  __shared__ __align__(16) float Bs[BK][BN + 4];
  const int tx = threadIdx.x % TX, ty = threadIdx.x / TX;
  const long m0 = (long)blockIdx.y * BM, n0 = (long)blockIdx.x * BN;
  float acc[TM][TN];
#pragma unroll
  for (int i = 0; i < TM; ++i)
#pragma unroll
    for (int j = 0; j < TN; ++j) acc[i][j] = 0.0f;
  for (long r0 = 0; r0 < K; r0 += BK) {
#pragma unroll
    for (int e = threadIdx.x; e < BM * BK; e += T) {
      const int kk = e % BK, mm = e / BK; const long m = m0 + mm, r = r0 + kk;
      As[kk][mm] = (m < M && r < K) ? A[m * K + r] : 0.0f;
    }
#pragma unroll
    for (int e = threadIdx.x; e < BN * BK; e += T) {
      const int nn = e % BN, kk = e / BN; const long n = n0 + nn, r = r0 + kk;
      Bs[kk][nn] = (n < N && r < K) ? B[r * N + n] : 0.0f;
    }
    __syncthreads();
#pragma unroll
    for (int kk = 0; kk < BK; ++kk) {
      float a[TM], b[TN];
      if constexpr (TM % 4 == 0) {
#pragma unroll
        for (int i = 0; i < TM; i += 4) *reinterpret_cast<float4*>(&a[i]) = *reinterpret_cast<const float4*>(&As[kk][ty * TM + i]);
      } else {
#pragma unroll
        for (int i = 0; i < TM; ++i) a[i] = As[kk][ty * TM + i];
      }
      if constexpr (TN % 4 == 0) {
#pragma unroll
        for (int j = 0; j < TN; j += 4) *reinterpret_cast<float4*>(&b[j]) = *reinterpret_cast<const float4*>(&Bs[kk][tx * TN + j]);
      } else {
#pragma unroll
        for (int j = 0; j < TN; ++j) b[j] = Bs[kk][tx * TN + j];
      }
#pragma unroll
      for (int i = 0; i < TM; ++i)
#pragma unroll
        for (int j = 0; j < TN; ++j) acc[i][j] = __fadd_rn(acc[i][j], __fmul_rn(a[i], b[j]));
    }
    __syncthreads();
  }
#pragma unroll
  for (int i = 0; i < TM; ++i)
#pragma unroll
    for (int j = 0; j < TN; ++j) {
      const long m = m0 + ty * TM + i, n = n0 + tx * TN + j;
      if (m < M && n < N) C[m * N + n] = acc[i][j];
    }
}
template <class F> float timeit(F f) {
  cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
  f(); CK(cudaDeviceSynchronize());
  float ms[3];
  for (int i = 0; i < 3; ++i) { cudaEventRecord(a); f(); cudaEventRecord(b); cudaEventSynchronize(b); cudaEventElapsedTime(&ms[i], a, b); }
  std::sort(ms, ms + 3); return ms[1];
}
template <int BM, int BN, int BK, int TM, int TN>
void variant(const char* name, float* A, float* B, float* C, long M, long N, long K, const std::vector<float>& ref, std::vector<float>& host) {
  dim3 grid((N + BN - 1) / BN, (M + BM - 1) / BM), block((BM / TM) * (BN / TN));
  CK(cudaMemset(C, 0xff, M * N * 4));
  float ms = timeit([&] { tiled<BM, BN, BK, TM, TN><<<grid, block>>>(A, B, C, M, N, K); });
  CK(cudaGetLastError());
  CK(cudaMemcpy(host.data(), C, M * N * 4, cudaMemcpyDeviceToHost));
  bool same = !memcmp(host.data(), ref.data(), M * N * 4);
  printf("{\"M\":%ld,\"N\":%ld,\"K\":%ld,\"kernel\":\"%s\",\"blocks\":%u,\"ms\":%.4f,\"tflops\":%.2f,\"identical\":%s}\n", M, N, K, name, grid.x * grid.y, ms, 2.0 * M * N * K / ms / 1e9, same ? "true" : "false");
}
int main(int argc, char** argv) {
  long shapes[][3] = {{512, 512, 512}, {1024, 1024, 64}, {1024, 64, 1024}, {1024, 1024, 256}, {1024, 256, 1024}, {4096, 4096, 4096}, {500, 300, 77}, {256, 256, 1}};
  for (auto& s : shapes) {
    long M = s[0], N = s[1], K = s[2];
    std::vector<float> a(M * K), b(K * N), ref(M * N), host(M * N);
    uint32_t x = 20;
    auto rnd = [&] { x = x * 1664525u + 1013904223u; return ((x >> 8) / 16777216.0f) * 0.2f - 0.1f; };
    for (auto& v : a) v = rnd(); for (auto& v : b) v = rnd();
    float *A, *B, *C; CK(cudaMalloc(&A, M * K * 4)); CK(cudaMalloc(&B, K * N * 4)); CK(cudaMalloc(&C, M * N * 4));
    CK(cudaMemcpy(A, a.data(), M * K * 4, cudaMemcpyHostToDevice)); CK(cudaMemcpy(B, b.data(), K * N * 4, cudaMemcpyHostToDevice));
    float ms = timeit([&] { naive<<<(M * N + 255) / 256, 256>>>(A, B, C, M, N, K); });
    CK(cudaMemcpy(ref.data(), C, M * N * 4, cudaMemcpyDeviceToHost));
    printf("{\"M\":%ld,\"N\":%ld,\"K\":%ld,\"kernel\":\"naive\",\"ms\":%.4f,\"tflops\":%.2f}\n", M, N, K, ms, 2.0 * M * N * K / ms / 1e9);
    variant<128, 128, 8, 8, 8>("128x128x8/8x8", A, B, C, M, N, K, ref, host);
    variant<128, 64, 8, 8, 4>("128x64x8/8x4", A, B, C, M, N, K, ref, host);
    variant<64, 64, 8, 4, 4>("64x64x8/4x4", A, B, C, M, N, K, ref, host);
    variant<64, 64, 16, 4, 4>("64x64x16/4x4", A, B, C, M, N, K, ref, host);
    variant<64, 64, 8, 8, 8>("64x64x8/8x8", A, B, C, M, N, K, ref, host);
    variant<32, 64, 8, 4, 4>("32x64x8/4x4", A, B, C, M, N, K, ref, host);
    variant<32, 32, 8, 4, 4>("32x32x8/4x4", A, B, C, M, N, K, ref, host);
    variant<32, 32, 8, 2, 2>("32x32x8/2x2", A, B, C, M, N, K, ref, host);
    cudaFree(A); cudaFree(B); cudaFree(C);
  }
}
