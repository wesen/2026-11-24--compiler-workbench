---
Title: Implementation diary
Ticket: IRWB-030-J
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of stage 3b: design, staged terms, the decline rule, measurements.
LastUpdated: 2026-11-27T02:10:00-05:00
WhatFor: Resuming or reviewing this stage
WhenToUse: Tracing why a decision was made or which command produced a number
---

# Implementation diary

## Step 1: Read stages 2-3, confirmed the diagnosis, wrote the design

I read the stage 3 and stage 2 designs, reports and diaries (IRWB-029-D, IRWB-022-I), the framework contracts and IR READMEs, `define-pass.ts`, the tensor sources and tests, then the merged code. The emitted fused kernel for the inside placement of layernorm shows the cause the brief names: the row-scalar member's element loop degenerates to thread 0 (`n = 1`), and the reduction's body — a division per term — sits inside the serial fold. I created the ticket, wrote the design (parallel terms staged by the block and folded in order by thread 0; a decline rule from the IR plus launch shapes), and committed it.

### What I did
- Read `src/tensor/` and `tests/tensor/` in full; printed `cudaSource` of an inside-layernorm variant and located the thread-0 fold (`for (I i4 = 0; i4 < end_i4; ++i4) { float v1 = __fdiv_rn(...); v0 = __fadd_rn(v0, v1); }`).
- `docmgr ticket create-ticket --ticket IRWB-030-J ...`; wrote `design-doc/01-parallel-reduction-terms-and-a-fuse-or-not-decision.md`.

### Why
- The design fixes the two deliverables before touching code: which bodies get parallel terms (rank == depth, `dim` extents, body with an op/call/nested reduce), and when a group is left unfused (cap binds and `points × T` below a measured constant).

### What I learned
- `docmgr doc add` templates the doc it creates; the design must be written into the path it makes.

### What warrants a second pair of eyes
- The claim that a mixed plan (some groups fused, some declined) is exact by composition: each kernel is either a legality-checked fused kernel or stage 2's own; only the `stored` sets differ, and storing more never changes values.
