---
Title: Diary
Ticket: IRWB-038-B
Status: active
Topics:
    - compiler
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:55:25.705992437-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Fix the comparison boundary

I started at merged revision 93ec5fc. The review asks which repeated compiler mechanisms belong in the framework, what to keep, and how to migrate in independently testable steps. The requested deliverables are a ticket design, committed probes, a diary, and a final summary. I read the framework guides, coordinator report and backlog first. The historical design treats transformations, IR projections and measurements as separate levels. The current pass bridge raised a narrower question about how a native pass carries its gate. See src/framework/passes/bridge.ts:39 and src/tensor/contract.ts:125.

I compared each named sibling with t6-base and checked working-tree status separately. A clean committed diff alone misses work in D1-D, D1-C, A0-C and B1-D. The inventory will label working-copy evidence explicitly. All execution will use the review checkout or standalone, read-only input. No remote device measurements are needed to test a pass boundary.

## 2. Reproduce the boundaries before designing the interface

Checkpoint 1e16b53 established the ticket. I built this checkout with the TypeScript compiler and Node type declarations already installed in the A0-B sibling (read-only). Run the scripts below from the repository root. Node was v24.18.0. A normal installation can use npm run build.

- scripts/01-pass-boundary.mjs:17 exercised one genuine split with the same exact gate on both outputs. The ordinary strategy succeeded and returned a changed revision without a contract. A managed correspondence-only inline failed on the entity universe. Complete declared statement lists with zero mapping groups passed the manager. The inline trace retained f/y and removed f/p. The assurance helper labelled missing evidence exact.
- scripts/02-binding-times.mjs:25 compared B1-G's source directly with the merged solver. Both schedules returned local 3 as the only static local. Worklist took six visits, round-robin ten. This establishes expressibility for a cycle of copies only.
- scripts/03-merged-fixtures.sh:4 exercises core policy, rewrite, strategy, contract, lowering, Tix pass/fusion, and Typed attribution fixtures on CPU.
- scripts/04-cell-survey.py:45 pairs a committed diff against t6-base with a working-copy locator per cell. First run stopped at a report without a Markdown H1 (StopIteration). The script now falls back to the first line. The snapshot includes all 31 rows.
- scripts/05-reduction-order.mjs:12 tested T6-D's checker on a loop permutation. At R=17 the helper allowed an order whose f32 fold gives zero instead of one. The actual reorder precondition refused that permutation. The experiment distinguishes the strength of those two checks.

The first git add failed with “Read-only file system” on the shared index.lock. Authorized staging and commits use the Git metadata permission. Only ticket files are staged.
