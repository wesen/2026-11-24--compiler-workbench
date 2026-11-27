# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Schedule IR (tensor.schedule), eight schedule passes under a Strategy IR plan run by the new executeSync, a schedule interpreter as the per-step exact check, and tiled contraction kernels printed from the schedule; attention 0.75 to 0.26 ms, matmul 512 0.21 to 0.08 ms, bit-identical

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-fa-irwb-033-e/src/tensor/schedule.ts — The IR
