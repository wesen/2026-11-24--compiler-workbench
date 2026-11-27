---
Title: 'Design: what share of the optimizer's edits are local value rewrites (A0)'
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
      Note: the classifier tool this design specifies
    - Path: repo://src/typed/passes.ts
      Note: the passes and pipelines whose edits are classified (O2, speed)
    - Path: repo://src/typed/tx.ts
      Note: Edit records, the input to the classification
    - Path: repo://src/typed/rules/evidence.ts
      Note: the recorded rule evidence behind "cites a verified rule"
ExternalSources: []
Summary: 'Precise, reproducible definitions of local rewrite / structural / other for every edit record the O2 and speed pipelines make, the decision rules for the borderline cases, the two weightings (edit count, instructions affected), the classifier tool API and test, and the census scripts.'
LastUpdated: 2026-11-27T10:00:00-05:00
WhatFor: 'Programme A needs to know whether a function's equivalence could be assembled from per-rule proofs; that depends on how many of the optimizer's edits are small value rewrites.'
WhenToUse: 'Before changing the classifier, adding a pass whose edit kinds it must cover, or re-running the census.'
---

# Design: what share of the optimizer's edits are local value rewrites (A0)

## 1. The question and why it is open

Programme A's hypothesis (IRWB-002 agenda; IRWB-008 guide §15; IRWB-010) is that if most of the value edits O2 and
`speed` make are local rewrites — a small expression replaced by an equal one — then a function's equivalence
could be assembled from per-rule proofs (verified rules, IRWB-006) instead of the sampled meaning check.
IRWB-008 measured the part of this that was easy to count: `simplify` and `fold` edits are 18.6 % of all corpus
edits and 59.8 % of expression-level (`replace`) edits. Nobody has classified *all* edits into local versus
structural versus other, per pass, per pipeline, per project, and weighted by the machine instructions the edits
affect. This ticket does that, once, and leaves behind a tool so later stages can rerun it.

**Scope.** Every edit record of every pass application of the `O2` and `speed` pipelines on every project in
`corpus/projects/` (50 projects), run with `applyPass` and no contract (the meaning check decides nothing about
an edit's *shape*, and IRWB-008 already measured the gate separately). Not in scope: other pipelines (`O1`,
`O2+`, `loops`), Candela, dynamic (executed) instruction counts, and any change to how passes run.

## 2. The unit: an edit record

The framework already keeps the record this classification needs. Every change a Typed pass makes goes through a
`Tx` method, and every method appends an edit record (`Edit`, src/typed/tx.ts): `{ id, rev, pass, fn, kind, … }`.
The kinds that occur in O2 and `speed` (measured by this ticket's `scripts/01-edit-kinds-probe.mjs`):

| kind | meaning | made by, in O2/speed |
| --- | --- | --- |
| `replace` | one statement field (`value`, `cond`, `addr`) now holds a different tree | `fold`, `simplify`, `constprop`, `strength`, `subst`, `licm`, `lvn`, `inline` |
| `remove` | a statement was deleted (with a required `because`) | `dce`, `subst`, `cfg`, `inline` |
| `insert` | a statement was inserted at a position | `licm`, `lvn` |
| `local` | a local was created | `licm`, `lvn`, `inline` |
| `block` | a block was created | `licm`, `inline` |
| `retarget` | a branch target (`to`/`then`/`else`) changed | `cfg`, `licm` |
| `replaceStmt` | a whole statement was replaced (all are branches here) | `cfg`, `bce`, `rotate` |
| `move` | a statement moved to another block (a merge) | `cfg` |
| `merge` | a block was merged into its predecessor | `cfg` |
| `unreachable` | a block was pruned as unreachable | `cfg`, `licm` (via `Tx.commit`) |
| `inline` | a call site was replaced by the callee's body | `inline` |

One caveat the classification must respect: `Tx.set`/`Tx.stmt` create statements without an edit record of their
own; the records that name them are the enclosing `insert` (licm, lvn) or `inline` (whose copied statements have
no records at all). The edit list is therefore the framework's own account, and a change no record names belongs
to the record that caused it (`inline`). Classifying records, not unrecorded effects, is what makes the
classification reproducible from published data.

## 3. The classes

The classifier is a pure function of one pass application — the pass name, its edit records, the before-revision
and the after-revision (`TypedBlocks`) — and returns one class per edit. All four inputs are published data
(the edits and the pass name in `report`, the revisions on the timeline), so two implementations agree.

### 3.1 local (a value replaced by an equal one, citing or matching a rule)

An edit is a **local rewrite** when all of these hold:

1. its kind is `replace` and its field is `value`, `cond` or `addr`: one statement field's tree was replaced;
2. the statement (`edit.stmt`) exists in both revisions with the same operation — the edit changed a value, not
   a statement;
3. **the motion test:** no `get` in the new tree (rooted at `edit.to` in the after-revision) reads a local that
   this pass application created (the application's `local` edits, same function, resolved to indices through the
   after-revision's locals). A pass that moves or numbers code leaves behind a `get` of a local it just made;
   a pure value rewrite's new tree reads only locals that existed before.

The equality claim is *not* re-proved by the classifier; it is *labelled* by the strongest justification the
data names, in three kinds:

- `rule`: the edit re-derives from a verified rule table — `normalize(before-tree, table)` is structurally equal
  to the after-tree, with the independent matcher of IRWB-008 §12 (re-implemented here in `src/typed/edit-class.ts`,
  sharing only the rule data and the evaluator's `evalOp`). The fired rules' names and their recorded evidence
  strength (`src/typed/rules/evidence.ts`) are returned. These are the edits that "cite or match a verified rule".
- `fact`: the pass's recorded argument is a local hypothesis at that point — `constprop` (every reaching
  definition of the read assigns the same constant), `strength` (a range fact proves the dividend non-negative),
  `subst` (the read's single definition assigns this pure tree and this is its only read). These have rule shape
  with a fact hypothesis (IRWB-008 §25), but the hypothesis is not verified as a rule today.
- `none`: no justification the classifier can name (expected to be empty on O2/speed; counted to catch drift).

### 3.2 structural (control flow, loop-invariant motion, inlining, unrolling, register allocation)

An edit is **structural** when it changes the program's shape or the position of its code:

- branch structure: `retarget`, `replaceStmt` (every `replaceStmt` in O2/speed replaces a branch: cfg's constant
  branches and merged jumps, bce's eliminated checks, rotate's duplicated tests), `unreachable`, `merge`;
- the statement list of a block: `insert`, `move`, and the `remove` edits of `cfg` (a jump a merge absorbed) and
  `inline` (the call the body replaces);
- code motion and its bookkeeping: `local`, `block`, the `inline` record, and the `replace` edits that fail the
  motion test — `licm`'s hoisted reads, `lvn`'s numbered reads, `inline`'s rebuilt record-leaf reads.

Loop rotation is classified structural as the brief's "unrolling" neighbour; no pass performs register allocation
(the backend does, and the backend is not a pass), so that item of the brief's list produces no edits here.

### 3.3 other

Everything else. In O2 and `speed` these are the dead-statement removals of `dce` and `subst`: a statement is
deleted, no value is replaced, no control flow changes and nothing moves. The `because` of each names a per-site
fact (`fact:liveness`, the single reader), so these edits are per-site provable too — the report says what that
means for programme A even though they are not value rewrites.

### 3.4 Borderline decisions, and the alternatives

- **`lvn`'s `replace` edits are structural, not local.** `get(t)` *is* equal to the expression it replaces at that
  point, so an alternative reading counts them as local rewrites with a value-numbering hypothesis. They fail the
  motion test because the equality holds only through the `set t = e` the same application inserted at the first
  site: the computation of the second occurrence moves to the first site. That is intra-block code motion, the
  same shape as licm's loop-invariant motion with a shorter distance, and the brief names motion structural. The
  classifier records the reason; the report gives the alternative count (every `lvn` replace reclassified would
  move the local share by that many edits), so a reader who prefers the other reading has the number.
- **`dce`/`subst` removals are `other`, not structural.** The alternative folds them into structural as "changes
  the statement list". The brief's structural list names transformations that reposition or reconnect code; a
  removal deletes a statement whose value is unused, which is neither a value rewrite nor any listed
  transformation. Keeping them visible as `other` is the point of having the class: they are the third proof shape
  (a per-site liveness fact) and the report quantifies them separately.
- **`cfg`'s `remove` edits are structural, `dce`'s are not.** Both delete a statement. cfg deletes a jump so a
  merge can happen (control flow); dce deletes dead code. The record alone decides: the pass name is in every
  edit record.
- **`inline`'s unrecorded copies belong to its `inline` record**, which is structural; the whole point of
  inlining is structural.
- **A `replace` whose new tree is a rebuild around a changed child** (origin "rebuilt around a changed argument")
  is local when it passes the motion test: it changed one field's tree, nothing else. This is the common case for
  inner-node rule firings under `fold`/`simplify`.
- **`lvn` numbers one field twice.** Its first `replace` on a field can itself be replaced by its second, so one
  of the two trees exists only in the pass's working copy (neither revision publishes it). The motion test runs on
  the chain's *surviving* tree (the later edit's, which the after-revision holds); a chained replace that is not
  motion bookkeeping would be local with justification `none` — its before-tree is unpublished, so no re-derivation
  from published revisions can ever check it, which is exactly what the `none` count is for.
- **`bcm`** (bounds-check merging, in `PASSES` but not in O2/speed) would pass the motion test and be labelled
  `rule: none`: its equality argument is a whole-block group fact, not a rule. If it ever enters a measured
  pipeline, the `none` count will show it.

## 4. The two weightings

**By edit count.** Every edit record has weight 1. This is the classifier's direct output.

**By instructions affected.** Each pass application is sandwiched between two images: `I(k-1)` is the
before-revision lowered by the backend, `I(k)` the after-revision. The backend records, per instruction, the
typed.blocks ids it implements (`covers`: a value and its statement, `Rv32Image.insns[].covers`). Define per edit:

- **owned(E)**: the entities the edit brought into the program — for `replace`, the values in the after-tree of
  `edit.to` that are new at this application (made values, rebuilt parents, folded constants); for `replaceStmt`
  and `insert`, the new statement plus the new values in its trees; for `move`/`retarget`, the statement; for
  `inline`, the new entities of the caller not owned by another record of the same application (its unrecorded
  copied statements). The instructions owned by E are those of `I(k)` that cover an owned entity.
- **dropped(E)**: the entities the edit took away — for `replace`, the values of the before-tree of `edit.from`
  that are absent from the after-revision (the collapsed nodes; shared operands are not dropped); for `remove`,
  `replaceStmt`, `unreachable`, `retarget`, the statements (and their exclusive values) whose instructions
  disappear or change. The instructions dropped by E are those of `I(k-1)` that cover a dropped entity (for
  `retarget`, the branch statement on both sides: it changed, so it is counted once in `I(k-1)` and once as
  owned in `I(k)`).

The **instruction weight** of E is owned + dropped instructions. The instruction share of a class is its share
of the total weight. This measures how much machine code each class touched at all, on either side of the edit;
it is not a share of the final image (an edit whose result is later removed, e.g. a licm hoist that a later dce
deletes, still owns its instructions at its own step).

Reported alongside, not as the headline: the final image's size against r0's, so the reader sees the aggregate
effect the edits had.

**Limits, stated.** Ownership is by entity id, so a rule that returns an *existing* operand (`add-zero`) owns no
instructions (it drops some instead); a hoisted expression's instructions are owned by the licm `insert` (through
the statement id), not by the original computation's history; `local`/`block`/`merge` records own and drop
nothing (their weight is 0; they are bookkeeping of a motion that other records own). Removals of whole
functions (`dfe`, not in these pipelines) would need the same treatment as `unreachable`.

## 5. The tool

`src/typed/edit-class.ts` (new, `src/typed/`, no framework change):

```ts
export type EditClass = 'local' | 'structural' | 'other';
export interface LocalJustification {
  readonly kind: 'rule' | 'fact' | 'none';
  readonly ruleSet?: 'simplify' | 'fold';        // for 'rule'
  readonly rules?: readonly string[];            // fired, in firing order
  readonly strength?: string;                    // weakest recorded strength of the fired rules
  readonly fact?: string;                        // for 'fact': the pass's hypothesis, by pass name
}
export interface EditClassification {
  readonly cls: EditClass;
  readonly reason: string;                       // a reproducible why, e.g. 'motion: reads a local this application made'
  readonly local?: LocalJustification;           // when cls === 'local'
}
export interface PassApplication {
  readonly pass: string;
  readonly edits: readonly Edit[];
  readonly before: TypedBlocks;                  // the input revision
  readonly after: TypedBlocks;                   // the output revision (ignored when nothing changed)
}
/** Classify every edit of one pass application. Pure; no Tx, no pass code. */
export function classifyApplication(app: PassApplication): readonly EditClassification[];
/** Re-derive one value-field replace from the verified rule tables (IRWB-008 §12's matcher, independent of the passes). */
export function rederiveEdit(before: TypedBlocks, after: TypedBlocks, from: string, to: string):
  { ok: true; ruleSet: 'simplify' | 'fold'; rules: readonly string[]; strength: string } | { ok: false } | undefined;
```

`classifyApplication` never throws for a well-formed application; an edit it cannot place is `other` with a
reason, so drift is visible rather than fatal. The matcher for `rule` re-implements matching, guards and
instantiation over plain trees (about 60 lines, as in IRWB-008's script), sharing only the rule tables, the
recorded evidence and the evaluator's `evalOp` — not `compile.ts`'s compiled visitor and not `Tx`, so a bug in
the pass's matcher cannot hide in the classifier.

**Test.** `tests/typed/edit-class.test.mjs`: runs O2 on small corpus projects through `applyPass`, classifies
every application, and asserts the invariants: every edit classified; `fold`/`simplify` replaces are local with
`rule` justification and non-empty fired rules; `constprop`/`strength`/`subst` replaces are local with `fact`
justification and are *not* rule-derivable; `licm`/`lvn` replaces are structural by the motion test; `dce` and
`subst` removes are other; `cfg` retargets are structural; the counts sum. Plus a synthetic case: a `replace`
whose new tree reads a local the same application created is structural even for a pass named `fold`.

**Why a tool and not a script.** The brief requires later stages to rerun it (IRWB-008's Phase 0 validator will
classify an application's edits the same way; IRWB-010's certificate mode needs the same three-way split to know
what cannot be a certificate). The simplest alternative — a function inside the census script — would leave the
definitions untestable and unimportable; the tool costs one small module.

## 6. The census scripts

- `scripts/01-edit-kinds-probe.mjs` (already run): the observed edit kinds per pass on O2/speed — the ground
  the definitions above must cover.
- `scripts/02-classify-corpus.mjs`: for every project, runs `O2` and `speed` with `applyPass` (no contract),
  classifies every application, computes the instruction weights (§4) by lowering each changed revision once,
  and writes a JSON record (per project, pipeline, pass: edit counts by class, justification counts, fired rules,
  owned/dropped instruction counts) plus a summary to `various/`.
- `scripts/03-tables.mjs`: reads the JSON and prints the report tables (per pass, per pipeline, per project, both
  weightings, verified-rule coverage, and the rule shapes that would cover the rest).

`speed` on `chess-search` dominates the runtime (~3 minutes alone; inlining grows the caller past a thousand
statements and every later analysis walks it); the census runs in the background and is measured once.

## 7. What the numbers will say, and what they cannot

The report will state: the headline shares (local, structural, other) by edit count and by instruction weight,
for O2 and for `speed`, per pass and per project; the verified-rule share of the local rewrites; and the rules or
rule shapes that would raise it most (expected: the three fact-backed shapes — `get l → const c` under a
reaching-definitions hypothesis, `x / 2^k → x >> k` under a range hypothesis, and the single-use copy rule —
matching IRWB-008 §25's list). What the shares cannot say: class membership is a claim about the *shape* and the
*recorded justification* of an edit, not a proof of equality (the sampled meaning check still gates every
application); the instruction weighting is static (per revision lowered, not executed), and `chess-search`-scale
functions dominate it the way any static count would.

## 8. Framework changes

None expected. The edit records, the rule tables, the recorded evidence and the image's `covers` already carry
everything the classifier and the census need; if a probe contradicts that, the change and its reason will be
recorded as a primary result. `src/framework/` and `src/workbench/` are not touched, so the site bundle check
does not apply.

## 9. Later (out of scope here)

- The same census on Candela's O2 (needs the memory cap and a longer run).
- Classifying `O2+`, `loops`, `O2-sccp` (IRWB-008's census already counts their edits by kind).
- Dynamic instruction attribution (executed instructions per class, from the emulator's counts).
- Turning the fact-backed shapes into verified rules with fact hypotheses (IRWB-008 §25, Phase 5) — this ticket
  only names and counts them.
