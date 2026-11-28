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

## Step 3: lanes 4.3, 4.7 and F42 scored and merged; phase 4 closed

All four cells exited 0 and scored clean on their commits (`lanes-scores.jsonl`), and none touched the coordinator's tickets. I merged F42 (Terra), the engines lane (Sol low) and GLM's queries cell in that order, without conflicts, and exported the new attribution module from the IR index. Every check passes on the working branch, including the new labs suite and the GPU suite. With this merge every phase-4 item is merged or withdrawn at its decision point.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Score, review, choose, merge and validate; then close phase 4.
**Commit (code):** cherry-picks of `v7-followups-tl/irwb-067`, `v7-engines-sl/irwb-066` and `v7-queries-g-h/irwb-065-a`; `da520d7` (exports `ir/attribution.js`).

### What I did
- Scored the four cells with `BASEREF=v7-p4c-base scripts/07-score-lanes.sh …`.
- Added `labs` to the scorer's suite list (`04-score-cell.sh`), because the engines lane created `tests/labs/`. `sed -i` writes a new file, so the scorer run already in progress kept its old copy. Its last cell (the engines cell) was scored by a fresh invocation and already included labs: 108 passed.
- Read the final messages of all four cells and cherry-picked F42, then engines, then GLM's queries.
- Added `export * from './attribution.js'` to `src/framework/ir/index.ts`. Both 4.3 cells noted that the module was not exported; the file belonged to lane 4.7.
- Checks on the working branch:
  - tsc clean; Prettier flags 6 pre-existing files;
  - suites: typed 200, framework 168, workbench 24, stdlib 67, **labs 108**, tensor CPU 64;
  - baselines `no differences`; site builds;
  - **GPU 23/23**;
  - `src/framework` is now 9,927 lines (it was 12,732 by the engines lane's count).

### Why: GLM's 4.3 cell over DeepSeek's
| | GLM high (065-A) | DeepSeek xhigh (065-B) |
|---|---|---|
| D1 tables | byte-identical before and after | identical (151 and 173 lines, `cmp` clean) |
| D2 tables | byte-identical, plus a **whole-corpus differential against the old tools**: O2 336 and `speed` 510 comparisons, 0 differences | the three tables identical |
| A0 | 203 scoped, 395 in place, both queries; the two `fold` records counted as chain intermediates, following A0's header | 203 and 395, both queries, with 395 broken down by pass |
| scope | edited `ir/derivation.ts` (`inPlaceInput`), flagged; no other lane touched that file this round | within scope; noted that `derivation.ts`'s docs on `locality` are stale |
| A0's matcher on `stdlib/term` | yes (`normalize` through `instantiate`) | yes |

Both deliver everything the lane asked for. GLM's corpus-wide differential is the stronger evidence that nothing changed, and its scope exception collided with nothing, so I merged GLM.

### Lane 4.7: the decision, and why I am raising it with the user
- **The E1 numbers** (ms per edit, runtime against today):

  | Program | Size | With the runtime | Today |
  |---|---|---|---|
  | chess | 29 functions | 138 | 390 |
  | chess | 40 functions | 201 | 493 |
  | chess | 50 functions | 223 | 817 |
  | Candela | full | 684 | 18,454 |

- **The cell's reading of the gate:** absolute cost per edit must fall as program size grows. The runtime's absolute cost rises (138 → 223), so the cell called the gate failed. It moved the runtime (`runtime.ts`, `query.ts`, `records.ts`) and the graph rewrite engine (`patterns.ts`, `rewrites.ts`) into `src/labs/`, with their conformance tutorials and tests (`tests/labs/`, 108 tests).
- **It kept** `transactions.ts` and `traversal.ts` in the framework: the runner's `ctx.edit` calls `View.beginEdit()`, and the view and reader APIs use traversal. The brief's caller list missed both dependencies.
- **My view:**
  - That reading is one no implementation could pass: any per-edit cost grows with program size.
  - The likelier intent of "falls with program size" is the *relative* cost. On that reading the runtime passes clearly: its advantage grows from 2.8× to 3.7× on chess and reaches 27× on Candela.
  - The move is reversible, since the code is in `src/labs/` and nothing was deleted, so I merged it as it stands.
  - I am putting the reading to the user: the alternative is to bring the runtime back into the core and adopt it for incremental checking per function (BACKLOG E1).

### What didn't work
- F42 (Terra): in its sandbox, the non-GPU run reported 1 failing file (chess-search) with no diagnostic. It passed in isolation, and the scorer found no failure.

### What I learned
- R3's gates were written as phrases, not formulas. Two of them were ambiguous in this phase: "materially slower", which I fixed at 10% in the brief, and "falls with program size", which I did not fix. A gate in a brief should be a formula.

### Phase 4 status
| Item | Outcome |
|---|---|
| 4.1 derivations | merged (IRWB-056-B) |
| 4.2 cross-IR lowering | merged (IRWB-061) |
| 4.3 attribution and classification as queries | merged (IRWB-065-A) |
| 4.4 fusion and scheduling as decide/eligible/prepare | merged (IRWB-057) |
| 4.5 `solveFor` and `pe` | `solveFor` merged; `pe` and `unfold` withdrawn at the gate (IRWB-058) |
| 4.6 rules over a term signature | merged (IRWB-060-A) |
| 4.7 the unused engines | runtime and graph rewrite engine moved to labs; transactions and traversal kept (IRWB-066); gate reading open with the user |
| 4.8 staged choice | merged (IRWB-062) |

F42 (IRWB-067) is merged: one schedule registry, and the memo is back (`cudaSource()` on warmed matmul: 6.26 → 2.08 ms).

### What should be done in the future
- The user's two decisions: the 4.7 gate reading (adopt the runtime for incremental checking?), and the checked lowering on a default path.
- The v7 PR into `main`, then the v7 vault report.

### Code review instructions
- 4.3: `src/framework/ir/attribution.ts` (`creditLink`, `provenanceLabels`), `src/typed/attribute.ts`, `src/typed/edit-classes.ts`.
- 4.7: the move commits and `tests/labs/`; E1's benchmark is in the IRWB-066 ticket's `scripts/`.
- Validate: `node --test tests/labs/*.test.mjs tests/framework/attribution.test.mjs tests/typed/derivations.test.mjs`.
