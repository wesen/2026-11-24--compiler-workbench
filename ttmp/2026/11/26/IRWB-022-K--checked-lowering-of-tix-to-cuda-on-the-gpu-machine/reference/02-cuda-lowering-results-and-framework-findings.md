---
Title: CUDA lowering results and framework findings
Ticket: IRWB-022-K
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Async batch-only spec and synchronous guards
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Checked lowering and evidence identity
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: GPU postcondition and numerical witnesses
    - Path: repo://tools/cuda-remote.mjs
      Note: Concurrent compile and execution isolation
ExternalSources: []
Summary: Checked CUDA emission, batch-only framework support, GPU validation and measured timings for six Tix programs.
LastUpdated: 2026-11-26T15:52:13.675309255-05:00
WhatFor: ""
WhenToUse: ""
---

# CUDA lowering results and framework findings

Tix now lowers a function from its current IR to a standalone CUDA C translation unit. Each statement still present after optimization becomes one kernel. One thread computes each row-major output element, with a private sequential accumulator for every reduction. A partial block produced by split-sum starts a fresh inner accumulator. Inlined affine reads retain their composed indices.

The public entry points are `cudaSource`, `runTixCuda` and `checkLowering` in `dist/tensor/index.js` after `npm run build`. The emitter and generated main are in `src/tensor/cuda-source.ts` and `cuda-runtime.ts`. The binary batch codec and Node runner are in `cuda-run.ts`. `cuda-contract.ts` binds the original program, function and actual output text to the GPU postcondition.

## What the checked pass established

All six original corpus functions and all six results of applying inline then split-sum passed the postcondition. Identical source can reuse a verdict. The original f64 evaluator supplies the reference on the same f32 input words, with the stage-1 budget `abs(gpu − ref) ≤ 2e−6 + 2e−5 × abs(ref)` at every coordinate on the comparable cases. The generator requests up to 15 cases at seed 20. Stage 1 limits sample sizes and screens the origin for finite outputs. A function without a comparable case receives a rejected verdict.

The design probe recorded different words for exp, log and tanh on the GB10. Its largest measured error across 196,614 outputs used 0.67% of the budget. Two separate execution checks establish facts that tolerance can miss. The seven-element sum returned `0x3f800000` in source order and `0x3f800002` after split-sum. A compilable CUDA mutant that used floor for the outer block count lost the tail and failed the **actual** transformation postcondition on a positive stream. [Numerical probe](../design-doc/01-checked-cuda-lowering-for-tix.md) · [Regression tests](../../../../../../tests/tensor/cuda-gpu.test.mjs)

## Framework and tool findings

| Changed file | Reason and observed result |
| --- | --- |
| `src/framework/contracts/differential.ts` | The original async path could dispatch missing cases together and replay per-case verdicts, but its type required synchronous execution callbacks. `BatchDifferentialSpec` requires a batch decider and admits the same case and subject keys. The async runner accepts the two spec types through a union. Synchronous and worker-side single-case entry points reject batch-only checks. The focused test verified partial replay, stable counterexample order, a short response and retry after an engine failure. |
| `tools/cuda-remote.mjs` | Identical cold checks could compile into and fetch from the same remote directory. Each invocation now owns its working directory. A per-key compile lock and rename publish one binary for the unchanged full-input key. A cold concurrent pair compiled once and returned byte-identical probe outputs. A third invocation hit the cache. The measurement lock still surrounds the timed program run. |

A warm `checkLowering` replayed verdicts with zero delegated cases. A miss group travels in one binary batch. The checker compares the tool's reported host and the executable's device name, compute capability and runtime version to `manuel@bling`, `NVIDIA GB10`, 12.1 and 13000. The compiler build (nvcc 13.0.88), flags and ABI are constants of checker version 1. The subject key includes the translation digest and expected engine. The baseline key identifies the origin revision and selected function. A failed transport cannot supply a verdict.

## Measurements

The driver generated bounded f32 inputs with seed 20 for the original corpus functions, and set layernorm epsilon to f32(1e−5). The GB10 loaded each kernel with `cudaFuncGetAttributes` before the first event. Each timed process executed one warm-up and three subsequent intervals with the same data. GPU time is the median event duration for the statement kernel sequence. The local Node 24.18.0 interpreter ran one full-size f32 call after a small warm-up. Its wall time includes interpreter allocation and execution on the shared machine. Input generation, compilation and network transfer are outside both columns. The ratio compares interpreter wall time with GPU kernel-sequence time.

| Program | Shape bindings | GB10 kernel sequence (ms) | Interpreter (s) | CPU time / GPU time |
| --- | --- | ---: | ---: | ---: |
| matmul | M = K = N = 512 | 0.2497 | 128.819 | 515,835× |
| softmax | N = 4096, C = 1024 | 0.4528 | 15.317 | 33,827× |
| layernorm | N = 4096, D = 1024 | 0.4354 | 24.689 | 56,701× |
| attention | Q = K = 1024, D = V = 64 | 0.9828 | 195.979 | 199,399× |
| mlp | N = 1024, D = 256, H = 1024, O = 256 | 0.9924 | 812.828 | 819,039× |
| conv2d | N = 8, C = 16, H = W = 64, O = 32, kernel 3 × 3 | 0.1700 | 405.719 | 2,385,909× |

The raw records include the device warm-up and all three intervals, the return shapes and the first output element. The benchmark observations are separate from the contract's coordinate-wise comparisons. [Benchmark driver](../scripts/04-benchmark.mjs) · [GPU measurements](gpu-times.jsonl) · [Interpreter measurements](cpu-times.jsonl)

## Validation

- `npm run build` succeeded. The emitted public signatures include the optional host, f32 result buffer, event milliseconds and checked verdict.
- `node --test tests/tensor/*.test.mjs` passed all 29 tests, including the separate GPU test file. Tests exercise the public functions, output framing, zero extents, shadowed binders, NaN propagation and zero signs.
- `node --test tests/framework/*.test.mjs` passed all 227 tests.
- `node --test tests/typed/{meaning-memo,parallel,passes,program,mutate,strategies}.test.mjs` passed all 37 tests.
- `node --test tests/typed/{evaluate-analyses,tape,specialize,f32,bytecode-vm,candela}.test.mjs` passed 22 tests. The suite skipped its opt-in whole-program Candela O2 check, documented as a half-hour workload. In total, 59 Typed tests passed and one skipped.
- The isolated runner probe validated the compile receipts and the SHA-256 of all three returned result files. [Concurrency probe](../scripts/05-concurrent-runner.mjs)

The implementation represents the designed async overload as a union parameter on the existing function. The calling behavior, numerical relation, thread mapping and reviewed timing protocol match the revised design.
