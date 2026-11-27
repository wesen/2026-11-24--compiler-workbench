---
Title: Counting local rewrites
Ticket: IRWB-035-B
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
LastUpdated: 2026-11-27T09:44:38.08504786-05:00
WhatFor: ""
WhenToUse: ""
---

# Counting local rewrites

Measure the checked, published revision chains of the two built-in presets over every directory returned by projectIds(). A classifier accepts the two adjacent Typed blocks artifacts, the recorded edits and their revision correspondence. One observation is one array element, identified by project, preset, revision and ordinal. A replacement of a statement field can hide several rewrites. Counting changed entities instead would count rebuilt parents and implicitly removed children as independent optimizer decisions.

## Decisions

* **Local** requires the replacement of a value within a statement field that can be derived by rewriting expressions bottom-up. For fold and simplify, replay the existing rule table on the before-tree and require exact ordered tree equality (operator, type, immediate and children) with the after-tree. Record all firings. For strength reduction, also accept the two guarded arithmetic shapes on positive powers of two when the recorded range justifies the guard. Keep these visible separately since a proof would need the range fact. A pass-name lookup alone cannot detect an unmatched result.
* **Structural** covers edits implementing CFG changes, motion between blocks, loop transforms and inlining, including their helper local declarations, insertions and replacements. Classify these by the documented purpose of the emitting pass. They need a proof over more than the replacement site. Neither preset contains a register-allocation or unrolling pass that emits Typed edits.
* **Other** covers everything else, with a reason. Deleting a dead assignment has no replacement expression. Substitution, common subexpression reuse and constant propagation change the binding from which a read obtains its value. Calling these local would require an extra reaching-definition, stability or liveness premise. Count those replacement records separately for a sensitivity measurement. Unrecognized edits stay visible.
* Distinguish an explicit citation in recorded provenance naming a verified rule from a rule recovered by replay and from a proposed shape. Free-text statements of an identity can convey intent without uniquely identifying a rule. Report the strongest opportunities by number of local records covered, accounting for multiple firings per record. Reuse the production matcher for this census. An independent acceptance checker would be a different deliverable.
* Weight affected RV32 instructions using the backend's covers and both endpoint images. Identify edited statements from the edit fields, constituent statements for block operations and linked endpoints through correspondence. Sum per-word executions over the same origin-generated inputs on each side. Count a word once per side per revision and divide overlapping credit equally across the distinct classes that touch it. Compare this with counting words once irrespective of executions. This measures statement footprint including unchanged words in a touched statement. Whole-program instruction deltas cannot assign costs to mixed revisions. The experiment uses the strategy metrics defaults (10 cases per function, seed 7, default backend and emulator limit). Report missing profiles. Do not count an unprofiled execution as observed.
* Report totals and denominators for each pass, preset and project, plus rule coverage. Preserve machine-readable evidence linking class and rule decisions back to revision edits. The checked runner supplies the published history, so rejected plans must be disclosed separately.

Probe 01 succeeded on algebra/O2 under Node 24.18.0. The first simplify edit rewrote a value field, the revision had 59 correspondence entries, and the sample RV32 run returned counts and six steps. The first selected word covered a value and its statement. The existing APIs suffice for the census.

## Later

* A validator for complete functions would also check the function skeleton, evidence strengths, guards and all changed fields before discharging a meaning check.
* Independent dynamic performance attribution to individual edits would require counterfactual compilations. This census measures directly attributed instructions.
