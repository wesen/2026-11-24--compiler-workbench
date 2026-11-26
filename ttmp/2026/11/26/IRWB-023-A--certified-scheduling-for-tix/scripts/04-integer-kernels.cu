#include "generated.cuh"
#include <functional>
#include <mma.h>
#include <random>

namespace wmma = nvcuda::wmma;
constexpr int tile = 64, depth = 32, threads = 128;
constexpr float to_coeff = 0x1p7f, to_value = 0x1p-14f;

// The scale is fixed for this experiment. Verify the input value before using its coefficient.
__device__ signed char coefficient(float value, bool& invalid) {
  const float scaled = __fmul_rn(value, to_coeff);
  if (scaled >= -128.0f && scaled <= 127.0f) {
    const int q = __float2int_rz(scaled);
    if (__int2float_rn(q) == scaled) return static_cast<signed char>(q);
  }
  invalid = true;
  return 0;
}

__global__ void pack(const float* a, const float* b, signed char* qa, signed char* qb,
                     int m, int n, int k, int* bad) {
  const int i = blockDim.x * blockIdx.x + threadIdx.x;
  bool invalid = false;
  if (i < m * k) qa[i] = coefficient(a[i], invalid);
  if (i < k * n) {
    const int reduction = i / n, column = i % n;
    qb[column * k + reduction] = coefficient(b[i], invalid);
  }
  if (__syncthreads_or(invalid) && threadIdx.x == 0) atomicOr(bad, 1);
}

template<bool CheckFlag, bool InlineFallback = true>
__global__ void contraction(const float* a, const float* b, const signed char* qa,
                            const signed char* qb, const int* bad, float* out,
                            int n, int k) {
  const int row = blockIdx.y * tile, col = blockIdx.x * tile;
  if (CheckFlag && *bad) {
    if (!InlineFallback) return;
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

// Cache both input tiles while advancing each output's original K carry.
constexpr int fTile = 32, fDepth = 16;
template<bool OnlyOnMiss>
__global__ void ordered_tile(const float* a, const float* b, const int* bad, float* out, int n, int k) {
  if (OnlyOnMiss && !*bad) return;
  __shared__ float left[fTile][fDepth], right[fDepth][fTile];
  const int row = blockIdx.y * fTile, col = blockIdx.x * fTile;
  const int row_lane = threadIdx.x / 16, column_lane = threadIdx.x % 16;
  float result[4][2] = {};
  for (int base = 0; base < k; base += fDepth) {
    for (int i = threadIdx.x; i < fTile * fDepth; i += blockDim.x) {
      left[i / fDepth][i % fDepth] = a[(row + i / fDepth) * k + base + i % fDepth];
      right[i / fTile][i % fTile] = b[(base + i / fTile) * n + col + i % fTile];
    }
    __syncthreads();
    #pragma unroll
    for (int d = 0; d < fDepth; d++) {
      #pragma unroll
      for (int i = 0; i < 4; i++) {
        #pragma unroll
        for (int j = 0; j < 2; j++) {
          const float product = __fmul_rn(left[row_lane + 8 * i][d], right[d][column_lane + 16 * j]);
          result[i][j] = __fadd_rn(result[i][j], product);
        }
      }
    }
    __syncthreads();
  }
  for (int i = 0; i < 4; i++)
    for (int j = 0; j < 2; j++)
      out[(row + row_lane + 8 * i) * n + col + column_lane + 16 * j] = result[i][j];
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

static void run(int m, int n, int k, const char* label, int miss, bool extreme, bool timed) {
  if (m % tile || n % tile || k % depth || k > 1024) throw std::runtime_error("unsupported test geometry");
  DeviceBuffer a(m * k), b(k * n), ordered(m * n), packed(m * n), guarded(m * n);
  DeviceBuffer tiled(m * n), routed(m * n);
  Workspace workspace(m * k, k * n);
  std::mt19937 random(23);
  auto make = [&](int count) {
    std::vector<float> data(count);
    for (int i = 0; i < count; i++)
      data[i] = extreme ? -1.0f : static_cast<float>(int(random() % 256) - 128) / 128.0f;
    if (!extreme) data[0] = -0.0f;
    if (miss == 2) for (auto& x : data) x += 0.001f;
    return data;
  };
  a.upload(make(m * k).data());
  auto b_host = make(k * n);
  if (miss == 1) b_host[b_host.size() - 2] = 0x1p-149f;
  b.upload(b_host.data());

  const dim3 grid(n / tile, m / tile), float_grid(n / fTile, m / fTile);
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
  Launch exact_tiled = [&] { ordered_tile<false><<<float_grid, threads>>>(
    a.ptr, b.ptr, workspace.bad, tiled.ptr, n, k); };
  Launch route = [&] {
    prepare();
    contraction<true, false><<<grid, threads>>>(
      a.ptr, b.ptr, workspace.qa, workspace.qb, workspace.bad, routed.ptr, n, k);
    ordered_tile<true><<<float_grid, threads>>>(a.ptr, b.ptr, workspace.bad, routed.ptr, n, k);
  };
  prepare();
  std::vector<Launch> launches{baseline, exact_tiled, checked, route};
  std::vector<const char*> names{"ordered", "exact-tiled", "guarded-inline", "guarded-routed"};
  if (!miss) {
    launches.push_back(resident);
    names.push_back("prepacked");
  }
  for (const auto& launch : launches) launch();
  check(cudaGetLastError());
  check(cudaDeviceSynchronize());
  int verdict;
  check(cudaMemcpy(&verdict, workspace.bad, sizeof(verdict), cudaMemcpyDeviceToHost));
  if (verdict != (miss != 0)) throw std::runtime_error("bad guard verdict");

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
  if (!miss) compare(packed, "prepacked");
  compare(tiled, "exact-tiled");
  compare(guarded, "guarded-inline");
  compare(routed, "guarded-routed");
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
    const char* version = names[v];
    printf("samples_ms %s %s", label, version);
    for (float t : observations[v]) printf(" %.6f", t);
    auto sorted = observations[v];
    std::sort(sorted.begin(), sorted.end());
    printf(" | median %.6f\n", sorted[sorted.size() / 2]);
  }
}

int main() {
  try {
    run(512, 512, 512, "512-cube", 0, false, true);
    run(512, 512, 64, "512x512x64", 0, false, true);
    run(512, 512, 512, "512-cube-single-miss", 1, false, true);
    run(512, 512, 512, "512-cube-many-misses", 2, false, true);
    run(256, 192, 96, "rectangular", 0, false, false);
    run(64, 64, 1024, "maximum-coefficient-bound", 0, true, false);
  } catch (const std::exception& e) {
    fprintf(stderr, "%s\n", e.what());
    return 1;
  }
}
