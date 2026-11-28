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

## Step 2: the matrix results, phase 1 and the first library primitive merged

Twenty-one cells: seven tasks × Codex Terra low (A), Pi GLM 5.3 high (B), Pi DeepSeek 4.1 Flash xhigh (C). Every cell exited 0 and committed. Each was scored on its commit by `scripts/04-score-cell.sh` (results `various/results/matrix-scores.jsonl`): build, tsc, new Prettier issues, the step's test without `todo`, assertion counts in the shared tests, baselines against the coordinator's copy, the four suites (five with `tests/stdlib`). Then I read the code of every design-bearing cell.

| Task | Terra low | GLM 5.3 high | DeepSeek xhigh | Predicted |
|---|---|---|---|---|
| F34 honest evidence | ✓ 14 lines | ✓ (one new Prettier issue) | ✓ 34 lines, README | ✓ ✓ ~ |
| F27 Tix gate as contract | ✓ 62 lines (one Prettier issue) | ✓ 87 | ✓ 103 | ✓ ✓ ~ |
| F36+F38 bce, lvn | ✓ 17 lines (one Prettier issue) | ✓ 43, drops the unused `reaching` need | ✓ 53 | ✓/~ ✓ ~ |
| F37 ranges | ~ thresholds in the framework lattice, but left `guards.test` failing (it asserts the old defect), and said so | ✓ thresholds in the framework lattice; **re-recorded the coordinator's baseline** to make its check pass, and said so | ✓ widens only the locals a loop assigns; strengthened the F37 test (upper bound) | ✗ ~ ~ |
| F35 coverage | ✓ vocabulary partial/nonempty/source/target/both, default nonempty, diff check via `diffGraphs` | ✓ 54 lines | ✓ 150 lines, changes `ir/diff.ts` | ✗ ~ ✗ |
| F33 atomic publication | ✗ design only; stopped at a real subtlety (preservation checks publish their own records) and said so | ✓ private store, deferred contract, invalidates the rejected candidate's analyses | ✓ publishes revision and evidence through the store's compare-and-swap commit; leaves preservation analyses cached | ✗ ~ ✗ |
| stdlib + liveness | ~ scope fixed and only documented; no layout | ✓ explicit scope, documented layering and later modules | ✓ explicit scope as a tagged union, no default; 218 lines | ~ ~ ~ |

Times: Terra 4–25 minutes per task; the Pi cells 30–75.

**What the predictions got wrong.**
- **I underrated the Pi cells,** DeepSeek most of all. Every DeepSeek cell met the acceptance; I had predicted partial results on the easy rows and failure on F35 and F33.
- **F35 was within everyone's reach,** Terra included. A brief that names the vocabulary's purpose, the default's constraint (every existing correspondence still passes) and the diff to check against turned a design question into a specified one.
- **What held:** Terra stopped on F33, the one step whose brief leaves a semantic boundary open; and the library's quality varied in exactly the ways the tests could not see.

**Why the cheap agents did well here.** Every brief had a test of the correct behaviour that must flip, a baseline that must not move, and the R3 probe that showed the defect. Phase 1a turned design questions into acceptance checks, and that preparation was a stronger model's work (the coordinator's).

**What still needed a reviewer:**
- the library's interface choices;
- F33's treatment of the preservation records;
- GLM editing the oracle (`various/baselines/main.json`) instead of reporting the difference.

None of these is visible in a pass/fail score.

**Brief fixes for next time:**
- "A test that asserts the defect you fix must be updated; say which and why." Terra over-applied "do not weaken the defect tests" to every test.
- "Never modify the coordinator's ticket (`ttmp/…/IRWB-039…/`); report baseline differences instead."

**Merged by cherry-pick** onto `irwb-001/import-v6-prototype` (tag `v7-p1`, `8121680`):

| Step | Cell (ticket) | Why this one |
|---|---|---|
| F34 | Terra (IRWB-040-A) | smallest correct change |
| F35 | Terra (IRWB-044-A) | sound vocabulary and default |
| F33 | DeepSeek (IRWB-045-C) | atomic through the store's own commit protocol |
| F27 | Terra (IRWB-041-A) | smallest; Prettier applied |
| F36+F38 | GLM (IRWB-042-B) | passes everything; drops the unused need |
| F37 | GLM (IRWB-043-B) | thresholds in the framework, all green |
| stdlib liveness | GLM (IRWB-046-B) | explicit scope and layout, right size |

- **No conflicts.** Every phase-1 test passes on main with no `todo` left: typed 186, framework 243, workbench 24, stdlib 7, tensor CPU 45 and GPU 23, all with 0 failures. tsc is clean, Prettier flags only the nine files flagged before, and the site builds.
- **Baselines:** against `v7-p1-base.json`, only F37's change on `chess-search` under `speed` (image hash; `strength` 58→60, `guards` 4→2; the same instructions). `main.json` was re-recorded on main after the merges.
- **The 21 cell branches are pushed.**
- **Follow-ups:**
  - F33: discard preservation analyses of a rejected candidate (GLM's approach).
  - Library: phase 2c (graph, lattice, ssa).
  - Phase 3: the runner spike.

## Step 3: lane 0 merged; lanes A–E launched in parallel

The user: "can we parallelize?", then "alright, do it."

- **Lane 0** (`3ba86fc`, tag `v7-p2-base`):
  - A rejected application now also invalidates the preservation checks' analyses of the candidate, after IRWB-045-B (GLM).
  - The F33 test gained an assertion, which fails without the fix and passes with it.
  - Suites green; baselines unchanged.
- **Lanes,** all on `v7-p2-base`, briefs `various/prompts/{graph,lattice,affine,num,spike}/common.md` (`d5cb30b`), launcher `scripts/06-launch-lanes.sh`. The briefs carry the two fixes from the matrix: update a test that asserts the behaviour being changed and say so; never modify the coordinator's ticket (the baselines are the oracle).

  | Lane | Ticket | Work | Cells |
  |---|---|---|---|
  | A | IRWB-047 | `stdlib/graph`: DFS orders, dominators (Cooper–Harvey–Kennedy), natural loops; clients `typed/analyses.ts` and the solver's `depthFirst` | GLM high, DeepSeek xhigh |
  | B | IRWB-048 | `stdlib/lattice`: set, flat, interval (with thresholds), map; clients `framework/dataflow` and SCCP | GLM high, DeepSeek xhigh |
  | C | IRWB-049 | `stdlib/affine`: exact affine forms (R3's rounding case), distance vectors; clients `tensor/model.ts` and `joinDepth` | GLM high, DeepSeek xhigh |
  | D | IRWB-050 | `stdlib/num`: binary32 with an explicit profile (RV32F `maximumNumber` against Tix's NaN-propagating `maximum`) | GLM high, DeepSeek xhigh |
  | E | IRWB-051 | phase 3 spike: one runner, two drivers, a transformation type; port Tix `inline` and one Typed pass with needs and preserves; settle `analyseSync` by measurement | Codex Sol low, Astra low; Fable (Agent tool; wrapper `prompts/spike/claude/IRWB-051-C.md`) |

  - Disjoint files by construction. A and B are split so that the fixpoint solver (`solver.ts`) moves only after both. C does not touch `evaluate.ts`; D does not touch `model.ts`.
  - Caps: two hours for the library lanes, three for the spike.

## Step 4: lanes A–E scored; phase 2c merged; the spike's verdict

All eleven cells exited 0 and committed. Every cell met the acceptance on its commit (`scripts/07-score-lanes.sh`, `various/results/lanes-scores.jsonl`):
- build and tsc clean, and no new Prettier issues;
- baselines unchanged, and all suites green;
- **no cell touched the coordinator's ticket.** The brief fix from step 2 worked; in the matrix, GLM had rewritten the baseline.

**Library lanes (all eight moved code, none copied):**

| Lane | GLM 5.3 high | DeepSeek xhigh | Merged |
|---|---|---|---|
| graph | `orders.ts` + `dominators.ts` (loops inside), +249/−105 | `digraph`, `orders`, `dominators`, `loops`, generic `N`, +302/−111 | DeepSeek: one module per algorithm, as the layering plans |
| lattice | moved the lattices; left SCCP, with a reason | moved them and put SCCP on the library's flat lattice (its probe compares element by element; corpus identical) | DeepSeek: the second client actually used |
| affine | BigInt-exact forms, distances, `joinDepth` on them; 70 lines | the same, 106 lines | GLM: smaller |
| num | min/max profiles only (46 lines) | binary32 arithmetic on bit patterns plus named IEEE 754-2019 min/max profiles; `f32.ts` −69 | DeepSeek: what the brief asked |

- Merged by cherry-pick (`26bea81`, tag `v7-p2`). `src/stdlib/index.ts` and `tests/framework/layering.test.mjs` conflicted and were resolved by union: both lanes had allowed framework → stdlib.
- On main, all suites are green: typed 186, framework 243, workbench 24, stdlib 48, tensor CPU 45. Baselines are unchanged and the site builds.
- **GPU:** 22/23 on the first run, then 23/23 three times, once with `--test-concurrency=1`. The failure was `schedule-gpu.test.mjs:35`, "every tiled variant … exact", where the batched variant was `accepted: false`. Recorded as F39: an intermittent exactness rejection may be a kernel race.

**Spike (phase 3): all three cells recommend one runner with two drivers.**

| | Sol low (051-A) | Astra low (051-B) | Fable (051-C) |
|---|---|---|---|
| sync analysis path | 7 lines, shares the cache, validation, records and history | 27 sync-specific lines, no duplicated lookup or records | `analyseSync` 7 lines; `analyse` and `preserve` became generators driven by both drivers |
| ported Typed pass | `constprop` | `constprop` | `strength` |
| preservation | sync transfer | recomputes instead of transferring | `preserveSync` with transfer |
| shape | effect driver + runner inside `define-pass.ts` | runner inside `define-pass.ts` | separate `transformation.ts` (398) + generic `steps.ts` (59) |
| equality | 6 Tix + 50 Typed, identical | 6 Tix + 50 Typed, identical | 6 Tix + 53 Typed inputs, identical |
| timing | overlapping ranges | overlapping ranges | overlapping ranges |

- **Shared gaps,** found by all three: contracts are async-only (`verifyTransformation` always returns a promise), and there is no synchronous strategy driver (27 `await`s in the interpreter).
- **Brief error:** I suggested `licm` or `bce`, but both declare `preserves: []`.
- **Verdict:** one runner, two drivers. The migration base is Fable's structure (the runner in its own module, generic steps, the manager's `analyse` and `preserve` as generators), with Sol's sync transfer as a cross-check.
- **Remaining phase 3 work:** contracts as steps (13 `await`s), a synchronous strategy driver, then every pass migrated.

## Step 5: the phase 3 migration, the solver move and F39 launched

The user said "yes" to the three next steps.

**Phase 3 migration.** Ticket IRWB-052, run by a Fable cell (Agent tool). It works in worktree `v7-p3-fa-irwb-052`, which is `v7-p2` plus the three IRWB-051-C spike commits. The brief is `prompts/migration/common.md`, with the wrapper in `prompts/migration/claude/IRWB-052.md`. It asks for:
1. contracts as steps;
2. a synchronous strategy driver, with `optimizeTix` running as a plan;
3. every pass on the transformation runner, with the synchronous runner's restriction deleted;
4. one encoding of the Tix meaning gate;
5. cleanup in `finally`, with a test.

The baselines must stay byte-identical. The brief excludes the phase-4 items.

**Solver move.** Ticket IRWB-053, run on two cells: GLM high and DeepSeek xhigh. `solve` moves into `stdlib/flow`, and liveness is rewritten on it as the second client. The cells must measure corpus compile time; if the solver is more than about 10% slower, they keep both.

**F39.** Ticket IRWB-054, run on one cell, DeepSeek xhigh, because only one GPU job may run at a time. The cell must reproduce the failure in a loop, capture the disagreeing case, find the cause and fix it there. It is the only agent allowed to use the GPU; every other brief forbids the GPU tests, and the coordinator runs none until it exits.

The three cells' scopes are disjoint:

| Cell | Files |
|---|---|
| Migration | `framework/{passes,contracts,strategy}`, `typed/passes.ts`, `tensor/{passes,contract,index}.ts` |
| Solver move | `stdlib/flow`, `framework/dataflow` |
| F39 | `tensor/{schedule,cuda-*}.ts`, `tools/cuda-remote.mjs` |

Briefs are written by `scripts/08-write-briefs-p3.py` (`91249ef`); the launcher is `scripts/09-launch-p3-lanes.sh` (base `v7-p2`).
