Implemented IRWB-020-A Stage 1. [src/tensor](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/src/tensor) contains the Tix parser and checker, v6 IR, f32 and f64 evaluators, and checked `inline` and `split-sum` passes. The build exports `compileTix`, `runTix`, and `optimizeTix` from `dist/tensor/index.js`. The [corpus](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/corpus/tensor) contains all six requested programs.

Production-generated cases reject both deliberately wrong rewrites. The half-ULP case rejects the correct `split-sum` under exact comparison and accepts it against the original f64 result.

The only framework file changed was [define-pass.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/src/framework/passes/define-pass.ts). It adds `applyNativePassSync` and shares native candidate validation, diffs, correspondence, and write checks with `applyPass`. The synchronous path can check a candidate without opening a graph edit.

**Verification**

- `npm run build` passed.
- `node --test tests/tensor/*.test.mjs` passed all three files. A rerun with `--test-isolation=none` reported 21 passing subtests.
- `node --test tests/framework/*.test.mjs` passed all 18 files.
- `node --test tests/typed/passes.test.mjs tests/typed/meaning-memo.test.mjs tests/typed/strategies.test.mjs` passed all three files.
- `docmgr doctor --ticket IRWB-020-A` passed.

One implementation detail added after review is that `inline` skips a substitution if the composed affine coefficients exceed the IR’s safe-integer range. The [revised design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-stage-1-design.md) and [diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md) record the case.

Commits are `df5c3ee` for the revised design, `3802855` for the framework change, and `d25be76` for the Tix implementation and verification. The worktree is clean.