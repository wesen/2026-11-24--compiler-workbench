---
Title: 'Partial report: parallel terms'
Ticket: IRWB-030-C
Status: active
Topics: [tensor, gpu, verification]
DocType: reference
Intent: long-term
---

# Partial report: parallel terms

This stage is **not complete**: the planner still fuses every legal group. There is no measured rule choosing unfused execution for unprofitable shapes, and no general never-slower claim is established. The existing legality test still decides groups from the Tix IR before emission; `fuse: false` still emits stage 2 unchanged.

A block-mode row scalar whose entire expression is a single ordinary-axis sum and whose body contains division, but no nested reduction, computes its terms across threads into a buffer, synchronizes, and folds them on thread 0 in index order. The scalar writer emits each term with the existing f32 rounding operations. The buffer participates in the shared memory limit and scratch fallback. All other expressions retain the serial implementation: in particular, sums under an outer operation, multi-axis reductions, nested reductions, split bounds, and bodies without division. This narrow rule targets expensive division; it is not a measured general cost model. Existing IR legality refusals still apply.

At the requested sizes, each value below is the median of three calls to benchmark mode, each itself the median of three event intervals after warmup. Scripts 01 and 03 and raw JSONL record the runs and output digests. Every fused and unfused digest matched. GPU tests ran concurrently with part of these measurements; untimed work does not take the timing lock, and layernorm fused calls ranged from 0.153 to 0.233 ms. Treat these as observations, not precise isolated comparisons.

| Program | Kernels fused / unfused | Fused ms | Unfused ms | Parallel terms in block kernel |
| --- | ---: | ---: | ---: | --- |
| matmul | 1 / 1 | 0.214 | 0.218 | none (thread mode) |
| softmax | 1 / 4 | 0.386 | 0.796 | none |
| layernorm | 1 / 4 | 0.195 | 0.480 | none |
| attention | 1 / 6 | 0.754 | 1.051 | none |
| mlp | 1 / 3 | 0.728 | 0.935 | none |
| conv2d | 1 / 1 | 0.165 | 0.166 | none (thread mode) |
| layernorm inside | 1 / 4 | 0.253 | 0.553 | mean, variance |
| attention inside | 1 / 5 | 1.412 | 1.499 | none; reductions belong to row-vector outputs or contain no division |

`checkLowering` compares sampled shapes and inputs to the current f32 interpreter bit for bit, with NaNs compared as a class; its sampled verdict is evidence, not a proof over all inputs. On inside layernorm, script 02 observed 3,681 ms for the first check and 6.4 ms for a repeat using cached evidence. The dedicated GPU test also checks empty extents and long rows, and the existing fusion GPU tests cover mutations and scratch behavior. Full-size equality above compares the two CUDA paths; it does not independently run the f32 interpreter at those sizes.

No framework or tool changes were made. The staged-term rule is narrower than the fixed language; other bodies are handled by the existing serial path. Missing work: a measured profitability rule, additional shapes and placement variants to justify it, and isolated reruns of the benchmarks. No reassociation, tiling, fast intrinsic, or autotuning was attempted.
