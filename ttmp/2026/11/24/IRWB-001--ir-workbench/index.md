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
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/01-combining-ir-workbench-v6-and-compiler-workbench.md
      Note: Proposal for combining both prototypes
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/02-typed-to-rv32-compiler-on-the-v6-framework-worked-examples.md
      Note: Worked examples of the whole Typed to RV32 compiler on the v6 framework
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/03-candela-to-typed-to-rv32-as-one-artifact-chain-with-candela-facts-driving-passes.md
      Note: Candela facts driving Typed/RV32 passes on the framework
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/compiler-workbench-projects/src/book/01-welcome.md
      Note: Imported Compiler Workbench (typed → RV32) source tree entry point
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/README.md
      Note: Imported v6 prototype source tree (entry point)
ExternalSources:
    - local:ir-source-workbench-v6-complete.zip
    - local:ir-workbench-v6-user-guide.md
    - local:Compiler Workbench_ projects.zip
Summary: Build an IR workbench. Seeded with the imported IR Workbench v6 prototype (TypeScript, four-layer compiler framework + offline browser debugger) and its user guide.
LastUpdated: 2026-11-24T18:23:44.116356865-05:00
WhatFor: Planning and building an inspectable IR / compiler workbench in this repository.
WhenToUse: Start here; read analysis/01 for what the v6 prototype is.
---

# IR Workbench

## Overview

Goal: create an IR workbench, a framework plus UI for building and inspecting compilers whose IRs are domain representations such as CAD, meshes, scenes, expressions and constraints.

The starting material is the **IR Workbench v6** prototype (0.6.0, TypeScript). Its source, docs (including the user guide), tests and scripts are imported unchanged into `sources/ir-source-workbench-v6/`; see [sources/README.md](./sources/README.md) for what was imported and what was left out. The prototype separates an incremental runtime, Strategy IR, semantic contracts and generic IR manipulation, and ships a standalone offline HTML compiler debugger.

A second prototype, **Compiler Workbench: projects** (a Typed → RV32 compiler lab: passes, dataflow, differential checks, backend, projects, UI DSL, agent, book), is imported into `sources/compiler-workbench-projects/`.

- **Analysis, v6:** [analysis/01-ir-workbench-v6-import-analysis.md](./analysis/01-ir-workbench-v6-import-analysis.md). Covers what the archive and guide contain, the architecture, the verification status and open questions.
- **Analysis, Compiler Workbench and overlap:** [analysis/02-compiler-workbench-projects-import-and-overlap-analysis.md](./analysis/02-compiler-workbench-projects-import-and-overlap-analysis.md)
- **Design, combining both:** [design-doc/01-combining-ir-workbench-v6-and-compiler-workbench.md](./design-doc/01-combining-ir-workbench-v6-and-compiler-workbench.md)
- **Design, worked examples:** [design-doc/02-typed-to-rv32-compiler-on-the-v6-framework-worked-examples.md](./design-doc/02-typed-to-rv32-compiler-on-the-v6-framework-worked-examples.md). The whole Typed → RV32 compiler written on v6, plus the extensions it needs (E1–E9).
- **Design, Candela chain:** [design-doc/03-candela-to-typed-to-rv32-as-one-artifact-chain-with-candela-facts-driving-passes.md](./design-doc/03-candela-to-typed-to-rv32-as-one-artifact-chain-with-candela-facts-driving-passes.md). Candela at the top of the artifact chain; its facts drive Typed and RV32 passes.
- **Analysis, Candela inventory:** [analysis/03-candela-inventory-for-the-typed-chain-what-the-gallery-program-needs-from-typed-blocks.md](./analysis/03-candela-inventory-for-the-typed-chain-what-the-gallery-program-needs-from-typed-blocks.md). What the gallery program (332 functions, about 13,000 f32 operations) needs from `typed.blocks`, and the ordered plan.
- **Diaries:** [log/01-diary.md](./log/01-diary.md) (planning), [log/02-implementation-diary.md](./log/02-implementation-diary.md) (implementation, steps 1–6), [log/03-backend-agent-diary.md](./log/03-backend-agent-diary.md) (backend subagent), `log/04-f32-candela-agent-diary.md` (f32 subagent) and `log/05-ui-agent-diary.md` (UI subagent).
- **Report 1 (vault):** `Projects/2026/11/24/PROJECT REPORT - IR Workbench - A Compiler Defined on Its Own IR Framework - …` in go-go-parc.

Current state (implementation, branch `irwb-001/import-v6-prototype`):
- **Framework.** v6 is lifted whole into `src/framework/`, with extensions E1–E6.
- **Typed compiler.** `src/typed/` holds lifting, `typed.blocks`, the evaluator and meaning check, 6 analyses, 11 passes, pipelines as plans, the program host, the RV32 backend, and specialization on outer facts.
- **Parity.** Every number the Compiler Workbench book states is reproduced by a test: Blend's revisions and why tree, the image sizes and instruction counts, the corpus figure of 6,986 decided cases with 14 at the step limit, and the chapter 13 and 14 comparisons with the reference compiler.
- **In progress.** f32 and Candela lifting (subagent), and the UI on the new host (subagent).
- **Blocked by permission policy.** Phase 0, running the downloaded prototypes themselves. Parity uses independent oracles instead.

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
