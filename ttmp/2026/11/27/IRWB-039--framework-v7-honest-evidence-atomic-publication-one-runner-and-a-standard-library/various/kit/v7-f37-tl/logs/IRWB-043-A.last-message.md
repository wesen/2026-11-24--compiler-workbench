Implemented and committed the F37 range-analysis fix as **`a96147a`**. The F37 regression passes, though the full suite has one conflicting assertion that expects the old bug.

The [ticket]( /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/ttmp/2026/11/27/IRWB-043-A--range-analysis-under-nested-loops/index.md) contains the diary and [report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/ttmp/2026/11/27/IRWB-043-A--range-analysis-under-nested-loops/analysis/01-final-report.md).

Changed files:

- [analyses.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/src/typed/analyses.ts) — derives widening thresholds from each function’s integer constants.
- [lattices.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/src/framework/dataflow/lattices.ts) — adds interval widening to the nearest enclosing threshold.
- [analysis.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/src/framework/dataflow/analysis.ts) — supplies region context to widening.
- [d2-defects.test.mjs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/tests/typed/d2-defects.test.mjs) — enables F37 without changing its assertion.
- [interval-thresholds.test.mjs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/tests/framework/interval-thresholds.test.mjs) — checks threshold selection and fallback to domain extremes.

Validation results:

- F37 and the new lattice test: **1 pass each**.
- Baseline check: differences only for `chess-search` under `speed`; its image hash changed, `strength` edits increased from 58 to 60, and `guards` edits decreased from 4 to 2. Both measured instruction counts were unchanged.
- Parity: **8,286 decided cases agree**, 14 inconclusive, zero failures.
- Combined requested non-GPU suites: **489 passed, 1 failed, 3 skipped, 7 TODO**. The sole failure is [guards.test.mjs:198](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f37-tl-irwb-043-a/tests/typed/guards.test.mjs:198), which asserts that `strength` makes no change because of the F37 defect. I left that assertion intact as instructed.
- `npm run check` and the site build passed.