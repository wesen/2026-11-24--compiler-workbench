---
Title: CUDA lowering results and corpus timings
Ticket: IRWB-022-L
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Candidate acceptance against origin f64
    - Path: repo://src/tensor/cuda-source.ts
      Note: Statement and expression lowering
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: Device checks, mutation and concurrency coverage
    - Path: repo://tools/cuda-remote.mjs
      Note: Per-invocation isolation and shared compile cache
ExternalSources: []
Summary: Implementation evidence, semantic checks and measured GB10 and interpreter timings.
LastUpdated: 2026-11-26T16:37:36.983222457-05:00
WhatFor: ""
WhenToUse: ""
---

# CUDA lowering results and corpus timings

The backend at `4546491` emits one translation unit for the current Tix function and one kernel per statement. A thread owns one returned element of its statement and performs its reductions in binder order. The host reads the batch header to choose untimed execution or warm-up followed by one or three measured repetitions. The public API lives in `dist/tensor/index.js` after the build. [Emitter](../../../../../../src/tensor/cuda-source.ts) · [CUDA runtime](../../../../../../src/tensor/cuda-runtime.ts) · [Batch runner](../../../../../../src/tensor/cuda-run.ts)

## Meaning and framework findings

The sampled obligation is `abs(gpu - originF64) <= 2e-6 + 2e-5 * abs(originF64)` for every coordinate of a finite reference result, with equal return shapes. The original f64 evaluator receives the exact f32 inputs sent to CUDA. The current revision supplies the kernels, including separate inner and outer accumulation after a split. The design probe found a one-word-step difference between GB10 `expf` and stage-1 f32, and a maximum of 15.6% of this budget across 40,960 sampled values. [Probe record](../scripts/04-probe-result.json)

**The framework required no source changes.** A typed transformation relates an artifact to text. Its differential invariant dispatches all missing case indices in one GPU invocation, records the counterexample with coordinates, and replays completed verdicts under the same revision, function, version and source digest. The only tool change isolates identical concurrent calls in private remote working directories while retaining the full-input binary cache. [Checked pass](../../../../../../src/tensor/cuda-contract.ts) · [Remote tool](../../../../../../tools/cuda-remote.mjs)

## Full-size measurements

The original corpus functions ran with seed 22, uniform signed f32 inputs and layernorm epsilon `1e-5`. The SHA-256 recorded per function covers parameter data in declaration order. Each GPU value is the median of three intervals on one stream after one warm-up, under the tool's timing lock. CUDA events enclose only the launch sequence. The interpreter value is the elapsed wall time for one full default-f32 `runTix` on this shared machine after a small-shape warm-up. Input generation, compilation and reporting are outside both intervals. The interpreter ran on Node 24.18.0. The remote tool used nvcc 13.0.88 with `-O3 -arch=sm_121` on the NVIDIA GB10. [Reproduction script](../scripts/05-benchmark.mjs)

| Corpus function and shape bindings | Kernels | GB10 median (ms) | Stage-1 f32 interpreter (ms) |
| --- | ---: | ---: | ---: |
| matmul, M = K = N = 512 | 1 | 0.231872 | 813,945.980 |
| softmax, N = 4096, C = 1024 | 4 | 0.482496 | 84,049.193 |
| layernorm, N = 4096, D = 1024 | 4 | 0.453632 | 98,367.161 |
| attention, Q = K = 1024, D = V = 64 | 6 | 0.876128 | 627,406.515 |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 3 | 0.988288 | 1,162,684.628 |
| conv2d, N = 8, C = 16, H = W = 64, O = 32, 3 × 3 kernel | 1 | 0.166208 | 281,866.797 |

All six pairs have matching input digests and output shapes. The timing harness ran the interpreter workloads serially. Host load contributes to these single-run wall times. [Interpreter observations](../scripts/06-cpu.jsonl) · [GPU intervals](../scripts/07-gpu.jsonl)

## Verification

`npm run build` passed. The network-free tensor selection passed 19 tests. The full `node --test tests/tensor/*.test.mjs` run passed all 29 with zero skipped in 249.0 s. It checked all six original and optimized corpus functions, the changed reduction grouping, nested binders, nonfinite extrema, empty shapes, simultaneous checks and exact evidence replay. A kernel with a dropped reduction tail returned 0 at [0] instead of 0.5052213072776794. The allowance there was 0.00001210442614555359, and the checked pass rejected it. [Test receipt](../various/tensor-tests.log)

One verification detail differs from the design. The regression reads the framework's delegation and replay counters during a real device check instead of adding a counting stand-in to the tensor implementation. The local framework probe also exercises batching with stand-in outcomes. [GPU tests](../../../../../../tests/tensor/cuda-gpu.test.mjs) · [Framework probe](../scripts/03-contract-probe.mjs)
