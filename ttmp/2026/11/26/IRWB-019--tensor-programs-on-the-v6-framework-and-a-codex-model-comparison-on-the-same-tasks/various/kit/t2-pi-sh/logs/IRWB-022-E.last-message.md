Committed the design for [IRWB-022-E](ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine/index.md), including the [design document](ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine/design-doc/01-direct-cuda-emission-and-batched-lowering-checks.md) and [diary](ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine/reference/01-implementation-diary.md).

- **Framework:** No changes proposed. Emit CUDA directly from the current Tix IR and use the existing v6 transformation and asynchronous differential checks to batch cases and reuse evidence.
- **Remote tool:** Separate runtime inputs from the compile cache key, isolate each run, report the GPU and toolchain identity, and make untimed runs respect the benchmark lock.
- **Relation:** Use `2e-6 + 2e-5 × |reference|` against the original program’s f64 result. The GB10 probe found bit mismatches against JS f32 for `expf`, `logf`, and `tanhf`. The worst finite error across the scalar and 1,024-element softmax probes used 0.655% of the tolerance budget. This supports a sampled check, not an all-input guarantee.

Commit: `df8c23e2db236e905a929c3c4e40a5066afb4900`. The worktree is clean. Backend implementation and corpus timings await review.
