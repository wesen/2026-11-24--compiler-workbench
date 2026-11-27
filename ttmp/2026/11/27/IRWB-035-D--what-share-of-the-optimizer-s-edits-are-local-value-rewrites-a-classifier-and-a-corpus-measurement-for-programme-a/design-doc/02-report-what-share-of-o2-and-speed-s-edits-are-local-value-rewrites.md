---
Title: 'Report: what share of O2 and speed''s edits are local value rewrites'
Ticket: IRWB-035-D
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/edit-classes.ts
      Note: the classifier and the instruction weighting this report measures with
    - Path: repo://src/typed/rules/compile.ts
      Note: the rule matcher a value rewrite is re-derived with
    - Path: repo://src/typed/rules/evidence.ts
      Note: the recorded strength of every cited rule
    - Path: repo://src/typed/tx.ts
      Note: the edit records classified
    - Path: repo://tests/typed/edit-classes.test.mjs
      Note: the classifier's test
ExternalSources: []
Summary: Every edit O2 and speed make on the 50 corpus projects, classified as a local value rewrite, structural, or other (11,757 records, 0 other), with the shares per pass, per pipeline and per project, the instruction weight of each class, the verified-rule coverage of the local rewrites (46.3 % of O2's, 36.3 % of speed's) and the three premise-carrying rules that would cover the rest, and what this means for proof by rules instead of sampling.
LastUpdated: 2026-11-27T12:10:00-05:00
WhatFor: The measurement programme A was waiting for, its limits, and the next step it points at.
WhenToUse: When deciding whether per-rule proofs can replace the sampled meaning check, or before rerunning/extending the classifier.
---

# Report: what share of O2 and speed's edits are local value rewrites?

The design this implements is `design-doc/01-…`. The measurement is reproducible with the scripts under `scripts/`
and the recorded tables are in `various/05-tables.txt` and `various/07-report-figures.txt`.

## The answer in one screen

50 corpus projects, both pipelines run on every project from its own `r0`: 100 pipeline runs, **11,757 edit
records**, grouped into 11,751 findings (six statement fields were replaced twice in one application), **0 left
unexplained**.

| pipeline | local | structural | other | local share (records) | local share (findings) |
| --- | --- | --- | --- | --- | --- |
| **O2** | 395 | 1,626 | 0 | **19.5 %** (395 / 2,021) | 19.6 % |
| **speed** | 997 | 8,739 | 0 | **10.2 %** (997 / 9,736) | 10.2 % |

- Most of what the optimizer does on this corpus is **not** a value replaced by an equal one. One edit in five in
  O2, one in ten in `speed`. `speed` adds inlining, rotation and four times the cfg cleanup, and all of that is
  structural.
- Among the edits that change the program's content (a value, or a statement created, removed or replaced), the
  **executed instructions** the local rewrites touch are 40.0 % of the content weight in O2 and 10.4 % in `speed`.
- Of the local rewrites, **46.3 % of O2's and 36.3 % of `speed`'s already cite a verified rule** (`fold`,
  `simplify`). The rest are three fact-guarded shapes that no rule table covers today — read-to-constant,
  read-to-single-definition, and division/remainder by a power of two — and a premise-carrying rule for each
  would take the coverage of the local rewrites to 100 %.

| pipeline | local rewrites | verified rule | fact-guarded shape | read-to-constant | read-to-single-definition | div/rem-pow2 |
| --- | --- | --- | --- | --- | --- | --- |
| O2 | 395 | 183 (46.3 %) | 212 (53.7 %) | 141 | 51 | 23 |
| speed | 997 | 362 (36.3 %) | 635 (63.7 %) | 264 | 325 | 49 |

## 1. What was counted, and what a class means

The unit is one **edit record** (`Edit`, `src/typed/tx.ts`) of one changed pass application, read between the
revision the pass consumed and the one it produced. Definitions, the decision procedure and the borderline
decisions are in the design (`design-doc/01-…` §3–§4); in short:

- **local rewrite** — a statement field's tree is the consumed tree rewritten in place by (a) the pass's own rule
  table, replayed bottom-up (`fold`: `FOLD_RULES`; `simplify`: `SIMPLIFY_RULES`), or (b) one of three
  fact-guarded shapes whose premise the made value cites in its provenance. Nothing outside the replaced subtree
  enters the justification.
- **structural** — every other edit record: control-flow retargeting, block merging and pruning, statement
  insertion, removal and movement, a local, an inlined call, loop rotation, and a value replaced by a read of a
  local the same application created (loop-invariant motion, value numbering).
- **other** — a value replacement none of those explain. **Zero on the corpus**; the class exists so that a new or
  changed pass shows up as something to inspect instead of being absorbed into structural.

`replace` records of one (function, statement, field) are grouped into one finding, because a field can be
replaced more than once in one application and only the endpoints are artifacts (six such fields in 11,757
records). A finding's `records` counts the edit records it covers.

## 2. Per pass

Records, findings and instruction weight per pass. `local inst.` and `structural inst.` are the sums of the
per-edit weights (§4), not a partition of the program.

| pipeline | pass | records | local | structural | other | local inst. | structural inst. | rules fired / fact shapes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O2 | bce | 26 | 0 | 26 | 0 | 0 | 0 | - |
| O2 | cfg | 1,058 | 0 | 1,058 | 0 | 0 | 711,175 | - |
| O2 | constprop | 141 | 141 | 0 | 0 | 6,556 | 0 | read-to-constant×141 |
| O2 | dce | 118 | 0 | 118 | 0 | 0 | 18,719 | - |
| O2 | fold | 43 | 43 | 0 | 0 | 1,141 | 0 | fold-shl×19 fold-sub×13 fold-mul×9 fold-eqz×2 fold-add×1 fold-gt×1 |
| O2 | licm | 329 | 0 | 328 | 0 | 0 | 327,506 | - |
| O2 | lvn | 44 | 0 | 42 | 0 | 0 | 15,483 | - |
| O2 | simplify | 140 | 140 | 0 | 0 | 61,353 | 0 | not-lt×62 mul-pow2×46 pow2-mul×19 add-zero×4 not-gt×3 mul-one×2 mul-zero×2 not-le×2 not-ge×1 not-ne×1 sub-self×1 sub-zero×1 |
| O2 | strength | 20 | 20 | 0 | 0 | 903 | 0 | rem-pow2-to-and×13 div-pow2-to-shr×10 |
| O2 | subst | 102 | 51 | 51 | 0 | 32,379 | 14,179 | read-to-single-definition×51 |
| speed | bce | 26 | 0 | 26 | 0 | 0 | 0 | - |
| speed | cfg | 4,234 | 0 | 4,234 | 0 | 0 | 3,439,462 | - |
| speed | constprop | 258 | 258 | 0 | 0 | 26,273 | 0 | read-to-constant×258 |
| speed | dce | 216 | 0 | 216 | 0 | 0 | 92,365 | - |
| speed | fold | 104 | 104 | 0 | 0 | 12,900 | 0 | fold-shl×54 fold-sub×33 fold-mul×15 fold-add×11 fold-eqz×2 fold-gt×1 |
| speed | inline | 3,165 | 0 | 3,165 | 0 | 0 | 210,874 | - |
| speed | licm | 422 | 0 | 421 | 0 | 0 | 304,241 | - |
| speed | lvn | 64 | 0 | 62 | 0 | 0 | 15,371 | - |
| speed | rotate | 281 | 0 | 281 | 0 | 0 | 724,866 | - |
| speed | simplify | 258 | 258 | 0 | 0 | 60,053 | 0 | mul-pow2×131 not-lt×72 pow2-mul×28 zero-add×9 not-gt×5 add-zero×4 not-le×4 mul-one×2 mul-zero×2 div-one×1 not-ge×1 not-ne×1 sub-self×1 sub-zero×1 |
| speed | strength | 46 | 46 | 0 | 0 | 1,024 | 0 | rem-pow2-to-and×27 div-pow2-to-shr×22 |
| speed | subst | 662 | 331 | 331 | 0 | 33,737 | 33,726 | read-to-single-definition×325 read-to-constant×6 |

What the per-pass view says:

- The rule-table passes are exactly as local as their design: `fold` 43/43, `simplify` 140/140 (O2) and 104/104,
  258/258 (`speed`). Every one of those rewrites is re-derived from the consumed tree and the table.
- `constprop`, `strength` and the replace half of `subst` are local rewrites too, but their equality rests on a
  fact and a citation, not on a verified rule — 212 of O2's 395 local findings.
- `licm` (328 in O2) and `lvn` (42) write almost no local rewrites: 107 of their replacements are *reads of a
  local the same application created* (motion and numbering), classified structural because the replacement is
  not equal by itself.
- `cfg` is the largest single author of edits (1,058 records in O2, 4,234 in `speed`) and is purely structural:
  517 retargets and 472 `unreachable` records in O2 are branch and block bookkeeping.

## 3. Structural edits by kind

| pipeline | kind | findings | records | instruction weight |
| --- | --- | --- | --- | --- |
| O2 | retarget | 517 | 517 | 674,585 |
| O2 | unreachable | 472 | 472 | 0 |
| O2 | remove | 191 | 191 | 32,898 |
| O2 | insert | 116 | 116 | 120,866 |
| O2 | local | 100 | 100 | 0 |
| O2 | move | 65 | 65 | 41,848 |
| O2 | merge | 22 | 22 | 0 |
| O2 | replaceStmt | 17 | 17 | 0 |
| O2 | block | 16 | 16 | 0 |
| O2 | motion (licm/lvn replacements) | 107 | 107 | 0 |
| speed | block | 1,682 | 1,682 | 0 |
| speed | unreachable | 1,348 | 1,348 | 0 |
| speed | remove | 1,300 | 1,300 | 337,029 |
| speed | local | 1,162 | 1,162 | 0 |
| speed | move | 1,148 | 1,148 | 2,672,212 |
| speed | retarget | 847 | 847 | 772,444 |
| speed | merge | 518 | 518 | 0 |
| speed | inline | 235 | 235 | 0 |
| speed | replaceStmt | 209 | 209 | 724,866 |
| speed | insert | 149 | 149 | 98,047 |
| speed | motion (licm/lvn replacements) | 138 | 138 | 0 |

Block, local, inline and unreachable edits name no machine instruction, so their instruction weight is zero by
construction (§4).

## 4. The instruction weight, and what it does not mean

The design defines, for each edit, the executed instructions of the revision it produced (consumed, for removals)
whose `covers` name an entity the edit changed, created or removed, on the workbench's seeded cases (10 per
function, seed 7). The measured groups:

| pipeline | group | findings | weight | share of weight |
| --- | --- | --- | --- | --- |
| O2 | local | 395 | 102,332 | 10.5 % |
| O2 | content: statements created, removed or replaced | 324 | 153,764 | 15.8 % |
| O2 | bookkeeping: branch targets, block moves/merges/prunes, locals, inlined calls | 1,192 | 716,433 | 73.7 % |
| speed | local | 997 | 133,987 | 2.8 % |
| speed | content: statements created, removed or replaced | 1,658 | 1,159,942 | 24.5 % |
| speed | bookkeeping: branch targets, block moves/merges/prunes, locals, inlined calls | 6,940 | 3,444,656 | 72.7 % |

Among edits that change the content, the local share of the instruction weight is **40.0 % in O2** and **10.4 %
in `speed`**.

Two limits have to be read with these numbers:

- **An instruction counts once per edit that touches it**, so the weights do not partition the program: O2's total
  weight is 1.19 M against 0.76 M executed instructions of the head revisions (1.57×), `speed`'s is 4.95 M
  against 0.69 M (7.18×). `speed`'s factor is large because cfg re-moves hot statements (1,148 `move` records)
  and inlining re-emits them, and each move counts the statements it moves.
- **A bookkeeping edit touches instructions without changing them.** A `retarget` changes where a branch goes,
  not whether it executes; a `move` relabels a statement's block. Their weight says "this much executed code is in
  the region the edit rearranges", not "this much code the edit changes". That is why the content-only share is
  the one to quote for "how much of the executed program does a value rewrite touch".

## 5. Verified-rule coverage, and the rules that would raise it

Cited rules and their recorded evidence (`RULE_EVIDENCE`): every cited rule is `sound`, and no citation is
`sampled` — the citations are `proof` (the algebraic identities and `mul-pow2`), `reduced-width+argument` (the
comparison inversions), `exhaustive` (one rule) and `by-construction` (`fold`, relative to the evaluator).

| pipeline | local findings | rule-table (verified) | fact-guarded | verified share | rule strengths |
| --- | --- | --- | --- | --- | --- |
| O2 | 395 | 183 | 212 | 46.3 % | proof×75, reduced-width+argument×69, by-construction×45 |
| speed | 997 | 362 | 635 | 36.3 % | proof×178, by-construction×116, reduced-width+argument×83, exhaustive×1 |

The most-cited rules are `not-lt` (62 in O2, 72 in `speed`), `mul-pow2` (46 / 131), `pow2-mul` (19 / 28) and the
`fold-*` operators; the full table is in `various/05-tables.txt`. `fold`'s evidence is `by-construction` — a proof
relative to the evaluator's own definition of each operator — which is weaker than `simplify`'s symbolic proofs
in the sense that it moves the obligation to the evaluator; that qualification belongs in any programme A claim.

**What covers the rest.** The 212 (O2) / 635 (`speed`) uncovered local rewrites are three shapes. Ranked by how
many findings each would convert:

| rule needed | shape | O2 findings | speed findings | what its premise is | where the premise comes from |
| --- | --- | --- | --- | --- | --- |
| read-to-constant | `get l → const c` | 141 (35.7 % of local) | 264 (26.5 %) | every reaching definition of `l` assigns `c` | `reaching` analysis, already declared by `constprop` |
| read-to-single-definition | `get l → T` | 51 (12.9 %) | 325 (32.6 %) | `l`'s single definition is `l = T`, `T` is pure, `l` is read once and dead after | `reaching` + `liveness`, already declared by `subst` |
| div/rem-pow2-to-shift | `x / 2^k → x >> k`, `x % 2^k → x & (2^k-1)` | 23 (5.8 %) | 49 (4.9 %) | `0 ≤ x < 2^31` | `ranges`, already declared by `strength` |

A rule of this kind is *a rule with a premise*: the shape is verified once for every value of its variables under
the premise (for `x / 2^k` with `x ≥ 0`, the symbolic-linear proof `strength` already relies on), and the per-site
obligation is the premise, discharged by the analysis the pass already declares. Adding all three would take the
verified share of local rewrites from 46.3 % to 100 % in O2 and from 36.3 % to 100 % in `speed`, at the cost of
three verifications and three premise checkers — not of 212 or 635 hand proofs.

## 6. Per project

Median local share (findings) is 25.0 % in O2 and 16.7 % in `speed`; 11 of 47 O2 projects with edits are above
50 % local, 4 of 49 in `speed`. The small teaching projects are value-rewrite heavy (`algebra`, `constants`,
`fixed-point`, `dead-code`), the program-shaped ones are not (`bytecode-vm` 3 local of 205 records, `chess-search`
138 of 764 in O2). The full table is the appendix.

## 7. What this means for programme A

The hypothesis programme A rests on — "most value edits are local rewrites, so a function's equivalence could be
assembled from per-rule proofs" — is **half true on this corpus, and the half that is false is the larger half**.

1. **Sampling cannot be retired by expression rules alone.** 80.5 % of O2's edit records and 89.8 % of `speed`'s
   are structural, and the instruction weight of content edits is 60 % structural in O2 and 89.6 % in `speed`.
   A per-rule proof covers the value rewrites; what it does not touch is motion, value numbering, copy
   propagation's statement half, dead-code removal, inlining, rotation, block merging and branch cleanup.
2. **The structural half is not shapeless.** It is a small number of *kinds* (eleven on the corpus: ten
   statement and control-flow kinds plus motion), each with a
   single obligation shape: motion and numbering need "the value is the same at the new position" (dominance,
   no intervening write, purity); dce needs "the local is dead and the value is pure"; copy propagation's
   removal needs the same single-definition fact its value half cites; inlining needs the callee's body and the
   argument binding to be equivalent; rotation needs the header copy to agree on the first pass. Programme A's
   unit should therefore be **the edit kind, with a premise discharged by the analysis the pass already
   declares** — the same shape as the three fact-guarded rules above — not the expression.
3. **The local rewrites are ready for that shape today.** Half already cite a table rule; the other half are
   three shapes with premises the passes already compute. The cheapest concrete next step is to make those
   three premise-carrying rules verified data (a small extension of `rules/form.ts`: a premise on a guard) and
   have `constprop`, `subst` and `strength` cite them, which would let an exact checker accept those edits
   without a sampled case.
4. **`other` is empty, and that is a finding about these 50 projects only.** Every replace on the corpus is
   either a table derivation or a cited fact shape; the classifier has a residual class precisely so that a new
   pass cannot hide there. A new pass or a changed rule table must be accompanied by a shape test, or the next
   run reports it.

**Limits of the measurement.**

- **The corpus, not the workload.** 50 small projects; Candela (332 functions, floats) is not measured here. The
  float side is separately limited: no rule table has an f32 root operator (IRWB-006), so the local share on
  float code would come only from the fact shapes.
- **"Local" is local in isolation.** A local rewrite is equal to the tree it replaces; whether the *use* of that
  tree in its context is equivalent is the context's premise, which this measurement does not check. That is the
  residual obligation programme A must name, and the reason a high local share would not by itself prove
  composition.
- **The classification trusts the pass's own matcher.** The derivation replays `compile.ts`'s `matchPat`,
  `guardHolds` and `numOf`, so "the table produces this tree" is exactly what the pass means by it. It establishes
  that the edit *is* a rule application, not independently that the rule is sound — that is what `RULE_EVIDENCE`
  is for, and why the report quotes it per rule.
- **The instruction weight is a touch measure** (§4): it counts instructions once per edit and includes
  bookkeeping edits whose instructions do not change. The content-only share is the defensible one.
- **The case count is small on purpose.** Pipelines were run with 1 case per function for the meaning check;
  probe `scripts/06` and `various/01-edit-census-count40.txt` show the edit lists and head revisions are identical
  to the default 40 (no pass is rejected on the corpus either way). The instruction weights use 10 cases per
  function, the same count as the workbench's `typed.metrics`.
- **`subst`'s convention matters.** Calling its replace half local and its remove half structural is a choice
  (§3.2 of the design). Calling the whole pair structural gives a local share of 17.0 % (O2) and 6.8 % (`speed`).

## 8. Framework changes

**None.** The classifier reads what the framework already records — `RevisionReport.edits` on the pass result, the
two artifacts, each value's `origin` with its `because` citations, the rule tables and `RULE_EVIDENCE`. No
framework file was modified. The new code is in the Typed domain (`src/typed/edit-classes.ts`) and its test
(`tests/typed/edit-classes.test.mjs`); the measurement scripts live in this ticket.

Two observations for later framework work, not changed here: `lowerToImage` costs about 1 ms per instruction
(3.3 s for chess-search's 3,369), which is what makes a per-revision instruction weight the dominant cost of the
measurement; and `Tx.rewrite` records one `replace` per statement field, so a field edited twice leaves records
whose intermediate trees exist only in the working store (the classifier groups them; a framework that recorded
the intermediate trees would remove the need).

## 9. Reproduction

```text
npm run build
node --test tests/typed/edit-classes.test.mjs
T=ttmp/2026/11/27/IRWB-035-D--*
node $T/scripts/05-measure-corpus.mjs --count 1 --weight-count 10 \
  --json $T/various/05-classification.json --markdown $T/various/05-tables.txt
node $T/scripts/07-report-figures.mjs --markdown $T/various/07-report-figures.txt
node $T/scripts/06-count-independence.mjs          # count 1 versus 40 on eight projects
node $T/scripts/01-edit-census.mjs --samples 2     # the count-40 census the classification agrees with
```

`scripts/02`–`scripts/04` are the probes the design was grounded in: the derivation of `replace` chains, the two
residual shapes that needed the recursive rule test (`(x/64)%64`, a constprop chain rewriting a definition), and
the instruction-weight prototype.

## Appendix: per project

| project | pipeline | local | structural | other | local inst. | structural inst. |
| --- | --- | --- | --- | --- | --- | --- |
| across-calls | O2 | 2 | 2 | 0 | 160 | 20 |
| across-calls | speed | 3 | 66 | 0 | 160 | 4,730 |
| algebra | O2 | 8 | 3 | 0 | 100 | 30 |
| algebra | speed | 8 | 3 | 0 | 100 | 30 |
| blend | O2 | 3 | 6 | 0 | 1,140 | 1,022 |
| blend | speed | 3 | 9 | 0 | 1,140 | 1,596 |
| bounds-lab | O2 | 4 | 36 | 0 | 894 | 10,041 |
| bounds-lab | speed | 7 | 51 | 0 | 2,391 | 13,033 |
| bounds-offset | O2 | 1 | 6 | 0 | 453 | 3,384 |
| bounds-offset | speed | 1 | 9 | 0 | 453 | 4,554 |
| bounds-param | O2 | 1 | 2 | 0 | 38 | 66 |
| bounds-param | speed | 1 | 5 | 0 | 38 | 194 |
| bounds-two | O2 | 1 | 12 | 0 | 234 | 2,886 |
| bounds-two | speed | 2 | 16 | 0 | 567 | 3,669 |
| branches | O2 | 1 | 11 | 0 | 8 | 74 |
| branches | speed | 1 | 11 | 0 | 8 | 74 |
| bytecode-vm | O2 | 3 | 202 | 0 | 64 | 8,300 |
| bytecode-vm | speed | 3 | 202 | 0 | 64 | 8,300 |
| call-chain | O2 | 1 | 0 | 0 | 30 | 0 |
| call-chain | speed | 7 | 128 | 0 | 240 | 6,610 |
| calls | O2 | 1 | 1 | 0 | 90 | 20 |
| calls | speed | 10 | 86 | 0 | 234 | 3,720 |
| checksum | O2 | 1 | 10 | 0 | 320 | 3,000 |
| checksum | speed | 2 | 14 | 0 | 920 | 4,072 |
| chess-search | O2 | 138 | 626 | 0 | 5,050 | 37,694 |
| chess-search | speed | 626 | 6,634 | 0 | 6,068 | 305,212 |
| collatz | O2 | 0 | 0 | 0 | 0 | 0 |
| collatz | speed | 0 | 3 | 0 | 0 | 1,028 |
| constants | O2 | 6 | 2 | 0 | 220 | 20 |
| constants | speed | 6 | 2 | 0 | 220 | 20 |
| dead-code | O2 | 5 | 19 | 0 | 50 | 220 |
| dead-code | speed | 5 | 19 | 0 | 50 | 220 |
| diagnostics | O2 | 2 | 1 | 0 | 30 | 10 |
| diagnostics | speed | 2 | 1 | 0 | 30 | 10 |
| distinct | O2 | 0 | 0 | 0 | 0 | 0 |
| distinct | speed | 3 | 52 | 0 | 30 | 1,040 |
| div-checks | O2 | 4 | 2 | 0 | 50 | 40 |
| div-checks | speed | 4 | 2 | 0 | 50 | 40 |
| div-magic | O2 | 2 | 0 | 0 | 172 | 0 |
| div-magic | speed | 2 | 3 | 0 | 172 | 88 |
| early-exit | O2 | 2 | 10 | 0 | 256 | 1,840 |
| early-exit | speed | 3 | 14 | 0 | 716 | 2,661 |
| f32-dsp | O2 | 22 | 60 | 0 | 855 | 3,054 |
| f32-dsp | speed | 24 | 105 | 0 | 1,438 | 10,799 |
| first-steps | O2 | 3 | 1 | 0 | 150 | 30 |
| first-steps | speed | 12 | 39 | 0 | 230 | 940 |
| fixed-point | O2 | 6 | 3 | 0 | 180 | 160 |
| fixed-point | speed | 15 | 40 | 0 | 260 | 790 |
| fragments | O2 | 3 | 6 | 0 | 1,140 | 1,022 |
| fragments | speed | 3 | 9 | 0 | 1,140 | 1,596 |
| gcd | O2 | 1 | 0 | 0 | 52 | 0 |
| gcd | speed | 1 | 3 | 0 | 52 | 168 |
| heat-lab | O2 | 1 | 12 | 0 | 302 | 68,934 |
| heat-lab | speed | 1 | 18 | 0 | 302 | 74,674 |
| histogram | O2 | 1 | 16 | 0 | 122 | 3,780 |
| histogram | speed | 2 | 20 | 0 | 635 | 4,177 |
| licm-nested | O2 | 2 | 7 | 0 | 14,014 | 105,088 |
| licm-nested | speed | 2 | 13 | 0 | 14,014 | 518,856 |
| licm-traps | O2 | 1 | 0 | 0 | 346 | 0 |
| licm-traps | speed | 1 | 3 | 0 | 346 | 1,354 |
| lz-roundtrip | O2 | 19 | 60 | 0 | 25,202 | 47,686 |
| lz-roundtrip | speed | 28 | 164 | 0 | 9,941 | 93,623 |
| match-enum | O2 | 0 | 6 | 0 | 0 | 28 |
| match-enum | speed | 0 | 6 | 0 | 0 | 28 |
| my-analysis | O2 | 2 | 10 | 0 | 381 | 39 |
| my-analysis | speed | 2 | 14 | 0 | 381 | 1,695 |
| my-first-pass | O2 | 2 | 5 | 0 | 50 | 40 |
| my-first-pass | speed | 2 | 5 | 0 | 50 | 40 |
| nested-loops | O2 | 2 | 3 | 0 | 26,479 | 77,682 |
| nested-loops | speed | 2 | 9 | 0 | 26,479 | 286,690 |
| orders | O2 | 16 | 20 | 0 | 1,379 | 678 |
| orders | speed | 16 | 23 | 0 | 1,379 | 1,174 |
| params-demo | O2 | 3 | 6 | 0 | 1,140 | 1,022 |
| params-demo | speed | 3 | 9 | 0 | 1,140 | 1,596 |
| pressure | O2 | 2 | 6 | 0 | 270 | 160 |
| pressure | speed | 2 | 6 | 0 | 270 | 160 |
| ramp | O2 | 3 | 11 | 0 | 805 | 3,454 |
| ramp | speed | 4 | 15 | 0 | 1,119 | 4,577 |
| records | O2 | 0 | 0 | 0 | 0 | 0 |
| records | speed | 0 | 0 | 0 | 0 | 0 |
| regalloc-lab | O2 | 2 | 6 | 0 | 83 | 226 |
| regalloc-lab | speed | 4 | 29 | 0 | 279 | 2,902 |
| regex-nfa | O2 | 16 | 236 | 0 | 3,402 | 539,409 |
| regex-nfa | speed | 18 | 270 | 0 | 3,408 | 554,394 |
| sha-chacha | O2 | 83 | 123 | 0 | 12,195 | 70,392 |
| sha-chacha | speed | 116 | 425 | 0 | 49,789 | 2,776,366 |
| sort | O2 | 1 | 12 | 0 | 302 | 68,934 |
| sort | speed | 1 | 18 | 0 | 302 | 74,674 |
| start-here | O2 | 4 | 13 | 0 | 965 | 2,354 |
| start-here | speed | 16 | 73 | 0 | 2,147 | 14,784 |
| strength | O2 | 4 | 10 | 0 | 758 | 2,250 |
| strength | speed | 5 | 14 | 0 | 1,358 | 3,322 |
| strings | O2 | 2 | 22 | 0 | 524 | 3,872 |
| strings | speed | 4 | 30 | 0 | 1,250 | 5,610 |
| ui-gallery | O2 | 6 | 5 | 0 | 228 | 142 |
| ui-gallery | speed | 11 | 26 | 0 | 228 | 700 |
| value-numbering | O2 | 1 | 3 | 0 | 1,329 | 14,509 |
| value-numbering | speed | 1 | 6 | 0 | 1,329 | 19,793 |
| wrong-shift | O2 | 1 | 10 | 0 | 320 | 3,450 |
| wrong-shift | speed | 2 | 14 | 0 | 1,070 | 4,522 |
