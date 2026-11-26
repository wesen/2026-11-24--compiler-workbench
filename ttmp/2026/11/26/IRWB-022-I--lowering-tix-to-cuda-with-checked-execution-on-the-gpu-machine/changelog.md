# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Proposed direct CUDA emission and an async cross-kind contract using batched f64 comparisons. Recorded GB10 arithmetic and reduction probes and opened the design for review.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sh-irwb-022-i/ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/design-doc/01-checked-tix-to-cuda-lowering.md — Design proposal
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sh-irwb-022-i/ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/reference/01-implementation-diary.md — Evidence and replay commands

## 2026-11-26

Revised the design after review to use framework differential batching and evidence reuse, preload kernels before public timing, and keep runner changes focused on build reuse and per-request isolation.
