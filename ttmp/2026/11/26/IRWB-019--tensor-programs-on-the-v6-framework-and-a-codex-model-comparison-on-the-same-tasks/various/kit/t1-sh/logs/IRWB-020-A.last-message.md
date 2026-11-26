IRWB-020-A is ready for review. The commit contains the [ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/index.md), [Stage 1 design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-stage-1-design.md), and [diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sh-irwb-020-a/ttmp/2026/11/26/IRWB-020-A--tix-language-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md). Implementation awaits review.

The proposed framework change is confined to the pass layer. Add `defineNativePass` and `applyNativePassSync`, sharing artifact validation, diffs, correspondence, and declared-write checks with `applyPass`. The synchronous path can check a native rewrite without opening a graph edit or requiring the adapter to implement `rebuild`.

The design uses sampled exact checks for `inline` and sampled tolerance checks against the original f64 result for `split-sum`. It also documents where conservative affine bounds checking may reject valid programs.

The build, seven existing framework tests, and `docmgr doctor` passed. A probe using the existing differential checker rejected the reduction witness under exact comparison and accepted it under tolerance.

Commit `13a833fb0128ce38c35f43cf0645d20e4be4e8a0` on `t1-sh/irwb-020-a`. The worktree is clean.