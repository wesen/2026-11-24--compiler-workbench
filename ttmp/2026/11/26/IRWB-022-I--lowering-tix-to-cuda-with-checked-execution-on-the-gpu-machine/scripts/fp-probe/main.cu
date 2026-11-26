#include <cuda_runtime.h>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

#define CUDA(call) do { \
  cudaError_t error = (call); \
  if (error != cudaSuccess) { \
    fprintf(stderr, "%s: %s\n", #call, cudaGetErrorString(error)); \
    return 1; \
  } \
} while (0)

enum { columns = 21, dot_width = 1023, dot_rows = 4 };

__device__ float js_minmax(float a, float b, bool max) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(max ? x & y : x | y);
  }
  return (max ? a > b : a < b) ? a : b;
}

__global__ void probe(const float* in, float* out, size_t n) {
  size_t i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= n) return;
  float a = in[3 * i], b = in[3 * i + 1], c = in[3 * i + 2];
  float* row = out + columns * i;
  row[0] = __fadd_rn(a, b);
  row[1] = __fsub_rn(a, b);
  row[2] = __fmul_rn(a, b);
  row[3] = __fdiv_rn(a, b);
  row[4] = -a;
  row[5] = __fsqrt_rn(a);
  row[6] = expf(a);
  row[7] = logf(a);
  row[8] = tanhf(a);
  row[9] = __double2float_rn(exp(static_cast<double>(a)));
  row[10] = __double2float_rn(log(static_cast<double>(a)));
  row[11] = __double2float_rn(tanh(static_cast<double>(a)));
  row[12] = js_minmax(a, b, true);
  row[13] = js_minmax(a, b, false);
  row[14] = __fadd_rn(__fmul_rn(a, b), c);
  row[15] = a * b + c;
  float nan = __fsqrt_rn(a);
  row[16] = nan + b;
  row[17] = js_minmax(nan, b, true);
  row[18] = __fadd_rn(__fadd_rn(a, b), c);
  row[19] = row[20] = 0.0f;
  if (i < dot_width * dot_rows && i % dot_width == 0) {
    float sequential = 0.0f, blocked = 0.0f;
    for (int k = 0; k < dot_width; ++k) {
      const float* term = in + 3 * (i + k);
      sequential = __fadd_rn(sequential, __fmul_rn(term[0], term[1]));
    }
    for (int k = 0; k < dot_width; k += 4) {
      float partial = 0.0f;
      for (int lane = 0; lane < 4 && k + lane < dot_width; ++lane) {
        const float* term = in + 3 * (i + k + lane);
        partial = __fadd_rn(partial, __fmul_rn(term[0], term[1]));
      }
      blocked = __fadd_rn(blocked, partial);
    }
    row[19] = sequential;
    row[20] = blocked;
  }
}

int main() {
  if (std::system("/usr/local/cuda-13.0/bin/nvcc --version") != 0) return 2;
  int driver = 0;
  cudaDeviceProp device{};
  CUDA(cudaDriverGetVersion(&driver));
  CUDA(cudaGetDeviceProperties(&device, 0));
  printf("%s sm_%d%d nvcc %d.%d.%d driver %d\n", device.name, device.major, device.minor,
    __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__, driver);
  FILE* input = fopen("inputs.bin", "rb");
  if (!input || fseek(input, 0, SEEK_END) != 0) return 2;
  size_t n = ftell(input) / (3 * sizeof(float));
  std::vector<float> in(3 * n), out(columns * n);
  rewind(input);
  if (fread(in.data(), sizeof(float), in.size(), input) != in.size()) return 2;
  fclose(input);
  float* device_in;
  float* device_out;
  CUDA(cudaMalloc(&device_in, in.size() * sizeof(float)));
  CUDA(cudaMalloc(&device_out, out.size() * sizeof(float)));
  CUDA(cudaMemcpy(device_in, in.data(), in.size() * sizeof(float), cudaMemcpyHostToDevice));
  probe<<<(n + 255) / 256, 256>>>(device_in, device_out, n);
  CUDA(cudaGetLastError());
  CUDA(cudaMemcpy(out.data(), device_out, out.size() * sizeof(float), cudaMemcpyDeviceToHost));
  FILE* output = fopen("out/outputs.bin", "wb");
  if (!output || fwrite(out.data(), sizeof(float), out.size(), output) != out.size()) return 2;
  return fclose(output) != 0;
}
