## 1

I’ll use the docmgr and diary skills to create the ticket, then trace how Typed uses the framework before drafting and committing the design.

## 2

The fixed synchronous `optimizeTix` API exposes a framework gap. Typed’s pass runner returns a Promise, while the framework’s differential checker already runs synchronously. I’ll propose a small native-pass entry point that shares Typed’s artifact validation, diff, and write checks.

## 3

A probe found another constraint in the same pass path. `applyPass` opens a graph edit even when the pass returns native IR, which forces the adapter to implement `rebuild`. The proposed native entry point will avoid opening that unused edit. The reduction probe also confirmed that the two f32 orders differ by one bit on the witness.

## 4

IRWB-020-A is ready for review. The commit contains the [ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/index.md), [Stage 1 design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-stage-1-design.md), and [diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md). Implementation awaits review.

The proposed framework change is confined to the pass layer. Add `defineNativePass` and `applyNativePassSync`, sharing artifact validation, diffs, correspondence, and declared-write checks with `applyPass`. The synchronous path can check a native rewrite without opening a graph edit or requiring the adapter to implement `rebuild`.

The design uses sampled exact checks for `inline` and sampled tolerance checks against the original f64 result for `split-sum`. It also documents where conservative affine bounds checking may reject valid programs.

The build, seven existing framework tests, and `docmgr doctor` passed. A probe using the existing differential checker rejected the reduction witness under exact comparison and accepted it under tolerance.

Commit `13a833fb0128ce38c35f43cf0645d20e4be4e8a0` on `t1-sh/irwb-020-a`. The worktree is clean.
