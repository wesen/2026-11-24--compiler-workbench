---
Title: Diary
Ticket: IRWB-034-F
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:11:27.986597019-05:00
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
The task is the brief `IRWB-034-F` (D1: why `speed` makes the bytecode VM slower), handed to this session as a
prompt file by the coordinator. Its text is not repeated here; its requirements are summarized in the design doc.

## Step 1: Setup, two probes, and the design

The worktree had no `node_modules`; `npm ci` and `npm run build` in the worktree (no other directory used). Then
two probes before writing the design, so the design could say what the attribution must explain.

### What I did
- `scripts/01-pass-prefix.mjs`: applies `speed` one pass at a time on the bytecode VM and counts both fixtures
  (n = 12, seed = 8, `coalesce: true`) after each pass. Output (fib, checksum, spills, saved, insns):
  r0 7678 6874 0 0 210; after cfg/fold/cfg 6688 5968 0 0 206; **after licm 9287 8219 0 10 226**; final
  9286 8218. `inline` and `rotate` change nothing.
- `scripts/02-licm-listing.mjs`: IR and counted image before and after licm. Nine back edges into
  `bb:runVm.3`; `typed.loops` gives nine loops with one id `loop:runVm@bb:runVm.3`; licm makes nine
  preheaders and redirects the other latches through them. After cfg: one block of 15 `addi rd, sp, k` plus a
  jump, 184 executions per Fibonacci run.
- `scripts/03-corpus-measure.mjs`: per-project instructions under r0, O2, speed (10 cases per function, seed 7,
  from r0), default backend and `coalesce: true`, plus a count of loop heads shared by several back edges at
  licm's input. Baseline run started in the background into `scripts/results/03-baseline.{log,json}`.
- Design doc written: attribution by lineage through correspondence plus edit logs, earliest-decision credit and
  debit, exact sum identity; fix = licm merges loops by head.

### Why
- The prefix replay is cheap and tells which pass; it is kept as the independent cross-check of the attribution.

### What worked
- The probes pinned licm at once; the IR listing shows the mechanism.

### What didn't work
- Nothing failed. Note: `sharedHeads` measured at r0 was 0 for the bytecode VM (r0's latches jump through
  blocks that cfg threads later); the probe now measures at the O2 prefix before licm, where it is 1.

### What I learned
- O2 has the same slowdown (bytecode VM default backend: r0 39,954, O2 47,076 over the metric's cases).
- Typed correspondence records new entities and removals; an in-place edit (a retarget) appears as `retained`
  with no reason, so the edit log must be read too.

### What should be done in the future
- Merge loops in `typed.loops` itself (version 2), see the design's Later list.
