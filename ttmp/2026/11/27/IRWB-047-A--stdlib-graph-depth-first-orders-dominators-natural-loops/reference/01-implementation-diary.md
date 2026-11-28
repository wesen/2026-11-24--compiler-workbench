---
Title: Implementation diary
Ticket: IRWB-047-A
Status: complete
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

## Step 2: the modules, the clients, the tests (0207526)

- `src/stdlib/graph/orders.ts`: the solver's iterative walk, extended to report retreating edges as
  (from, to) pairs and to skip successors outside `nodes` (which replaces `cfgOf`'s `!succ[id]`
  guard, so Typed can pass raw successor lists). `src/stdlib/graph/dominators.ts`: CHK verbatim
  (idom entry-first then rpo order, `rounds` kept), `domTree` (children in the facts' key order,
  the walk-based `dominates`), `naturalLoops` (latches in node order, one loop per header in
  first-back-edge order, body by the pop-last predecessors walk) — all three orders are published
  facts, so the port is line-for-line.
- Clients: `cfgOf` takes the rpo from the walk; `dominatorsOf`/`domView` become adapters over
  `dominators`/`domTree` (the `Dominators`/`DomView` types stay, so `passes.ts` and `programs.ts`
  are untouched); `loopsOf` takes head/latches/body from `naturalLoops` and keeps preheaders,
  exits and assigned locals (they read statements and raw successors); new exported `digraphOf(f)`;
  `ssa.ts` calls `dominators(digraphOf(f))` directly (it consumed only the idom map, now
  `d.idom.get(b)`); the solver's `depthFirst` maps retreating-edge targets to the loop-head set.
  Its `postorder` return narrows to `readonly string[]` (nobody mutates it).
- The framework layering test now allows `stdlib/` imports from `src/framework` (design/01, and the
  report says why); the stdlib layering test needed nothing — the new modules import only each
  other.
- The unit tests caught one wrong hand-computation of mine before anything else did: I had the
  two-latch loop's postorder as y-before-x, but the walk visits the header's successors in edge
  order, so x finishes first. Fixed the expectation, not the code.
- Probe 01 (`scripts/01-graph-clients.mjs`): 135 corpus functions, 80 natural loops — the adapters
  and the library agree on idom and rounds everywhere, every idom dominates its node, every loop
  head dominates its body and latches, no latch repeats, and ssa's direct call agrees with the
  published facts.
- Acceptance on 0207526: `npm run check` clean; baselines `no differences`; suites — typed 186 pass
  + 2 pre-existing Candela skips, framework 243, workbench 24, stdlib 16, tensor (non-gpu) 45, all
  pass, 0 fail; `build-site` builds (app.js 3108 KiB); Prettier clean on every file this step
  touched (9 untouched files elsewhere in src still drift, as before).
