---
Title: Schedule reuse design
Ticket: IRWB-067
Status: active
Topics:
    - tensor
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T03:39:22.308973362-05:00
WhatFor: ""
WhenToUse: ""
---

# Schedule reuse design

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

The supported input is a valid Tix function and fusion choice, selected from a program artifact. The existing schedule memo keys the complete function and fusion choice; this captures the schedule's actual dependencies, including changes across program revisions, and permits identical functions in different revisions to share work. A revision-only key would require passing program identity through all schedule callers and would miss reuse across equal functions.

On a cache miss, create a registry with the same decisions and passes and collect full pass results via the framework's `onResult` bridge. Cache the initial schedule, final schedule, execution and results together. CUDA lowering composes changed results' correspondences. The simpler shared registry cannot safely attach a per-call collector, and strategy execution records contain summaries rather than full results. The unfused path returns no pass results. Existing corpus tests compare emitted bytes and correspondence pairs; add a focused memo/result test. Later: none.
