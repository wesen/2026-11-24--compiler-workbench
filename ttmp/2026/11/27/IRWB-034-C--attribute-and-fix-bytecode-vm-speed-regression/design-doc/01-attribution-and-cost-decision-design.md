---
Title: Attribution and cost decision design
Ticket: IRWB-034-C
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:43.200648636-05:00
WhatFor: ""
WhenToUse: ""
---

# Attribution and cost decision design

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->

## Domain and approach

Study valid Typed corpus projects and their supplied generated inputs, with the bytecode VM's two specified calls as anchors. Use checked revisions and RV32 emulator counts with the same backend options throughout. Attribution will join executed machine instructions to backend IR origins and walk revision correspondence to the decisions that produced those origins. Preserve an explicit uncredited bucket where the records cannot support a decision; do not interpret attribution as a counterfactual causal proof. Compare per-revision counts and, where needed, suppress a candidate decision and remeasure to establish its effect.

The simplest alternative is comparing pass totals alone. It identifies a revision but cannot identify its rules or follow later rewrites, so retain per-origin counts as a reusable callable API with a focused test. The decision fix will use the smallest general guard supported by the measured cause; a project-name exception would not generalize. Measure O2 and speed on the corpus before and after, check parity, and run the specified suites and browser build if framework code changes. Record the measurements and limitations in the report. No tensor or corpus program changes are planned.

## Later

- General predictive optimization cost models beyond the measured decision.
