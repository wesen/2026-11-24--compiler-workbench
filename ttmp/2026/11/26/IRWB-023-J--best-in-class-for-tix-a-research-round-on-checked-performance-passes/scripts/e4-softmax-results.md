# E4: fused softmax vs Stage 2 lowering on GB10 (timed, 2026-11-26)

N=4096, C=1024, logits uniform in +/-20. Stage 2 kernels k0..k3 embedded verbatim.
Candidate: one 256-thread block per row; per-thread max/exp/sum over 4 elements, fixed
shared-memory trees for the row max and the row sum. Median of 10 event-timed runs.

| variant | median ms | speedup | budget fraction vs f64 |
|---|---:|---:|---:|
| Stage 2 (4 kernels, max/exp/sum/divide) | 0.8308 | 1x | 0.0233 |
| Fused (1 kernel, same trees) | 0.3865 | 2.15x | 0.0027 |

Claims tested:
(a) The parallel max reduction tree, built from the same minmax operation as the
    sequential fold (NaN propagation, mixed zeros -> +0), is BIT-IDENTICAL to the
    Stage 2 sequential row max on all 4096 rows: 0 mismatches. The row-max
    parallelization therefore needs no error budget at all: it belongs under the exact gate.
(b) The sum tree is not bit-identical (3,929,330 / 4,194,304 words differ), and the
    fused kernel consumes 9x LESS error budget than Stage 2 (0.0027 vs 0.0233).

Notes:
- The speedup is 2.15x, not the ~3.4x of layernorm, because the fused softmax is bound
  by the 4.2M double-precision exp() calls, not by bandwidth (33.6 MB moved at 244 GB/s
  would be 0.138 ms; measured 0.387 ms). The double transcendental path that preserves
  the exactly-specified meaning costs a real multiple here - the intrinsic-vs-meaning
  tradeoff is measurable, not hypothetical.
