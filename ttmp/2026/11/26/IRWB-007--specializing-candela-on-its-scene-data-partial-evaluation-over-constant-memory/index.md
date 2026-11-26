---
Title: 'Specializing Candela on its scene data: partial evaluation over constant memory'
Ticket: IRWB-007
Status: active
Topics:
    - compiler
    - ir
    - candela
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/design-doc/01-intern-guide-specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory.md
      Note: the intern guide
    - Path: repo://ttmp/2026/11/26/IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/log/01-scene-data-specialization-diary.md
      Note: the diary of this round
    - Path: repo://ttmp/2026/11/26/IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/various/04-profile-summary.txt
      Note: the binding-time profile tables (measurement 3)
ExternalSources: []
Summary: "Partial evaluation of Candela over its frame-constant scene buffers (the first Futamura projection of the gallery's path tracer). Guide round done: intern guide, measurements, phased plan; implementation not started."
LastUpdated: 2026-11-26T11:30:00-05:00
WhatFor: "Specializing Candela on the scene data the host fills before a frame (IRWB-002 item E4)."
WhenToUse: "Before implementing any phase of scene-data specialization."
---

# Specializing Candela on its scene data: partial evaluation over constant memory

## Overview

Candela's kernel interprets five row buffers that describe the scene (uniforms, objects, lights, BVH, extra data). Today's per-scene kernels specialize only on `K.scene`: images 58% smaller, 5–6% fewer instructions per pixel. This ticket designs partial evaluation over the buffers themselves: a constant-memory fact, a checked host promise, and a polyvariant specializer in phases.

Status of this round: the intern guide (`design-doc/01-…`) is written, read a second time, revised, and uploaded to reMarkable. Nothing is implemented. The guide's measurement 3 bounds the gain per pixel: a monovariant specializer gets at most 1.68× on any scene; a polyvariant one up to 2.1–4.5× on 11 scenes, and below 1.7× on the 7 ray-marched and volume scenes. The implementation phases 0–5 are the open tasks.

- Guide: `design-doc/01-intern-guide-specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory.md`
- Diary: `log/01-scene-data-specialization-diary.md`
- Measurements: `scripts/01–04`, outputs in `various/01–04`

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- candela
- performance

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
