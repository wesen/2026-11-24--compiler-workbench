---
Title: Implementation diary
Ticket: IRWB-035-D
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/edit-classes.ts
      Note: the classifier this diary follows from probe to tool
    - Path: repo://tests/typed/edit-classes.test.mjs
      Note: its test
ExternalSources: []
Summary: 'Chronological record of IRWB-035-D: the edit census, the derivation probes and every failure that changed the definitions, the constprop chaining discovery, the implementation of src/typed/edit-classes.ts, the instruction-weight prototype, the corpus measurement and the count-independence check.'
LastUpdated: 2026-11-27T12:20:00-05:00
WhatFor: The reasoning and the dead ends behind the design and report.
WhenToUse: Before changing the classifier, or when a later run disagrees with the recorded tables.
---

# Implementation diary, IRWB-035-D

Worktree `a0-ds-x-irwb-035-d`, branch `a0-ds-x/irwb-035-d`, base `0f45d04`. Commits start with `IRWB-035-D:`.

## 1. Setup and reading

`npm ci` (1.7 s), `npm run build` (11.5 s). Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`,
`src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, `src/typed/tx.ts`,
`src/typed/rules/{form,compile,verify,evidence,fold,simplify}.ts`, and the IRWB-006/008/010 guides. The two records
the framework keeps for an edit are `RevisionReport.edits` (the requested change) and the revision-to-revision
correspondence; the third that matters is each value's `origin` (`because` names the entities or facts that justify
it). No framework change looked necessary; none was made.

## 2. Probe 01: the edit census (scripts/01-edit-census.mjs)

Ran O2 and speed on all 50 corpus projects at the default contract count of 40. 11,757 records, no rejected pass.
Kinds and authors as in the design's table. Surprises that shaped the definitions:

- `cfg` writes 1,058 records in O2 on 50 small projects (517 `retarget`, 472 `unreachable`, 65 `move`, 22
  `merge`, 22 `remove`): the branch-and-block bookkeeping is the bulk of the "edits".
- `subst` always writes its replace and its remove together (51 + 51 in O2): the question "is this edit local"
  has a different answer for the two halves.
- `licm` and `lvn` write `replace` records whose new tree reads a local the same application created (`inv`, `vn`),
  so the replacement is not equal by itself.

Saved at `various/01-edit-census-count40.txt`.

## 3. Probe 02: re-deriving a replace (scripts/02-replace-derivation.mjs)

First attempt classified `replace` edits by their before/after trees and crashed three times in a row:

1. `show()` on a `remove` record's `stmt` (a statement, not a value) — fixed by using `showStmt`.
2. `treeOf(stBefore, e.to)` for a `get → get` site — a wrong store; fixed by comparing with the after tree.
3. `TypeError: st.get(id)` undefined for `e.from` **and** then for `e.to`: a field can be replaced twice in one
   application (`licm` hoists two operands of one expression), and the intermediate trees exist only in the pass's
   working store, in no artifact. Fixed by grouping the `replace` records of one `(fn, stmt, field)` into a chain
   and classifying the pair (first `from`, last `to`). Six fields in 1,643 records; chains 1,637.

Second finding: **derivation must come before a positional site diff.** `simplify` turning `((a+b)+0)` into `(a+b)`
looks like *two* divergent positions (`add` vs `get a`, `const 0` vs `get b`) because the rule reuses a subtree,
while replaying the table reproduces the after tree exactly. Reordered: table replay first, site checks only for
what the table does not explain.

Third finding: `type` normalisation. `tx.const({type:'i32'})` writes `type:'i32'`, an integer constant read from the
front end has no `type`; comparing them raw made every `subst` copy look like "no copy found" (45 + 3 records).
Fixed by comparing `(type ?? 'i32')`.

## 4. Probe 03: the last residuals (scripts/03-debug-residuals.mjs)

After the above, 21 `replace` chains were unexplained: 19 read-to-constant and 2 strength.

- **Read-to-constant that cites a rewritten definition.** In `start-here`'s speed pipeline, `constprop` replaced
  `clamp_t6` by 4000 citing `s:smooth.23` (`clamp_t6 = clamp_hi`), whose value is a `get` in the *consumed*
  revision: the same application had already rewritten that definition to `4000` earlier in its working copy. The
  citation check must accept a defining `set` in **either** revision. This is a real property of the pass, not an
  artefact: constant propagation chains within one application.
- **A nested strength rewrite.** `((chessFrom_move / 64) % 64)` became `((chessFrom_move >> 6) & 63)`: the outer
  `rem` and the inner `div` are both rewritten, and a shallow "is this site the rule shape" test rejected it. The
  fact-shape test became recursive (rewrite the node, then require the operands to match recursively).

## 5. Design

Wrote `design-doc/01-…` with the domain, the three classes, the decision procedure, the borderline decisions
(chains, `subst`, `licm`/`lvn`, constprop chains, `strength`, `retarget`, `unreachable`), the instruction-weight
definition and its rejected alternative (tracing entities to the final image, which gives removals weight zero),
the coverage method, the tool API, the alternatives considered, and the limits. Committed as `efc21af`.

## 6. The tool (src/typed/edit-classes.ts) and its test

`classifyPass(before, after, edits)` is pure over the two artifacts and the edit records; `classifySteps` adds the
instruction weight. Three bugs found by running it against the probes:

1. The fact-shape walk treated an **unchanged** `get` as a rewrite ("read of level replaced by a tree that is not
   its definition"). Fixed with a same-tree shortcut at the top of the walk: only changed positions are judged.
2. The div/rem shape fired on a node whose **child** had changed (`(x / 2) % 2` inside a constprop replacement)
   and reported "rem by 2 without a ranges fact". Fixed by requiring the node's own op to change (`div|rem` →
   `shr|and`) before judging the shape; otherwise recurse.
3. The motion test required `after.args.length > 0`, so a whole field replaced by `get vn` was not recognised.
   Replaced by a position-wise `readsMadeAtChange`.

Test `tests/typed/edit-classes.test.mjs`, 7 tests, 1.3 s: the table replay names `mul-pow2`; blend's O2 steps
classify as cfg structural, fold `local/rule-table fold-mul`, simplify `local/rule-table not-lt`, constprop
`local/fact read-to-constant`, dce structural, licm `structural/motion`; every edit record of four projects is
covered exactly once with `other` empty; strength names both shapes; a two-record licm chain is one finding;
classification is deterministic. `npm run build` passes; the test takes 3.1 s after formatting.

## 7. Probe 04: the instruction weight (scripts/04-instruction-weight.mjs)

Prototype on five projects. Two things learned:

- Lowering a revision costs about 1 ms per instruction (3.3 s for chess-search's 3,369 instructions; 225 ms for
  bytecode-vm's 212). It, not the emulator runs (500 runs in 344 ms), dominates the measurement, so each changed
  step lowers two revisions and the weighting was run at the metric's 10 cases.
- The first full attempt ran a pipeline at contract count 2 and took 21 min for four projects; at count 1 the
  measurement is about 8 min for all 50. The count only gates acceptance, so the measurement uses 1 and re-checks
  independence (step 9).

The rejected alternative was tracing each edited entity forward through the correspondences to the final image and
weighting it there: every removal (dce, subst's structural half, cfg merges) would weigh zero, which is exactly the
class where removals dominate.

## 8. The corpus measurement (scripts/05-measure-corpus.mjs)

50 projects × 2 pipelines at contract count 1, weight cases 10 seed 7. 11,757 records, 11,751 findings, **0 other**;
`checks.records == checks.classifiedRecords`. Recorded in `various/05-classification.json` and
`various/05-tables.txt`; derived figures in `various/07-report-figures.txt`.

Headline: local 19.5 % of O2's records, 10.2 % of speed's. Verified-rule coverage of local rewrites 46.3 % (O2) and
36.3 % (speed); the uncovered remainder is three shapes — read-to-constant 141/264, read-to-single-definition
51/325, div/rem-pow2 23/49. Local share of content-edit instruction weight 40.0 % (O2) and 10.4 % (speed). The
weight total exceeds the head revisions' instruction count 1.57× (O2) and 7.18× (speed) because an instruction
counts once per edit that touches it; the report states this.

## 9. Count independence (scripts/06-count-independence.mjs, scripts/01 at count 40)

The pipeline's contract count cannot change any pass's output (the check gates publication, and nothing is rejected
on the corpus), but that is an argument, not a measurement. Two checks: `06` runs eight projects at count 1 and 40
and compares head revision, per-step edit counts and per-edit classes; `various/01-edit-census-count40.txt` is the
full-corpus census at 40, and `various/08-census-vs-classification.txt` compares it per (pipeline, pass, kind) with
the count-1 measurement. `06`: 8 projects x 2 pipelines, 16 of 16 runs identical (head revision, per-step edit counts, per-edit
classes) at count 1 and 40. `08`: 52 (pipeline, pass, kind) keys, 0 differ, 11,757 records either way. Recorded in
`various/06-count-independence.log` and `various/08-census-vs-classification.txt`.

## 10. Report

`design-doc/02-…` carries the question, the tables, the coverage and the programme A reading: sampling cannot be
retired by expression rules (80–90 % of edits are structural), but the structural half is ten edit kinds, each with
a premise the pass already computes, and the uncovered local half is three premise-carrying rules. Limits: corpus
only, local in isolation, the pass's own matcher, touch-based instruction weight, and the `subst` convention
(17.0 % / 6.8 % local if its replace half is called structural).

## 11. Final validation

`npm run build` (tsc) passes; prettier applied to the new `src/typed/edit-classes.ts` (it is a new file, so it had
no pre-change formatting to preserve). Required selections, on the final tree:

- `node --test tests/framework/*.test.mjs`: 234 pass, 0 fail.
- `node --test tests/typed/*.test.mjs`: 156 pass, 2 skipped (the Candela and tape-lift cases), 196 s.
- `node --test tests/workbench/*.test.mjs`: 24 pass, 1 skipped.
- `node tools/build-site.mjs`: builds (app.js 2,964 KiB, 50 projects, 17 chapters); the new module is not part of
  the browser bundle and imports no Node built-in.
- `node --test tests/typed/edit-classes.test.mjs`: 7 pass.

`docmgr doctor --ticket IRWB-035-D` reports only the repository's existing `diary` doc-type vocabulary warning.
Framework files changed: none.
