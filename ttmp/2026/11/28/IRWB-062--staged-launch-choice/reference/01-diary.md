---
Title: Diary
Ticket: IRWB-062
Status: active
Topics:
    - compiler
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T01:49:13.693046932-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary


## Step 1. Read the phase guide and define the launch representation

The guide places the decision at launch, after scheduling, and asks the differential to derive its coverage from that decision. I read the guide first, then the R3 synthesis's K6 card, detailed K6 discussion and migration step.

### Prompt Context

> ## Your task: staged choice (phase 4, item 4.8)
> Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`) section **K6 · Decisions as data** ("Plus staged choice: a launch-time variant with its guard, so the differential's arms are derived") and the migration step "Staged choice", after the guide.
>
> Some of a CUDA lowering's choices are made at launch time, when the shapes are known: a fused kernel can have a gate (a fused and an unfused path), and a tiled contraction has several variants with a launch rule (`select` entries with `minBlocks`/`minTerms`, `src/tensor/schedule.ts`). Since IRWB-057 the emitter returns a manifest (`emitScheduleProgram` in `src/tensor/cuda-source.ts`), and the meaning check enumerates its cases' modes from it (`modesOf` in `src/tensor/cuda-contract.ts`). The gate and the variant rule are two different encodings of one idea.
>
> 1. **One construct:** a launch-time `select` in the schedule IR: a guard over launch-time values (grid size, number of terms, the gate's condition) and its arms. The gate and the variants with their launch rule become instances of it.
> 2. **The emitter and the runtime** print and evaluate it; the manifest describes it.
> 3. **Derived arms:** the differential's modes are derived from the `select` (every arm checked; adding an arm adds its check). Change `modesOf` in `src/tensor/cuda-contract.ts` to that derivation and nothing else in that file (another lane changes the rest of it now).
> 4. **Guard coverage:** report an arm that no launch can reach, and a launch that no arm accepts (today's rule requires a last entry that accepts every grid).

### What I did

Created the dated ticket with `docmgr ticket create --ticket IRWB-062 --title 'Staged launch choice' --topics compiler,framework --path-template '2026/11/28/{{TICKET}}--{{SLUG}}'` and wrote the design note before editing TypeScript.

### Why

The existing variant printer already consumes an ordered list of threshold arms. The gate needs a typed arm and a fallback in that same representation. The variant printer sits in an out-of-scope file, so the variant arm keeps its flat bounds.

### What worked

Docmgr created the ticket and both numbered documents. `node -v` returned v24.18.0.

### What didn't work

`git add "$ticket" && git commit -m 'IRWB-062: record staged launch choice design'` failed with `fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/v7-staged-sl-irwb-062/index.lock': Read-only file system`.

### What I learned

The legacy emitter has a second variant condition beyond the policy thresholds: a forced tiled variant still has to fit the CUDA grid. The plain variant in the legacy printer is unconditionally selected when its entry is reached.

### What was tricky

The manifest summaries are read by shared CUDA artifact code. The select can be added and consumed without editing those readers.

### What warrants a second pair of eyes

The launch-statistics domain and its relationship to concrete tensor shapes.

### Code review instructions

Read the design note beside `cuda-contraction.ts`'s host printing and `cuda-contract.ts`'s manifest validation.

## Step 2. Install dependencies and probe the pinned toolchain

A fresh worktree needed its locked dependencies before a TypeScript or formatting check could run.

### Prompt Context

See step 1. The brief calls for Node 24, a TypeScript build and focused suites.

### What I did

Ran `npm ci --offline` under the sandbox and retried the same command with escalation.

### Why

Offline installation uses the pinned cache, and escalation allows the installer's binary probe to run.

### What worked

The escalated command installed six packages and reported zero vulnerabilities. The subsequent `npm run build` compiled the implementation.

### What didn't work

The first `npm ci --offline` returned `Error: spawnSync /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-staged-sl-irwb-062/node_modules/esbuild/bin/esbuild EPERM`.

### What I learned

Subprocess spawning can fail under the sandbox even when the executable and dependencies are present.

### What was tricky

The original install output included the expected binary-version bytes alongside the EPERM exception. The command still returned failure.

### What warrants a second pair of eyes

The tests that spawn Node need the same attention to exit status.

### Code review instructions

No checked-in dependency files changed.

## Step 3. Carry the choice from scheduling to the CUDA differential

The launch select now flows through the schedule and manifest, and the existing CUDA host expressions still select the branch at launch.

### Prompt Context

See step 1, especially items 1–4 and the `modesOf` edit boundary.

### What I did

Added launch arms and coverage checks in the schedule. Carried the select into the emitter, changed runtime gate-result decoding to use its arms, and derived forcing modes inside `modesOf`. Added CPU tests using the real differential with a reference-evaluating batch callback.

### Why

An ordered arm list gives the emitter its priorities and the differential its forcing values. Cycling the shorter set of forcing values covers both choice kinds without increasing the existing corpus modes.

### What worked

The build accepts the existing contraction printer's direct use of the variant arms. Prettier ran on the edited files outside the shared, already unformatted CUDA contract file.

### What didn't work

No implementation command failed. The first draft of the extra-arm fixture placed a duplicate tiled layout after the legacy predicates. I moved it ahead of the original layout with the next larger minimum, which gives the duplicate a separate launch interval.

### What I learned

A least accepting point suffices for dominance testing over independent tiled grid statistics. Within that domain an earlier lower-bound predicate can only shadow a different variant if it is unconditional.

### What was tricky

A source-only caller still looks up its manifest by hash. The new select must accompany the emitted program on both the schedule and the existing fusion-only entry point.

### What warrants a second pair of eyes

Review the gate formatting against the original parenthesization and confirm that tiled fit remains part of forced execution.

### Code review instructions

Read the printer and runtime diffs together, then trace the additional variant through the test's emitted artifact and batch callback.

## Step 4. Extend guard validation and start acceptance

The first focused run passed and the baseline oracle reported no differences. I added validation for an always-true gate, where automatic launch can never choose the fallback, and a mixed schedule with one contraction variant to check that both gate modes are still issued.

### Prompt Context

See step 1. Acceptance includes unchanged CUDA bytes, both guard diagnostics and all requested CPU suites.

### What I did

Committed the design as `a399672` after rerunning Git with escalation. Ran `node --test tests/tensor/{staged-choice,schedule,plans}.test.mjs`, the baseline check, and `npm run build && npm run check`. Extended mode parity to the standalone schedule fixtures, then started the final checks.

### Why

Gate coverage needs explicit attention even if the two-arm form already provides a fallback. A single variant with a gate is the smallest case where the old alternating algorithm misses one gate side.

### What worked

The initial three focused files passed, the baseline oracle printed `no differences`, and TypeScript accepted the final guard changes. The package and Git escalations were approved.

### What didn't work

The first CPU-suite shell loop began with `status=0` and stopped before running tests with `zsh:1: read-only variable: status`. I replaced that variable with `suite_exit` and restarted the loop.

### What I learned

Coverage of an individual arm is weaker than coverage of every pair of choices. For the existing global flags, repeating the only variant lets both gate sides run.

### What was tricky

The gate's coverage proof depends on longest being at least one and occupied lanes being at most all slots. The emitted host computes those quantities.

### What warrants a second pair of eyes

Both forms use abstract launch statistics. Review any future proposal to claim stronger reachability over concrete shapes.

### Code review instructions

See the gate coverage fixture in `schedule.test.mjs` and the one-variant fixture in `staged-choice.test.mjs`.

## Step 5. Isolate the mode-measurement executor

Two fixture paths can emit the same source. The differential cached the first candidate's result and skipped the second mock call, so the batch recorder saw no modes on the second path despite an accepted verdict.

### Prompt Context

See step 1. The parity tests must observe the modes actually sent to the executor.

### What I did

Assigned a distinct executor profile to each parity observation and reran the focused tests. The production cache keys and differential code are untouched by this fix.

### Why

The executor profile participates in the meaning check's cache key. Distinct recording callbacks should not share its cached results.

### What worked

The failure already showed an accepted verdict with an empty batch observation. The extra-arm and mixed single-variant tests passed on that run.

### What didn't work

`node --test --test-reporter=tap tests/tensor/{staged-choice,schedule,plans}.test.mjs` initially failed with `ERR_ASSERTION` for `f, fuse=false`, actual `[]`, expected `[{}]`.

### What I learned

Identical source is possible for fused and unfused requests on single-statement kernels, even when they were lowered separately.

### What was tricky

A new callback alone cannot distinguish subject evidence. The contract uses the explicit profile string.

### What warrants a second pair of eyes

The test asserts observed batches in mode order. The chosen reference callback records the mode synchronously before returning any computed results.

### Code review instructions

Review `checkedModes` in `staged-choice.test.mjs` beside the subject-key callback in `cuda-contract.ts`.

## Step 6. Update GPU mutant fixtures to use their emitted selects

A source review found three GPU mutant fixtures that manually authored only the old manifest summaries. Those fixtures would otherwise lose forced coverage when the differential reads selects. I also reused the schedule feature program in the CPU mode-parity test.

### Prompt Context

See step 1. Preserve existing assertions and leave GPU execution to the coordinator.

### What I did

Moved the six schedule feature functions verbatim into a shared Tix fixture. The schedule, fusion and terms GPU mutant tests now reuse the manifest from the original emission, then change only its source. Ran `node --check` for all three changed GPU files.

### Why

Fixture manifests should describe the actual emitted choices. Reusing the original also preserves the gate-result decoding order.

### What worked

The earlier focused rerun with independent mock profiles passed all 16 tests. The three GPU test files passed syntax checks.

### What didn't work

No command failed at this step. GPU execution was excluded by the brief.

### What I learned

The schedule mutant fixture needs the full tiled select to preserve its expectation that a tiled mode exposes the mutant. The terms fixture needs both sides of the fusion gate.

### What was tricky

The GPU test change must carry precisely the original program's manifest into a candidate that has different source bytes.

### What warrants a second pair of eyes

GPU execution of the mutants at merge.

### Code review instructions

Check the original-emission calls and verify that all mutant assertions remain in place.

## Step 7. Update the exact softmax manifest expectation

The broad CPU run found one expected manifest assertion that still described the old shape. The same source and gate assertions passed up to the exact manifest comparison.

### Prompt Context

See step 1. Update assertions when the requested behavior changes, and preserve all existing checks.

### What I did

Extended the softmax manifest expectation in `fusion.test.mjs` with the fused predicate and the unfused arm. Kept the other expected fields and the deep equality check. Reran all CPU tensor files.

### Why

The manifest now describes its launch predicate and fallback. An exact expected value should check both.

### What worked

Typed, framework, workbench and stdlib passed with zero failures. The final baseline check printed `no differences`. The focused checks passed before implementation commit `1097072`.

### What didn't work

The initial `node --test --test-concurrency=2 --test-reporter=tap` invocation on the non-GPU tensor files reported 55 passes and one `ERR_ASSERTION`. The test named `a block-mode kernel is one definition that also holds its statements in stage 2 form, behind a gate` printed `Expected values to be strictly deep-equal` and showed the new `select` missing from its expected value.

### What I learned

There were two exact legacy manifest assertions. The first focused selection included the attention one in `plans.test.mjs` and missed this softmax one.

### What was tricky

The test should retain exact deep equality so an unexpected change in the rest of the manifest remains visible.

### What warrants a second pair of eyes

The softmax expectation uses the same named policy constants as the runner. The baselines independently protect the emitted predicate text.

### Code review instructions

Review the full softmax manifest expectation and the unchanged CUDA pattern assertions above it.

## Step 8. Record acceptance and close the ticket

The complete CPU tensor rerun passed all 56 tests. All five CPU suites now have zero failures, and the baseline output has no differences.

### Prompt Context

See step 1. The requested handoff includes the report, acceptance counts and commit.

### What I did

Recorded the final counts and limits in the report, checked the two tasks off and staged the last test and the ticket closeout.

### Why

The report puts the reproducible acceptance evidence alongside the domain and implementation boundaries.

### What worked

Typed 193 passed and 2 skipped, framework 266 passed, workbench 24 passed and 1 skipped, stdlib 61 passed, and tensor 56 passed. The reported skips belong to existing opt-in Candela tests.

### What didn't work

No final validation command failed.

### What I learned

The complete CPU suite exercises manifest consumers beyond the focused schedule and differential tests.

### What was tricky

The report distinguishes forced branch checks from a proof of reachability over correlated concrete shapes.

### What warrants a second pair of eyes

The three GPU mutant fixtures should be part of the coordinator's merge run.

### Code review instructions

Use the design and report links in the ticket index. Review implementation commit `1097072` and the final commit's exact softmax fixture update together.
