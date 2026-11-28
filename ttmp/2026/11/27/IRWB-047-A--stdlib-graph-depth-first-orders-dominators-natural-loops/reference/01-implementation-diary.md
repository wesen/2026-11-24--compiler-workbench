---
Title: Implementation diary
Ticket: IRWB-047-A
Status: active
Topics:
    - compiler
    - stdlib
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Diary of IRWB-047-A
LastUpdated: 2026-11-27
WhatFor: "The step-by-step record of moving the graph algorithms into the standard library."
WhenToUse: "Resuming or reviewing IRWB-047-A."
---

# Implementation diary

## Step 1: ticket, orientation, design

- Read `src/stdlib/index.ts` (admission rule, layering D, `flow/liveness.ts` as the shape of a
  module), the three algorithm sites (`cfgOf` and `dominatorsOf`/`domView`/`loopsOf` in
  `src/typed/analyses.ts`, `depthFirst` in `src/framework/dataflow/solver.ts`), and the callers
  (`typed/ssa.ts` consumes only the idom map; `typed/passes.ts` and `workbench/programs.ts` go
  through the views; the solver consumes postorder and retreating-edge targets).
- Found the one boundary in the way: `tests/framework/layering.test.mjs` forbids any import outside
  `src/framework`, but the v7 plan's phase 2c explicitly moves "the framework solver's helpers" into
  the library, so that test's first assertion is one this step is meant to change (recorded in the
  design and the report).
- Design committed (design/01): one `Digraph { nodes, entry, succ }`; predecessors derived inside
  the library (reproduces `cfgOf`'s block-order lists); orders as one walk returning postorder,
  reverse postorder and retreating edges; CHK dominators verbatim with `rounds`; natural loops one
  per header with all latches; the idom insertion order and the body/latch orders pinned because
  they are published facts.
