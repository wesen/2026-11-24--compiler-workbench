**IRWB-022-D is ready for review** at commit `f85f8bca2901`. The worktree is clean; backend implementation and corpus timings remain deferred.

[Ticket](ttmp/2026/11/26/IRWB-022-D--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/index.md) · [Design](ttmp/2026/11/26/IRWB-022-D--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-a-checked-tix-to-cuda-lowering-on-gb10.md) · [Diary](ttmp/2026/11/26/IRWB-022-D--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/01-design-and-implementation-diary.md)

The design emits CUDA directly from the current Tix IR and checks the compiled candidate against the original function’s f64 result. The proposed sampled tolerance is `abs(gpu − ref) ≤ 2e-6 + 2e-5 × abs(ref)`. On the GB10, `expf` differed from the stage-1 f32 result on 2,468 of 8,192 inputs, ruling out bit identity for this implementation. Across all six probe expressions, the largest observed error used less than 3% of the proposed allowance.

**Framework:** No changes proposed. A local probe confirmed that the existing asynchronous differential invariant can delegate a batch, replay its verdicts, and reject changed candidate text.

**Remote tool:** Isolate each invocation’s writable directory so concurrent runs cannot exchange outputs. Retain executable reuse with locked, atomic publication and a compiler-aware cache key.
