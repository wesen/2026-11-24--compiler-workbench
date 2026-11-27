# Measured results, IRWB-023-G

All numbers on the NVIDIA GB10 (sm_121, 48 SMs) through `tools/cuda-remote.mjs --timed`, CUDA 13.0,
`nvcc -O3`, medians of CUDA event timings. Each block names the script that produced it.
Design document: `../design-doc/01-speed-at-a-fixed-meaning.md`.

## 01-gate-on-identity.mjs, 02-reduction-length.mjs: the tolerance gate on the *identity* transformation

`meaningGate(origin,'tolerance')(origin, origin)` — a candidate that is the origin itself, compared with
the origin's f64 evaluation under `|cand_f32 - origin_f64| <= 2e-6 + 2e-5|r|`. 1.0 is the boundary.

| program (the gate's own cases) | identity max budget | split-sum max budget | identity verdict |
|---|---:|---:|---|
| matmul | 2.89e-2 | 2.89e-2 | agree |
| softmax | 4.57e-3 | 4.71e-3 | agree |
| layernorm | 1.28e-2 | 2.30e-2 | agree |
| attention | 1.47e-2 | 1.47e-2 | agree |
| mlp | 3.17e-2 | 4.22e-2 | agree |
| conv2d | 2.47e-1 | 2.47e-1 | agree |

Reduction-length sweep (`y[i]=sum(j) w[i,j]`, `w: f32[N,k*C]`, C=7), identity budget fraction:
7 terms 8.13e-3; 14 terms 1.44e-2; 28 terms 9.61e-2; 56 terms 3.49e-2; 112 terms 1.35e-1; 224 terms 8.48e-2;
448 terms 1.17e-1. No rejection: a program's own f32 rounding occupies 0.5%-25% of the budget a rewrite is
judged against.

## 08-correctly-rounded.mjs: the specified order versus the correctly rounded sum

Witness `[1,0,0,0,2^-24,2^-24,2^-24]`:

| value | result |
|---|---|
| exactly rounded (BigInt, ties-to-even) | 1.000000238418579 |
| Tix specified order (sequential f32) | 1 |
| Tix `split-sum` rewrite (blocks of 4) | 1.000000238418579 = correctly rounded |
| pairwise tree | 1.000000238418579 = correctly rounded |
| origin evaluated in f64 | 1.0000001788139343 |

Random study, how often each order equals the correctly rounded sum:

| n | stream | sequential | split4 | pairwise | worst seq rel err | worst tree rel err |
|---|---|---|---:|---:|---:|---:|
| 4 | uniform[-1,1] | 268/400 | 268/400 | 268/400 | 4.4e-6 | 1.3e-6 |
| 4 | positive[0.25,1] | 290/400 | 290/400 | 332/400 | 7.4e-8 | 7.4e-8 |
| 16 | uniform[-1,1] | 144/400 | 181/400 | 192/400 | 3.2e-5 | 1.3e-5 |
| 16 | positive[0.25,1] | 177/400 | 268/400 | 304/400 | 2.0e-7 | 7.2e-8 |
| 256 | uniform[-1,1] | 40/400 | 74/400 | 126/400 | 1.7e-3 | 5.7e-5 |
| 256 | positive[0.25,1] | 43/400 | 77/400 | 280/400 | 6.8e-7 | 6.9e-8 |
| 1024 | uniform[-1,1] | 3/60 | 2/60 | 19/60 | 1.4e-5 | 2.3e-6 |
| 1024 | positive[0.25,1] | 3/60 | 7/60 | 47/60 | 1.1e-6 | 6.8e-8 |

## 04-gemm-cost: what the exact MAC costs

MAC issue rate, register-only loops, eight independent accumulators:

| form | TFLOP/s |
|---|---:|
| `fma.rn.f32` (one rounding) | 25.62 |
| `mul.rn.f32` + `add.rn.f32` (Tix's meaning) | 13.73 |
| ratio | 1.866 |

Tiled SGEMM: 128x128 block tile, 256 threads, 8x8 registers per thread, shared memory, no double
buffering. `exact` = `__fadd_rn(acc, __fmul_rn(a,b))`; `fma` = `__fmaf_rn(a,b,acc)`; `cublas` =
`cublasSgemm_v2` through dlopen.

| n | exact ms | exact TFLOP/s | fma TFLOP/s | cuBLAS TFLOP/s | exact vs cuBLAS | words differing exact/fma |
|---:|---:|---:|---:|---:|---:|---:|
| 512 | 0.0953 | 2.82 | 3.83 | 8.34 | 2.96x | 222053 / 262144 (84.7%) |
| 1024 | 0.3199 | 6.71 | 9.46 | 16.02 | 2.39x | 914461 / 1048576 (87.2%) |
| 2048 | 1.8521 | 9.28 | 13.11 | 17.39 | 1.87x | not measured |
| 4096 | 13.0731 | 10.51 | 14.70 | 17.87 | 1.70x | not measured |

Exact kernel at 76% of the two-rounding issue ceiling (10.51/13.73); fma kernel at 57% of the fma ceiling
(14.70/25.62).

## 05-check-gemm-bits.mjs: is the tiled kernel the same function?

128x128x128, dumped from the GB10 and evaluated by the Stage 1 f32 interpreter:

```
words differing: 0 of 16384      max ULP distance: 0      interpreter time 521 ms
```

## 06-fusion: schedule changes that cannot change a bit

Transcendental issue rate, 16 independent chains:

| form | evaluations/s |
|---|---:|
| `__double2float_rn(exp((double)x))` (Tix's clause) | 1.152e10 |
| `expf` | 1.403e12 |
| ratio | 122x |

Layernorm, N=4096, D=1024. Every variant produces 0 differing words.

| variant | ms | speedup | achieved GB/s (2 x N x D x 4 bytes) |
|---|---:|---:|---:|
| materialised, one kernel per statement (stage 2) | 0.5111 | 1.00x | 65.6 |
| fused, one thread per row, 3 passes | 0.7600 | 0.67x | 44.1 |
| fused, block stages 8 rows in shared, coalesced I/O | 0.1350 | 3.79x | 248.6 |

Softmax, N=4096, C=1024. Every variant produces 0 differing words.

| variant | ms | speedup | exp evaluations per row |
|---|---:|---:|---:|
| materialised (stage 2) | 0.8037 | 1.00x | 1024 |
| fused, one thread per row, exp recomputed | 2.3579 | 0.34x | 2048 |
| fused, block stages 8 rows of exp in shared | 0.6014 | 1.34x | 1024 |

## 07-exp-sweep: exhaustive sweep of the whole f32 domain

All 2^32 bit patterns, three intrinsics, two independent double formulas each, rounded once to f32:

| quantity | value |
|---|---:|
| wall time, 2^32 x 3 intrinsics x 2 forms | 2.71 s |
| time per intrinsic over the whole domain | 0.90 s |
| ns per input | 0.63 |
| `exp` words differing between formulas | 1 of 4294967296 |
| `log` words differing between formulas | 1 of 4294967296 |
| `tanh` words differing (alternative overflows for abs(x) > 355) | 1602224152 |

## Cross-checks against the coordinator's numbers

| workload | coordinator | this ticket | note |
|---|---:|---:|---|
| cuBLAS 512^3 | 8.15 TFLOP/s | 8.34 | harness agrees within 2% |
| cuBLAS 4096^3 | 19.2 TFLOP/s | 17.87 | median of 21 vs 20 samples |
| stage-2 matmul 512^3 | 0.197 ms | 0.0953 ms (exact tiled) | 2.06x from schedule alone |
| stage-2 softmax | 0.785 ms | 0.8037 ms (re-emission) | within single-run variance |
| stage-2 layernorm | 0.563 ms | 0.5111 ms (re-emission) | within single-run variance |
| streaming y=2x | 244 GB/s | 248.6 GB/s (staged layernorm) | at the streaming bound |
