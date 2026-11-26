# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Design turn: opened the ticket; probed the framework with a miniature statement-level IR (applyPass is async only and needs a rewritable adapter even for native-result passes); measured f32 against f64 on matmul, softmax and layernorm to choose the tolerance (2^-12 of the largest magnitude in the case); wrote the design, which proposes applyPassSync and opening the pass edit only for rewritable adapters.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-fa-x-irwb-020-o/ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/design-doc/01-tix-stage-1-language-ir-evaluators-meaning-contract-inline-and-split-sum.md — The design under review
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-fa-x-irwb-020-o/ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/01-framework-probes.mjs — Framework probes
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-fa-x-irwb-020-o/ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/02-tolerance-probe.mjs — Tolerance probe
