**IRWB-022-G is ready for design review.** Commit `35e01c4b5f8b85d5e2cdf62e4997cdcfd5ddc91e`. The worktree is clean; no production code changed.

- [Ticket](ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/index.md)
- [Design and change ledgers](ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-lowering-tix-statements-to-cuda-with-a-batched-gpu-meaning-check.md)
- [Diary and probe reproduction commands](ttmp/2026/11/26/IRWB-022-G--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/01-implementation-diary.md)

The design emits CUDA directly from the current Tix IR, including rewritten reduction trees. The checked pass compares GPU outputs to the original f64 reference using `abs(gpu − ref) <= 2e-6 + 2e-5*abs(ref)`. On the GB10, `expf(-7.998046875f)` returned `0x39b0390e` versus `0x39b0390f` for the f32 meaning, ruling out bit identity for the proposed implementation. Across six probe expressions at 16,385 inputs each, the largest observed error used **2.11%** of the budget.

**Proposed changes:** Let framework differential checks declare a mandatory asynchronous batch evaluator without a dummy synchronous fallback, reusing the existing evidence cache. Extend `cuda-remote.mjs` to report target identity, key builds by compiler identity and flags, and isolate each run’s outputs while locking compilation per cache key.

Implementation and corpus timings await review.
