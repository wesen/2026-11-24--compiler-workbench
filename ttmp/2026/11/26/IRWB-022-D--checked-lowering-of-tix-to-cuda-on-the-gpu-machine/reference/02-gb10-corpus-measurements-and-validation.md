---
Title: GB10 corpus measurements and validation
Ticket: IRWB-022-D
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
      Note: Live kernel, contract and mutant checks
    - Path: repo://ttmp/2026/11/26/IRWB-022-D--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/03-measure.mjs
      Note: Reproduce full-size CPU and GPU measurements
    - Path: repo://ttmp/2026/11/26/IRWB-022-D--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/04-error-budget.mjs
      Note: Observe small-batch error margins
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T15:52:21.319641605-05:00
WhatFor: ""
WhenToUse: ""
---

# GB10 corpus measurements and validation

Revision `243da40`. These are the original (unoptimized) six corpus files, run at the requested sizes. The GPU column is **not** elapsed SSH time. The interpreter column is **not** compiled native CPU code.

| Program, input bindings | Returned shape | GPU event samples (ms) | GPU median (ms) | Local f32 wall (s) | Max abs difference vs local f32 (flat index) |
|---|---|---|---:|---:|---|
| matmul M=K=N=512 | 512×512 | .176832, .177952, .175904 | .176832 | 187.734 | 0 |
| softmax N=4096 C=1024 | 4096×1024 | .508640, .501312, .492128 | .501312 | 15.255 | 3.49e-10 (155708) |
| layernorm N=4096 D=1024 | 4096×1024 | .515616, .509856, .516928 | .515616 | 25.047 | 0 |
| attention Q=K=1024 D=V=64 | 1024×64 | .888896, .903200, .902368 | .902368 | 302.965 | 4.19e-9 (14443) |
| mlp N=1024 D=256 H=1024 O=256 | 1024×256 | .785760, .743168, .739232 | .743168 | 2116.759 | 5.96e-8 (3671) |
| conv2d N=8 C=16 H=W=64 O=32, 3×3 | 8×32×62×62 | .172576, .176512, .172064 | .172576 | 506.913 | 0 |

Host: Intel i7-1165G7, Node 24.18.0, x86-64 Linux. The machine was heavily shared; the single local wall measurement includes scheduling delays. In each program, shape symbols are specialized before timing; a small size-4 call warms `runTix` before one full f32 evaluation (including its normal intermediate allocations). GPU: `manuel@bling`, NVIDIA GB10 sm_121, CUDA 13.0, nvcc V13.0.88, `-O3 -arch=sm_121`. One `--timed` invocation per program, with three same-input cases. Each case runs a warm chain, synchronizes, then times its next chain with CUDA events, no transfers. Each engine starts the same mulberry32 stream (seed 22 per program), f32 values in [-0.1,0.1] with eps fixed to f32(1e-5). No locked run for contract checks. Wall and kernel columns describe different costs; their ratio is not end-to-end speedup.

### Numerical evidence on the contract batches

These are distinct from the large performance runs: bounded, origin-derived test calls, f64 reference on f32 inputs, budget `2e-6 + 2e-5*abs(ref)`. Maxima are measured over **all** returned elements. The six checks accepted without adjusting the budget.

| Program | Cases | Largest fraction of allowance used |
|---|---:|---:|
| matmul | 24 | .028871 |
| softmax | 21 | .006379 |
| layernorm | 20 | .012821 |
| attention | 24 | .010000 |
| mlp | 27 | .032531 |
| conv2d | 21 | .246678 |

Worst: conv2d signed stream, all symbols 7, element 699: device 0.052288949489593506 vs origin f64 0.05228970081938111. The contract rejected a compiled split-sum tail mutant. An unchanged split-sum lowering on the seven-term witness produced 1.000000238418579 rather than the unblocked result 1: sequential **within the current reduction tree**, not a new reassociation by the emitter.

### Reproduce

```bash
npm run build
node --test tests/tensor/*.test.mjs
D=$(echo ttmp/2026/11/26/IRWB-022-D--*/scripts)
R=$(mktemp -d)
node "$D/04-error-budget.mjs"
node "$D/03-measure.mjs" cpu "$R"
node "$D/03-measure.mjs" gpu "$R"
node "$D/03-measure.mjs" compare "$R"
```

Build succeeded. Final tensor run on the live profile: **32/32 passed**, including 11 in `cuda-gpu.test.mjs`. For offline tests omit that file. Typed and framework regressions were not needed (no files in those domains changed). No full suite or push.
