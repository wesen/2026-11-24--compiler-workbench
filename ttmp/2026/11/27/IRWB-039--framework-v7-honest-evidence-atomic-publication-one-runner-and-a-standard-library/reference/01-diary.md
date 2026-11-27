---
Title: Diary
Ticket: IRWB-039
Status: active
Topics:
    - framework
    - refactor
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:02:51.298266775-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: the plan, phase 0 merged, phase 1a, and the execution-agent matrix launched

The user: "ok, write the plan out in a new docmgr tickeet + design doc, then do 0 + 1 + 2. Do you think we can use "execution agents" like glm / terra to do this? how much higher intelligence like opus / astra / fable / sol would we need?"; then, mid-turn: "run a matrix with terra and glm high and deepseek xhigh, until you can validate your opinions on the types of task ahead of us".

- **Plan:** `design-doc/01-the-v7-refactor-plan-phases-decision-points-and-who-does-what.md` (`f98aca7`).
- **Phase 0 (merged by cherry-pick onto `irwb-001/import-v6-prototype`, tag `v7-p0` = `ebdd715`):**
  - A0: Fable (IRWB-035-G). The classifier now also re-derives D2's `identities` table, and its test knows D2's `copies` and `subst-mem` (`a734e0d`, `scripts/01-d2-pass-classes.mjs`).
  - B1: Opus (IRWB-036-F). Conflicts in the pass registry and the pass-count test, resolved by keeping both sides. On main, Fibonacci under `speed` takes 6,301 instructions (9,286 in the cell), and `promote+speed` 110 (161), because D1 and D2 now run underneath.
  - T6: Opus (IRWB-033-D), chosen by the hidden evaluation `results/eval-t6.json` in IRWB-019. Every cell bit-exact except GLM Flash, whose fused CUDA does not compile. Opus is fastest on five of seven shapes; Astra on 4096³ (2.01× cuBLAS against Opus's 2.19×).
    - It brings `PassSpec.legal` into the framework (the v6 form of K1's `eligible`, kept; phase 3 renames it).
    - It also brings a hand-written schedule rule in `src/tensor/strategy.ts`, domain-local because the plan interpreter is async; phase 3's sync driver removes the reason.
  - All suites green; one GPU test failed on an ssh connection reset and passed on rerun.
- **Phase 1a (`f99682a`, tag `v7-p1-base`):**
  - Seven `todo` tests of the correct behaviour (F27, F33 ×2, F34, F35 in tests/framework and tests/tensor; F36–F38 in tests/typed), each verified to fail for its stated reason.
  - `scripts/02-baselines.mjs` (write/check); `various/baselines/main.json`, deterministic (a recheck shows no differences; Tix inline 0.53 ms per application).
- **Matrix** (`5c3c46e`): seven briefs `various/prompts/<task>/common.md`, cells A Codex Terra low, B Pi GLM 5.3 high, C Pi DeepSeek 4.1 Flash xhigh, policy v4, base `v7-p1-base`. Wave 1 (F34, F27, F36+F38, F37; 90 minutes) launched; wave 2 (F35, F33, lib; two hours) follows.
  - Confound: the base contains this ticket's design doc, with the staffing predictions; it says nothing about how to do a task.
- **Predictions, recorded before any result** (✓ meets the acceptance, ~ partial or needs a review round, ✗ fails or wrong design):

  | Task | kind | Terra low | GLM 5.3 high | DeepSeek xhigh |
  |---|---|---|---|---|
  | F34 honest evidence | specified, framework | ✓ | ✓ | ~ |
  | F27 Tix gate as contract | specified, code given | ✓ | ✓ | ~ |
  | F36+F38 bce, lvn | specified cause / debugging | ✓ F36, ~ F38 | ✓ | ~ |
  | F37 ranges widening | textbook analysis, parity care | ✗ | ~ | ~ |
  | F35 coverage policy | design across both domains | ✗ | ~ | ✗ |
  | F33 atomic publication | manager semantics | ✗ | ~ | ✗ |
  | lib skeleton + liveness | sets a pattern | ~ | ~ | ~ |

  My claim to test: execution agents pass rows 1–3, and rows 4–7 need a stronger model (Sol or Astra for F35 and F33, Fable for the library).
