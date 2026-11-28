---
Title: 'Design note: rules over a term signature (stdlib/term), Typed and Tix on it, and F40'
Ticket: IRWB-060-B
Status: active
Topics:
    - framework
    - compiler
    - stdlib
DocType: design
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The library module src/stdlib/term (signature, structural hash and equality, match/instantiate, rule index and first match, rule verification over generated cases) and its two domain ports: Typed's rule tables and verifier, Tix's inline and split-sum. Plus F40, the merged correspondence entry."
LastUpdated: 2026-11-28T02:05:00-05:00
WhatFor: "Read before the code of IRWB-060-B, and when reviewing it."
WhenToUse: "Onboarding a reviewer; explaining why the library has the shape it has."
---

# Design note: rules over a term signature

## Input domain

A **signature** is a finite, ordered, first-order alphabet given by a domain:

```ts
interface Signature<T> {
  op(t: T): string;                       // root operator; a domain may put attributes in the label
  args(t: T): readonly T[];               // ordered children
  constant?(t: T): number | string | undefined;  // the immediate, if t is a constant
}
```

Everything the library does is stated for terms that are finite trees over that signature: `op` returns a label
for every term, `args` returns the children in order, and `constant` (when the domain supplies one) answers for
constants and returns `undefined` for every other term. Nothing else is assumed: not that terms are hash-consed,
not that equal terms are identical objects, not that the signature is fixed. A domain whose terms carry binders
(Tix's `reduce`) or whose nodes are allocated in a transaction (Typed's value handles) supplies those through
the two hooks described below rather than by widening the signature.

## Decisions

### 1. The library holds matching, instantiation, a first-match rule index, and rule verification — not a traversal

`src/stdlib/term/` has four modules:

| File | Contents |
|---|---|
| `signature.ts` | `Signature`, `equalStructure`, `structuralHash`, `size` |
| `pattern.ts` | `Pattern`, `Template`, `Bindings`, `match`, `instantiate`, `patternVariables`, `patternOp`, `instantiate`'s `Builder` |
| `rules.ts` | `Rule`, `RuleIndex`, `indexRules`, `firstMatch`, `ruleText` |
| `verify.ts` | `verifyRule` over a case generator and a domain semantics; `RuleVerdict` with a counterexample |

**Simplest alternative that would serve the goal:** put Typed's `compile.ts` behind a thin generic wrapper and
leave everything else where it is. That falls short on two counts the brief names: Tix keeps two hand-written
tree walks with no matcher at all, and R3 counted four other hand-written structural comparisons. The module as
designed is the smallest thing two domains can both call.

**What is deliberately *not* in it: a traversal-driving rewrite strategy** (the "greedy bottom-up rewrite" of
term rewriting). Typed's traversal is `Tx.rewrite`: it rebuilds values bottom-up inside an edit transaction, and
that transaction is what allocates value ids and records the derivation steps. A library walker that called back
into the transaction would duplicate `Tx.rewrite`, not replace it. Tix's traversal is `mapExpr`, five lines, and
it is the domain's (it also decides where binders are). So the library's *rule strategy* is the part both
clients actually share: rules indexed by root operator and tried in table order with domain guards
(`indexRules`, `firstMatch`). A library `rewrite` would have exactly one client today, which the admission rule
in `src/stdlib/index.ts` does not admit. This is reported as the framework-shaped gap it is.

### 2. Two hooks keep the library free of domain types

- **`Builder<T>`** (`pattern.ts`) is the only way instantiation makes a node:
  `operator(op, args, attrs, outermost)` and `constant(value, attrs, outermost)`. `outermost` says whether the
  node being made is the template's root. Typed needs it: the outermost value of a rule's replacement carries the
  rule's provenance (`because`, `note`), the ones under it carry none. `attrs` is opaque domain data the template
  node carries (Typed puts `{ type: 'f32' }` on a constant; Tix puts nothing).
- **`Template.build`** is a template node that is a domain function `(bindings, node) => T`, for the two things a
  first-order template cannot say: a **binder** (Tix's `split-sum` builds two nested `reduce`s whose axis names
  and extents are not subtrees of the matched term) and a **substitution under a binder** (Tix's `inline`
  replaces the producer's indices on the way in). The standard name for this is a template with a
  substitution function; it is the domain's, and the library does not look inside it.

Equality during matching is a parameter (`match(sig, p, t, b, equal?)`), defaulting to the library's structural
equality. Typed passes `handle.same`, its own structural equality, because Typed's `sameTree` also compares a
value's type: the library must not silently widen or narrow what a `same(x)` pattern matches.

### 3. Typed keeps its tables, its transaction and its id order; only the matcher and the instantiator move

`src/typed/rules/compile.ts` keeps `compileRules`/`tableBody` (the `Tx.rewrite` visitor) and `guardHolds`,
`guardPremises`, `evalOp`, `numOf`, `noteOf` (all Typed facts and Typed's vocabulary). What moves:

- `matchPat` → `match` from the library, with a `ValueHandle` signature (`op = handle.op`,
  `args = handle.args`, `constant = handle.isConst ? imm : undefined`) and `equal = (a, b) => a.same(b)`.
- `firstMatch`/`indexRules` → the library's, with `(g, b) => guardHolds(g, b)` as the guard function.
- `instantiate` → the library's, with a `Builder<ValueHandle>` created per firing that closes over the
  transaction (`tx.const`/`tx.make`), the matched node (for `because: 'const-args'`) and the bindings (for the
  note's `{k}`/`{log2 k}` placeholders).

Typed's `Pat`/`Tpl` are converted to the library's `Pattern`/`Template` **once per table** (a memo in
`compile.ts`), and the rule's root provenance is carried as `attrs` on the template's root node. The allocation
order is unchanged: the library instantiates children first, left to right, exactly as the old code did, so every
value id, every derivation step and every edit record stays what it was. That is the invariant the baselines
check.

### 4. Typed's verifier: enumeration through the library, proofs stay in Typed

`src/typed/rules/verify.ts` has eight methods. Two kinds:

- **proofs and side conditions** — `structural`, `by-construction`, `symbolic-linear`, `bitwise-w1`, and the
  complete 32-bit enumeration `exhaustive-32`. These are arguments about Typed's widths, its operator relations
  and its evaluator. They stay in Typed.
- **enumeration over generated cases** — `exhaustive-w8` and `random-32`/`f32-special` (boundary values crossed,
  then seeded random draws). These are the Alive-style validation the library's `verifyRule` states, so
  `verify.ts` hands the library a case generator (its own domains: boundary values, f32 special values, `pow2`
  and `bool` domains) and its semantics (both sides compiled by `compileSide` at the method's width, traps
  compared as `agreeOutcome` does), and gets back a verdict, a case count and a counterexample. The evidence
  shape (`method`, `cases`, `ms`, `detail`, `counterexample.method/width`) is still Typed's; the library's
  counterexample carries the bindings and the two outcomes, and Typed wraps it.

`exhaustive-32` stays out of the library because its complete enumeration runs a **fused** loop over one full
32-bit variable and counts cases by arithmetic (`cases + x`), while the library's interface hands over one
assignment at a time: 2^32 yields would cost minutes, and the fused loop is a Typed fact about the 32-bit word.
Recorded as a deviation in the report.

### 5. Tix: `inline` and `split-sum` become rules; the expression walk stays the domain's

New `src/tensor/rules.ts`:

```ts
const signature: Signature<Expr>  // op labels: 'literal:<text>', 'load:<name>', 'op:+', 'reduce:sum', ...
```

- **`split-sum`**: `{ op: 'reduce:sum', args: [{ var: 'body' }] }` with a guard `singleDimAxis` (the rule's own
  guard, which the domain's guard function reads off the matched node — the library passes it the node), and a
  `build` template that makes `sum(block) sum(lane) body[lane + block]`.
- **`inline`**: per producer statement, a rule `{ op: 'load:<producer>', args: [] }` whose guard (pointwise and
  used exactly once) the domain decides before the walk and whose `build` template substitutes the producer's
  expression at the read's indices.

Both apply through the library's `indexRules`/`firstMatch`/`instantiate`, and the domain's `mapExpr` walks the
expression. The walk stays in the domain for the same reason as in (1): it is where Tix's binder scopes are
expressed.

**Verification of the Tix rules.** The Tix rules are *not* run through the verifier. `verifyRule` validates an
algebraic identity over sampled values; `split-sum` is a reassociation over a binder whose meanings agree only
within the tolerance the pass declares, and `inline` is a use-count property of a statement list, not an
equation over terms. The pass-level meaning gate (`tix.meaning-gate`, exact for `inline`, within a bound for
`split-sum`) remains the only check, as it is today. Recorded as open question 3's answer.

### 6. F40: the merged statement's correspondence entry says `merged`

The framework's `correspondenceFromDerivation` maps a step only when it makes an entity the output did not have;
a `merged` step whose target already existed contributes no entry, and the completion says `removed`. So a
derivation cannot produce the truthful entry today (that is the framework's, `ir/derivation.ts`, not this lane's),
and a native result carries a derivation **or** correspondence entries, never both.

The record moves to where F40 wants it: `inlinePass.prepare` supplies the **correspondence entries** —
`{ from: ['f/a'], to: ['f/b'], relation: 'merged' }` — and `mergedInto` answers from those entries. The merge
link, which was the derivation's only content, is preserved and is now a correspondence entry, so
`traceEntity`/`whyEntity` see it. The cost: `inline` no longer produces a `Derivation` object; Tix's K2 record
for this pass is the correspondence entry. The alternative — keep the derivation and the `removed` entry — is
what the backlog item rejects, and the other alternative — change `ir/derivation.ts` — belongs to lane F41.

Accepting both shapes in `mergedInto(Derivation | EntityCorrespondence | undefined)` keeps the 056-B derivations
(e.g. Typed's, and any future one) answering the same query.

## The decision point

Measure, in one process, interleaved, on the O2 corpus:

- **library path**: the real `simplify`, `fold` and `identities` passes (which use `stdlib/term` after this
  step), and
- **today's path**: a copy of the pre-change matcher (`matchPat`, `instantiate`, `firstMatch`, `indexRules`) as a
  pass over the same revisions, kept in the ticket's `scripts/` for the measurement.

Report the ratio of O2 corpus compile time (all passes) and of the rule passes alone. The threshold is the
brief's: if the library path costs more than about 10 % of O2 compile time, keep Typed's compiled visitor and
share only the matcher and the verifier. Either way the numbers go in the report.

## What is left out

- LVN/LICM keys, `sameTree`'s second copy and A0's matcher copies: the library now offers the hash and equality
  they would use, but replacing them changes what those caches key on, and the baselines pin their output.
- A library traversal (`rewrite`): one client (Tix), see (1).
- Verification of the Tix rules: see (5).
- `exhaustive-32` through the library: see (4).
