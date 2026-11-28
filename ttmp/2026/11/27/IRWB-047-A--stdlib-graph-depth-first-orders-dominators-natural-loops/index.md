---
Title: 'stdlib graph: depth-first orders, dominators, natural loops'
Ticket: IRWB-047-A
Status: active
Topics:
    - stdlib
    - graph
    - dominators
    - dataflow
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-graph-g-h/irwb-047-a/src/stdlib/graph/dominators.ts
      Note: CHK dominators, domTree, naturalLoops
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-graph-g-h/irwb-047-a/src/stdlib/graph/orders.ts
      Note: the Digraph interface and the depth-first walk (postorder, rpo, retreating edges)
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-graph-g-h/irwb-047-a/tests/stdlib/graph.test.mjs
      Note: the primitives on small graphs, incl. unreachable, two-latch, irreducible
ExternalSources: []
Summary: "Depth-first orders, CHK dominators and natural loops moved into src/stdlib/graph over one Digraph; typed analyses, ssa and the framework solver call the library; baselines unchanged."
LastUpdated: 2026-11-27T20:19:52.160021639-05:00
WhatFor: "The graph step of the standard library (IRWB-039 phase 2c)."
WhenToUse: "Reviewing or extending the graph module of the standard library."
---

# stdlib graph: depth-first orders, dominators, natural loops

## Overview

<!-- Provide a brief overview of the ticket, its goals, and current status -->

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- stdlib
- graph
- dominators
- dataflow

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
