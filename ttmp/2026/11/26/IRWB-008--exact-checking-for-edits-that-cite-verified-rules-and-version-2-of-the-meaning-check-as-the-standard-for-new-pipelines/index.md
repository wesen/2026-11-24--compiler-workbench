---
Title: Exact checking for edits that cite verified rules, and version 2 of the meaning check as the standard for new pipelines
Ticket: IRWB-008
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Accept edits made by verified rewrite rules exactly, by re-deriving them from the rule data, and sample only the residual with version 2 of the meaning check, in new pipelines alongside the frozen O2. Guide round done (analysis and design); implementation not started."
LastUpdated: 2026-11-26T12:00:00-05:00
WhatFor: "Making the gate exact where IRWB-006's rule evidence allows it, and stronger (version 2) where it must sample."
WhenToUse: "Before implementing exact checking, contract version 3, rule-citing pass variants, or choosing a new pipeline's contract."
---

# Exact checking for edits that cite verified rules, and version 2 of the meaning check as the standard for new pipelines

## Overview

The meaning check accepts every pass by sampling, and IRWB-005 measured its misses (default gate 95.5 % kill rate on the corpus, version 2 99.5 %). IRWB-006 gave every `simplify` and `fold` rule recorded evidence. This ticket designs exact acceptance of rule-backed edits. An edit validator re-derives each changed expression from its before-tree and the rule tables; derived functions count as unchanged for the memo, through semantic part keys; the residual is sampled with version 2; strengths are recorded per step; rule-citing pass variants carry provenance; and a version 3 contract is used by new pipelines only, with O2 frozen.

**Status:** guide round done (this round implements nothing). The measurements made for the guide: every `simplify`/`fold` edit re-derives from the rule data alone (corpus 394 of 394, Candela O2 838 of 838), in 22 ms on Candela against 6.2 s of sampled checks for the same applications.

## Key Links

- **Guide:** [design-doc/01-intern-guide-…](./design-doc/01-intern-guide-exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-for-new-pipelines.md), uploaded to reMarkable under `/ai/2026/11/26/IRWB-008`
- **Diary:** [log/01-exact-checking-diary.md](./log/01-exact-checking-diary.md)
- **Measurements:** `scripts/01`–`04`, outputs in `various/`
- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active**

## Topics

- compiler
- ir
- verification

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
