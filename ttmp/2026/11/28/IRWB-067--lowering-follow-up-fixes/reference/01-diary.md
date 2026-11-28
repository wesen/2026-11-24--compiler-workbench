---
Title: Diary
Ticket: IRWB-067
Status: active
Topics:
    - tensor
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T03:39:22.723206355-05:00
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

## Step 1: Orient and measure

Read the phase 4c guide, inspected the bridge and existing corpus tests, created this ticket and measured the unmodified path.

**Prompt Context:** “Your task: F42, lowering follow-ups from phase 4b ... One schedule registry ... The schedule memo ... measure before and after.” The full request also requires corpus correspondence and byte identity, baseline and suite checks, a detailed diary and commits.

**What I did:** Created the ticket and benchmark script; built and ran 20 warmups and five batches of 100 matmul lowerings. Results in ms/call: 8.177, 6.261, 5.603, 6.725, 6.070.

**Why:** Establish a reproducible before measurement and locate the supported collection API.

**What worked:** `npm run build` and the benchmark. `onResult` provides full pass results; execution records contain summaries.

**What didn't work:** `cat AGENTS.md` reported `No such file or directory`; the user supplied global instructions. An initial tool invocation had a JavaScript syntax error before executing any shell command.

**What I learned:** The existing memo already keys the entire function and fusion flag; the duplicate CUDA registry bypasses it.

**What was tricky:** The artifact for the initial schedule must be the same one used by the cached pass results when composing correspondence.

**What warrants a second pair of eyes:** Whether function-content keys meet revision isolation requirements; the schedule depends only on function content and fusion.

**Code review instructions:** Read the design note, benchmark script, and bridge's `onResult` API.

## Step 2: Reuse the scheduler's evidence

The scheduler now collects pass results at execution and CUDA lowering composes those cached correspondences.

**Prompt Context:** See step 1.

**What I did:** Factored registry construction into one factory, kept the exported registry for plan consumers, and used a local instance with an `onResult` collector on a cache miss. Cached the initial schedule alongside the results. Added a memo separation test.

**Why:** A local collector avoids cross-call state and the cached initial artifact ensures the correspondence chain joins exactly.

**What worked:** Build and existing corpus lowering test passed. The benchmark measured 4.071, 2.082, 2.173, 2.082, 1.948 ms/call after the change.

**What didn't work:** No implementation failure.

**What I learned:** Avoiding scheduling cuts the measured median from 6.261 to 2.082 ms; composing and checking the lowering still has a measurable cost.

**What was tricky:** Existing plan tests use the exported registry, so the factory serves both direct plan execution and collected scheduling.

**What warrants a second pair of eyes:** Memo key semantics and preservation of pass result ordering.

**Code review instructions:** Review `strategy.ts`, `cuda-contract.ts`, and the new test in `lowering.test.mjs`.

## Step 3: Commit and validate

Committed the implementation and launched the acceptance checks.

**Prompt Context:** See step 1.

**What I did:** Built and checked TypeScript, ran the focused lowering test, started the oracle and non-GPU suites, and committed as `2688261`.

**Why:** The corpus tests exercise both source identity and composed correspondence; the oracle covers the broader compiler outputs.

**What worked:** `npm run build`, `npm run check`, and `node --test tests/tensor/lowering.test.mjs` passed.

**What didn't work:** `git add ...` and `git commit ...` initially failed with `fatal: Unable to create '.../index.lock': Read-only file system`; the elevated Git operation succeeded.

**What I learned:** The sandbox protects the linked worktree index despite the configured writable Git root.

**What was tricky:** Full suites and baseline checks are expensive on the shared machine.

**What warrants a second pair of eyes:** The report's content-key rationale and performance comparison.

**Code review instructions:** Review commit `2688261`, then the acceptance results below.

## Step 4: Acceptance results

The oracle matched and the four sandbox failures passed when rerun outside the sandbox.

**Prompt Context:** See step 1.

**What I did:** Ran the baseline check and all requested non-GPU test files, then reran four failed files with elevated permissions.

**Why:** The user explicitly warned that tests spawning Node can fail in the sandbox.

**What worked:** The oracle printed `no differences`. Of 89 test files, 85 passed initially; the four rerun files passed 15 tests with one conditional skip.

**What didn't work:** The initial `node --test --test-reporter=spec ...` run reported failures in `tests/typed/format.test.mjs`, `tests/typed/reference-check.test.mjs`, `tests/workbench/candela.test.mjs`, and `tests/workbench/site.test.mjs`, each with only `test failed`; the reporter did not reveal a cause.

**What I learned:** Elevated reruns resolve these four failures, but the captured diagnostics do not prove EPERM was the cause.

**What was tricky:** File-level isolation suppressed individual test diagnostics in the first run.

**What warrants a second pair of eyes:** The one conditional Candela skip and the initial unexplained failures.

**Code review instructions:** Read the report and rerun the four files if investigating sandbox behavior.

## Step 5: Repeat on the report commit

Repeated acceptance on `078ce3a`, then isolated the single reported failure.

**Prompt Context:** See step 1.

**What I did:** Ran build, check, the oracle and the elevated full non-GPU suite. Reran `node --test tests/typed/chess-search.test.mjs` elevated.

**Why:** Verify the final implementation and investigate the failure rather than assume a sandbox cause.

**What worked:** Build and check passed; the oracle printed `no differences`; the isolated chess test passed four tests.

**What didn't work:** The full run reported 622 passed, one failed file (`tests/typed/chess-search.test.mjs:1:1`, `test failed`), and three skipped. No cause was shown.

**What I learned:** The file passes alone; a transient resource or concurrency issue is possible but unconfirmed.

**What was tricky:** The file-level failure gave no underlying diagnostic.

**What warrants a second pair of eyes:** Investigate if the chess failure recurs in the coordinator's full run.

**Code review instructions:** Read the final validation paragraph in the report; only this documentation changed after the checks.
