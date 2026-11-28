---
Title: 'Derivations: a step''s rule, site and premises, and correspondence from the steps'
Ticket: IRWB-056-B
Status: active
Topics:
    - framework
    - derivation
    - correspondence
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "A derivation records why each edit happened (rule or decision, site, premises, relation); the correspondence is computed from the steps and equals the one the domains computed before; 183 O2 edit records cite a rule, and the two classification policies answer 203 and 393 over the same records."
LastUpdated: 2026-11-27T23:53:06.055037453-05:00
WhatFor: ""
WhenToUse: ""
---

# Derivations: a step's rule, site and premises, and correspondence from the steps

## Overview

`src/framework/ir/derivation.ts` holds the record: a step names the verified rule (with its table) or the pass-local
decision that licensed a rewrite, the entities it consumed and produced, the premises it relied on, and how the two
sides relate. Typed's transaction writes one per entity it makes, per removal and per rule firing; Tix `inline` records
which statement it merged into which. The runner computes a pass's correspondence **from the steps** (under F35's
coverage vocabulary) instead of from the origins the transaction left behind, and the two are entry-for-entry equal on
every corpus revision.

The report is [reference/02-report-derivations.md](./reference/02-report-derivations.md); the diary is
[reference/01-diary.md](./reference/01-diary.md). The probes are in `scripts/`: 01 (the base tree's numbers and the shape
of today's correspondence), 02 (equality, rule citations, both policies on the corpus), 03 (the cost inside this build),
04 (the base commit built beside this build).

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- framework
- derivation
- correspondence

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
