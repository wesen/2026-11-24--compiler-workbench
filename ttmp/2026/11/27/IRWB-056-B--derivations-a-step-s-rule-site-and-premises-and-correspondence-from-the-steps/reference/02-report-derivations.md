---
Title: 'Derivations: a step''s rule, site and premises, and the correspondence computed from the steps'
Ticket: IRWB-056-B
Status: active
Topics:
    - framework
    - derivation
    - correspondence
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/framework/ir/derivation.ts
      Note: the step and derivation types, the site check, the correspondence from the steps, the coverage policy, the two locality queries
    - Path: src/framework/passes/define-pass.ts
      Note: NativeResult.derivation/coverage; prepareNative validates the steps and computes the correspondence from them
    - Path: src/framework/passes/transformation.ts
      Note: the derivation is carried next to the edits and the correspondence in the result
    - Path: src/typed/tx.ts
      Note: Tx records a step for every entity it makes, every removal, and every rule firing; edit records cite steps
    - Path: src/typed/rules/compile.ts
      Note: the rule is applied under Tx.withRule, with its guards and the operands its because names as premises
    - Path: src/typed/passes.ts
      Note: every typed pass returns a derivation; revisionCorrespondence stays as the reference the derivation is checked against
    - Path: src/tensor/passes.ts
      Note: Tix inline records which statement was merged into which (mergedInto)
    - Path: tests/framework/derivation.test.mjs
      Note: the type, the site check, the rejections, the merge, the two policies
    - Path: tests/typed/derivations.test.mjs
      Note: the corpus - equality with revisionCorrespondence, 0 -> 183 rule-citing records, 203 and 393 local edits
ExternalSources: []
Summary: "A derivation is the producer's own record of why a revision changed: one step per rewrite with its rule (or decision), site and premises. The correspondence is now computed from the steps, and it is entry-for-entry the one the domains computed before; 183 edit records cite a rule under O2 (0 before), the two locality policies answer 203 and 393 over the same records, and the corpus compiles in 0.99x the time."
WhatFor: "What derivations are, what they cost, and where they fall short"
WhenToUse: "Before extending a pass to record more, or before building step 9 (attribution and classification as queries) on these records"
LastUpdated: 2026-11-27T23:55:00-05:00
---

# Derivations (phase 4, concept K2)

## Result

A pass's edits say *what* changed. Since this step they also say *why*: every Typed pass returns a **derivation** — one
step per rewrite, naming the rule (or the pass-local decision) that licensed it, the entities it consumed and produced,
and the facts it relied on. The correspondence between the input and the output revision is computed **from the steps**,
not from the origins the transaction left behind, and it is entry for entry the correspondence the domains computed
before.

| check | before | after |
|---|---:|---:|
| O2 edit records that cite a verified rule | 0 | **183** (simplify 140, fold 43 — R3's number exactly) |
| derivation-computed vs `revisionCorrespondence` correspondence, O2 + `speed` | — | **equal on all 547 applications**, 10,622 edit records |
| A0's local-edit policy (`scoped`) over the O2 records | 203 | **203** |
| G's local-edit policy (`in-place`) over the same records | 395 | **393** (two fold edits, explained below) |
| O2 corpus, base build vs this build, interleaved best of 3 | 11,190 ms | 11,026 ms (**0.99x**) |
| Typed edit records under O2 (the census the baselines record) | 1,774 | 1,774 |

The baselines check prints `no differences`: RV32 images, instruction counts, the edit census, the CUDA sources and the
`optimizeTix` revisions are unchanged. The only fields the census gained are on the records themselves (`steps`), which
it does not read.

## The record

`src/framework/ir/derivation.ts`:

```
DerivationStep { by: {rule, table} | {decision}; consumes[]; produces[]; premises[]; relation; note? }
Derivation     { formatVersion: 1; label; steps[] }
```

- **`by`** is the verified rule that fired (with its table, so a step names `simplify/mul-pow2` and not just a rule two
  tables could share) or a pass-local decision id (`remove`, `rebuild`, `insert`, `inline.merge`, …). A rule's guards are
  recorded as `guard:`-prefixed premises; they are on the step and not on the correspondence entry, whose `because` stays
  what it was (`x * 0` reliances on its constant operands).
- **`consumes` / `produces`** are the site. The first consumed entity is the *antecedent*: the entity the step's products
  stand for in the correspondence. The rest is what it read (the operands the pattern matched). A step may name an entity
  an earlier step of the same derivation made — that is how a tree rebuilt bottom-up is recorded.
- **`relation`** is `modified | merged | split | inserted | removed | retained`. It is what the correspondence and the
  queries read; there is deliberately **no class field** (`local`/`structural`) on a step.
- The result carries it next to the edits and the correspondence (`PassResult.derivation`, `Revision.derivation`), and
  `NativeResult` takes either a derivation or explicit correspondence entries, never both: the correspondence has one
  source.

**How the correspondence is computed from the steps** (`correspondenceFromDerivation`). A correspondence is about
survival, so a step contributes an entry only when it makes an entity the output did not have; a `removed` step
contributes one only for a source entity the output no longer has. An entity a step carries — an input entity it
produced again (`x + 0` becomes `x`), or an output entity that already existed (Tix's inlined producer being merged into
its consumer) — keeps its own identity in the correspondence, and the step keeps the link. That is why the derived
correspondence equals the old one everywhere, and it is why Tix `inline` can now record `f/a → f/b` as `merged` without
changing what the correspondence says (R3's K2 recorded that `inline`'s entry said `removed`, "not only coarse but
wrong"; the link is now answerable with `mergedInto(derivation)` — see "Left out" for what is not yet true of
`whyEntity`).

Entries are grouped by antecedent and completed the way `makeCorrespondence` completes them (`retained`, `removed`,
`inserted`, `unmapped-origin`), and a group's notes are joined in the order of the entities they are about — that last
detail is what makes the equality exact rather than nearly so.

## Typed writes rule ids

`Tx` (src/typed/tx.ts) records a step for every entity it makes, every removal, and every rule firing:

- `rules/compile.ts` applies a rule under `tx.withRule({by, premises, site}, …)`. Premises are the guards that held
  (`guard:pure(v:…)`, `guard:pow2(v:…)`, `guard:boolean(v:…)`, `guard:noTrap(…)`) and the operands the rule's `because`
  names. Every entity the right-hand side makes becomes a step of that rule's; a rule that makes nothing records an
  in-place step whose site is the tree it matched and the operand it produced.
- `Tx.record` attaches the step indices to the edit record (`Edit.steps`), so one record announcing two firings
  (`(x * 1) + 0` is `mul-one` then `add-zero`) cites both. The 183 is the count of *records* citing at least one rule.
- The steps a pass's transactions recorded are filtered once, before the derivation is made: a step whose entities the
  published revision no longer has, and which no other step read, is dropped (a statement made and merged away leaves no
  trace; naming it would be naming an entity of neither revision). Edit records lose the citation to a dropped step and
  every other index is shifted.
- `makeInline` builds its own correspondence and passes no step list: that transaction records no steps at all, so no
  index points at nothing.

## Tix records merges

`src/tensor/passes.ts`: `inline` returns the merges it made (`f/a` substituted into `f/b`), and `inlinePass.prepare`
turns each into a `merged` step. `mergedInto(derivation)` answers "which statement was this one merged into".

## Classification stays a query

`locality(step, input, policy)` answers `local | structural | other`; nothing is stored. The two policies are R3's:

- **`scoped` (A0)**: the step needs nothing outside its site — every premise is a guard, a domain fact, or an entity it
  itself consumed. Under O2 it answers **203** (simplify 140 + fold 43 + strength 20).
- **`in-place` (G)**: the step needs nothing this application put into the program — the premises are the input
  revision's entities (plus what the producer only remade from them) or its own guard facts. It answers **393**:
  the same 203 plus constprop 141 and subst's 51 replacements, minus two.

The two-edit difference from IRWB-035-G's 395: two `fold` records fold a constant tree the *same application* computed
(`fold-add` on the product of `fold-shl`, on `constants` and `orders`). G's classifier counts them local because the
replacement reads no local the input lacks; the in-place policy counts them structural because the step's premise is a
value the application made. Both readings are in the test.

## The decision point: cost

Measured, and no local terms are stored on demand:

- `scripts/03-cost.mjs`: in this build, the corpus with the correspondence computed from the steps is 1.07x the same
  build with the correspondence computed from origins — and today's correspondence computation is 20.8 % of a run.
- `scripts/04-cost-before.sh`: the base commit (`ab23152`) built from its own sources beside this build, same process,
  interleaved, best of three each: **11,190 ms → 11,026 ms (0.99x)**.

The gate was "more than about 2x". Recording the steps and computing the correspondence from them costs nothing
measurable, because the derivation *replaces* the origin walk rather than adding to it.

## Alternatives, and why not

- **A `class` field on the step** (C's `relation`+`L15` returning `local|structural|other`, D's `class: rewrite|
  structural|bookkeeping`). Rejected by R3, and the two policies above show why: the same records answer 203 and 393, so a
  field would standardize one reading. Kept as a query.
- **A separate `site` field beside `consumes`/`produces`** (C's sketch). Not needed: the first consumed entity is the
  antecedent and the rest is the site it read. One list, one order, documented.
- **Keeping the correspondence in the domain and comparing it with the derived one at run time.** That would keep two
  computations alive in every application forever. Instead the domain no longer computes it, and the equality is a
  corpus test against `revisionCorrespondence`, which is kept as the reference (`tests/typed/derivations.test.mjs`).
  The brief asks for both computations, so both exist — one of them only in tests.
- **Deriving the correspondence from the steps with a `label` per step** instead of per derivation. Typed's entries have
  always named the pass as their relation (`simplify`, `licm`, `rotate`…); the label keeps that exactly.

## What is duplicated, or missing in the framework

- The coverage vocabulary (`partial | nonempty | source | target | both`) is redeclared in `ir/derivation.ts` as
  `DerivationCoverage`, because the manager's `CorrespondenceCoverage` lives in `contracts/types.ts` and the IR layer is
  below it, and `contracts/analysis-manager.ts` (out of scope here) holds the only implementation of the check. The
  framework should own one coverage check over `EntityCorrespondence` and both call it; built here because the
  alternative was importing upward or editing a file another step owns.
- The `guard:` premise convention is a framework-level idea (a fact the *producer's* guard checked, recorded on the step
  and not on the entry) stated only in a comment and in this report. If a second domain uses it, it belongs in the
  library's term theory ("a guard fact is a premise of the step, not a reason of the mapping") rather than in Typed's
  rule compiler.

## Left out (Later)

- **`whyEntity` does not consult derivations.** The link a merge records is in the derivation and answerable with
  `mergedInto`, but the why-tree still walks correspondences and therefore still stops at `f/a: removed`. Making the why
  query read a chain of derivations is step 9 (attribution and classification as queries), where the measure-pulling
  query lives too. One line each: `whyEntity(chain of derivations)`, `classify(derivation)` for the whole
  `local | structural | other` split (only the `local` half is answered here).
- **Individual rules are not attributed in the other passes.** The rule tables are the only producers that name a rule;
  `constprop`, `strength`, `subst`, `licm`, `lvn`, `cfg`, `bce` record decisions (`make`, `setField`, `remove`, …) and
  their premises. Giving each of them a rule vocabulary is "rules over a term signature", a phase-4 step of its own.
- **Tix records merges only.** `split-sum` and the schedule/fusion passes record no derivations; `optimizeTix`'s
  revisions carry the correspondence the two projections give.
- **`Derivation` is not persisted.** It travels in the result and in `Program`'s revisions; the store, the workbench's
  site and the JSON export do not carry it yet.
