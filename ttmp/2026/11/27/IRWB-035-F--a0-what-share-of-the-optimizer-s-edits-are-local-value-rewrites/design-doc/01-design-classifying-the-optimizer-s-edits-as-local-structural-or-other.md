---
Title: 'Design: classifying the optimizer''s edits as local, structural or other'
Ticket: IRWB-035-F
Status: active
Topics:
    - compiler
    - rewrite-rules
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:08:29.560333357-05:00
WhatFor: ""
WhenToUse: ""
---

# Design: classifying the optimizer's edits as local, structural or other

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->

## 1. The question and what this stage builds

Programme A (IRWB-006, IRWB-008, IRWB-010) would replace the sampled meaning check of a function by an argument assembled from per-rule proofs. That only pays if most of what the optimizer changes is a *local rewrite*: one value tree of a statement replaced by an equal one, where the equality is an instance of a rule. Nobody has measured the share. This stage builds:

1. `src/typed/edit-classes.ts`: a classifier, callable by other code, that takes one pass application (the input revision, the output revision, the pass name and its edit records) and returns one classified row per edit record; plus `classifyProgram(p)`, which classifies every revision a `Program` holds, and the instruction weights of each edit.
2. `tools/edit-classes.mjs`: runs O2 and `speed` on every corpus project through `Program.pipeline` (the gated path the workbench uses) and prints the tables (per pass, per pipeline, per project, per function) and writes them as JSON.
3. `tests/typed/edit-classes.test.mjs`: the classifier's test.
4. The report in this ticket with the tables and their reading for programme A.

No framework change is planned: the edit records (`RevisionReport.edits`, one record per `Tx` operation), the two revisions, the value origins and the image's `covers` carry everything the classifier needs (section 6 lists the one missing piece, rule citations, as a proposal).

## 2. Supported input domain

- Programs: the corpus projects in `corpus/projects/` whose ingest status is `ok`, opened with `Program.fromProject`.
- Pipelines: `O2` and `speed` exactly as `PIPELINES` in `src/typed/passes.ts` defines them, applied by `Program.pipeline` with its default gate (`optimizationContract`, 40 cases, seed 7). A step the gate rejects publishes nothing and has no edits to classify.
- Edits: the records of `RevisionReport.edits` of each published revision. The edit kinds that occur are those `Tx` writes (`replace`, `retarget`, `replaceStmt`, `remove`, `insert`, `move`, `local`, `block`, `unreachable`, the `merge` record of `cfg`) and `inline`'s `inline` record; `classifyApplication` accepts any record and puts an unknown kind in *other* (rule D5).
- Weights: images lowered with the default backend options (`lowerToImage(art)`), the way `typed.metrics` lowers them.

Register allocation is in the backend, after the pipeline: it makes no `typed.blocks` edit, so it is not in the edit stream and the tables cannot show it. The classifier has a structural class for it only in the sense that nothing it sees is register allocation; the report says so.

## 3. The classes

The unit is one edit record. For a `replace` record (a statement field `value`, `cond` or `addr` set to a new tree), `T` is the tree rooted at `edit.from` in the input revision and `T'` the tree rooted at `edit.to` in the output revision.

**Windows.** `windows(T, T')` is empty when the trees are structurally equal (op, imm, type, operands); when the roots agree in op, imm, type and arity it is the concatenation of the windows of the operand pairs; otherwise it is `[(T, T')]`. A window is the smallest subtree pair the edit changed.

The rules, tried in order; the first that applies decides:

| rule | applies to | class | sub-class |
| --- | --- | --- | --- |
| D1 | any record of an application of `inline`, `rotate` or `licm` | structural | `inline`, `rotate` (header duplication, the only unrolling the pipelines do), `licm` |
| D2 | `retarget`, `block`, `unreachable`, `merge`, `move`; `replaceStmt`, `remove` or `insert` of a terminator (`br`, `br_if`, `return`, `trap`, old or new statement) | structural | `control-flow` |
| D3a | `replace` whose `T'` reads a local the input revision's function does not have, or contains a new value whose origin `because` names a statement the same application removes or inserts | other | `coupled` (part of a multi-statement transformation: `lvn`, `subst`) |
| D3b | `replace` with `normalize(T, R) = T'` for a verified rule table `R` (`simplify`, then `fold`; a table's evidence must exist in `RULE_EVIDENCE` for every rule that fired) | local | `verified`, with the rules that fired |
| D3c | `replace` all of whose windows match a shape of the fact-guarded catalog below, with the guard's fact cited in the new value's origin `because` | local | `fact-guarded`, with the shapes |
| D3d | any other `replace` | other | `unmatched-value` (a value replacement no rule explains), with its window shapes |
| D4 | `remove` of a non-terminator | other | `remove` (dead code, a substituted definition) |
| D5 | anything else (`insert`, `local`, `replaceStmt` of non-terminators, unknown kinds) | other | the kind |

`normalize(T, R)` is IRWB-008's re-derivation: bottom-up, at each node the first rule of `R` indexed by the node's operator whose pattern matches and whose guards hold replaces the node, and the replacement is not revisited (as in `Tx.rewrite`). The classifier reuses `firstMatch`/`indexRules` of `src/typed/rules/compile.ts` on a read-only tree, so it is the same matcher that the passes compile from the tables, not a second one; IRWB-008's independent re-implementation already showed both agree on all 394 corpus edits.

**Fact-guarded catalog** (rules the passes apply but that are not in a verified table; their guard is an analysis fact):

| shape | window | guard, as cited |
| --- | --- | --- |
| `const-read` | `get(l) → const c` | every reaching definition of `l` assigns `c` (constprop: `because` names the definitions, or "starts at 0") |
| `div-pow2` | `div(x, 2^k) → shr(x, k)` | `x ≥ 0` (strength: `because` names a `fact:ranges` fact) |
| `rem-pow2` | `rem(x, 2^k) → and(x, 2^k − 1)` | `x ≥ 0`, as above |

The classifier matches the shape and the presence of the cited fact; it does not re-check the fact. The meaning contract and the analyses' own checks are what make the fact true; the class says what kind of argument an edit would need.

**Borderline cases, decided:**

- *A value replacement inside a structural transformation* (licm replacing an invariant subtree by a read of its hoisted local; inline replacing a call by a read of its result local) is structural (D1 before D3): it is valid only together with the statements the same transformation adds.
- *Common subexpressions and forward substitution* (`lvn`, `subst`) are other/coupled (D3a): each replacement reads a local or relies on a definition that the same application adds or removes, so it is not an equality of one tree. On an SSA view both would be single-tree rules; the report counts them as the largest candidates for that.
- *Bounds-check elimination* (`bce`) turns a `br_if` into a `br`: structural/control-flow (D2), although its justification is a fact, because it changes the control-flow graph.
- *Bounds-check merging* (`bcm`, not in O2 or speed) would be other/unmatched-value: `caddr(r, p) → add(r, shl(p, 1))` is equal only because another check of the block traps first.
- *Dead-code removal* (`dce`) is other (D4): removing a statement is not a value replacement.
- *Bookkeeping records* (`local`, `block`, `merge`, `inline`) are classified like the transformation they belong to (D1, D2, D5) and weigh no instructions (section 4).
- *Several rules in one tree:* one `replace` record per statement field, whatever the number of firings; the row lists every rule that fired.

## 4. Weights: the instructions the edits affect

Each edit has *sites*: statements of the input revision it changes or removes (`replace`, `retarget`, `move`, `remove`: `stmt`; `replaceStmt`: `from`; `unreachable`: the pruned block's statements), and, when it has none, statements of the output revision it adds (`insert`: `stmt`). `local`, `block`, `merge` and `inline` have no sites. Statements the output revision has, the input does not, and no edit names (inline copies a callee's body without `insert` records) are attributed to the application's first `inline` record in that function, so inlining weighs what it copies; the tool reports how much weight this rule attributes per pass, so an unexpected use shows.

Two weights per edit, computed from images lowered with the default options:

- **static**: the number of image instructions whose `covers` include a site, in the image of the revision the site belongs to;
- **executed**: the executions of those instructions over the seeded cases `typed.metrics` uses (`casesFrom` with 10 cases per function, seed 7, step limit 2·10^5, i.e. `measure`'s parameters, so the weight is in the unit the strategies optimize), through `heat`.

Prologue and epilogue instructions cover the function, not a statement, and weigh nothing. Two edits on the same statement in one application both count it (the weight is per edit, not a set union); the report gives edit counts next to weights so this is visible.

## 5. The tables

Per pipeline (O2, speed): edits and both weights by class and sub-class. Per pass (each pass name, summed over its positions in the pipeline). Per project. Per function: the number of changed functions whose every edit is local, and whose every edit is local/verified, since that is the unit at which programme A would replace the sampled check. Of the local rewrites: the share matched by a verified rule (D3b), the share that *cites* a rule in its record (zero today: no edit record names a rule, see section 6), the rule firings, and a ranking of the shapes of the remaining local rewrites and of the other value replacements (D3a, D3d) by edits and executed weight, as the rules that would raise the coverage most.

A shape key, for ranking, renders a window with every subtree that occurs on both sides replaced by a variable (`a`, `b`, … in order of first occurrence), constants as `#` and remaining reads as `get`.

## 6. Decisions and their simplest alternatives

- **Unit = edit record.** Alternative: the entity changes of the framework's diff (`changes.entities`), which IRWB-008 also counted. Rejected as the primary unit: a `replace` of a three-node tree is one edit but four or more entity changes, so diff counts weigh value edits by tree size and say nothing about which rule applied; the instruction weights already measure size in the unit that matters.
- **Classification by rules on records and trees, with pass names only in D1.** Simplest alternative: classify by pass name alone (fold, simplify, constprop, strength → local, …). It would give nearly the same O2 numbers, but it cannot tell whether an edit actually matches a rule, so it cannot measure verified coverage, and it would misclassify a pass that mixes edit kinds (cfg removes and moves statements; dce's records come in two shapes). D1 uses names for the three passes the brief itself names as structural, whose individual records (a `replace`, an `insert`) do not show that they belong to a motion or an inlining.
- **Matching by re-derivation instead of citations.** The edits carry no rule citation (IRWB-008 section 20 proposed `Tx.cite`; it was not built). Re-deriving with the same matcher is exact for the deterministic table passes (IRWB-008: 394 of 394). Proposed change, not built here: `compileRules(rules, firings, { cite: true })` and `Tx.cite`, so that a `replace` record lists `rules: [...]`; then D3b would read the citation and fall back to re-derivation for passes that do not cite. Listed under Later.
- **Weights from `covers` instead of image diffs.** Alternative: `diffImages(before, after)` per application gives the instructions that changed. Rejected: one application changes many statements of different classes, and a diff of images cannot be split per edit; `covers` attributes instructions to statements, and statements to edits.
- **Executed weight in addition to static.** The brief's "instructions" is, in this repository, executed instructions (the strategies' metric); static counts are kept because they need no cases and are what a size-oriented pipeline cares about. One lowering and one seeded run per revision; probe 01 measures the cost.

## 7. Validation

- The test runs O2 on corpus projects with known edits (`algebra`, `constants`, `value-numbering`, `strength`) and asserts: every edit gets exactly one class; simplify/fold edits are local/verified with the rule names; constprop's are local/fact-guarded `const-read`; strength's are `div-pow2`/`rem-pow2`; lvn and subst replacements are other/coupled; cfg's are structural; the classification of a revision is deterministic; the class counts sum to the edit count.
- On the whole corpus, the tool checks that every fold and simplify `replace` edit is D3b (IRWB-008's result, re-measured) and reports any that is not.

## 8. Left out

- Pipelines other than O2 and `speed` (the tool takes a pipeline list, so others are a flag away).
- Candela (IRWB-007/008 measured it separately); its project is not a corpus project with `project.json` in `corpus/projects/`.
- Re-checking the facts the fact-guarded rewrites cite (that is the question of a later stage, not of the share).
- Backend transformations (register allocation, coalescing, homes): not edits of `typed.blocks`.

## Later

- `Tx.cite` and a citing rule compiler, so that edit records name the rule they applied.
- Verified fact-guarded rules (`div-pow2`, `rem-pow2` with a range hypothesis; `const-read` with a reaching-definitions certificate).
- Classification on the SSA view (IRWB-006), where `lvn` and `subst` replacements become single-tree rewrites.
