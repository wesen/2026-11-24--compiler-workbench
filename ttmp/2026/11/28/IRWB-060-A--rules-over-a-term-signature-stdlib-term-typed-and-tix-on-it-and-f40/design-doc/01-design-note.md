---
Title: 'Design note: stdlib/term, Typed and Tix rules on it, and F40'
Ticket: IRWB-060-A
Status: active
Topics:
    - stdlib
    - typed
    - tensor
DocType: design-doc
Intent: short-term
Owners: []
RelatedFiles:
    - Path: src/typed/rules/compile.ts
      Note: Typed's matcher and table compiler; becomes an adapter over the library
    - Path: src/typed/rules/verify.ts
      Note: Typed's rule verifier; its evaluation campaigns move to the library interface
    - Path: src/tensor/passes.ts
      Note: Tix inline and split-sum; become rules over the Expr signature
    - Path: src/framework/ir/derivation.ts
      Note: F40 needs one branch here (stepEntries); documented scope exception
ExternalSources: []
Summary: "The design of the term library (src/stdlib/term), the two domain ports, and the F40 correspondence fix, written before the code."
LastUpdated: 2026-11-28T03:10:00-05:00
WhatFor: "Review the design before reading the implementation; the diary records what actually happened."
WhenToUse: "Reviewing IRWB-060-A."
---

# Design note

## 1. The library: `src/stdlib/term/`

Standard terms: **first-order rewriting over a signature**. A signature tells the library how to read a
domain's terms without knowing their types — the operator, the ordered children, and (optionally) the
constant value of a leaf. Everything else (guards, values of computed constants, building) the domain
supplies as callbacks; guards stay domain data (`Rule<G>`), because `pure` is a Typed fact and "used
exactly once" is a fact about a statement list.

Two modules:

- **`terms.ts`** — `Signature<T>` (`op`, `args`, `constant?`); `Pattern` (`var`, `const`, `constVar`,
  `same`, `op`); `Template<C>` (`var`, `const: C`, `op`), where `C` is the domain's description of a
  computed constant (Typed: a number, `{log2}`, `{eval}`; a plain number elsewhere);
  `match(sig, p, t, b, same)` (bindings: `Map<string, T>`); `firstMatch(index, sig, t, holds)` with rules
  indexed by root operator (`indexRules`) and tried in table order, guards passed `(g, b, t)` — the
  matched term is a legitimate object for a side condition (Tix's "exactly one axis, a `dim` extent");
  `instantiate(tpl, b, build)` with a `Build<T, C, B>` callback object (`ref`, `value`, `const`, `make`),
  children first, left to right — the order Typed's id allocation requires; `structuralHash`/`structuralEqual`
  with an optional `leaf` key (an immediate, a name) for constants beyond the signature's `constant`;
  and `patternVars`/`templateVars` (the well-formedness queries, shared with Typed's `form.ts`).

  Alternatives: (a) put `make` in the signature and let the library build — rejected: Typed builds
  through `Tx` (ids, provenance) and Tix through object literals, so building is a callback, not a
  signature method; (b) build on the framework's `ir/patterns.ts` engine — rejected: its unit of work is
  a projection transaction (the R3 review's own reason), and no compiler uses it.

- **`verify.ts`** — the rule-verification interface, Alive-style: a rule is validated by **evaluating
  both sides on generated cases**. The domain supplies a `CaseSemantics` (per-variable `domain`,
  crossing `values`, random `draw`; `holds`; `lhs`/`rhs`; `agree`); the library owns the campaigns and
  their order: `enumerateCases` (product of the domains, side conditions first, budget), `sampleCases`
  (cross the boundary sets — every combination while their product fits a cap, else the cap many random
  picks — then random draws), `exhaustiveCases` (the full-width enumeration with at most one unbounded
  variable as the inner loop), and the seeded `Rng` (moved from Typed verbatim, so Typed's re-run
  evidence cannot change). `verifyRule(sig, rule, interpretation, cases, options)` composes the
  structural check (every variable the template uses is bound by the pattern) with the campaigns and
  reports a verdict with a counterexample. The `w` parameter of a campaign is the domain's case-level
  parameter (Typed: the bit width; a toy domain ignores it).

## 2. Typed on it

`compile.ts` keeps `compileRules` (the visitor, the derivation steps, the id order) and delegates:
`matchPat` → library `match` over the `ValueHandle` signature (`op: h.op`, `args: h.args`,
`constant: h.isConst ? h.imm`), guards still Typed's (`guardHolds`), `instantiate` → library
`instantiate` with a `Build` that calls `tx.const`/`tx.make` with the rule's provenance at the root
only. Bindings become a `Map` (the library's container); `edit-classes.ts`'s two reads of a binding
adapt. `form.ts`'s `patternVars`/`templateVars` delegate to the library (same queries over the same
data). `verify.ts` keeps its proofs (structural effects/types, by-construction, symbolic-linear —
Typed semantics, not case campaigns) and runs its four evaluation campaigns (bitwise-w1,
exhaustive-w8, random-32/f32-special, exhaustive-32) through the library campaigns, supplying the
noTrap-only `holds`, `compileSide`'s evaluators as `lhs`/`rhs`, and outcome equality as `agree`. The
loops move verbatim, so case counts, counterexample bindings and strengths are unchanged.

## 3. Tix on it

A signature over `Expr`: `op` = `literal`, `shape`, `load:<name>`, the operator, `reduce:<op>`;
`args` = the operands, or the reduction's body; `constant` = a literal's number. `split-sum` becomes
a rule: pattern `reduce:sum(body)`, guard "exactly one axis, a `dim` extent" (reads the matched term),
template a **domain function** — the guide's allowance: the library knows nothing of binders, so index
substitution is the domain's. `inline` becomes a rule *instance* per producer: pattern
`load:<producer>`, template a domain function that substitutes the producer's expression with the
matched load's indices; the pointwise/single-use/not-the-result conditions are facts about the
statement list, checked by the driver (as the intern guide says), not guards of the term pattern.
Both passes keep their drivers (statement order, merge recording, `mapExpr` post-order), so revisions
are byte-identical.

**Tix rules are not verified by the library** — the meaning gate already checks every application on
generated tensors (`inline` exact, `split-sum within tolerance); `split-sum` is not an exact rule, so
a rule-level exact check is the wrong job for it, and a second checker for `inline` would duplicate
the gate. Said here as the guide's open question 3 requires.

## 4. F40

Today's `stepEntries` (framework) contributes an entry only for steps with fresh products or `removed`
steps, so a `merged` step (consumes `f/a`, produces the surviving `f/b`) maps nothing and the
completion says `removed`. The truthful entry — what IRWB-056-A produced — is
`{from: ['f/a'], to: ['f/b'], relation: 'merged'}`. **This cannot be recorded from
`src/tensor/passes.ts` alone**: the runner computes the correspondence from the derivation (a result
gives a derivation or explicit entries, never both), and the derivation's step is already truthful.
The missing piece is one branch in `stepEntries`: a `merged` step maps its antecedent to the entities
it produced (which the output already had), and the entry is named by the step's own relation. I make
that two-branch change in `src/framework/ir/derivation.ts`, a **documented exception to this lane's
file scope** (the brief's F40 deliverable requires it; F41 owns the file's coverage parts, and the
change is in `stepEntries`, not the coverage logic — flagged for the coordinator's merge). Two
framework tests that pinned the 056-B decision ("a merge records the link without changing the
correspondence") and the equality test in `tests/typed/derivations.test.mjs` are updated to the
truthful entry.

## 5. Decision point

Measure the library rule path against today's direct matcher on the O2 corpus, both interleaved in
one process (the machine is loaded): a probe compiles every corpus project through the O2 pipeline
alternately with the new `tableBody` (library path) and with a copy of today's direct matcher
(`tableBodyDirect`, probe-only), and reports the ratio. Threshold: about 10% of compile time. If the
library path is materially slower, Typed keeps its compiled visitor and only the matcher/verifier are
shared; the numbers are reported either way.

## 6. Out of scope, named

The remaining hand tree comparisons (`sameTree` in `mutate.ts` and `workbench/entities.ts`, the LVN
and LICM keys) are named by the brief as motivation but live outside this lane's file scope; the
library's `structuralEqual`/`structuralHash` are their destination. The framework rewrite engine
(`ir/patterns.ts`) is item 4.7.
