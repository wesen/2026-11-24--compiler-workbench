Created [ticket IRWB-020-Q](ttmp/2026/11/26/IRWB-020-Q--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md), wrote the [Stage 1 design](ttmp/2026/11/26/IRWB-020-Q--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design.md), and started the [diary](ttmp/2026/11/26/IRWB-020-Q--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md).

The design proposes two framework changes: synchronous native-pass application that shares the existing write checks, and synchronous verification of pure differential contracts that reuses the existing case runner. Neither changes Typed’s async path.

Committed as `ed978a1a58b5b8fc714880beb417a0e26dbf675f`. The worktree is clean, nothing was pushed, and implementation is awaiting review.
