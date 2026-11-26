---
Title: CUDA verification and corpus timings
Ticket: IRWB-022-B
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-io.ts
      Note: Binary case protocol and invocation
    - Path: repo://src/tensor/cuda-source.ts
      Note: Tix-to-CUDA emission and kernel event harness
    - Path: repo://src/tensor/cuda.ts
      Note: Fixed API and sampled CUDA transformation
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: GPU integration and negative contract test
    - Path: repo://tools/cuda-remote.mjs
      Note: Private remote jobs, compile cache and timing lock
ExternalSources: []
Summary: Verification of checked CUDA emission and same-input GPU and interpreter measurements for the six Tix corpus programs.
LastUpdated: 2026-11-26T15:54:57.034872351-05:00
WhatFor: ""
WhenToUse: ""
---

# CUDA verification and corpus timings

## Checked lowering

The build exports `cudaSource`, `runTixCuda` and `checkLowering` from `dist/tensor/index.js`. On the current Tix revision, each statement becomes one kernel with one active thread per output element. Each thread evaluates reductions in the IR's stated order. The generated main accepts either one runtime case or a batch. [Revised design](../design-doc/01-checked-cuda-lowering-for-tix.md)

The implementation uses the existing cross-kind `AnalysisManager.execute` and async differential hooks. GPU output must agree in shape and length. At each sampled f64 coordinate `r`, the GPU value `g` must be finite and satisfy `abs(g-r) <= 2e-6 + 2e-5*abs(r)`. The framework source required zero edits.

On the GB10, `node --test tests/tensor/*.test.mjs` passed all 26 tests. The GPU file checked the six original and optimized functions, exact arithmetic and reduction witnesses, empty dimensions, parameter returns, shadowing, transposed inline reads and JavaScript extrema. It also rejected altered CUDA source, rejected an f32-correct result outside the f64 budget, replayed decided cases with the existing memo and ran concurrent jobs with the same compile key and distinct inputs. `npm run build` passed. [Implementation diary](01-implementation-diary.md)

The GPU calibration reused the contract’s case generator on the six corpus functions and each of four pass sequences. Every variant passed. The largest error was 24.67% of the tolerance on conv2d, equal to the CPU f32 calibration maximum. [GPU calibration](../scripts/03-corpus-calibration-gpu.jsonl)

## Corpus timings

Both engines processed the original corpus functions with the same finite row-major f32 inputs. Seed 20 supplies values in `[-0.25, 0.25)` and layernorm uses epsilon `1e-5`. The CPU measurement is one full-size Stage 1 `runTix` call after a smaller warm-up on Node 24.18.0, x64 Intel Core i7-1165G7. It includes the interpreter's buffer allocations and final result. The GPU numbers are the median of five CUDA-event intervals after one warm-up in the same process, with preloaded kernels and input already on device. The lock covers each measured job. Compilation, launch setup before the event pair, and data transfers are outside the GPU interval. The target was NVIDIA GB10 sm_121 with nvcc 13.0.88 and driver 580.178.04. [Engine probe](../scripts/01-gb10-probe/observed.json)

| Program | Shapes | GB10 kernels (ms) | f32 interpreter (s) | Max absolute difference |
| --- | --- | ---: | ---: | ---: |
| matmul | M=512, K=512, N=512 | 0.242 | 176.436 | 0 |
| softmax | N=4096, C=1024 | 0.906 | 15.211 | 4.66e-10 |
| layernorm | N=4096, D=1024 | 0.681 | 25.442 | 0 |
| attention | Q=1024, K=1024, D=64, V=64 | 0.878 | 197.902 | 8.38e-09 |
| mlp | N=1024, D=256, H=1024, O=256 | 0.979 | 819.716 | 1.43e-06 |
| conv2d | N=8, C=16, H=64, W=64, O=32, 3 × 3 kernel | 0.201 | 390.126 | 0 |

The final column compares the full-size GPU output with the CPU f32 output element by element. CPU values are single wall-clock readings on a shared machine. [Raw intervals and runner metadata](../scripts/04-benchmark-results.json)

## Reproduce

Run from the repository root after `npm run build`.

```sh
node ttmp/2026/11/26/IRWB-022-B--*/scripts/03-corpus-calibration.mjs --gpu
node ttmp/2026/11/26/IRWB-022-B--*/scripts/04-benchmark.mjs cpu /tmp/irwb-bench
node ttmp/2026/11/26/IRWB-022-B--*/scripts/04-benchmark.mjs gpu /tmp/irwb-bench
node ttmp/2026/11/26/IRWB-022-B--*/scripts/04-benchmark.mjs compare /tmp/irwb-bench
```

Run the long CPU benchmark in tmux. The GPU benchmark selects timed mode through `tools/cuda-remote.mjs`, while the sample calibration runs untimed. [Benchmark script](../scripts/04-benchmark.mjs)
