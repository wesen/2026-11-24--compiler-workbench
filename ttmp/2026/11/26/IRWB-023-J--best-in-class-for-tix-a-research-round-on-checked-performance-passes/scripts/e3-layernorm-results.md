# E3/E3b: fused layernorm vs Stage 2 lowering on GB10 (timed, 2026-11-26)

N=4096, D=1024, seeded LCG inputs (x in [-1,1], gamma in [-0.5,1.5], beta in [-0.5,0.5], eps=1e-5).
Baseline: Stage 2 emitted kernels k0..k3 embedded verbatim, one event interval around the
launch sequence. Candidate: one 256-thread block per row, 4 sequential elements per thread,
fixed shared-memory reduction tree (stride 128,64,...,1), identical pointwise rounding sites.
Median of 10 event-timed runs after 3 warmups, under the --timed GPU lock.

| variant | median ms | effective GB/s | bit mismatches vs stage-2 | budget fraction vs f64 |
|---|---:|---:|---:|---:|
| Stage 2 (4 kernels, ~100.7 MB moved) | 0.4792 | 210.1 | 0 | 0.572 |
| Fused (1 kernel, 33.6 MB moved) | 0.1395 | **240.6** | 2,479,451 / 4,194,304 | **0.135** |
| Fused + Kahan folds (certificate probe) | 0.1403 | 239.1 | 107,881 vs plain fused | (see E1 note) |

Roofline reference: streaming y=2x measured at 244 GB/s. The fused kernel runs at 98.6%
of that bandwidth; its speedup is 3.44x and it is bounded by memory, not arithmetic.

E3b cross-check through the product meaning (rows 0..3, interpreter on this host):
- interpreter f32 (sequential meaning) vs f64: budget fraction 0.276 at [row0, col 338]
- Stage 2 GPU output vs interpreter f64: same 0.27610882186469043 at the same coordinate,
  and 0/4096 bit mismatches vs the interpreter f32 - the lowering is bit-exact on these inputs.
- Fused output vs interpreter f64: budget fraction 0.070 - 4x MORE ACCURATE than the
  sequential meaning while 3.44x faster.

Findings:
1. Fusion with a fixed deterministic tree is the big win for the bandwidth-bound corpus:
   3.4x, and the kernel lands on the memory roofline. The reassociated tree is not
   bit-identical (59% of words differ), so this is tolerance-gated work.
2. Re-blocking IMPROVED accuracy 4x (0.57 -> 0.135 budget fraction): blocked summation
   error bounds (~ (B+T)u vs (K)u) are visible at corpus scale. A tolerance contract that
   only caps error is leaving this on the table: the checker should be able to REWARD
   accuracy improvements, not just permit changes.
3. The Stage 2 sequential meaning itself consumes 57% of the current tolerance at full
   size on random input: the origin is close to the budget, before any optimization acts.
4. Kahan-compensated folds cost +0.6% on this memory-bound kernel (vs +3% on the
   latency-bound matmul in E1): a compensated shadow can ride along nearly for free.
