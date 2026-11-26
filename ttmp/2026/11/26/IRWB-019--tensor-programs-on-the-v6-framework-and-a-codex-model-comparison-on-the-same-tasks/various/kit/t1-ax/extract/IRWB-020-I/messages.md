## 1

I’ll use the docmgr and diary skills to create IRWB-020-I. I’ll read the framework and its Typed integration, then probe the tensor-specific decisions before writing and committing the design.

## 2

Typed’s pass runner returns a Promise even for a synchronous rewrite. The differential checker already runs synchronously, so the gap is narrower than a new contract system. I’m checking that boundary and choosing a reduction example with reproducible f32 bit patterns.

## 3

The design now has a concrete `split-sum` witness. On eight finite inputs, serial f32 produced `0x3f800000`, blocked f32 produced `0x3f800001`, and the blocked result matched the f64 reference exactly. I’ve also documented how to catch a dropped tail and a wrong inline through the same contract. I’ll validate the ticket and review the staged files before committing.

## 4

IRWB-020-I is ready for design review in commit `312f72cd18e7827f0647cdbb576a1a015c3c8ad4`. The commit contains only ticket documentation, and the worktree is clean.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md) · [Design and framework change ledger](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-tensor-ir-and-checked-rewrites.md) · [Diary and probe results](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md)

The design proposes two changes to `src/framework/passes/define-pass.ts`:

1. Add `applyNativePassSync` so `optimizeTix` can return synchronously while reusing the existing structural checks and requiring a meaning check.
2. Open the graph editor only when a pass requests it. A probe confirmed that the current runner rejects a native pass before its body runs if its adapter lacks `rebuild`.

The existing differential checker supports both numerical relations. An eight-element probe produced `0x3f800000` for serial f32 and `0x3f800001` for blocked f32. The blocked result matched the original f64 reference exactly. The proposed tolerance is `1e-5 + 1e-5 × |reference|` per element. Corpus validation follows implementation.

Ticket validation and link checks passed.
