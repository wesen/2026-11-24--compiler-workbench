
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


__global__ void k0(I d0, I d1, const float* t0, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = -INFINITY;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = minmax(v0, t0[((i0) * (d1) + (i1))], true);
  }
  result[thread] = v0;
}

__global__ void k1(I d0, I d1, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fsub_rn(t0[((i1) * (d1) + (i0))], t1[(i1)]);
  float v1 = __double2float_rn(exp(static_cast<double>(v0)));
  result[thread] = v1;
}

__global__ void k2(I d0, I d1, const float* t2, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = __fadd_rn(v0, t2[((i0) * (d1) + (i1))]);
  }
  result[thread] = v0;
}

__global__ void k3(I d0, I d1, const float* t2, const float* t3, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fdiv_rn(t2[((i1) * (d1) + (i0))], t3[(i1)]);
  result[thread] = v0;
}

static void run_case(FILE* input, FILE* output, bool benchmark) {
  std::array<I, 2> shape_t0;
  read(input, shape_t0.data(), shape_t0.size());
  std::vector<float> host_t0(elements(shape_t0));
  read(input, host_t0.data(), host_t0.size());
  double gpu_ms = 0;
  const I d0 = shape_t0[0];
  const I d1 = shape_t0[1];
  DeviceBuffer t0(host_t0.size());
  t0.upload(host_t0.data());
  const std::array<I, 1> shape_t1{(d0)};
  DeviceBuffer t1(elements(shape_t1));
  const std::array<I, 2> shape_t2{(d0), (d1)};
  DeviceBuffer t2(elements(shape_t2));
  const std::array<I, 1> shape_t3{(d0)};
  DeviceBuffer t3(elements(shape_t3));
  const std::array<I, 2> shape_t4{(d0), (d1)};
  DeviceBuffer t4(elements(shape_t4));
  cudaFuncAttributes attributes;
  if (t1.size) check(cudaFuncGetAttributes(&attributes, k0));
  if (t2.size) check(cudaFuncGetAttributes(&attributes, k1));
  if (t3.size) check(cudaFuncGetAttributes(&attributes, k2));
  if (t4.size) check(cudaFuncGetAttributes(&attributes, k3));
  if (t1.size || t2.size || t3.size || t4.size) gpu_ms = time_kernels([&] {
    if (t1.size) {
      k0<<<(t1.size - 1) / 256 + 1, 256>>>(d0, d1, t0.ptr, t1.ptr, t1.size);
      check(cudaGetLastError());
    }
    if (t2.size) {
      k1<<<(t2.size - 1) / 256 + 1, 256>>>(d0, d1, t0.ptr, t1.ptr, t2.ptr, t2.size);
      check(cudaGetLastError());
    }
    if (t3.size) {
      k2<<<(t3.size - 1) / 256 + 1, 256>>>(d0, d1, t2.ptr, t3.ptr, t3.size);
      check(cudaGetLastError());
    }
    if (t4.size) {
      k3<<<(t4.size - 1) / 256 + 1, 256>>>(d0, d1, t2.ptr, t3.ptr, t4.ptr, t4.size);
      check(cudaGetLastError());
    }
  }, benchmark);
  std::vector<float> host_t4(t4.size);
  t4.download(host_t4.data());
  write(output, shape_t4.data(), shape_t4.size());
  write(output, host_t4.data(), host_t4.size());
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
