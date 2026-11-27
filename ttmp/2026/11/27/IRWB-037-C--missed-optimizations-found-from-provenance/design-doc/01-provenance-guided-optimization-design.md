---
Title: Provenance guided optimization design
Ticket: IRWB-037-C
Status: active
Topics:
    - typed
    - optimization
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:39:13.761485742-05:00
WhatFor: ""
WhenToUse: ""
---

# Provenance guided optimization design

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

## Scope and method

Inputs are the existing finite Typed corpus projects and their configured generated calls. Measure the checked O2 and speed pipelines and reference compiler on identical calls, with emulator instruction counts. Start with regex, inspect attribution rows and generated code, and test concrete opportunities against the same inputs. Use existing IR rewrite patterns, transaction correspondence and checked passes; verify each added algebraic rule using the rule verifier. Retain changes only when measurements show a useful gain without unacceptable corpus regressions.

The simplest alternative is to add familiar algebraic identities without profiling; it cannot establish that a rule fires or pays. Attribution identifies hot unchanged sites; comparing the reference instruction stream provides a second source of candidates when provenance alone does not reveal the missing transformation. Attribution is per pass and site, so it does not by itself prove causation. Measure candidates individually and report failed experiments as well as results.

The existing corpus measurement script uses ten generated cases per function, seed 7, and a 200,000-step cap. Reuse those settings to compare with D1, explicitly report limited cases, and separately reproduce the named reference examples where possible. The cap is inherited from the existing measurement, not a claim about programs beyond it. Run the requested test directories and build before the final commit. Framework extensions are warranted only if the investigation identifies a missing reusable capability; otherwise leave the framework unchanged.

## Deliverables and limits

Record baseline and final per-project counts, verification and measured changes in the report, and keep reproducible scripts in this ticket. The alternative of guessing an optimization now would preselect a solution before inspecting evidence. Implementation details depend on the measured shape; this design commits to the investigation and acceptance method rather than an unsupported rule. Later: broader workloads and general optimization discovery beyond the measured corpus.
