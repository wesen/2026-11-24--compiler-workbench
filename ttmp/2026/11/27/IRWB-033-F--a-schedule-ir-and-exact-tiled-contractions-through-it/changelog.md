# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Stage 6 built: a schedule IR (tensor.schedule) between Tix and CUDA as a v6 artifact; tile-contraction and double-buffer as checked passes preserving the schedule-order analysis; a meaning-ordered property on the final schedule; the emitter prints schedules and gained the tiled contraction kernel (masked, launch-dispatched, exact); matmul 0.076 ms at 512^3 (2.9x) and 19.0 ms at 4096^3 (7x); all other corpus kernels byte-identical to the base; one framework change (sync preservation in applyNativePassSync)

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-g-h-irwb-033-f/src/framework/passes/define-pass.ts — applyNativePassSync checks preserves synchronously
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-g-h-irwb-033-f/src/tensor/cuda-source.ts — The emitter prints schedules; the tiled contraction kernel
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-g-h-irwb-033-f/src/tensor/schedule.ts — The schedule IR, passes, order analysis, property and strategy
