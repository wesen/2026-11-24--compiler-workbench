---
Title: 'F33: publish a pass''s result only after it is accepted'
Ticket: IRWB-045-C
Status: complete
Topics:
    - framework
    - verification
    - refactor
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/framework/ir/README.md
      Note: naming store.publish next to the head protocol
    - Path: src/framework/ir/store.ts
      Note: IRStore.publish is the boundary's single publication point
    - Path: src/framework/passes/define-pass.ts
      Note: prepareNative prepares privately; applyPass verifies deferred and publishes once
    - Path: tests/framework/r3-defects.test.mjs
      Note: the two F33 tests, todo removed
ExternalSources: []
Summary: 'F33: a pass result is published only after it is accepted — a private candidate, a deferred contract, and one atomic store publication carrying the manager''s evidence.'
LastUpdated: 2026-11-27T18:35:42.367050548-05:00
WhatFor: ""
WhenToUse: ""
---

# F33: publish a pass's result only after it is accepted

## Overview

R3 probe 03 found that accepting a pass application was not atomic: a candidate a contract rejects stayed the head
of the caller's `IRStore` (`prepareNative` opened it with that store, and `openIR` retains), and the manager
recorded an accepted execution and its facts before the preservation checks, which could still reject.

This step gives a pass application one acceptance boundary:

- `prepareNative` opens the candidate on a private store, so preparing publishes nothing;
- `applyPass` runs the contract with `deferCommit`, then the preservation claims, and rolls the deferred evidence
  back on any rejection;
- at the boundary, `IRStore.publish(next, {base?, generation?, acceptance?})` makes the revision the head and
  commits the manager's prepared transformation inside the same atomic publication, or publishes nothing.

Report: `reference/02-report-f33-publication-only-after-acceptance.md`. Diary:
`reference/01-implementation-diary.md`. Design: `design-doc/01-publish-a-pass-result-only-after-it-is-accepted.md`.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- framework
- verification
- refactor

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
