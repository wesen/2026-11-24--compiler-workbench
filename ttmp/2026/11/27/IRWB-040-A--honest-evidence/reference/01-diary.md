---
Title: Diary
Ticket: IRWB-040-A
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:27:44.246964238-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Investigation and implementation

The requested change: “Make a recorded check's assurance say how it was checked: a sampled differential is distinguishable from an exhaustive or otherwise exact check, and missing or unknown evidence is never exact. Keep the change as small as the test and the existing callers need.” The acceptance asks for F34, unchanged corpus baselines, the non-GPU suites, TypeScript and site builds.

Invariant checks used a fixed `checked` value; `assuranceOf` classified every non-sampled method as exact. Kept `checked` for unknown evidence, added distinct sampled and exact values to the existing union, and recognized only the explicit `sampled`, `exhaustive`, and `exact` methods. Other analysis and property checks keep their existing assurances.

`npm run build` and the focused F34 test passed. Validation of the corpus and suites follows below. A formatting probe found pre-existing formatting concerns under investigation; no broad formatting was applied.
