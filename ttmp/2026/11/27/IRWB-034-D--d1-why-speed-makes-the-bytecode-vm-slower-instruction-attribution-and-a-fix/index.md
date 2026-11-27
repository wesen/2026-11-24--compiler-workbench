---
Title: 'D1: why speed makes the bytecode VM slower, instruction attribution and a fix'
Ticket: IRWB-034-D
Status: review
Topics:
    - compiler
    - ir
    - performance
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/typed/attribution.ts
      Note: the attribution tool this ticket adds
    - Path: src/typed/passes.ts
      Note: the licm cost check
    - Path: tools/attribution.mjs
      Note: the CLI over the tool
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T14:30:00-05:00
WhatFor: ""
WhenToUse: ""
---

# D1: why `speed` makes the bytecode VM slower

## Overview

At `n = 12, seed = 8` the `speed` pipeline took the bytecode VM's two fixtures from 7,678 / 6,874 RV32 instructions
(r0) to 9,286 / 8,218 — the only program of IRWB-012…IRWB-017 that the optimizer made worse. This ticket finds the
cause from the compiler's own records, makes that kind of attribution a reusable tool, and fixes the pass:

- **cause:** `licm` hoists the opcode arms' frame addresses (`sp + 0`, `sp + 16`) out of the dispatch loop. After
  `cfg` the one loop has nine back edges, so `typed.loops` reports nine natural loops with the same head and `licm`
  builds a preheader for each; those preheaders run on **every** dispatch (172–184 times), the statements they
  replace ran on 12–97 dispatches.
- **fix:** `licm` keeps a hoist only when the loop's head has a single back edge and the definition dominates the
  latch, creates the preheader only when something moves into it, and records every refused hoist as a `skip`.
  `speed` now runs **6,688 / 5,968**, below r0; the corpus totals improve under both O2 (−2.5%) and `speed` (−2.0%);
  parity and the O2 reference check are clean.
- **tool:** `src/typed/attribution.ts` (+ `tools/attribution.mjs`, `tests/typed/attribution.test.mjs`) credits every
  executed instruction to the pass decision that placed it and to the r0 statements it descends from, and credits
  the difference against r0 per decision. Reusable by the next stage's "missed optimizations from provenance".

## Key Links

- Design: [design-doc/01-d1-design-instruction-attribution-through-correspondence-and-a-licm-cost-check.md](./design-doc/01-d1-design-instruction-attribution-through-correspondence-and-a-licm-cost-check.md)
- Report: [reference/01-d1-report-what-makes-speed-slow-on-the-bytecode-vm-the-attribution-tool-and-the-licm-cost-check.md](./reference/01-d1-report-what-makes-speed-slow-on-the-bytecode-vm-the-attribution-tool-and-the-licm-cost-check.md)
- Diary: [log/01-implementation-diary.md](./log/01-implementation-diary.md)
- Scripts (probes 01–07) and their outputs: [scripts/](./scripts/), [scripts/out/](./scripts/out/)

## Status

Current status: **review**. Measured, tested and committed; the two small corpus regressions (`licm-nested` +99,
`lz-roundtrip` `speed` +359) are reported rather than argued away.

## Topics

- compiler
- ir
- performance
- verification

## Tasks

See [tasks.md](./tasks.md).

## Changelog

See [changelog.md](./changelog.md).

## Structure

- design-doc/ - the design (with the "Revision after measuring" section)
- reference/ - the report
- log/ - the implementation diary
- scripts/ - every probe, benchmark and their JSON/text outputs
- playbooks/, various/, archive/, sources/ - unused in this ticket
