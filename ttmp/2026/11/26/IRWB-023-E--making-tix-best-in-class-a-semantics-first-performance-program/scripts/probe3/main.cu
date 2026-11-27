// IRWB-023-E probe 3: is a schedule change bit-identical?
//
// The Tix meaning is a fold order and a set of rounding sites. It says nothing
// about which thread computes an element. This probe runs the *same* arithmetic
// (sequential k fold, __fmul_rn + __fadd_rn) under four schedules:
//   naive          one thread per output element
//   tiled          shared-memory tiling, 8x8 threads, 32x32 tile, sequential k
//   tiled+reg      16x16 threads, register blocking 2x2, sequential k
//   cublas         cuBLAS SGEMM (predictable FP32, no TF32) as an external roof
// and reports (a) event-timed milliseconds, (b) whether the words agree exactly.
#include <cuda_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>

#define CHECK(x) do { cudaError_t s_ = (x); if (s_ != cudaSuccess) { \
  printf("ERROR %s %s\n", cudaGetErrorString(s_), #x); return 1; } } while (0)

static int M = 512, K = 512, N = 512;
static float lcg(uint32_t& s) { s = s * 1664525u + 1013904223u; return (float)((s >> 8) * (1.0 / 16777216.0)); }

__global__ void k_naive(const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C,
                        int M, int K, int N) {
  int col = blockIdx.x * blockDim.x + threadIdx.x, row = blockIdx.y * blockDim.y + threadIdx.y;
  if (row >= M || col >= N) return;
  float acc = 0.0f;
  for (int k = 0; k < K; ++k) acc = __fadd_rn(acc, __fmul_rn(A[row * K + k], B[k * N + col]));
  C[row * N + col] = acc;
}

#define TS 32
__global__ void k_tiled(const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C,
                        int M, int K, int N) {
  __shared__ float As[TS][TS], Bs[TS][TS];
  int tx = threadIdx.x, ty = threadIdx.y;
  int row = blockIdx.y * TS + ty, col = blockIdx.x * TS + tx;
  float acc = 0.0f;
  for (int t = 0; t < (K + TS - 1) / TS; ++t) {
    As[ty][tx] = (row < M && t * TS + tx < K) ? A[row * K + t * TS + tx] : 0.0f;
    Bs[ty][tx] = (col < N && t * TS + ty < K) ? B[t * TS + ty * N + col] : 0.0f;
    __syncthreads();
    for (int k = 0; k < TS; ++k) acc = __fadd_rn(acc, __fmul_rn(As[ty][k], Bs[k][tx]));
    __syncthreads();
  }
  if (row < M && col < N) C[row * N + col] = acc;
}

#define TR 16
__global__ void k_reg(const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C,
                      int M, int K, int N) {
  __shared__ float As[TS][TS + 1], Bs[TS][TS + 1];
  int tx = threadIdx.x, ty = threadIdx.y;
  int r0 = blockIdx.y * TS + ty, c0 = blockIdx.x * TS + tx;
  float a00 = 0, a01 = 0, a10 = 0, a11 = 0;  // 2x2 register tile, one sequential k fold each
  for (int t = 0; t < (K + TS - 1) / TS; ++t) {
    int tid = ty * TR + tx;
    for (int idx = tid; idx < TS * TS; idx += TR * TR) {
      int i = idx / TS, j = idx % TS;
      As[i][j] = (blockIdx.y * TS + i < M && t * TS + j < K) ? A[(blockIdx.y * TS + i) * K + t * TS + j] : 0.0f;
      Bs[i][j] = (t * TS + i < K && blockIdx.x * TS + j < N) ? B[(t * TS + i) * N + blockIdx.x * TS + j] : 0.0f;
    }
    __syncthreads();
    for (int k = 0; k < TS; ++k) {
      float b0 = Bs[k][tx], b1 = Bs[k][tx + TR];
      a00 = __fadd_rn(a00, __fmul_rn(As[ty][k], b0));
      a01 = __fadd_rn(a01, __fmul_rn(As[ty][k], b1));
      a10 = __fadd_rn(a10, __fmul_rn(As[ty + TR][k], b0));
      a11 = __fadd_rn(a11, __fmul_rn(As[ty + TR][k], b1));
    }
    __syncthreads();
  }
  if (r0 < M && c0 < N) C[r0 * N + c0] = a00;
  if (r0 < M && c0 + TR < N) C[r0 * N + c0 + TR] = a01;
  if (r0 + TR < M && c0 < N) C[(r0 + TR) * N + c0] = a10;
  if (r0 + TR < M && c0 + TR < N) C[(r0 + TR) * N + c0 + TR] = a11;
}

template <class F> static float bench(F launch, int reps) {
  cudaEvent_t a, b; cudaEventCreate(&a); cudaEventCreate(&b);
  launch(); cudaDeviceSynchronize();
  std::vector<float> ms;
  for (int i = 0; i < reps; ++i) {
    cudaEventRecord(a); launch(); cudaEventRecord(b); cudaEventSynchronize(b);
    float t; cudaEventElapsedTime(&t, a, b); ms.push_back(t);
  }
  std::sort(ms.begin(), ms.end());
  cudaEventDestroy(a); cudaEventDestroy(b);
  return ms[ms.size() / 2];
}

static int run(int size, bool check) {
  M = K = N = size;
  uint32_t seed = 777;
  std::vector<float> hA((size_t)M * K), hB((size_t)K * N);
  for (auto& v : hA) v = 2.0f * lcg(seed) - 1.0f;
  for (auto& v : hB) v = 2.0f * lcg(seed) - 1.0f;
  float *A, *B, *C1, *C2, *C3, *C4;
  CHECK(cudaMalloc(&A, (size_t)M * K * 4)); CHECK(cudaMalloc(&B, (size_t)K * N * 4));
  CHECK(cudaMalloc(&C1, (size_t)M * N * 4)); CHECK(cudaMalloc(&C2, (size_t)M * N * 4));
  CHECK(cudaMalloc(&C3, (size_t)M * N * 4)); CHECK(cudaMalloc(&C4, (size_t)M * N * 4));
  CHECK(cudaMemcpy(A, hA.data(), (size_t)M * K * 4, cudaMemcpyHostToDevice));
  CHECK(cudaMemcpy(B, hB.data(), (size_t)K * N * 4, cudaMemcpyHostToDevice));
  dim3 g1((N + 15) / 16, (M + 15) / 16), b1(16, 16);
  dim3 g2((N + TS - 1) / TS, (M + TS - 1) / TS), b2(TS, TS);
  float t1 = bench([&] { k_naive<<<g1, b1>>>(A, B, C1, M, K, N); }, 5);
  float t2 = bench([&] { k_tiled<<<g2, b2>>>(A, B, C2, M, K, N); }, 5);
  dim3 b3(TR, TR);
  float t3 = bench([&] { k_reg<<<g2, b3>>>(A, B, C3, M, K, N); }, 5);
  double flops = 2.0 * M * K * N;
  printf("RESULT n=%d naive_ms %.5f tflops %.2f\n", size, t1, flops / (t1 * 1e9));
  printf("RESULT n=%d tiled_ms %.5f tflops %.2f\n", size, t2, flops / (t2 * 1e9));
  printf("RESULT n=%d reg_ms %.5f tflops %.2f\n", size, t3, flops / (t3 * 1e9));
  printf("RESULT n=%d speedup_tiled %.2f\n", size, t1 / t2);
  printf("RESULT n=%d speedup_reg %.2f\n", size, t1 / t3);
  if (check) {
    std::vector<float> c1((size_t)M * N), c2((size_t)M * N), c3((size_t)M * N);
    CHECK(cudaMemcpy(c1.data(), C1, (size_t)M * N * 4, cudaMemcpyDeviceToHost));
    CHECK(cudaMemcpy(c2.data(), C2, (size_t)M * N * 4, cudaMemcpyDeviceToHost));
    CHECK(cudaMemcpy(c3.data(), C3, (size_t)M * N * 4, cudaMemcpyDeviceToHost));
    size_t d2 = 0, d3 = 0;
    for (size_t i = 0; i < (size_t)M * N; ++i) {
      uint32_t w1; memcpy(&w1, &c1[i], 4);
      uint32_t w;
      memcpy(&w, &c2[i], 4); if (w != w1) d2++;
      memcpy(&w, &c3[i], 4); if (w != w1) d3++;
    }
    printf("RESULT n=%d words_differ_tiled %zu_of_%d\n", size, d2, M * N);
    printf("RESULT n=%d words_differ_reg %zu_of_%d\n", size, d3, M * N);
  }
  cudaFree(A); cudaFree(B); cudaFree(C1); cudaFree(C2); cudaFree(C3); cudaFree(C4);
  return 0;
}

int main() {
  cudaDeviceProp p{};
  CHECK(cudaGetDeviceProperties(&p, 0));
  printf("DEVICE %s sm_%d%d smem_per_block=%zu\n", p.name, p.major, p.minor, (size_t)p.sharedMemPerBlock);
  if (run(512, true)) return 1;
  if (run(1024, false)) return 1;
  if (run(2048, false)) return 1;
  return 0;
}
