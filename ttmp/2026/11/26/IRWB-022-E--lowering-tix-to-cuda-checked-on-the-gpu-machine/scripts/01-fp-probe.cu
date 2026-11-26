// Design experiment only. Run with 02-fp-probe.mjs through tools/cuda-remote.mjs.
#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>

constexpr int rows = 8, cols = 1024, count = rows * cols, ops = 11;
#define CUDA(call) do { \
  cudaError_t rc = call; \
  if (rc != cudaSuccess) { std::fprintf(stderr, "%s: %s\n", #call, cudaGetErrorString(rc)); std::exit(1); } \
} while (0)

__device__ float extreme(float a, float b, bool max) {
  if (isnan(a)) return a;
  if (isnan(b)) return b;
  if (a == 0.0f && b == 0.0f) {
    unsigned aa = __float_as_uint(a), bb = __float_as_uint(b);
    return __uint_as_float(max ? (aa & bb) : (aa | bb));
  }
  return max ? (a > b ? a : b) : (a < b ? a : b);
}

__global__ void scalar(const float *x, float *o) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= count) return;
  float a = x[2*i], b = x[2*i+1];
  float *p = o + ops*i;
  p[0] = __fadd_rn(a,b);
  p[1] = __fsub_rn(a,b);
  p[2] = __fmul_rn(a,b);
  p[3] = __fdiv_rn(a,b);
  p[4] = -a;
  p[5] = expf(a);
  p[6] = logf(b);
  p[7] = __fsqrt_rn(b);
  p[8] = tanhf(a);
  p[9] = extreme(a,b,true);
  p[10] = extreme(a,b,false);
}

__global__ void rowMax(const float *x, float *m) {
  int r = threadIdx.x;
  float a = -INFINITY;
  for (int k=0; k<cols; ++k) a = extreme(a,x[2*(r*cols+k)],true);
  m[r] = a;
}
__global__ void exponent(const float *x, const float *m, float *e) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < count) e[i] = expf(__fsub_rn(x[2*i],m[i/cols]));
}
__global__ void rowSum(const float *e, float *z) {
  int r = threadIdx.x;
  float a = 0.0f;
  for (int k=0; k<cols; ++k) a = __fadd_rn(a,e[r*cols+k]);
  z[r] = a;
}
__global__ void quotient(const float *e, const float *z, float *p) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < count) p[i] = __fdiv_rn(e[i],z[i/cols]);
}
__global__ void edges(float *o) {
  float sub = __uint_as_float(1);
  o[0] = __fadd_rn(sub,sub);
  o[1] = extreme(-0.0f,0.0f,true);
  o[2] = extreme(-0.0f,0.0f,false);
  o[3] = -0.0f;
  o[4] = extreme(-INFINITY,logf(-1.0f),true);
  o[5] = expf(89.0f);
  o[6] = 0.0f;
  for (int k = 0; k < 7; ++k) o[6] = __fadd_rn(o[6], k == 0 ? 1.0f : k < 4 ? 0.0f : 0x1p-24f);
  volatile float a = 0x1.000002p0f, b = 0x1.fffffcp-1f;
  o[7] = __fadd_rn(__fmul_rn(a,b),-1.0f);
  o[8] = __ll2float_rn(16777217LL);
}

static void save(const char *name, float *device, size_t n) {
  auto *host = new float[n];
  CUDA(cudaMemcpy(host, device, n*sizeof(float), cudaMemcpyDeviceToHost));
  FILE *file = std::fopen(name, "wb");
  if (!file || std::fwrite(host, sizeof(float), n, file) != n || std::fclose(file)) std::exit(2);
  delete[] host;
}
int main() {
  cudaDeviceProp prop;
  int driver, runtime;
  CUDA(cudaGetDeviceProperties(&prop, 0));
  CUDA(cudaDriverGetVersion(&driver));
  CUDA(cudaRuntimeGetVersion(&runtime));
  std::printf("%s, sm_%d%d, nvcc %d.%d.%d, runtime %d, driver API %d\n", prop.name, prop.major,
              prop.minor, __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__, runtime, driver);
  float input[2*count];
  auto *file = std::fopen("input.f32", "rb");
  if (!file || std::fread(input, sizeof(float), 2*count, file) != 2*count || std::fclose(file)) return 2;
  float *x, *o, *m, *e, *z, *p, *s;
  CUDA(cudaMalloc(&x,sizeof(input)));
  CUDA(cudaMalloc(&o,ops*count*sizeof(float)));
  CUDA(cudaMalloc(&m,rows*sizeof(float)));
  CUDA(cudaMalloc(&e,count*sizeof(float)));
  CUDA(cudaMalloc(&z,rows*sizeof(float)));
  CUDA(cudaMalloc(&p,count*sizeof(float)));
  CUDA(cudaMalloc(&s,9*sizeof(float)));
  CUDA(cudaMemcpy(x,input,sizeof(input),cudaMemcpyHostToDevice));
  cudaEvent_t start, stop;
  CUDA(cudaEventCreate(&start));
  CUDA(cudaEventCreate(&stop));
  scalar<<<count/128,128>>>(x,o);
  CUDA(cudaEventRecord(start));
  rowMax<<<1,rows>>>(x,m);
  exponent<<<count/128,128>>>(x,m,e);
  rowSum<<<1,rows>>>(e,z);
  quotient<<<count/128,128>>>(e,z,p);
  CUDA(cudaEventRecord(stop));
  CUDA(cudaEventSynchronize(stop));
  float ms;
  CUDA(cudaEventElapsedTime(&ms, start, stop));
  if (!std::isfinite(ms) || ms <= 0) return 3;
  std::puts("CUDA event span for four launches was positive and finite");
  edges<<<1,1>>>(s);
  CUDA(cudaGetLastError());
  CUDA(cudaDeviceSynchronize());
  save("out/scalar.f32",o,ops*count);
  save("out/softmax.f32",p,count);
  save("out/edges.f32",s,9);
  return 0;
}
