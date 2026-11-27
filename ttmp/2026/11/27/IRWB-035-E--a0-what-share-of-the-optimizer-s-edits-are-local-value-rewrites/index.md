---
Title: 'A0: what share of the optimizer''s edits are local value rewrites?'
Ticket: IRWB-035-E
Status: active
Topics:
    - compiler
    - ir
    - measurement
DocType: index
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/edit-class.ts
      Note: the edit classifier tool (classifyApplication, rederive) and its re-derivation matcher
    - Path: repo://tests/typed/edit-class.test.mjs
      Note: the classifier's test
    - Path: repo://ttmp/2026/11/27/IRWB-035-E--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/design-doc/01-design-edit-classification.md
      Note: the classification design: the classes, the borderline decisions, the two weightings
    - Path: repo://ttmp/2026/11/27/IRWB-035-E--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/design-doc/02-final-report-a0-edit-shares.md
      Note: the final report: the shares per pass, pipeline and project, the rule coverage, meaning and limits
    - Path: repo://ttmp/2026/11/27/IRWB-035-E--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/various/03-tables.txt
      Note: every table the report cites, in full
ExternalSources: []
Summary: "Every edit of the O2 and speed pipelines on the 50-project corpus, classified local/structural/other with a reproducible decision procedure over the framework's edit records. O2: local 19.5% of edits but 48.1% of the instructions affected; speed: 10.2% / 26.5%. Of the local rewrites, 46.3% / 36.3% already re-derive from the verified rule tables; three fact-backed rule shapes (constprop's reaching-constant, subst's single-use copy, strength's non-negative range) would cover all the rest. The classifier is a tool (src/typed/edit-class.ts) with a test, so later stages can rerun it."
LastUpdated: 2026-11-27T12:25:00-05:00
WhatFor: "Programme A needed its premise measured: whether the optimizer's value edits are local rewrites that per-rule proofs could cover."
WhenToUse: "Before implementing IRWB-008's exact-checking phases, before adding passes whose edits must be classified, or when re-running the census."
---

# A0: what share of the optimizer's edits are local value rewrites?

## Overview

Research programme A's hypothesis is that a function's equivalence could be assembled from per-rule proofs if
most of the optimizer's value edits are local rewrites. This ticket measured it, once, over every edit record of
the `O2` and `speed` pipelines on the whole corpus, and left the classifier behind as a tool:

- **The classifier** (`src/typed/edit-class.ts`, tested by `tests/typed/edit-class.test.mjs`): a pure function
  of one pass application (pass name, edit records, the two revisions). `local` = a value replaced by an equal
  one (motion test excludes licm/lvn/inline bookkeeping), `structural` = control flow, motion, inlining,
  rotation, `other` = dead statement removal; rule-backed local rewrites are re-derived from the verified
  tables with an independent matcher.
- **The design** (`design-doc/01`): the definitions, the borderline decisions (lvn's chained replaces, licm's
  hoist-of-a-hoist and pruned blocks, dce/subst removals as `other`), and the instruction weighting
  (owned + dropped image instructions per edit, via the backend's per-instruction `covers`).
- **The census** (`scripts/01`–`03`, outputs in `various/`): O2 = 2,021 edits — local 19.5 %, structural 72.1 %,
  other 8.4 % (by instruction weight: 48.1 / 48.5 / 3.4); `speed` = 9,736 edits — 10.2 / 84.1 / 5.6
  (26.5 / 70.4 / 3.1 by weight). Local rewrites are 78 % / 88 % of value edits. Verified rules cover 46.3 % /
  36.3 % of the local rewrites; three fact-backed rule shapes cover the rest.

## Key Links

- **Design:** [design-doc/01](./design-doc/01-design-edit-classification.md)
- **Final report:** [design-doc/02](./design-doc/02-final-report-a0-edit-shares.md)
- **Diary:** [log/01-implementation-diary.md](./log/01-implementation-diary.md)
- **Tables:** `various/03-tables.txt`; the census JSON per project in `various/02-*.json`
- **Scripts:** `scripts/01-edit-kinds-probe.mjs`, `scripts/02-classify-corpus.mjs`, `scripts/03-tables.mjs`
- **Related Files**: See frontmatter RelatedFiles field

## Status

Current status: **active**

## Topics

- compiler
- ir
- measurement

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Operational playbooks and procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
