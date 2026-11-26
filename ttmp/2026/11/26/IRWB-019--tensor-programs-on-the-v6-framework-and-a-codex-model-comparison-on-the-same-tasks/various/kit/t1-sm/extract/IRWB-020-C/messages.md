## 1

I’ll use the docmgr and diary skills to create IRWB-020-C. I’ll read how Typed uses the framework, then write and commit the design and initial diary for review.

## 2

The fixed synchronous `optimizeTix` API exposes a framework gap. Native IR editing and differential checks already have synchronous entry points, but `applyPass` always returns a promise. I’ll propose a narrow synchronous path that reuses the native pass checks.

## 3

The Node 24 probe confirmed the rounding witness. The linear and blocked sums produce different f32 words, and the blocked sum matches the original f64 result. The design and diary are ready, and docmgr validation passed. I’ll verify the staged files and commit.

## 4

IRWB-020-C is ready for design review. [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sm-irwb-020-c/ttmp/2026/11/26/IRWB-020-C--tix-language-tensor-ir-evaluators-contract-and-checked-passes/index.md) · [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sm-irwb-020-c/ttmp/2026/11/26/IRWB-020-C--tix-language-tensor-ir-evaluators-contract-and-checked-passes/design-doc/01-tix-stage-1-design.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sm-irwb-020-c/ttmp/2026/11/26/IRWB-020-C--tix-language-tensor-ir-evaluators-contract-and-checked-passes/analysis/01-diary.md)

The sole proposed framework change is `applyNativePassSync` in `src/framework/passes/define-pass.ts`. It would let the fixed synchronous `optimizeTix` API reuse native artifact validation, diffs, correspondence, and declared-write checks, with a mandatory semantic check before accepting a revision.

The Node 24 probe confirmed that exact comparison rejects the split-sum rounding witness and the proposed tolerance accepts it. Docmgr validation passed. Implementation is pending review.

Commit `d887783341f7968bbe19f19bb188e4b910c099d3`. The worktree is clean.
