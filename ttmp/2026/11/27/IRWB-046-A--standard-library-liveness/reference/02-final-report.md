---
Title: Final report
Ticket: IRWB-046-A
Status: active
Topics:
    - compiler
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:34:18.500808967-05:00
WhatFor: ""
WhenToUse: ""
---

# Final report

Added a pure, synchronous liveness algorithm over finite block arrays, and replaced the allocator and coalescer sweeps with it. The result covers all supplied blocks, including unreachable predecessors, preserving the machine semantics and iteration order. Tests cover the specified unreachable graph, a loop, and the library dependency boundary.

The sweep duplicates the general dataflow framework's fixpoint concept: the requested standard-library boundary prohibits framework dependencies, and the existing framework solver uses entry reachability, unlike these clients. A reusable domain-independent lattice solver is deferred as planned.

The brief refers to a pre-existing todo for this step in the three defect files, but none names liveness or IRWB-046-A; no unrelated todo was changed. Physical-register bitset liveness was left untouched because this step specifies the two set-based clients.

## Later

- Dominators and loops.
- Lattices and a fixpoint solver.
- SSA construction.
- Affine forms.

## Verification

- `npm run build`, `npm run check`, and Prettier checks for changed TypeScript files passed.
- New stdlib tests: 2 test files passed, 0 failed, including the exact unreachable predecessor.
- Baseline check: `no differences` (RV32 and Tix corpus records).
- Requested suites: 70 test files passed, 0 failed after reruns (63 Typed/framework/workbench files and 7 non-GPU tensor files). The initial sandbox run passed 59 of 63 files; four spawned Node and failed under sandbox restrictions. All four passed when rerun with escalation. Node's sandboxed runner reported file-level counts, so these are file counts, not individual test counts. The escalated workbench rerun included one pre-existing skipped test. Existing unrelated todo tests remain.
- `node tools/build-site.mjs` was exercised successfully by the escalated workbench tests; no framework or workbench source changed.
