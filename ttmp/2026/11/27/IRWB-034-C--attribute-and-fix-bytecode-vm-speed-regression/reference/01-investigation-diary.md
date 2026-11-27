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

## Step 2 — Isolate the regression

`01-revisions.mjs` first failed with ERR_MODULE_NOT_FOUND because its relative imports stopped at `ttmp`; adding one parent fixed the probe. The measured revision sequence and backend label counts are in the preliminary report and `02-licm.json`. A candidate guard preserving `aaddr` reduced the two final counts below r0. A reusable latest-decision attribution prototype and its focused test were added; `npm run build` and `node --test tests/typed/attribution.test.mjs` passed.

A broad test attempt through sandboxed tmux did not start: its socket returned `Operation not permitted`. A test run with escalation and concurrency one was started. The first corpus measurement was interrupted after 12 projects, and the baseline after three; neither is sufficient to establish the required corpus guarantee. Further validation and the before/after full corpus measurements remain necessary.
