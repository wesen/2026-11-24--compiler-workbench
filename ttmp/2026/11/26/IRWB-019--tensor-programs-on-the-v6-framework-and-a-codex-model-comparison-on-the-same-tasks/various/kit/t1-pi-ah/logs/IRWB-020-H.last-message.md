IRWB-020-H is ready for design review. [Ticket](ttmp/2026/11/26/IRWB-020-H--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md) · [Design and framework change ledger](ttmp/2026/11/26/IRWB-020-H--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design-checking-tix-tensor-transformations.md) · [Diary](ttmp/2026/11/26/IRWB-020-H--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md)

**One framework change is proposed:** extract synchronous native-candidate preparation from `src/framework/passes/define-pass.ts`. This lets Tix reuse artifact validation, graph diffing, correspondence and write checks without duplicating the async pass runner. Preparation does not imply acceptance; the existing differential contract machinery can check both numerical relations unchanged.

Documentation only; implementation awaits review. `docmgr doctor` passed, and the worktree is clean.

**Commit:** `7cf52a5ccdc19addea8921c7b5263fd4970acea3`
