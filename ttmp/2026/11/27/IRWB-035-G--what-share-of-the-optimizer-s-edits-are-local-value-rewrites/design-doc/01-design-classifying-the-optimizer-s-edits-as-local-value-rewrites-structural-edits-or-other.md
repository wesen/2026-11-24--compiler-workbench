---
Title: 'Design: classifying the optimizer''s edits as local value rewrites, structural edits or other'
Ticket: IRWB-035-G
Status: active
Topics:
    - typed
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "How each edit record of a Typed pass application is classed as a local value rewrite, a structural edit or other, how instructions are attributed to edits, and what is measured on O2 and speed."
LastUpdated: 2026-11-27T10:08:22.697383265-05:00
WhatFor: ""
WhenToUse: ""
---

# Design: classifying the optimizer's edits as local value rewrites, structural edits or other

## Goal

Research programme A supposes that most value edits of the Typed optimizer are local rewrites, so that a function's equivalence could be assembled from per-rule proofs instead of the sampled meaning check. This stage measures that share for the `O2` and `speed` pipelines on the corpus, and leaves the classifier as a tool with a test.

## Supported input

The classifier takes one **pass application**: the `typed.blocks` revision before, the revision after, and the application's edit records (`Edit[]` of `src/typed/tx.ts`), exactly what a `Revision` of a `Program` holds. The edit kinds it knows are the ones `Tx` and `inline` record: `replace`, `retarget`, `replaceStmt`, `remove`, `insert`, `move`, `merge`, `block`, `local`, `unreachable`, `inline`, `note`. Any other kind is classed `other/unknown-kind`.

The measurement covers the 50 corpus projects under `O2` and `speed`, each run through `Program.pipeline` with the meaning gate on, so only accepted applications are counted. Probe `scripts/01-probe-edit-records.mjs` ran both pipelines on every project: no step was rejected, no project failed, and the run took 585 s on the shared machine (`various/01-probe-edit-records.txt`).

## What the records contain (probe 01)

- An edit record carries `pass`, `fn`, `kind`, and ids. It carries **no rule name**: a `simplify` edit does not say which rule fired. The `because` of a `replace` record is empty for every pass except `licm`; the justification is in the `origin` of the values the pass made.
- A `replace` record names the statement, the field (`value`, `cond`, `addr`), and the root ids of the tree before (`from`) and after (`to`). `from` is in the revision before for all but 3 of 1,138 `replace` records under `speed` (two `lvn`, one `licm`): those are the second link of a chain, where one pass replaced the same field twice and the intermediate tree is in neither revision.
- `inline` records one `inline` edit per call site, plus `local`, `block` and `remove` edits; the copied statements have no records of their own, but their `origin` names the call.
- An image instruction lists the entities it implements in `covers` (a value and its statement, or only the statement), so instructions can be attributed to entities.

## The classes

A class is decided from the records and the two revisions, never from the pass's name.

**Local rewrite.** A `replace` edit, where a statement keeps its place and one of its trees A becomes B, and B reads only locals the input revision defines: B reads no local the application created (`local` edit) and no local the application inserted a `set` for (`insert` edit). The claim "A equals B at this statement" is then a statement about the input revision alone, which is what a per-rule proof can discharge. Three reasons within the class:

| reason | condition |
|---|---|
| `local/rule` | B is A normalized by one verified table (`simplify` or `fold`), re-derived from the rule data |
| `local/fact` | not re-derived, and the new values of B carry a `because` (definitions, a range fact, an initial value) |
| `local/uncited` | not re-derived, no `because` |

**Structural.** An edit of the control-flow graph or of where a computation is placed: `block`, `retarget`, `replaceStmt`, `merge`, `move`, `unreachable`, `insert`, `local`, `inline`, the removal of a terminator, the removal of an inlined call's statement, and a `replace` whose B reads a local the application created or inserted a `set` for.

**Other.** The removal of a statement that is not a terminator, `note`, unknown kinds, and a `replace` whose trees are in neither revision.

A chain of `replace` edits on one statement field gets, for every member, the class of the net change (first `from`, last `to`).

Two rules were added after the first corpus run:

- The removal of a statement that is in neither revision is structural when a `replaceStmt` of the same application made that statement (it is then a terminator the application made and merged away), otherwise `other/unresolved`. One `cfg` application on `dead-code` does this.
- Re-derivation tries the table named after the pass first. Two `fold` edits on `chess-search` are instances of both tables (`0 * k + 0` with constant `k`), and were counted for `simplify` before.

### Borderline cases and how they are decided

| case | decision | reason |
|---|---|---|
| `constprop`: `get x` becomes a constant | local, reason `fact` | The tree changes in place and the claim is about the input revision. It needs a reaching-definitions fact, so it is reported apart from `local/rule`; every table gives the local share with and without it. |
| `strength`: `x / 2^k` becomes `x >> k` | local, reason `fact` | Same: a rule with a range hypothesis. |
| `subst`: `get t` becomes the tree `t` was assigned | the `replace` is local (`fact`), the removal of `t = …` is other | The replacement is valid on the input revision by a reaching-definition fact and does not depend on the removal; the removal is then a dead assignment. |
| `licm`, `lvn`: a tree becomes `get inv` | structural (`motion`) | B reads a local that does not exist in the input revision; the equality holds only together with the inserted `set`. |
| `cfg`: `br_if` on a constant becomes `br` | structural (`cfg/branch-on-constant`) | The brief puts control flow under structural. The reason names the shape, because it is rule-shaped and could have a proof of its own. |
| `bce`: a bounds check's branch becomes `br` | structural (`cfg/branch-by-fact`) | Control flow, justified by a dominating branch and a range. |
| `dce`: a dead `set` goes | other (`dead-statement`) | Not a value replaced by an equal one and not control flow. |
| register allocation | not measured | The backend records no edits; it is outside the pipelines' revisions. |

Alternative considered: a table from (pass, edit kind) to class. It is simpler (about 30 lines), and it would give the same classes for the built-in passes as far as I can predict. It was not chosen because it classifies nothing a user pass or a new pass does, and because it cannot answer the brief's last question (which edits *match* a rule without coming from a table). The test compares the two on the built-in passes.

## Re-derivation: does an edit match a verified rule

For a `replace` that is not structural, the tree A is normalized bottom-up with one table at a time (operands first, then the first matching rule at the root, the result not revisited, as `Tx.rewrite` applies a compiled table) and compared with B structurally (operator, immediate, type, operands). The matcher and guards are the ones in `src/typed/rules/compile.ts` (`firstMatch`, `numOf`), given a plain tree behind the part of the `ValueHandle` interface they read; only template instantiation into a tree is new code. IRWB-008's census script did this with a re-implemented matcher; using the compiler's own matcher keeps one matcher.

Alternative considered: have the rule-driven passes write the rule name into the edit record, and count citations. That would change the edit lists, which `tests/typed/rules.test.mjs` compares between the table-driven and hand-written passes, and it would still say nothing about edits of other passes. Re-derivation needs no change to any pass. Since no record names a rule today, "cites a verified rule" is reported as: made by a table-driven pass and re-derived by that pass's table; "matches" as: re-derived, whatever pass made it.

## Instructions an edit affects

Every revision of a run is lowered with `lowerToImage` (default options). An edit **claims** entities: the values and statements of the revision before that it removed, and those of the revision after that it added.

| kind | claims |
|---|---|
| `replace` | the subtrees where A and B part (walking both from the root while operator, immediate and type agree): their nodes absent from the other revision (a chain: its first edit) |
| `remove`, `replaceStmt`, `insert` | the statement and its trees, on the side(s) it exists |
| `unreachable` | the statements of the dropped block |
| `inline` | new entities of the function whose origin names the call |
| `retarget`, `move` | the statement itself, in the image after |
| `local`, `block`, `merge`, `note` | nothing |

An entity belongs to the first edit that claims it. An instruction counts once, for the edit owning the first entry of its `covers` that is claimed. The weight of an edit is its instructions in the image before plus its instructions in the image after. A `replace` deep in a tree makes every value above the change again (`Tx.rewrite`, "rebuilt around a changed argument"). Those values are listed apart as `rebuilt` and are not in the weight: their instructions compute what they did. `instructionWeights(…, { rebuilt: true })` counts them too, which gives an upper bound; the first corpus run counted them by default and gave value edits 9 instructions each for `constprop` (step 3 of the diary), which is the size of the surrounding expression, not of the edit. Not counted in either form: an instruction of an unchanged parent whose encoding changes because its operand did (`add` becoming `addi`).

This is a static count. The simplest alternative, counting entities of the diff, needs no lowering, but the brief asks for instructions and a folded constant often costs none.

## The tool, the test and the scripts

- `src/typed/edit-classes.ts`: `classifyApplication(app)`, `instructionWeights(classified, imageBefore, imageAfter)`, `rederive(a, b)`, `tallyInto`. No dependency on Node, so the workbench can call it.
- `tests/typed/edit-classes.test.mjs`: `rederive` on hand-made trees; the classes of each pass of `blend` under O2; on six corpus projects under `speed`, classes agree with the (pass, kind) table, every `simplify` and `fold` edit re-derives by its own table, and every changed value and statement is claimed or rebuilt; `div-to-shift` (no table, no `because`) is `local/uncited`.
- `scripts/02-classify-corpus.mjs` runs both pipelines once and writes every classified edit with its weight to JSON; `scripts/03-tables.mjs` makes the tables from the JSON, so the 10-minute run is not repeated per table.

One change outside the new file: `IMPURE` in `src/typed/analyses.ts` is exported, so the tree guard uses the same operator set as `isPure`.

## New approach tried

The brief's hypothesis is tested twice: with the strict reading (only `local/rule`) and with fact-conditional rewrites admitted. The report gives both, and for the edits no table re-derives it gives the shapes (`get -> #`, `div(_,#) -> shr(_,#)`, `get -> tree`) ranked by count, which is the list of rules that would raise coverage.

## Left out

- Dynamic (executed) instruction weights: needs per-instruction counts from the emulator.
- Candela: its O2 alone took 2 min 44 s in IRWB-008 on an idle machine; not run here.
- `O1`, `O2+`, `loops`: the brief names O2 and `speed`.

## Later

- Rule names in edit records (one line per table-driven edit), when a consumer needs them without re-deriving.
- A checker for fact-conditional rules (`get x -> c` under reaching definitions), as IRWB-008 section 18 sketches.
- Classes for backend choices (register allocation, coalescing), which have no edit records.
