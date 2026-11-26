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
