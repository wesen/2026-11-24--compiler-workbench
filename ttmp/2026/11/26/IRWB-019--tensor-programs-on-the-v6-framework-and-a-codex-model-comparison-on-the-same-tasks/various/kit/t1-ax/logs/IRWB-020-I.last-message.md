IRWB-020-I is ready for design review in commit `312f72cd18e7827f0647cdbb576a1a015c3c8ad4`. The commit contains only ticket documentation, and the worktree is clean.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md) · [Design and framework change ledger](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-tensor-ir-and-checked-rewrites.md) · [Diary and probe results](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md)

The design proposes two changes to `src/framework/passes/define-pass.ts`:

1. Add `applyNativePassSync` so `optimizeTix` can return synchronously while reusing the existing structural checks and requiring a meaning check.
2. Open the graph editor only when a pass requests it. A probe confirmed that the current runner rejects a native pass before its body runs if its adapter lacks `rebuild`.

The existing differential checker supports both numerical relations. An eight-element probe produced `0x3f800000` for serial f32 and `0x3f800001` for blocked f32. The blocked result matched the original f64 reference exactly. The proposed tolerance is `1e-5 + 1e-5 × |reference|` per element. Corpus validation follows implementation.

Ticket validation and link checks passed.