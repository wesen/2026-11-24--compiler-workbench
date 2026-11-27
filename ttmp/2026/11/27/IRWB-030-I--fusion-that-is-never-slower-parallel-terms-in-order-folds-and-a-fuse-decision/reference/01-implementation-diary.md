---
Title: Implementation diary
Ticket: IRWB-030-I
Status: active
Topics:
    - tensor
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological implementation diary of stage 3b (IRWB-030-I).
LastUpdated: 2026-11-27T12:00:00-05:00
WhatFor: Step-by-step record of decisions, failures and measurements
WhenToUse: Reviewing how the stage reached its results
---

# Implementation diary — IRWB-030-I

## Step 1 — Design (commit 196ed44)

Read the stage-3 design and report, stage 2's, then `src/tensor/` (fusion.ts, cuda-source.ts, cuda-contract.ts,
cuda-runtime.ts, model.ts, parser.ts, passes.ts, evaluate.ts) and the corpus. Wrote the design: parallel term
staging for row-scalar members of block-mode groups with an in-order fold, and a fuse gate decided from the IR
with shape values at launch. Committed.

## Step 2 — Term staging implemented, one real failure

Implemented `reduceNodes` (pre-order, shared by plan and emitter), the staging rules, the plan fields
(`terms`, `termRefusals`, `unfused`), the emitter's term phase + fold, the term pool `q` in the row allocation,
and the first gate form (rows-only threshold 96). Build and all local tests passed; the seven GPU tests passed,
including the new staged-exactness test with a reversed-fold mutant.

**Failure (evidence, not speculation):** the first full baseline run crashed compiling fused attention-inside
with `main.cu(121): error: expected an expression` at `t1[(() * (d1) + (i5))]`. Cause: my first row-scalar test
compared `member.axes.length` to itself (`depth0(member)`), so every member counted as row-scalar and the
planner staged a ROW member's reduction; its term phase runs before the element loop, where the member's
trailing axis is unbound, so the member read in the term body addressed an unbound index. The S0 rule (compare
against the group's depth) is exactly the fix; the failure is the reason S0 exists, recorded here.

## Step 3 — Measurements: the gate's losing region

Script 01 (baseline of the working build), script 02 (shape grid): fused never lost for softmax-like or
layernorm-like groups at any row count 1–4096 or row length 1024–1 048 576 (stage 3's feared few-rows case is
won by the fused kernel, because stage 2's per-row fold thread reads uncoalesced global memory). The losing
region needed an adversarial program: heavy elementwise row phase (`tanh·exp` per element), a trivial or short
fold, nothing staged (z read through `z[i+0,j]` with a different leading extent symbol, since the checker
unifies plain accesses): fused 9.6× slower at 1 row, parity at ~32 rows, ahead from 64. Staging the row did not
rescue it (9.6× → the same). Crossover measured at C = 1024, 4096, 16384 alike → threshold 64.

## Step 4 — Staging rules corrected by probes (script 03)

The planned S2 rule ("stage only bodies with a division or a transcendental") was wrong: with the fused kernel
on both sides, a multiply-of-loads fold staged 1.12× faster, a 20 000-term fold staged 2.8× faster even with the
term pool pushing the row set into the scratch fallback, a single global load staged neutral, and a pure copy of
a staged row 3% slower. Final rule: stage unless the body is a single load (residency recorded in the reason).
Two probe-design failures along the way: the first "cheap" probe compared against `unfusedPlan` instead of the
same fused kernel with inline folds (fixed in script 03's final form; script 05 does the three-way comparison).

## Step 5 — Final measurements

Script 04: all eight programs, fused ≤ unfused, fused/unfused digests equal at full size, and fused, unfused and
the f32 interpreter word-equal at reduced sizes. Script 05 (running): staged vs inline-fold vs unfused per
program. Contract cost and the report follow.

## Step 6 — Final measurements, report (commit ba69878)

Script 04 (three benchmark calls per column): all eight programs fused ≤ unfused, fused/unfused digests equal
at full size, and fused, unfused and the f32 interpreter word-equal at reduced sizes. Script 05 separates the
claims: layernorm inside — staged 0.198 ms, inline folds (the stage-3 lowering) 0.491 ms, unfused 0.391 ms;
softmax, attention inside and mlp stage nothing and their staged/inline columns are equal, as they must be.
Script 06: the exact check costs 2.2–2.6 s cold and 1–3 ms memoized, all accepted exact. Script 07: six
staged-feature programs through the full case battery, all exact and word-equal. Prettier clean; all
tests/tensor suites pass (language 5, passes 7, corpus 6, cuda 4, fusion 11, fusion-gpu 8). No framework
change; the launch gate's placement outside the checked transformation is reported as a finding.
