Committed the design as `8b56655` on `t2-am/irwb-022-a`. The worktree is clean. [Ticket](ttmp/2026/11/26/IRWB-022-A--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/index.md) · [Design](ttmp/2026/11/26/IRWB-022-A--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-checked-cuda-lowering-and-numerical-evidence.md) · [Diary](ttmp/2026/11/26/IRWB-022-A--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/01-design-diary.md)

The design emits CUDA directly from the current Tix IR, including optimized programs. It checks the emitted source against the original program’s f64 reference using `abs(gpu − ref) ≤ 2e-6 + 2e-5 × abs(ref)`.

The GB10 probe found bit differences from stage-1 f32 in `expf`, `logf`, and `tanhf`. All 98,304 sampled outputs passed the tolerance. The largest error used 0.967% of the allowance, in a seven-term sequential reduction.

- **Framework:** No source change proposed. A transformation probe delegated two cases in one async batch and replayed both verdicts on the second check.
- **Remote tool:** Give each invocation a private working directory and publish cached executables atomically under a per-hash lock. This preserves compile reuse and prevents concurrent runs from overwriting each other’s outputs before retrieval.

The baseline build and ticket validation passed. Implementation and the six paired timing measurements await design review.