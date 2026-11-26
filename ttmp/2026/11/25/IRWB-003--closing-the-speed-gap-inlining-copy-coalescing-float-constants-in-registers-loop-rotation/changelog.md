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
