// Standalone arithmetic probe. The Node driver writes two arrays of 4096 binary32 values.
#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

constexpr int count = 4096, columns = 10;

#define CUDA(call) do { cudaError_t e = (call); if (e != cudaSuccess) { \
  std::fprintf(stderr, "%s: %s\n", #call, cudaGetErrorString(e)); std::exit(1); } } while (0)

__global__ void arithmetic(const float *x, const float *y, float *out) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i >= count) return;
  float a = x[i], b = y[i];
  float *row = out + columns * i;
  row[0] = __fadd_rn(a, b);
  row[1] = __fsub_rn(a, b);
  row[2] = __fmul_rn(a, b);
  row[3] = __fdiv_rn(a, b);
  row[4] = expf(a);
  row[5] = logf(b);
  row[6] = __fsqrt_rn(b);
  row[7] = tanhf(a);
  float acc = 0;
  for (int j = 0; j < 7; ++j) {
    int k = (i + j) % count;
    acc = __fadd_rn(acc, __fmul_rn(x[k], y[k]));
  }
  row[8] = acc;
  row[9] = __fsub_rn(__fmul_rn(a, b), 1.0f);
}

int main(int argc, char **) {
  std::vector<float> input(2 * count), output(count * columns);
  FILE *f = std::fopen("inputs.bin", "rb");
  if (!f || std::fread(input.data(), sizeof(float), input.size(), f) != input.size()) return 1;
  std::fclose(f);
  cudaDeviceProp props;
  CUDA(cudaGetDeviceProperties(&props, 0));
  std::printf("%s sm_%d%d nvcc %d.%d.%d\n", props.name, props.major, props.minor,
              __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__);
  float *xy, *out;
  CUDA(cudaMalloc(&xy, input.size() * sizeof(float)));
  CUDA(cudaMalloc(&out, output.size() * sizeof(float)));
  CUDA(cudaMemcpy(xy, input.data(), input.size() * sizeof(float), cudaMemcpyHostToDevice));
  auto launch = [&]() { arithmetic<<<(count + 127) / 128, 128>>>(xy, xy + count, out); };
  launch();
  CUDA(cudaGetLastError());
  if (argc > 1) {
    cudaEvent_t start, end;
    CUDA(cudaEventCreate(&start));
    CUDA(cudaEventCreate(&end));
    CUDA(cudaEventRecord(start));
    launch();
    CUDA(cudaGetLastError());
    CUDA(cudaEventRecord(end));
    CUDA(cudaEventSynchronize(end));
    float ms;
    CUDA(cudaEventElapsedTime(&ms, start, end));
    std::printf("event interval %g ms\n", ms);
    CUDA(cudaEventDestroy(start));
    CUDA(cudaEventDestroy(end));
  }
  CUDA(cudaMemcpy(output.data(), out, output.size() * sizeof(float), cudaMemcpyDeviceToHost));
  CUDA(cudaFree(out));
  CUDA(cudaFree(xy));
  f = std::fopen("out/words.bin", "wb");
  if (!f || std::fwrite(output.data(), sizeof(float), output.size(), f) != output.size()) return 1;
  return std::fclose(f) != 0;
}
