---
Title: 'Rules over a term signature: stdlib/term, Typed''s tables and verifier on it, Tix inline and split-sum as rules, F40'
Ticket: IRWB-060-B
Status: active
Topics:
    - framework
    - compiler
    - stdlib
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "src/stdlib/term and its two domain ports (Typed rule tables and verifier, Tix inline and split-sum), F40, and the measurement that keeps the Typed port (-0.28 % of O2 compile time)."
LastUpdated: 2026-11-28T01:56:56.283983221-05:00
WhatFor: ""
WhenToUse: ""
---

# Rules over a term signature: stdlib/term, Typed's tables and verifier on it, Tix inline and split-sum as rules, F40

## Overview

`src/stdlib/term/` holds the domain-independent part of rewriting: a term signature, structural equality and hash,
patterns and templates with `match` and `instantiate`, a first-match rule index, and `verifyRule` — Alive-style
validation of a rule on generated cases with a counterexample. Typed's rule tables, its edit re-derivation and two of
its verifier methods run on it; Tix's `inline` and `split-sum` are rules over its expression signature. F40 is fixed:
`inline`'s correspondence says `merged` for the statement it substituted. The decision point measured the library path
against the pre-change matcher on the O2 corpus: −0.28 % of O2 compile time, so the Typed port stays.

Start with `reference/02-report.md`; the design is in `design/01-design-note-rules-over-a-term-signature.md`; the
chronology, including the two things that did not go to plan, is in `reference/01-diary.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- framework
- compiler
- stdlib

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
