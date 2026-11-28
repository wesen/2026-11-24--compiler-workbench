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
