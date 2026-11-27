---
Title: 'Missed optimizations, found from provenance'
Ticket: IRWB-037-D
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/passes.ts
      Note: bce now compares linear forms over named values, not local numbers
    - Path: repo://src/typed/linear.ts
      Note: linear forms over named values, exact modulo 2^32 (new)
    - Path: repo://src/typed/analyses.ts
      Note: the ranges transfer maps bottom to bottom (monotonicity fix)
    - Path: repo://tests/typed/bce-offset.test.mjs
      Note: which check goes, which stays, and the form arithmetic (new)
ExternalSources: []
Summary: "From executed instructions to the statements no pass improved, to the shapes that explain the gap to the reference compiler, to a bce that reads affine indices."
LastUpdated: 2026-11-27T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Missed optimizations, found from provenance

## Overview

D2 of the speed work: connect the attribution built in D1 to the code that no pass improves, find the shapes
behind the remaining gap to the reference compiler, and add what pays.

- **The method** (design/01): baseline re-measurement; hot sites with provenance (which statements no pass's
  edit record names); the gap per RV32 opcode; hot shapes no rule matches, grouped corpus-wide.
- **The shapes**: affine bounds checks (`bounds-offset` names its own miss), and the `j` that the block layout
  forces (326 of the regex gap). The layout fix was probed and dropped — it costs more than it wins once the
  allocator is involved — and the numbers are in the report.
- **The change**: `bce` compares linear forms over the values the reaching definitions name, so a check on
  `i + 1` goes when the loop test proved `i + 1 < length`; `ranges` no longer turns a bottom environment into
  "anything", which is what had hidden every loop counter's bound in that function shape.
- **The gain**: `bounds-offset` 1,355 → 1,215 under `speed` (−10.3 %), `bounds-lab` 5,012 → 4,788 (−4.5 %);
  corpus `speed` 867,770 → 867,406, `O2` 1,090,271 → 1,089,907. Regex, LZ and chess are unchanged; the
  reference comparison stands at `speed` 867,406 against 875,417.
- **The negative results**: no rule was added (every hot unedited shape is a load, a call, control flow, or
  arithmetic with nothing to fold — 40.9 % of executed instructions sit in such statements), and the block
  reordering was measured and rejected.

## Key Links

- **Design:** [design/01-design-missed-optimizations-from-provenance.md](./design/01-design-missed-optimizations-from-provenance.md)
- **Diary:** [reference/01-implementation-diary.md](./reference/01-implementation-diary.md)
- **Report:** [reference/02-report-missed-optimizations-from-provenance.md](./reference/02-report-missed-optimizations-from-provenance.md)
- **Scripts:** `scripts/01`–`06` (baseline, hot sites, op histogram, reorder probe, corpus against the
  reference, hot shapes); measurements in `various/`
- **Related Files**: see the frontmatter

## Status

Current status: **active**

## Topics

- typed
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
