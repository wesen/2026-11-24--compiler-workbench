---
Title: 'Rules over a term signature: stdlib/term, Typed and Tix on it, and F40'
Ticket: IRWB-060-A
Status: active
Topics:
    - stdlib
    - typed
    - tensor
    - framework
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/stdlib/term/terms.ts
      Note: The term library — signature, match, firstMatch, instantiate, structural hash and equality
    - Path: src/stdlib/term/verify.ts
      Note: The verification interface — campaigns over a domain-supplied case semantics, and verifyRule
    - Path: src/typed/rules/compile.ts
      Note: Typed's matcher, table compiler and instantiation, now adapters over the library
    - Path: src/typed/rules/verify.ts
      Note: Typed's rule verifier; its evaluation campaigns run in the library
    - Path: src/tensor/passes.ts
      Note: Tix's inline and split-sum as rules over the expression signature
    - Path: src/framework/ir/derivation.ts
      Note: F40's one-branch change (stepEntries), a documented scope exception
ExternalSources: []
Summary: "The standard library gains terms over a signature (matching, instantiation, structural hash and equality, a rule index and first match, and rule validation by evaluation on generated cases); Typed's rule tables and verifier and Tix's two passes run on it; F40 makes inline's correspondence say merged. The decision point measured the library rule path against today's compiled matcher: not materially slower (about 3-5 percent of O2 compile time, under the 10 percent threshold), so the library path stays."
LastUpdated: 2026-11-28T06:20:00-05:00
WhatFor: "The report and review of phase 4, item 4.6 (and F40) of the v7 refactor."
WhenToUse: "Reviewing IRWB-060-A, or building on the term library."
---

# Rules over a term signature: stdlib/term, Typed and Tix on it, and F40

## Overview

Phase 4, item 4.6 of the v7 refactor (IRWB-039), plus backlog F40. The library row `terms` of the R3
synthesis becomes `src/stdlib/term/`: first-order rewriting over a signature (pattern matching,
template instantiation, a rule index and first match, structural hash and equality) and rule
validation by evaluation on generated cases (Alive-style: a domain-supplied interpretation and case
generator, library-owned campaigns). Typed's three rule tables match, instantiate and verify through
it with its own semantics; Tix's `inline` and `split-sum` become rules over the expression signature
through the same library. F40: a `merged` derivation step now maps the statement it consumed to the
one that absorbed it in the correspondence (`merged`, not `removed`), which required one branch in
the framework's `stepEntries` — a documented exception to this lane's file scope, flagged for the
coordinator (F41's lane owns that file's coverage parts).

The decision point (the brief fixes the threshold at about 10% of O2 corpus compile time): the library
rule path measured against today's compiled matcher, interleaved in one process, came out at
+3.4% / +5.2% / +2.7% of whole-pipeline time over three runs — around the measurement's own
run-to-run spread, so the library path stays and the numbers are reported in
[reference/02-report](./reference/02-report-terms-f40.md).

## Where things are

- `design-doc/01-design-note.md` — the design, written before the code.
- `reference/01-diary.md` — the working diary, one step per significant action.
- `reference/02-report-terms-f40.md` — the final report (what changed, why, the acceptance results).
- `scripts/` — the probes, numbered, with their outputs.

## Status

Current status: **done** — acceptance green on the last commit (see the report).

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.
