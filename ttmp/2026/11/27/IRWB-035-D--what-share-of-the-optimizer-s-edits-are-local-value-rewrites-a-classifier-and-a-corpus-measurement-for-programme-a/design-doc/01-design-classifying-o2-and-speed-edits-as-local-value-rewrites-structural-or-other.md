---
Title: 'Design: classifying O2 and speed edits as local value rewrites, structural, or other'
Ticket: IRWB-035-D
Status: active
Topics:
    - compiler
    - ir
    - verification
    - measurement
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/tx.ts
      Note: the edit records (Edit) a pass application leaves, and the kinds they name
    - Path: repo://src/typed/passes.ts
      Note: PIPELINES (O2, speed), RevisionReport.edits, revisionCorrespondence, typedPass
    - Path: repo://src/typed/rules/compile.ts
      Note: matchPat, guardHolds, numOf, evalOp - the matcher a derivation replays
    - Path: repo://src/typed/rules/fold.ts
      Note: FOLD_RULES, the table fold is one call to
    - Path: repo://src/typed/rules/simplify.ts
      Note: SIMPLIFY_RULES, the table simplify is one call to
    - Path: repo://src/typed/rules/evidence.ts
      Note: RULE_EVIDENCE, the recorded strength of every rule
    - Path: repo://src/typed/backend/index.ts
      Note: lowerToImage and runImage(counts) for the instruction weighting
    - Path: repo://src/typed/evaluate.ts
      Note: casesFrom, the seeded case generator the workbench's instruction metric uses
ExternalSources: []
Summary: 'A classifier for every edit O2 and speed make on the corpus: definitions of local rewrite, structural and other, a decision procedure that re-derives a value replacement from the before revision with the pass rule tables or a cited fact-guarded rule shape, the instruction weighting, the verified-rule coverage measurement, the tool API and its test, alternatives rejected, and the limits of the numbers it will produce.'
LastUpdated: 2026-11-27T11:00:00-05:00
WhatFor: The definitions and method IRWB-035-D implements and measures; the contract the classifier tool keeps for later stages.
WhenToUse: Before rerunning or extending the edit classifier, changing what counts as a local rewrite, or quoting the shares in the report.
---

# Design: what share of the optimizer's edits are local value rewrites?

Research programme A (`ttmp/2026/11/26/IRWB-006--*`, `IRWB-008--*`, `IRWB-010--*`) is conditional on a
measurement nobody has made. IRWB-008 measured that *all* 1,232 edits `simplify` and `fold` made on the corpus
could be re-derived from the before-tree and the rule tables, and that those edits are 59.8 % of the
expression-level edits but only 18.6 % of all edits. That number was a side observation in a guide about a
different design. This ticket asks the question directly, for the two pipelines that matter, with a definition
precise enough that another stage can rerun it: **of the edits O2 and `speed` make on the corpus, which are a
value replaced by an equal one, which are structural, and which are neither — by edit count, by the instructions
they affect, and (for the local ones) how much of that already rests on a verified rule?**

The answer decides how much of a function's equivalence could be assembled from per-rule proofs instead of a
sampled meaning check, and it decides where the remaining proof obligation sits.

## 1. The supported input domain

The measurement is defined, and the tool promises results, only for these inputs:

- **Programs**: the corpus projects under `corpus/projects/` (50 directories, read through `tools/corpus.mjs`),
  every project ingested through `projectSource`/`ingestProject` and run from its own `r0`.
- **Pipelines**: the plans named `O2` and `speed` in `PIPELINES` (`src/typed/passes.ts:1055`), run with
  `runPipeline` under the default optimization contract. Both pipelines are run on every project, whatever the
  project's own `project.json` says; the pipeline name is part of every reported row.
- **Unit of classification**: one *edit record* — an entry of `RevisionReport.edits` (`src/typed/tx.ts:47`) — from
  one changed pass application. A pass application that changed nothing contributes no edits.
- **Unit of instruction weighting**: the RV32 image (`lowerToImage`) of the revision that pass application
  produced, or consumed for removals, and its per-instruction execution counts on the same generated cases the
  workbench's `typed.metrics` uses (`casesFrom` with `count: 10, seed: 7`, step limit `2e5`).

Everything outside this domain is out of scope: other pipelines (`O1`, `loops`, `O2+`, the search strategies),
Candela, the tensor domain, user passes (`USER_PASSES`), and programs that no corpus project contains. The tool
throws rather than guessing on a pass name it has no rule source or shape test for — a new pass must be
classified by extending the tool, not by falling through to a default.

## 2. What the framework already records

Two records exist for every pass application, and both are needed.

**The edit records** (`Edit`, `tx.ts:47`; written by `Tx.record` and the `Tx` methods) say *what was requested*:
`kind`, the function, and kind-specific fields. The kinds that occur on the corpus (measured, `various/`):

| kind | fields used here | written by |
| --- | --- | --- |
| `replace` | `stmt`, `field` (`value`/`cond`/`addr`), `from`, `to` | `fold`, `simplify`, `constprop`, `strength`, `licm`, `lvn`, `subst` |
| `remove` | `stmt`, `because` | `dce`, `subst`, `cfg`, `inline` |
| `insert` | `stmt`, `block`, `at` | `licm`, `lvn` |
| `move` | `stmt`, `from`, `to` | `cfg` |
| `retarget` | `stmt`, `field` (`to`/`then`/`else`), `from`, `to` | `cfg`, `licm` |
| `replaceStmt` | `from`, `to` | `cfg`, `bce`, `rotate` |
| `block`, `merge`, `unreachable` | `block`, `into` | `licm`, `cfg`, `bce`, `rotate`, `inline` |
| `local` | `local`, `name` | `licm`, `lvn`, `inline` |
| `inline` | `stmt`, `callee`, `block` | `inline` |

**The correspondence** (`revisionCorrespondence`, `passes.ts:117`, completed by `makeCorrespondence`) maps the
entities of the consumed revision to the entities of the produced one (`retained`, `removed`, `inserted`, or a
group with the `via` relation of the origin that made it). It is used here for a single purpose: an entity id is
stable unless a pass re-made it, so the *tree* a `replace` record names can be read from the before store
(`from`) and the after store (`to`). No correspondence entry is needed to read those trees; the correspondence
is what lets a later stage carry a finding forward, and the tool exposes it unchanged.

**Provenance** (`origin` on every value, statement, block and local, `model.ts:103`) is the third record and the
one that makes "cites a rule" checkable: every value a pass makes carries `origin[0] = { from, via, rev,
because, note }`. `via` names the pass; `because` names the entities or facts that justify the value; `note` is
the human text the rule table supplies.

## 3. Definitions

A **value-replacement edit** is an edit record of kind `replace`, read as: the statement `stmt`'s field `field`
held the tree rooted at `from` in the consumed revision, and holds the tree rooted at `to` in the produced one.

The tree of a value id in a revision is `{op, imm, type, args}` from `Store.from(revision.value)`, recursively
(`type` absent means `i32`; comparing trees uses `(type ?? 'i32')`, otherwise a copy of an `i32` constant made by
`tx.const({type:'i32'})` would compare unequal to the constant it copies).

**One field change.** A statement field can be replaced more than once in one pass application (licm hoists two
operands of one expression; `Tx.rewrite` rebuilds a parent around each changed child). The intervening trees
exist only in the pass's working store, which no artifact holds. The classifier therefore groups the `replace`
records of one `(function, statement, field)` into one **chain** and classifies the pair *(first `from`, last
`to`)*. On the corpus there are 1,637 chains in 1,643 records; six fields are replaced twice. A chain whose first
`from` or last `to` is not in the corresponding revision is reported as `unexplained` (it never happens on the
corpus).

### 3.1 Local rewrite

A field change is a **local rewrite** when the produced tree is obtained from the consumed tree by rewriting
value nodes in place, and every rewrite is *value-equal under a rule whose premises are about the replaced
subtree and the scalar facts the pass declares* — nothing about the shape of the function around it. Formally,
one of:

1. **Rule table.** Replaying the pass's rule table bottom-up over the consumed tree (children first, first
   matching rule per node, guards evaluated as `compile.ts` evaluates them) yields the produced tree
   structurally. This is the definition for `fold` (`FOLD_RULES`) and `simplify` (`SIMPLIFY_RULES`), the two
   passes whose whole body is `tableBody(rules)`.
2. **Fact-guarded rule shape.** Every position where the trees differ is one of the shapes below, and the made
   value's `origin.because` cites the premise the shape requires:

   | shape | equality rests on | citation checked |
   | --- | --- | --- |
   | `get l` → `const c` | all reaching definitions of `l` assign `c` (or `l` starts at 0) | a cited entity is a `set` of `l` whose value is `c`, in either revision, or a cited `local:` init note |
   | `div`/`rem` by `2^k` → `shr`/`and` | the dividend is non-negative | the made value cites `fact:ranges(...)`, and the operands are preserved (`shr` by `log2 k`, `and` with `k-1`) |
   | `get l` → tree `T` | `l`'s single definition is `l = T` and `l` is pure, read once, dead after | a `set` of `l` in either revision whose value is structurally `T` |

   The shape test is recursive: `((x / 64) % 64) → ((x >> 6) & 63)` is one `rem` rewrite over a `div`
   rewrite, and both are checked.

A definition of "equal" that used the meaning check instead — run both trees on generated inputs and compare —
was rejected: it is sampled, needs a harness per tree, and would classify a rewrite as local because it happened
to agree, which is precisely the property programme A wants to stop relying on.

### 3.2 Structural

A field change is **structural** when the produced tree is not the consumed tree rewritten in place by a
value-equal rule, and the difference is a reference to an entity this same application created or destroyed:
`licm` replacing a loop-invariant subexpression by a read of the preheader local it just inserted (`get inv`),
`lvn` replacing the second of two equal expressions by a read of the `vn` local it just inserted, or `inline`
replacing a call by the callee's body.

Every edit record that is not a `replace` is **structural**: `remove` (dead code, a substituted copy, an inlined
call), `insert` (a hoisted assignment), `move` and `merge` (block merging), `retarget` and `replaceStmt` (branch
cleanup, bounds-check elimination, rotation), `block`, `unreachable`, `local`, `inline`, `removeFn`. These are the
edits whose justification is a fact about the control-flow graph or about statements other than the edited one:
control flow, loop-invariant motion, value numbering, inlining, rotation, and the statement-level half of copy
propagation.

Note that `subst` writes both kinds: its `replace` of `get l` by the definition's tree is a local rewrite (shape
3), and its `remove` of the now-dead `l = T` is structural. Classifying the pair as one thing would hide the
distinction the question is about.

### 3.3 Other

**Other** is the residual: a field change that is neither derived from a rule table, nor a cited fact shape, nor
a reference to an entity this application made. `unexplained` chains (endpoint absent) and `rebuilt, same tree`
(no structural change) also land here. On the corpus the expected value is zero; the class exists so that a new
pass, or a change to a pass, shows up as a defect to inspect instead of being silently counted as structural.

## 4. The decision procedure

For each changed pass application (both revisions available) and each `replace` chain:

1. Read the consumed tree and the produced tree. If they are structurally equal → `other: rebuilt, same tree`.
2. If the pass has a rule table, replay it (`derive`) and compare structurally. Equal → `local / rule-table`,
   recording the names of the rules that fired.
3. Else if the pass has a fact-shape test, run it recursively. Every differing position explained → `local /
   fact`, recording the shape names.
4. Else if every differing position is a `get` of a local whose `madeBy` is this pass and whose index is beyond
   the consumed revision's locals (i.e. made by this application) → `structural / motion-or-numbering`.
5. Else → `other`, recording the shapes of the unexplained positions.

Edit records of every other kind are `structural / <kind>` with no further test.

**Borderline decisions, stated once:**

- **Two-sided chains.** The pair compared is the chain's endpoints, so a field rewritten twice is one class, not
  two. This under-counts records relative to chains and is reported both ways.
- **`subst`.** Local (§3.2): `get l → T` is value-equal under the cited single definition. Counting it as
  structural would make the local share depend on whether a pass also removes the definition, which is a
  different question; the report gives both numbers.
- **`licm`, `lvn`.** Structural: the produced tree reads a local made in the same application, so the replacement
  is not equal by itself. Where a hoisted tree is itself a constant (`frame+0 → const` is not hoisted; `frame+252
  → inv` is), the chain still ends in a read of a made local.
- **`constprop` chains.** A statement's definition can be rewritten to a constant earlier in the same application
  and then read later; the citation check therefore accepts a defining `set` in either revision, and the earlier
  edit is classified (and counted) on its own.
- **`strength`.** Its rewrites cite `fact:ranges`, not a rule table. They are local — the premise is an interval
  fact about the dividend — and not covered by a verified rule; §6 says what rule would cover them.
- **`retarget` of a branch whose condition became constant** (`cfg`, `bce`): structural. The value edit that made
  the condition constant (if any) is classified separately as a local rewrite.
- **`unreachable`.** Bookkeeping emitted by `Tx.commit` for pruned blocks; structural, and it is reported
  separately so a reader can subtract it.

## 5. Instruction weighting

Edit counts weight a hot loop's rewrite and a cold one equally, so every class is also measured by the
instructions the edits affect.

For a changed pass application:

1. Lower the produced revision (`lowerToImage`) and, for removals, the consumed revision.
2. Run every function of that revision on its seeded cases (`casesFrom`, `count: 10, seed: 7`), accumulate
   per-instruction execution counts from `runImage(..., {counts: true})`.
3. For each edit, build the **affected entity set**: the produced value `to` and its subtree (`replace`); the
   statement and its value subtrees in the consumed revision (`remove`); the statement and its subtrees in the
   produced revision (`insert`, `move`, `retarget`); both statements (`replaceStmt`); the block (`block`,
   `merge`, `unreachable`); nothing (`local`, `inline`); nothing (`removeFn`).
4. The edit's **instruction weight** is the sum of the counts of the instructions whose `covers` intersect that
   set — each instruction counted once per edit, so a statement and the values inside it are not counted twice.

Two shares are reported. **Edit weight**: each class's sum of edit weights over all classes' sums. This counts an
instruction once per edit that touches it, so it measures how much executed code each class of edit *edits*; it
is not a partition of the program's instructions and does not have to sum to the final instruction count.
**Union weight**: for each class, the count of executed instructions of each revision touched by *any* edit of
that class, summed over revisions; the intersections between classes are reported so the reader can see how much
overlap there is. Lowering every changed revision is the dominant cost of the measurement (about 1 ms per
instruction: 3.3 s for chess-search's 3,369 instructions).

A cheaper alternative was to trace each edited entity forward through the correspondence to the final image and
weight it there. It was rejected: removals (dce, the structural half of subst, cfg merges) have no final entity,
so they would weigh zero exactly for the class where they are most common.

## 6. Verified-rule coverage

A local rewrite **cites a verified rule** when it is derived by shape 1: the rule that fired is in `FOLD_RULES` or
`SIMPLIFY_RULES` and has a `RULE_EVIDENCE` record (`src/typed/rules/evidence.ts`) whose `verdict` is `sound`; the
report also gives the weakest `strength` among the rules a rewrite used (`proof`, `exhaustive`,
`reduced-width+argument`, `by-construction`, or `sampled`).

Local rewrites of shape 2 are not covered, and the report names the rule each shape would need. Such a rule is a
*rule with a premise*: the shape is verified once for every value of its variables under the premise (for
`x / 2^k` with `x ≥ 0` the premise makes the symbolic proof the same one `strength` relies on at each site), and
the per-site obligation is the premise, discharged by the pass's declared analysis. The measurement counts the
chains in each shape, so the report can say which added rule would raise coverage most.

## 7. The tool

A new module `src/typed/edit-classes.ts`, exported for other code and covered by
`tests/typed/edit-classes.test.mjs`:

```ts
export type EditClass = 'local' | 'structural' | 'other';
export interface ClassifiedEdit {
  readonly cls: EditClass;
  readonly kind: string;          // the edit kind, or 'replace' for a chain
  readonly pass: string;
  readonly fn: string;
  /** Why: 'rule-table' (with `rules`), 'fact' (with `shapes`), 'motion', 'statement', or 'unexplained'. */
  readonly how: string;
  readonly rules?: readonly string[];   // rule names that fired or shapes that matched
  readonly reason?: string;             // for 'other': the shapes that could not be explained
  readonly records: number;             // edit records the finding covers
}
export function classifyPass(before: Artifact<TypedBlocks>, after: Artifact<TypedBlocks>,
  edits: readonly Edit[]): readonly ClassifiedEdit[];
export function classifySteps(steps: readonly PipelineStep[], options?): Classification;
```

`classifyPass` is pure over the two revisions and the edit records: it reads no analysis, no contract and no
clock, so a call is reproducible from the artifacts alone. `classifySteps` adds the instruction weighting for a
pipeline run. The rule replay is `compile.ts`'s own `matchPat`/`guardHolds`/`numOf`, so "the table produces this
tree" means exactly what the pass means by it.

The tool deliberately does **not** re-implement the passes or the rules: a rule added to a table is picked up by
the classifier automatically, and a rule removed from a table turns the edits that used it into `other`.

## 8. Framework changes

None are expected. The classifier needs the edit records (present on `PassResult.report`), the two artifacts
(present on `PassResult.before`/`.artifact`), provenance (present) and the rule tables (present). The ticket will
report any change that turns out to be needed as a primary result, with its reason.

## 9. Alternatives considered

- **Classify by pass name only** (`fold`/`simplify` local, everything else structural). Simplest, and wrong where
  it matters: `constprop`, `strength` and `subst` are value rewrites; `cfg` is not. Rejected.
- **Classify by the `note` text** the pass writes ("x*k = x<<log2 k", "hoisted out of bb"). Reproducible only
  until someone edits a note, and it cannot tell a verified rule from a hand-written one. Rejected.
- **Define a local rewrite as "the tree is smaller after"**. Makes `licm` local (it shrinks the loop body) and
  `fold` not local (a constant is not smaller than a two-node tree). Rejected.
- **Use the meaning check as the equality oracle.** Rejected in §3.1.
- **Trace edits forward to the final image** for the instruction weight. Rejected in §5.

## 10. What the numbers will and will not show

They will show the share of edits (and of executed instructions touched) that are value-local on this corpus,
per pass, per pipeline and per project, and how much of that rests on a rule with recorded evidence. They will
not show that a per-rule proof *composes* to a function-level proof: a local rewrite is equal in isolation, but
its use in a context needs the context's premises (dominance of the definition, purity, no intervening store),
which is the residual obligation programme A must name. The report states which structural edits carry such
obligations and how many there are — that count, not the local share alone, decides whether proof by rules can
replace sampling.

**Later** (not built here): a premise-carrying rule table with recorded evidence for constprop, subst and
strength; a regional-obligation checker that assembles per-rule proofs into a function-level one (IRWB-008's
contract version 3); the same classification for `O2+`, `loops` and the search strategies; Candela.
