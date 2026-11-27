---
Title: Implementation diary
Ticket: IRWB-024
Status: active
Topics:
    - tensor
    - verification
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Pending delegated checks
    - Path: repo://src/tensor/index.ts
      Note: Optimization step reporting
    - Path: repo://tools/cuda-remote.mjs
      Note: Repeatable link flags and cache identity
    - Path: repo://ttmp/2026/11/26/IRWB-024--framework-and-tensor-fixes-f14-f19-f20/scripts/01-cublas-product/main.cu
      Note: CPU-checked SGEMM probe
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T22:07:05.36779357-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## 1. Report what happened to the Tix revision

After `npm run build` on Node 24.18.0, `node --test tests/tensor/passes.test.mjs` passed 4 and failed 3 on the original implementation. Both split steps were accepted, but neither reported whether it changed the revision. The composed inline step also omitted `changed`. The rejected split returned only its name and acceptance flag. Its first counterexample said `at [0] expected 0.5052213072776794, got 0, allowed 0.00001210442614555359`.

Forwarded the native pass result's `changed` flag. A rejection keeps the current revision and uses the first counterexample reason, with the contract diagnostic as the fallback for a gate such as coverage. After rebuilding, all 7 tensor pass tests passed.

## 2. Share a cold delegated batch

After F14 (`ba86419`), the counting fake engine yielded to let two cold checks overlap. On the unfixed framework, `node --test tests/tensor/cuda.test.mjs` passed 3 and failed 1. Both checks submitted the same cases. The batch-count assertion reported `2 !== 1`.

The framework now shares the pending promise for an ordered batch of memoizable cases under the same baseline key. The completion path releases the promise even if the engine throws. Rebuilding and rerunning the same file passed all 4 tests, including a shared failure, a shared successful retry, a cached replay and separate source/profile keys.

## 3. Link cuBLAS through the remote compile cache

After F19 (`a2a8492`), `node --test --test-name-pattern='remote runner links' tests/tensor/cuda-gpu.test.mjs` failed on its first untimed run. The GB10 runner reported exit 97. The linker reported undefined references to `cublasCreate_v2`, `cublasSgemm_v2` and `cublasDestroy_v2` despite the supplied `--link m --link cublas`.

The runner now appends each library as a quoted `-l` argument and includes those arguments in order in the build hash. The regression passed for both `--link m --link cublas` and the reverse order, with distinct hashes.

From the repository root, `node tools/cuda-remote.mjs ttmp/2026/11/26/IRWB-024--framework-and-tensor-fixes-f14-f19-f20/scripts/01-cublas-product --link cublas` compiled on `manuel@bling` and exited 0. The GPU returned `[[19,22],[43,50]]`, equal to the CPU loop at every entry.

Final validation on Node 24.18.0: `npm run build` succeeded, `node --test tests/framework/*.test.mjs` passed 227/227 and `node --test tests/tensor/*.test.mjs` passed 33/33. Both suites reported zero skips.
