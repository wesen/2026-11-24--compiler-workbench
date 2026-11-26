// Experiment 4 (GB10): what does the exact f32 meaning of  y[i,j] = sum(k) a[i,k]*b[k,j]  cost?
// The meaning fixes, per output element, a product rounding and an in-order sum. It does not fix which thread
// computes which element, nor where operands are staged. Schedules compared (all row-major, square n):
//   naive      one thread per element (stage 2's kernel shape)
//   tile       64x64 output tile per 256-thread block, 4x4 outputs per thread, 16-wide k tiles staged in
//              shared memory; every element still folds k = 0..K-1 in order with __fmul_rn/__fadd_rn
//   tile_fma   the same schedule with fmaf: one rounding instead of two, so NOT the Tix meaning
//   cublas     cublasSgemm loaded with dlopen (no link flags available through cuda-remote), if found
// Reports median ms, TFLOP/s, and bit comparisons against naive.
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <vector>
#include <algorithm>
#include <dlfcn.h>
#include <cmath>
#include <cuda_runtime.h>
typedef long long I;
__global__ void k_naive(const float* a, const float* b, float* y, I n) {
  I t = (I)blockIdx.x * blockDim.x + threadIdx.x;
  if (t >= n * n) return;
  I i = t / n, j = t % n;
  float s = 0.0f;
  for (I k = 0; k < n; ++k) s = __fadd_rn(s, __fmul_rn(a[i * n + k], b[k * n + j]));
  y[t] = s;
}
#define TS 64
#define KT 16
#define RG 4
template <bool FMA> __global__ void k_tile(const float* a, const float* b, float* y, int n) {
  __shared__ float As[TS][KT];
  __shared__ float Bs[KT][TS];
  const int tx = threadIdx.x, ty = threadIdx.y;  // 16 x 16
  const int i0 = blockIdx.y * TS, j0 = blockIdx.x * TS;
  float c[RG][RG];
  for (int u = 0; u < RG; u++) for (int v = 0; v < RG; v++) c[u][v] = 0.0f;
  for (int k0 = 0; k0 < n; k0 += KT) {
    // A tile: 64 rows x 16 k; thread (tx,ty) loads rows ty*4..ty*4+3 at column tx
    for (int u = 0; u < RG; u++) As[ty * RG + u][tx] = a[(I)(i0 + ty * RG + u) * n + k0 + tx];
    // B tile: 16 k x 64 cols; thread loads row ty, cols tx*4..tx*4+3
    for (int v = 0; v < RG; v++) Bs[ty][tx * RG + v] = b[(I)(k0 + ty) * n + j0 + tx * RG + v];
    __syncthreads();
    for (int kk = 0; kk < KT; kk++) {
      float av[RG], bv[RG];
      for (int u = 0; u < RG; u++) av[u] = As[ty * RG + u][kk];
      for (int v = 0; v < RG; v++) bv[v] = Bs[kk][tx * RG + v];
      for (int u = 0; u < RG; u++)
        for (int v = 0; v < RG; v++)
          c[u][v] = FMA ? fmaf(av[u], bv[v], c[u][v]) : __fadd_rn(c[u][v], __fmul_rn(av[u], bv[v]));
    }
    __syncthreads();
  }
  for (int u = 0; u < RG; u++) for (int v = 0; v < RG; v++) y[(I)(i0 + ty * RG + u) * n + j0 + tx * RG + v] = c[u][v];
}
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "cuda error %s line %d\n", cudaGetErrorString(e_), __LINE__); exit(2); } } while (0)
template <class F> static double timeit(F f, int reps) {
  cudaEvent_t a, b; CK(cudaEventCreate(&a)); CK(cudaEventCreate(&b));
  std::vector<double> ms;
  f(); CK(cudaDeviceSynchronize());
  for (int i = 0; i < reps; i++) { CK(cudaEventRecord(a)); f(); CK(cudaEventRecord(b)); CK(cudaEventSynchronize(b)); float t; CK(cudaEventElapsedTime(&t, a, b)); ms.push_back(t); }
  std::sort(ms.begin(), ms.end());
  return ms[ms.size() / 2];
}
static uint64_t st = 20;
static double uni() { st = st * 6364136223846793005ULL + 1442695040888963407ULL; return (double)(st >> 11) / 9007199254740992.0; }
typedef int (*CreateFn)(void**);
typedef int (*GemmFn)(void*, int, int, int, int, int, const float*, const float*, int, const float*, int, const float*, float*, int);
int main() {
  void* lib = nullptr;
  const char* names[] = {"libcublas.so", "libcublas.so.13", "/usr/local/cuda-13.0/lib64/libcublas.so", "/usr/local/cuda-13.0/lib64/libcublas.so.13", "/usr/local/cuda/lib64/libcublas.so"};
  for (const char* nm : names) if (!lib) lib = dlopen(nm, RTLD_NOW | RTLD_GLOBAL);
  void* handle = nullptr; GemmFn gemm = nullptr;
  if (lib) { CreateFn cr = (CreateFn)dlsym(lib, "cublasCreate_v2"); gemm = (GemmFn)dlsym(lib, "cublasSgemm_v2"); if (!cr || !gemm || cr(&handle)) gemm = nullptr; }
  for (int n : {512, 2048, 4096}) {
    I nn = (I)n * n;
    std::vector<float> ha(nn), hb(nn);
    for (I i = 0; i < nn; i++) { ha[i] = (float)(2 * uni() - 1); hb[i] = (float)(2 * uni() - 1); }
    float *a, *b, *y0, *y1, *y2, *y3;
    for (float** p : {&a, &b, &y0, &y1, &y2, &y3}) CK(cudaMalloc(p, nn * 4));
    CK(cudaMemcpy(a, ha.data(), nn * 4, cudaMemcpyHostToDevice)); CK(cudaMemcpy(b, hb.data(), nn * 4, cudaMemcpyHostToDevice));
    int reps = n >= 4096 ? 3 : n >= 2048 ? 5 : 21;
    dim3 grid(n / TS, n / TS), block(16, 16);
    double t0 = timeit([&] { k_naive<<<(unsigned)((nn + 255) / 256), 256>>>(a, b, y0, n); }, reps);
    double t1 = timeit([&] { k_tile<false><<<grid, block>>>(a, b, y1, n); }, reps);
    double t2 = timeit([&] { k_tile<true><<<grid, block>>>(a, b, y2, n); }, reps);
    double t3 = -1;
    const float one = 1.0f, zero = 0.0f;
    // row-major C = A*B is column-major C^T = B^T * A^T: pass (b, a)
    if (gemm) t3 = timeit([&] { gemm(handle, 0, 0, n, n, n, &one, b, n, a, n, &zero, y3, n); }, reps);
    std::vector<float> h0(nn), h1(nn), h2(nn), h3(nn);
    CK(cudaMemcpy(h0.data(), y0, nn * 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(h1.data(), y1, nn * 4, cudaMemcpyDeviceToHost));
    CK(cudaMemcpy(h2.data(), y2, nn * 4, cudaMemcpyDeviceToHost)); if (gemm) CK(cudaMemcpy(h3.data(), y3, nn * 4, cudaMemcpyDeviceToHost));
    I d1 = 0, d2 = 0, d3 = 0, d23 = 0; double m3 = 0;
    for (I i = 0; i < nn; i++) { d1 += memcmp(&h0[i], &h1[i], 4) != 0; d2 += memcmp(&h0[i], &h2[i], 4) != 0; d3 += memcmp(&h0[i], &h3[i], 4) != 0; d23 += memcmp(&h2[i], &h3[i], 4) != 0; double e = fabs((double)h0[i] - h3[i]); if (e > m3) m3 = e; }
    double fl = 2.0 * n * n * n;
    printf("{\"n\":%d,\"naive_ms\":%.4f,\"tile_exact_ms\":%.4f,\"tile_fma_ms\":%.4f,\"cublas_ms\":%.4f,\"tflops\":{\"naive\":%.2f,\"tile_exact\":%.2f,\"tile_fma\":%.2f,\"cublas\":%.2f},\"words_differing_from_naive\":{\"tile_exact\":%lld,\"tile_fma\":%lld,\"cublas\":%lld},\"cublas_vs_tile_fma\":%lld,\"of\":%lld,\"cublas_max_abs_diff\":%.3g}\n",
           n, t0, t1, t2, t3, fl / t0 / 1e9, fl / t1 / 1e9, fl / t2 / 1e9, t3 > 0 ? fl / t3 / 1e9 : 0.0, d1, d2, gemm ? d3 : -1, gemm ? d23 : -1, nn, gemm ? m3 : -1.0);
    for (float* p : {a, b, y0, y1, y2, y3}) cudaFree(p);
  }
  return 0;
}
