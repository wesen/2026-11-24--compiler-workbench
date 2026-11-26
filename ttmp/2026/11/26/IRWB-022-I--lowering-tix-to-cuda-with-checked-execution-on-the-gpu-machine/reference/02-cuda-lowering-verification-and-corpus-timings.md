---
Title: CUDA lowering verification and corpus timings
Ticket: IRWB-022-I
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: GB10 contract, mutation, and runner tests
    - Path: repo://ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/scripts/03-benchmark-cuda.mjs
      Note: Reproduces the full-size timings and output digests
ExternalSources: []
Summary: GB10 lowering checks, six CPU and GPU corpus timings, and a reproducible benchmark.
LastUpdated: 2026-11-26T15:54:57.680518881-05:00
WhatFor: ""
WhenToUse: ""
---

# CUDA lowering verification and corpus timings

## Results

| Program | Output shape | Interpreter wall ms | GB10 kernel ms | f32 output bytes |
| --- | --- | ---: | ---: | --- |
| matmul | 512 × 512 | 781,174.296 | 0.215200 | equal |
| softmax | 4096 × 1024 | 61,400.503 | 0.800064 | equal |
| layernorm | 4096 × 1024 | 103,502.860 | 0.484736 | equal |
| attention | 1024 × 64 | 507,205.507 | 1.049984 | equal |
| mlp | 1024 × 256 | 1,285,227.803 | 0.957664 | equal |
| conv2d | 8 × 32 × 62 × 62 | 767,068.147 | 0.164352 | equal |

All six output shapes and SHA-256 digests matched. The equality is for the measured inputs. The lowering contract remains a sampled tolerance against f64.

## Method

The [benchmark script](../scripts/03-benchmark-cuda.mjs) runs the original six Tix functions at the requested shapes. It resets the framework's seeded generator to seed 20 for each function and fills its inputs in declaration order with f32-rounded values in [-0.1, 0.1]. Layernorm uses eps = 1e-5. CPU and GPU runs regenerate identical input words.

The CPU measurement covers one Stage 1 f32 `runTix` call on an Intel Core i7-1165G7 with Node 24.18.0. It includes the interpreter's buffer handling and excludes compilation and input preparation. These are observed wall times on a shared host. Some interpreter runs overlapped. The GB10 uses CUDA 13.0.88, sm_121, `nvcc -O3`, and one `--timed` request per program. The executable preloads kernels, runs one warmup and records the median of three CUDA-event intervals spanning the launches on one stream. Transfers, setup, compilation and SSH are outside that interval. Ordinary callers retain the remote tool's untimed behavior, so an unrelated untimed GPU run can still overlap a measurement.

From the worktree root, run both halves with the same build:

```sh
npm run build
node ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/scripts/03-benchmark-cuda.mjs cpu
node ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/scripts/03-benchmark-cuda.mjs gpu
```

Each output line includes the shape and the SHA-256 of its f32 output bytes, so the two runs can be compared without saving large tensors.

## Verification

`npm run build` compiled the fixed exports. `node --test tests/tensor/*.test.mjs` passed all 29 tests, including ten tests in the isolated GPU file. The local tests verify binary word handling, delegated batch order, reuse and retry. GB10 tests check original and reordered corpus IR, a half-ULP split witness, both valid CUDA mutants, nested binders, empty reductions and output shapes, nonfinite behavior, and a direct parameter return. The runner's concurrent test verifies one compile for two isolated requests and a fresh compile when an included header changes.

The lowering uses the existing transformation and differential APIs. No framework sources changed.
