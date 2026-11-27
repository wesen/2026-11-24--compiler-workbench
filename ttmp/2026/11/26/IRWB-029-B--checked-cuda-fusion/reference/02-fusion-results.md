---
Title: Fusion results
Ticket: IRWB-029-B
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-fusion.ts
      Note: Legality and shared-row lifetimes
    - Path: repo://src/tensor/cuda-source.ts
      Note: Kernel emission and launch geometry
    - Path: repo://ttmp/2026/11/26/IRWB-029-B--checked-cuda-fusion/scripts/02-measure.mjs
      Note: Locked event measurements and exact check costs
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:01:42.559186276-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion on the GB10

The emitter in revision `fabd9e9` lowers softmax and layernorm to one kernel each. Both run about twice as fast as their four-kernel counterparts on the specified inputs. For softmax, the staged input and final output account for 33,554,432 bytes, or 0.138 ms at 244 GB/s. Its measured 0.363 ms includes the ordered max and sum, double exponential, normalization, block synchronization and launch. This run did not reproduce the earlier prototype's 4.25× speedup.

## Measured kernel counts and times

Each entry times the complete function at the brief's sizes, with allocations, uploads, downloads and module preloading outside the CUDA events. The public benchmark option performs a warm-up and takes the median of three runs under the remote tool's timed lock. The script counts CUDA global definitions and compares SHA-256 digests of the two full-size outputs. Each pair matched. Variation between runs of the same source is visible for matmul and conv2d. [Raw event medians and hashes](measurements.jsonl) · [Replay script](../scripts/02-measure.mjs)

| Program and sizes | Unfused kernels | Unfused ms | Fused kernels | Fused ms | Speedup |
|---|---:|---:|---:|---:|---:|
| matmul, M=K=N=512 | 1 | 0.215488 | 1 | 0.213632 | 1.01× |
| softmax, N=4096, C=1024 | 4 | 0.804064 | 1 | 0.362816 | 2.22× |
| layernorm, N=4096, D=1024 | 4 | 0.486912 | 1 | 0.235520 | 2.07× |
| attention, Q=K=1024, D=V=64 | 6 | 1.048256 | 3 | 0.814592 | 1.29× |
| mlp, N=1024, D=O=256, H=1024 | 3 | 1.053856 | 2 | 0.867552 | 1.21× |
| conv2d, N=8, C=16, H=W=64, O=32, 3×3 | 1 | 0.166944 | 1 | 0.164864 | 1.01× |

## Which boundaries moved

The planner grows consecutive groups on the resolved Tix IR. For each start position it chooses the longest supported group in which only the final definition escapes. The selected function's return counts as a use. Two placement rules suffice for the corpus.

* **Same element.** A thread evaluates the first definition, including any reduction, and saves its f32 result in a scalar. Each following pointwise definition must have the same symbolic shape and read group values at its own coordinates. MLP's first dot and bias already share a statement. Its five GELU reads now share the same rounded value in a register. The second dot and bias still share the second kernel. Folding the hidden layer into that dot would duplicate its contraction across output features.
* **Same row.** A 256-thread block owns one row. Consecutive lanes stage the contiguous input columns, then a single lane computes each row scalar with the existing lexicographic loop nest. All lanes compute column results, with block barriers between definitions. Softmax groups m/e/s/y, layernorm groups mean/centered/variance/y, and attention groups shift/e/z/weight between the two contractions. A private vector can read another column in the same row. Reusing its source slot requires identity-column reads at the replacement stage and no later uses. Scratch in global memory accommodates rows larger than the allowance queried for that kernel. A zero-width row still launches if it returns a row scalar.
* **Boundaries retained.** Matmul and conv2d each have a single definition. Attention's score contraction and its final value contraction keep their original one-thread-per-output mapping. The former reduces features independently for each score column, and the latter multiplies weights across columns by V. The row schedule handles pointwise columns and sequential row scalars. A transposed intermediate crossing rows would need another thread's private value. Independent or nonconsecutive chains keep their launch boundaries. These are limitations of the scheduling rules, independent of whether another schedule could preserve the meaning.

The rounded arithmetic, shape values, literals and transcendental paths use the stage-2 scalar emitter. Row max uses the GB10's NaN-propagating binary maximum once per term, including signed-zero ordering, with the accumulator initialized to negative infinity. There is still one loop-carried accumulator. [Maximum instruction probe](../scripts/03-max-probe/main.cu) · [Implementation diary](01-implementation-diary.md)

## Counted global traffic per kernel

Read and write columns are bytes counted from scalar load occurrences and stores at the specified shapes. A dot with L terms counts 2L operand reads per output. Repeated operands count separately. Staging a source row counts one read per element. Registers, block-shared values, scalar shape arguments and host transfers contribute zero. All benchmark rows fit in shared memory. The footprint column counts distinct input bytes accessed by that kernel, counting each array once. Every counted input array is covered at these sizes.

The two time columns divide (reads + writes) and (input footprint + writes) by 244,000,000 bytes/ms respectively. They give streaming equivalents. Broadcast, compiler load reuse, cache hits and inter-kernel residency affect actual DRAM traffic, especially for contractions. Neither column measures DRAM transactions. [Executable count and correspondence probe](../scripts/04-traffic.mjs) · [Exact counts](traffic.jsonl)

| Program | Mode | Kernel definitions in execution order | Read bytes | Write bytes | Read footprint bytes | Logical ms | Footprint ms |
|---|---|---|---:|---:|---:|---:|---:|
| matmul | unfused | k0 (y) | 1,073,741,824 | 1,048,576 | 2,097,152 | 4.4049 | 0.0129 |
| matmul | fused | k0 (y) | 1,073,741,824 | 1,048,576 | 2,097,152 | 4.4049 | 0.0129 |
| softmax | unfused | k0 (m) | 16,777,216 | 16,384 | 16,777,216 | 0.0688 | 0.0688 |
| softmax | unfused | k1 (e) | 33,554,432 | 16,777,216 | 16,793,600 | 0.2063 | 0.1376 |
| softmax | unfused | k2 (s) | 16,777,216 | 16,384 | 16,777,216 | 0.0688 | 0.0688 |
| softmax | unfused | k3 (y) | 33,554,432 | 16,777,216 | 16,793,600 | 0.2063 | 0.1376 |
| softmax | fused | k0 (m, e, s, y) | 16,777,216 | 16,777,216 | 16,777,216 | 0.1375 | 0.1375 |
| layernorm | unfused | k0 (mean) | 16,777,216 | 16,384 | 16,777,216 | 0.0688 | 0.0688 |
| layernorm | unfused | k1 (centered) | 33,554,432 | 16,777,216 | 16,793,600 | 0.2063 | 0.1376 |
| layernorm | unfused | k2 (variance) | 33,554,432 | 16,384 | 16,777,216 | 0.1376 | 0.0688 |
| layernorm | unfused | k3 (y) | 83,886,080 | 16,777,216 | 16,801,796 | 0.4126 | 0.1376 |
| layernorm | fused | k0 (mean, centered, variance, y) | 67,108,864 | 16,777,216 | 16,785,412 | 0.3438 | 0.1376 |
| attention | unfused | k0 (score) | 536,870,912 | 4,194,304 | 524,288 | 2.2175 | 0.0193 |
| attention | unfused | k1 (shift) | 4,194,304 | 4,096 | 4,194,304 | 0.0172 | 0.0172 |
| attention | unfused | k2 (e) | 8,388,608 | 4,194,304 | 4,198,400 | 0.0516 | 0.0344 |
| attention | unfused | k3 (z) | 4,194,304 | 4,096 | 4,194,304 | 0.0172 | 0.0172 |
| attention | unfused | k4 (weight) | 8,388,608 | 4,194,304 | 4,198,400 | 0.0516 | 0.0344 |
| attention | unfused | k5 (out) | 536,870,912 | 262,144 | 4,456,448 | 2.2014 | 0.0193 |
| attention | fused | k0 (score) | 536,870,912 | 4,194,304 | 524,288 | 2.2175 | 0.0193 |
| attention | fused | k1 (shift, e, z, weight) | 4,194,304 | 4,194,304 | 4,194,304 | 0.0344 | 0.0344 |
| attention | fused | k2 (out) | 536,870,912 | 262,144 | 4,456,448 | 2.2014 | 0.0193 |
| mlp | unfused | k0 (h) | 2,151,677,952 | 4,194,304 | 2,101,248 | 8.8355 | 0.0258 |
| mlp | unfused | k1 (g) | 20,971,520 | 4,194,304 | 4,194,304 | 0.1031 | 0.0344 |
| mlp | unfused | k2 (y) | 2,148,532,224 | 1,048,576 | 5,243,904 | 8.8098 | 0.0258 |
| mlp | fused | k0 (h, g) | 2,151,677,952 | 4,194,304 | 2,101,248 | 8.8355 | 0.0258 |
| mlp | fused | k1 (y) | 2,148,532,224 | 1,048,576 | 5,243,904 | 8.8098 | 0.0258 |
| conv2d | unfused | k0 (out) | 1,133,641,728 | 3,936,256 | 2,115,584 | 4.6622 | 0.0248 |
| conv2d | fused | k0 (out) | 1,133,641,728 | 3,936,256 | 2,115,584 | 4.6622 | 0.0248 |

## Contract and cost

The differential invariant runs the current revision's f32 evaluator on deterministic signed, positive, half-ULP and signed-zero streams, with distinct-size and empty-extent cases. The candidate is the actual CUDA source artifact. The checker compares the result shape and every f32 word, preserving signed zero and infinity and matching NaNs by class. One remote batch serves the undecided cases. Identical source revisions can reuse verdicts across modes, and concurrent checks share in-flight evidence. Checking samples establishes agreement on those calls. The IR legality argument covers the change in storage and evaluation order for other supported calls.

| Program | Cases per lowering | Fused first check ms | Unfused first check ms | Fused replay ms |
|---|---:|---:|---:|---:|
| matmul | 36 | 2682.17 | 1.03 | 1.03 |
| softmax | 32 | 3990.80 | 2369.42 | 1.89 |
| layernorm | 32 | 3479.10 | 2395.01 | 1.39 |
| attention | 40 | 3493.69 | 3236.93 | 17.74 |
| mlp | 40 | 2504.50 | 2487.81 | 1.25 |
| conv2d | 28 | 2914.71 | 0.84 | 1.18 |

Times are public API wall times, including reference work, compilation/cache lookup, remote transport, execution and comparison as applicable. The executable cache was already warm for some sources. Matmul and conv2d emit identical source in both modes, so their unfused first check replays the fused verdict. The full-size comparison independently checks the two lowerings against one another. The interpreter comparisons use the contract's smaller sampled calls.

## Framework and tooling findings

Fusion lives in the CUDA emitter because only device placement and lifetime change. The public Tix program and its checked optimization history retain their original identities. A Tix rewrite cannot express block synchronization. A versioned kernel IR would add a second schema and projection for a schedule currently used by one emitter.

**Framework source changes: zero.** The cross-kind transformation accepts a typed Boolean fusion input, and the existing checker keys candidate evidence on the resulting CUDA artifact. The correspondence probe constructed a grouped source-to-target entry for every emitted kernel, including four source statement IDs mapped to one softmax kernel ID. The generic API takes caller-supplied entity universes. The CUDA artifact contains source text and has no kernel graph adapter, so kernel IDs in the probe come from emission order. The production contract needs the whole-function artifact and does not publish this experimental mapping.

**Remote tool changes: zero.** The public runner now forwards benchmark mode to the existing event timer and timed lock. The CUDA exact relation and in-flight batch sharing needed no new infrastructure. The implementation does not tile contractions, reassociate reductions, contract multiply-adds, stream attention or autotune.

## Verification

The TypeScript build succeeded. All 23 network-free tensor tests and 13 GB10 tests passed. The GPU run includes original and optimized revisions, split tails, nested shadowing, signed zeros, empty outputs, a 65,536-column scratch-backed row and a returned row scalar over a zero-width input. The checker rejected a fused source mutant that replaced a reversed column with the identity column. [GPU test output](gpu-tests.txt)
