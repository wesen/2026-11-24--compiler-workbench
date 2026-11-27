---
Title: 'F27: Tix passes keep their meaning gate inside strategy plans'
Ticket: IRWB-041-C
Status: active
Topics:
    - tensor
    - contracts
    - strategy
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T17:28:10.826901558-05:00
WhatFor: ""
WhenToUse: ""
---

# F27: Tix passes keep their meaning gate inside strategy plans

## Overview

F27 of the IRWB-039 framework refactor: a Tix pass's meaning gate now survives a strategy plan. Each Tix pass
declares the relation its output has to its program's meaning (`inline` exact, `split-sum` within tolerance);
`meaningGateContract` turns the gate into an `ensures` contract; `tixAlgorithm(pass, { origin })` exports the pass as
a strategy algorithm that carries it. `optimizeTix` uses the declared relation and stays synchronous.

- Diary: `diary/01-diary-f27-tix-meaning-gate-in-strategy-plans.md`
- Report: `reference/01-report-f27-tix-meaning-gate-in-strategy-plans.md`
- Probe: `scripts/01-probe-tix-gate-in-plans.mjs`

Result: the F27 test passes without its `todo`, the IRWB-039 baselines check prints `no differences`, and the
failed suites hold only other steps' `todo` tests.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- tensor
- contracts
- strategy

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
