#include "generated.cuh"
#include <limits>
#include <functional>
#include <random>

constexpr int BLOCK = 128;

// All threads call this with the same extent. Shared scratch is disjoint from values.
__device__ float parallel_max(const float* values, float* scratch, int n) {
  float best = -INFINITY;
  for (int j = threadIdx.x; j < n; j += blockDim.x) best = minmax(best, values[j], true);
  scratch[threadIdx.x] = best;
  __syncthreads();
  for (int stride = blockDim.x / 2; stride; stride /= 2) {
    if (threadIdx.x < stride)
      scratch[threadIdx.x] = minmax(scratch[threadIdx.x], scratch[threadIdx.x + stride], true);
    __syncthreads();
  }
  return scratch[0];
}

__device__ float ordered_sum(const float* row, int n) {
  float acc = 0.0f;
  for (int j = 0; j < n; ++j) acc = __fadd_rn(acc, row[j]);
  return acc;
}

#if defined(CASE_SOFTMAX)
template<bool ParallelMax>
__global__ void resident(const float* x, float* y, int n) {
  extern __shared__ float memory[];
  float* row = memory;
  __shared__ float scratch[BLOCK], total, max_value;
  const size_t offset = static_cast<size_t>(blockIdx.x) * n;
  if (ParallelMax) {
    for (int j = threadIdx.x; j < n; j += blockDim.x) row[j] = x[offset + j];
    __syncthreads();
    const float peak = parallel_max(row, scratch, n);
    if (threadIdx.x == 0) max_value = peak;
  } else if (threadIdx.x == 0) {
    float peak = -INFINITY;
    for (int j = 0; j < n; j++) peak = minmax(peak, x[offset + j], true);
    max_value = peak;
  }
  __syncthreads();
  for (int j = threadIdx.x; j < n; j += blockDim.x)
    row[j] = __double2float_rn(exp(static_cast<double>(__fsub_rn(x[offset + j], max_value))));
  __syncthreads();
  if (threadIdx.x == 0) total = ordered_sum(row, n);
  __syncthreads();
  for (int j = threadIdx.x; j < n; j += blockDim.x)
    y[offset + j] = __fdiv_rn(row[j], total);
}
#elif defined(CASE_LAYERNORM)
template<bool ParallelLoad>
__global__ void resident(const float* x, const float* gamma, const float* beta,
                         const float* eps, float* y, int n) {
  extern __shared__ float row[];
  __shared__ float mean, denom;
  const size_t offset = static_cast<size_t>(blockIdx.x) * n;
  const float dim = __int2float_rn(n);
  if (ParallelLoad) {
    for (int j = threadIdx.x; j < n; j += blockDim.x) row[j] = x[offset + j];
    __syncthreads();
  }
  if (threadIdx.x == 0)
    mean = __fdiv_rn(ordered_sum(ParallelLoad ? row : x + offset, n), dim);
  __syncthreads();
  for (int j = threadIdx.x; j < n; j += blockDim.x) row[j] = __fsub_rn(x[offset + j], mean);
  __syncthreads();
  if (threadIdx.x == 0) {
    float acc = 0.0f;
    for (int j = 0; j < n; ++j) acc = __fadd_rn(acc, __fmul_rn(row[j], row[j]));
    denom = __fsqrt_rn(__fadd_rn(__fdiv_rn(acc, dim), eps[0]));
  }
  __syncthreads();
  for (int j = threadIdx.x; j < n; j += blockDim.x)
    y[offset + j] = __fadd_rn(__fmul_rn(__fdiv_rn(row[j], denom), gamma[j]), beta[j]);
}
#elif defined(CASE_ATTENTION)
// Reuses stage 2's score kernel as-is. This isolates post-score residency.
__global__ void resident(const float* score, const float* values, float* out, int n, int v) {
  extern __shared__ float row[];
  __shared__ float scratch[BLOCK], total;
  const size_t offset = static_cast<size_t>(blockIdx.x) * n;
  for (int j = threadIdx.x; j < n; j += blockDim.x) row[j] = score[offset + j];
  __syncthreads();
  const float peak = parallel_max(row, scratch, n);
  for (int j = threadIdx.x; j < n; j += blockDim.x)
    row[j] = __double2float_rn(exp(static_cast<double>(__fsub_rn(row[j], peak))));
  __syncthreads();
  if (threadIdx.x == 0) total = ordered_sum(row, n);
  __syncthreads();
  for (int j = threadIdx.x; j < n; j += blockDim.x) row[j] = __fdiv_rn(row[j], total);
  __syncthreads();
  for (int c = threadIdx.x; c < v; c += blockDim.x) {
    float acc = 0.0f;
    for (int j = 0; j < n; j++) acc = __fadd_rn(acc, __fmul_rn(row[j], values[j * v + c]));
    out[static_cast<size_t>(blockIdx.x) * v + c] = acc;
  }
}
#endif

using Launch = std::function<void()>;
static constexpr unsigned blocks(U count) { return (count + 255) / 256; }

static void measure(const char* label, size_t count, const std::vector<Launch>& launches,
                    const std::vector<DeviceBuffer*>& buffers, bool timed) {
  for (const auto* buffer : buffers)
    if (buffer->size != count) throw std::runtime_error("benchmark output size differs");
  for (const auto& launch : launches) launch();
  check(cudaGetLastError());
  check(cudaDeviceSynchronize());
  std::vector<float> reference(count), candidate(count);
  buffers[0]->download(reference.data());
  for (size_t i = 1; i < launches.size(); i++) {
    buffers[i]->download(candidate.data());
    size_t mismatches = 0, nan_word_changes = 0;
    uint32_t first_ref = 0, first_got = 0;
    size_t first_index = count;
    for (size_t p = 0; p < count; ++p) {
      uint32_t ref, got;
      memcpy(&ref, &reference[p], sizeof(ref));
      memcpy(&got, &candidate[p], sizeof(got));
      if (ref == got) continue;
      if (std::isnan(reference[p]) && std::isnan(candidate[p])) {
        nan_word_changes++;
      } else {
        if (first_index == count) { first_index = p; first_ref = ref; first_got = got; }
        mismatches++;
      }
    }
    printf("equal %s v%zu %zu/%zu nan-word-changes %zu", label, i, count - mismatches, count, nan_word_changes);
    if (mismatches) printf(" first %zu %08x %08x", first_index, first_ref, first_got);
    puts("");
    if (mismatches) throw std::runtime_error("result differs");
  }
  if (!timed) return;

  Event start, stop;
  std::vector<std::vector<float>> observations(launches.size());
  for (int round = -4; round < 21; round++) {
    for (size_t i = 0; i < launches.size(); i++) {
      const size_t v = (i + round + 4) % launches.size();
      check(cudaEventRecord(start.handle));
      launches[v]();
      check(cudaEventRecord(stop.handle));
      check(cudaEventSynchronize(stop.handle));
      float ms;
      check(cudaEventElapsedTime(&ms, start.handle, stop.handle));
      if (round >= 0) observations[v].push_back(ms);
    }
  }
  for (size_t i = 0; i < observations.size(); ++i) {
    printf("samples_ms %s v%zu", label, i);
    for (float t : observations[i]) printf(" %.6f", t);
    auto sorted = observations[i];
    std::sort(sorted.begin(), sorted.end());
    printf(" | median %.6f\n", sorted[sorted.size() / 2]);
  }
}

static std::vector<float> data(U n, unsigned seed, bool edges) {
  std::mt19937 random(seed);
  std::vector<float> result(n);
  for (U i = 0; i < n; i++)
    result[i] = static_cast<float>(static_cast<int>(random() % 20001) - 10000) / 100000.0f;
  if (edges) {
    const std::array<float, 12> values = {0.0f, -0.0f, 0x1p-149f, -0x1p-149f, 1.0f, 0x1p-24f,
      -0x1p-24f, -1.0f, std::numeric_limits<float>::max(), -std::numeric_limits<float>::max(),
      200.0f, -200.0f};
    for (U i = 0; i < n; i++) result[i] = values[(i * 7 + i / 13) % values.size()];
  }
  return result;
}

static void run(int rows, int cols, const char* label, bool edges, bool timed) {
  const U cells = static_cast<U>(rows) * cols;
  DeviceBuffer x(cells), t1(rows), t2(cells), t3(rows);
  x.upload(data(cells, 20, edges).data());
#if defined(CASE_SOFTMAX)
  DeviceBuffer expected(cells), fused(cells), variant(cells);
  Launch baseline = [&] {
    k0<<<blocks(rows), 256>>>(rows, cols, x.ptr, t1.ptr, rows);
    k1<<<blocks(cells), 256>>>(rows, cols, x.ptr, t1.ptr, t2.ptr, cells);
    k2<<<blocks(rows), 256>>>(rows, cols, t2.ptr, t3.ptr, rows);
    k3<<<blocks(cells), 256>>>(rows, cols, t2.ptr, t3.ptr, expected.ptr, cells);
  };
  Launch alternate = [&] { resident<false><<<rows, BLOCK, 4 * cols>>>(x.ptr, fused.ptr, cols); };
  Launch parallel = [&] { resident<true><<<rows, BLOCK, 4 * cols>>>(x.ptr, variant.ptr, cols); };
  measure(label, cells, {baseline, alternate, parallel}, {&expected, &fused, &variant}, timed);
#elif defined(CASE_LAYERNORM)
  DeviceBuffer expected(cells), fused(cells), variant(cells);
  DeviceBuffer gamma(cols), beta(cols), eps(1);
  gamma.upload(data(cols, 21, edges).data());
  beta.upload(data(cols, 22, edges).data());
  const float epsilon = edges ? -1.0f : 1.0e-5f;
  eps.upload(&epsilon);
  Launch baseline = [&] {
    k0<<<blocks(rows), 256>>>(rows, cols, x.ptr, t1.ptr, rows);
    k1<<<blocks(cells), 256>>>(rows, cols, x.ptr, t1.ptr, t2.ptr, cells);
    k2<<<blocks(rows), 256>>>(rows, cols, t2.ptr, t3.ptr, rows);
    k3<<<blocks(cells), 256>>>(rows, cols, t2.ptr, t3.ptr, eps.ptr, gamma.ptr, beta.ptr, expected.ptr, cells);
  };
  Launch alternate = [&] { resident<false><<<rows, BLOCK, 4 * cols>>>(x.ptr, gamma.ptr, beta.ptr, eps.ptr, fused.ptr, cols); };
  Launch parallel = [&] { resident<true><<<rows, BLOCK, 4 * cols>>>(x.ptr, gamma.ptr, beta.ptr, eps.ptr, variant.ptr, cols); };
  measure(label, cells, {baseline, alternate, parallel}, {&expected, &fused, &variant}, timed);
#elif defined(CASE_ATTENTION)
  const int d = timed ? 64 : 19;
  const int v = timed ? 64 : 11;
  const U outputs = static_cast<U>(rows) * v;
  DeviceBuffer expected(outputs), fused(outputs);
  DeviceBuffer q(static_cast<U>(rows) * d), k(static_cast<U>(cols) * d), values(static_cast<U>(cols) * v);
  DeviceBuffer weights(cells), probs(cells);
  q.upload(data(q.size, 20, edges).data());
  k.upload(data(k.size, 21, edges).data());
  values.upload(data(values.size, 22, edges).data());
  auto score = [&] { k0<<<blocks(cells), 256>>>(rows, d, cols, v, q.ptr, k.ptr, x.ptr, cells); };
  Launch baseline = [&] {
    score();
    k1<<<blocks(rows), 256>>>(rows, d, cols, v, x.ptr, t1.ptr, rows);
    k2<<<blocks(cells), 256>>>(rows, d, cols, v, x.ptr, t1.ptr, t2.ptr, cells);
    k3<<<blocks(rows), 256>>>(rows, d, cols, v, t2.ptr, t3.ptr, rows);
    k4<<<blocks(cells), 256>>>(rows, d, cols, v, t2.ptr, t3.ptr, weights.ptr, cells);
    k5<<<blocks(outputs), 256>>>(rows, d, cols, v, weights.ptr, values.ptr, expected.ptr, outputs);
  };
  Launch alternate = [&] {
    score();
    resident<<<rows, BLOCK, 4 * cols>>>(x.ptr, values.ptr, fused.ptr, cols, v);
  };
  measure(label, outputs, {baseline, alternate}, {&expected, &fused}, timed);
#endif
}

int main() {
  try {
#if defined(CASE_ATTENTION)
    run(1024, 1024, "full", false, true);
#else
    run(4096, 1024, "full", false, true);
#endif
    run(19, 131, "tail", false, false);
    run(9, 17, "finite-edges", true, false);
  } catch (const std::exception& e) {
    fprintf(stderr, "%s\n", e.what());
    return 1;
  }
}
