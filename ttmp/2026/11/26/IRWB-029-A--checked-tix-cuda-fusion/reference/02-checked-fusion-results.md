---
Title: Checked fusion results
Ticket: IRWB-029-A
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-029-A--checked-tix-cuda-fusion/scripts/01-benchmark.mjs
      Note: Paired CUDA event and digest measurements
    - Path: repo://ttmp/2026/11/26/IRWB-029-A--checked-tix-cuda-fusion/scripts/03-traffic-count.mjs
      Note: Static per-kernel traffic counts
ExternalSources: []
Summary: Exact CUDA fusion, GB10 timings and per-kernel global traffic for the six Tix corpus programs.
LastUpdated: 2026-11-26T23:11:17.566723631-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion results

Fusion reduced the six programs from 19 to 8 kernel definitions in aggregate. On the GB10, softmax ran 2.14× faster, layernorm 2.74× faster, attention 1.36× faster and MLP 1.09× faster in the paired benchmark. All six pairs produced identical output shapes and SHA-256 digests of the f32 result bytes.

## Placement and legality

The lowering planner reads the current Tix IR and chooses contiguous, single-result groups. A private tensor must be used within its group and have no remaining consumer outside. The flat mapping requires equal symbolic shapes and identity-coordinate reads outside the consumers' folds. A lane computes each producer once, keeps its rounded f32 result in a local, and reuses it even for multiple GELU operands. This applies to elementwise chains and contractions with elementwise epilogues.

The row mapping requires rank-one and rank-two statements with a common leading dimension and a common width for their rank-two results. Every internal read stays within the block's assigned row. Two warps cooperate on row loads, pointwise work and stores, while lane zero evaluates rank-one expressions. The block's barriers order shared or device-backed scratch accesses so that each load sees the same producer value as it would after an unfused launch. Scratch size is computed from concrete dimensions, and rows spill to device storage if their footprint exceeds the device's default per-block shared-memory limit. The same kernel definition handles both storage paths. A block can advance to another row after a barrier if the grid limit requires it.

In both mappings the scalar tree keeps its literal conversions, arithmetic rounding and sequential loop nest. A fused row maximum uses the NaN-propagating PTX maximum for one fold step, preserving +0 over −0, infinities, subnormals and the NaN class. The maximum starts at −∞ and sum at +0 even for zero-length folds. Proof of group equivalence follows in statement order. Identity reads in the flat mapping and same-row reads between barriers in the row mapping see the induction hypothesis, and each fold sees its original sequence of operands. This argument is about the schedule. The differential check supplies sampled execution evidence.

| Program | Groups and boundaries |
| --- | --- |
| matmul | One source statement, `y`. |
| softmax | One row block stages `x`, then computes `m → e → s → y`. |
| layernorm | One row block stages `x`, then computes `mean → centered → variance → y`. |
| attention | `score → shift → e → z → weight` share a row block. The `out` contraction remains a separate kernel. Its output column is V and its input column is K, which the IR treats as distinct. Fusing across that edge requires proving and scheduling a K-wide private panel consumed by a V-wide contraction. |
| mlp | `h → g` share one element thread. `h` already includes the first bias, and the output bias already belongs to `y`. The `g → y` load is inside a contraction with a different output shape and would need a new layout or repeated reduction work. |
| conv2d | One source statement, `out`. |

Other declined candidates include a square transpose across thread or row ownership, a producer that remains externally live, and a producer separated by a statement that prevents a contiguous single-result group. A same-row affine column read can use scratch once the planner proves row ownership. Equal concrete sizes alone do not establish common ownership. Reassociation, tiling, FMA, tensor cores, streaming attention and autotuning were outside this stage.

Fusion belongs in the CUDA emitter, with its planning step separate from text generation. The existing Tix artifact stays the meaning reference, and the existing CUDA text artifact identifies the executable candidate. The framework's generic correspondence represents many-to-one entries. A CUDA text artifact supplies no projected kernel entities for such entries. The ordered statement membership is recorded in the schedule and CUDA comments, where the reduction in kernel count can be inspected. A separate versioned kernel artifact would earn its validator and projection when multiple kernel-level transformations need that information.

**Framework changes:** none. The heterogeneous transformation already binds a Tix baseline to a CUDA artifact and awaits its exact postcondition. **Remote tool changes:** none. The public runner now forwards `benchmark` to the existing CUDA batch runner, which uses `--timed` and passes `--benchmark` to the executable. The three public CUDA entry points select fusion by default and accept `fuse: false` for the per-statement lowering.

## GB10 measurements

The benchmark reset seed 20 for each program and supplied the same f32 inputs in both modes, uniform in [−0.1, 0.1] with layernorm epsilon set to 1e−5. Counts come from emitted `__global__` definitions. Each mode used one warmup and the median of three CUDA-event intervals under the timed lock. Allocation, transfer, compilation and startup are outside the interval. Timed users serialize, and untimed jobs on the shared GB10 can overlap.

| Program and shape bindings | Unfused kernels | Unfused ms | Fused kernels | Fused ms |
| --- | ---: | ---: | ---: | ---: |
| matmul, M = K = N = 512 | 1 | 0.217408 | 1 | 0.217472 |
| softmax, N = 4096, C = 1024 | 4 | 0.796736 | 1 | 0.373152 |
| layernorm, N = 4096, D = 1024 | 4 | 0.463968 | 1 | 0.169536 |
| attention, Q = K = 1024, D = V = 64 | 6 | 1.053728 | 2 | 0.775360 |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 3 | 0.931008 | 2 | 0.855392 |
| conv2d, N = 8, C = 16, H = W = 64, O = 32, filter 3 × 3 | 1 | 0.165344 | 1 | 0.167328 |

[Benchmark script](../scripts/01-benchmark.mjs) · [Raw measurements and output digests](benchmark-results.jsonl) · [Row-kernel experiments](01-implementation-diary.md)

## Per-kernel traffic estimates

Read references count four bytes per scheduled global f32 load after trivial same-address reuse within a scalar expression, such as `centered[i,j] * centered[i,j]`. Distinct reads count four bytes per distinct global input address touched by that kernel. Writes count four bytes per output element. The two time columns divide the respective reads plus writes by 244 GB/s. These are analytic streaming equivalents. Actual DRAM traffic depends on reuse, caches, transactions and code generation. The estimates exclude transfers and shared traffic, and use the shared path for all measured rows.

| Program | Mode | Kernel | Read bytes | Distinct read bytes | Write bytes | All refs ms | Distinct ms |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| matmul | unfused | y | 1073741824 | 2097152 | 1048576 | 4.40488 | 0.01289 |
| matmul | fused | y | 1073741824 | 2097152 | 1048576 | 4.40488 | 0.01289 |
| softmax | unfused | m | 16777216 | 16777216 | 16384 | 0.06883 | 0.06883 |
| softmax | unfused | e | 33554432 | 16793600 | 16777216 | 0.20628 | 0.13759 |
| softmax | unfused | s | 16777216 | 16777216 | 16384 | 0.06883 | 0.06883 |
| softmax | unfused | y | 33554432 | 16793600 | 16777216 | 0.20628 | 0.13759 |
| softmax | fused | m,e,s,y | 16777216 | 16777216 | 16777216 | 0.13752 | 0.13752 |
| layernorm | unfused | mean | 16777216 | 16777216 | 16384 | 0.06883 | 0.06883 |
| layernorm | unfused | centered | 33554432 | 16793600 | 16777216 | 0.20628 | 0.13759 |
| layernorm | unfused | variance | 16777216 | 16777216 | 16384 | 0.06883 | 0.06883 |
| layernorm | unfused | y | 83886080 | 16801796 | 16777216 | 0.41255 | 0.13762 |
| layernorm | fused | mean,centered,variance,y | 67108864 | 16785412 | 16777216 | 0.34380 | 0.13755 |
| attention | unfused | score | 536870912 | 524288 | 4194304 | 2.21748 | 0.01934 |
| attention | unfused | shift | 4194304 | 4194304 | 4096 | 0.01721 | 0.01721 |
| attention | unfused | e | 8388608 | 4198400 | 4194304 | 0.05157 | 0.03440 |
| attention | unfused | z | 4194304 | 4194304 | 4096 | 0.01721 | 0.01721 |
| attention | unfused | weight | 8388608 | 4198400 | 4194304 | 0.05157 | 0.03440 |
| attention | unfused | out | 536870912 | 4456448 | 262144 | 2.20136 | 0.01934 |
| attention | fused | score,shift,e,z,weight | 536870912 | 524288 | 4194304 | 2.21748 | 0.01934 |
| attention | fused | out | 536870912 | 4456448 | 262144 | 2.20136 | 0.01934 |
| mlp | unfused | h | 2151677952 | 2101248 | 4194304 | 8.83554 | 0.02580 |
| mlp | unfused | g | 4194304 | 4194304 | 4194304 | 0.03438 | 0.03438 |
| mlp | unfused | y | 2148532224 | 5243904 | 1048576 | 8.80976 | 0.02579 |
| mlp | fused | h,g | 2151677952 | 2101248 | 4194304 | 8.83554 | 0.02580 |
| mlp | fused | y | 2148532224 | 5243904 | 1048576 | 8.80976 | 0.02579 |
| conv2d | unfused | out | 1133641728 | 2115584 | 3936256 | 4.66220 | 0.02480 |
| conv2d | fused | out | 1133641728 | 2115584 | 3936256 | 4.66220 | 0.02480 |

The fused softmax moves one 16 MiB input and one 16 MiB output, equivalent to 0.13752 ms. Layernorm's distinct footprint adds the scale, shift and epsilon tensors, equivalent to 0.13755 ms. Attention removes four intermediate global round trips but still does both contractions. MLP removes the global `h` write and read but still writes `g` for the second contraction. [Traffic count script](../scripts/03-traffic-count.mjs)

## Exact contract and cost

The contract evaluates the selected current revision in f32 on deterministic cases, including distinct symbolic sizes, empty extents, signed and positive values, half-ULP sequences and signed zeros. It runs outstanding cases as one untimed GPU batch and checks shape, element count and each f32 word. NaNs compare by class. A valid CUDA mutation that reverses a fused sum is a check of whether the checker observes reduction order. Evidence is keyed by Tix revision and function, CUDA source revision and execution profile. A repeat replays the verdicts, and concurrent checks of the same candidate share an in-flight batch.

These are end-to-end wall times from a fresh Node process after benchmarking populated the remote executable cache. The first call includes sample generation, CPU evaluation, transport, GPU process startup and execution, and comparison. Replay includes source generation and the cached contract lookup.

| Program | Sampled cases | First check seconds | Replay ms |
| --- | ---: | ---: | ---: |
| matmul | 36 | 2.746 | 3.160 |
| softmax | 32 | 2.771 | 1.821 |
| layernorm | 32 | 2.772 | 1.428 |
| attention | 40 | 2.666 | 1.495 |
| mlp | 40 | 2.955 | 1.843 |
| conv2d | 28 | 3.795 | 1.074 |

The measured evidence consists of kernel counts, CUDA event intervals, paired full-size output digests and the sampled comparisons to the interpreter. The full-size runs compared both lowerings to each other. The order-preservation argument and the global traffic counts are analytical. [Contract replay script](../scripts/02-check-cost.mjs) · [Raw contract costs](check-cost.jsonl)

At implementation revision `da82bb5`, the TypeScript build, 23 network-free tensor tests and all 13 isolated GB10 tests passed. The GB10 tests covered original and optimized revisions, both lowering modes on a row fold, shared and spilled rows, and rejection of the reversed fold. A separate randomized run passed 12 exact GPU checks on three program families. [GPU tests](../../../../../../tests/tensor/cuda-gpu.test.mjs) · [Randomized variants](../scripts/04-random-fusion.mjs)
