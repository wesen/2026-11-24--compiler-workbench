---
Title: Find missed optimizations from hot RV32 code
Ticket: IRWB-037-A
Status: active
Topics:
    - compiler
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:39:51.974812997-05:00
WhatFor: ""
WhenToUse: ""
---

# Find missed optimizations from hot RV32 code

The starting compiler is `2966b9b`, with IRWB-034-G's per-header loops, LICM sharing and coalescer fix. On the historical regex fixture it runs 6,933 instructions with default `speed` lowering, 305 above the reference. With chains, coalescing and homes the same revision runs 5,405. The historical LZ fixture set remains 377 above the reference with those options.

## Inputs and evidence

The investigation uses valid Typed corpus projects with their checked named strategies and concrete calls that finish within the emulator budget. For the historical comparison, use the prior tickets' inputs and backend options. For corpus comparison, give O2, speed and the reference identical seed-7 cases from each declared entry, or every function when no entries are declared. Use ten cases per function as in D1, but honor entry declarations to avoid benchmarking helpers with inputs outside their intended domain. Exclude any cases capped in a compared configuration and identify them. Compare results and guest memory for completed cases.

Start with `attributeSteps` on the regex fixture. D1 counts every executed instruction when calculating deltas, but its rows omit unchanged sites. Expose a ranked final-revision statement view with executed counts, the instruction mix, and the decisions that changed instruction counts along a statement's ancestry. Follow replacement and cloning sources to recover earlier decisions. An uncredited site means the measured history shows no direct reduction there. It does not establish that a specific optimization is legal or that earlier edits had no indirect influence. Preserve the step totals and signed differences.

A PC histogram alone would identify hot loads, branches and arithmetic, but lose the IR expression and whether a pass already changed it. Conversely, scanning the simplifier's rules only identifies existing opportunities. Use the final-revision provenance to prioritize shapes and compare the dynamic opcode mix with the vendored default reference policy on the same call. Try the highest-count repeated shape first, then use LZ to test whether the gain transfers.

## Candidate changes and acceptance

Investigate repeated scaled addresses in regex's queue and state loops, and extra materialization in adjacent comparisons. A local algebraic identity belongs in the existing rule table with evidence produced by `verifyRule`. Check that its actual RV32 tile saves instructions. Equal operand facts across statements belong in a Typed analysis declared as a pass need if the existing reaching definitions, value numbering or dominance cannot already supply them. Apply IR edits through `Tx` and use the checked strategy entry points. An exact instruction-selection improvement belongs in the backend only if the unchanged IR already expresses the best form and the selector misses it.

First try moving or repeating an existing checked pass on the identified shape. This is cheaper than adding a rule or analysis, but it only helps if that pass already represents the needed fact. Use a small replayable experiment before committing to a new pass or rule. Keep a change when measured savings survive in the full pipeline and explain any regressions by project. Changed passes must pass the repository's meaning checks. Measure backend changes against the reference and test their concrete lowering hazards.

No framework change is planned. The edit transactions, analysis declarations and strategy plans already support a local Typed change. A standalone synthesis engine is outside this stage because the next candidate can be selected from measured sites.

## Later

- Cross-project automatic candidate synthesis if manual attribution repeatedly finds the same shape family.
