Implemented and committed F35. The [ticket](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/ttmp/2026/11/27/IRWB-044-A--correspondence-checked-for-its-claims/index.md>) contains the [design](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/ttmp/2026/11/27/IRWB-044-A--correspondence-checked-for-its-claims/design-doc/01-correspondence-coverage-and-consistency.md>) and [diary and report](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/ttmp/2026/11/27/IRWB-044-A--correspondence-checked-for-its-claims/reference/01-diary-and-report.md>).

Changes by file:

- [types.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/src/framework/contracts/types.ts): Added the coverage vocabulary.
- [definitions.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/src/framework/contracts/definitions.ts): Validates coverage declarations.
- [analysis-manager.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/src/framework/contracts/analysis-manager.ts): Checks coverage and rejects insertion or deletion claims for surviving IDs.
- [cuda-contract.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/src/tensor/cuda-contract.ts): Declares partial coverage for legitimate empty CUDA mappings.
- [correspondence-entities.test.mjs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/tests/framework/correspondence-entities.test.mjs): Covers coverage modes and contradictory claims.
- [r3-defects.test.mjs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-tl-irwb-044-a/tests/framework/r3-defects.test.mjs): Enabled the F35 test without changing its assertions.

The F35 test passes. The baseline check printed **“no differences”**. The requested suites reported **491 passed, 0 failed, 3 skipped, and 7 todos**. Build, type check, site build, and formatting checks passed.

Structural comparison establishes whether an ID survives; it cannot prove the semantic meaning of a nonempty merge or split. Same-ID survival checks apply to revisions of the same IR type, since different types may reuse IDs independently.

Last commit: `16d4428` (`IRWB-044-A: validate correspondence coverage and survival`).