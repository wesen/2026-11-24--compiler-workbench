# Changelog

## 2026-11-25

- Initial workspace created

## 2026-11-25

Baselines at 420d8e1: corpus revision listing; Candela r0 cost profile (no-change pass 13.3 s, cfg 25.2 s); Candela O2 with full revisions and evidence (12 min 6 s, 5.79 GB); npm test 322/325 pass, 3 skipped; parity 6986 agree; IRWB_FULL 21/21. Intern guide written, second-pass revised and uploaded to reMarkable (/ai/2026/11/25/IRWB-004).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-ace75c1737b051a8c/ttmp/2026/11/25/IRWB-004--cheap-experiments-cached-origin-outcomes-functions-as-the-unit-of-change-workers-and-a-worker-for-the-workbench/design-doc/01-intern-guide-cheap-experiments-in-the-ir-workbench.md — the intern guide
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-ace75c1737b051a8c/ttmp/2026/11/25/IRWB-004--cheap-experiments-cached-origin-outcomes-functions-as-the-unit-of-change-workers-and-a-worker-for-the-workbench/various/04-candela-o2-baseline.json — the reference for identical revisions and evidence

## 2026-11-26

Increments 1-4: A1-A7 (9d3ea30), F1 records keep identity (8e81345), D1 + F4 contract pool + evaluator memory reuse (bc5690c), F4 browser engine worker + SHA-256 window fix (bc821fa). Candela O2 12:06 -> 3:27 with identical revisions and evidence; contract 46.7 s -> 9.1 s local, 4.6 s on 4 warm workers; worker renders hold the page at most 116 ms.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-ace75c1737b051a8c/site-src/engine-worker.js — the Candela view's engine worker
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-ace75c1737b051a8c/src/framework/contracts/differential.ts — D1 reuse, decide hook, decideCase
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-ace75c1737b051a8c/src/typed/parts.ts — function parts, closure keys, programs as parts

## 2026-11-26

Job pool for independent runs; final measurements (cfg 13.6 s vs 41-51 s base alternated; per-scene R-01 119 s vs 312 s; no-change 4.3 s cold / 0.66 s warm); vault report written (not committed). Open: browser open/pass still on the main thread (8.6 s / 21.3 s); per-function validation (rodj part).
