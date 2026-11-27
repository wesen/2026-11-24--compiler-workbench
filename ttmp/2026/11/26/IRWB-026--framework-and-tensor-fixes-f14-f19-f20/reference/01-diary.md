---
Title: Diary
Ticket: IRWB-026
Status: active
Topics: []
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Differential memo
    - Path: repo://src/tensor/index.ts
      Note: Tix step reporting
    - Path: repo://tools/cuda-remote.mjs
      Note: Remote linker options
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T22:13:11.47058452-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Report optimization decisions

Node v24.18.0 and the initial `npm run build` worked. The first test fixture rejected during coverage screening and had no counterexample. The revised fixture supplies a covered origin and a current program whose split candidate disagrees with it.

Before the fix, `node --test tests/tensor/passes.test.mjs` reported 5 passes and 2 failures. The new regression's deep equality check found neither `changed` nor the counterexample reason (`at [0] expected 0.5052213072776794, got NaN, allowed 0.00001210442614555359`). The updated composition assertion also found no `changed: true`.
After the fix, the build and all 7 pass tests succeeded. Accepted steps use the native pass result. Rejected steps report the first counterexample, or the gate error when screening provides no counterexample.

## 2. Share in-flight differential verdicts

F14 was committed as `3977b0b`. The F19 regression starts two cold checks together, first with a simulated transport failure and then with a successful retry.

Before the fix, `node --test tests/tensor/cuda.test.mjs` reported 3 passes and 1 failure. The batch-count assertion found `2 !== 1` for the concurrent failed checks.
After the fix, the build and all 4 CUDA unit tests passed. The memo shares promises by case key, writes successful verdicts once, and clears pending entries on either outcome. Active entries stay discoverable during memo eviction. A delayed fake-engine probe kept one batch active while four other baseline keys filled the memo, then joined it without issuing another batch.

## 3. Link libraries through the CUDA runner

F19 was committed as `d4f7283`. The runner regression now compares build hashes with zero, one and two library options using the same source files.

Before the fix, `node --test --test-name-pattern 'remote runner' tests/tensor/cuda-gpu.test.mjs` failed its only test. The no-library build and the `--link cublas` build both returned hash `a705b565cb886647e641a91ca4102e20995f014d28c423326ae80f3300ce7573`. This run also verified that the test could spawn Node and reach the GPU host.

The runner passes each library to nvcc in argument order and includes the resulting flags in the build key. With no libraries, the original key is preserved.

From the repository root, `node tools/cuda-remote.mjs ttmp/2026/11/26/IRWB-026--framework-and-tensor-fixes-f14-f19-f20/scripts/01-cublas-probe --link cublas` exited 0 on the GB10. All four results matched the CPU computation exactly, yielding `[76, 100, 103, 136]` in column-major order. The first invocation compiled in 700 ms. The second reused the same hash with `compiled: false`. Neither invocation took the timed GPU lock.

The final `npm run build` succeeded. The final `node --test tests/framework/*.test.mjs tests/tensor/*.test.mjs` completed with 259 tests passed and zero failures, skips, or cancellations.
