---
Title: Implementation diary
Ticket: IRWB-029-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T23:01:41.650264632-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Establish the lowering boundary

The request was to implement “Stage 3 fuses statements into fewer kernels **without changing any result bit.**” I read the preceding stage designs and reports and traced the emitter, batch protocol and contract keys. The source artifact already identifies the actual translation unit. The host timer already implements the requested benchmark.

The offline install succeeded. Running the remote tool on scripts/01-row-probe compiled on the GB10 and printed 32, confirming the dynamic shared array and block synchronization used by the design. Review the planner's internal-read and escape tests together with its host launch geometry.

## Step 2. Plan on resolved binders, then emit the existing scalar tree

I committed the design at 0842a09 before implementation. The element planner admits repeated reads such as GELU's five references to h. It computes h once per thread. A candidate group's earlier definitions can disappear only once every use, including the function return, is accounted for. The row planner checks the first affine index of every shared-row access. Nontrivial second indices are valid because each vector stage finishes before the next one starts.

The first implementation's full-size hashes agreed in all twelve runs. Softmax nevertheless took 0.941 ms with one kernel versus 0.805 ms with four. Its serial max executed the branch-based min/max helper for every element. The small PTX probe in scripts/03-max-probe returned 00000000 00000000 7fffffff 00000000. Replacing just that binary operation in the sequential row fold reduced the next softmax median to 0.410 ms. The comparisons use canonical NaN by class. No fold tree was changed.

The block also kept the staged input alive after its final read. The final planner recycles a row slot when its value expires. A replacement that reads the expiring tensor may reuse it only at its own column. Otherwise other lanes may still be reading the old contents, so the replacement gets distinct storage. Review rowSlots, the affine-read GPU mutation test and the large-row scratch path together.

The first git add failed with “Read-only file system” on the shared worktree index. Escalated git succeeded. The first benchmark launcher exited before producing output in the sandbox. Keeping a foreground tmux wait-for attached to the launcher fixed its lifetime. Its first script import then failed with ERR_MODULE_NOT_FOUND because the relative path went up one directory too far. Correcting the import let all six runs execute through the public API.
