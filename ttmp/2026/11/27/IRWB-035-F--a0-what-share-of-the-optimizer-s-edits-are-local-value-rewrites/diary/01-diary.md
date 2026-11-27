---
Title: Diary
Ticket: IRWB-035-F
Status: active
Topics:
    - compiler
    - rewrite-rules
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:08:36.713535285-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: reading, ticket, design

The task came from the coordinator as a prompt file (`IRWB-019/.../prompts/typed/a0/claude/IRWB-035-F.md`, not in this worktree); its request, summarized: classify every edit the O2 and `speed` pipelines make on the corpus as local rewrite, structural or other, measure the shares per pass, pipeline and project by edit count and by affected instructions, measure how many local rewrites cite or match a verified rule and which rules would cover the rest, and leave the classifier as a tool with a test.

Read the contracts and IR READMEs, `define-pass.ts`, `strategies.ts`, `passes.ts`, `tx.ts`, `rules/compile.ts`, `rules/form.ts`, the simplify and fold tables, the backend image format (`covers`) and `heat`, and IRWB-008's edit census script and its result (394 of 394 simplify/fold edits re-derivable). Findings that shaped the design:

- Edit records are per `Tx` operation; a `replace` record gives `from`/`to` value ids; the justification of a new value lives in its origin (`origin[0].because`), not in the record.
- No edit record cites a rule: IRWB-008's `Tx.cite` was a proposal and was never built. "Cites" is therefore zero today; "matches" is measured by re-derivation with the same matcher (`firstMatch`).
- Image instructions carry `covers` (a value and its statement), so instructions can be attributed to statements and statements to edits.
- Register allocation is backend work and makes no `typed.blocks` edit.

`npm run build` took 3 min 19 s wall (18.7 s user): the machine's load average was about 35. The worktree has no `node_modules`; `tsc` resolves from the main checkout's `node_modules` above it.

Design committed as 42b7411 (`design-doc/01-design-classifying-the-optimizer-s-edits-as-local-structural-or-other.md`), with probe 01 (`scripts/01-probe-edit-kinds.mjs`: edit kinds per pass and the cost of one lowering plus seeded run per revision) started in the background.
