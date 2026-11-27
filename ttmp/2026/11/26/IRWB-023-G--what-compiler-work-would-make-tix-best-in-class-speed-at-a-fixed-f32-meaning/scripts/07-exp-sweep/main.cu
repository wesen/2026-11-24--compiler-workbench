// Can the transcendental clause of Tix's meaning be certified for the whole f32 domain, and is it
// implementation-independent?
//
// Stage 2 fixed the meaning of exp/log/tanh as "the CUDA double routine, rounded once to f32". That clause
// is what makes the GPU result bit-identical to Math.fround(Math.exp(x)). Two questions a sampled
// differential test cannot answer:
//
//   1. Cost. How long does a sweep of all 2^32 f32 inputs take? If it is seconds, exhaustive evidence is
//      affordable and the sampled case list is a choice, not a necessity.
//   2. Robustness. Does the f32 answer depend on *which* double implementation is used? This sweep compares
//      exp(x) against exp2(x*log2(e)), log(x) against log2(x)*log(2), and tanh against the
//      (exp(2x)-1)/(exp(2x)+1) form, all in double, each rounded once to f32, for every f32 input.
//
// Usage: ./prog [--sample N]     (default sweeps the full domain)
#include <cuda_runtime.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <vector>

#define CK(x)                                                                     \
  do {                                                                            \
    cudaError_t e_ = (x);                                                         \
    if (e_ != cudaSuccess) {                                                      \
      fprintf(stderr, "CUDA %s at %d\n", cudaGetErrorString(e_), __LINE__);       \
      exit(1);                                                                    \
    }                                                                             \
  } while (0)

struct Counts {
  unsigned long long expDiff, logDiff, tanhDiff;   // different f32 words between the two forms
  unsigned long long expNaN, logNaN, tanhNaN;      // NaN results (both forms)
  unsigned long long expMismatchClass, logMismatchClass, tanhMismatchClass;  // NaN vs number disagreement
  unsigned long long inputs;
};

__device__ __forceinline__ float r32(double x) { return __double2float_rn(x); }

__global__ void sweep(unsigned long long start, unsigned long long count, Counts* out) {
  unsigned long long i = start + blockIdx.x * (unsigned long long)blockDim.x + threadIdx.x;
  const unsigned long long stride = (unsigned long long)gridDim.x * blockDim.x;
  Counts c{};
  for (; i < start + count; i += stride) {
    const unsigned b = (unsigned)(i & 0xffffffffull);
    const float x = __uint_as_float(b);
    const double d = (double)x;
    const float e1 = r32(exp(d)), e2 = r32(exp2(d * 1.4426950408889634));
    const float l1 = r32(log(d)), l2 = r32(log2(d) * 0.6931471805599453);
    const float t1 = r32(tanh(d)), t2 = r32((exp(2.0 * d) - 1.0) / (exp(2.0 * d) + 1.0));
    const bool en = isnan(e1), ln = isnan(l1), tn = isnan(t1);
    c.expNaN += en;
    c.logNaN += ln;
    c.tanhNaN += tn;
    if (en != isnan(e2)) c.expMismatchClass++;
    else if (!en && __float_as_uint(e1) != __float_as_uint(e2) && !(en && isnan(e2))) c.expDiff++;
    if (ln != isnan(l2)) c.logMismatchClass++;
    else if (!ln && __float_as_uint(l1) != __float_as_uint(l2)) c.logDiff++;
    if (tn != isnan(t2)) c.tanhMismatchClass++;
    else if (!tn && __float_as_uint(t1) != __float_as_uint(t2)) c.tanhDiff++;
    c.inputs++;
  }
  // One atomic-free reduction per block into a slab, then a sequential sum on the host.
  __shared__ Counts s[256];
  s[threadIdx.x] = c;
  __syncthreads();
  for (int w = 128; w > 0; w >>= 1) {
    if (threadIdx.x < w) {
      s[threadIdx.x].expDiff += s[threadIdx.x + w].expDiff;
      s[threadIdx.x].logDiff += s[threadIdx.x + w].logDiff;
      s[threadIdx.x].tanhDiff += s[threadIdx.x + w].tanhDiff;
      s[threadIdx.x].expNaN += s[threadIdx.x + w].expNaN;
      s[threadIdx.x].logNaN += s[threadIdx.x + w].logNaN;
      s[threadIdx.x].tanhNaN += s[threadIdx.x + w].tanhNaN;
      s[threadIdx.x].expMismatchClass += s[threadIdx.x + w].expMismatchClass;
      s[threadIdx.x].logMismatchClass += s[threadIdx.x + w].logMismatchClass;
      s[threadIdx.x].tanhMismatchClass += s[threadIdx.x + w].tanhMismatchClass;
      s[threadIdx.x].inputs += s[threadIdx.x + w].inputs;
    }
    __syncthreads();
  }
  if (threadIdx.x == 0) out[blockIdx.x] = s[0];
}

int main(int argc, char** argv) {
  unsigned long long count = 1ull << 32;
  for (int i = 1; i + 1 < argc; ++i)
    if (!strcmp(argv[i], "--sample")) count = strtoull(argv[i + 1], nullptr, 10);
  cudaDeviceProp prop;
  CK(cudaGetDeviceProperties(&prop, 0));
  const int blocks = prop.multiProcessorCount * 32;
  std::vector<Counts> partial(blocks);
  Counts* dev;
  CK(cudaMalloc(&dev, blocks * sizeof(Counts)));
  cudaEvent_t s, e;
  CK(cudaEventCreate(&s));
  CK(cudaEventCreate(&e));
  // Warm up (module load, instruction cache).
  sweep<<<blocks, 256>>>(0, 1u << 16, dev);
  CK(cudaDeviceSynchronize());
  CK(cudaEventRecord(s));
  sweep<<<blocks, 256>>>(0, count, dev);
  CK(cudaEventRecord(e));
  CK(cudaDeviceSynchronize());
  float ms;
  CK(cudaEventElapsedTime(&ms, s, e));
  CK(cudaMemcpy(partial.data(), dev, blocks * sizeof(Counts), cudaMemcpyDeviceToHost));
  Counts total{};
  for (const Counts& c : partial) {
    total.expDiff += c.expDiff;
    total.logDiff += c.logDiff;
    total.tanhDiff += c.tanhDiff;
    total.expNaN += c.expNaN;
    total.logNaN += c.logNaN;
    total.tanhNaN += c.tanhNaN;
    total.expMismatchClass += c.expMismatchClass;
    total.logMismatchClass += c.logMismatchClass;
    total.tanhMismatchClass += c.tanhMismatchClass;
    total.inputs += c.inputs;
  }
  printf(
      "{\"device\": \"%s\", \"inputs\": %llu, \"sweepMs\": %.1f, \"nsPerInput\": %.3f,\n"
      " \"perIntrinsicSweepSeconds\": %.3f,\n"
      " \"exp\": {\"nanResults\": %llu, \"wordsDifferent\": %llu, \"nanClassDisagreement\": %llu},\n"
      " \"log\": {\"nanResults\": %llu, \"wordsDifferent\": %llu, \"nanClassDisagreement\": %llu},\n"
      " \"tanh\": {\"nanResults\": %llu, \"wordsDifferent\": %llu, \"nanClassDisagreement\": %llu}}\n",
      prop.name, total.inputs, ms, ms * 1e6 / (double)total.inputs,
      ms * 1e-3 / 3.0, total.expNaN, total.expDiff, total.expMismatchClass, total.logNaN, total.logDiff,
      total.logMismatchClass, total.tanhNaN, total.tanhDiff, total.tanhMismatchClass);
  return 0;
}
