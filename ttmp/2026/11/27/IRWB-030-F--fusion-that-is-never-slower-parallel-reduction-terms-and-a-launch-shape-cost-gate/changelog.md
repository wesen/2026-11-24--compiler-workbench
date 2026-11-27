# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Stage 3b implemented: parallel reduction terms (fill in shared memory, serial in-order fold by thread 0, template <bool Shared, bool Staged>), a measured launch-shape cost gate in gatedPlan used by runTixCuda, and the rows cap re-measured at 256. layernorm-inside fused 0.202 ms vs 0.545 unfused; every corpus program fused is faster than unfused, bit-identical. No framework change needed.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-g-h-irwb-030-f/src/tensor/cuda-source.ts — Fill-and-fold emitter, fold mode in kernelWriter, Staged template and host instantiation choice
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-g-h-irwb-030-f/src/tensor/fusion.ts — Staged reductions in the plan, the gate rule and its measured constant, groupCap and the 256 rows cap
