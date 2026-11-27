---
Title: Implementation diary
Ticket: IRWB-037-C
Status: active
Topics:
    - typed
    - optimization
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:39:14.283668191-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

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

## 1. Establish investigation

The user requested IRWB-037-C: provenance-guided missed optimization research and implementation, a design committed first, checked changes, corpus and reference measurements, and a final report. The complete request is in the session transcript.

Read the framework contract and IR documentation, pass and strategy definitions, and D1's report and measurement scripts. D1 reports that attribution joins statements across revisions, and that its corpus uses ten generated cases per function. Its regex speed total after the fix is 35,638 default or 28,128 tuned, on those generated cases; this is distinct from the named reference fixture. The design chooses to inspect measured hot sites before selecting a change.
