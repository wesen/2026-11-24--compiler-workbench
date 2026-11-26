---
Title: 'Sketch: image-level contracts for float freedom (tolerance contracts judged on rendered frames)'
Ticket: IRWB-011
Status: active
Topics:
    - compiler
    - ir
    - candela
    - verification
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-011--sketch-image-level-contracts-for-float-freedom-tolerance-contracts-judged-on-rendered-frames/design-doc/01-sketch-guide-image-level-contracts-for-float-freedom.md
      Note: the sketch guide
    - Path: repo://ttmp/2026/11/26/IRWB-011--sketch-image-level-contracts-for-float-freedom-tolerance-contracts-judged-on-rendered-frames/log/01-sketch-guide-diary.md
      Note: the investigation diary
ExternalSources: []
Summary: "Sketch ticket: a tolerance contract for float transformations, judged on rendered Candela frames against the renderer's own Monte Carlo noise. Guide (design-doc 01): noise floor of eight scenes, three transformations measured (contraction saves 1.6-4.2% and changes no display level in six of eight scenes), contract design, experiments E0-E5."
LastUpdated: 2026-11-26T09:41:27.93341293-05:00
WhatFor: ""
WhenToUse: ""
---

# Sketch: image-level contracts for float freedom (tolerance contracts judged on rendered frames)

## Overview

A sketch ticket, recorded so the idea is not lost: let float transformations that change the last bit (contraction into `fmadd.s`, reassociation, reciprocals) be accepted by a contract judged on rendered frames, in units of the renderer's own Monte Carlo noise, in pipelines separate from the exact ones. Nothing is implemented.

- **Guide:** `design-doc/01-sketch-guide-image-level-contracts-for-float-freedom.md` (system parts, IEEE-754 and Monte Carlo background, measurements, contract design, experiments E0-E5, open questions).
- **Measured (E0, E0b):** one pass against another differs by 8.0-17.4 dB display PSNR, two 16-pass means by 10.8-30.5 dB, per scene. Contraction saves 1.62-4.17 % of executed instructions and changes no 8-bit display level in six of eight scenes; in G-01 and S-02 a few pixels diverge. The reciprocal saves nothing on the emulator, and constant reassociation at most 0.06 %. A budget on the RMS of the paired difference wrongly rejects contraction on S-02, so the paired test must separate bias from divergence.
- **Diary:** `log/01-sketch-guide-diary.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- candela
- verification
- research

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
