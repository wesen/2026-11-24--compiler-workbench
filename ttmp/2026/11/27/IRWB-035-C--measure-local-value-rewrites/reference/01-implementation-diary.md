---
Title: Implementation diary
Ticket: IRWB-035-C
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:08.186298151-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: Design and initial implementation

The requested edit census is in progress. The design was committed as `9adde9e`. A probe on Blend confirmed the normal checked pipeline supplies edit records and correspondence. A second probe confirmed that RV32 image instructions list covered Typed values and statements. An initial classifier and census runner are present but have not completed corpus validation.

`npm ci` first failed because esbuild's version probe could not spawn under the sandbox (EPERM); an escalated retry installed the locked dependencies. `npm run build` completed. `node --test tests/typed/edit-census.test.mjs` passed before the final classifier adjustment. The requested broad test command was interrupted after it started many tests concurrently and heavily loaded the shared machine; its interrupted tests must not be treated as failures or passes. A bounded-concurrency rerun and the corpus census were started in tmux. Check their logs and completion before using their results. The census initially imported an earlier classifier version; rerun it after the last adjustment before reporting results.

The current classifier's attribution counts static instructions whose `covers` identify a referenced statement or block in either adjacent image. Attribution can overlap and does not measure runtime heat or prove causation. Its treatment of structural compound edits, the correspondence use, and rule-matching soundness need review before the results can answer the ticket.

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
