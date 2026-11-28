Implemented and committed the shared liveness primitive. It analyzes **all supplied blocks**, including unreachable predecessors, preserving the two machine clients’ existing behavior.

The [ticket](ttmp/2026/11/27/IRWB-046-A--standard-library-liveness/index.md) contains the [design](ttmp/2026/11/27/IRWB-046-A--standard-library-liveness/design-doc/01-liveness-design.md), [diary](ttmp/2026/11/27/IRWB-046-A--standard-library-liveness/reference/01-diary.md), and [final report](ttmp/2026/11/27/IRWB-046-A--standard-library-liveness/reference/02-final-report.md).

Changed files:

- [liveness.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-tl-irwb-046-a/src/stdlib/flow/liveness.ts) — adds the domain-independent backward gen/kill solver.
- [index.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-tl-irwb-046-a/src/stdlib/index.ts) — exports the primitive and interface.
- [regalloc.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-tl-irwb-046-a/src/typed/backend/regalloc.ts) — uses the shared solver for intervals.
- [coalesce.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-tl-irwb-046-a/src/typed/backend/coalesce.ts) — uses the shared solver for interference analysis.
- [liveness.test.mjs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-tl-irwb-046-a/tests/stdlib/liveness.test.mjs) — tests the specified unreachable predecessor and a loop.
- [dependencies.test.mjs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-tl-irwb-046-a/tests/stdlib/dependencies.test.mjs) — checks the stdlib import boundary.

Verification passed: the new test files passed; the baseline check printed **“no differences”**; and all 70 requested non-GPU suite files passed after reruns. The initial sandbox run had four file failures from Node subprocess restrictions; all four passed outside the sandbox. These are file-level counts; the workbench rerun also had one existing skipped test. `npm run build`, `npm run check`, and formatting checks passed.

The named defect files contain no liveness or IRWB-046-A todo to remove, so their unrelated todos remain. Later standard-library modules and physical-register bitset liveness were left outside this step.

Last commit: `56dc2cf81e669de32713d642d4bb067007764b31`.