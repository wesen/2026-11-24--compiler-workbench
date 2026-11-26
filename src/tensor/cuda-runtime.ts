// Shared C++ support for the standalone translation unit returned by cudaSource.
export const cudaRuntime = `#include <cuda_runtime.h>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

#define CUDA(call) do { cudaError_t err = (call); if (err != cudaSuccess) \\
  throw std::runtime_error(std::string(#call) + ": " + cudaGetErrorString(err)); } while (0)

__device__ float tix_min(float a, float b) {
  if (isnan(a) || isnan(b)) return NAN;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) | __float_as_uint(b));
  return fminf(a, b);
}
__device__ float tix_max(float a, float b) {
  if (isnan(a) || isnan(b)) return NAN;
  if (a == 0 && b == 0) return __uint_as_float(__float_as_uint(a) & __float_as_uint(b));
  return fmaxf(a, b);
}

using Shape = std::vector<long long>;
static_assert(sizeof(long long) == 8 && sizeof(float) == 4 && sizeof(double) == 8);
Shape read_shape(std::istream &in, size_t rank) {
  Shape shape(rank);
  in.read((char*)shape.data(), rank * 8);
  return shape;
}

struct Tensor {
  Shape shape;
  long long count = 1;
  float *device = nullptr;
  explicit Tensor(Shape dims) : shape(std::move(dims)) {
    for (auto d : shape) {
      if (d < 0 || (d && count > std::numeric_limits<long long>::max() / 4 / d))
        throw std::runtime_error("invalid tensor size");
      count *= d;
    }
    if (count) CUDA(cudaMalloc(&device, count * 4));
  }
  Tensor(const Tensor&) = delete;
  ~Tensor() { if (device) cudaFree(device); }
  void upload(std::istream &in) {
    if (!count) return;
    std::vector<float> host(count);
    in.read((char*)host.data(), count * 4);
    CUDA(cudaMemcpy(device, host.data(), count * 4, cudaMemcpyHostToDevice));
  }
  void download(std::ostream &out) const {
    out.write((const char*)shape.data(), shape.size() * 8);
    if (!count) return;
    std::vector<float> host(count);
    CUDA(cudaMemcpy(host.data(), device, count * 4, cudaMemcpyDeviceToHost));
    out.write((const char*)host.data(), count * 4);
  }
};
`;
