---
Title: Deriving streaming attention by checked rewrites (FlashAttention from plain Tix)
Ticket: IRWB-021-S
Status: active
Topics:
    - tix
    - cuda
    - compiler
    - ir
    - verification
    - research
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Research design (no implementation): a seven-rule library (inline, factor-const, split-index, nest-max, exp-shift, nest-sum, fold-intro) deriving FlashAttention's streaming form from the plain Tix attention program in thirteen checked applications; the fold construct Tix needs (a reduction over a user-supplied associative combine on a tuple state) with reals and f32 semantics; per-rule checking (recorded exact argument, exact or tolerance differential gate against the f64 reference, measured f32 error sources, calibrated epsilon, negative controls); generality (softmax, log-sum-exp, one-pass layernorm statistics reached; masked attention, factored exp, cross-frame normalizers not, with reasons); and a falsifiable GB10 experiment (derived kernel vs unfused lowering vs hand-written streaming kernel; GPU time and DRAM bytes)."
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: "Answers the IRWB-021-S research question: can a compiler derive streaming attention by checked rewrites with local, mechanical correctness arguments."
WhenToUse: "Before implementing the Tix fold construct, the rule library, the combine verifier, or the GB10 measurement campaign."
---

# Deriving streaming attention by checked rewrites (FlashAttention from plain Tix)

## Overview

A research design, no implementation: whether a compiler can derive FlashAttention's streaming
form from the plain Tix attention program as a sequence of rewrites, each checked, each with a
local and mechanical correctness argument.

- **Design document:** `design-doc/01-research-design-deriving-streaming-attention-by-checked-rewrites.md`
  — the seven rules with side conditions and exact arguments over the reals; the thirteen-step
  derivation P0→P8 with complete programs; the `fold` construct and its f32 meaning; the checking
  design (exact/tolerance gates per rule, ε calibrated from P0's measured error, once-per-combine
  monoid verification, negative controls); generality and its boundaries; the falsifiable GB10
  experiment with refutation conditions; design decisions with alternatives; Later.
- **Probe (measured, this ticket):** `scripts/01-numeric-probe.mjs` →
  `various/01-probe-results.txt` — host f32/f64 simulation of the derivation over 80
  configurations: split-index bit-identical in all rows; the streaming form within 2.87× of P0's
  own f32 error (mixed metric); broken-combine control rejected 10²–10⁴×; min/mean-shift controls
  leave the finite domain exactly where the max-shift form stays finite.
- **Diary:** `log/01-research-diary.md`.


## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tix
- cuda
- compiler
- ir
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
