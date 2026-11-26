---
Title: CUDA verification and corpus timings
Ticket: IRWB-022-J
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
    - Path: repo://src/tensor/cuda-source.ts
      Note: Device event interval and kernel preloading
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: Remote validation and examples
    - Path: repo://ttmp/2026/11/26/IRWB-022-J--lowering-tix-to-cuda-checked-on-the-gpu-machine/scripts/03-benchmark.mjs
      Note: Reproducible inputs and timing commands
ExternalSources: []
Summary: Focused test results and the six requested CPU and GB10 measurements.
LastUpdated: 2026-11-26T15:54:20.784517064-05:00
WhatFor: ""
WhenToUse: ""
---

# CUDA verification and corpus timings

The measurements use the implementation at `daa175f` and the original corpus functions. The GPU was
`manuel@bling`, NVIDIA GB10 (sm_121), with CUDA runtime 13.0 and `nvcc -O3 -arch=sm_121`.
The local interpreter ran on Node v24.18.0. The benchmark driver derives concrete input shapes from the
function and uses seed 20. It fills tensors with f32 values in [−0.25, 0.25), except for layernorm’s
positive epsilon of 0.00001. The CPU and GPU paths regenerate the same input words.

The GPU column uses the median and range of five intervals after one warmup under `--timed`. Device
allocations, transfers and kernel preloading occur before the timed interval. The CPU column uses one
full-size Stage 1 f32 execution timed with `performance.now()`, after a small warmup. It includes the
interpreter’s own allocations and input conversion. The design planned three CPU observations. The first
full-size matmul took nearly three minutes on the shared machine, so the reported CPU times are single
observations. The ratio compares these two timing boundaries and excludes transport time.

## Verification

- `npm run build` passed. A Node API import check resolved all six fixed functions from
  `dist/tensor/index.js`.
- `node --test tests/tensor/*.test.mjs` passed all 33 tests, including the standalone source cache,
  concurrent remote invocations and output fetch failure. The six corpus functions passed the sampled
  tolerance contract on the GPU. The tests verified distinct output words for an ordered reduction and
  its accepted split, and rejected a valid changed-read CUDA mutant through the actual postcondition.
- Prettier and `git diff --check` passed on the implementation. No framework source changed.

The [benchmark driver](../scripts/03-benchmark.mjs) takes `cpu` or `gpu` and optionally workload names.
GPU benchmark execution began after the tensor test run ended. The exclusive flag coordinates other
timed invocations. Ordinary tool invocations retain their documented lock behavior.

## Full-size timings

| Program | Shape bindings | GB10 median (ms) | GB10 range (ms) | Tix f32 (ms) | CPU / GPU |
| --- | --- | ---: | ---: | ---: | ---: |
| matmul | M=512, K=512, N=512 | 0.246 | 0.244–0.252 | 177,804.0 | 722,264× |
| softmax | N=4096, C=1024 | 0.938 | 0.936–0.944 | 17,332.8 | 18,475× |
| layernorm | N=4096, D=1024 | 0.816 | 0.813–0.817 | 27,367.0 | 33,535× |
| attention | Q=1024, K=1024, D=64, V=64 | 1.119 | 1.117–1.120 | 209,486.2 | 187,148× |
| mlp | N=1024, D=256, H=1024, O=256 | 1.087 | 0.984–1.130 | 828,262.9 | 761,921× |
| conv2d | N=8, C=16, H=64, W=64, O=32 | 0.162 | 0.162–0.165 | 394,404.6 | 2,431,954× |

### Recorded intervals

```jsonl
{"name":"matmul","gpuMs":[0.25228801369667053,0.244159996509552,0.24828800559043884,0.24617600440979004,0.24409599602222443],"cpuMs":177803.987396}
{"name":"softmax","gpuMs":[0.9360640048980713,0.9381759762763977,0.9382399916648865,0.9362879991531372,0.9435840249061584],"cpuMs":17332.787554}
{"name":"layernorm","gpuMs":[0.8155519962310791,0.8130559921264648,0.8160640001296997,0.8173120021820068,0.8173120021820068],"cpuMs":27367.027250000003}
{"name":"attention","gpuMs":[1.120479941368103,1.1191999912261963,1.1193599700927734,1.1193920373916626,1.1174399852752686],"cpuMs":209486.193483}
{"name":"mlp","gpuMs":[1.0870720148086548,0.9842240214347839,1.1297279596328735,1.0871679782867432,1.0851199626922607],"cpuMs":828262.851639}
{"name":"conv2d","gpuMs":[0.16476799547672272,0.16211199760437012,0.1621759980916977,0.1621759980916977,0.16220800578594208],"cpuMs":394404.64381200005}
```
