---
Title: 'Final report A0: what share of the optimizer's edits are local value rewrites'
Ticket: IRWB-035-E
Status: active
Topics:
    - compiler
    - ir
    - measurement
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/edit-class.ts
      Note: the classifier tool, with re-derivation of rule-backed edits
    - Path: repo://tests/typed/edit-class.test.mjs
      Note: its test
    - Path: repo://ttmp/2026/11/27/IRWB-035-E--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/design-doc/01-design-edit-classification.md
      Note: the design this report measures against
    - Path: repo://ttmp/2026/11/27/IRWB-035-E--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/various/03-tables.txt
      Note: every table this report cites, in full
ExternalSources: []
Summary: 'Every edit of O2 and speed on the 50-project corpus, classified local/structural/other by edit count and by the instructions affected; the verified-rule coverage of the local rewrites; the three rule shapes that would cover all the rest; and what this means for assembling equivalence from per-rule proofs.'
LastUpdated: 2026-11-27T12:10:00-05:00
WhatFor: 'Programme A needed the premise of its hypothesis measured: how much of the optimizer's work is a small expression replaced by an equal one.'
WhenToUse: 'When deciding whether per-rule proofs can replace sampled meaning checks, and how much structural work any such scheme must still account for.'
---

# Final report A0: what share of the optimizer's edits are local value rewrites

Measured on the 50-project corpus (`corpus/projects/`), every edit record of every changed pass application of the
`O2` and `speed` pipelines (2,021 + 9,736 = 11,757 edits over 199 + 294 changed applications of 135 functions),
classified with
`src/typed/edit-class.ts` (the tool, with its test `tests/typed/edit-class.test.mjs`; census scripts
`scripts/01`–`03`, outputs in `various/`). The definitions are the design's (`design-doc/01`, §3); this report
gives the numbers, what they mean, and what they cannot.

## 1. Headline

Class shares, by edit count and by instruction weight (the instructions each edit owns in its after-image plus the
ones it drops from its before-image — design §4):

```text
pipeline   edits  local struct  other | weight  local struct  other
O2          2021   19.5   72.1   8.4 |   5599   48.1   48.5   3.4
speed       9736   10.2   84.1   5.6 |  20366   26.5   70.4   3.1
both       11757   11.8   82.1   6.1 |  25965   31.2   65.7   3.2
no-chess/O2  1257   20.4   68.4  11.1 |   3687   52.9   42.9   4.2
no-chess/speed 2476   15.0   76.1   8.9 |   6065   39.1   56.5   4.4
```

Three facts, and one artefact of the corpus:

- **Most edits are not local rewrites.** Structural edits are 72 % (O2) and 84 % (`speed`) of edit records.
  The largest single source is `cfg`'s branch plumbing (1,058 of O2's 2,021 edits; 4,234 of `speed`'s 9,736),
  followed by `inline` (3,165 on `speed`, none on O2).
- **Local rewrites are a much larger share of the code touched.** By instructions affected they are 48.1 % of
  O2's weight and 26.5 % of `speed`'s (39.1 % without chess-search): one `constprop` or `simplify` edit touches
  ~6–9 instructions, one `cfg` retarget ~2.
- **The `other` class is small everywhere:** 8.4 % / 5.6 % of edits, 3.4 % / 3.1 % of weight — entirely the dead
  statement removals of `dce` and `subst`.
- **chess-search dominates `speed`** (7,260 of its 9,736 edits; inlining there grows one caller past a thousand
  statements), which is why the no-chess rows are shown; O2's shares barely move without it.

**The premise the brief asks about, in its precise form:** "if most of the *value edits* are local rewrites".
Value edits are the `replace` records (one statement field's tree replaced): 505 on O2 and 1,138 on `speed`
(scripts 01 and 02 count the same edits identically). Of those, the local rewrites are 395 (78.2 %) on O2 and
997 (87.6 %) on `speed`; the rest are the motion bookkeeping of `licm` (88+109) and `lvn` (22+32). So the premise
holds, exactly as IRWB-008's smaller measurement suggested (its 59.8 % figure counted `constprop` and `strength`
out of a wider `replace` population; under this classification they are local rewrites too).

## 2. Per pass (both weightings; full table in `various/03-tables.txt`)

```text
O2, by edit count / by instruction weight:
pass         edits local struct other | weight  own   drop
cfg          1058    -   100     -   |  2091   983   1108
constprop     141  100     -     -   |  1272   643    629
simplify      140  100     -     -   |   505   248    257
dce           118    -     -   100   |   127     0    127
subst         102   50     -    50   |   616   296    320
licm          329    -   100     -   |   509   342    167
lvn            44    -   100     -   |    75    43     32
fold           43  100     -     -   |   240    81    159
strength       20  100     -     -   |   125    56     69
bce            26    -   100     -   |    39     0     39

speed, by edit count / by instruction weight:
pass         edits local struct other | weight  own   drop
cfg          4234    -   100     -   |  6553  3193   3360
inline       3165    -   100     -   |  6413  4241   2172
subst         662   50     -    50   |  2255  1042   1213
licm          422    -   100     -   |   579   394    185
rotate        281    -   100     -   |   647   404    243
simplify      258  100     -     -   |   956   468    488
constprop     258  100     -     -   |  1761   921    840
dce           216    -     -   100   |   230     0    230
fold          104  100     -     -   |   594   202    392
lvn            64    -   100     -   |   106    63     43
strength       46  100     -     -   |   233   103    130
bce            26    -   100     -   |    39     0     39
```

Every pass is class-pure except `subst` (the copy into the reader is local, the dead definition it leaves is
`other`), `dce` (`other`), and the passes that are pure structure. Per project, shares range from 0 % (collatz,
records: nothing changes) to 93.9 % local by weight (`constants`); the full per-project table for both pipelines
is in `various/03-tables.txt`, with image sizes (r0 → head; note `speed` grows chess-search's image from 3,369 to
6,364 instructions — it optimizes executed instructions, not size).

## 3. Verified-rule coverage of the local rewrites

Of the 1,392 local rewrites, every one carries a justification the classifier can name (`none` is empty
everywhere, so no drift):

| pipeline | local edits | verified rule (re-derived) | fact hypothesis | none |
|---|---:|---:|---:|---:|
| O2 | 395 | 183 (46.3 %) | 212 (53.7 %) | 0 |
| speed | 997 | 362 (36.3 %) | 635 (63.7 %) | 0 |

The rules fired (both pipelines, 545 rule-backed edits): `mul-pow2` 190, `not-lt` 134, `fold-shl` 73, `pow2-mul`
47, `fold-sub` 46, `fold-mul` 22, then the remaining simplify/fold rules at ≤ 10 each. By evidence strength, the
frequent `mul-pow2`/`pow2-mul` and `fold-*` firings are `proof`/`by-construction`; the comparison inversions
(`not-lt` and its seven siblings, 156 firings) are `reduced-width+argument` — IRWB-008's §13 warning that these
are the weakest floor of the rule-backed share is confirmed here.

**The rest is exactly three rule shapes** (the fact-backed column), which would take coverage to 100 % of local
rewrites — these are the shapes IRWB-008 §25 already proposed:

| rule shape | hypothesis to discharge | O2 | speed | both |
|---|---|---:|---:|---:|
| `get l → const c` (constprop) | every reaching definition of `l` assigns `c` (init 0 counts) | 141 | 258 | 399 |
| `get l → e` (subst's copy) | `l` has one definition, it assigns the pure tree `e`, and this is its only read | 51 | 331 | 382 |
| `x / 2^k → x >> k`, `x % 2^k → x & (2^k − 1)` (strength) | a range fact proves `x ≥ 0` | 20 | 46 | 66 |

Ordered by count, the constprop rule alone would raise rule coverage from 46.3 % to 82.0 % on O2 (36.3 % to 61.6 %
on `speed`); adding subst's copy rule reaches 94.9 % / 94.8 %; strength's finishes it. So no new *shape* is needed
for the local class: three rules with fact hypotheses, verified once, cover all of it.

## 4. What this means for programme A

Programme A's hypothesis was: *if most of the value edits are local rewrites, a function's equivalence could be
assembled from per-rule proofs instead of a sampled meaning check.* The measurements say:

1. **The premise holds, and the local class is already largely provable.** 78–88 % of value edits are local
   rewrites; 46 % / 36 % of them re-derive from the verified tables today (exactly, in milliseconds, by the
   classifier's independent matcher); with the three fact-hypothesis rules above, **all** local rewrites are
   per-rule provable. For these edits IRWB-008's design (the edit validator, the version 3 contract) applies
   unchanged.
2. **But the optimizer's edit mass is structural, and that decides the cost.** Assembling a whole *pipeline's*
   equivalence from per-rule proofs is not about the value edits — it is about `cfg`, `inline`, `licm` and
   `rotate`. The encouraging part is how few *argument shapes* that mass contains: constant/same-arm branches
   and jump threading (cfg's retargets), block merges, loop-invariant hoisting, tail-duplicated loop tests, and
   call-to-body inlining — each per-site and each with a small fixed proof (a branch target is not part of any
   value; a merge is a jump removal; rotation is tail duplication; inlining is a substitution at one site). The
   `other` class (dead statement removal, 6 % of edits) is likewise per-site: a liveness fact. Nothing in the
   census suggests a shape that resists a per-site argument; what resists is the *number* of sites, which is a
   cost question, not a coverage question.
3. **The instruction weighting changes the priority, not the conclusion.** By instructions affected, local
   rewrites are about half of O2's touched code, so exact-checking the local class first (IRWB-008 Phase 0)
   buys the largest single share of the gate's work per unit of proof infrastructure. The structural mass is
   many small edits (2 instructions each), so a per-site structural validator would amortize well only if its
   proofs are generic — which point 2 says they can be.

**Limits of the measurement.**

- Class membership is a claim about an edit's *shape* and *recorded justification*, not a proof of equality:
  the fact-backed rewrites and every structural edit were still accepted by the sampled meaning contract; only
  the 545 rule-backed edits carry verified equality (the rules', not the instances').
- The instruction weight is static and entity-id-based: a rule that returns an existing operand owns no
  instructions (it drops them instead); a hoisted expression's instructions are owned by its `insert` record;
  `local`, `block` and `merge` records have weight 0. Weight says how much machine code an edit touched, not how
  much it saved — for that, the image sizes are in the per-project table.
- Some published edit lists reference unpublished trees (lvn's chained replaces, licm's hoist-of-a-hoist): those
  cannot be re-derived from the revisions alone and are classified by what the application's own records prove
  (design §3.4). They are structural bookkeeping in every case measured; a pass that wanted its chained edits
  checked exactly would have to cite its rules (IRWB-008 §20).
- The census ran without the meaning contract (the gate is IRWB-008's subject, and its cost per pass is already
  measured there). The counts are deterministic functions of the code and the corpus; runtimes are not (the
  machine is shared; `speed` on chess-search alone took ~10 minutes under load).
- Candela and the other pipelines are not measured; IRWB-008's census says the kind mix is similar there but
  constprop-heavy, which would raise the local share.

## 5. Framework changes

None. The edit records, the rule tables with their recorded evidence, and the image's per-instruction `covers`
already carried everything the classifier and the census needed; the two surprises (chained replaces, licm's
self-referential replaces) were resolved inside the classifier's decision procedure, not by changing the
framework or the passes. `src/framework/` and `src/workbench/` are untouched (the site bundle check does not
apply).

## 6. The tool, for later stages

`classifyApplication({ pass, edits, before, after })` (src/typed/edit-class.ts) returns one class, a reproducible
reason, and — for local rewrites — the justification with fired rule names and evidence strength;
`rederive(before, after, from, to)` re-derives one value edit from the verified tables. Both are pure functions
of published data, share no code with the passes' matcher, and are tested in `tests/typed/edit-class.test.mjs`
(5 tests). To re-run the census: `node scripts/02-classify-corpus.mjs`, then `node scripts/03-tables.mjs`
(the per-project JSONs chain, so a partial re-run overwrites only its own projects).
