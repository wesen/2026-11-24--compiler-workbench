---
Title: Stage 6 final report
Ticket: IRWB-033-A
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Synchronous correspondence check at the native pass boundary
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Exact differential and heterogeneous correspondences
    - Path: repo://src/tensor/cuda-source.ts
      Note: CUDA printer for shared tiles and phase dispatch
    - Path: repo://src/tensor/schedule.ts
      Note: Schedule IR, legality, and shape policy
ExternalSources:
    - https://arxiv.org/html/2609.11356v1
Summary: Exact ordered CUDA tiles through a checked v6 schedule IR, with GB10 timings and retained row fusion.
LastUpdated: 0001-01-01T00:00:00Z
WhatFor: ""
WhenToUse: ""
---

# Stage 6 final report

Tix lowers through a v6 `tensor.schedule` artifact. A tiled output still starts at positive zero and visits the same terms with a rounded multiply and a rounded add. Layout changes give independent outputs the ability to reuse both operands. The existing row lowering remains a selectable schedule. The tiled boundary path keeps the attention normalization in one row kernel and computes MLP's first contraction and GELU in one register epilogue.

## Compiler structure

The schedule stores the selected Tix function, ordered kernel groups, statement membership, row reads, and the seed launch and storage choices. The existing fusion planner supplies the seed because it already accounts for dependence depth, row buffers, in-place overwrites, staged terms, and the measured row gate. Recreating those decisions as new rewrites would duplicate that analysis. A v6 adapter exposes the function, groups and member statement entities with containment links. Recognition and mapping change statement entities. Phasing changes a group entity. Each changed revision has correspondence entries for the same function, groups and logical statements.

| v6 pass | Eligibility and checked change |
| --- | --- |
| `tensor.recognize-contractions` | Find one outer sum over ordinary rectangular extents whose body is a product of loads. Partition the output axes according to which operand uses them. Keep the operands in source order. The checker matches each recorded reduction and operand map to the unchanged expression. |
| `tensor.map-contractions` | Map the leading contraction in an element-mapped group. Subsequent same-element statements keep their existing dependence and become a register epilogue. The checker preserves the recognized domains, checks the lane and register tile geometry and shared-memory budget, and requires the original fusion layout. |
| `tensor.partition-contractions` | For a one-prefix-axis row group with rank-two contractions at both boundaries, add an alternative ordered sequence of phases. Keep a same-element prefix inside the first tile when possible, use the fusion planner for intervening statements, and materialize each value read across a phase boundary. The checker reconstructs the legal phases and compares the sequence, maps and boundary storage. The original row and scalar branches stay in the artifact. |

A block owns 32 rows × 64 columns with 128 threads. Each thread has a 4 × 4 register patch. The two half-warps address distinct rows across 16 contiguous output columns. The K stripe is 16. A shared tile is transposed and padded for cooperative loads. The other tile uses the column-first or term-first load order from the schedule according to the last operand index. Term-first loading uses a padded shared stride to avoid a stride-length bank conflict. Convolution stores the original filter as the row operand and folds the batch and spatial output axes into the column coordinate. Its address expressions directly read the input image. It retains the source operand order and the lexicographic `c,dy,dx` reduction. The full-tile specialization removes bounds tests when all three dimensions divide their tile sizes. The guarded version predicates loads and stores and skips padded terms in the final stripe.

The synchronous strategy runs recognition, mapping and partitioning in order. It uses one shape predicate per tile, requiring one complete output tile in each direction, K at least one stripe, and at least one block for each of the GB10's 48 SMs. A partition must have an eligible tile phase with at least 1024 × 1024 × 64 terms, the smallest measured corpus phase that paid for the launches and materialization. It also checks available GPU bytes for its additional buffers and scratch. A selected partition can use scalar mapping for another phase that falls below the standalone tile threshold. Its stream launch order supplies visibility across phases. The group still counts as one `__global__` definition. Its CUDA templates choose the implementation of each launch.

The async strategy interpreter in `src/framework/strategy` cannot run inside the synchronous `cudaSource` entry point. A short typed sequence using `applyNativePassSync` covers this pipeline. The existing heterogeneous transformation API was sufficient for Tix → Schedule and Schedule → CUDA. In `checkLowering` those transactions enumerate and validate their entity correspondences, with the final exact invariant still comparing to the original Tix revision passed for lowering. The sole framework edit gives the synchronous native gate the already checked `EntityCorrespondence` for the exact input/output pair. This lets a synchronous check inspect revision and statement identity before the new revision is accepted. No runner change was needed. The existing `--timed` lock and `benchmark` option serve the public API and the measurement scripts.

## Exactness

A coordinate within a block tile decomposes into its thread residue and register quotient, independently on both output axes. This makes accumulator ownership unique. In a K stripe beginning at sT, the emitted loop visits the half-open interval [sT, min((s+1)T,K)). The intervals concatenate to [0,K); mixed-radix decoding visits the original rectangular reduction tuple in lexicographic order. Shared loads change movement of words, and the register patch interleaves independent output operations. The f32 word entering each addition is still the result of `__fmul_rn` at that term. The accumulator advances by `__fadd_rn` and only one thread owns it. The argument includes empty and single-term axes and excludes padded terms. Schedule checks pin the semantic operands and this geometry. They do not prove the emitted address arithmetic, barrier implementation, CUDA intrinsics, or generated host launches.

The exact differential runs the emitted program against the current f32 meaning, with signed zeros and infinities compared exactly and NaNs compared as a class. It forces the tiled and scalar sides for standalone tiled groups, both stage 3b sides for ordinary row groups, and also the phased side for groups with alternate phases. The baseline key records the available sides. Each side batches the same recipe of small asymmetric shapes and values, including empty extents. The focused GPU tests exercise both guarded and aligned tiles, a transposed batched product with a fused epilogue, and the base tests cover staged folds, scratch rows, direct returns and optimized input IR. Contract cost is reported below.

The paper's bit-equivalence classes motivate fixing arithmetic before comparing layouts. Its verification works on compiled PTX and GCN signatures. This implementation uses a narrower schedule-level argument and retains execution evidence about code generation. [Yang, Riasanovsky, Deng and Sarkar](https://arxiv.org/html/2609.11356v1)

## Experiments and refusals

- On 512³, shared-memory tiling with one output per thread took 0.1991 ms. A 4 × 4 register patch improved it to 0.0885 ms with aligned tiles and 0.0987 ms with guarded tiles. Reducing the tile's row count on that shape took 0.1090 ms. The probe verified the same output hash across all four. [Layout probe](../scripts/03-layout-probe.jsonl)
- The one-block-per-row register patch was slower in the initial smoke runs, and its attention output failed the digest comparison. That candidate was discarded. The first boundary-phase schedule kept the row computation, used the standalone tiles at both boundaries, and measured about 0.350 ms for attention and 0.457 ms for MLP in untimed smoke calls. Keeping MLP's h and GELU together then removed one launch and one materialized tensor. The rejected working-tree candidate was removed before the implementation checkpoint. [Diary](01-implementation-diary.md)
- The 1024 × 64 × 1024 product took about 0.1355 ms in the aligned tile and about 0.094 ms on scalar mapping. Smaller register tiles and shared-only variants also lost. All measured grids of 32 or fewer blocks lost to scalar. At the 48-block boundary, the 384 × 256 × 512 product improved from 0.07466 to 0.06966 ms. Both tested 64-block layouts improved by over 20%. This supports the one-wave rule and the scalar value phase in attention. These are measurements of crossover points, with no universal performance guarantee for every accepted program and shape. [Crossover](../scripts/06-crossover.jsonl), [narrow layouts](../scripts/09-narrow-tiles.jsonl), [wave boundary](../scripts/10-boundary.jsonl)
- Nested or already split reductions, non-product terms and contractions without both reuse directions retain their seed schedule. The checked input may itself contain a split reduction. Its own arithmetic tree is preserved. Independent vector loads and double buffering were left out because they need additional address and tail machinery. No measured search runs in the compiler.

## Measurements

Whole-program timings use the shapes in the brief and deterministic seed-20 inputs. Each side runs five calls, interleaved with the other sides. Each call reports the median of three CUDA-event intervals after a warm-up under the remote timing lock. The Stage 2 source digests match, so the measured unfused series serves both revisions. Every whole-program comparison matched the base output SHA-256. Differences below 5% are noise. Script 05 evidence uses the same emitted mapping for matmul, convolution, softmax and layernorm as the final selector. Script 11 repeats attention and MLP after the per-phase grid rule was added. [Whole-program runs](../scripts/05-corpus-timings.jsonl), [final group runs](../scripts/11-final-group-timings.jsonl)

The phase timings use a diagnostic source with an event pair around each launch and the same three-interval and five-call medians. Attention score includes the scale. The first fused MLP phase includes GELU and bias, and the second includes its output bias. The first unfused MLP measurement covers h and bias, with GELU timed separately. Rates use only the contraction's `2 M N K` operations, so the MLP first phase reports achieved contraction rate including the epilogue time. The ratio is time divided by the supplied cuBLAS time. The 4096³ reference is derived from the supplied 19.2 TFLOP/s. Its FMA arithmetic differs from Tix's separate rounded instructions. [Final phase runs](../scripts/12-final-phases.jsonl)

| Contraction | Schedule selected at the specified shape |
| --- | --- |
| Matmul at both sizes | Aligned 32 × 64 × 16 tile, column-first B loads and 4 × 4 accumulators per thread. Both output axes tile evenly and give at least one full wave. |
| Attention score | Aligned tile with term-first key loads and padded shared strides for the transposed access. The score phase supplies enough work to pay for the row phase boundary. |
| Attention value | Scalar 256-thread blocks in the phased branch. A 32 × 64 tile would yield only 32 blocks and the forced tile was slower. |
| MLP h and y | Aligned tiles with column-first weights. The first tile keeps each h in a register across GELU. Both contractions independently clear the grid threshold. |
| Convolution | Guarded tile across output channels and flattened batch/spatial coordinates. The bounds guard handles the 32-column final output tile and the term decoder preserves channel, kernel-row and kernel-column order. |

The 4096³ clock probe sampled 2411 MHz throughout its timed tiled call and 2398–2411 MHz in the scalar call. GPU temperature during those observations was 43 °C tiled and 42–50 °C scalar. These samples came from separate instrumented calls. The corpus runs include one 4096³ iteration with a 163.2 ms base sample and a 28.5 ms tiled sample. The five-call median protocol is used as specified. [Clock observations](../scripts/08-phase-timings.jsonl)

| Program | Base fused ms | Stage 6 fused ms | Base and Stage 6 unfused ms | Definitions fused / unfused | Fused launches |
| --- | ---: | ---: | ---: | ---: | ---: |
| Matmul 512³ | 0.21402 | 0.08848 | 0.21315 | 1 / 1 | 1 |
| Matmul 4096³ | 134.608 | 25.228 | 133.825 | 1 / 1 | 1 |
| Softmax | 0.38624 | 0.38730 | 0.81296 | 1 / 4 | 1 |
| Layernorm | 0.16870 | 0.16787 | 0.47658 | 1 / 4 | 1 |
| Attention | 0.74899 | 0.23158 | 1.050 | 1 / 6 | 3 |
| MLP | 0.62704 | 0.29517 | 0.95075 | 1 / 3 | 2 |
| Convolution | 0.16512 | 0.12528 | 0.16541 | 1 / 1 | 1 |

| Contraction | Fused ms | Unfused ms | Fused TFLOP/s | Unfused TFLOP/s | Time / cuBLAS fused / unfused |
| --- | ---: | ---: | ---: | ---: | ---: |
| Matmul 512³ | 0.08848 | 0.21315 | 3.03 | 1.26 | 2.69× / 6.48× |
| Matmul 4096³ | 25.228 | 133.825 | 5.45 | 1.03 | 3.52× / 18.70× |
| Attention score and scale | 0.03328 | 0.61878 | 4.03 | 0.22 | 1.88× / 34.96× |
| Attention value | 0.09725 | 0.09526 | 1.38 | 1.41 | 4.50× / 4.41× |
| MLP h and fused GELU | 0.14246 | 0.47018 | 3.77 | 1.14 | 3.37× / 11.12× |
| MLP y and bias | 0.15459 | 0.38006 | 3.47 | 1.41 | 3.25× / 8.00× |
| Convolution | 0.12528 | 0.16541 | 2.26 | 1.71 | — |

| Program | GPU batches | Schedule and emit ms | First check ms | Repeat check ms |
| --- | ---: | ---: | ---: | ---: |
| matmul | 2 | 88.4 | 6514.3 | 291.9 |
| softmax | 2 | 30.4 | 6220.7 | 287.7 |
| layernorm | 2 | 9.4 | 6949.6 | 358.5 |
| attention | 3 | 92.8 | 7975.6 | 622.1 |
| mlp | 3 | 17.4 | 6302.2 | 499.2 |
| conv2d | 2 | 8.4 | 10226.4 | 7113.7 |

The first-check and repeat columns are wall times in a new Node process with the existing GPU binary cache. The repeat replays the accepted GPU verdicts. The framework still rebuilds and fingerprints the sample recipe to verify its baseline key. Convolution's interpreter screening dominates that repeat. Schedule and emit time includes immutable artifact construction, revision diffs and the static checks. [Contract timing data](../scripts/13-contract-cost.jsonl)

The corpus medians improve for both matmuls, attention, MLP and convolution. Softmax and layernorm stay within the supplied 5% noise band. Attention's value phase also stays within that band. The 4096³ tile reaches 5.45 TFLOP/s, about 38% of the supplied separate-multiply-and-add issue ceiling.

## Evidence boundaries

The hashes compare GPU words across schedule choices at the measured workload sizes. The f32 interpreter checks smaller samples, including irregular extents and the supplied optimization and mutation witnesses. The schedule-level order argument applies to the recognized domains at arbitrary consistent dimensions that fit the target. Claims about barriers and generated address arithmetic depend on code review and the GPU checks. The crossover timings establish the tested shape rule, with performance at other accepted shapes remaining empirical.

## Validation

`npm run build` passed. The CPU-only tensor invocation passed all 43 tests. The serial GB10 invocation passed all 23 tests, including both existing fusion sides, the third phased side, forced tiles, signed and empty cases, and schedule and CUDA mutations. An earlier concurrent run hit five SSH connection resets. All five affected tests passed in the serial run. [Diary and replay commands](01-implementation-diary.md)
