---
Title: Corpus results
Ticket: IRWB-035-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/edit-census.ts
      Note: Callable classifier for adjacent Typed revisions
    - Path: repo://tests/typed/edit-census.test.mjs
      Note: Examples of nested firing, rule citation and borderline cases
ExternalSources: []
Summary: Local arithmetic explains 10.0% of O2 edit records and 4.2% of speed records across 50 projects.
LastUpdated: 2026-11-27T09:44:39.874437002-05:00
WhatFor: ""
WhenToUse: ""
---
# What can a local rule explain?

Local expression rules explain a minority of edits in both presets. All 100 project–preset runs succeeded. Restricting the denominator to value replacements still gives 203/505 (40.2%) local for O2 and 408/1,138 (35.9%) for speed. The difference between these figures and the headline shares is the cost, in edit records, of moving, cloning and deleting program structure.

| Preset and measure | Local | Structural | Other |
| --- | ---: | ---: | ---: |
| O2 · 2,021 edits | 203 (10.0%) | 1,413 (69.9%) | 405 (20.0%) |
| O2 · 832,248 executions at edited statements | 191,446 (23.0%) | 463,002 (55.6%) | 177,800 (21.4%) |
| speed · 9,736 edits | 408 (4.2%) | 8,128 (83.5%) | 1,200 (12.3%) |
| speed · 2,330,995 executions at edited statements | 264,246 (11.3%) | 1,716,304 (73.6%) | 350,445 (15.0%) |

O2's CFG cleanup alone accounts for 1,058 edits. Under speed, inlining contributes another 3,165 structural records. A large project affects the pooled result. Chess-search supplies 74.6% of speed edits, yet omitting it raises the local share only to 5.7%. Hot code changes the balance more for O2. Local sites cover 16.7% of its affected static words and 23.0% of affected executions. The corresponding shares for speed are 9.5% and 11.3%. Complete pass and project breakdowns, including zero-edit projects, follow in the [measurement tables](02-measurement-tables.md).

## What could be proved by rules?

**Explicit verified-rule coverage is 0/203 for O2 and 0/408 for speed.** Replay recovered existing verified rule sets for 183 O2 edits (90.1% of locals) and 362 speed edits (88.7%). Recording just the comparison inversion `not-lt` and the right-constant multiply-to-shift rule `mul-pow2` would fully cite 108 O2 edits. For speed those two cover 203 edits. Adding `fold-shl` brings the speed count to 248/408, excluding combined folds that also require another rule. These are complete field edits, including any nested firings. The recorded evidence for these three rules is, respectively, a reduced-width check with an argument, a proof, and evaluation by construction.

The remaining 20 O2 and 46 speed local records need two guarded signed-integer schemas. For nonnegative x and positive k = 2^j, replace x / k with x >> j and x % k with x & (k − 1). The remainder rule alone covers 10 complete O2 records and 24 speed records, division alone covers 7 and 19, and three in each preset need both. A validator must establish the nonnegative premise at the use. Simply naming the identity cannot discharge it.

Per-rule proofs could cover entire pass applications for some functions. Of changed function–revision pairs, 116/335 in O2 and 154/662 in speed have only local records. Across the whole pipeline, only 13/102 edited O2 functions and 7/112 edited speed functions have exclusively local records. These are opportunities in the recorded bodies. Discharging a function requires checking its unchanged skeleton, replay coverage and any callees. The experiment supplies no replacement for the meaning gate on structural and residual edits. Even admitting the three binding-dependent shapes as local raises the all-edit share only to 20.6% and 10.6%. Forward substitution is the largest such opportunity for speed (331 replacements), reaching-constant propagation for O2 (141).

This corpus weighs optimizer activity by its frequency on the checked programs. The 199 O2 and 294 speed revision boundaries can charge the same source statement repeatedly. Across 246 O2 and 343 speed image profiles, 5/10,780 and 6/15,910 generated calls, respectively, hit the emulator limit and returned no counters. Results depend on those generated inputs and the default backend. They measure neither production workload frequency nor time saved by omitting checks.

## How to read the census

The input is every directory under corpus/projects with its own project configuration. Start each built-in strategy at a fresh r0 and use the normal strategy registry and its meaning contract (40 cases, seed 7, project input specifications, baseline r0). Walk adjacent published revisions. A no-op contributes zero records. An observation is an element of the edit array, so the same edit id in two functions is counted twice and a nested rewrite of one field is counted once. Two occurrences of a pass in a strategy are distinct observations.

For a fold or simplify replacement, rebuild its input field bottom-up with the pass's actual table, record the rule names, and compare the result with the recorded output by operator, type, immediate and ordered operands. Strength matches guarded signed division or remainder by a positive power of two and requires a recorded nonnegative interval on the replacement. Surrounding operators may remain intact. The replay shares matcher code with the producer and trusts the recorded range. It measures eligibility for proof. IRWB-006's evidence table and its fingerprint regression test supply the existing verification status.

A citation has the IRWB-008 form `rule:<set>/<name>@<version>#<fingerprint-prefix>`. Every distinct rule needed by the field must have a matching sound evidence record and token in its edit reasons, new value origins or relevant correspondence. A rule name inferred by replay is counted separately. In particular, returning an existing operand can leave no new value on which to record the identity used.

CFG, BCE, LICM, rotation and inlining are structural, including their helper edits. Other includes DCE removes, binding-dependent reads, helper locals and insertions from LVN, and the assignment removed after forward substitution. The tables include the sensitivity of the result to admitting reaching-constant, single-use-substitution and common-subexpression premises. Register allocation takes place during RV32 lowering and has no Typed revision edit records. Neither preset has an unroller.

## Instruction attribution

For both endpoint images, select the statement named in an edit, statement endpoints of a replacement, or the constituent statements of a created, merged-away or unreachable block. Follow immediate statement-to-statement correspondence in either direction. An instruction counts when any covered entity is one of these statements. Bookkeeping records without a statement can have zero weight. Take the union in each revision on each side. If two classes claim one word, split the credit equally between classes. The next pass gets a fresh accounting of both its endpoints.

The static denominator counts attributed machine words. The dynamic denominator counts executions of those words on ten r0-generated cases per function, with seed 7 and the project's declared inputs. Both presets use the same default backend options and emulator limit as strategy metrics. An execution with unavailable word counters contributes no profile. These are counts of work at touched statements. They include surviving instructions and omit indirect effects such as register spills elsewhere, code alignment and newly dead paths whose statements have no edit. No speedup is inferred from the footprint.

## Reproduction

From the worktree root run `npm run build`, then `node ttmp/2026/11/27/IRWB-035-B*/scripts/02-census.mjs` and `node ttmp/2026/11/27/IRWB-035-B*/scripts/04-tables.mjs`. The census script also accepts project ids. The gzipped JSON per project gives revision hashes, records in edit order, claimed endpoint statements, rule firings, citation status, per-class footprint and missing profiles. The exported TypeScript entry point is `classifyRevision(before, after)` in `src/typed/edit-census.ts`. Call it with adjacent entries of `Program.revisions`.

The implementation adds a Typed classifier and measurement scripts. The existing revision history, correspondence, rule matcher, image covers and emulator counters supplied all required evidence. There were no framework changes.

Validation used Node 24.18.0. The TypeScript build succeeded. The requested Typed, framework and workbench test files returned 409 passes, zero failures and three opt-in Candela skips. The [test log](../various/tests.log) records the individual results.
