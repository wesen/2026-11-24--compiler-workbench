## 1

I’ll use the docmgr and diary skills to create IRWB-020-D. I’ll trace how Typed registers its IR and checks passes, then probe the framework interfaces that Tix would rely on before writing the design.

## 2

The probe found one framework gap. `applyPass` returns a Promise and opens a graph edit even when the pass produces a native result. I’ll propose a small synchronous path for native passes that shares the existing write checks. The differential checker already runs synchronously. On a five-element sum, it rejected a one-bit f32 difference under exact comparison, accepted it under tolerance, and rejected a dropped tail.

## 3

IRWB-020-D is ready for design review. The [ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/ttmp/2026/11/26/IRWB-020-D--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md), [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/ttmp/2026/11/26/IRWB-020-D--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design-for-the-tix-tensor-domain.md), and [diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/ttmp/2026/11/26/IRWB-020-D--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-design-and-implementation-diary.md) are committed in `2e6222e`. The worktree is clean.

**One framework change is proposed.** Add `applyNativePassSync` for native passes with a required synchronous contract check, sharing candidate validation, diffing, correspondence, and declared-write checks with `applyPass`. The probe confirmed that `applyPass` returns a Promise and requires a rebuild-capable adapter even for a native identity pass. Both constraints matter for Tix’s synchronous API.

A five-element reduction produced a one-bit f32 difference after reassociation. The existing differential checker rejected it under exact comparison, accepted it against the f64 reference, and rejected a variant that dropped the tail. The baseline build and ticket validation passed. Implementation awaits review.
