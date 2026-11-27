---
Title: Liveness design
Ticket: IRWB-046-A
Status: active
Topics:
    - compiler
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T18:34:16.403783772-05:00
WhatFor: ""
WhenToUse: ""
---

# Liveness design

The supported input is a finite ordered array of blocks, each with successor indices into that array and finite sets of upward-exposed uses and definitions. Values can be any set keys. The synchronous primitive returns live-in and live-out sets aligned with the input order. It computes the least solution of `out[b] = union(in[s])` and `in[b] = use[b] union (out[b] - def[b])` by reverse sweeps.

Scope is **all supplied blocks**, including unreachable blocks: callers supply precisely the graph to analyze. An entry-reachable solver is the simplest alternative, but would change both existing machine clients on an unreachable predecessor of a reachable join. There is no entry argument; a caller wanting reachable-only results can supply that subgraph itself.

Put this algorithm in `src/stdlib/flow/liveness.ts`, exported by `src/stdlib/index.ts`. The dependency boundary is enforced by an executable import test. Both clients retain their existing instruction-to-use/def extraction, and use the same primitive; this avoids introducing a domain-specific API into the library. A generic lattice solver is an alternative, but adds machinery unnecessary for this extraction.

## Later

- `graph/`: dominators and loops.
- `lattice/`: lattices and a fixpoint solver.
- `ssa/`: SSA construction.
- `affine/`: affine forms.
