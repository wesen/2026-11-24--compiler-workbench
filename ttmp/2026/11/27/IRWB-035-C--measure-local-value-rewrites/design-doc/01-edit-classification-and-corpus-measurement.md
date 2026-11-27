---
Title: Edit classification and corpus measurement
Ticket: IRWB-035-C
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:07.948558592-05:00
WhatFor: ""
WhenToUse: ""
---

# Edit classification and corpus measurement

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

# Design

The supported input is the edit reports and correspondence of successful applications of the named O2 and speed pipelines to every project in `corpus/projects`. An edit is the unit recorded by `Tx`, not a rule firing. A replace can encompass several firings. The classifier will consume the input/output revisions, report and correspondence, and return a class, reason, rule evidence and affected instruction proxy for each edit.

A local rewrite changes one statement value field through equal expression substitution; fold and simplify are matched against their rule tables, while constant propagation and strength reduction need facts beyond the expression. Structural edits change CFG, relocate computations, inline, rotate, or manipulate statements/locals to support those operations. Other includes dead-code deletion and any edit whose semantics cannot be classified from these records. In particular a value replacement in an explicitly structural pass stays structural, and substitution of a local definition requires a dataflow premise rather than an unconditional local identity. Classification does not itself prove equivalence.

Use the old and new expression tree sizes as an instruction-affect proxy for replace edits; for structural edits resolve referenced statements through correspondence and count their value trees and statement operators, reporting unmatched references separately. This is a static IR count, not dynamic RV32 instructions. An alternative is attributing backend machine instructions via provenance, but allocation and selection interact and make independent per-edit attribution ambiguous. Report the proxy and its limits explicitly.

For verified coverage distinguish actual citations from matched rule evidence: current edit records omit rule names. Re-derive fold/simplify by the prior IRWB-008 bottom-up matcher, checking recorded evidence fingerprints; do not label a pass name alone a proof. Rank residual shapes by observed occurrences. Tests exercise boundary cases, multiple rules in a field and unmatched records. A corpus runner records every successful edit and aggregates both dimensions per project, pipeline and pass. The existing gate is used so rejected outputs do not appear as published edits.

The simplest alternative, counting entire pass names as local, loses mixed structural/value edits and overstates rule coverage. Counting changed correspondence entities instead of edits would double count derived tree nodes; correspondence serves attribution and coverage checks, while edits are the denominator. No framework change is anticipated. Later: an exact acceptance checker and dynamic machine-instruction attribution; neither is built here.
