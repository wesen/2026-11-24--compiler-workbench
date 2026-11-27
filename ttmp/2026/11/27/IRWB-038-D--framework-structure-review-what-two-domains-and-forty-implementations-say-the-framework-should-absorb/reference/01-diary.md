---
Title: Diary
Ticket: IRWB-038-D
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary of the IRWB-038-D framework review: what was read, the probes, the surveys, and the decisions."
LastUpdated: 2026-11-27T13:02:14.603867835-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

IRWB-038-D: a design-level review of the framework's structure. No production code. Probes are in `scripts/`.

## Step 1: the brief, the ticket, and how the reading was divided

- **Brief:** `ttmp/2026/11/26/IRWB-019--…/various/prompts/r3/claude/IRWB-038-D.md`. Worktree `.claude/worktrees/r3-fa-irwb-038-d`, branch `r3-fa/irwb-038-d`, base `93ec5fc`.
- **Ticket** created with docmgr; a design document and this diary added.
- **Decision:** read the merged framework and both domains myself, and send three read-only survey agents over the unmerged worktrees (T6; D1 and A0; B1), each with the same question: what did the cell build that the framework should have provided, with `path:line`. Reason: forty worktrees do not fit one context, and the surveys are independent.
- **Risk accepted:** a survey's line numbers are second-hand. I open the citations every conclusion rests on and mark them ✓ in the document.

## Step 2: the merged code

- Read the four READMEs, `passes/define-pass.ts`, `passes/bridge.ts`, `dataflow/analysis.ts`, `dataflow/solver.ts`, the tensor domain in full except the emitter's body, and Typed's `tx.ts`, `passes.ts`, `program.ts`, `rules/`, `sccp.ts`, `ssa.ts`, `analyses.ts`, `attribute.ts`, the backend's `regalloc.ts` and `frequency.ts`.
- **First surprise:** Typed does not use the framework's transactions or rewrite engine either. It has its own `Tx` and its own rule compiler. The coordinator's note says "the rewrite engine is unused by Tix"; it is unused by both.
- **Second:** the first design (IRWB-001 design-doc 02, §3 and §5.1) planned lowering stages as v6 compiler tasks and `simplify`/`fold` as v6 rewrite rules. Neither happened. The IRWB-006 diary (`:483`) records three reasons for the rules.
- **Third:** `runDifferential` already returns a value or a promise depending on the spec (`contracts/differential.ts:125`). The framework is dual-mode in one place.

## Step 3: probes 01 to 03

- **01, import census.** Transitive reach was the wrong measure (`ir/index.ts` re-exports everything), so a second part counts names imported per module. Result: zero names from `ir/rewrites.ts`, `transactions.ts`, `traversal.ts`, `diff.ts`, `store.ts`, `core/runtime.ts`, `query.ts`, `records.ts` in Typed, Tix or the workbench.
- **02, Tix against the edit layer.** `beginEdit()` throws (not Rewritable); `op()` patterns throw (no Operations capability). First run failed on my own example: `inline` did not apply to layernorm as I wrote it (`centered` had two readers). Changed the example. Then the finding I did not expect: the correspondence of `inline` says `centered: removed`, with no link to the statement that absorbed it.
- **03, binding times on the dataflow layer.** Worked on the first run: 20 lines, one workaround (a virtual entry, because the solver wants one entry and a read graph has several sources). So the solver is more general than its vocabulary.
- Commit `26d7ddb`.

## Step 4: an addition to the brief

- The coordinator added a section at the user's request: a standard library of compiler building blocks, with layering criteria and, per primitive, its interface, theory, the code it replaces and how it composes. Confirmed against `prompts/r3/common.md` in the main checkout (lines 13, 73, 85).
- **Effect on the plan:** the inventory gets a column naming the absorbing concept *or* library primitive, and the document gets §6.

## Step 5: probes 04 and 05

- **04, one runner, two drivers.** A generator that yields effect requests, a synchronous and an asynchronous driver. Both give revision `04a690a29419` for the real `inline` pass with a `need`; the synchronous driver names the effect when an answer is a promise.
- **05, fusion legality as dependence distance.** Three failed runs, all on my test programs: Tix does not allow shape symbols in indices; an axis needs a plain use to infer its extent; and the parser bounds-checks shifted reads. The last is itself a finding (affine range reasoning in the parser). Final: 10 of 10 functions agree with `planFusion`. The "shifted across rows" case is refused by extents, not by distance; the appendix says so.
- Commit `76378ef`.

## Step 6: the surveys return

- **B1:** six of seven wrote their own binding-time analysis; none used `dataflow()`; none changed the framework. One states why it did not register its analysis (`b1-fa-g` design `:72`, opened).
- **T6:** every cell wrote a plain-object schedule with a hand adapter; all run through `applyNativePassSync`; eight changed the framework, each time around the sync/async split. Seven wrote an accumulation-order analysis.
- **D1 and A0:** no framework change in fourteen cells. Seven attribution tools with one seven-step skeleton; seven classifiers with one nine-step skeleton; all re-derive the same 183 edits.
- **What changed my outline:** `a0-fa-g`'s report says the local rewrites that verified rules do not explain are "conditional on a dataflow fact". With T6's `legal` and B1's congruence this made "decide, justify, apply" one concept instead of three.
- Opened about twenty-five citations across the three surveys; all matched.

## Step 7: probe 06 and the citations

- **06, what edit records carry.** Over the corpus under O2: 1,774 edit records, none naming a rule; 190,716 correspondence entries, 98.5 % `retained` without a reason; 481 `retarget` edits that the correspondence shows as unchanged. The A0 cells count 2,021 on `t6-base`; I did not reconcile (different base and case count).
- **Literature.** The standing instructions say to cite only verified sources. A subagent checked 27 references against Crossref and publisher pages: 25 as stated, Rinard's report with two titles in two archives, and Cooper, Harvey and Kennedy's venue and year not confirmed. The reference list says so. Seven more come from the coordinator's report, which lists them as checked.
- Commit after probe 06.

## Step 8: the document

- Written in four parts and assembled. Corrections made while checking my own text against the code: a count I had not derived ("thirty-eight of forty-one") replaced by the two I had (none of twenty-one Typed cells, eight of ten T6 cells); `depthFirst`'s line range; the number of library primitives (thirty-four in ten groups, counted from the tables).
- **What I am least sure of:** that one `legal` signature fits fusion, scheduling and congruence (step 6 of the migration tests it), and that `unfold` is general enough to halve a B1 specializer (step 8 tests it). Both are marked as conjecture.

## How to review

- Start with §1 and §3.7 of the design document, then §5.1 and §5.2.
- Run the probes from the worktree root after `npm run build`: `node ttmp/2026/11/27/IRWB-038-D--*/scripts/0N-*.mjs`. Probe 06 takes about 30 s.
- Check a ✓ citation by opening the named worktree at its `HEAD`.
