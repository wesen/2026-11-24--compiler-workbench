[IRWB-022-C ticket](ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/index.md) · [Design](ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/design-doc/01-checked-tix-to-cuda-lowering.md) · [Diary](ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/reference/01-implementation-diary.md)

The design emits CUDA directly from the current Tix IR. **No framework changes are proposed:** the existing transformation and async differential APIs support batched checks and verdict reuse. For `tools/cuda-remote.mjs`, the design proposes opt-in source-only compile caching, isolated run directories, and locked, atomic publication of compiled binaries.

The lowering uses a **sampled tolerance against the immediate input revision’s f64 result**: `2e-6 + 2e-5 × |reference|`. On GB10, the probe tested 98,181 inputs per intrinsic under `nvcc -O3 -arch=sm_121`. CUDA’s float `exp`, `log`, and `tanh` differed from Node’s f32-rounded results; widened operations had no sampled mismatches and used at most 0.30% of the proposed tolerance. That supports the tolerance, not a general bit-identity claim.

Committed as `57afcc9702e0db3a60a0aee5564d6c5b8576aa63`. The worktree is clean. Implementation and corpus timings await review.
