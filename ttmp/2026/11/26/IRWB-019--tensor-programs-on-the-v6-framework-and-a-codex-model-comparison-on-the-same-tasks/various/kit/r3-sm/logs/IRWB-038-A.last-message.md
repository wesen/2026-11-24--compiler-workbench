[IRWB-038-A ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/index.md) · [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/design-doc/01-composable-transformations-and-independent-evidence.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/log/01-research-diary.md)

## Five findings

1. **Pass acceptance can split.** A probe recorded an accepted contract and exposed its candidate fact before the enclosing pass rejected a false preservation claim. [Pass lifecycle](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/src/framework/passes/define-pass.ts:347)
2. **All ten T6 cells still consult `planFusion`.** The schedule IR makes decisions visible, but the planner still supplies decisions during seeding or scheduling. [T6 comparison](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/analysis/01-cell-evidence.md:30)
3. **A0 and D1 rebuild edit history and attribution from adjacent revisions.** Two A0 classifiers assigned different categories to the same constant-propagation edit. [Cell policy probe](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/design-doc/01-composable-transformations-and-independent-evidence.md:87)
4. **Five B1 cells implement specialization machinery inside Typed.** Their common abstraction is memoized residual-state exploration, with different binding-time and budget policies. [B1 comparison](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/analysis/01-cell-evidence.md:75)
5. **Evidence needs explicit scope and dependencies.** A deliberately aliased cache key replayed a stale outcome, and a wrong CUDA lineage edge passed when both endpoint IDs existed. [Probe results](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/design-doc/01-composable-transformations-and-independent-evidence.md:77)

## Proposed framework concepts

- **Typed transformations** with preconditions, candidate preparation, and a durable invocation record.
- **Translation-validation obligations** with explicit coverage and independent cache keys for cases, observations, and verdicts.
- **Witnessed edits** with versioned rule applications, scoped substitutions, and explicit entry changes.
- **Scoped lineage** for cross-IR correspondence and additive execution attribution.
- **Graph analysis and specialization** with reusable CFG facts, binding-time domains, and bounded residual-state exploration.
- **Affine dependence relations** with independent schedule and reduction-order validation.
- **Constrained variant selection** with explicit guards, fallbacks, and measurement protocols.

**Fundamental recommendation.** Give same-IR passes, lowerings, and specializations one lifecycle that publishes only after all required checks pass. Keep native IRs and one strategy interpreter. Represent eligibility, semantic assurance, lineage, and profitability as distinct claims. The migration starts with evidence and publication, then tests the larger analysis abstractions on narrow fixtures.

Reviewed **31 committed cell heads** and ran **six CPU probes**. GPU results came from the supplied stage reports. The worktree is clean, and both commits are local. Last commit **`b84ad23`**.