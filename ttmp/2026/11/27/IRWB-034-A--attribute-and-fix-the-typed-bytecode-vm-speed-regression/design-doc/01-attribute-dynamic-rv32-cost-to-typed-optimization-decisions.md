---
Title: Attribute dynamic RV32 cost to Typed optimization decisions
Ticket: IRWB-034-A
Status: active
Topics: []
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/backend/image.ts
      Note: Maps instruction words to Typed entities
    - Path: repo://src/typed/backend/run.ts
      Note: Provides emulator per-word instruction counts
    - Path: repo://src/typed/passes.ts
      Note: Builds pass correspondence and defines the pipeline
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:59.406298696-05:00
WhatFor: ""
WhenToUse: ""
---

# Attribute dynamic RV32 cost to Typed optimization decisions

## Question and supported inputs

Explain the RV32 instruction increase at the two bytecode VM entries at
n = 12 and seed = 8. The tool accepts successful or explicit-trap RV32
runs with per-word counts, lowered Typed images, and the ordered, exact
Typed revision chain used to produce those images. Compare the same entry,
arguments, memory and backend options across revisions. A run without
instruction counts is detected when attribution starts and reports that
a counted run is required.

## Measure the accepted decisions

Lower and run every published revision. The difference between successive
instruction totals measures the effect of accepting that pass at that
point, including register allocation and layout. It telescopes to the
measured change from r0. A head-only image diff would be simpler but would
mix effects of unrelated passes and would count displaced instructions
as edits.

Join the per-word counts with image correspondence. Walk backward through
pass correspondence using a reverse index for each revision. Record the
changed entities and their rule evidence, then continue through retained
or cloned ancestors. Keep one row per executed instruction and its full
lineage so later analyses can use the same counts. Aggregate a word's
count once under its latest set of recorded decisions, with buckets for
original and uncovered instructions. A shared instruction with multiple
possible owners keeps them together. This lineage describes surviving
instructions, so it cannot count savings from deleted work. The adjacent
measurements cover deletions and backend effects.

Remove the measured costly decision and rerun the remaining passes as a
counterfactual. Comparing just the adjacent revisions cannot show whether
a later pass would have paid back the initial cost. Where the records show
indirect backend effects, compare the relevant emitted instruction classes
and compare identical IR under backend option changes.

## Fix and qualification

Try the smallest general guard at the decision shown to cost instructions.
For an identifiable IR shape, prefer a local guard to measuring competing
whole pipelines on every compilation. If the shape is insufficient,
evaluate the existing strategy metric as a selection mechanism. Qualify
against both fixed VM inputs and the generated corpus cases, using the
project entry roots and existing corpus case generators. Measure O2 and
speed before and after, and check both compiler and reference parity.
The regression test will cover conservation of execution counts and
traceability through multiple passes.

The backend and correspondence APIs already supply the inputs. No new
framework IR or pass mechanism is planned.

## Later

- Use the lineage to locate missed optimizations.
- Model the dynamic effects of decisions on inputs outside the measured cases.
