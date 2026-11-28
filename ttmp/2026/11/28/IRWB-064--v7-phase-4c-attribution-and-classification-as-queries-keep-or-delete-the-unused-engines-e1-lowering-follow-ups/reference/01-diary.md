---
Title: Diary
Ticket: IRWB-064
Status: active
Topics:
    - framework
    - derivation
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T03:29:50.168909228-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: ticket, plan, and the guide delegated

This step opens phase 4c, the last two phase-4 items of v7 plus one round of lowering follow-ups. As in IRWB-059, I made the ticket with its guide, diary and tasks first, then delegated the guide to a fork that verifies against the source, and wrote the lane briefs in the meantime. The briefs point to the guide, so the lanes launch only after the guide is committed.

### Prompt Context
**User prompt (verbatim):** "continue"
**Assistant interpretation:** Run the remaining phase-4 items, 4.3 and 4.7, and the recorded follow-ups. Use the per-milestone pattern the user set: a docmgr ticket, an intern guide in the ticket uploaded to reMarkable, implementation by agents, each agent keeping its own detailed diary, and this coordinator diary. The request that set the pattern is quoted in IRWB-059 step 1.
**Inferred user intent:** Close v7 so its PR into `main` can open.

### What I did
- Located the code:
  - 4.3: attribution (`src/typed/attribute.ts` `attributeSteps`, `missed.ts` `hotShapes`) and classification (`edit-classes.ts` `classifyApplication`, `rederive`, `sameTree`).
  - 4.7: the core runtime (`core/runtime.ts` 914, `query.ts` 220, `records.ts` 103 lines; R3's "1,237-line core runtime"), the rewrite engine (`ir/patterns.ts` 921, `rewrites.ts` 855, `traversal.ts` 252) and the transaction layer (`ir/transactions.ts` 429). Their callers are `src/labs/`, `src/conformance/`, 9 framework test files, and `src/typed/rules/form.ts` (`NodePattern`).
  - E1 is BACKLOG §E1: an edit-stream benchmark, cost per edit against program size, with salsa-style early cutoff.
- `docmgr ticket create-ticket --ticket IRWB-064 …`, with the guide and diary documents and 7 tasks.
- A fork writes the guide: a recap of the system pointing to the IRWB-059 guide, then 4.3, 4.7 and F42.
- `scripts/14-write-briefs-p4c.py` reuses the helpers of `12-…p4b.py` and points every brief at the new guide. The launcher is `scripts/15-launch-p4c-lanes.sh` (base `v7-p4c-base`).

### Lanes
| Lane | Ticket | Cells | Files | Check or decision point |
|---|---|---|---|---|
| 4.3 attribution and classification as queries | IRWB-065 | GLM high, DeepSeek xhigh | `typed/attribute.ts`, `missed.ts`, `edit-classes.ts`, optional `ir/` query module | D1 tables reproduce; both A0 policies from one record, 393 against 395 settled; A0's matcher on `stdlib/term` |
| 4.7 E1 and the unused engines | IRWB-066 | Sol low | `core/{runtime,query,records}.ts`, `ir/{patterns,rewrites,traversal,transactions}.ts`, `labs/`, `conformance/`, `typed/rules/form.ts` | adopt the runtime only if per-edit checking cost falls with program size |
| F42 lowering follow-ups | IRWB-067 | Terra low | `tensor/strategy.ts`, `cuda-contract.ts`, `index.ts` | one schedule registry; schedule memo restored; CUDA byte-identical |

### Why
- 4.7 goes to Sol low because the lane is an experiment with a numeric gate, which Sol low honoured in IRWB-058. 4.3 has fixed numeric checks, the D1 tables and the A0 counts, which suit two cheap cells and a review.
- I left one open decision out of the lanes and recorded it for the user: which path runs the checked lowering (`lowerImageChecked`) by default.

### What should be done in the future
- When 4.3 and 4.7 are merged or withdrawn, phase 4 is closed. Then: the v7 PR into `main` (memory: open it with `gh pr create --base main --head irwb-001/import-v6-prototype`), and the v7 project report in the vault.

## Step 2: guide reviewed, two brief gaps fixed, four cells launched

The fork delivered the guide (5,834 words, frontmatter valid). It reported two findings that affected the briefs, and I fixed both before launch. My first attempt at that fix did not apply, and the commit message claimed it had; a second commit corrected it. Then I retagged the base and launched the cells, and a Haiku agent is uploading the guide.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Deliver the guide, then start the lanes.
**Commit (code):** `bd956e7` (the guide), then `da32a78` (the brief fixes); tag `v7-p4c-base` at `da32a78`.

### What I did
- **Finding 1:** `src/framework/ir/view.ts` imports `transactions.ts` (for `View.edit`) and `traversal.ts` (for `walk`, `subgraph`). It was not in lane 4.7's scope, and no caller uses those three methods. I added it to the scope, limited to those methods.
- **Finding 2:** the D1 tables in IRWB-034-G's report end at r6 with 6,349 instructions; today's run ends at r10 with 6,301, because `copies`, `dce`, `guards` and `subst-mem` have joined `speed`. The 4.3 brief now says to capture today's tool output before changing anything and to reproduce that.
- Regenerated the briefs with `scripts/14-write-briefs-p4c.py`.
- Ran `scripts/15-launch-p4c-lanes.sh 10800 queries engines followups`. The four processes run in `v7-queries-{g-h,ds-x}-irwb-065-{a,b}`, `v7-engines-sl-irwb-066` and `v7-followups-tl-irwb-067`.

### What didn't work
- The first edit asserted on anchors written with escaped backticks (`` \` ``). The generated `14-write-briefs-p4c.py` holds plain backticks, because the heredoc that wrote it was unquoted and unescaped them. The result: `AssertionError: anchor`. The `&&` chain did not stop the commit, because the Python step was a separate command earlier on the line, so `bd956e7` went in with the guide and without the fix its message describes. I redid the edit with plain backticks, checked it took effect (`view.ts` 2 matches, "capture today" 1), and committed `da32a78` with a message that says so.

### What I learned
- The fork's verification paid off twice: both findings would have sent a lane into a wall, a scope it could not complete and a reference table that no longer exists.

### What warrants a second pair of eyes
- The guide's reading of R3's 4.7 gate ("flat per-edit cost while today's grows") and its 395 reading of "local" are labelled proposals. The lanes decide, and the coordinator reviews.
