---
Title: CUDA lowering results and corpus measurements
Ticket: IRWB-022-A
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Checked transformation and verdict keys
    - Path: repo://src/tensor/cuda-run.ts
      Note: Binary batch transport
    - Path: repo://src/tensor/cuda-source.ts
      Note: Kernel and driver generation
    - Path: repo://tools/cuda-remote.mjs
      Note: Compile and run isolation
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:51:09.952996782-05:00
WhatFor: ""
WhenToUse: ""
---

# CUDA lowering results and corpus measurements

The checked lowering emits one kernel per statement from the current Tix function. All six original corpus functions passed the remote check against their origin in f64. Exact f32 equality is too strong for CUDA's expf, logf and tanhf. The design probe found the largest difference from f64 across 98,304 scalar observations used 0.967% of the stage-1 allowance. The chosen sampled contract requires a matching shape and a finite result within 2e-6 + 2e-5 × |reference| for each element.

## Framework and runner findings

There were zero edits to src/framework. The same-representation pass runner cannot describe a Tix-to-source transformation with its single adapter. A transformation with TixIR inputs and a text output supplied the needed pass boundary. The differential invariant receives the actual output text, selects cases and references from the original function and delegates all missing indices to one async batch. Its built-in replay recognized the same baseline revision, function and source on the second check. Both checker and engine version are assumed stable for the lifetime of the process.

The change to tools/cuda-remote.mjs isolates uploads, runtime outputs and downloads for simultaneous calls with identical content. A per-hash lock serializes cache creation and a rename publishes the compiled executable. The cold-cache experiment returned identical complete outputs for both concurrent runs, with one compilation. Benchmarks use the existing timing lock.

The local tests exercise truncated, extra and missing results at the binary decoder. Rejection, replay and candidate changes are tested against the actual GPU through the transformation instead of injecting a fake runner. The test mutation replaces the final store with zero. It remains valid CUDA, compiles successfully and produces a coordinate-level differential counterexample.

## Timing method

Run scripts/04-measure.mjs from the worktree root, once with cpu and once with gpu. Both executions use the original (unoptimized) corpus and the same deterministic seed 20 for each program. Values are f32 in [-1,1], with layernorm eps set to 1e-5. The local time is one Node 24.18.0 runTix wall interval after a four-element-per-symbol warm-up. It includes interpreter tensor materialization. Local measurements were taken on the shared machine and are single observations.

The GPU time is the median of three CUDA event intervals on the GB10 after one warm-up, in one process under --timed. Each interval contains the whole function's kernel sequence. Every launchable kernel has been loaded via cudaFuncGetAttributes before event recording. Input staging, device allocation, result retrieval, startup and compilation lie outside the intervals. The raw timing and output spot checks are in [cpu.jsonl](cpu.jsonl) and [gpu.jsonl](gpu.jsonl). The large runs record output shape and endpoints; the separate small contract runs compare every element.

An additional live check applied optimizeTix(program, ['inline','split-sum']) to each fixture and passed the resulting program to checkLowering. Both requested steps were accepted for every function. The current revision changed in five fixtures. Conv2d retained its original revision because it has a single multi-index reduction and no pointwise producer. All six resulting programs passed the CUDA contract.

## Measured times

| Program | Result shape | GB10 kernel median (ms) | Local f32 interpreter (s) |
| --- | --- | ---: | ---: |
| matmul | 512 × 512 | 0.249888 | 139.604 |
| softmax | 4096 × 1024 | 0.509792 | 15.800 |
| layernorm | 4096 × 1024 | 0.467584 | 25.380 |
| attention | 1024 × 64 | 1.003040 | 192.660 |
| mlp | 1024 × 256 | 0.925056 | 813.613 |
| conv2d | 8 × 32 × 62 × 62 | 0.162048 | 399.577 |

All shapes matched the requested computations. Both endpoints agreed within the chosen numeric allowance in every run. The small-case check uses f64 as its reference; these large-case spot checks use local f32.
