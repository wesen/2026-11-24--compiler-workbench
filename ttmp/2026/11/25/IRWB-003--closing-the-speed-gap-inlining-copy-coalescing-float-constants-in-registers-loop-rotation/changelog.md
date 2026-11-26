# Changelog

## 2026-11-25

- Initial workspace created

## 2026-11-25

Intern guide (design-doc 01) written, revised after a second reading (layout weights from block frequencies; rotation of non-exit headers), uploaded to /ai/2026/11/25/IRWB-003; baselines recorded in various/01-04

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a5888d4d3c671b653/ttmp/2026/11/25/IRWB-003--closing-the-speed-gap-inlining-copy-coalescing-float-constants-in-registers-loop-rotation/design-doc/01-intern-guide-closing-the-speed-gap-with-inlining-copy-coalescing-constants-in-registers-and-loop-rotation.md — the guide

## 2026-11-25

Backend options chains, coalesce, homes (backendExtras, absent from images at their defaults), block frequencies and estimate, per-function choice; rotate pass. Corpus under O2+, rotate, cfg with all options: 910,718 -> 767,343 instructions, 0 slower, 6,986/6,986 agree

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a5888d4d3c671b653/src/typed/backend/variants.ts — per-function choice by the estimate
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a5888d4d3c671b653/src/typed/rotate.ts — the rotate pass
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a5888d4d3c671b653/tests/typed/speed.test.mjs — the tests

## 2026-11-26

inline pass (whole program, record results as locals, provenance to callee and call); speed pipeline (named speed, not O3: a frozen test refuses O3); presets speed and fastest-all; RV32 options row. Corpus under speed with all options: 910,718 -> 728,450 instructions, 0 slower, all agree; Blend 370, sort 1824

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a5888d4d3c671b653/src/typed/inline.ts — the inline pass
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a5888d4d3c671b653/tests/typed/inline.test.mjs — inline tests

## 2026-11-26

Merged irwb-001/import-v6-prototype at 1f45c94 (IRWB-004, IRWB-006); gates identical on the merged tree; rules comparison extended to speed (792 steps, no difference). Candela per scene (speed with dfe after inline, three options): B-01 8,267.7 per pixel (kernel 8,501; O2+ 10,435), R-01 18,186.7 (kernel 15,655.9; O2+ 22,850.9), frames bit-identical. Machine failure at 01:39 cut off the first merged run; R-01 and the general program re-run under a 14G memory cap

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a5888d4d3c671b653/ttmp/2026/11/25/IRWB-003--closing-the-speed-gap-inlining-copy-coalescing-float-constants-in-registers-loop-rotation/scripts/08-candela-scene-speed.mjs — per-scene measurement
