---
Title: 'A function-incremental framework: analyses per function part, a lazy projection, a persistent store, and demand-driven queries'
Ticket: IRWB-009
Status: active
Topics:
    - compiler
    - ir
    - performance
    - workbench
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-009--a-function-incremental-framework-analyses-per-function-part-a-lazy-projection-a-persistent-store-and-demand-driven-queries/design-doc/01-intern-guide-a-function-incremental-framework-for-the-ir-workbench.md
      Note: the intern guide
    - Path: repo://ttmp/2026/11/26/IRWB-009--a-function-incremental-framework-analyses-per-function-part-a-lazy-projection-a-persistent-store-and-demand-driven-queries/scripts/03-o2-edit-size.mjs
      Note: two-minute Candela O2 revision-identity gate without the meaning check
ExternalSources: []
Summary: 'Research ticket: make the cost of an edit on the IR Workbench proportional to the function parts it changes, with every revision hash unchanged. This round delivers the intern guide (design-doc 01) and six grounding measurements on Candela; nothing is implemented yet.'
LastUpdated: 2026-11-26T10:45:00-05:00
WhatFor: Designing and later implementing a function-incremental framework (analyses per part, lazy projection, persistent store, queries with early cutoff).
WhenToUse: Before working on incremental compilation, the analysis manager, createIRArtifact, the task runtime, or the browser's Candela open path.
---

# A function-incremental framework: analyses per function part, a lazy projection, a persistent store, and demand-driven queries

## Overview

After IRWB-004, three pieces of the IR Workbench still do whole-program work on every revision: analyses are solved and frozen for the whole program, `createIRArtifact` builds the projection eagerly (and `applyPass` builds a total correspondence), and validation walks the whole value. On Candela a pass that changes 2 of 332 functions costs 6.3–8.4 s before the meaning check, and opening Candela or running a pass in the browser holds the page for 8.6 s and 21.3 s.

**Status:** design delivered, not implemented. The guide (`design-doc/01-intern-guide-a-function-incremental-framework-for-the-ir-workbench.md`) explains the system with measurements (`scripts/01`–`06`, `various/01`–`06`) and proposes keys (part, code and closure hashes; a toolchain fingerprint), facts per part on demand, validation per part, a lazy per-part projection with a compact correspondence, adoption on the page in slices, a persistent store with a trust model, and a query engine on the existing task runtime, with a phased plan (P0–P6) whose last phase measures "cost per edit independent of program size" as an invariant. The diary is `log/01-irwb-009-diary.md`. The vault report is deferred to the implementation milestone.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- performance
- workbench

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
