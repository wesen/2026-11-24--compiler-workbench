# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Design ready for review: probed GB10 math and framework async reuse; proposed direct emission and a sampled f64 tolerance. No backend code changed.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-pi-sx-irwb-022-c/ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/design-doc/01-checked-tix-to-cuda-lowering.md — Design and change ledgers

## 2026-11-26

Accepted review: fixed 128-thread blocks, preload kernels before timing and use one in-process warm-up and five repeats. Removed revisioned engine resource and concurrent check coalescing.

## 2026-11-26

Implemented and verified checked CUDA emission and isolated remote builds. Recorded all six GPU and interpreter measurements; each full-size output matched f32. No framework changes.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-pi-sx-irwb-022-c/ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/reference/02-cuda-lowering-results.md — Verification evidence and measurements

## 2026-11-26

Published the final report in the ticket and diagnosed the independent results at 30a13b4. No f32 mismatches; the f64 deltas reflect intentional rounding. The evaluated backend is unchanged.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-pi-sx-irwb-022-c/ttmp/2026/11/26/IRWB-022-C--checked-tix-lowering-to-cuda-on-the-gpu-machine/reference/02-report.md — Independent evaluation, numerical diagnosis and final report
