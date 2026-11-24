---
Title: IR Workbench
Ticket: IRWB-001
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/analysis/01-ir-workbench-v6-import-analysis.md
      Note: Analysis of what the imported sources are
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/README.md
      Note: Imported v6 prototype source tree (entry point)
ExternalSources:
    - local:ir-source-workbench-v6-complete.zip
    - local:ir-workbench-v6-user-guide.md
Summary: Build an IR workbench. Seeded with the imported IR Workbench v6 prototype (TypeScript, four-layer compiler framework + offline browser debugger) and its user guide.
LastUpdated: 2026-11-24T18:23:44.116356865-05:00
WhatFor: Planning and building an inspectable IR / compiler workbench in this repository.
WhenToUse: Start here; read analysis/01 for what the v6 prototype is.
---

# IR Workbench

## Overview

Goal: create an IR workbench, a framework plus UI for building and inspecting compilers whose IRs are domain representations such as CAD, meshes, scenes, expressions and constraints.

The starting material is the **IR Workbench v6** prototype (0.6.0, TypeScript). Its source, docs (including the user guide), tests and scripts are imported unchanged into `sources/ir-source-workbench-v6/`; see [sources/README.md](./sources/README.md) for what was imported and what was left out. The prototype separates an incremental runtime, Strategy IR, semantic contracts and generic IR manipulation, and ships a standalone offline HTML compiler debugger.

- **Analysis:** [analysis/01-ir-workbench-v6-import-analysis.md](./analysis/01-ir-workbench-v6-import-analysis.md). Covers what the archive and guide contain, the architecture, the verification status and open questions.
- **Diary:** [log/01-diary.md](./log/01-diary.md)

Current state: the relevant v6 files are imported into `sources/ir-source-workbench-v6/` and verified against the release manifest, and the analysis is written. Next: decide reuse vs. reimplementation and scope (analysis §9).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- workbench
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
