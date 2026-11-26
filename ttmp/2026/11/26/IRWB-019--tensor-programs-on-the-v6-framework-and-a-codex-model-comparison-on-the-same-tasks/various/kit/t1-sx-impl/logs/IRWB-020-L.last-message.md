Implemented Tix Stage 1. The synchronous `compileTix`, `runTix`, and `optimizeTix` API builds to `dist/tensor/index.js`. It includes a checked tensor IR, f32 and f64 evaluators, and two checked passes. The original flat artifact remains the f64 reference across optimization calls. [API source](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/src/tensor/index.ts) · [Corpus](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/corpus/tensor) · [Revised design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design-for-tix-tensor-programs.md)

**Framework change.** `define-pass.ts` adds `applyNativePassSync` for existing `definePass` registrations. It supports read-only IR projections and shares candidate creation, diffing, correspondence, and write checks with `applyPass`. [Framework change](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/src/framework/passes/define-pass.ts:234) · [New framework tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/tests/framework/native-pass-sync.test.mjs)

**Verification passed.**

- `npm run build`
- `node --test tests/tensor/*.test.mjs` — 23 tests across 3 files, including all six corpus programs.
- `node --test tests/framework/*.test.mjs` — 18 files.
- `node --test tests/typed/passes.test.mjs tests/typed/strategies.test.mjs` — 2 files.

The exact gate rejected the production `split-sum` on the rounding witness, and the f64 tolerance gate accepted it. Both deliberately wrong kernels were rejected on generated cases. [Pass tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/tests/tensor/passes.test.mjs)

**Design adjustment.** `inline` retains a producer when the compiler cannot prove the composed affine access is in bounds. A regression test covers this case.

**Commits.** `afa7ca0` revised the design, `6ba6c1a` added the framework runner, and `1c217ab` implemented and verified Tix. The worktree is clean.