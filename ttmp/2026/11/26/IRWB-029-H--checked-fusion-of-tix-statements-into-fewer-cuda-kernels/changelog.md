# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Stage 3 complete: the fused lowering, checked under the exact relation, with kernel counts, bytes and timings

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-ds-x-irwb-029-h/src/tensor/cuda-contract.ts — A lowering definition per lowering, same invariant
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-ds-x-irwb-029-h/src/tensor/cuda-source.ts — One scalar emitter for both lowerings and the block-per-row kernel
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-ds-x-irwb-029-h/src/tensor/fusion.ts — The plan, its rules and the staged-read predicate

## 2026-11-26

No framework or tool source changed: the heterogeneous transformation, the differential invariant and the runner's isolation were sufficient.
