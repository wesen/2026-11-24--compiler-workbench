
#include <cuda_runtime.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

using I = int64_t;
using U = uint64_t;

static void check(cudaError_t status) {
  if (status != cudaSuccess) throw std::runtime_error(cudaGetErrorString(status));
}

__device__ static float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

struct DeviceBuffer {
  float* ptr = nullptr;
  U size;
  explicit DeviceBuffer(U n) : size(n) {
    if (size) check(cudaMalloc(&ptr, size * sizeof(float)));
  }
  ~DeviceBuffer() { if (ptr) cudaFree(ptr); }
  DeviceBuffer(const DeviceBuffer&) = delete;
  void upload(const float* src) const {
    if (size) check(cudaMemcpy(ptr, src, size * sizeof(float), cudaMemcpyHostToDevice));
  }
  void download(float* dst) const {
    if (size) check(cudaMemcpy(dst, ptr, size * sizeof(float), cudaMemcpyDeviceToHost));
  }
};

template <size_t N> static U elements(const std::array<I, N>& shape) {
  U n = 1;
  for (I extent : shape) n *= static_cast<U>(extent);
  return n;
}

template <class T> static void read(FILE* file, T* ptr, size_t count) {
  if (count && fread(ptr, sizeof(T), count, file) != count) throw std::runtime_error("short CUDA request");
}

template <class T> static void write(FILE* file, const T* ptr, size_t count) {
  if (count && fwrite(ptr, sizeof(T), count, file) != count) throw std::runtime_error("short CUDA response");
}

struct Event {
  cudaEvent_t handle;
  Event() { check(cudaEventCreate(&handle)); }
  ~Event() { cudaEventDestroy(handle); }
};

template <class Launch> static double time_kernels(const Launch& launch, bool benchmark) {
  Event start, stop;
  if (benchmark) {
    launch();
    check(cudaDeviceSynchronize());
  }
  std::array<float, 3> ms{};
  const int repeats = benchmark ? ms.size() : 1;
  for (int i = 0; i < repeats; ++i) {
    check(cudaEventRecord(start.handle));
    launch();
    check(cudaEventRecord(stop.handle));
    check(cudaEventSynchronize(stop.handle));
    check(cudaEventElapsedTime(&ms[i], start.handle, stop.handle));
  }
  if (benchmark) std::sort(ms.begin(), ms.end());
  return ms[repeats / 2];
}


__global__ void k0(I d0, I d1, I d2, I d3, const float* t0, const float* t1, const float* t2, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i2 = (d1);
  for (I i2 = 0; i2 < end_i2; ++i2) {
    float v1 = __fmul_rn(t0[((i1) * (d1) + (i2))], t1[((i2) * (d2) + (i0))]);
    v0 = __fadd_rn(v0, v1);
  }
  float v2 = __fadd_rn(v0, t2[(i0)]);
  result[thread] = v2;
}

__global__ void k1(I d0, I d1, I d2, I d3, const float* t5, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = __fmul_rn(__uint_as_float(0x3f000000u), t5[((i1) * (d2) + (i0))]);
  float v1 = __fmul_rn(__uint_as_float(0x3d372713u), t5[((i1) * (d2) + (i0))]);
  float v2 = __fmul_rn(v1, t5[((i1) * (d2) + (i0))]);
  float v3 = __fmul_rn(v2, t5[((i1) * (d2) + (i0))]);
  float v4 = __fadd_rn(t5[((i1) * (d2) + (i0))], v3);
  float v5 = __fmul_rn(__uint_as_float(0x3f4c422au), v4);
  float v6 = __double2float_rn(tanh(static_cast<double>(v5)));
  float v7 = __fadd_rn(__uint_as_float(0x3f800000u), v6);
  float v8 = __fmul_rn(v0, v7);
  result[thread] = v8;
}

__global__ void k2(I d0, I d1, I d2, I d3, const float* t6, const float* t3, const float* t4, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d3);
  coordinate /= (d3);
  const I i1 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i2 = (d2);
  for (I i2 = 0; i2 < end_i2; ++i2) {
    float v1 = __fmul_rn(t6[((i1) * (d2) + (i2))], t3[((i2) * (d3) + (i0))]);
    v0 = __fadd_rn(v0, v1);
  }
  float v2 = __fadd_rn(v0, t4[(i0)]);
  result[thread] = v2;
}

static void run_case(FILE* input, FILE* output, bool benchmark) {
  std::array<I, 2> shape_t0;
  read(input, shape_t0.data(), shape_t0.size());
  std::vector<float> host_t0(elements(shape_t0));
  read(input, host_t0.data(), host_t0.size());
  std::array<I, 2> shape_t1;
  read(input, shape_t1.data(), shape_t1.size());
  std::vector<float> host_t1(elements(shape_t1));
  read(input, host_t1.data(), host_t1.size());
  std::array<I, 1> shape_t2;
  read(input, shape_t2.data(), shape_t2.size());
  std::vector<float> host_t2(elements(shape_t2));
  read(input, host_t2.data(), host_t2.size());
  std::array<I, 2> shape_t3;
  read(input, shape_t3.data(), shape_t3.size());
  std::vector<float> host_t3(elements(shape_t3));
  read(input, host_t3.data(), host_t3.size());
  std::array<I, 1> shape_t4;
  read(input, shape_t4.data(), shape_t4.size());
  std::vector<float> host_t4(elements(shape_t4));
  read(input, host_t4.data(), host_t4.size());
  double gpu_ms = 0;
  const I d0 = shape_t0[0];
  const I d1 = shape_t0[1];
  const I d2 = shape_t1[1];
  const I d3 = shape_t3[1];
  DeviceBuffer t0(host_t0.size());
  t0.upload(host_t0.data());
  DeviceBuffer t1(host_t1.size());
  t1.upload(host_t1.data());
  DeviceBuffer t2(host_t2.size());
  t2.upload(host_t2.data());
  DeviceBuffer t3(host_t3.size());
  t3.upload(host_t3.data());
  DeviceBuffer t4(host_t4.size());
  t4.upload(host_t4.data());
  const std::array<I, 2> shape_t5{(d0), (d2)};
  DeviceBuffer t5(elements(shape_t5));
  const std::array<I, 2> shape_t6{(d0), (d2)};
  DeviceBuffer t6(elements(shape_t6));
  const std::array<I, 2> shape_t7{(d0), (d3)};
  DeviceBuffer t7(elements(shape_t7));
  cudaFuncAttributes attributes;
  if (t5.size) check(cudaFuncGetAttributes(&attributes, k0));
  if (t6.size) check(cudaFuncGetAttributes(&attributes, k1));
  if (t7.size) check(cudaFuncGetAttributes(&attributes, k2));
  if (t5.size || t6.size || t7.size) gpu_ms = time_kernels([&] {
    if (t5.size) {
      k0<<<(t5.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t0.ptr, t1.ptr, t2.ptr, t5.ptr, t5.size);
      check(cudaGetLastError());
    }
    if (t6.size) {
      k1<<<(t6.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t5.ptr, t6.ptr, t6.size);
      check(cudaGetLastError());
    }
    if (t7.size) {
      k2<<<(t7.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t6.ptr, t3.ptr, t4.ptr, t7.ptr, t7.size);
      check(cudaGetLastError());
    }
  }, benchmark);
  std::vector<float> host_t7(t7.size);
  t7.download(host_t7.data());
  write(output, shape_t7.data(), shape_t7.size());
  write(output, host_t7.data(), host_t7.size());
  write(output, &gpu_ms, 1);
}


int main(int argc, char** argv) {
  try {
    using File = std::unique_ptr<FILE, decltype(&fclose)>;
    File input(fopen("inputs.bin", "rb"), fclose);
    File output(fopen("out/results.bin", "wb"), fclose);
    if (!input || !output) throw std::runtime_error("cannot open CUDA request or response");
    const char magic[] = "TIXCUDA1";
    char header[8];
    read(input.get(), header, sizeof(header));
    if (memcmp(header, magic, sizeof(header))) throw std::runtime_error("bad CUDA request header");
    U count;
    read(input.get(), &count, 1);
    write(output.get(), magic, sizeof(header));
    write(output.get(), &count, 1);
    const bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;
    for (U i = 0; i < count; ++i) run_case(input.get(), output.get(), benchmark);
    if (fgetc(input.get()) != EOF || ferror(input.get())) throw std::runtime_error("trailing CUDA request data");
    if (fclose(output.release())) throw std::runtime_error("cannot close CUDA response");
    return 0;
  } catch (const std::exception& error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
}
