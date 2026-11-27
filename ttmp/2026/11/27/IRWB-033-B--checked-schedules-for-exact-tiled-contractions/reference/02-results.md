---
Title: Results
Ticket: IRWB-033-B
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
      Note: Enforces the intrinsic gate for synchronous and managed passes
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Cross-kind trace and exact GPU contract
    - Path: repo://src/tensor/schedule.ts
      Note: Legality and shape strategy
    - Path: repo://ttmp/2026/11/27/IRWB-033-B--checked-schedules-for-exact-tiled-contractions/scripts/11-contractions.mjs
      Note: Timing a contraction phase with resident inputs
    - Path: repo://ttmp/2026/11/27/IRWB-033-B--checked-schedules-for-exact-tiled-contractions/scripts/16-qualify.mjs
      Note: Interleaved public API benchmark
ExternalSources: []
Summary: Measured exact contraction throughput, checked schedule revisions, and framework findings
LastUpdated: 2026-11-27T10:04:11.977757757-05:00
WhatFor: ""
WhenToUse: ""
---

# Exact contraction schedules on GB10

Stage 6 compiles the current Tix revision to a versioned schedule and prints that schedule as CUDA. The timing reference is the stage 3b checkout at `0f45d04`. The arithmetic reference is the current revision evaluated in f32. Tix fixes the order of the fold, including the additional rounding points of an already split expression.

## Measurements

The 512³ matmul took 0.0522 ms, 4.15× faster than the fused base. At 4096³ it took 14.5144 ms, 9.29× faster and 9.47 TFLOP/s, about 66% of the supplied separate-multiply/add arithmetic ceiling. Whole attention improved 3.57× and MLP 2.72×. No measured corpus function regressed. The layernorm and softmax launches retain their previous schedules, so their timing differences do not establish a benefit from tiling.

| Function | Base F / U ms | Stage 6 F / U ms | F speedup over base F | Definitions F / U | Launches F / U |
|---|---:|---:|---:|---:|---:|
| matmul 512³ | 0.2163 / 0.2154 | 0.0522 / 0.2183 | 4.15× | 1 / 1 | 1 / 1 |
| matmul 4096³ | 134.9080 / 134.4223 | 14.5144 / 133.9223 | 9.29× | 1 / 1 | 1 / 1 |
| attention | 0.7486 / 1.0491 | 0.2095 / 1.0519 | 3.57× | 1 / 6 | 3 / 6 |
| mlp | 0.6250 / 0.9460 | 0.2294 / 0.9483 | 2.72× | 1 / 3 | 2 / 3 |
| conv2d | 0.1661 / 0.1644 | 0.1152 / 0.1661 | 1.44× | 1 / 1 | 1 / 1 |
| softmax | 0.3874 / 0.8409 | 0.3812 / 0.7968 | 1.02× | 1 / 4 | 1 / 4 |
| layernorm | 0.1670 / 0.4963 | 0.1537 / 0.4757 | 1.09× | 1 / 4 | 1 / 4 |

| Contraction | F / U ms | F / U TFLOP/s | F / U fraction of cuBLAS throughput |
|---|---:|---:|---:|
| matmul 512³ | 0.0522 / 0.2183 | 5.15 / 1.23 | 0.63× / 0.15× |
| matmul 4096³ | 14.5144 / 133.9223 | 9.47 / 1.03 | 0.49× / 0.05× |
| attention score | 0.0291 / 0.6167 | 4.62 / 0.22 | 0.61× / 0.03× |
| attention value | 0.0723 / 0.0943 | 1.86 / 1.42 | 0.30× / 0.23× |
| MLP hidden | 0.1335 / 0.4704 | 4.02 / 1.14 | 0.32× / 0.09× |
| MLP output | 0.0965 / 0.3936 | 5.56 / 1.36 | 0.49× / 0.12× |
| conv2d | 0.1152 / 0.1661 | 2.46 / 1.71 | — |

F and U denote the public API with fusion enabled and disabled. The two small attention and MLP rows in the contraction table measure individual launches **inside their own program**, with real intermediate values. The hidden-layer fused interval includes bias and GELU. Its unfused interval includes bias and omits the separate GELU launch. Both score intervals include scaling and both MLP output intervals include bias. The GEMM numerator counts just two operations per product. Conv2d counts 144 products per valid output. cuBLAS is a speed reference and uses FMA. A value of 0.5× in the last column means half its throughput.

Script 01 ran five alternating F/U pairs per size on the untouched base. Script 16 did the same using the final public entry points. Each call warms up and takes the median of three CUDA-event intervals under the timed lock. Script 11 uses the same executor, flags, input words and emitted launches. It runs the whole function once to initialize buffers, then warms and times just the selected launch. It checks the whole output digest. Timings exclude transfers, host setup and compilation. Script 18 checks the pair counts and hashes before rendering either table. Differences below 5% are noise under the supplied protocol. [Base samples](../scripts/01-base.jsonl) · [Qualification samples](../scripts/16-qualification.jsonl) · [Launch profiler](../scripts/11-contractions.mjs) · [Phase samples](../scripts/11-final.jsonl)

In the independent 4096³ clock probe on resident zero operands, all 16 fused samples read 2405 MHz at 43 °C. The unfused samples read 2411 to 2405 MHz and 42 to 50 °C. That frequency range is 0.25%. Its medians were 14.409 and 132.916 ms. The random-input fused series included one 17.526 ms call and four between 14.407 and 14.519 ms. The clock probe does not explain that outlier. [Clock samples](../scripts/07-final-clock.jsonl)

## Launch choices at the reported shapes

The attention inputs have Q = K = 1024 and D = V = 64. MLP uses N = H = 1024 and D = O = 256. Conv2d uses eight images, 16 input channels, 32 output channels, 64×64 inputs and a 3×3 kernel, giving 62×62 valid outputs. Softmax and layernorm each have 4096 rows and 1024 columns.

| Launch | Output tile × K strip | Grid | Work per thread and reason |
|---|---|---:|---|
| Matmul 512³ | 64×64×16 | 64 | 4×4 outputs. The 128-square grid would have only 16 blocks. |
| Matmul 4096³ | 128×128×16 | 1,024 | 8×8 outputs. The grid covers the device and the larger panels improve reuse. |
| Attention score | 64×64×16 | 256 | 4×4. Load the transposed right operand along its contiguous D dimension and transpose it into the shared panel. Scale scores before storing them. |
| Attention value | 64×64×16 | 16 | 4×4. The long K makes tiling worthwhile at this narrow width. |
| MLP hidden | 64×64×16 | 256 | 4×4. Compute bias and GELU per completed output in registers. The larger tile would leave only 64 blocks. |
| MLP output | 64×64×16 | 64 | 4×4. Accumulate over H and add the output bias. The larger tile would leave only 16 blocks. |
| Conv2d | four output channels | 961 | Four accumulators reuse one input per term. Each block has 256 threads and adjacent lanes span the image width. |

Every matrix tile has 256 threads in a logical 16×16 rectangle. Each complete operand panel is staged in shared memory with four-word transfers. The attention normalization phase uses the inherited row program. Softmax and layernorm also launch one shared-row kernel at the reported shapes. Every U measurement uses the stage-2 mapping of one thread per output and 256 threads per block.

## Schedule and provenance

The schedule stores the resolved function, kernel groups in definition order, the register/row/global placement of each load, row storage and aliases, staged term buffers, the thread-width and fusion policies, and alternative launch phases with explicit inputs and outputs. Its entities include each kernel, the algorithm, and every syntactic fold, including nested folds. Each fold denotes a family parameterized by its output coordinates. Within a tile the IR identifies the K binder and original extent, left and right operand orientation, lane rectangle, register rectangle, panel depth, shared storage, vector widths and shape predicates.

A Tix statement maps to its kernel and fold entities. Every changed schedule revision has a v6 change set, declared writes, an intrinsic structural check and a correspondence. A fold keeps its identity throughout. Its final edge identifies the CUDA kernel definition that implements it. The original end-to-end statements-to-kernels correspondence remains in the lowering contract and carries the chain as evidence. The phase map distinguishes operations implemented by separate instantiations of one definition. There is no record per dynamic element. The same small correspondence describes a 64² and a 4096² output.

The initial import uses the existing fusion analysis. Reimplementing its staged terms, in-place checks and scratch fallback would add a second legality analysis. A supplied stage-2 plan gets the same initial representation with one element kernel per statement. Its twelve corpus digests, including optimized programs, still match the pinned bytes. The emitter consumes the schedule in both paths. [Schedule definitions and strategy](../../../../../../src/tensor/schedule.ts) · [Pipeline and cross-kind correspondences](../../../../../../src/tensor/cuda-contract.ts)

| Native pass | Applicability and effect |
|---|---|
| tile | Recognize a rank-two output with one enclosing sum of a product of two plain matrix reads, in either operand order and either storage orientation. Check the actual contiguous strides against the required extents. Partition the output across 16×16 lanes and K into consecutive strips of 16. Other scalar operations enclosing the sum stay in the epilogue. |
| register-tile | For a recognized tile, give each lane a 4×4 patch. Each output accumulator remains private to one lane. |
| stage-panels | For that rectangle, cooperatively stage a left and right panel. Barriers separate filling, reading and reuse. The clipped path masks reads and writes. |
| vectorize | For complete aligned tiles, fetch groups of four adjacent words. Four words occupy one naturally aligned 16-byte CUDA vector. A full tile implies the required leading dimensions and offsets are multiples of four. |
| pack-registers | A shared tile with register dimensions divisible by four can give lanes contiguous four-word fragments and read them with vector shared loads. The left panel is transposed and padded by four words for alignment. |
| wide-tile | A packed layout also supports 8×8 outputs per lane with the same 256 threads. It doubles the panel reuse and increases register demand. Use it when at least 96 of the resulting 128×128 blocks can launch, enough for two blocks per GB10 SM. |
| fuse-phases | Follow a dot with adjacent, equal-shape, reduction-free epilogues whose reads of local values are at the same output coordinate. The tile computes these in registers. Consecutive remaining members of a block group can reuse the original row schedule. Compute live-ins from prior definitions and live-outs from later uses or original stores. |
| dispatch | Select from the resulting launches at runtime. The narrow aligned rule needs at least 16 blocks and 128 terms, or 48 blocks and 32 terms. Ragged grids need 48 blocks and 128 terms. Both output dimensions must span a tile. |
| broadcast-patch | For a higher-rank product sum, find an outer output axis absent from the coalesced operand and present in the other operand, which is constant along the last output axis. Reuse the common input word for four output coordinates. Keep all reduction axes in lexical order. Use this route if the selected axis spans four elements and at least one 256-thread block can launch per SM. |

The strategy applies native passes in dependency order. If tiling finds no match, it skips the panel passes. A host-side rule picks from the legal schedules because the public source generator receives symbolic dimensions. The general v6 strategy interpreter executes asynchronously. A direct synchronous sequence over the same pass objects fits the fixed source API and keeps one compiler for execution and verification. The other alternative, a special case in the CUDA printer, would hide the revisions and their individual checks.

## Arithmetic and legality

For each output and every integer k in [0,K), Euclidean division gives exactly one panel number and one within-panel offset. Traversing panel starts in increasing steps of D and offsets from zero to D−1 visits k in increasing order. The last panel stops contributing at K. The clipped loop performs no extra additions after the last valid term. The accumulator starts once at positive zero and uses explicit round-to-nearest FMUL followed by FADD. A permutation of independent outputs and copies of operand words introduce no rounding point.

The output partition is also bijective. With interleaved registers, a tile coordinate is lane + register × laneCount. Packed fragments use lane × registerCount + register. Each map has the usual quotient/remainder inverse. The schedule validator checks positive integral factors, operand bindings and strides, vector divisibility, block size and the shared-memory budget. It checks phase membership, live-outs and imported values. The pass postcondition compares the algorithm and imported fusion decisions before and after erasing layout and records the fold binder, extent and step for each panel. This reasoning covers the defined layout primitives. It does not prove the emitted addresses, CUDA barriers, nvcc instruction selection or transcendental implementations.

All nine pass kinds also passed the GPU differential on a representative changed revision. Script 19 printed those intermediate artifacts directly. [Prefix verdicts](../scripts/19-prefix-checks.jsonl)

Full tiles fetch float4 values. Ragged ones fetch scalars under bounds checks. Both use the same ordered fold. Empty reductions and empty outputs retain the original initial value and launch behavior. The source grammar, evaluator and stage-1 optimizer are unchanged. Generic affine reads, nonlinear reduction bodies, split sums and shapes too small for the dispatch rule keep the earlier lowering. Four-channel operand reuse also handles affine convolution without im2col storage.

## Which choices paid

A 64×64 tile creates 64 blocks at 512 square, enough to reach every SM. Sixteen K positions give 1,024 words in each input panel. With 256 threads that is exactly one float4 load per thread per operand. The 4×4 patch gives sixteen independent accumulator chains per thread. The 128-square variant keeps the same panel depth and block size, trading more register state for additional input reuse.

At 512³ the first 64×64 shared tile took 0.0932 ms. Reducing the tile to 32×32 to improve occupancy gave 0.1027 ms. Specializing away the boundary checks alone gave 0.0891 versus 0.0933 ms, within the 5% band. We kept the aligned form because it permits safe vector loads. Register tiling without shared staging took 0.0741 ms. Scalar shared staging alone was slower at 0.0885 ms. Vector global loads reduced that to 0.0701 ms and vector register fragments to 0.0517 ms. These are paired comparisons of executable schedule revisions. They show why a pass can be legal yet unprofitable in isolation. [Layout experiment](../scripts/03-layout.jsonl) · [Bound checks](../scripts/04-alignment.jsonl) · [Storage](../scripts/05-storage.jsonl) · [Global vectors](../scripts/06-vector.jsonl) · [Register fragments](../scripts/09-fragments.jsonl)

On resident zero operands at 4096³, 8×8 register patches gave 13.999 ms against 15.837 ms for 4×4. The benchmark table uses independent public calls on random f32 operands. For the 1024×64 output of the attention value GEMM, distributing the same patches across 32×32 instead of 64×64 blocks gave 0.0791 versus 0.0722 ms. We kept the 64×64 tile there. No runtime search or timing feeds the strategy. [Large-tile experiment](../scripts/10-large-tile.jsonl) · [Narrow output](../scripts/12-narrow.jsonl)

Script 08 forced both sides to locate cases where tiling loses. One 64×64 block at K=512 took 0.0379 ms against 0.0242 ms. At 128³ it took 0.0129 against 0.0107 ms. At 256³ the comparison reversed, 0.0211 against 0.0281 ms. At 512×512×16 the tiled form lost, while K=32 won, 0.0107 against 0.0144 ms. At 256×256×65 the clipped path took 0.0149 against 0.0100 ms. At 511×513×511 it took 0.0947 against 0.2319 ms. These crossovers and the GB10's 48 SMs motivate the dispatch rule. Its performance between samples is an inference. [Boundary shapes](../scripts/08-shapes.jsonl) · [Crossovers](../scripts/08-crossover.jsonl)

The first tiled route materialized every member separately. Attention took 0.533 ms and MLP 0.383 ms in single calls. Reusing row placement between the two attention dots and retaining GELU inside the first MLP tile removed three and one launches respectively. At the specified shapes attention executes score, one fused normalization phase, then the value dot. MLP executes hidden projection plus GELU, then the output projection. The original one-block-per-row route and its original per-statement fallback remain executable. For these row groups, the existing gates field reports whether the original fused-row route ran. On the tiled route it reports unfused even where individual phases fuse several statements. For scheduled singletons it distinguishes the optimized and original element routes. [Initial check](../scripts/02-check.jsonl) · [First fused phases](../scripts/02-phases.jsonl)

The convolution uses a 256-thread block, four output channels per thread, no shared panel and the original ordered c,dy,dx nest. Adjacent lanes still traverse the image width. At B=8 and M=N=128 on a batched GEMM, the same register-only pass tied the old lowering within noise at K=1,16,128. Its benefit depends on the operand reuse pattern. Softmax and layernorm retain their original shared-row schedules and gate. [Broadcast experiment](../scripts/15-broadcast.jsonl)

## Framework and tools

The one framework change is a pass-owned synchronous structural postcondition. Both native synchronous application and managed asynchronous application enforce it for a changed revision. An additional application-supplied gate still runs. Previously the native caller had to supply the structural check every time. That made it possible to replay a schedule pass while accidentally omitting its order check. A full asynchronous transformation contract would be excessive for a local, deterministic property and would not serve the synchronous entry point. Existing projection diffs, declared writes, artifact revisions, entity enumeration and correspondences handled the second IR without changes. The remote CUDA tool needed no modification. [Framework change](../../../../../../src/framework/passes/define-pass.ts) · [Both application paths tested](../../../../../../tests/framework/native-pass-sync.test.mjs)

## Exact check and cost

The final checker compares output shape and every f32 word against the current revision, with NaNs compared as a class. It forces the original fused and unfused sides, the tiled phase route for row groups, and the wide specialization where present. The baseline key includes the Tix revision, function name and mode inventory used by the recipe. The base's signed, positive, half-ULP, signed-zero, mixed-shape and empty cases remain. For recognized dots it also requests one signed full 64×64×32 panel case where the shape bindings and the existing sampling budget permit. Dedicated GPU tests cover a complete 128-square wide tile, both transposed operands, ragged panels, K=1, K=0, and register epilogues. Changing one lane of a packed load in the aligned branch produced a numerical counterexample.

The checker runs mode batches sequentially after an SSH connection was closed during a concurrent handshake. Concurrent identical checks still share in-flight evidence. Compilation and driver work dominate these small kernel intervals. Replay reuses completed differential verdicts. [Checker](../../../../../../src/tensor/cuda-contract.ts) · [GPU tests](../../../../../../tests/tensor/schedule-gpu.test.mjs)

All six cold checks accepted under the exact relation. These are wall times for one cold check and its immediate replay per program. Pipeline time measures a separate host compilation into a CUDA-source artifact. The last column sums CUDA events across all cases of the cold check. Replays recompute the recipe and f32 references and submitted zero GPU batches. [Cost measurement](../scripts/14-contract-cost.jsonl)

| Function | Changed passes / correspondence links | Modes × cases | Pipeline ms | Cold s | Replay ms | GPU events ms |
|---|---:|---:|---:|---:|---:|---:|
| matmul | 7 / 9 | 3 × 37 | 113.1 | 15.30 | 906.8 | 0.93 |
| attention | 8 / 10 | 4 × 42 | 81.4 | 23.19 | 2699.8 | 2.87 |
| mlp | 8 / 10 | 4 × 42 | 98.8 | 26.53 | 2337.6 | 3.98 |
| conv2d | 1 / 3 | 2 × 28 | 20.5 | 18.27 | 4116.2 | 0.53 |
| layernorm | 0 / 2 | 2 × 32 | 19.4 | 8.62 | 80.4 | 0.72 |
| softmax | 0 / 2 | 2 × 32 | 8.1 | 11.32 | 52.4 | 0.69 |

The final build passed. All 68 scoped CPU/framework tests and 23 GB10 tests passed. The GPU suite took 616 seconds end to end and included the original and optimized corpus, staged terms, shared/scratch fallback, gate reports, packed-load mutation and all four matrix orientations. [CPU results](../scripts/17-cpu.log) · [GPU results](../scripts/17-gpu.log)

## Limits and later work

- Performance is measured at the listed shapes and selected boundary cases. Those observations and fallback identity support the no-regression result on the measured set. They do not prove a latency bound over all possible shapes, contention or driver versions.
- General affine and batched GEMM panel packing would require new address maps. They continue through the generic lowering or the register-only pass where legal.
- Double buffering would increase shared storage and introduce another lifetime boundary. Single buffering already met the initial hand-written 512³ reference.
- Split-K, FMA, tensor cores and reduced precision change the arithmetic relation. Autotuning by measured search falls outside the stage.
- The correspondence stops at CUDA definitions. Instruction-level equivalence would require observing compiled code. Yang et al. reconstruct library reductions and constrain search to bit-equivalent compiled kernels. Our reference tree is known before scheduling. [Yang et al.](https://arxiv.org/html/2609.11356)
