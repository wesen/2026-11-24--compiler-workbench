# E1: matmul kernel variants on GB10 (timed run, 2026-11-26)

Median of 10 CUDA-event-timed runs, M=K=N=512, seeded uniform inputs in [-1,1].
Baseline `k0` is the Stage 2 emitted kernel embedded verbatim (probe `scripts/gpu/e1-matmul/main.cu`).

| kernel | median ms | TFLOP/s | bit mismatches vs k0 | max abs err vs f64 ref | max err / max(1,|r|) | max err / sum|terms| |
|---|---:|---:|---:|---:|---:|---:|
| k0 (stage 2, one thread per output) | 0.2141 | 1.3 | 0 | 3.787e-05 | 1.407e-05 | 2.858e-07 |
| k_tiled (16x16 shared tiles, k ascending) | 0.1232 | 2.2 | **0** | 3.787e-05 | 1.407e-05 | 2.858e-07 |
| k_reg4 (16x16 tile, 2x2 register accumulators) | 0.0863 | 3.1 | **0** | 3.787e-05 | 1.407e-05 | 2.858e-07 |
| k_splitk (8-way split-K + ordered combine) | 0.1959 | 1.4 | 243,569 | 7.367e-06 | 5.591e-06 | 5.731e-08 |
| k_kahan (compensated, certificate cost probe) | 0.2173 | 1.2 | 242,765 | 1.797e-06 | 1.124e-06 | 1.359e-08 |
| k_f64 (double shadow accumulation) | 2.7323 | 0.1 | 242,948 | 1.442e-06 | 5.957e-08 | 1.175e-08 |

Reference points: coordinator cuBLAS SGEMM (FP32, no TF32) at 512^3: 0.0329 ms (8.15 TFLOP/s).
Worst-case gamma_511 * sum|terms| bound max over elements: 4.622e-03 (about 16,000x the observed k0 error).

Findings:
1. Shared-memory tiling and 2x2 register blocking are BIT-IDENTICAL to the Stage 2 kernel
   (0/262,144 mismatched words each): they change memory layout and ILP, not the reduction
   order or any rounding site. 2.5x speedup with an exact gate, no error budget spent.
2. k_reg4 reaches 3.1 TFLOP/s vs cuBLAS 8.15; the remaining gap needs tensor cores
   (different internal arithmetic) or split-K (reassociation) — both are budget-spending moves.
3. The 8-way split-K reassociation is *more accurate* than the sequential order at this size
   (max rel-scaled error 5.6e-6 vs 1.4e-5), consistent with blocked-summation error theory
   (~(B+S)u vs (K)u per element), but it is not bit-identical, so it must be judged by a
   tolerance relation, not the exact gate.
4. Kahan compensation costs +1.5% on this latency-bound kernel (timed medians 0.2173 vs 0.2141 ms); f64 shadow costs 12.9x.
   A Kahan-style per-element runtime certificate is cheap here; an f64 shadow is not.
5. The sequential f32 error itself (1.4e-5 rel-scaled) consumes ~70% of the Stage 1
   tolerance (2e-5) at K=512 before any optimization acts.
