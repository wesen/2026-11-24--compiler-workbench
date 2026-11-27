# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Design: fusion lives in a planner over the Tix IR that the emitter consumes; a Tix pass and a kernel-IR artifact are rejected with reasons, and the many-to-one correspondence gap is recorded from a probe.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-ds-h-irwb-029-g/ttmp/2026/11/26/IRWB-029-G--checked-fusion-for-tix-on-the-gb10/design-doc/01-checked-fusion-of-tix-statements-into-fewer-kernels.md — Design

## 2026-11-26

Implemented, tested and measured: fusion in a planner the emitter consumes; all six corpus programs fuse to one kernel and stay word-identical to stage 2 at full size; 24 contract verdicts exact; 198 fuzz cases identical; no framework change needed.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-ds-h-irwb-029-g/src/tensor/cuda-source.ts — Fused and unfused emission
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-ds-h-irwb-029-g/src/tensor/fusion.ts — Fusion planner

## 2026-11-26

Final report: fusion ledger, kernel counts, benchmark times, counted global traffic against the 244 GB/s floor, contract cost, and the framework finding that today's CUDA output port cannot name kernels.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-ds-h-irwb-029-g/ttmp/2026/11/26/IRWB-029-G--checked-fusion-for-tix-on-the-gb10/reference/02-report.md — Final report

## 2026-11-26

Ticket closed
