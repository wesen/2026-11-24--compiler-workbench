---
Title: Investigation diary
Ticket: IRWB-034-C
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:43.467023067-05:00
WhatFor: ""
WhenToUse: ""
---

# Investigation diary

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

## Step 1 — Establish the investigation

The user requested IRWB-034-C: find the bytecode VM speed regression using correspondence and executed instructions; implement reusable attribution and a compiler fix; measure O2 and speed across the corpus; write and commit the design first, then report and validate. The full request is the session's user prompt.

Read the prescribed framework and Typed files, the IRWB-012 design and implementation diary, and created this ticket with docmgr. The design deliberately separates provenance credit from counterfactual pass measurements: origin records alone do not establish savings or costs.
