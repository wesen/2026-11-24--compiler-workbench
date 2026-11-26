// IRWB-023-C experiment 03: fused, exact-order row kernels and the harness comparing them with Stage 2.
//
// Exactness argument, per kernel: every scalar operation of the Tix tree is performed with the same
// operands and rounding (the Stage 2 intrinsics), every sum folds in increasing index order from +0 in a
// single thread, and only max, which is an exact semilattice join under the Stage 2 minmax helper (NaN
// absorbs, +0 beats -0, equal words are idempotent), is reduced as a tree. Intermediates live in shared
// memory instead of global buffers; a common subexpression (sqrt(variance+eps), sqrt(D)) is computed once.
#include <dlfcn.h>
using s2_softmax::minmax;

template <int FAST> __device__ __forceinline__ float tix_exp(float x) {
  return FAST ? fast_exp(x) : __double2float_rn(exp(static_cast<double>(x)));
}

// Block-wide max as a tree of minmax joins; every thread receives the result.
__device__ float block_max(float v, float* scratch) {
  for (int o = 16; o; o >>= 1) v = minmax(v, __shfl_xor_sync(0xffffffffu, v, o), true);
  const int warps = (blockDim.x + 31) / 32, lane = threadIdx.x & 31, warp = threadIdx.x >> 5;
  if (lane == 0) scratch[warp] = v;
  __syncthreads();
  if (warp == 0) {
    v = lane < warps ? scratch[lane] : -INFINITY;
    for (int o = 16; o; o >>= 1) v = minmax(v, __shfl_xor_sync(0xffffffffu, v, o), true);
    if (lane == 0) scratch[0] = v;
  }
  __syncthreads();
  v = scratch[0];
  __syncthreads();
  return v;
}

// In-order fold of n shared values by one thread: v = +0; v = RN(v + a[j]).
__device__ __forceinline__ float ordered_sum(const float* a, int64_t n) {
  float v = 0.0f;
#pragma unroll 8
  for (int64_t j = 0; j < n; ++j) v = __fadd_rn(v, a[j]);
  return v;
}

template <int FAST> __global__ void softmax_fused(int64_t C, const float* x, float* y) {
  extern __shared__ float row[];
  __shared__ float scratch[33];
  const float* xr = x + blockIdx.x * C;
  float m = -INFINITY;
  for (int64_t j = threadIdx.x; j < C; j += blockDim.x) {
    const float v = xr[j];
    row[j] = v;
    m = minmax(m, v, true);
  }
  m = block_max(m, scratch);
  for (int64_t j = threadIdx.x; j < C; j += blockDim.x) row[j] = tix_exp<FAST>(__fsub_rn(row[j], m));
  __syncthreads();
  if (threadIdx.x == 0) scratch[32] = ordered_sum(row, C);
  __syncthreads();
  const float s = scratch[32];
  for (int64_t j = threadIdx.x; j < C; j += blockDim.x) y[blockIdx.x * C + j] = __fdiv_rn(row[j], s);
}

__global__ void layernorm_fused(int64_t D, const float* x, const float* gamma, const float* beta, const float* eps, float* y) {
  extern __shared__ float row[];
  __shared__ float stats[2];
  const float* xr = x + blockIdx.x * D;
  for (int64_t j = threadIdx.x; j < D; j += blockDim.x) row[j] = xr[j];
  __syncthreads();
  if (threadIdx.x == 0) stats[0] = __fdiv_rn(ordered_sum(row, D), __ll2float_rn(D));
  __syncthreads();
  const float mean = stats[0];
  for (int64_t j = threadIdx.x; j < D; j += blockDim.x) row[j] = __fsub_rn(row[j], mean);
  __syncthreads();
  if (threadIdx.x == 0) {
    float v = 0.0f;
#pragma unroll 8
    for (int64_t j = 0; j < D; ++j) v = __fadd_rn(v, __fmul_rn(row[j], row[j]));
    stats[1] = __fsqrt_rn(__fadd_rn(__fdiv_rn(v, __ll2float_rn(D)), eps[0]));
  }
  __syncthreads();
  const float r = stats[1];
  for (int64_t j = threadIdx.x; j < D; j += blockDim.x)
    y[blockIdx.x * D + j] = __fadd_rn(__fmul_rn(__fdiv_rn(row[j], r), gamma[j]), beta[j]);
}

// Four query rows per block, 64 threads per row (blockDim 256). Scores, exponentials and weights stay in
// shared memory. Key and value tiles of 64 rows are staged once per block and shared by the four rows; a key
// tile has one word of padding so a thread's walk along d does not bank-conflict. Each output (i, c) still
// folds j = 0..K-1 in order in one thread, and each score folds d = 0..D-1 in order in one thread.
constexpr int ROWS = 4;
template <int FAST> __global__ void attention_fused(int64_t Q, int64_t D, int64_t K, int64_t V, const float* q,
                                                    const float* k, const float* v, float* out, int phases = 3) {
  extern __shared__ float smem[];
  const int64_t P = D + 1;
  float* qrows = smem;                 // ROWS x D
  float* w = qrows + ROWS * D;         // ROWS x K
  float* ktile = w + ROWS * K;         // 64 x (D + 1)
  float* vtile = ktile + 64 * P;       // 64 x V
  __shared__ float scratch[2 * ROWS], sums[ROWS];
  const int r = threadIdx.x / 64, c0 = threadIdx.x % 64, lane = threadIdx.x & 31, warp = threadIdx.x >> 5;
  const int64_t i = blockIdx.x * ROWS + r;
  const bool live = i < Q;
  for (int64_t d = c0; d < D; d += 64) qrows[r * D + d] = live ? q[i * D + d] : 0.0f;
  const float scale = __fsqrt_rn(__ll2float_rn(D));
  for (int64_t j0 = 0; j0 < K; j0 += 64) {
    __syncthreads();
    for (int row = threadIdx.x / 64; row < 64; row += ROWS)  // 2-D walk: no runtime integer division
      for (int64_t col = c0; col < D; col += 64) ktile[row * P + col] = j0 + row < K ? k[(j0 + row) * D + col] : 0.0f;
    __syncthreads();
    if (j0 + c0 < K) {
      float acc = 0.0f;
      const float* qa = qrows + r * D;
      const float* ka = ktile + c0 * P;
      const int Di = (int)D;
#pragma unroll 16
      for (int d = 0; d < Di; ++d) acc = __fadd_rn(acc, __fmul_rn(qa[d], ka[d]));
      w[r * K + j0 + c0] = __fdiv_rn(acc, scale);
    }
  }
  __syncthreads();
  if (phases < 2) { if (live && c0 == 0) out[i * V] = w[r * K]; return; }
  float m = -INFINITY;
  for (int64_t j = c0; j < K; j += 64) m = minmax(m, w[r * K + j], true);
  for (int o = 16; o; o >>= 1) m = minmax(m, __shfl_xor_sync(0xffffffffu, m, o), true);
  if (lane == 0) scratch[warp] = m;
  __syncthreads();
  m = minmax(scratch[2 * r], scratch[2 * r + 1], true);
  for (int64_t j = c0; j < K; j += 64) w[r * K + j] = tix_exp<FAST>(__fsub_rn(w[r * K + j], m));
  __syncthreads();
  if (c0 == 0) sums[r] = ordered_sum(w + r * K, K);
  __syncthreads();
  const float z = sums[r];
  for (int64_t j = c0; j < K; j += 64) w[r * K + j] = __fdiv_rn(w[r * K + j], z);
  if (phases < 3) { if (live && c0 == 0) out[i * V] = w[r * K]; return; }
  for (int64_t cb = 0; cb < V; cb += 64) {
    const int64_t c = cb + c0;
    float acc = 0.0f;
    for (int64_t j0 = 0; j0 < K; j0 += 64) {
      __syncthreads();
      for (int row = threadIdx.x / 64; row < 64; row += ROWS)
        vtile[row * 64 + c0] = j0 + row < K && c < V ? v[(j0 + row) * V + c] : 0.0f;
      __syncthreads();
      const int n = K - j0 < 64 ? (int)(K - j0) : 64;
      const float* wa = w + r * K + j0;
#pragma unroll 16
      for (int j = 0; j < n; ++j) acc = __fadd_rn(acc, __fmul_rn(wa[j], vtile[j * 64 + c0]));
    }
    if (live && c < V) out[i * V + c] = acc;
  }
}

// Attention as three exact kernels: score GEMM (the experiment-01 kernel), a row kernel for
// scale/max/exp/sum/divide, and the weight x value GEMM. Only the 4 MB score/weight matrix round-trips.
__global__ void transpose(int64_t R, int64_t C, const float* x, float* y) {  // y[c, r] = x[r, c]; bit copy
  const int64_t t = (int64_t)blockIdx.x * blockDim.x + threadIdx.x;
  if (t < R * C) y[(t % C) * R + t / C] = x[t];
}
template <int FAST> __global__ void attention_rows(int64_t K, int64_t D, float* s) {
  extern __shared__ float row[];
  __shared__ float scratch[33];
  float* sr = s + blockIdx.x * K;
  const float scale = __fsqrt_rn(__ll2float_rn(D));
  float m = -INFINITY;
  for (int64_t j = threadIdx.x; j < K; j += blockDim.x) {
    const float v = __fdiv_rn(sr[j], scale);
    row[j] = v;
    m = minmax(m, v, true);
  }
  m = block_max(m, scratch);
  for (int64_t j = threadIdx.x; j < K; j += blockDim.x) row[j] = tix_exp<FAST>(__fsub_rn(row[j], m));
  __syncthreads();
  if (threadIdx.x == 0) scratch[32] = ordered_sum(row, K);
  __syncthreads();
  const float z = scratch[32];
  for (int64_t j = threadIdx.x; j < K; j += blockDim.x) sr[j] = __fdiv_rn(row[j], z);
}

// ---- host harness -------------------------------------------------------------------------------------
struct Tensor { std::vector<int64_t> shape; std::vector<float> data; };
static uint64_t rng = 0x2545F4914F6CDD1Dull;
static Tensor make(std::vector<int64_t> shape, float lo, float hi) {
  Tensor t{shape, {}};
  int64_t n = 1;
  for (auto d : shape) n *= d;
  t.data.resize(n);
  for (auto& x : t.data) {
    rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
    x = lo + (hi - lo) * (float)((rng >> 40) / 16777216.0);
  }
  return t;
}

// Runs a Stage 2 run_case on in-memory request bytes and returns its output and reported gpu_ms.
typedef void (*RunCase)(FILE*, FILE*, bool);
static Tensor stage2(RunCase run, const std::vector<Tensor>& params, int rank, double* ms) {
  std::vector<char> req;
  for (auto& p : params) {
    req.insert(req.end(), (const char*)p.shape.data(), (const char*)(p.shape.data() + p.shape.size()));
    req.insert(req.end(), (const char*)p.data.data(), (const char*)(p.data.data() + p.data.size()));
  }
  FILE* in = fmemopen(req.data(), req.size(), "rb");
  char* buf = nullptr; size_t len = 0;
  FILE* out = open_memstream(&buf, &len);
  run(in, out, true);
  fclose(in); fclose(out);
  Tensor t; t.shape.resize(rank);
  memcpy(t.shape.data(), buf, rank * 8);
  int64_t n = 1;
  for (auto d : t.shape) n *= d;
  t.data.resize(n);
  memcpy(t.data.data(), buf + rank * 8, n * 4);
  memcpy(ms, buf + rank * 8 + n * 4, 8);
  free(buf);
  return t;
}

struct Dev {
  float* p = nullptr;
  explicit Dev(const std::vector<float>& h) { CHECK(cudaMalloc(&p, h.size() * 4 + 4)); CHECK(cudaMemcpy(p, h.data(), h.size() * 4, cudaMemcpyHostToDevice)); }
  explicit Dev(size_t n) { CHECK(cudaMalloc(&p, n * 4 + 4)); }
  ~Dev() { cudaFree(p); }
};

template <class F> static float median_ms(F launch, int reps = 21) {
  cudaEvent_t s, e; CHECK(cudaEventCreate(&s)); CHECK(cudaEventCreate(&e));
  launch(); CHECK(cudaDeviceSynchronize()); CHECK(cudaGetLastError());
  std::vector<float> ms(reps);
  for (int r = 0; r < reps; ++r) {
    CHECK(cudaEventRecord(s)); launch(); CHECK(cudaEventRecord(e)); CHECK(cudaEventSynchronize(e));
    CHECK(cudaEventElapsedTime(&ms[r], s, e));
  }
  std::sort(ms.begin(), ms.end());
  cudaEventDestroy(s); cudaEventDestroy(e);
  return ms[reps / 2];
}

static long long word_diffs(const std::vector<float>& a, const std::vector<float>& b) {
  if (a.size() != b.size()) return -1;
  long long n = 0;
  for (size_t i = 0; i < a.size(); ++i) n += memcmp(&a[i], &b[i], 4) != 0;
  return n;
}

static std::vector<float> download(const Dev& d, size_t n) {
  std::vector<float> h(n);
  CHECK(cudaMemcpy(h.data(), d.p, n * 4, cudaMemcpyDeviceToHost));
  return h;
}

static void report(const char* name, double s2ms, float fd, float ff, long long dd, long long df, double bytes) {
  printf("{\"program\":\"%s\",\"stage2Ms\":%.4f,\"fusedDoubleExpMs\":%.4f,\"fusedFastExpMs\":%.4f,"
         "\"speedupVsStage2\":%.2f,\"wordsDifferentFromStage2\":{\"fusedDoubleExp\":%lld,\"fusedFastExp\":%lld},"
         "\"fusedFastGBps\":%.1f}\n", name, s2ms, fd, ff, s2ms / ff, dd, df, bytes / (ff * 1e-3) / 1e9);
}

int main() {
  init_table();
  {
    const int64_t N = 4096, C = 1024;
    Tensor x = make({N, C}, -8.0f, 8.0f);
    double s2ms;
    Tensor ref = stage2(s2_softmax::run_case, {x}, 2, &s2ms);
    Dev dx(x.data), dy(N * C);
    const size_t sm = C * 4;
    const float fd = median_ms([&] { softmax_fused<0><<<N, 256, sm>>>(C, dx.p, dy.p); });
    const long long dd = word_diffs(ref.data, download(dy, N * C));
    const float ff = median_ms([&] { softmax_fused<1><<<N, 256, sm>>>(C, dx.p, dy.p); });
    const long long df = word_diffs(ref.data, download(dy, N * C));
    report("softmax", s2ms, fd, ff, dd, df, 8.0 * N * C);
  }
  {
    const int64_t N = 4096, D = 1024;
    Tensor x = make({N, D}, -1.0f, 1.0f), g = make({D}, 0.5f, 1.5f), b = make({D}, -0.5f, 0.5f), eps{{1}, {1e-5f}};
    double s2ms;
    Tensor ref = stage2(s2_layernorm::run_case, {x, g, b, eps}, 2, &s2ms);
    Dev dx(x.data), dg(g.data), db(b.data), de(eps.data), dy(N * D);
    const float f = median_ms([&] { layernorm_fused<<<N, 256, D * 4>>>(D, dx.p, dg.p, db.p, de.p, dy.p); });
    const long long d = word_diffs(ref.data, download(dy, N * D));
    report("layernorm", s2ms, f, f, d, d, 8.0 * N * D);
  }
  {
    const int64_t Q = 1024, K = 1024, D = 64, V = 64;
    Tensor q = make({Q, D}, -1.0f, 1.0f), k = make({K, D}, -1.0f, 1.0f), v = make({K, V}, -1.0f, 1.0f);
    double s2ms;
    Tensor ref = stage2(s2_attention::run_case, {q, k, v}, 2, &s2ms);
    Dev dq(q.data), dk(k.data), dv(v.data), dout(Q * V);
    const size_t sm = (ROWS * D + ROWS * K + 64 * (D + 1) + 64 * 64) * 4;
    CHECK(cudaFuncSetAttribute(attention_fused<0>, cudaFuncAttributeMaxDynamicSharedMemorySize, (int)sm));
    CHECK(cudaFuncSetAttribute(attention_fused<1>, cudaFuncAttributeMaxDynamicSharedMemorySize, (int)sm));
    const float fd = median_ms([&] { attention_fused<0><<<(Q + ROWS - 1) / ROWS, 64 * ROWS, sm>>>(Q, D, K, V, dq.p, dk.p, dv.p, dout.p); });
    const long long dd = word_diffs(ref.data, download(dout, Q * V));
    const float ff = median_ms([&] { attention_fused<1><<<(Q + ROWS - 1) / ROWS, 64 * ROWS, sm>>>(Q, D, K, V, dq.p, dk.p, dv.p, dout.p); });
    const long long df = word_diffs(ref.data, download(dout, Q * V));
    report("attention", s2ms, fd, ff, dd, df, 4.0 * (Q * D + K * D + K * V + Q * V));
    const float p1 = median_ms([&] { attention_fused<1><<<(Q + ROWS - 1) / ROWS, 64 * ROWS, sm>>>(Q, D, K, V, dq.p, dk.p, dv.p, dout.p, 1); });
    const float p2 = median_ms([&] { attention_fused<1><<<(Q + ROWS - 1) / ROWS, 64 * ROWS, sm>>>(Q, D, K, V, dq.p, dk.p, dv.p, dout.p, 2); });
    printf("{\"program\":\"attention-phases\",\"scoresOnlyMs\":%.4f,\"throughSoftmaxMs\":%.4f,\"allMs\":%.4f}\n", p1, p2, ff);
    Dev kT(K * D), S(Q * K);
    auto three = [&](auto rows) {
      transpose<<<(K * D + 255) / 256, 256>>>(K, D, dk.p, kT.p);
      tiled<64, 64, 8, 4, 4, EXACT><<<dim3((K + 63) / 64, (Q + 63) / 64, 1), 256>>>((int)Q, (int)K, (int)D, (int)D, dq.p, kT.p, S.p);
      rows();
      tiled<32, 32, 8, 2, 2, EXACT><<<dim3((V + 31) / 32, (Q + 31) / 32, 1), 256>>>((int)Q, (int)V, (int)K, (int)K, S.p, dv.p, dout.p);
    };
    const float td = median_ms([&] { three([&] { attention_rows<0><<<Q, 256, K * 4>>>(K, D, S.p); }); });
    const long long d3 = word_diffs(ref.data, download(dout, Q * V));
    const float tf = median_ms([&] { three([&] { attention_rows<1><<<Q, 256, K * 4>>>(K, D, S.p); }); });
    const long long f3 = word_diffs(ref.data, download(dout, Q * V));
    report("attention-3-kernels", s2ms, td, tf, d3, f3, 4.0 * (Q * D + K * D + K * V + Q * V + 2 * Q * K));
  }
  return 0;
}
