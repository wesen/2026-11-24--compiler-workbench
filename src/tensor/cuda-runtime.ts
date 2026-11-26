// Host and device helpers included in each standalone translation unit.
export const cudaRuntime = String.raw`#include <cuda_runtime.h>
#include <math_constants.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <vector>

using Index = long long;
using Shape = std::vector<uint64_t>;

static void check(cudaError_t status) {
  if (status != cudaSuccess) throw std::runtime_error(cudaGetErrorString(status));
}

template<class T> static T read(std::istream& in) {
  T value;
  in.read(reinterpret_cast<char*>(&value), sizeof(value));
  return value;
}
template<class T> static void write(std::ostream& out, T value) {
  out.write(reinterpret_cast<const char*>(&value), sizeof(value));
}
static Index elements(const Shape& shape) {
  if (std::find(shape.begin(), shape.end(), 0) != shape.end()) return 0;
  Index count = 1;
  for (auto dim : shape) count *= dim;
  return count;
}

struct Tensor {
  Shape shape;
  Index count = 0;
  float* data = nullptr;

  void allocate(Shape dims) {
    shape = std::move(dims);
    count = elements(shape);
    if (count) check(cudaMalloc(&data, count * sizeof(float)));
  }
  void load(std::istream& in, unsigned rank) {
    Shape dims(rank);
    for (auto& dim : dims) dim = read<uint64_t>(in);
    allocate(std::move(dims));
    if (!count) return;
    std::vector<float> host(count);
    in.read(reinterpret_cast<char*>(host.data()), count * sizeof(float));
    check(cudaMemcpy(data, host.data(), count * sizeof(float), cudaMemcpyHostToDevice));
  }
  void store(std::ostream& out, const std::vector<float>& times) const {
    write(out, static_cast<uint32_t>(shape.size()));
    for (auto dim : shape) write(out, dim);
    for (auto ms : times) write(out, ms);
    if (!count) return;
    std::vector<float> host(count);
    check(cudaMemcpy(host.data(), data, count * sizeof(float), cudaMemcpyDeviceToHost));
    out.write(reinterpret_cast<const char*>(host.data()), count * sizeof(float));
  }
  ~Tensor() { if (data) cudaFree(data); }
};

__device__ float tixMax(float a, float b) {
  if (isnan(a) || isnan(b)) return CUDART_NAN_F;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
  return a > b ? a : b;
}
__device__ float tixMin(float a, float b) {
  if (isnan(a) || isnan(b)) return CUDART_NAN_F;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) | __float_as_uint(b));
  return a < b ? a : b;
}

// Enqueue one complete function before recording any event (initial loads and warm-up).
template<class Launch> static std::vector<float> execute(Launch launch, uint32_t repeats, bool hasWork) {
  std::vector<float> times(repeats, 0);
  if (!hasWork) return times;
  launch();
  check(cudaGetLastError());
  check(cudaDeviceSynchronize());
  if (repeats) {
    cudaEvent_t start, stop;
    check(cudaEventCreate(&start));
    check(cudaEventCreate(&stop));
    for (float& ms : times) {
      check(cudaEventRecord(start));
      launch();
      check(cudaEventRecord(stop));
      check(cudaGetLastError());
      check(cudaEventSynchronize(stop));
      check(cudaEventElapsedTime(&ms, start, stop));
    }
    check(cudaEventDestroy(start));
    check(cudaEventDestroy(stop));
  }
  return times;
}
`;

export const cudaMain = String.raw`
int main() {
  try {
    std::ifstream in("cases.bin", std::ios::binary);
    std::ofstream out("out/results.bin", std::ios::binary);
    in.exceptions(std::ios::failbit | std::ios::badbit);
    out.exceptions(std::ios::failbit | std::ios::badbit);
    auto version = read<uint32_t>(in), count = read<uint32_t>(in), repeats = read<uint32_t>(in);
    if (version != 1) throw std::runtime_error("Unknown cases.bin version");
    write(out, version);
    write(out, count);
    write(out, repeats);
    for (uint32_t i = 0; i < count; ++i) {
      write(out, read<uint32_t>(in));
      runCase(in, out, repeats);
    }
    out.close();
    return 0;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "%s\n", e.what());
    return 1;
  }
}
`;
