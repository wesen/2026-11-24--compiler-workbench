---
Title: CUDA lowering results and corpus timings
Ticket: IRWB-022-F
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Checked CUDA lowering validation and comparison with the stage-1 interpreter.
---

# CUDA lowering results and corpus timings

The [revised design](../design-doc/01-checked-tix-to-cuda-lowering.md) is implemented in `d1d8a7e`. Each current statement is a separate CUDA kernel. Reduction bodies execute sequentially with explicit f32 rounding, including both accumulators of a split sum. The public `runTixCuda` executes one case; `checkLowering` checks a batch against the current Tix revision’s f64 reference, using the f32 fallback for nonfinite reference elements. The assurance is sampled, not a worst-case floating-point bound.

## Validation

- `npm run build`: passed on Node 24.18.0.
- `node --test tests/tensor/*.test.mjs`: 24 passed (19 offline and five GPU tests), 198 s wall time. All six corpus functions passed the sampled check. The GPU tests also checked exact split words (`0x3f800000` sequential, `0x3f800002` split), an inlined transpose and shadowed multi-index reduction, zero work and nonfinite behavior, and rejection of a CUDA mutant that dropped the final term. Concurrent invocations with distinct inputs shared one compile and returned their own outputs.
- No framework source changed, so framework and Typed regression suites were not run. The cross-kind `AnalysisManager.execute` boundary and delegated `differential.decide` already fit the pass, batching and completed-verdict replay. The generic edit pass runner remains same-kind.
- The tool adds `--standalone`: unique run directories, compile lock and source/compiler-keyed executable reuse. The old whole-directory compile-cache mode remains intact.

## Measurements

Run from the repository root after building:

```sh
node ttmp/2026/11/26/IRWB-022-F--*/scripts/02-benchmark.mjs
```

GPU: NVIDIA GB10, `sm_121`, nvcc 13.0.88, compiled with `-O3 -arch=sm_121`. GPU samples are event intervals for all kernels of a function, with buffers already allocated/copied and kernels preloaded. The timed tool invocation used a same-process warm-up and three repeats. Its lock excludes other timed runs but not untimed traffic. CPU: Intel Core i7-1165G7 (2.80 GHz), Node 24.18.0, one whole interpreter call after a small warm-up (three for the initial matmul run). CPU values are elapsed wall time under shared-machine load; they are not dedicated-core timing. Both sides take the same unoptimized function and seed-20 f32 buffers; epsilon is `1e-5`.

| Program | Kernels | GPU event samples (ms) | GPU median (ms) | CPU f32 wall time (s) |
| --- | ---: | --- | ---: | ---: |
| matmul | 1 | 0.229408, 0.232512, 0.228416 | 0.229408 | 514.487 (median) |
| softmax | 4 | 0.462656, 0.457888, 0.463008 | 0.462656 | 38.215 |
| layernorm | 4 | 0.410944, 0.413856, 0.423104 | 0.413856 | 67.373 |
| attention | 6 | 0.899584, 0.890080, 0.890080 | 0.890080 | 313.957 |
| mlp | 3 | 0.979200, 0.967872, 0.967840 | 0.967872 | 871.406 |
| conv2d | 1 | 0.163264, 0.160992, 0.160256 | 0.160992 | 526.903 |

The matmul interpreter runs took 827.310, 514.487 and 327.839 s. Given the runtime and variation on the shared host, the benchmark script now reports one full-sized interpreter call for each program; the three in-process GPU repetitions are unchanged. This table compares interpreter call time to GPU kernel time, not end-to-end GPU API latency. No full-size f64 interpreter runs were performed.
