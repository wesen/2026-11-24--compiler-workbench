---
Title: Implementation diary
Ticket: IRWB-035-A
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:12.893474688-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Freeze the measurement design

The first decision was to use the edit log as the unit of work and the two adjacent revisions as the unit
of context. IRWB-008 shows that one recorded field change can contain several table rule firings and that
the current tables do not emit explicit rule tokens.

### Prompt context

IRWB-035-A asks for a reproducible O2/speed census of local, structural and other edits, the number of
instructions they affect, and verified-rule coverage. The design must be committed before implementation.

### What I did and why

Read the pass contracts, Typed transaction and strategy paths, and relevant IRWB-006, IRWB-008 and IRWB-010
sections. Created the ticket and compared log-based counting with entity diffs. Selected static Typed
statements because the edit log and correspondence can relate them to individual edits. Scheduled a
contextual-rewrite sensitivity analysis so the boundary around dataflow dependencies is measurable.

### Evidence and review

`npm run build` passed on Node v24.18.0. Review the design's class table and denominators first, especially
the handling of support operations for LVN and substitution.
