---
Title: CUDA lowering results and timing protocol
Ticket: IRWB-022-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/05-benchmark.mjs
      Note: Full-size interpreter and timed GPU driver
    - Path: repo://ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/scripts/06-budget.mjs
      Note: Small-case error audit
ExternalSources: []
Summary: Numerical evidence, full-size GB10 kernel event timings and local interpreter wall times.
LastUpdated: 2026-11-26T15:59:00-05:00
WhatFor: Interpret and reproduce the checked lowering measurements.
WhenToUse: When comparing a subsequent lowering to this one-thread-per-element baseline.
---

# Checked CUDA baseline

The implementation exports `cudaSource`, `runTixCuda` and `checkLowering` from `dist/tensor/index.js`. Each materialized statement of the selected current revision has one kernel; each reduction has a private, ordered scalar fold. `checkLowering` is the checked transformation path. It tests the **emitted unit** on the GB10, not the source twice. The Tix revision is not replaced, and acceptance says nothing about untested inputs. Source and runner: `src/tensor/cuda-{source,runtime,run,check}.ts`, backend commit `abcbdfd`. Review changes and design rationale are in the [design](../design-doc/01-lowering-tix-statements-to-cuda-with-a-batched-gpu-meaning-check.md).

## Observed budget, not an error bound

`abs(gpu-r) <= 2e-6 + 2e-5*abs(r)`, with `r` from the origin in f64 on the same f32 input. All six GB10 corpus checks passed. A separate untimed audit with the same sampler (seed 20, no optimizer passes) read all outputs. Here **use** is the largest `abs(gpu-r)/(2e-6 + 2e-5*abs(r))` across the returned elements of the eligible cases; a value over 1 would fail. The design probe had already ruled out exact with the chosen `expf` implementation. The budget did not change after measuring the corpus.

| Program | Eligible cases | Worst use | Witness (stream; shape values in sorted-symbol order; flat coordinate) |
| --- | ---: | ---: | --- |
| matmul | 15 | .02887 | signed; 7,7,7; 19 |
| softmax | 15 | .00638 | signed; 3,5; 7 |
| layernorm | 14 | .01282 | positive; 7,7; 18 |
| attention | 15 | .01000 | signed; 7,7,7,7; 43 |
| mlp | 15 | .03253 | signed; 7,7,7,7; 9 |
| conv2d | 12 | .24668 | signed; 7,7,7,7,7; 699 |

The tightest measured element was in conv2d: f64 `0.05228970081938111`, GPU `0.052288949489593506`. This tests address mapping and a multi-index fold as well as float error. An acceptance-only count would hide how close the values came to the budget. For evidence against a false positive, the GPU tests changed the emitted split loop's block count from ceil to floor: framework verification rejected the unit and recorded a differing coordinate. The unmodified blocked K=7 witness still returned its expected **changed** f32 word.

## Full-size measurements

Local CPU: host `f`, i7-1165G7, Node v24.18.0. Compile the original fixture, allocate/generate inputs (seed 22), warm the unchanged stage-1 interpreter on a small shape, then time **one full** f32 `runTix` with `performance.now()` on the same input bytes used on the GPU. This includes interpreter copying/materialization, not input generation or reading/writing the results. These are elapsed times on a shared machine, not isolated single-core throughput. Other activity can lengthen them substantially (8 logical CPUs; load average over 30 during the attention run). No extrapolation or compiled CPU substitute.

Device: NVIDIA GB10, sm_121, nvcc 13.0.88, `-O3 -arch=sm_121` without fast math. `--timed -- --benchmark` locks only the tool's program run. The main preloads all kernels with `cudaFuncGetAttributes`, uploads inputs once, warms one sequence, then records three event intervals on the launch stream using the same buffers. The interval covers the ordered kernel sequence, not allocation, H↔D, startup, compilation or SSH. Return the median, not the tool's `runMs`. These two columns measure different boundaries; the ratios would **not** be end-to-end speedups.

| Program and bindings | Three GPU intervals (ms) | GPU median (ms) | Interpreter (ms) | Max abs vs interpreter | Input SHA-256 prefix |
| --- | --- | ---: | ---: | ---: | --- |
| matmul M=K=N=512 | .230080, .233792, .229664 | .230080 | 120,606 | 0 | `2849fcfe20f9` |
| softmax N=4096 C=1024 | .454080, .452864, .461984 | .454080 | 18,581 | 3.49e-10 | `118d998a21cb` |
| layernorm N=4096 D=1024 | .434496, .434880, .560256 | .434880 | 32,522 | 0 | `e79e614f911c` |
| attention Q=K=1024 D=V=64 | .895200, .888064, .889216 | .889216 | 860,698 | 9.31e-9 | `7e30c3b16faf` |
| mlp N=1024 D=256 H=1024 O=256 | .847904, .852480, .852032 | .852032 | 1,655,120 | 1.43e-6 | `27028269bac2` |
| conv2d N=8 C=16 H=W=64 O=32, 3×3 | .163776, .160928, .160192 | .160928 | 456,591 | 0 | `3d9fa8851f48` |

### Reproduce

From the worktree root, with SSH configured for the tool and `npm run build` complete:

```bash
P=$(echo ttmp/2026/11/26/IRWB-022-G*/scripts)
d=$(mktemp -d)
node "$P/05-benchmark.mjs" cpu "$d"
node "$P/05-benchmark.mjs" gpu "$d"
node "$P/05-benchmark.mjs" compare "$d"
node "$P/06-budget.mjs"
rm -rf "$d"
```

`compare` checks all returned elements against the local f32 output (a diagnostic, **not** the small-case f64 contract). The benchmark tool reads checked-in Tix files, not special CUDA versions. Its stdout includes the full input digest; no data files are committed.

## Framework result

`src/framework/contracts/differential.ts` needed a batch-only spec: `decide` required, no dummy `run` or `compare`. It rejects local execution/worker extraction for such engines. The existing asynchronous tally and case/verdict memo already handle ordered delegation and replay; no other framework code changed. Usage is documented in `src/framework/contracts/README.md`. Distinct input and output ports and asynchronous guarantee verification already fit via `defineTransformation`/`AnalysisManager`. The remote tool changes are separate: per-invocation upload/output directories, locked publication of a full-input/compiler-build/flags-keyed binary, and checked output fetch. No hardware query on replay. Tix cache keys assume the deployment behind a configured target stays stable during the process.

## Validation

`npm run build` passed. `node --test tests/tensor/*.test.mjs`: 31 passed (GPU tests isolated in `cuda-gpu.test.mjs`). `node --test tests/framework/*.test.mjs`: 227 passed. `node --test tests/typed/{meaning-memo,parallel,evaluate-analyses,passes,mutate,strategies}.test.mjs`: 36 passed. The original corpus and interpreter sources were unchanged. The built algorithm and contract follow the revised design; the benchmark driver separates execution from the offline full-size output comparison so neither clock includes that work.
