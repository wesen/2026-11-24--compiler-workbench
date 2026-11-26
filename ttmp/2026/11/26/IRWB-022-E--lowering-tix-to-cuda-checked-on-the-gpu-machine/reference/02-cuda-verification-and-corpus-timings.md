---
Title: CUDA verification and corpus timings
Ticket: IRWB-022-E
Status: active
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/tensor/benchmark-cuda.mjs
      Note: Full-size timing driver
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: Remote correctness, mutation and reuse tests
    - Path: repo://tests/tensor/cuda.test.mjs
      Note: Offline source, protocol and batching tests
ExternalSources: []
Summary: Verification commands, sampled acceptance, and kernel versus interpreter measurements.
LastUpdated: 2026-11-26T15:55:45.00236748-05:00
WhatFor: Reproduce and interpret Stage 2 results.
WhenToUse: Comparing the unoptimized CUDA baseline with later Tix lowerings.
---

# CUDA verification and corpus timings

## Verification

Backend revision: `aa14d97`.

From the worktree root:

```sh
npm run build
node --test tests/tensor/*.test.mjs
node corpus/tensor/benchmark-cuda.mjs
```

The TypeScript build succeeded and all 24 tensor tests passed. All six corpus programs passed the origin-f64 GPU check before and after `inline` followed by `split-sum`. The suite separately verified exact index/reduction witnesses, rejected a real dropped-tail CUDA candidate, replayed a warm verdict with no batch, and confirmed that concurrent runs with different data shared an executable without crossing outputs. To run offline, leave out `tests/tensor/cuda-gpu.test.mjs`; that file is the only network test. The stage did not change the framework, Typed, or the six `.tix` fixtures. The CPU oracle in the semantic gate is the **origin** f64 evaluator on the exact f32 input bits uploaded to the GB10. Acceptance is sampled with the unchanged stage-1 error budget. The [design probe and comparison](../design-doc/01-direct-cuda-emission-and-batched-lowering-checks.md#gb10-design-probe-and-the-acceptance-relation) explain why the CUDA libm calls do not claim exact agreement.

## Measurement method

Unoptimized Tix definitions, deterministic mulberry32 seed 22 with signed f32 inputs except positive epsilon for layernorm. Each CPU number is one full-size f32 interpreter call on this machine, with a small local warm-up. Each GPU number is the median of five CUDA-event intervals in one `--timed` process, after preloading and one full-size warm-up. Allocation, transfers, compile, file I/O and startup are outside the intervals. Event timing includes gaps between successive launches. No full-size f64 runs were performed; numerical checks are separate from measurement. Both hosts were shared, so these are baseline observations rather than controlled estimates of hardware throughput. The interpreter timings in particular include time waiting to be scheduled.

GPU: NVIDIA GB10 `sm_121`, nvcc 13.0.88, CUDA runtime and driver API 13000. Interpreter: Node v24.18.0, Intel Core i7-1165G7.

| Function | Shape bindings | GPU median (ms) | GPU min–max (ms) | f32 interpreter wall time (s) |
| --- | --- | ---: | ---: | ---: |
| matmul | `M=K=N=512` | 0.210 | 0.201–0.213 | 706.304 |
| softmax | `N=4096, C=1024` | 0.523 | 0.521–0.524 | 44.238 |
| layernorm | `N=4096, D=1024` | 0.471 | 0.467–0.472 | 73.164 |
| attention | `Q=K=1024, D=V=64` | 0.976 | 0.974–0.993 | 421.773 |
| mlp | `N=1024, D=O=256, H=1024` | 0.852 | 0.837–0.857 | 962.088 |
| conv2d | `N=8, C=16, H=W=64, O=32`, 3×3 kernel | 0.171 | 0.169–0.172 | 165.707 |
