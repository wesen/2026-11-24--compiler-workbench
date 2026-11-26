---
Title: CUDA lowering results
Ticket: IRWB-022-C
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
    - Path: repo://corpus/tensor/benchmark.mjs
      Note: Runs the fixed workloads and records per-run event and interpreter times
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: GPU semantics, sampled contract evidence and compile cache isolation
ExternalSources: []
Summary: GPU correctness evidence and the six measured baseline workloads.
LastUpdated: 2026-11-26T15:57:53.228336304-05:00
WhatFor: ""
WhenToUse: ""
---

# CUDA lowering results

## Checked emission

`src/tensor/index.ts` exports `cudaSource`, `runTixCuda`, and `checkLowering`. The emitter lowers the selected function in the current executable revision. It materializes one tensor per statement and retains the reduction grouping, including blocks and tails introduced by `split-sum`. The Tix evaluator and optimizer did not change.

The emitted translation unit is a scalar output port of a framework transformation. It needs no new adapter or framework API. The existing async differential delegate sent one batch per corpus function and reused compared case verdicts on a repeat check without running CUDA again. A wrong but runnable candidate was rejected, and a compilation failure did not enter the verdict cache.

| Function | Cases accepted | Maximum observed fraction of the f64 tolerance |
| --- | ---: | ---: |
| matmul | 36 | 0.02887 |
| softmax | 32 | 0.00457 |
| layernorm | 32 | 0.01282 |
| attention | 40 | 0.01472 |
| mlp | 40 | 0.03169 |
| conv2d | 28 | 0.24668 |

These are bounded deterministic checks, not a universal accuracy claim. The f32 secondary comparison handles nonfinite class and signed zero; separate witnesses check reduction order and FMA. See the [design](../design-doc/01-checked-tix-to-cuda-lowering.md) for the budget and GB10 math probe.

## Benchmark method

```sh
npm run build
node --test tests/tensor/*.test.mjs
TIX_TEST_GPU=1 node --test tests/tensor/cuda-gpu.test.mjs
node corpus/tensor/benchmark.mjs
```

The benchmark selects each unoptimized fixture at the sizes in the design. For each program it resets the framework PRNG to seed 20, fills the input buffers in parameter and row-major order with f32 values in [−1,1], and uses `1e-5` for layernorm epsilon. The same f32 words go to both engines. The CPU interval is one `runTix` call on Node 24.18.0 (Intel i7-1165G7), with parsing and input generation outside the measurement.

The GPU is an NVIDIA GB10 `sm_121` on `manuel@bling`, using nvcc 13.0.88 (`-O3 -arch=sm_121`, CUDA runtime/driver API 13000). In one remote process the benchmark preloads kernels, allocates and copies tensors, warms up once, and then measures five repeats around the kernel sequence only. `--timed` locks execution but cannot exclude other untimed clients. The CPU is shared as well; its wall times include scheduling contention. A CPU/GPU ratio is not a comparison between equally provisioned, isolated machines.

## Large workload timings

The five event samples below are from `node corpus/tensor/benchmark.mjs --gpu-only`. Interpreter wall times and full-size output comparisons come from separate runs of the same harness without `--gpu-only`.

| Workload | Sizes | GPU median (ms) | GPU min–max (ms) | CPU wall (ms) | CPU/GPU | Differing f32 words / max abs delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| matmul | M=K=N=512 | 0.1886 | 0.1876–0.1887 | 819,144 | 4,343,838 | 0 / 0 |
| softmax | N=4096, C=1024 | 0.7602 | 0.7561–0.7648 | 67,521 | 88,825 | 0 / 0 |
| layernorm | N=4096, D=1024 | 0.5452 | 0.5440–0.5501 | 97,796 | 179,371 | 0 / 0 |
| attention | Q=K=1024, D=V=64 | 0.9680 | 0.9672–0.9688 | 501,244 | 517,814 | 0 / 0 |
| mlp | N=1024, D=256, H=1024, O=256 | 1.1457 | 1.1379–1.1486 | 1,354,094 | 1,181,864 | 0 / 0 |
| conv2d | N=8, C=16, H=W=64, O=32; 3×3 | 0.3076 | 0.3057–0.3089 | 847,464 | 2,754,655 | 0 / 0 |

All full-size outputs matched the f32 interpreter on these inputs. That observation is separate from the sampled f64 acceptance relation. Standalone GPU runs give a cleaner comparison of event times across the corpus; the medians in the accompanying CPU runs were within 3% of these numbers. These ratios compare interpreter wall time to warmed kernel time, not end-to-end GPU speedup.
