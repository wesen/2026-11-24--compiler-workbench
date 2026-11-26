# Changelog

## 2026-11-25

- Initial workspace created

## 2026-11-25

Baseline of the frozen default recorded (various/baseline); site census and mutant-as-pass probe (scripts 02, 03); intern guide written, revised and uploaded to reMarkable /ai/2026/11/25/IRWB-005

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/ttmp/2026/11/25/IRWB-005--gate-strength-a-mutation-score-for-the-meaning-contract-and-stronger-case-generation/design-doc/01-intern-guide-how-strong-is-the-meaning-contract-and-how-to-make-it-stronger.md — the intern guide

## 2026-11-26

D2a and D2b implemented and measured: src/typed/mutate.ts (ten operators, mutant pass), tools/mutation-score.mjs + mutation-classify.mjs; corpus 1,144 mutants, default 95.8 % upper, contract version 2 (src/typed/cases-strong.ts, boundary cases + offset records + divergence rule) 99.8 %; finding: default generator lays records out in key order (Candela K, 168 of 332 functions); v2 accepts every corpus pipeline identically at about 2x check cost

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/src/typed/cases-strong.ts — contract version 2: pools, boundary/coverage cases, offset layout, divergence rule
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/src/typed/mutate.ts — mutation operators, sites, mutant pass, affected, finiteDomain, compareOn, Candela sub-programs
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/tools/mutation-score.mjs — corpus and f32-fixture mutation score

## 2026-11-26

f32 fixture (61 mutants, default 96.7 %, v2 100 %); C5 src/typed/facts-check.ts with an additive observe hook in evaluate.ts; frozen default re-recorded at 690e2a1 and identical to 420d8e1 (various/18-freeze-diff.txt)

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/src/typed/facts-check.ts — typed.ranges checked against executions
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/ttmp/2026/11/25/IRWB-005--gate-strength-a-mutation-score-for-the-meaning-contract-and-stronger-case-generation/various/18-freeze-diff.txt — frozen-default comparison

## 2026-11-26

Held-out base r0 (96.2 % / 99.9 %); C5 range facts hold on 149M checks; NaN-payload class from IRWB-006 measured (v1 accepts x + -0 -> x, v2 rejects); merged 1f45c94 (IRWB-004/006): gates identical, 396/396 sample mutants identical; machine failure at 01:39 cut the Candela run (14 of 18 functions kept) and killed the deep search before it wrote; both resumed (Candela under a 14G memory cap)

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/ttmp/2026/11/25/IRWB-005--gate-strength-a-mutation-score-for-the-meaning-contract-and-stronger-case-generation/log/01-gate-strength-diary.md — steps 12-17
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a6abc74d4c978a51f/ttmp/2026/11/25/IRWB-005--gate-strength-a-mutation-score-for-the-meaning-contract-and-stronger-case-generation/various/18-freeze-diff-merged.txt — gates on the merged branch

## 2026-11-26

Candela subset complete under the 14G cap (18 functions, 3,931 mutants); classification audit reclassified 29 Candela mutants (default 96.8% upper, 114 wrong accepted; check100 67; v2 100); classifier fixed for unspecified functions

### Related Files

- tools/mutation-classify.mjs — unconstrained witness of an unspecified function is a specified witness
- ttmp/2026/11/25/IRWB-005--gate-strength-a-mutation-score-for-the-meaning-contract-and-stronger-case-generation/scripts/22-candela-summary.mjs — Candela summary with the two reclassification rules
