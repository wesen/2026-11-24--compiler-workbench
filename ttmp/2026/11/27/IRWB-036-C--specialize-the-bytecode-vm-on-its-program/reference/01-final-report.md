---
Title: Final report
Ticket: IRWB-036-C
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/program.ts
      Note: Assumptions and meaning checks
    - Path: repo://src/typed/specialize.ts
      Note: Existing scalar bindings
    - Path: repo://ttmp/2026/11/27/IRWB-036-C--specialize-the-bytecode-vm-on-its-program/scripts/01-measure-entry.mjs
      Note: Reproducible measurement
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:02.921107959-05:00
WhatFor: ""
WhenToUse: ""
---

# Final report

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Status: incomplete

The constant-buffer binding, binding-time analysis, dispatch specialization and their tests were not implemented. No framework changes were made. The design is a proposal, not a verified implementation, and no automatically bytecode-specialized image exists to measure. The remaining gap cannot be reported as closed. The measurements below are a reproducible negative control using the existing scalar binding, not the requested Futamura projection.

## Measured results

Run `npm run build` and `node ttmp/2026/11/27/IRWB-036-C--specialize-the-bytecode-vm-on-its-program/scripts/01-measure-entry.mjs`. All images use `coalesce: true`; the calls use n=12, seed=8. Code sizes are per-function RV32 bytes. The hand-written functions and general/scalar variants each receive one `speed` pipeline. The original column is r0, matching the brief's baseline. The existing scalar specialization binds entry before `speed`; its generated-case meaning check agreed on 100 cases for each entry.

| Fixture | Original general steps / bytes | General speed steps / bytes | Scalar entry + speed steps / bytes | Hand-written steps / bytes |
| --- | ---: | ---: | ---: | ---: |
| Fibonacci | 7,678 / 840 | 9,286 / 904 | 9,287 / 908 | 75 / 40 |
| Checksum | 6,874 / 840 | 8,218 / 904 | 8,219 / 908 | 74 / 36 |

The scalar variant closes none of the gap relative to either general image in this experiment. These results do not measure constant-buffer specialization. The first attempted comparison accidentally ran `speed` twice on the specialized variant; it produced 15,114 and 13,098 steps and 1,304 bytes, and was discarded as an unequal pipeline comparison. The committed script contains the corrected experiment.

## What remains

The r0 listing (`scripts/02-list-vm.mjs`) shows `load16[caddr(code, t6)+4]` with `t6` copied from the loop-carried `pc`. Binding the initial `entry` alone does not make later `pc` values constant at the loop merge. The VM also writes frame arrays, so rejecting every store as a potential buffer mutation would reject the target program; the analysis needs to distinguish frame addresses from parameter-derived addresses and conservatively handle aliases and calls. This is an analysis of the IR, not a measurement of a working new pass.

A complete implementation still needs buffer assumptions in revision snapshots and generated cases, an effect/alias check, propagation of known addresses and cells, residual CFG states with backedge reuse and a bounded stopping rule, correspondence and meaning-contract tests, and the requested specialized-image measurements. The proposed residual-state approach has not been tested; no claim is made about its performance or the necessary framework changes.
