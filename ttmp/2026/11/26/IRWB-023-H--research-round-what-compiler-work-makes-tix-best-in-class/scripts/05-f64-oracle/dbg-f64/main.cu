
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

__device__ static double minmax(double a, double b, bool maximum) {
  if (isnan(a) || isnan(b)) return __ulonglong_as_double(0x7ff8000000000000ULL);
  if (a == b) {
    unsigned long long x = __double_as_ulonglong(a), y = __double_as_ulonglong(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

struct DeviceBuffer {
  double* ptr = nullptr;
  U size;
  explicit DeviceBuffer(U n) : size(n) {
    if (size) check(cudaMalloc(&ptr, size * sizeof(double)));
  }
  ~DeviceBuffer() { if (ptr) cudaFree(ptr); }
  DeviceBuffer(const DeviceBuffer&) = delete;
  void upload(const double* src) const {
    if (size) check(cudaMemcpy(ptr, src, size * sizeof(double), cudaMemcpyHostToDevice));
  }
  void download(double* dst) const {
    if (size) check(cudaMemcpy(dst, ptr, size * sizeof(double), cudaMemcpyDeviceToHost));
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


__global__ void k0(I d0, I d1, I d2, const double* t0, const double* t1, double* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  double v0 = 0.0;
  const I end_i2 = (d1);
  for (I i2 = 0; i2 < end_i2; ++i2) {
    double v1 = __dmul_rn(t0[((i1) * (d1) + (i2))], t1[((i2) * (d2) + (i0))]);
    v0 = __dadd_rn(v0, v1);
  }
  result[thread] = v0;
}

static void run_case(FILE* input, FILE* output, bool benchmark) {
  std::array<I, 2> shape_t0;
  read(input, shape_t0.data(), shape_t0.size());
  std::vector<float> staged_t0(elements(shape_t0));
  read(input, staged_t0.data(), staged_t0.size());
  std::vector<double> host_t0(staged_t0.begin(), staged_t0.end());
  std::array<I, 2> shape_t1;
  read(input, shape_t1.data(), shape_t1.size());
  std::vector<float> staged_t1(elements(shape_t1));
  read(input, staged_t1.data(), staged_t1.size());
  std::vector<double> host_t1(staged_t1.begin(), staged_t1.end());
  double gpu_ms = 0;
  const I d0 = shape_t0[0];
  const I d1 = shape_t0[1];
  const I d2 = shape_t1[1];
  DeviceBuffer t0(host_t0.size());
  t0.upload(host_t0.data());
  DeviceBuffer t1(host_t1.size());
  t1.upload(host_t1.data());
  const std::array<I, 2> shape_t2{(d0), (d2)};
  DeviceBuffer t2(elements(shape_t2));
  cudaFuncAttributes attributes;
  if (t2.size) check(cudaFuncGetAttributes(&attributes, k0));
  if (t2.size) gpu_ms = time_kernels([&] {
    if (t2.size) {
      k0<<<(t2.size - 1) / 256 + 1, 256>>>(d0, d1, d2, t0.ptr, t1.ptr, t2.ptr, t2.size);
      check(cudaGetLastError());
    }
  }, benchmark);
  std::vector<double> host_t2(t2.size);
  t2.download(host_t2.data());
  write(output, shape_t2.data(), shape_t2.size());
  write(output, host_t2.data(), host_t2.size());
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
