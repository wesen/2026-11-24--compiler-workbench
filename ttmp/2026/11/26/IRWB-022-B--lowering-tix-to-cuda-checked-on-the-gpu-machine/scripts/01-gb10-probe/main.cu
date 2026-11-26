#include <cuda_runtime.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <vector>

static void check(cudaError_t code) {
  if (code != cudaSuccess) {
    std::fprintf(stderr, "%s\n", cudaGetErrorString(code));
    std::exit(2);
  }
}

__device__ float js_max(float a, float b) {
  if (isnan(a) || isnan(b)) return __int_as_float(0x7fc00000);
  if (a == 0 && b == 0) return __int_as_float(__float_as_int(a) & __float_as_int(b));
  return a > b ? a : b;
}

__device__ float js_min(float a, float b) {
  if (isnan(a) || isnan(b)) return __int_as_float(0x7fc00000);
  if (a == 0 && b == 0) return __int_as_float(__float_as_int(a) | __float_as_int(b));
  return a < b ? a : b;
}

struct KernelData {
  const float *in;
  float *out;
  int64_t count;
};

constexpr int stride = 18;
__global__ void atoms(const float *in, float *out, int count) {
  int i = blockDim.x * blockIdx.x + threadIdx.x;
  if (i >= count) return;
  float a = in[i * 4], b = in[i * 4 + 1], positive = in[i * 4 + 2], bounded = in[i * 4 + 3];
  float *r = out + i * stride;
  r[0] = __fadd_rn(a, b);
  r[1] = __fsub_rn(a, b);
  r[2] = __fmul_rn(a, b);
  r[3] = __fdiv_rn(a, b);
  r[4] = -a;
  r[5] = __fsqrt_rn(positive);
  r[6] = js_max(a, b);
  r[7] = js_min(a, b);
  r[8] = expf(bounded);
  r[9] = logf(positive);
  r[10] = tanhf(bounded);
  r[11] = __double2float_rn(exp((double)bounded));
  r[12] = __double2float_rn(log((double)positive));
  r[13] = __double2float_rn(tanh((double)bounded));
  r[14] = a * a + b;
  r[15] = __fadd_rn(__fmul_rn(a, a), b);
  r[16] = __ll2float_rn(16777216LL + i);
  r[17] = __uint_as_float(0x3d372713);
}

constexpr int width = 32;
__global__ void folds(const KernelData *data) {
  const float *in = data->in;
  float *out = data->out;
  int64_t rows = data->count;
  int row = blockDim.x * blockIdx.x + threadIdx.x;
  if (row >= rows) return;
  in += row * width * 4;
  float sum = 0, composed = 0, blocked = 0, composed_f = 0;
  for (int i = 0; i < width; ++i) {
    float x = in[i * 4 + 3];
    sum = __fadd_rn(sum, x);
    composed = __fadd_rn(composed, __double2float_rn(tanh((double)x)));
    composed_f = __fadd_rn(composed_f, tanhf(x));
  }
  for (int k = 0; k < width; k += 4) {
    float part = 0;
    for (int i = k; i < k + 4; ++i) part = __fadd_rn(part, in[i * 4 + 3]);
    blocked = __fadd_rn(blocked, part);
  }
  out[row * 4] = sum;
  out[row * 4 + 1] = composed;
  out[row * 4 + 2] = blocked;
  out[row * 4 + 3] = composed_f;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int count = std::atoi(argv[1]);
  if (count <= 0 || count % width) return 2;
  int rows = count / width;
  std::vector<float> in(count * 4), out(count * stride + rows * 4);
  FILE *f = std::fopen("input.bin", "rb");
  if (!f || std::fread(in.data(), sizeof(float), in.size(), f) != in.size()) return 2;
  std::fclose(f);
  cudaDeviceProp props{};
  int driver, runtime;
  check(cudaGetDeviceProperties(&props, 0));
  check(cudaDriverGetVersion(&driver));
  check(cudaRuntimeGetVersion(&runtime));
  std::printf("%s sm_%d%d driver=%d runtime=%d nvcc=%d.%d.%d\n",
              props.name, props.major, props.minor, driver, runtime,
              __CUDACC_VER_MAJOR__, __CUDACC_VER_MINOR__, __CUDACC_VER_BUILD__);
  if (std::system(
          "nvidia-smi --query-gpu=driver_version,compute_cap --format=csv,noheader && "
          "/usr/local/cuda-13.0/bin/nvcc --version") != 0) return 2;
  if (std::system(
          "sh -c 'lock=$(mktemp); flock -x \"$lock\" -c true; rc=$?; rm -f \"$lock\"; exit \"$rc\"'") != 0)
    return 2;
  float *device_in, *device_out;
  KernelData *device_data;
  check(cudaMalloc(&device_in, in.size() * sizeof(float)));
  check(cudaMalloc(&device_out, out.size() * sizeof(float)));
  check(cudaMalloc(&device_data, sizeof(KernelData)));
  check(cudaMemcpy(device_in, in.data(), in.size() * sizeof(float), cudaMemcpyHostToDevice));
  KernelData data{device_in, device_out + count * stride, rows};
  check(cudaMemcpy(device_data, &data, sizeof(data), cudaMemcpyHostToDevice));
  cudaFuncAttributes attributes;
  check(cudaFuncGetAttributes(&attributes, atoms));
  check(cudaFuncGetAttributes(&attributes, folds));
  cudaEvent_t start, end;
  check(cudaEventCreate(&start));
  check(cudaEventCreate(&end));
  check(cudaEventRecord(start));
  atoms<<<(count + 127) / 128, 128>>>(device_in, device_out, count);
  check(cudaGetLastError());
  folds<<<(rows + 127) / 128, 128>>>(device_data);
  check(cudaGetLastError());
  check(cudaEventRecord(end));
  check(cudaEventSynchronize(end));
  float ms;
  check(cudaEventElapsedTime(&ms, start, end));
  if (!std::isfinite(ms) || ms <= 0) return 2;
  std::puts("CUDA events recorded a positive elapsed interval");
  check(cudaMemcpy(out.data(), device_out, out.size() * sizeof(float), cudaMemcpyDeviceToHost));
  f = std::fopen("out/observations.bin", "wb");
  if (!f || std::fwrite(out.data(), sizeof(float), out.size(), f) != out.size() || std::fclose(f)) return 2;
  return 0;
}
