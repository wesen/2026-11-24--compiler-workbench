---
Title: 'stdlib/graph: depth-first orders, dominators and natural loops'
Ticket: IRWB-047-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/dataflow/solver.ts
      Note: depthFirst is now the library's order; the framework's only stdlib import
    - Path: repo://src/stdlib/graph/digraph.ts
      Note: the digraph every primitive takes
    - Path: repo://src/stdlib/graph/dominators.ts
      Note: immediate dominators, dominates, the dominator tree
    - Path: repo://src/stdlib/graph/loops.ts
      Note: natural loops, one per header, with all its latches
    - Path: repo://src/stdlib/graph/orders.ts
      Note: postorder, reverse postorder, retreating edges
    - Path: repo://src/typed/analyses.ts
      Note: the Typed adapters (digraphOf, cfgOf, dominatorsOf, domView, loopsOf)
    - Path: repo://tests/stdlib/graph.test.mjs
      Note: the primitives on known graphs, and both clients
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:21:46.973198225-05:00
WhatFor: ""
WhenToUse: ""
---

# stdlib/graph: depth-first orders, dominators and natural loops

## Overview

IRWB-039 phase 2c, graph part: the depth-first orders, the immediate dominators with the dominator
tree and `dominates`, and the natural loops move out of `src/typed/analyses.ts` and
`src/framework/dataflow/solver.ts` into `src/stdlib/graph/`, over one digraph interface (nodes, an
entry, successors). Typed's analyses keep their public shapes as thin adapters, and the framework's
solver calls the library's walk. Byte-identical baselines; the two clients and the primitives are
covered by `tests/stdlib/graph.test.mjs`. Status: complete, report in `reference/02-…md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- typescript

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
