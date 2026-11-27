---
Title: 'Report: the share of local value rewrites among the optimizer''s edits'
Ticket: IRWB-035-G
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "On the corpus, local value rewrites are 19.5 % of the edits O2 makes and 10.2 % of those speed makes (31.6 % and 13.9 % of affected instructions); verified rules re-derive 46.3 % and 36.3 % of them."
LastUpdated: 2026-11-27T10:24:03.152519358-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: the share of local value rewrites among the optimizer's edits

## Result

On the 50 corpus projects, with every pass application accepted by the meaning gate:

| pipeline | edits | local | structural | other | affected instructions | local | structural | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `O2` | 2,021 | 19.5 % | 72.1 % | 8.4 % | 2,209 | 31.6 % | 59.6 % | 8.7 % |
| `speed` | 9,736 | 10.2 % | 84.1 % | 5.6 % | 11,632 | 13.9 % | 80.7 % | 5.4 % |

- **Local rewrites are a minority of all edits** under both pipelines, by count and by instructions. Control-flow cleanup (`cfg`) and, under `speed`, inlining make most of the edits.
- **Among value edits they are the majority.** Of the `replace` records (a statement's value tree changed in place), 78.2 % under O2 and 87.6 % under `speed` are local; the rest belong to `licm` and `lvn`, which read the value from a statement they placed.
- **Verified rules re-derive 46.3 % of the local rewrites under O2 and 36.3 % under `speed`** (183 of 395, 362 of 997). All of those were made by `simplify` or `fold`. No edit of another pass is an instance of a verified table.
- **The rest is conditional on a dataflow fact.** One rule family, "a `get` becomes what its reaching definitions assign" (`constprop` and the replacements of `subst`), would raise coverage to 94.9 % and 95.4 %. The two `strength` rules under a range hypothesis give the remaining 5 %.
- **Few functions have a history of only local edits:** 13 of 102 changed functions under O2 and 7 of 112 under `speed` have only local edits over the whole pipeline.

Framework changes: none under `src/framework/`. One export in `src/typed/analyses.ts` (`IMPURE`).

## Method

The definitions are in the design (`design-doc/01-…`), in the header of `src/typed/edit-classes.ts`, and summarized here.

**Unit.** One edit record of one accepted pass application, as `Tx` and `inline` write them (`Revision.edits`). Each project is run through `Program.pipeline` with the gate on; no step was rejected.

**Classes.** Decided from the record and the revisions before and after, never from the pass's name.

| class | an edit is in it when |
|---|---|
| local | it is a `replace` (one value tree A of a statement becomes B, the statement stays) and B reads only locals the input revision defines |
| structural | it is `block`, `retarget`, `replaceStmt`, `merge`, `move`, `unreachable`, `insert`, `local`, `inline`, the removal of a terminator or of an inlined call's statement, or a `replace` whose B reads a local this application created or inserted a `set` for |
| other | it removes a statement that is not a terminator; or it is a `note`, an unknown kind, or a `replace` whose trees are in neither revision (none occurred) |

Within local, the reason is `rule` when B equals A normalized by one verified table (re-derived with the compiler's own matcher over plain trees), `fact` when it is not re-derived and the values the pass made carry a `because`, `uncited` otherwise (none occurred in the pipelines; `div-to-shift` in the test is one).

**Borderline cases.**

| case | class | why |
|---|---|---|
| `constprop`, `strength` | local, `fact` | The tree changes in place and the equality is a claim about the input revision; it needs a reaching-definitions or range fact. |
| `subst` | its `replace` local (`fact`), its removal other | The replacement holds on the input revision by a reaching definition; the removed `set` is then dead. |
| `licm`, `lvn` replacements | structural (`motion`) | B reads a local that does not exist in the input revision. |
| `cfg` on a constant branch, `bce` | structural | Control flow, as the brief lists it. Their reasons (`branch-on-constant`, `branch-by-fact`) are kept apart. |
| `dce` | other | Neither a value replaced by an equal one nor control flow. |
| register allocation | not measured | The backend records no edits. |

Admitting `fact` into the local class is the choice that moves the numbers most. Every table below gives `rule` and `fact` apart, so the strict reading (only unconditional verified rules) is: 9.1 % of O2's edits and 3.7 % of `speed`'s.

**Instructions an edit affects.** Every revision is lowered with the default backend options. An edit claims the values and statements it removed (counted in the image before) and those it added (in the image after); a retargeted or moved statement counts its own instructions in the image after. An instruction lists the entities it implements in `covers`, and counts once. For a `replace` the claimed entities are the subtrees where A and B part. `Tx.rewrite` also makes every value above the change again; those are counted only in the "upper" figure. Every changed value and statement of all 493 applications is either claimed by one edit or rebuilt (the check column in `various/03-tables.txt`, section 7, is 0).

## Per pipeline, by reason

| class / reason | passes | O2 edits | % | O2 instr. | % | speed edits | % | speed instr. | % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| local / rule | fold simplify | 183 | 9.1 | 415 | 18.8 | 362 | 3.7 | 825 | 7.1 |
| local / fact | constprop strength subst | 212 | 10.5 | 284 | 12.9 | 635 | 6.5 | 794 | 6.8 |
| structural / cfg | cfg bce licm rotate | 1,118 | 55.3 | 1,100 | 49.8 | 4,406 | 45.3 | 3,258 | 28.0 |
| structural / cfg, branch by fact | bce | 13 | 0.6 | 26 | 1.2 | 13 | 0.1 | 26 | 0.2 |
| structural / cfg, test duplicated | rotate | 0 | 0 | 0 | 0 | 192 | 2.0 | 511 | 4.4 |
| structural / inline | inline | 0 | 0 | 0 | 0 | 3,165 | 32.5 | 5,327 | 45.8 |
| structural / motion | licm lvn | 226 | 11.2 | 191 | 8.6 | 290 | 3.0 | 260 | 2.2 |
| structural / new local | licm lvn | 100 | 4.9 | 0 | 0 | 126 | 1.3 | 0 | 0 |
| other / dead statement | dce subst | 169 | 8.4 | 193 | 8.7 | 547 | 5.6 | 631 | 5.4 |

With the rebuilt values counted (the upper figure), instructions are 4,517 under O2 (local 59.6 %, structural 36.1 %, other 4.3 %) and 15,735 under `speed` (34.3 %, 61.7 %, 4.0 %). The local share by instructions is therefore between 31.6 % and 59.6 % under O2 and between 13.9 % and 34.3 % under `speed`, depending on whether an expression that was made again around a changed operand counts as affected.

## Per pass

Every pass falls into one class, except `subst` (half its edits are replacements, half removals).

| pass | class | O2 edits | O2 instr. | speed edits | speed instr. |
|---|---|---:|---:|---:|---:|
| cfg | structural | 1,058 | 1,061 | 4,234 | 3,074 |
| inline | structural | 0 | 0 | 3,165 | 5,327 |
| licm | structural | 329 | 170 | 422 | 217 |
| rotate | structural | 0 | 0 | 281 | 647 |
| lvn | structural | 44 | 47 | 64 | 78 |
| bce | structural | 26 | 39 | 26 | 39 |
| simplify | local (rule) | 140 | 291 | 258 | 546 |
| fold | local (rule) | 43 | 124 | 104 | 279 |
| constprop | local (fact) | 141 | 185 | 258 | 279 |
| strength | local (fact) | 20 | 59 | 46 | 129 |
| subst | local (fact) 50 %, other 50 % | 102 | 106 | 662 | 787 |
| dce | other | 118 | 127 | 216 | 230 |

By instructions, `subst` is 37.7 % local under O2 and 49.0 % under `speed`. A pass's class following from its name is a result, not an input: the classifier does not read the name, and the test compares its classes with this table on six projects.

## Per project

Shares in whole percent; the full table with one decimal is `various/03-tables.txt`, section 4.

| project | O2 edits | local / structural / other % | O2 instructions | local % | speed edits | local / structural / other % | speed instructions | local % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| across-calls | 4 | 50 / 0 / 50 | 2 | 0 | 69 | 4 / 91 / 4 | 63 | 10 |
| algebra | 11 | 73 / 0 / 27 | 10 | 70 | 11 | 73 / 0 / 27 | 10 | 70 |
| blend | 9 | 33 / 56 / 11 | 10 | 50 | 12 | 25 / 67 / 8 | 15 | 33 |
| bounds-lab | 40 | 10 / 90 / 0 | 48 | 17 | 58 | 12 / 83 / 5 | 80 | 10 |
| bounds-offset | 7 | 14 / 86 / 0 | 10 | 20 | 10 | 10 / 90 / 0 | 21 | 10 |
| bounds-param | 3 | 33 / 67 / 0 | 4 | 50 | 6 | 17 / 83 / 0 | 9 | 22 |
| bounds-two | 13 | 8 / 92 / 0 | 15 | 13 | 18 | 11 / 83 / 6 | 24 | 8 |
| branches | 12 | 8 / 83 / 8 | 12 | 33 | 12 | 8 / 83 / 8 | 12 | 33 |
| bytecode-vm | 205 | 1 / 98 / 1 | 144 | 3 | 205 | 1 / 98 / 1 | 144 | 3 |
| call-chain | 1 | 100 / 0 / 0 | 2 | 100 | 135 | 5 / 90 / 4 | 119 | 8 |
| calls | 2 | 50 / 0 / 50 | 4 | 50 | 96 | 10 / 81 / 8 | 67 | 19 |
| checksum | 11 | 9 / 91 / 0 | 13 | 15 | 16 | 13 / 81 / 6 | 22 | 9 |
| chess-search | 764 | 18 / 78 / 4 | 890 | 31 | 7260 | 9 / 87 / 4 | 8757 | 12 |
| collatz | 0 | - / - / - | 0 | - | 3 | 0 / 100 / 0 | 8 | 0 |
| constants | 8 | 75 / 0 / 25 | 15 | 87 | 8 | 75 / 0 / 25 | 15 | 87 |
| dead-code | 24 | 21 / 63 / 17 | 27 | 41 | 24 | 21 / 63 / 17 | 27 | 41 |
| diagnostics | 3 | 67 / 0 / 33 | 4 | 75 | 3 | 67 / 0 / 33 | 4 | 75 |
| distinct | 0 | - / - / - | 0 | - | 55 | 5 / 89 / 5 | 28 | 4 |
| div-checks | 6 | 67 / 0 / 33 | 8 | 75 | 6 | 67 / 0 / 33 | 8 | 75 |
| div-magic | 2 | 100 / 0 / 0 | 3 | 100 | 5 | 40 / 60 / 0 | 8 | 38 |
| early-exit | 12 | 17 / 83 / 0 | 17 | 24 | 17 | 18 / 76 / 6 | 26 | 15 |
| f32-dsp | 82 | 27 / 72 / 1 | 98 | 43 | 129 | 19 / 79 / 2 | 179 | 23 |
| first-steps | 4 | 75 / 0 / 25 | 6 | 83 | 51 | 24 / 65 / 12 | 50 | 38 |
| fixed-point | 9 | 67 / 0 / 33 | 18 | 72 | 55 | 27 / 56 / 16 | 70 | 40 |
| fragments | 9 | 33 / 56 / 11 | 10 | 50 | 12 | 25 / 67 / 8 | 15 | 33 |
| gcd | 1 | 100 / 0 / 0 | 2 | 100 | 4 | 25 / 75 / 0 | 7 | 29 |
| heat-lab | 13 | 8 / 92 / 0 | 15 | 13 | 19 | 5 / 95 / 0 | 28 | 7 |
| histogram | 17 | 6 / 94 / 0 | 25 | 8 | 22 | 9 / 86 / 5 | 34 | 6 |
| licm-nested | 10 | 20 / 80 / 0 | 9 | 44 | 16 | 13 / 88 / 0 | 19 | 21 |
| licm-traps | 1 | 100 / 0 / 0 | 2 | 100 | 4 | 25 / 75 / 0 | 7 | 29 |
| lz-roundtrip | 79 | 24 / 57 / 19 | 76 | 29 | 192 | 15 / 74 / 11 | 305 | 10 |
| match-enum | 6 | 0 / 83 / 17 | 5 | 0 | 6 | 0 / 83 / 17 | 5 | 0 |
| my-analysis | 12 | 17 / 83 / 0 | 10 | 40 | 16 | 13 / 88 / 0 | 22 | 18 |
| my-first-pass | 8 | 25 / 50 / 25 | 6 | 33 | 8 | 25 / 50 / 25 | 6 | 33 |
| nested-loops | 5 | 40 / 60 / 0 | 5 | 80 | 11 | 18 / 82 / 0 | 15 | 27 |
| orders | 36 | 44 / 44 / 11 | 44 | 55 | 39 | 41 / 49 / 10 | 49 | 49 |
| params-demo | 9 | 33 / 56 / 11 | 10 | 50 | 12 | 25 / 67 / 8 | 15 | 33 |
| pressure | 8 | 25 / 50 / 25 | 7 | 29 | 8 | 25 / 50 / 25 | 7 | 29 |
| ramp | 14 | 21 / 71 / 7 | 20 | 35 | 19 | 21 / 68 / 11 | 29 | 24 |
| records | 0 | - / - / - | 0 | - | 0 | - / - / - | 0 | - |
| regalloc-lab | 8 | 25 / 75 / 0 | 9 | 44 | 33 | 12 / 82 / 6 | 40 | 18 |
| regex-nfa | 252 | 6 / 90 / 3 | 228 | 11 | 288 | 6 / 90 / 3 | 272 | 10 |
| sha-chacha | 206 | 40 / 21 / 38 | 247 | 54 | 541 | 21 / 60 / 18 | 701 | 26 |
| sort | 13 | 8 / 92 / 0 | 15 | 13 | 19 | 5 / 95 / 0 | 28 | 7 |
| start-here | 17 | 24 / 76 / 0 | 20 | 40 | 89 | 18 / 73 / 9 | 104 | 25 |
| strength | 14 | 29 / 64 / 7 | 22 | 45 | 19 | 26 / 63 / 11 | 31 | 32 |
| strings | 24 | 8 / 92 / 0 | 26 | 15 | 34 | 12 / 82 / 6 | 44 | 9 |
| ui-gallery | 11 | 55 / 36 / 9 | 14 | 71 | 37 | 30 / 65 / 5 | 47 | 38 |
| value-numbering | 5 | 20 / 80 / 0 | 8 | 25 | 8 | 13 / 88 / 0 | 13 | 15 |
| wrong-shift | 11 | 9 / 91 / 0 | 14 | 14 | 16 | 13 / 81 / 6 | 23 | 9 |

- The local share by edits has a median of 25.0 % across the 47 projects O2 changes (13 projects at 50 % or more) and 16.7 % across the 49 that `speed` changes (4 projects at 50 % or more). The projects with a high share are small straight-line programs (`algebra`, `constants`, `first-steps` under O2) where there is no control flow to clean.
- `chess-search` has 7,260 of `speed`'s 9,736 edits (74.6 %). Without it, `speed` is 2,476 edits with local 15.0 %, structural 76.1 %, other 8.9 % (instructions: 19.9 %, 70.9 %, 9.3 %), and O2 is 1,257 edits with 20.4 %, 68.4 %, 11.1 % (instructions: 32.4 %, 55.8 %, 11.8 %).
- `sha-chacha` is the large project with the highest local share (40.3 % of O2's edits, 53.8 % of instructions): its rounds are long straight-line arithmetic.
- `bytecode-vm` is the lowest (1.5 %): its 205 edits are almost all `cfg` on the dispatch loop.

## Verified-rule coverage of the local rewrites

| | O2 | speed |
|---|---:|---:|
| local rewrites | 395 | 997 |
| re-derived by a verified table | 183 (46.3 %) | 362 (36.3 %) |
| … made by that table's own pass | 183 | 362 |
| … made by another pass | 0 | 0 |
| by instructions | 415 of 699 (59.4 %) | 825 of 1,619 (51.0 %) |
| edit records that name a rule | 0 | 0 |

No edit record carries a rule name, so "cites a verified rule" is measured as: made by a table-driven pass and re-derived by its table. All 183 and 362 edits of `simplify` and `fold` re-derive, which repeats IRWB-008's finding on these two pipelines.

The weakest evidence each re-derived edit relies on (`rules/evidence.ts`):

| weakest evidence | O2 edits | speed edits |
|---|---:|---:|
| proof | 71 (38.8 %) | 174 (48.1 %) |
| reduced-width + argument | 69 (37.7 %) | 83 (22.9 %) |
| by construction (`fold`) | 43 (23.5 %) | 104 (28.7 %) |
| exhaustive | 0 | 1 |

The most frequent rules are `not-lt` (62 and 72 firings), `mul-pow2` (47 and 143), `fold-shl` (19 and 54), `pow2-mul` (19 and 28) and `fold-sub` (13 and 33).

### The rules that would raise coverage most

The local rewrites no table re-derives, by the shape where A and B part and the kind of `because` the pass recorded:

| shape | hypothesis | passes | O2 edits | cumulative coverage | speed edits | cumulative coverage |
|---|---|---|---:|---:|---:|---:|
| (verified tables today) | none | simplify fold | 183 | 46.3 % | 362 | 36.3 % |
| `get x` → constant | every reaching definition of `x` assigns that constant | constprop, subst | 141 | 82.0 % | 264 | 62.8 % |
| `get t` → `get x` | the one reaching definition is `t = x`, `x` not assigned between | subst | 29 | 89.4 % | 207 | 83.6 % |
| `get t` → tree | the one reaching definition is `t = tree`, pure, operands not assigned between | subst | 22 | 94.9 % | 118 | 95.4 % |
| `x / 2^k` → `x >> k`, `x % 2^k` → `x & (2^k − 1)` | `x ≥ 0` (range fact) | strength | 20 | 100 % | 46 | 100 % |

Three observations:

1. **The first three rows are one rule schema**: `get x` becomes the value its reaching definitions assign. It is not a rule over value trees (the tables' form) because its hypothesis is about statements. As a schema with a checkable hypothesis it covers 192 of the 212 uncovered O2 edits and 589 of the 635 under `speed`.
2. **The `strength` rewrites are already table-shaped.** `div(x, 2^k) → shr(x, log2 k)` and `rem(x, 2^k) → and(x, 2^k − 1)` need one new guard, "x is not negative", which the rule form (`rules/form.ts`) does not have; the verifier would prove them for `x ≥ 0`. That is 20 and 46 edits.
3. **No new unconditional rule would help.** Every local rewrite the tables do not re-derive carries a fact; there is no uncited one.

## What the numbers mean for programme A

The hypothesis was: if most value edits are local rewrites, a function's equivalence could be assembled from per-rule proofs instead of the sampled check.

- **The premise holds for value edits and fails for edits.** 78 % (O2) and 88 % (`speed`) of in-place value changes are local rewrites. But value changes are a quarter of O2's edits (505 of 2,021) and an eighth of `speed`'s (1,138 of 9,736).
- **Per-rule proofs alone discharge about a third of the units a per-function check would cover under O2, and a fifth under `speed`.** Taking "one function in one changed application" as the unit: 105 of 335 under O2 (31.3 %) and 139 of 662 under `speed` (21.0 %) contain only edits a verified table re-derives. With the reaching-definition schema and the two range-guarded rules added, 142 (42.4 %) and 197 (29.8 %) contain only local edits.
- **No whole function is covered in most cases.** Over a whole pipeline, 13 of 102 changed functions under O2 and 7 of 112 under `speed` have only local edits. For the other functions, equivalence assembled from rule proofs has gaps at every `cfg`, `dce`, `licm`, `lvn` and `inline` application, and the sampled check (or another validator) must fill them.
- **So programme A, as "proof by rules instead of sampling", can remove sampling for the applications of `simplify` and `fold`, and with one schema and one guard for those of `constprop` and `strength`** (6 of O2's 16 steps: `fold` and `simplify` twice each, `constprop`, `strength`), not for a function end to end. That agrees with IRWB-008's estimate that the rule-backed passes are about a fifth of Candela's subject runs.
- **The structural edits are not uniformly hard.** 1,058 of O2's 1,457 structural edits are `cfg`'s retargets, merges, moves and dropped blocks, each justified by graph shape alone; `dce`'s 118 removals are justified by liveness. Validators for those two (a check of the graph up to jump threading and block merging; a liveness certificate, which IRWB-008 mentions for `dce`) would cover 5 more of O2's 16 steps (`cfg` three times, `dce` twice). The hard remainder is `licm`, `lvn`, `subst`'s removal, `bce` and, under `speed`, `inline` and `rotate`.

### Limits of the measurement

- **Edit records have the granularity each pass chose.** `cfg` writes one record per retarget and per dropped block; `inline` writes one per created local and block but none per copied statement. Counts by edits therefore favour structural passes; the instruction weighting is the correction, and it also puts local rewrites below a third.
- **Instructions are static**, from images lowered with default options, not executed counts. A rewrite in a hot loop weighs as much as one in dead code. An unchanged parent whose instruction changes encoding because its operand did (`add` to `addi`) is not counted; the upper figure overcounts by including every rebuilt value.
- **The corpus is small programs plus five larger ones;** `chess-search` is 75 % of `speed`'s edits. Candela was not run.
- **`fact` is taken from the pass's record.** The classifier checks that a `local/rule` edit is an instance of its table; it does not check that a `local/fact` edit's hypothesis holds.
- **Re-derivation is not a proof of the rule.** 37.7 % of O2's re-derived edits rest on rules whose strongest evidence is "reduced width plus an argument" (the eight comparison inversions).
- **Backend decisions** (register allocation, coalescing, layout) leave no edit records and are outside the measurement.

## The tool

`src/typed/edit-classes.ts`, no Node dependency:

| export | what it does |
|---|---|
| `classifyApplication({ pass, before, after, edits })` | one `ClassifiedEdit` per record: class, reason, the rule match or the shape, the entities claimed, the rebuilt values |
| `rederive(a, b, tables?)` | the first verified table that rewrites tree `a` into `b`, with the rules fired and the weakest evidence |
| `instructionWeights(classified, imageBefore, imageAfter, { rebuilt? })` | instructions per edit |
| `tallyInto(tally, classified, weights?)` | counts by class and by reason |

A later stage calls it on a `Program`'s revisions: `classifyApplication({ pass: r.pass, before: revisions[i-1].artifact.value, after: r.artifact.value, edits: r.edits })`.

Test: `tests/typed/edit-classes.test.mjs` (4 tests). Scripts: `scripts/02-classify-corpus.mjs` (one JSON row per edit), `scripts/03-tables.mjs`, `scripts/04-per-project-compact.mjs`. To rerun: `node scripts/02-classify-corpus.mjs --json out.json`, then `node scripts/03-tables.mjs out.json`. The run takes about 4 minutes of CPU; on the loaded machine it took 18 to 31 minutes of wall time, most of it `chess-search`.

## Framework changes

- **None under `src/framework/`.** The edit records, the origins of made values and the `covers` lists of image instructions were sufficient.
- **`src/typed/analyses.ts`: `IMPURE` is exported.** Reason: the tree guard for `pure` in the classifier must use the same operator set as `isPure`, and a copy would drift.
- **Proposed, not done: a `rule` field on the `replace` records of table-driven passes.** It would make "cites" literal. It changes the edit lists that `tests/typed/rules.test.mjs` compares between the table-driven and hand-written passes, and re-derivation answers the question without it.
- **Proposed, not done: a guard `{ nonNegative: x }` in `rules/form.ts`** with a fact the matcher can query, so the two `strength` rewrites become verified rules.

## What was tried and what it gave

- **Classifying without the pass name** (the approach the design chose over a (pass, kind) table): it reproduced the table on every edit of both pipelines (each pass falls in one class, `subst` in two), and it classed a pass outside the pipelines (`div-to-shift`) as `local/uncited` with its shape.
- **Looking for edits of other passes that match a verified table:** negative. None of the 635 non-table local rewrites under `speed` is an instance of `simplify` or `fold`. Two `fold` edits are instances of both tables.
- **Counting instructions by the whole replaced tree** (first run): it gave local 59.6 % of O2's instructions. That figure counts the expression around each change and is kept only as the upper bound.

## Left out

- Candela and the pipelines `O1`, `O2+`, `loops` (the brief names O2 and `speed`).
- Executed-instruction weights.
- A check of the hypotheses of `local/fact` edits.

## Later

- A validator for the reaching-definition schema, then exact checking of `constprop` applications.
- Range-guarded rules for `strength`.
- A CFG validator for `cfg` and a liveness certificate for `dce`.
- Classes for backend decisions once they leave records.

## Files

- Design: `design-doc/01-design-classifying-the-optimizer-s-edits-as-local-value-rewrites-structural-edits-or-other.md`
- Diary: `reference/01-diary.md`
- Tables: `various/03-tables.txt` (final), `various/03a-tables-first-run.txt` (first run, whole-tree footprint), `various/04-per-project-compact.txt`
- Data: `various/02-classified-edits.json` (49 projects), `various/02-classified-edits-chess-search.json`
