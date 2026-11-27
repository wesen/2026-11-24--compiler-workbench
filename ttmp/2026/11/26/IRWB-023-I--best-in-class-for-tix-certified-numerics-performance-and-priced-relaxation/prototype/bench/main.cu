
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











__global__ void matmul_k0(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
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
  result[thread] = v0;
}

__global__ void softmax_k0(I d0, I d1, const float* t0, float* result, U count) {
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

__global__ void softmax_k1(I d0, I d1, const float* t0, const float* t1, float* result, U count) {
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

__global__ void softmax_k2(I d0, I d1, const float* t2, float* result, U count) {
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

__global__ void softmax_k3(I d0, I d1, const float* t2, const float* t3, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fdiv_rn(t2[((i1) * (d1) + (i0))], t3[(i1)]);
  result[thread] = v0;
}

__global__ void layernorm_k0(I d0, I d1, const float* t0, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = __fadd_rn(v0, t0[((i0) * (d1) + (i1))]);
  }
  float v1 = __fdiv_rn(v0, __ll2float_rn(d1));
  result[thread] = v1;
}

__global__ void layernorm_k1(I d0, I d1, const float* t0, const float* t4, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fsub_rn(t0[((i1) * (d1) + (i0))], t4[(i1)]);
  result[thread] = v0;
}

__global__ void layernorm_k2(I d0, I d1, const float* t5, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i1 = (d1);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    float v1 = __fmul_rn(t5[((i0) * (d1) + (i1))], t5[((i0) * (d1) + (i1))]);
    v0 = __fadd_rn(v0, v1);
  }
  float v2 = __fdiv_rn(v0, __ll2float_rn(d1));
  result[thread] = v2;
}

__global__ void layernorm_k3(I d0, I d1, const float* t5, const float* t6, const float* t3, const float* t1, const float* t2, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d1);
  coordinate /= (d1);
  const I i1 = coordinate % (d0);
  float v0 = __fadd_rn(t6[(i1)], t3[(0LL)]);
  float v1 = __fsqrt_rn(v0);
  float v2 = __fdiv_rn(t5[((i1) * (d1) + (i0))], v1);
  float v3 = __fmul_rn(v2, t1[(i0)]);
  float v4 = __fadd_rn(v3, t2[(i0)]);
  result[thread] = v4;
}

__global__ void attention_k0(I d0, I d1, I d2, I d3, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i2 = (d1);
  for (I i2 = 0; i2 < end_i2; ++i2) {
    float v1 = __fmul_rn(t0[((i1) * (d1) + (i2))], t1[((i0) * (d1) + (i2))]);
    v0 = __fadd_rn(v0, v1);
  }
  float v2 = __fsqrt_rn(__ll2float_rn(d1));
  float v3 = __fdiv_rn(v0, v2);
  result[thread] = v3;
}

__global__ void attention_k1(I d0, I d1, I d2, I d3, const float* t3, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = -INFINITY;
  const I end_i1 = (d2);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = minmax(v0, t3[((i0) * (d2) + (i1))], true);
  }
  result[thread] = v0;
}

__global__ void attention_k2(I d0, I d1, I d2, I d3, const float* t3, const float* t4, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = __fsub_rn(t3[((i1) * (d2) + (i0))], t4[(i1)]);
  float v1 = __double2float_rn(exp(static_cast<double>(v0)));
  result[thread] = v1;
}

__global__ void attention_k3(I d0, I d1, I d2, I d3, const float* t5, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i1 = (d2);
  for (I i1 = 0; i1 < end_i1; ++i1) {
    v0 = __fadd_rn(v0, t5[((i0) * (d2) + (i1))]);
  }
  result[thread] = v0;
}

__global__ void attention_k4(I d0, I d1, I d2, I d3, const float* t5, const float* t6, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = __fdiv_rn(t5[((i1) * (d2) + (i0))], t6[(i1)]);
  result[thread] = v0;
}

__global__ void attention_k5(I d0, I d1, I d2, I d3, const float* t7, const float* t2, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d3);
  coordinate /= (d3);
  const I i1 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i2 = (d2);
  for (I i2 = 0; i2 < end_i2; ++i2) {
    float v1 = __fmul_rn(t7[((i1) * (d2) + (i2))], t2[((i2) * (d3) + (i0))]);
    v0 = __fadd_rn(v0, v1);
  }
  result[thread] = v0;
}

static void run_case_matmul(FILE* input, FILE* output, bool benchmark) {
  std::array<I, 2> shape_t0;
  read(input, shape_t0.data(), shape_t0.size());
  std::vector<float> host_t0(elements(shape_t0));
  read(input, host_t0.data(), host_t0.size());
  std::array<I, 2> shape_t1;
  read(input, shape_t1.data(), shape_t1.size());
  std::vector<float> host_t1(elements(shape_t1));
  read(input, host_t1.data(), host_t1.size());
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
  if (t2.size) check(cudaFuncGetAttributes(&attributes, matmul_k0));
  if (t2.size) gpu_ms = time_kernels([&] {
    if (t2.size) {
      matmul_k0<<<(t2.size - 1) / 256 + 1, 256>>>(d0, d1, d2, t0.ptr, t1.ptr, t2.ptr, t2.size);
      check(cudaGetLastError());
    }
  }, benchmark);
  std::vector<float> host_t2(t2.size);
  t2.download(host_t2.data());
  write(output, shape_t2.data(), shape_t2.size());
  write(output, host_t2.data(), host_t2.size());
  write(output, &gpu_ms, 1);
}

static void run_case_softmax(FILE* input, FILE* output, bool benchmark) {
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
  if (t1.size) check(cudaFuncGetAttributes(&attributes, softmax_k0));
  if (t2.size) check(cudaFuncGetAttributes(&attributes, softmax_k1));
  if (t3.size) check(cudaFuncGetAttributes(&attributes, softmax_k2));
  if (t4.size) check(cudaFuncGetAttributes(&attributes, softmax_k3));
  if (t1.size || t2.size || t3.size || t4.size) gpu_ms = time_kernels([&] {
    if (t1.size) {
      softmax_k0<<<(t1.size - 1) / 256 + 1, 256>>>(d0, d1, t0.ptr, t1.ptr, t1.size);
      check(cudaGetLastError());
    }
    if (t2.size) {
      softmax_k1<<<(t2.size - 1) / 256 + 1, 256>>>(d0, d1, t0.ptr, t1.ptr, t2.ptr, t2.size);
      check(cudaGetLastError());
    }
    if (t3.size) {
      softmax_k2<<<(t3.size - 1) / 256 + 1, 256>>>(d0, d1, t2.ptr, t3.ptr, t3.size);
      check(cudaGetLastError());
    }
    if (t4.size) {
      softmax_k3<<<(t4.size - 1) / 256 + 1, 256>>>(d0, d1, t2.ptr, t3.ptr, t4.ptr, t4.size);
      check(cudaGetLastError());
    }
  }, benchmark);
  std::vector<float> host_t4(t4.size);
  t4.download(host_t4.data());
  write(output, shape_t4.data(), shape_t4.size());
  write(output, host_t4.data(), host_t4.size());
  write(output, &gpu_ms, 1);
}

static void run_case_layernorm(FILE* input, FILE* output, bool benchmark) {
  std::array<I, 2> shape_t0;
  read(input, shape_t0.data(), shape_t0.size());
  std::vector<float> host_t0(elements(shape_t0));
  read(input, host_t0.data(), host_t0.size());
  std::array<I, 1> shape_t1;
  read(input, shape_t1.data(), shape_t1.size());
  std::vector<float> host_t1(elements(shape_t1));
  read(input, host_t1.data(), host_t1.size());
  std::array<I, 1> shape_t2;
  read(input, shape_t2.data(), shape_t2.size());
  std::vector<float> host_t2(elements(shape_t2));
  read(input, host_t2.data(), host_t2.size());
  std::array<I, 1> shape_t3;
  read(input, shape_t3.data(), shape_t3.size());
  std::vector<float> host_t3(elements(shape_t3));
  read(input, host_t3.data(), host_t3.size());
  double gpu_ms = 0;
  const I d0 = shape_t0[0];
  const I d1 = shape_t0[1];
  DeviceBuffer t0(host_t0.size());
  t0.upload(host_t0.data());
  DeviceBuffer t1(host_t1.size());
  t1.upload(host_t1.data());
  DeviceBuffer t2(host_t2.size());
  t2.upload(host_t2.data());
  DeviceBuffer t3(host_t3.size());
  t3.upload(host_t3.data());
  const std::array<I, 1> shape_t4{(d0)};
  DeviceBuffer t4(elements(shape_t4));
  const std::array<I, 2> shape_t5{(d0), (d1)};
  DeviceBuffer t5(elements(shape_t5));
  const std::array<I, 1> shape_t6{(d0)};
  DeviceBuffer t6(elements(shape_t6));
  const std::array<I, 2> shape_t7{(d0), (d1)};
  DeviceBuffer t7(elements(shape_t7));
  cudaFuncAttributes attributes;
  if (t4.size) check(cudaFuncGetAttributes(&attributes, layernorm_k0));
  if (t5.size) check(cudaFuncGetAttributes(&attributes, layernorm_k1));
  if (t6.size) check(cudaFuncGetAttributes(&attributes, layernorm_k2));
  if (t7.size) check(cudaFuncGetAttributes(&attributes, layernorm_k3));
  if (t4.size || t5.size || t6.size || t7.size) gpu_ms = time_kernels([&] {
    if (t4.size) {
      layernorm_k0<<<(t4.size - 1) / 256 + 1, 256>>>(d0, d1, t0.ptr, t4.ptr, t4.size);
      check(cudaGetLastError());
    }
    if (t5.size) {
      layernorm_k1<<<(t5.size - 1) / 256 + 1, 256>>>(d0, d1, t0.ptr, t4.ptr, t5.ptr, t5.size);
      check(cudaGetLastError());
    }
    if (t6.size) {
      layernorm_k2<<<(t6.size - 1) / 256 + 1, 256>>>(d0, d1, t5.ptr, t6.ptr, t6.size);
      check(cudaGetLastError());
    }
    if (t7.size) {
      layernorm_k3<<<(t7.size - 1) / 256 + 1, 256>>>(d0, d1, t5.ptr, t6.ptr, t3.ptr, t1.ptr, t2.ptr, t7.ptr, t7.size);
      check(cudaGetLastError());
    }
  }, benchmark);
  std::vector<float> host_t7(t7.size);
  t7.download(host_t7.data());
  write(output, shape_t7.data(), shape_t7.size());
  write(output, host_t7.data(), host_t7.size());
  write(output, &gpu_ms, 1);
}

static void run_case_attention(FILE* input, FILE* output, bool benchmark) {
  std::array<I, 2> shape_t0;
  read(input, shape_t0.data(), shape_t0.size());
  std::vector<float> host_t0(elements(shape_t0));
  read(input, host_t0.data(), host_t0.size());
  std::array<I, 2> shape_t1;
  read(input, shape_t1.data(), shape_t1.size());
  std::vector<float> host_t1(elements(shape_t1));
  read(input, host_t1.data(), host_t1.size());
  std::array<I, 2> shape_t2;
  read(input, shape_t2.data(), shape_t2.size());
  std::vector<float> host_t2(elements(shape_t2));
  read(input, host_t2.data(), host_t2.size());
  double gpu_ms = 0;
  const I d0 = shape_t0[0];
  const I d1 = shape_t0[1];
  const I d2 = shape_t1[0];
  const I d3 = shape_t2[1];
  DeviceBuffer t0(host_t0.size());
  t0.upload(host_t0.data());
  DeviceBuffer t1(host_t1.size());
  t1.upload(host_t1.data());
  DeviceBuffer t2(host_t2.size());
  t2.upload(host_t2.data());
  const std::array<I, 2> shape_t3{(d0), (d2)};
  DeviceBuffer t3(elements(shape_t3));
  const std::array<I, 1> shape_t4{(d0)};
  DeviceBuffer t4(elements(shape_t4));
  const std::array<I, 2> shape_t5{(d0), (d2)};
  DeviceBuffer t5(elements(shape_t5));
  const std::array<I, 1> shape_t6{(d0)};
  DeviceBuffer t6(elements(shape_t6));
  const std::array<I, 2> shape_t7{(d0), (d2)};
  DeviceBuffer t7(elements(shape_t7));
  const std::array<I, 2> shape_t8{(d0), (d3)};
  DeviceBuffer t8(elements(shape_t8));
  cudaFuncAttributes attributes;
  if (t3.size) check(cudaFuncGetAttributes(&attributes, attention_k0));
  if (t4.size) check(cudaFuncGetAttributes(&attributes, attention_k1));
  if (t5.size) check(cudaFuncGetAttributes(&attributes, attention_k2));
  if (t6.size) check(cudaFuncGetAttributes(&attributes, attention_k3));
  if (t7.size) check(cudaFuncGetAttributes(&attributes, attention_k4));
  if (t8.size) check(cudaFuncGetAttributes(&attributes, attention_k5));
  if (t3.size || t4.size || t5.size || t6.size || t7.size || t8.size) gpu_ms = time_kernels([&] {
    if (t3.size) {
      attention_k0<<<(t3.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t0.ptr, t1.ptr, t3.ptr, t3.size);
      check(cudaGetLastError());
    }
    if (t4.size) {
      attention_k1<<<(t4.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t3.ptr, t4.ptr, t4.size);
      check(cudaGetLastError());
    }
    if (t5.size) {
      attention_k2<<<(t5.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t3.ptr, t4.ptr, t5.ptr, t5.size);
      check(cudaGetLastError());
    }
    if (t6.size) {
      attention_k3<<<(t6.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t5.ptr, t6.ptr, t6.size);
      check(cudaGetLastError());
    }
    if (t7.size) {
      attention_k4<<<(t7.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t5.ptr, t6.ptr, t7.ptr, t7.size);
      check(cudaGetLastError());
    }
    if (t8.size) {
      attention_k5<<<(t8.size - 1) / 256 + 1, 256>>>(d0, d1, d2, d3, t7.ptr, t2.ptr, t8.ptr, t8.size);
      check(cudaGetLastError());
    }
  }, benchmark);
  std::vector<float> host_t8(t8.size);
  t8.download(host_t8.data());
  write(output, shape_t8.data(), shape_t8.size());
  write(output, host_t8.data(), host_t8.size());
  write(output, &gpu_ms, 1);
}

__global__ void matmul_k0_fma(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (thread >= count) return;
  U coordinate = thread;
  const I i0 = coordinate % (d2);
  coordinate /= (d2);
  const I i1 = coordinate % (d0);
  float v0 = 0.0f;
  const I end_i2 = (d1);
  for (I i2 = 0; i2 < end_i2; ++i2) {
    float v1 = (t0[((i1) * (d1) + (i2))]) * (t1[((i2) * (d2) + (i0))]);
    v0 = (v0) + (v1);
  }
  result[thread] = v0;
}


#include <functional>
#include <string>

// ---------------- prototype kernels (ticket IRWB-023-I) ----------------

// mm_smem: one thread per output (same meaning mapping), tiles staged in shared
// memory. The per-thread k loop is still sequential, multiply and add still round
// separately: exact tier.
#define SMB 16
__global__ void mm_smem(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[SMB][SMB + 1];
  __shared__ float Bs[SMB + 1][SMB];
  const int tx = threadIdx.x % SMB, ty = threadIdx.x / SMB;
  const int row = blockIdx.y * SMB + ty;
  const int col = blockIdx.x * SMB + tx;
  if ((U)row >= (U)d0 || (U)col >= (U)d2) return;
  float acc = 0.0f;
  for (int kt = 0; kt < d1; kt += SMB) {
    for (int idx = threadIdx.x; idx < SMB * SMB; idx += blockDim.x) {
      int r = idx / SMB, c = idx % SMB;
      As[r][c] = t0[(I)(blockIdx.y * SMB + r) * d1 + (kt + c)];
      Bs[r][c] = t1[(I)(kt + r) * d2 + (blockIdx.x * SMB + c)];
    }
    __syncthreads();
    for (int kk = 0; kk < SMB; ++kk) acc = __fadd_rn(acc, __fmul_rn(As[ty][kk], Bs[kk][tx]));
    __syncthreads();
  }
  result[(I)row * d2 + col] = acc;
}

// mm_rt32: register-tiled exact matmul. BM=BN=32, BK=32, 8x8 threads, 4x4 per thread.
// Per output element the k order is unchanged and both operations round: exact tier.
__global__ void mm_rt32(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[32][33];
  __shared__ float Bs[33][32];
  const int tx = threadIdx.x % 8, ty = threadIdx.x / 8;
  const int row0 = blockIdx.y * 32 + ty * 4;
  const int col0 = blockIdx.x * 32 + tx * 4;
  float acc[4][4];
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) acc[r][c] = 0.0f;
  const int tid = threadIdx.x;
  for (int kt = 0; kt < d1; kt += 32) {
    for (int idx = tid; idx < 32 * 32; idx += 64) {
      int r = idx / 32, c = idx % 32;
      As[r][c] = t0[(I)(blockIdx.y * 32 + r) * d1 + (kt + c)];
      Bs[r][c] = t1[(I)(kt + r) * d2 + (blockIdx.x * 32 + c)];
    }
    __syncthreads();
    for (int kk = 0; kk < 32; ++kk) {
      float af[4], bf[4];
      for (int r = 0; r < 4; r++) af[r] = As[ty * 4 + r][kk];
      for (int c = 0; c < 4; c++) bf[c] = Bs[kk][tx * 4 + c];
      for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++)
          acc[r][c] = __fadd_rn(acc[r][c], __fmul_rn(af[r], bf[c]));
    }
    __syncthreads();
  }
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) {
      int gr = row0 + r, gc = col0 + c;
      if (gr < d0 && gc < d2) result[(I)gr * d2 + gc] = acc[r][c];
    }
}

// mm_rt32_fma: identical schedule, but the multiply-add contracts (nvcc default
// --fmad=true). Budget tier: measures the price of the two-rounding meaning.
__global__ void mm_rt32_fma(I d0, I d1, I d2, const float* t0, const float* t1, float* result, U count) {
  __shared__ float As[32][33];
  __shared__ float Bs[33][32];
  const int tx = threadIdx.x % 8, ty = threadIdx.x / 8;
  const int row0 = blockIdx.y * 32 + ty * 4;
  const int col0 = blockIdx.x * 32 + tx * 4;
  float acc[4][4];
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) acc[r][c] = 0.0f;
  const int tid = threadIdx.x;
  for (int kt = 0; kt < d1; kt += 32) {
    for (int idx = tid; idx < 32 * 32; idx += 64) {
      int r = idx / 32, c = idx % 32;
      As[r][c] = t0[(I)(blockIdx.y * 32 + r) * d1 + (kt + c)];
      Bs[r][c] = t1[(I)(kt + r) * d2 + (blockIdx.x * 32 + c)];
    }
    __syncthreads();
    for (int kk = 0; kk < 32; ++kk) {
      float af[4], bf[4];
      for (int r = 0; r < 4; r++) af[r] = As[ty * 4 + r][kk];
      for (int c = 0; c < 4; c++) bf[c] = Bs[kk][tx * 4 + c];
      for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++) acc[r][c] += af[r] * bf[c];
    }
    __syncthreads();
  }
  for (int r = 0; r < 4; r++)
    for (int c = 0; c < 4; c++) {
      int gr = row0 + r, gc = col0 + c;
      if (gr < d0 && gc < d2) result[(I)gr * d2 + gc] = acc[r][c];
    }
}

// sm_fused_exact: one warp per row; m by lane tree (order-free for max, exact),
// e per lane with the double-exp path, s by lane 0 as a sequential fold over the
// shared row (same order as the meaning), y per lane. Exact tier.
#define SM_WARPS 8
__global__ void sm_fused_exact(I d0, I d1, const float* t0, float* result, U count) {
  __shared__ float esh[SM_WARPS][1024];
  __shared__ float ssh[SM_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + warp;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  float lm = -INFINITY;
#pragma unroll
  for (int t = 0; t < 32; t++) lm = minmax(lm, xreg[t], true);
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
#pragma unroll
  for (int t = 0; t < 32; t++)
    esh[warp][lane + 32 * t] = __double2float_rn(exp((double)__fsub_rn(xreg[t], lm)));
  __syncwarp();
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) s = __fadd_rn(s, esh[warp][j]);
    ssh[warp] = s;
  }
  __syncwarp();
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++)
    yrow[lane + 32 * t] = __fdiv_rn(esh[warp][lane + 32 * t], ssh[warp]);
}

// sm_fused_tree: same structure, but the row sum is a per-lane partial followed by a
// butterfly tree: the sum's evaluation tree changes (budget tier).
__global__ void sm_fused_tree(I d0, I d1, const float* t0, float* result, U count) {
  const int lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + threadIdx.x / 32;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  float lm = -INFINITY;
#pragma unroll
  for (int t = 0; t < 32; t++) lm = minmax(lm, xreg[t], true);
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
  float part = 0.0f;
  float ereg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) {
    ereg[t] = __double2float_rn(exp((double)__fsub_rn(xreg[t], lm)));
    part = __fadd_rn(part, ereg[t]);
  }
  for (int off = 16; off > 0; off >>= 1)
    part = __fadd_rn(part, __shfl_down_sync(0xffffffffu, part, off));
  const float s = __shfl_sync(0xffffffffu, part, 0);
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++) yrow[lane + 32 * t] = __fdiv_rn(ereg[t], s);
}

// sm_fused_expf: exact structure, but expf instead of the double-exp path (budget tier).
__global__ void sm_fused_expf(I d0, I d1, const float* t0, float* result, U count) {
  __shared__ float esh[SM_WARPS][1024];
  __shared__ float ssh[SM_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + warp;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  float lm = -INFINITY;
#pragma unroll
  for (int t = 0; t < 32; t++) lm = minmax(lm, xreg[t], true);
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
#pragma unroll
  for (int t = 0; t < 32; t++) esh[warp][lane + 32 * t] = expf(__fsub_rn(xreg[t], lm));
  __syncwarp();
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) s = __fadd_rn(s, esh[warp][j]);
    ssh[warp] = s;
  }
  __syncwarp();
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++) yrow[lane + 32 * t] = __fdiv_rn(esh[warp][lane + 32 * t], ssh[warp]);
}

// ln_fused: one warp per row; mean and variance by lane-0 sequential folds over the
// row (exact), centered kept in registers + shared for the variance walk. Exact tier.
#define LN_WARPS 4
__global__ void ln_fused(I d0, I d1, const float* t0, const float* t1, const float* t2, const float* t3, float* result, U count) {
  __shared__ float csh[LN_WARPS][1024];
  __shared__ float rsh[LN_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * LN_WARPS + warp;
  if (row >= d0) return;
  const float* xrow = t0 + (size_t)row * d1;
  float xreg[32];
#pragma unroll
  for (int t = 0; t < 32; t++) xreg[t] = xrow[lane + 32 * t];
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) s = __fadd_rn(s, xrow[j]);
    rsh[warp] = __fdiv_rn(s, __ll2float_rn(d1));
  }
  __syncwarp();
  const float mean = rsh[warp];
  float c[32];
#pragma unroll
  for (int t = 0; t < 32; t++) {
    c[t] = __fsub_rn(xreg[t], mean);
    csh[warp][lane + 32 * t] = c[t];
  }
  __syncwarp();
  if (lane == 0) {
    float s = 0.0f;
    for (int j = 0; j < d1; j++) {
      float v = csh[warp][j];
      s = __fadd_rn(s, __fmul_rn(v, v));
    }
    const float variance = __fdiv_rn(s, __ll2float_rn(d1));
    rsh[warp] = __fsqrt_rn(__fadd_rn(variance, __ldg(&t3[0])));
  }
  __syncwarp();
  const float denom = rsh[warp];
  float* yrow = result + (size_t)row * d1;
#pragma unroll
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    yrow[j] = __fadd_rn(__fmul_rn(__fdiv_rn(c[t], denom), __ldg(&t1[j])), __ldg(&t2[j]));
  }
}

// attn_sm: fused score + softmax per row (one warp), weight written to global.
// Score dots keep the d order; m is a warp tree (exact); z a lane-0 sequential
// fold (exact). Exact tier.
__global__ void attn_sm(I dq, I dk, I dd, const float* q, const float* k, float* w, U count) {
  __shared__ float ssh[SM_WARPS][1024];
  __shared__ float qsh[SM_WARPS][64];
  __shared__ float rsh[SM_WARPS];
  const int warp = threadIdx.x / 32, lane = threadIdx.x % 32;
  const int row = blockIdx.x * SM_WARPS + warp;
  if (row >= dq) return;
  if (lane < 32) {
    for (int d = lane; d < dd; d += 32) qsh[warp][d] = q[(size_t)row * dd + d];
  }
  __syncwarp();
  const float scale = __fsqrt_rn(__ll2float_rn(dd));
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) {
      float acc = 0.0f;
      for (int d = 0; d < dd; d++) acc = __fadd_rn(acc, __fmul_rn(qsh[warp][d], k[(size_t)j * dd + d]));
      ssh[warp][j] = __fdiv_rn(acc, scale);
    }
  }
  __syncwarp();
  float lm = -INFINITY;
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) lm = minmax(lm, ssh[warp][j], true);
  }
  for (int off = 16; off > 0; off >>= 1)
    lm = minmax(lm, __shfl_down_sync(0xffffffffu, lm, off), true);
  lm = __shfl_sync(0xffffffffu, lm, 0);
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) ssh[warp][j] = __double2float_rn(exp((double)__fsub_rn(ssh[warp][j], lm)));
  }
  __syncwarp();
  if (lane == 0) {
    float z = 0.0f;
    for (int j = 0; j < dk; j++) z = __fadd_rn(z, ssh[warp][j]);
    rsh[warp] = z;
  }
  __syncwarp();
  const float z = rsh[warp];
  float* wrow = w + (size_t)row * dk;
  for (int t = 0; t < 32; t++) {
    const int j = lane + 32 * t;
    if (j < dk) wrow[j] = __fdiv_rn(ssh[warp][j], z);
  }
}



// ---------------- bench driver ----------------
struct Case {
  int config;
  int nTensors;
  std::vector<std::vector<I>> shapes;
  std::vector<std::vector<float>> data;
};

static Case readCase(FILE* f) {
  Case c;
  if (fread(&c.config, 4, 1, f) != 1) throw std::runtime_error("bench: short config");
  if (fread(&c.nTensors, 4, 1, f) != 1) throw std::runtime_error("bench: short tensor count");
  for (int t = 0; t < c.nTensors; ++t) {
    int rank;
    if (fread(&rank, 4, 1, f) != 1) throw std::runtime_error("bench: short rank");
    std::vector<unsigned> dims32(rank);
    if (rank && fread(dims32.data(), 4, rank, f) != (size_t)rank) throw std::runtime_error("bench: short dims");
    std::vector<I> dims(rank);
    for (int i = 0; i < rank; ++i) dims[i] = dims32[i];
    U n = 1;
    for (I d : dims) n *= (U)d;
    std::vector<float> data(n);
    if (n && fread(data.data(), 4, n, f) != n) throw std::runtime_error("bench: short data");
    c.shapes.push_back(dims);
    c.data.push_back(data);
  }
  return c;
}

static void writeResult(const char* name, const std::vector<I>& shape, const std::vector<float>& data) {
  std::string path = std::string("out/") + name + ".bin";
  FILE* f = fopen(path.c_str(), "wb");
  if (!f) throw std::runtime_error("bench: cannot open " + path);
  U rank = shape.size();
  fwrite(&rank, 8, 1, f);
  if (rank) fwrite(shape.data(), 8, rank, f);
  if (!data.empty()) fwrite(data.data(), 4, data.size(), f);
  fclose(f);
}

static double median(std::vector<float>& v) { std::sort(v.begin(), v.end()); return v[v.size() / 2]; }

static void timeLoop(const char* name, int reps, const std::function<void()>& body) {
  for (int i = 0; i < 3; ++i) body();
  check(cudaDeviceSynchronize());
  Event start, stop;
  std::vector<float> ms;
  for (int i = 0; i < reps; ++i) {
    check(cudaEventRecord(start.handle));
    body();
    check(cudaEventRecord(stop.handle));
    check(cudaEventSynchronize(stop.handle));
    float one;
    check(cudaEventElapsedTime(&one, start.handle, stop.handle));
    ms.push_back(one);
  }
  printf("%s,%.6f,%.6f,%.6f,%d\n", name, median(ms), *std::min_element(ms.begin(), ms.end()), *std::max_element(ms.begin(), ms.end()), reps);
}

static float* upload(const std::vector<float>& host) {
  float* p = nullptr;
  check(cudaMalloc(&p, sizeof(float) * (host.size() ? host.size() : 1)));
  if (!host.empty()) check(cudaMemcpy(p, host.data(), host.size() * sizeof(float), cudaMemcpyHostToDevice));
  return p;
}

// One TIXCUDA1 case built in memory, so the pasted stage-2 host code runs unchanged.
static void runEmitted(void (*run)(FILE*, FILE*, bool), const Case& c, bool benchmark, const char* outName, double* gpuMs, const std::vector<I>& resultShape) {
  std::vector<char> bytes;
  auto put = [&bytes](const void* p, size_t n) { const char* b = (const char*)p; bytes.insert(bytes.end(), b, b + n); };
  // run_case reads each parameter's shape then its words, interleaved; the magic
  // and case count belong to the emitted main(), which this bench does not use.
  for (size_t t = 0; t < c.shapes.size(); ++t) {
    put(c.shapes[t].data(), 8 * c.shapes[t].size());
    put(c.data[t].data(), 4 * c.data[t].size());
  }
  FILE* in = tmpfile();
  FILE* out = tmpfile();
  if (!in || !out) throw std::runtime_error("bench: tmpfile failed");
  if (fwrite(bytes.data(), 1, bytes.size(), in) != bytes.size()) throw std::runtime_error("bench: short request write");
  fflush(in);
  rewind(in);
  fprintf(stderr, "[bench] runEmitted bytes=%zu\n", bytes.size());
  (*run)(in, out, benchmark);
  fprintf(stderr, "[bench] runEmitted done\n");
  rewind(out);
  std::vector<I> shape(resultShape.size());
  if (!shape.empty() && fread(shape.data(), 8, shape.size(), out) != shape.size())
    throw std::runtime_error("bench: short response shape");
  U n = 1;
  for (I d : shape) n *= (U)d;
  std::vector<float> data(n);
  if (n && fread(data.data(), 4, n, out) != n) throw std::runtime_error("bench: short response data");
  double ms = 0;
  if (fread(&ms, 8, 1, out) != 1) throw std::runtime_error("bench: short response ms");
  fclose(in);
  fclose(out);
  if (gpuMs) *gpuMs = ms;
  else writeResult(outName, shape, data);
}

int main(int argc, char** argv) {
  try {
    cudaDeviceProp prop;
    check(cudaGetDeviceProperties(&prop, 0));
    int clockKhz = 0;
    cudaDeviceGetAttribute(&clockKhz, cudaDevAttrClockRate, 0);
    printf("# device %s sm_%d%d SMs=%d clock=%d kHz sharedOptin=%zu regsPerBlock=%d\n",
           prop.name, prop.major, prop.minor, prop.multiProcessorCount, clockKhz,
           (size_t)prop.sharedMemPerBlockOptin, prop.regsPerBlock);
    const bool timing = argc == 2 && std::string(argv[1]) == "--timing";
    const bool big = argc == 2 && std::string(argv[1]) == "--big";
    FILE* in = fopen("bench.bin", "rb");
    if (!in) throw std::runtime_error("bench: no bench.bin");
    int mode;
    if (fread(&mode, 4, 1, in) != 1) throw std::runtime_error("bench: short mode");
    int caseCount;
    if (fread(&caseCount, 4, 1, in) != 1) throw std::runtime_error("bench: short case count");
    for (int ci = 0; ci < caseCount; ++ci) {
      Case c = readCase(in);
      fprintf(stderr, "[bench] case %d config %d tensors %zu\n", ci, c.config, c.shapes.size());
      const char* name = 0;
      switch (c.config) {
        case 0: name = "mm_base_rn"; break;
        case 1: name = "mm_base_fma"; break;
        case 2: name = "mm_smem_rn"; break;
        case 3: name = "mm_rt32_rn"; break;
        case 4: name = "mm_rt32_fma"; break;
        case 5: name = "sm_base"; break;
        case 6: name = "sm_fused_exact"; break;
        case 7: name = "sm_fused_tree"; break;
        case 8: name = "sm_fused_expf"; break;
        case 9: name = "ln_base"; break;
        case 10: name = "ln_fused"; break;
        case 11: name = "attn_base"; break;
        case 12: name = "attn_fused"; break;
      }
      if (!name) throw std::runtime_error("bench: unknown config");
      if (big && c.config != 3 && c.config != 4) continue;  // big run: only the tiled kernels
      if (c.config <= 4) {
        const I M = c.shapes[0][0], K = c.shapes[0][1], N = c.shapes[1][1];
        float* a = upload(c.data[0]);
        float* b = upload(c.data[1]);
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)M * N));
        auto body = [&]() {
          if (c.config == 0 || c.config == 1)
            matmul_k0<<<(U)((I)M * N - 1) / 256 + 1, 256>>>(M, K, N, a, b, y, (U)((I)M * N));
          else if (c.config == 2) {
            dim3 grid((N + SMB - 1) / SMB, (M + SMB - 1) / SMB);
            mm_smem<<<grid, 256>>>(M, K, N, a, b, y, (U)((I)M * N));
          } else {
            dim3 grid((N + 31) / 32, (M + 31) / 32);
            if (c.config == 3) mm_rt32<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
            else mm_rt32_fma<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
          }
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        if (c.config == 0 || c.config == 1) check(cudaFuncGetAttributes(&attr, matmul_k0));
        else if (c.config == 2) check(cudaFuncGetAttributes(&attr, mm_smem));
        else if (c.config == 3) check(cudaFuncGetAttributes(&attr, mm_rt32));
        else check(cudaFuncGetAttributes(&attr, mm_rt32_fma));
        if (timing) {
          char label[64];
          snprintf(label, sizeof label, "%s@%dx%dx%d", name, (int)M, (int)K, (int)N);
          timeLoop(label, big ? 10 : 20, body);
        } else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)M * N);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {M, N}, host);
        }
        check(cudaFree(a)); check(cudaFree(b)); check(cudaFree(y));
      } else if (c.config == 5 || c.config == 9 || c.config == 11) {
        const char* prog = c.config == 5 ? "softmax" : c.config == 9 ? "layernorm" : "attention";
        void (*run)(FILE*, FILE*, bool) = prog == "softmax" ? run_case_softmax : prog == "layernorm" ? run_case_layernorm : run_case_attention;
        std::vector<I> resultShape = prog == "softmax" ? std::vector<I>{c.shapes[0][0], c.shapes[0][1]}
          : prog == "layernorm" ? std::vector<I>{c.shapes[0][0], c.shapes[0][1]}
          : std::vector<I>{c.shapes[0][0], c.shapes[2][1]};
        double ms = 0;
        if (timing) {
          char label[64];
          snprintf(label, sizeof label, "%s_base", name);
          std::vector<float> samples;
          for (int rep = 0; rep < 5; ++rep) {
            runEmitted(run, c, true, name, &ms, resultShape);
            samples.push_back((float)ms);
          }
          std::sort(samples.begin(), samples.end());
          printf("%s,%.6f,%.6f,%.6f,5x3\n", label, (double)samples[2], (double)samples[0], (double)samples[4]);
        } else {
          runEmitted(run, c, false, name, 0, resultShape);
        }
      } else if (c.config == 6 || c.config == 7 || c.config == 8) {
        const I N = c.shapes[0][0], C = c.shapes[0][1];
        float* x = upload(c.data[0]);
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)N * C));
        auto body = [&]() {
          if (c.config == 6) sm_fused_exact<<<(N + SM_WARPS - 1) / SM_WARPS, 256>>>(N, C, x, y, (U)((I)N * C));
          else if (c.config == 7) sm_fused_tree<<<(N + SM_WARPS - 1) / SM_WARPS, 256>>>(N, C, x, y, (U)((I)N * C));
          else sm_fused_expf<<<(N + SM_WARPS - 1) / SM_WARPS, 256>>>(N, C, x, y, (U)((I)N * C));
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        if (c.config == 6) check(cudaFuncGetAttributes(&attr, sm_fused_exact));
        else if (c.config == 7) check(cudaFuncGetAttributes(&attr, sm_fused_tree));
        else check(cudaFuncGetAttributes(&attr, sm_fused_expf));
        if (timing) timeLoop(name, 20, body);
        else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)N * C);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {N, C}, host);
        }
        check(cudaFree(x)); check(cudaFree(y));
      } else if (c.config == 10) {
        const I N = c.shapes[0][0], D = c.shapes[0][1];
        float* x = upload(c.data[0]);
        float* g = upload(c.data[1]);
        float* be = upload(c.data[2]);
        float* ep = upload(c.data[3]);
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)N * D));
        auto body = [&]() {
          ln_fused<<<(N + LN_WARPS - 1) / LN_WARPS, LN_WARPS * 32>>>(N, D, x, g, be, ep, y, (U)((I)N * D));
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        check(cudaFuncGetAttributes(&attr, ln_fused));
        if (timing) timeLoop(name, 20, body);
        else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)N * D);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {N, D}, host);
        }
        check(cudaFree(x)); check(cudaFree(g)); check(cudaFree(be)); check(cudaFree(ep)); check(cudaFree(y));
      } else {
        // attention fused: kernel A (score+softmax) then the tiled GEMM for out
        const I Q = c.shapes[0][0], Dd = c.shapes[0][1], Kd = c.shapes[1][0], V = c.shapes[2][1];
        float* q = upload(c.data[0]);
        float* k = upload(c.data[1]);
        float* v = upload(c.data[2]);
        float* w;
        check(cudaMalloc(&w, sizeof(float) * (size_t)Q * Kd));
        float* y;
        check(cudaMalloc(&y, sizeof(float) * (size_t)Q * V));
        auto body = [&]() {
          attn_sm<<<(Q + SM_WARPS - 1) / SM_WARPS, 256>>>(Q, Kd, Dd, q, k, w, (U)((I)Q * Kd));
          dim3 grid((V + 31) / 32, (Q + 31) / 32);
          mm_rt32<<<grid, 64>>>(Q, Kd, V, w, v, y, (U)((I)Q * V));
          check(cudaGetLastError());
        };
        cudaFuncAttributes attr;
        check(cudaFuncGetAttributes(&attr, attn_sm));
        check(cudaFuncGetAttributes(&attr, mm_rt32));
        if (timing) timeLoop(name, 20, body);
        else {
          body();
          check(cudaDeviceSynchronize());
          std::vector<float> host((size_t)Q * V);
          check(cudaMemcpy(host.data(), y, host.size() * sizeof(float), cudaMemcpyDeviceToHost));
          writeResult(name, {Q, V}, host);
        }
        check(cudaFree(q)); check(cudaFree(k)); check(cudaFree(v)); check(cudaFree(w)); check(cudaFree(y));
      }
    }
    if (big) {
      // 4096^3 timing-only: uninitialized device buffers, values irrelevant
      const I M = 4096, K = 4096, N = 4096;
      float* a; float* b; float* y;
      check(cudaMalloc(&a, sizeof(float) * (size_t)M * K));
      check(cudaMalloc(&b, sizeof(float) * (size_t)K * N));
      check(cudaMalloc(&y, sizeof(float) * (size_t)M * N));
      auto body = [&]() {
        dim3 grid((N + 31) / 32, (M + 31) / 32);
        mm_rt32<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
        check(cudaGetLastError());
      };
      cudaFuncAttributes attr;
      check(cudaFuncGetAttributes(&attr, mm_rt32));
      timeLoop("mm_rt32_rn@4096", 10, body);
      auto bodyFma = [&]() {
        dim3 grid((N + 31) / 32, (M + 31) / 32);
        mm_rt32_fma<<<grid, 64>>>(M, K, N, a, b, y, (U)((I)M * N));
        check(cudaGetLastError());
      };
      timeLoop("mm_rt32_fma@4096", 10, bodyFma);
      check(cudaFree(a)); check(cudaFree(b)); check(cudaFree(y));
    }
    fclose(in);
    check(cudaDeviceSynchronize());
    return 0;
  } catch (const std::exception& e) {
    fprintf(stderr, "%s\n", e.what());
    return 1;
  }
}
