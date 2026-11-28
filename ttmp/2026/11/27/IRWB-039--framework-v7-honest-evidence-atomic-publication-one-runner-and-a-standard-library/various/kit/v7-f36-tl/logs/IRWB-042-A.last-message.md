Fixed F36 and F38 and committed the changes. The working tree is clean.

- [src/typed/passes.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f36-tl-irwb-042-a/src/typed/passes.ts): BCE compares SSA names; LVN discards cached values removed by a rewrite.
- [tests/typed/d2-defects.test.mjs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f36-tl-irwb-042-a/tests/typed/d2-defects.test.mjs): activated the F36 and F38 regression tests without weakening their assertions.
- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f36-tl-irwb-042-a/ttmp/2026/11/27/IRWB-042-A--typed-bce-and-lvn-defects/index.md): contains the diary and [final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f36-tl-irwb-042-a/ttmp/2026/11/27/IRWB-042-A--typed-bce-and-lvn-defects/reference/02-final-report.md).

Both named regression tests pass. The post-build baseline check printed **`no differences`**. The requested non-GPU suites completed with **491 passed, 0 failed, 3 skipped, and 6 todo**. `npm run build` and `npm run check` passed.

F37 remains an unrelated existing todo. No framework or workbench files changed, so the site build was not required.

Last commit: `a9b983f77d666a412569aee10192bbacb9b5d327`.