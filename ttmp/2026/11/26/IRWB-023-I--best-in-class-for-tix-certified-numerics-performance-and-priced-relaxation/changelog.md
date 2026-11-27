# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Research round complete: defined certified throughput as the best-in-class criterion; measured exact-tier prototype kernels on the GB10 (matmul 2.8x, softmax 2.0x, layernorm 2.8x, attention 1.26x, all bit-exact at production size); quantified budget-tier relaxations (expf 3x at 0.17% of budget; FMA exceeds the stage-2 budget on 0.12% of matmul outputs); proved-order-free max reductions (100k tree evaluations, 0 mismatches); refuted two of my own hypotheses (size-cap error growth; tree-sum value) with measurements.

## 2026-11-26

Added E5b: working certificate-checker prototype for the inline substitute class; holds on all six corpus candidates in <=0.54 ms; accepts the correct control and rejects both structural mutants.
