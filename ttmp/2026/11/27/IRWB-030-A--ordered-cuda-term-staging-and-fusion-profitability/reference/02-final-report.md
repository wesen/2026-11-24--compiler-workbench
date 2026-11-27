---
Title: Final report
Ticket: IRWB-030-A
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Parallel term storage and ordered folds
    - Path: repo://src/tensor/fusion.ts
      Note: Legality and profitability decisions
    - Path: repo://tests/tensor/parallel-terms-gpu.test.mjs
      Note: Exactness witnesses on the GB10
    - Path: repo://ttmp/2026/11/27/IRWB-030-A--ordered-cuda-term-staging-and-fusion-profitability/scripts/01-benchmark.mjs
      Note: Public API timings and word digests
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T01:32:44.863742783-05:00
WhatFor: ""
WhenToUse: ""
---

# Ordered CUDA terms and fusion selection

Inside-division layernorm runs in **0.221 ms fused versus 0.549 ms unfused** on the GB10. The fused kernel evaluates the divisions across the block and sums their results in order. Inside-division attention runs in **1.369 ms versus 1.523 ms** with three kernels. Keeping its first and last contractions on the element grid improves on the original one-kernel schedule. All eight measured pairs returned identical full-size f32 words.

## Full-size measurements

Each number is the median of three independent `runTixCuda(..., { benchmark: true })` calls. Each call takes the timed lock, warms up once, and returns the median of three CUDA-event intervals. Intervals cover the function's GPU kernels, excluding transfers and startup. The inputs are deterministic f32 values in [−0.1, 0.1], with seed 20 and eps = 1e−5. Kernel counts are definitions in `cudaSource`. [Benchmark driver](../scripts/01-benchmark.mjs) · [Raw timings and digests](../scripts/01-benchmark.jsonl) · [Selected inside attention](../scripts/01-attention-inside-selected.jsonl)

| Program and sizes | Kernels fused / unfused | GPU ms fused / unfused | Block-mode kernel and parallel terms |
| --- | ---: | ---: | --- |
| Matmul, M = K = N = 512 | 1 / 1 | 0.218 / 0.214 | Thread mode |
| Softmax, N = 4096, C = 1024 | 1 / 4 | 0.386 / 0.788 | k0 `m,e,s,y`, none |
| Layernorm outside, N = 4096, D = 1024 | 1 / 4 | 0.162 / 0.483 | k0 `mean,centered,variance,y`, none |
| Layernorm inside, same sizes | 1 / 4 | 0.221 / 0.549 | k0 `mean,centered,variance,y`, the `mean` and `variance` sums |
| Attention outside, Q = K = 1024, D = V = 64 | 1 / 6 | 0.753 / 1.050 | k0 `score,shift,e,z,weight,out`, none |
| Attention inside, same sizes | 3 / 5 | 1.369 / 1.523 | k1 `shift,e,z`, none |
| MLP, N = 1024, D = 256, H = 1024, O = 256 | 1 / 3 | 0.726 / 0.943 | k0 `h,g,y`, none |
| Conv2d, N = 8, C = 16, H = W = 64, O = 32, 3 × 3 | 1 / 1 | 0.166 / 0.166 | Thread mode |

Matmul and conv2d each emitted identical source in both modes. Matmul's 1.9% difference is within the supplied between-call variation for identical source. The slow observations in some of the raw timing triples, including inside attention, exceeded that usual variation. The inside variants are compiled and compared independently to their own unfused source. Their timings are the evidence at the listed sizes. The full-size comparison is GPU to GPU, and the independent interpreter comparison uses the contract's smaller cases.

The staged inside layernorm time was 2.6× lower than the supplied Stage 3 timing of 0.569 ms. That comparison spans sessions. The staged kernel takes about 1.6× the supplied 0.14 ms time for one read and one write. Outside layernorm uses cheap scalar folds and takes about 1.2× that time. The softmax path retains the existing exactly rounded `exp`.

## What is staged

The planner selects an outermost reduction in a row-scalar statement when it has one ordinary extent binder, a reduction-free body and a division, square root or double transcendental whose operands depend on that binder. Dependence is detected from resolved binder identities in affine references. Shape values, literal values and loads depending only on the row axes are invariant within the fold. Cheap bodies retain the serial path to avoid a second trip through a buffer and an extra barrier.

Each lane writes the terms at its own strided indices using the scalar emitter's explicit f32 rounding. Every lane reaches the barrier before thread 0 reads the terms in increasing index order with the same initial value and fold instruction. A reusable buffer is sized for the longest staged reduction in the group. It extends the block's shared row storage, or its global scratch slice when the shared limit is exceeded. A barrier separates successive users in the same statement. The ordinary statement barrier covers reuse by the next statement. Empty loops still produce the sum or max identity. Because Tix expressions have no side effects and all reads address inputs or completed statements, moving an independent term calculation across lanes changes neither the values it reads nor the operations it performs. This is the preservation argument. The GB10 tests separately exercise an order-sensitive half-ULP witness, multiple reductions sharing the buffer, generated NaNs, empty bounds and a wide row using scratch. [Emitter](../../../../../../src/tensor/cuda-source.ts) · [GPU tests](../../../../../../tests/tensor/parallel-terms-gpu.test.mjs)

Multiaxis, nested and generated split reductions retain their scalar loop structure. They would need indexing and staging machinery for multiple scopes or dependent bounds. Per-element contractions already have separate threads per output, and sharing those threads across terms would put that parallelism at risk. Max uses the existing exact fused max helper and keeps fold order. Thread-mode groups, including elementwise epilogues, keep stage 2's element mapping.

## What is fused

Every candidate join first passes Stage 3's dependence and affine-prefix legality rule. The CUDA planner then refuses three kinds of legal block joins. A refusal closes the current group, and the rejected statement can start a new one. There is no shape-name allowlist, launch-time threshold or timed search. Source inspection, execution and checking all use the same selected groups. [Planner](../../../../../../src/tensor/fusion.ts)

| Refused join | Measurement behind it |
| --- | --- |
| Block mapping for groups containing only elementwise work | The two-statement wide stencil at [1,32768] ran in 0.122 ms fused versus 0.0066 ms unfused. With [24,4096] it took 0.0105 versus 0.0066 ms. One block per row limits the independent work, and the widest row uses scratch. |
| Block mapping for a costly row-scalar reduction that cannot stage terms | A nested divided sum at [N,C,K] = [1024,512,64] took 2.780 versus 1.386 ms. At [4096,512,64] it took 10.118 versus 1.406 ms. The block mapping spends many blocks on one active fold thread apiece. |
| Block mapping for a costly reduction at every trailing-axis element | Inside attention's original full fusion took 0.274 versus 0.255 ms at Q = 1 with K = 1024 and D = V = 64. Keeping both contractions separate and fusing the middle measured about 0.200 ms at Q = 1 and 1.35 ms at Q = 1024 in the split probe. The public API rerun at Q = 1024 is in the full-size table. |

A head-only attention split took about 0.200 ms at Q = 1 and 1.74 ms at Q = 1024. A tail-only split had much higher between-run variation, including 0.276–0.724 ms at Q = 1. The three-kernel schedule keeps the measured low-query benefit and improves the measured full-size median. The rule leaves some opportunities unused. The refused stencil took 0.0105 ms fused versus 0.0135 ms unfused at [96,4096], and the nested-fold probe was faster fused at N = 32 and N = 256. Also, a softmax sweep was faster fused even at [1,32768], so blanket fallbacks for low grid size or scratch would have discarded those wins. The static policy addresses observed regressions and preserves the corpus gains. It is a heuristic for symbolic functions and does not establish a universal timing bound. [Softmax sweep](../scripts/02-crossover.jsonl) · [Risk probe](../scripts/03-risk.jsonl) · [Attention split probe](../scripts/05-attention-split.jsonl)

The legality planner still refuses horizontal joins, joins requiring another block's row and joins without a common leading extent. Current-revision IR drives both legality and profitability. `fuse: false` uses the original stage-2 emitter. Its byte digests pass for the original corpus and for the inline-plus-split variants.

## Contract and implementation boundary

The lowering transformation still checks a Tix revision and its generated CUDA artifact using the exact differential invariant. It compares output shapes, lengths and every f32 output word, including signed zeros and infinities, and treats NaNs as a class. The recipe covers distinct shape bindings, empty extents and several deterministic streams. The checker judges sampled result preservation. GPU speed is measured separately. A cold process-local check batches the undecided cases in one untimed CUDA call. A repeat reuses evidence and requires no remote execution. Cold here refers to process-local evidence. Remote binary-cache state was uncontrolled.

| Program | Cases | Cold wall s | Repeated wall ms |
| --- | ---: | ---: | ---: |
| Matmul | 36 | 3.823 | 1.85 |
| Softmax | 32 | 3.843 | 3.46 |
| Layernorm outside | 32 | 3.677 | 4.22 |
| Layernorm inside | 32 | 3.673 | 1.73 |
| Attention outside | 40 | 3.950 | 2.09 |
| Attention inside | 40 | 3.985 | 2.78 |
| MLP | 40 | 3.554 | 8.56 |
| Conv2d | 28 | 4.737 | 5.74 |

All eight accepted as `exact`. Batch wall time was 3.49–3.97 s, including runner transit and execution. The remaining cold cost includes preparing and interpreting cases, constructing the artifact and checking the results. `src/framework/` required zero changes. Its existing typed transformation and differential batching represent the selected lowering, and the statements-to-kernels record reflects its final groups. `tools/cuda-remote.mjs` also required zero changes because the base public API already exposes the timed path and the checker already uses the runner untimed. [Contract driver and raw records](../scripts/04-contract.mjs) · [Selected contract timings](../scripts/04-contract-selected.jsonl)

## Verification

The implementation is commit `efed179`. The TypeScript build, 31 CPU tensor tests and 17 GPU tensor tests passed. The GPU test files exercise original and optimized corpus revisions, affine and shadowed binders, both empty and oversized rows, exactness mutations, and the timed runner. The full repository suite was outside this stage's test scope.
