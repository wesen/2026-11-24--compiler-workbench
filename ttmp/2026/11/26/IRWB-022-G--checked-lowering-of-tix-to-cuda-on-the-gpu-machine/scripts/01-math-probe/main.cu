// Design experiment: fixed arithmetic only; this is NOT a Tix backend.
#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>
#define CK(expr) do { cudaError_t e = (expr); if (e != cudaSuccess) { std::fprintf(stderr, "%s: %s\n", #expr, cudaGetErrorString(e)); std::exit(1); } } while (0)
constexpr int N = 16385, cols = 6;
__global__ void grid(float *out) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= N) return;
  float x = float(i - 8192) / 1024.f, p = __fadd_rn(9.f, x);
  float *row = out + i * cols;
  row[0] = expf(x); row[1] = logf(p); row[2] = __fsqrt_rn(p); row[3] = tanhf(x);
  // Centering/logits and a small dot with cancellation, all explicit f32 round sites.
  float z = 0.f, dot = 0.f;
  for (int j = 0; j < 7; ++j) {
    float a = __fdiv_rn(__fadd_rn(x, float(j-3)), 11.f);
    z = __fadd_rn(z, expf(__fsub_rn(a, 1.f)));
    dot = __fadd_rn(dot, __fmul_rn(a, (j & 1) ? -0.75f : 0.5f));
  }
  row[4] = __fdiv_rn(expf(__fsub_rn(__fdiv_rn(__fadd_rn(x, 3.f), 11.f), 1.f)), z);
  row[5] = dot;
}
int main() {
  cudaDeviceProp p; CK(cudaGetDeviceProperties(&p, 0)); int driver, runtime;
  CK(cudaDriverGetVersion(&driver)); CK(cudaRuntimeGetVersion(&runtime));
  std::printf("%s sm_%d%d nvcc %d.%d.%d runtime %d driver %d\n", p.name, p.major, p.minor,
              __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__, runtime, driver);
  float *d; std::vector<float> h(N * cols); CK(cudaMalloc(&d, h.size() * sizeof(float)));
  grid<<<(N+127)/128, 128>>>(d); CK(cudaGetLastError());
  CK(cudaMemcpy(h.data(), d, h.size() * sizeof(float), cudaMemcpyDeviceToHost)); CK(cudaFree(d));
  auto f = std::fopen("out/grid.bin", "wb"); if (!f) return 2;
  if (std::fwrite(h.data(), sizeof(float), h.size(), f) != h.size()) return 2;
  return std::fclose(f) != 0;
}
