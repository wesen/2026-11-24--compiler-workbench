#include <cuda_runtime.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>

#define CUDA(call)                                                    \
  do {                                                                \
    const cudaError_t status = (call);                                \
    if (status != cudaSuccess) {                                      \
      std::fprintf(stderr, "%s\n", cudaGetErrorString(status));        \
      std::exit(1);                                                   \
    }                                                                 \
  } while (false)

constexpr int count = 65536;
constexpr int columns = 14;

__device__ float jsMax(float a, float b) {
  if (isnan(a) || isnan(b)) return nanf("");
  if (a == 0.0f && b == 0.0f) return signbit(a) && signbit(b) ? -0.0f : 0.0f;
  return a > b ? a : b;
}

__device__ float jsMin(float a, float b) {
  if (isnan(a) || isnan(b)) return nanf("");
  if (a == 0.0f && b == 0.0f) return signbit(a) || signbit(b) ? -0.0f : 0.0f;
  return a < b ? a : b;
}

__global__ void probe(const float* in, float* out, int terms) {
  const int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= count) return;
  const float x = in[2 * i], y = in[2 * i + 1];
  float* row = out + i * columns;
  row[0] = __double2float_rn(exp((double)x));
  row[1] = __double2float_rn(log((double)x));
  row[2] = __double2float_rn(sqrt((double)x));
  row[3] = __double2float_rn(tanh((double)x));
  row[4] = __fadd_rn(x, y);
  row[5] = __fsub_rn(x, y);
  row[6] = __fmul_rn(x, y);
  row[7] = __double2float_rn(__ddiv_rn((double)x, (double)y));
  row[8] = -x;
  row[9] = jsMax(x, y);
  row[10] = jsMin(x, y);
  row[11] = jsMax(row[7], x);
  float acc = 0.0f;
  for (int j = 0; j < terms; ++j) {
    const float term = j == 0 ? 1.0f : j <= 3 ? 0.0f : 0x1p-24f;
    acc = __fadd_rn(acc, term);
  }
  row[12] = acc;
  row[13] = __fsub_rn(__fadd_rn(0x1p24f, 1.0f), 0x1p24f);
}

int main() {
  static float in[count * 2], out[count * columns];
  auto* input = std::fopen("input.bin", "rb");
  if (!input || std::fread(in, sizeof(float), count * 2, input) != count * 2) return 2;
  std::fclose(input);
  float *dIn, *dOut;
  CUDA(cudaMalloc(&dIn, sizeof(in)));
  CUDA(cudaMalloc(&dOut, sizeof(out)));
  CUDA(cudaMemcpy(dIn, in, sizeof(in), cudaMemcpyHostToDevice));
  cudaDeviceProp device;
  int runtime;
  CUDA(cudaGetDeviceProperties(&device, 0));
  CUDA(cudaRuntimeGetVersion(&runtime));
  cudaEvent_t start, end;
  CUDA(cudaEventCreate(&start));
  CUDA(cudaEventCreate(&end));
  CUDA(cudaEventRecord(start));
  probe<<<count / 256, 256>>>(dIn, dOut, 7);
  CUDA(cudaGetLastError());
  CUDA(cudaEventRecord(end));
  CUDA(cudaEventSynchronize(end));
  float gpuMs;
  CUDA(cudaEventElapsedTime(&gpuMs, start, end));
  std::printf("%s sm_%d%d runtime=%d events=%s\n", device.name, device.major, device.minor, runtime,
              gpuMs > 0.0f ? "ok" : "unexpected interval");
  CUDA(cudaEventDestroy(start));
  CUDA(cudaEventDestroy(end));
  CUDA(cudaMemcpy(out, dOut, sizeof(out), cudaMemcpyDeviceToHost));
  auto* output = std::fopen("out/results.bin", "wb");
  if (!output || std::fwrite(out, sizeof(float), count * columns, output) != count * columns) return 3;
  return std::fclose(output) == 0 ? 0 : 4;
}
