---
Title: Corpus edit census report
Ticket: IRWB-035-A
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/edit-classification.ts
      Note: Callable classifier with statement footprint and rule evidence
    - Path: repo://tests/typed/edit-classification.test.mjs
      Note: Tests rule replay citations and structural attribution
    - Path: repo://ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/scripts/01-census.mjs
      Note: Runs the checked census and renders report tables
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:51:02.121545227-05:00
WhatFor: ""
WhenToUse: ""
---

# Corpus edit census report

O2 and `speed` used local rewrites for a minority of their recorded edits and affected Typed instructions.
They also used them for a minority of recorded value replacements, even after excluding structural value
replacements. Most of the strict local edits already match rules with evidence, but the two pipelines emit
zero verified-rule citations.

| Pipeline | Unit | Local | Structural | Other |
| --- | --- | ---: | ---: | ---: |
| O2 | Edits (2,021) | 203 (10.0%) | 1,413 (69.9%) | 405 (20.0%) |
| O2 | Affected statements (1,789) | 203 (11.3%) | 1,194 (66.7%) | 392 (21.9%) |
| speed | Edits (9,736) | 408 (4.2%) | 8,128 (83.5%) | 1,200 (12.3%) |
| speed | Affected statements (8,946) | 408 (4.6%) | 7,356 (82.2%) | 1,182 (13.2%) |

The complete [corpus tables](02-corpus-census-tables.md) include every project and configured pass, with edit
and instruction counts and shares, applications, rule shapes, and the attribution audit.

## Method

The census loaded all 50 projects with the repository's vendored loader and started each pipeline at the
project's r0. It ran the built-in sequences with `runPipeline`, using each project's input specs and entry
functions where present. The ordinary contract used its defaults of 40 cases per entry and seed 7. All 800
O2 and 1,050 speed pass applications ran, with zero contract rejections. No-op applications appear in the
pass table with zero edits. Each changed application contributes the edit log returned with its accepted
before and after artifacts and framework correspondence.

- **Local rewrite.** A `replace` record changes the `value`, `cond` or `addr` of a retained statement at the
  recorded endpoints. Replaying the fold or simplify table bottom-up reproduces the output field exactly
  by operator, type, immediate and ordered children, ignoring IDs and origins. One field may contain
  several rule firings, including children consumed by the parent rewrite. Strength reductions count if
  the field contains the recorded signed divide/remainder to shift/mask shape with a positive power-of-two
  divisor, the same numerator modulo nested rewrites, and a nonnegative range recorded at the new operator.
  The range is trusted as a premise for the census.
- **Structural.** Classify the records of `cfg`, `bce`, `licm`, `inline` and `rotate` together with any
  unreachable-block record as structural. That includes changes to flow targets, pruning, block merges,
  preheaders, cloning and changes to value fields that implement motion or inlining. An algebraic rewrite
  of a branch condition is local, while a separate branch replacement or removal is structural.
- **Other.** DCE drops work under liveness or effect conditions. Constant propagation needs agreement
  over reaching definitions. LVN introduces a shared definition across use sites, and substitution moves
  an expression from a separate assignment to its sole reader. The strict classification treats those
  inter-statement changes as other. The sensitivity calculation moves just the value replacement records
  for constprop, LVN and subst into local and keeps their support records in their original classes.

The edit denominator counts each log record once, including multiple edits to the same statement. The
instruction denominator counts static Typed statements. For each edit, resolve direct statement IDs,
owners of replaced values and related output statements through non-identity correspondence. A new block
contributes its output statements, a merged or pruned block contributes its input statements, and an
inline site includes setup statements whose correspondence originates at the call value. Deduplicate
statement IDs within a class and revision, counting a retained ID once and the old and new IDs of replaced
statements separately. Aggregate across revisions, so a statement affected in two passes counts twice.
There is no overlap between classes under the primary definition. In the sensitivity calculation there
are eight extra class–statement incidences in O2 and thirteen in speed, because a statement may be
associated with a replacement and its supporting edit.

The audit independently checked statement additions, removals, record changes and changes in owning block.
Every such ID appears in at least one footprint. Some records lack a statement endpoint, mainly local
declarations. The audit measures coverage of IDs and does not establish semantic equivalence or unique
causal attribution.

## Rule evidence and work that would raise coverage

| Pipeline | Explicit verified citations | Local edits reproduced entirely from rules with verified evidence | Local edits requiring a new rule shape |
| --- | ---: | ---: | ---: |
| O2 | 0/203 (0.0%) | 183/203 (90.1%) | 20 |
| speed | 0/408 (0.0%) | 362/408 (88.7%) | 46 |

A citation is a versioned `rule:<set>/<name>@<version>#<fingerprint prefix>` token on the edit's `rules`
or `because` list. Coverage of a table-matched edit requires every firing to have sound, non-sampled
evidence at the current version and fingerprint, and explicit coverage requires every fired rule to be
cited. The broader verified category preserves the evidence strength from IRWB-006. In O2 the weakest
strength per reproduced edit is symbolic proof for 71 edits, reduced-width enumeration plus a width
argument for 69 and by-construction for 43. In speed those counts are 174, 83 and 104, with one
exhaustively checked edit. Fold's by-construction evidence shares evaluator semantics. Read the
per-rule table as counts of edits containing a firing, which can overlap across rules.

1. **Emit evidence for rules already used.** Citation emission for the existing fold and simplify tables
   would cover the 183 and 362 reproduced edits. Among individual rules, prioritize `not-lt` (62 O2 and
   72 speed edits), `mul-pow2` (46 and 131) and `fold-shl` (19 and 54). Improving the comparison-inversion
   evidence from reduced-width plus argument to a direct proof would strengthen existing coverage.
2. **Prove the two guarded strength shapes.** Signed remainder by a positive power of two becomes an AND
   with its low-bit mask when the numerator is nonnegative. This shape appears in 13 of 20 remaining O2
   edits and 27 of 46 remaining speed edits. Signed division by a positive power of two becomes a right
   shift under the same premise, appearing in 10 and 22 edits. Three edits in each pipeline contain both
   shapes. Together the two shapes account for all 66 currently unmatched-by-table local edits. A proof
   at each site also needs a checked witness for the range premise.
3. **For broader coverage, check contextual premises.** Constant propagation offers 141 O2 and 258 speed
   more replacement records if a checker can establish unanimous reaching constants, including entry
   initialization. Forward substitution offers 51 and 331 with stability, purity, reaching-definition
   and single-use/liveness obligations. LVN offers 22 and 32 replacements with a shared-definition and
   operand-stability witness. The supporting statement and local edits remain separate proof obligations.

## Implications for programme A

Local rules cover 203 of 505 O2 value replacements (40.2%) and 408 of 1,138 speed value replacements
(35.9%). Excluding the structural value replacements gives 48.7% and 39.7%. Including the contextual
replacement shapes gives 82.6% and 90.4% of all value replacements, but only 20.6% and 10.6% of all edit
records. A rule-based layer can cover most strict local edits with the current fold and simplify evidence
and two additional arithmetic shapes. Covering most value replacements requires certificates that
connect expressions to facts from other statements. Function equivalence across the full pipeline also
requires evidence for control flow, inlining, motion, elimination and supporting edits.

The classifier reuses the production matcher and does not independently verify its implementation. The
census counts accepted static log records and revision-scoped statement IDs, so its shares do not
estimate dynamic RV32 hotness, runtime impact, proof cost, or meaning-check time saved. The two pipelines
can produce different amounts of IR and different logging granularity. Backend register allocation is
outside their Typed revision stream and neither sequence applies an unroll pass. These are corpus
results, with no extrapolation to larger external programs or arbitrary future strategies.

## Reproduction and framework impact

Run `npm run build`, then run [01-census.mjs](../scripts/01-census.mjs) with Node from the worktree.
It emits the tables by default. Use `--json` for every edit, rule match, statement footprint and the
final content hash per project and pipeline. The optional `--projects=blend,strength` selects a subset.
The library entry point is `classifyEdits(before, after, correspondence, edits)` in
[src/typed/edit-classification.ts](../../../../../../src/typed/edit-classification.ts).

No framework changes were needed. The pass result already provides adjacent artifacts, Typed edit
records and entity correspondence. The classifier reads them without changing optimizer output,
pass versions, provenance, meaning checks or the browser entry point.

The rule evidence definitions come from [IRWB-006](../../../25/IRWB-006--rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks/index.md).
[IRWB-008](../../../26/IRWB-008--exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-as-the-standard-for-new-pipelines/index.md) motivates the distinction between recorded citations and
re-derived edits. [IRWB-010](../../../26/IRWB-010--sketch-rewrite-search-on-ssa-and-verified-rules-rule-discovery-equality-saturation-a-window-superoptimizer/index.md) describes the scope of per-tree rewrite
search and the proofs it would need.
