#include "generated.cuh"
#include <functional>
#include <mma.h>
#include <random>

namespace wmma = nvcuda::wmma;
constexpr int tile = 64, depth = 32, threads = 128;
constexpr float to_coeff = 0x1p7f, to_value = 0x1p-14f;

// The scale is fixed for this experiment. Verify the input value before using its coefficient.
__device__ signed char coefficient(float value, int* bad) {
  const float scaled = __fmul_rn(value, to_coeff);
  if (scaled >= -128.0f && scaled <= 127.0f) {
    const int q = __float2int_rz(scaled);
    if (__int2float_rn(q) == scaled) return static_cast<signed char>(q);
  }
  atomicOr(bad, 1);
  return 0;
}

__global__ void pack(const float* a, const float* b, signed char* qa, signed char* qb,
                     int m, int n, int k, int* bad) {
  const int i = blockDim.x * blockIdx.x + threadIdx.x;
  if (i < m * k) qa[i] = coefficient(a[i], bad);
  if (i < k * n) {
    const int reduction = i / n, column = i % n;
    qb[column * k + reduction] = coefficient(b[i], bad);
  }
}

template<bool CheckFlag>
__global__ void contraction(const float* a, const float* b, const signed char* qa,
                            const signed char* qb, const int* bad, float* out,
                            int n, int k) {
  const int row = blockIdx.y * tile, col = blockIdx.x * tile;
  if (CheckFlag && *bad) {
    for (int index = threadIdx.x; index < tile * tile; index += blockDim.x) {
      const int i = row + index / tile, j = col + index % tile;
      float acc = 0.0f;
      for (int d = 0; d < k; d++) acc = __fadd_rn(acc, __fmul_rn(a[i * k + d], b[d * n + j]));
      out[i * n + j] = acc;
    }
    return;
  }

  __shared__ __align__(32) signed char left[depth / 16][tile * 16], right[depth / 16][tile * 16];
  __shared__ __align__(32) int integer_result[tile * tile];
  const int warp = threadIdx.x / 32;
  const int warp_row = (warp / 2) * 32, warp_col = (warp % 2) * 32;
  wmma::fragment<wmma::accumulator, 16, 16, 16, int> acc[2][2];
  for (int i = 0; i < 2; i++)
    for (int j = 0; j < 2; j++) wmma::fill_fragment(acc[i][j], 0);

  for (int d = 0; d < k; d += depth) {
    for (int index = threadIdx.x; index < tile * depth; index += blockDim.x) {
      const int axis = index / depth, reduction = index % depth;
      const int panel = reduction / 16, offset = axis * 16 + reduction % 16;
      left[panel][offset] = qa[(row + axis) * k + d + reduction];
      right[panel][offset] = qb[(col + axis) * k + d + reduction];
    }
    __syncthreads();

    for (int panel = 0; panel < depth / 16; panel++) {
      wmma::fragment<wmma::matrix_a, 16, 16, 16, signed char, wmma::row_major> x[2];
      wmma::fragment<wmma::matrix_b, 16, 16, 16, signed char, wmma::col_major> y[2];
      for (int z = 0; z < 2; z++) {
        wmma::load_matrix_sync(x[z], left[panel] + (warp_row + z * 16) * 16, 16);
        wmma::load_matrix_sync(y[z], right[panel] + (warp_col + z * 16) * 16, 16);
      }
      for (int i = 0; i < 2; i++)
        for (int j = 0; j < 2; j++) wmma::mma_sync(acc[i][j], x[i], y[j], acc[i][j]);
    }
    __syncthreads();
  }
  for (int i = 0; i < 2; i++)
    for (int j = 0; j < 2; j++)
      wmma::store_matrix_sync(integer_result + (warp_row + i * 16) * tile + warp_col + j * 16,
                              acc[i][j], tile, wmma::mem_row_major);
  __syncthreads();
  for (int index = threadIdx.x; index < tile * tile; index += blockDim.x) {
    const int i = row + index / tile, j = col + index % tile;
    out[i * n + j] = __fmul_rn(__int2float_rn(integer_result[index]), to_value);
  }
}

struct Workspace {
  signed char* qa = nullptr;
  signed char* qb = nullptr;
  int* bad = nullptr;
  Workspace(int a, int b) {
    check(cudaMalloc(&qa, a));
    check(cudaMalloc(&qb, b));
    check(cudaMalloc(&bad, sizeof(int)));
  }
  ~Workspace() {
    cudaFree(qa);
    cudaFree(qb);
    cudaFree(bad);
  }
};

using Launch = std::function<void()>;

static void run(int m, int n, int k, const char* label, bool invalid, bool extreme, bool timed) {
  if (m % tile || n % tile || k % depth || k > 1024) throw std::runtime_error("unsupported test geometry");
  DeviceBuffer a(m * k), b(k * n), ordered(m * n), packed(m * n), guarded(m * n);
  Workspace workspace(m * k, k * n);
  std::mt19937 random(23);
  auto make = [&](int count) {
    std::vector<float> data(count);
    for (int i = 0; i < count; i++)
      data[i] = extreme ? -1.0f : static_cast<float>(int(random() % 256) - 128) / 128.0f;
    if (!extreme) data[0] = -0.0f;
    return data;
  };
  a.upload(make(m * k).data());
  auto b_host = make(k * n);
  if (invalid) b_host[b_host.size() - 2] = 0x1p-149f;
  b.upload(b_host.data());

  const dim3 grid(n / tile, m / tile);
  const auto prepare = [&] {
    check(cudaMemsetAsync(workspace.bad, 0, sizeof(int)));
    pack<<<(std::max(m * k, k * n) + 255) / 256, 256>>>(
      a.ptr, b.ptr, workspace.qa, workspace.qb, m, n, k, workspace.bad);
  };
  Launch baseline = [&] { k0<<<(m * n + 255) / 256, 256>>>(m, k, n, a.ptr, b.ptr, ordered.ptr, m * n); };
  Launch resident = [&] { contraction<false><<<grid, threads>>>(
    a.ptr, b.ptr, workspace.qa, workspace.qb, workspace.bad, packed.ptr, n, k); };
  Launch checked = [&] {
    prepare();
    contraction<true><<<grid, threads>>>(
      a.ptr, b.ptr, workspace.qa, workspace.qb, workspace.bad, guarded.ptr, n, k);
  };
  prepare();
  baseline();
  auto launches = invalid ? std::vector<Launch>{baseline, checked} : std::vector<Launch>{baseline, resident, checked};
  for (const auto& launch : launches) launch();
  check(cudaGetLastError());
  check(cudaDeviceSynchronize());
  int verdict;
  check(cudaMemcpy(&verdict, workspace.bad, sizeof(verdict), cudaMemcpyDeviceToHost));
  if (verdict != invalid) throw std::runtime_error("bad guard verdict");

  std::vector<float> ref(m * n), got(m * n);
  ordered.download(ref.data());
  auto compare = [&](const DeviceBuffer& buffer, const char* version) {
    buffer.download(got.data());
    size_t equal = 0;
    for (int i = 0; i < m * n; i++)
      if (memcmp(&ref[i], &got[i], sizeof(float)) == 0) equal++;
    printf("equal %s %s %zu/%d guard %d\n", label, version, equal, m * n, verdict);
    if (equal != got.size()) throw std::runtime_error("contraction differs");
  };
  if (!invalid) compare(packed, "prepacked");
  compare(guarded, "guarded");
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
  for (size_t v = 0; v < launches.size(); v++) {
    const char* version = v == 0 ? "ordered" : v == 1 && !invalid ? "prepacked" : "guarded";
    printf("samples_ms %s %s", label, version);
    for (float t : observations[v]) printf(" %.6f", t);
    auto sorted = observations[v];
    std::sort(sorted.begin(), sorted.end());
    printf(" | median %.6f\n", sorted[sorted.size() / 2]);
  }
}

int main() {
  try {
    run(512, 512, 512, "512-cube", false, false, true);
    run(512, 512, 64, "512x512x64", false, false, true);
    run(512, 512, 512, "512-cube-miss", true, false, true);
    run(256, 192, 96, "rectangular", false, false, false);
    run(64, 64, 1024, "maximum-coefficient-bound", false, true, false);
  } catch (const std::exception& e) {
    fprintf(stderr, "%s\n", e.what());
    return 1;
  }
}
