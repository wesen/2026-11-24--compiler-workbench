---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021
Status: draft
Topics:
    - research
    - compiler
    - verification
    - ir
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/definitions.ts
      Note: |-
        defineIR, defineTransformation, defineInvariant, defineProperty: the contracts the Tix rule set is expressed in
        defineIR/defineInvariant/defineTransformation, the contracts the rule set is expressed in
    - Path: repo://src/framework/contracts/differential.ts
      Note: |-
        differential(), compare and assuranceOf: where a tolerance relation plugs in and what evidence a sampled verdict carries
        differential() and compare: where the tolerance relation plugs in
    - Path: repo://src/framework/ir/rewrites.ts
      Note: |-
        rewrite(), saturate(), per-step transactions, budgets and the semantic acceptance gate the derivation steps run through
        rewrite() and saturate(): per-step transactions and the semantic acceptance gate
    - Path: repo://src/typed/f32.ts
      Note: |-
        The bit-exact f32 operator tables; the meaning the contract compares against is Math.fround of the double result
        The bit-exact f32 meaning the contract compares against
    - Path: repo://src/typed/rules/verify.ts
      Note: |-
        The evidence-strength order (proof, exhaustive, reduced width + argument, sampled) the per-rule obligations are ranked in
        The evidence-strength order the per-rule obligations are ranked in
    - Path: repo://ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/scripts/01-f32-step-deviation.mjs
      Note: 'Probe 1: per-rule f32 deviation, the bit-exactness of the fusion, and the no-max overflow outside its domain'
    - Path: repo://ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/scripts/02-rescale-count.mjs
      Note: 'Probe 2: deviation against the number of rescalings. Refutes the O(#rescales) error model'
    - Path: repo://ttmp/2026/11/26/IRWB-021--deriving-streaming-attention-by-checked-rewrites/scripts/03-accuracy-vs-origin.mjs
      Note: 'Probe 3: derived form vs the given program against the f64 formula, over four decades of score range'
ExternalSources:
    - FlashAttention (Dao, Fu, Ermon, Rudra, Ré, 2022), and the online-softmax note of Milakov and Gimelshein (2018)
Summary: |
    Research design, no implementation. A rule set of five rewrites, each with an exact real-arithmetic side condition, its f32 status and the mechanism that checks it, that carries the plain O(N^2) attention program of Tix to the streaming O(N*D) form with a running maximum, a running normaliser and a running output; the fold construct Tix needs for it, with its f32 meaning; the tolerance relation the derivation's two value-changing steps require, with measured constants; the programs the rules do and do not reach; and a falsifiable GPU experiment on the GB10.
LastUpdated: 2026-11-26T22:30:00-05:00
WhatFor: Before implementing a Tix pass that derives streaming kernels, or generalising the framework's contracts to a second domain with a tolerance relation.
WhenToUse: When asked whether the compiler can derive FlashAttention, what Tix lacks for it, or how a non-bit-exact rewrite chain can be checked in this framework.
---

# Deriving streaming attention by checked rewrites

The question is whether a compiler can **derive** FlashAttention from the plainly written Tix program, as a
sequence of rewrites each of which is checked, so that every step's correctness argument is local and
mechanical. This document answers it as a research design: it states the rewrites, the construct Tix is
missing, what checks each step, what the whole thing reaches, and the experiment that would refute it. It
contains no implementation.

The short answer:

- **Yes, as five rewrites plus one optional.** Three of them change the f32 result (R1, R4, R5); two are
  bit-exact (R2, R3). The chain is forced: linearise, then bundle, then stream, then de-materialise, then tile.
- **Tix needs one construct**: a reduction whose state is a tuple of tensors, with the combine supplied as an
  expression, folding the reduction indices in increasing order with a rounding after every step. `sum` and
  `max` desugar to it, so the core is a special case and nothing in the core's meaning changes.
- **The value-changing steps cannot be checked exactly**, because no bit-exact derivation exists — but
  the deviation they introduce is small, *smaller than the given program's own f32 error*, measured in §16.
  The contract's relation therefore has to be a tolerance, and it has to be scaled by the conditioning of the
  problem (`u · max|s|`), not a constant.
- **The memory win is numerically free**: removing the N×N intermediates changes no bit (measured, §16).
  Only the reassociation of the sum does.
- **The generalisable core is the representation lemma of §8**: the *maximum*, the *normaliser* and the
  *weighted output* form a monoid whose observation is invariant under moving the shift. That reaches
  log-sum-exp and one-pass normalisation statistics, and it fails on anything whose shift is not a maximum,
  or whose observation reveals the shift.

> **Conventions.** Paths are relative to the repository root at commit `19ad269`, the base of this ticket.
> Everything cited from `src/` exists and was read; the only files executed are this ticket's three probe
> scripts, whose outputs are in `various/`. Anything about Tix is **Proposed**, because the Tix front end,
> evaluator and meaning contract are being built in parallel and are not in this worktree; so are the CUDA
> backend, the f64 reference evaluator and the normaliser of §21. Numbers with `u` as a unit are multiples
> of `u·max|v|`, where `u = 2^-24` is the f32 unit roundoff and `max|v|` is the largest input magnitude in
> the value tensor; §17 explains why that is the natural scale.

---

# Part 1 — The program, exactly

## 1. The given program and its literal f32 meaning

```text
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
}
```

Two syntactic facts decide the whole design, and both come from the fixed grammar:

1. **A reduction's body extends as far right as possible.** So `sum(d) q[i,d]*k[j,d]/sqrt(D)` is
   `sum(d) (q[i,d]*k[j,d]/sqrt(D))` — the division is *inside* the reduction, once per `d` — and
   `sum(j) e[i,j]*v[j,x]/l[i]` is `sum(j) (e[i,j]*v[j,x]/l[i])`, the division once per `j`.
2. **Every operation is rounded to f32, and every reduction accumulates in increasing lexicographic index
   order with a rounding after each step.** So the given program is not the textbook formula
   `(q·kᵀ)/√D`; it is a particular f32 evaluation of it, with N²·D divisions rather than N², and N²·D
   different rounding positions.

Over the reals the distinction vanishes and

  o[i,x] = ( Σ_j exp(s_ij − m_i) · v[j,x] ) / ( Σ_j exp(s_ij − m_i) ),  m_i = max_j s_ij,  s_ij = (Σ_d q_id k_jd)/√D,

which is the same as `(Σ_j exp(s_ij) v[j,x]) / (Σ_j exp(s_ij))` for every finite `s`, because the factor
`exp(−m_i)` cancels. **The maximum is a numerical device, not part of the function.** Every derivation
below either keeps it (the general case) or drops it under a proved range bound (§14, R6).

## 2. What the streaming form changes, and in which currency

FlashAttention computes the same function in one pass over `j`-blocks, keeping per row `i` a triple
`(μ, λ, ν)` — a running maximum, a running normaliser, a running weighted output — rescaling `λ` and `ν`
whenever `μ` grows, and never storing `s` or `e`. Three separate claims hide in that sentence, and they
must be derived and checked separately, because they are justified by different arguments:

| claim | currency | justified by |
| --- | --- | --- |
| the triple is a *sufficient statistic*, and combining per-block triples is associative | algebra over the reals | the representation lemma (§8) |
| the triple may be built in one pass with a *running* maximum instead of a global one | algebra over the reals, plus an invariance of the observation | R4 (§12) |
| `s` and `e` need never be materialised | evaluation order | R3 (§11) |

The memory consequence follows from the third, and the third is the one that is *exactly* free. What is
*not* free is the second: the running maximum changes every rounding position in the two sums.

One distinction must be kept, because the brief states the win as bytes moved: **live storage is a property
of the program, traffic is a property of the schedule.** P4 (§15) has Θ(N·D) live storage where P0 has
Θ(N²), and that is a fact about the Tix program, decided by R3 and R4. Bytes actually moved depend on how the
fold is scheduled: a thread per row that walks all `j` re-reads `k` and `v` once per row, which is Θ(N²·D)
touches of `k` and `v` and no better than the unfused form unless tiles are reused (open question 5, and the
experiment's arm without R5). The derivation removes the N² *intermediates*; the schedule has to do the rest,
and the experiment measures whether it does.

## 3. What exists to build this on

The framework already has the four pieces this design needs, and no more:

- **Contracts with a domain, an observation and a relation.** `defineIR`, `defineAnalysis`,
  `defineInvariant`, `defineProperty` and `defineTransformation` in `src/framework/contracts/definitions.ts`,
  with the operational meanings of `requires`/`ensures`/`preserves`/`correspondence` in
  `src/framework/contracts/README.md`. An invariant is a predicate over named ports returning
  `{ok, reason, evidence}`; a transformation declares its inputs, outputs and guarantees and is executed by
  `AnalysisManager` (`analysis-manager.ts`), which checks the guarantees before publication and can roll
  back.
- **Sampled differential checks as invariants.** `differential()` in
  `src/framework/contracts/differential.ts` packages "run the baseline and the subject on generated cases
  and compare" as an ordinary invariant, with `compare` as the relation, `baselineKey`/`subjectKey` for
  reuse, and `assuranceOf` distinguishing `checked-sampled` from `checked-exact`. The Typed pipeline's
  meaning check (`meaningKept`, `src/typed/evaluate.ts`) is exactly such an invariant, with `agrees` as a
  bit-exact relation.
- **Directed rewrites with per-step transactions and a semantic gate.** `rewrite()` and `saturate()` in
  `src/framework/ir/rewrites.ts`, described in `src/framework/ir/PATTERNS-AND-REWRITES.md`: a rule is
  immutable data (pattern, template, `preserves` declarations) plus a versioned guard and replacement; each
  accepted application is its own transaction; a step is `host-accepted` only after the host's semantic
  gate accepts and commits it.
- **Rules verified once, with ranked evidence.** `src/typed/rules/verify.ts` verifies a rewrite rule once
  for every input of its types and ranks the result `proof > exhaustive > reduced-width+argument > sampled
  > by-construction`, with the f32 special values (zeros, infinities, NaN payloads) among its methods. Two
  further results are drawn on: IRWB-008's *edit validator* (a change may be re-derived exactly from its
  before-tree and the verified rule data, and needs no generated input) and its evidence-strength
  accounting; and IRWB-011's finding that a tolerance contract needs a **paired** comparison (same cases,
  candidate against origin) *and* an independent one (candidate against a reference), because the paired
  test cannot see an error both sides share.

What does not exist, and what this design therefore marks Proposed: the Tix front end, its extent
inference, its f32 evaluator and its f64 reference evaluator; the Tix meaning contract; the CUDA backend and
its kernel emitter; the normaliser of §21; the interval analysis of §14.

---

# Part 2 — The construct Tix is missing

## 4. Why the core is not enough

Everything in the streaming form is expressible except one thing. `sum` and `max` each carry a **single
number** through the reduction. The streaming form carries three things at once — a maximum, a normaliser
and a D-vector — and, crucially, its step *rescales the accumulated normaliser and output by a factor that
depends on the element being added*. That is not a sum and not a maximum. It cannot be written as a
`sum`-statement whose body mentions the accumulated value, because in Tix the body of a reduction may refer
only to the reduction index and to enclosing tensors; the accumulator is not nameable. It cannot be written
as a chain of N statements either without materialising N per-row states.

So the missing construct is one: **a reduction whose state is a tuple of tensors and whose combine is an
explicit expression over the previous state and the current element.**

## 5. The extension, minimally stated

One new statement form, added to the grammar of the brief:

```text
stmt   := NAME '[' NAME (',' NAME)* ']' (':' type)? '=' expr ';'                 // unchanged
        | '(' binder (',' binder)* ')' '=' 'fold' redindices
              'with' '(' state (',' state)* ')'
              ('let' NAME '=' expr)*
              '->' '(' expr (',' expr)* ')' ';'                                  // new
binder := NAME '[' NAME (',' NAME)* ']' (':' type)?                              // one per state component
state  := NAME ('[' NAME (',' NAME)* ']')? '=' expr                              // initial value of that component
redind := NAME (',' NAME)* | NAME 'in' aff '..' aff                              // all of the indices, or a sub-range
expr   := ... | fold                                                             // a fold is also a value
letb   := '(' binder (',' binder)* ')' '=' expr | NAME '=' expr
```

plus one token, `-inf`, for the negative infinity the core already uses as `max`'s initial value but cannot
spell.

Two surface details are there so that R5 can be written at all and nothing more. A `let` binding may bind
several names to a fold, so that the inner fold of a block returns its components into the outer fold's
body. And a fold's index binding may be a sub-range `j in lo..hi` with `lo`, `hi` affine in the enclosing
fold's indices, which is how a block is named; the other rules never use this, and the domain requires the
tile to divide `N` so that every sub-range is a full block and no masking is needed.

**Typing and extent inference.** As in the core, and by the same rules. The left-hand binders define one
tensor per state component; the indices of a binder are that component's free indices. The reduction
indices range over extents inferred from their plain uses in the initial values, the `let` bindings and the
component expressions, and from the binders' declared types when a reduction index occurs only affinely; a
mismatch is a compile-time check error, exactly as the core's own inference rule says. A state component may
not be indexed by a reduction index (a syntactic check), and a binder name may not collide with a tensor the
body reads (a syntactic check).

**Naming discipline.** Inside the statement a state component is named by its binder's name *without
indices*, and denotes that component's current value at the step; outside, the same name with indices denotes
the result tensor. This is the only place in Tix where a bare name denotes a value that is not a whole
tensor, and it is why a body that needs both (R5's inner fold inside an outer fold) prefixes its inner
components (`bmu`, `bl`, `bn`).

**Semantics.** The reduction indices range over their extents in increasing lexicographic order, the
first-listed outermost. The state is initialised once, by evaluating the initial values left to right. For
each element, in that order: evaluate the `let` bindings in order, then each component expression in order;
the new state is the tuple of those results. The statement's result is the state after the last element; on
the contract's domain every extent is at least one, so there is always at least one step.

**f32 meaning.** Every operation, every `let`, every initial value and every component result is rounded to
f32, and the state is an f32 value between steps — the same discipline as `sum`'s and `max`'s "rounds after
each step". This is what makes the extension *conservative*:

- `sum(j) E` is `(acc[<free indices>]) = fold(j) with (acc = 0) -> (acc + E)`, and
- `max(j) E` is `(acc[<free indices>]) = fold(j) with (acc = -inf) -> (max(acc, E))`,

with the same extents, the same order and the same rounding points, hence **the same bits**. The reduction
extension changes no meaning of the core. (Probe 1 in `various/` computes both spellings over 128–512 rows
and D = 64; they agree bit for bit in every run. The claim is a one-line induction on the number of
elements, not a measurement — the measurement is only that the transcription is what I think it is.)

Two values the extension needs and the f32 meaning already supplies: `exp(-inf) = 0` (measured:
`Math.fround(Math.exp(-Infinity)) === 0`) and `max(-inf, x) = x`. They are IEEE-754/JS behaviour, not
special cases to be added.

## 6. Decisions taken in the construct, and what they cost

**The combine is an expression, not a function value.** The simplest alternative that would serve the goal
is a top-level `fn combine(a: T, b: T): T` over a tuple type. It falls short on two counts that matter here:
it adds product types to the type grammar (a much larger change than one statement form), and it hides the
combine behind a name, so the algebraic obligation of §21 would have to be discharged by inlining it anyway.
**A named function that takes a whole block is a different construct** and is not needed: the inner fold of
R5 is written as a fold.

**The meaning is a left fold in index order, not "any bracketing".** The alternative — a reduction whose
meaning is the value of *some* bracketing, with associativity as a well-formedness requirement — is
superficially more elegant and is wrong for this framework: meaning must be a deterministic function of the
program, and the core's own `sum`/`max` already fix the order. Choosing the left fold puts every
associativity obligation where it is actually used: on the *rule* that reassociates (R5), not on the
program. A fold whose combine is not associative is perfectly meaningful and simply cannot be reassociated.

**No user-supplied fusion, no higher-order anything.** The state is a tuple of tensors of static shape; the
combine is ordinary Tix expressions; there is no way to name a state component from outside the statement
except by its binder name, and no way to iterate a data-dependent number of times.

---

# Part 3 — The rules

## 7. What a rule is here

In the framework's terms (`src/framework/ir/rewrites.ts`, `src/typed/rules/form.ts`) a rule is finite data
plus versioned code. This design adds two fields to the data, because a Tix rule has two obligations and
they are discharged by different machinery:

| field | content |
| --- | --- |
| `realObligation` | the identity over the reals that licenses the rewrite, as an object the normaliser of §21 can attempt; a rule with an undischarged obligation is not registerable |
| `f32Status` | one of `bit-exact` (the two sides perform the same f32 operations in the same order), `rounding` (the same operations in a different order or with different arguments; deviation to be checked), `range-bounded` (as `rounding`, plus a side condition that must be proved to exclude over/underflow) |

A rule's *application* is then checked by three things in order, and no others: the pattern match (syntactic,
modulo index renaming); the side conditions (syntactic checks, extent checks, the normaliser, and for
`range-bounded` the interval analysis); and the re-derivation of the edit exactly as IRWB-008's validator
does it — if the edit is re-derived from the before-tree and the rule data, no generated input is needed for
this step. The whole *revision* is then checked once by the Tix meaning contract of §18.

## 8. The representation lemma (the one piece of algebra everything rests on)

Fix a row `i`. Write `A_j` for `s_ij` and `W_j` for the row `v[j, ·]` of the value tensor. For a finite
`J ⊆ {1..N}` define

  Z(J) = ( μ_J , λ_J , ν_J ) = ( max_{j∈J} A_j , Σ_{j∈J} e^{A_j − μ_J} , Σ_{j∈J} e^{A_j − μ_J} W_j ),

and Z(∅) = (−∞, 0, 0), with the convention e^{−∞} = 0.

**Lemma (representation).** For disjoint J₁, J₂, with m = max(μ₁, μ₂):

  Z(J₁ ⊎ J₂) = κ(Z(J₁), Z(J₂)) := ( m , e^{μ₁−m} λ₁ + e^{μ₂−m} λ₂ , e^{μ₁−m} ν₁ + e^{μ₂−m} ν₂ ).

*Proof.* max is the join of the chain (ℝ, ≤), so μ_{J₁⊎J₂} = max(μ₁, μ₂) = m. For j ∈ J₁, exp gives
e^{A_j − m} = e^{A_j − μ₁} · e^{μ₁ − m}; the finite sum is linear, so
Σ_{j∈J₁} e^{A_j − m} = e^{μ₁−m} Σ_{j∈J₁} e^{A_j−μ₁} = e^{μ₁−m} λ₁; and the weighted component is the same
identity with `W_j` multiplying every term. Disjointness splits the sum over J₁ ⊎ J₂ into the two sums, and
the same argument applies to J₂. Where μ₁ = −∞ the factor is e^{−∞−m} = 0 and λ₁ = 0 by the induction
invariant, so the term vanishes. ∎

Three consequences, none of which needs a separate proof:

1. **κ is associative, commutative, with unit Z(∅).** Because Z(J₁ ⊎ J₂) is a function of Z(J₁) and Z(J₂)
   alone, and ⊎ has those properties. (Only associativity and order-preservation are used by R5; the
   commutativity of ⊎ is a bonus.)
2. **The whole set's summary is the program's triple.** For J = {1..N}: μ_J = m_i, λ_J = l_i, ν_J = n_i,
   where `n[i,x] = sum(j) e[i,j]*v[j,x]`. So the *state* of the fold, not merely its quotient, is the
   program's own quantities. That is why the derivation's real-valued correctness is an *equality*, not an
   up-to-a-factor relation.
3. **The observation is gauge-invariant in the general case.** Define the recanonicalisation
   g_μ′(μ, λ, ν) = (μ′, e^{μ−μ′}λ, e^{μ−μ′}ν). An observation C is usable with a running maximum if
   C(g_μ′ z) = C(z) for all admissible μ′. For attention C(μ,λ,ν) = ν/λ and C(g z) = ν/λ. For
   log-sum-exp, C(μ, λ) = μ + log λ and C(g z) = μ′ + (μ − μ′) + log λ = C(z) — the compensating use of μ
   is exactly what makes LSE work (§23). This is the only invariance the design uses, and §21 shows it is a
   one-line symbolic identity in the single parameter `c = e^{μ−μ′}`.

The lemma is discharged **once per combine expression**: it is an identity in the symbolic state components
and the element, with a three-way case split on which of μ₁, μ₂ is the maximum, and the normaliser decides
it. Measured cost is irrelevant (it is a few dozen nodes); it is re-discharged whenever the combine changes,
because rule evidence is versioned and fingerprinted, as `ruleFingerprint` already does in
`src/typed/rules/verify.ts`.

## 9. R1 — `R-hoist`: lift a divisor or factor out of a reduction

**Form.** In an expression, for a reduction over index `k`:

    sum(k) (E / c)  →  (sum(k) E) / c        and        sum(k) (c * E)  →  c * (sum(k) E)

and the same for `max(k)` (monotonicity of division by a positive constant). Because the rule is on
expressions, it applies inside fold bodies, one component at a time.

**Side conditions.** `k` is not free in `c`; no free index of `c` is bound by the reduction; for the f32
claim, `c` is finite and non-zero on the domain.

**Real argument.** Finiteness of the sum plus distributivity: Σ_k (E_k/c) = (Σ_k E_k)·c⁻¹, and c⁻¹ does not
depend on k. Needs c ≠ 0 only.

**f32 status: `rounding`.** The given program divides once per term; the result divides once. Two effects,
both unavoidable: one rounding per term disappears, and every partial sum is now scaled by a different
(non-power-of-two) factor, so the roundings land at different points. Measured contribution: **2.0–2.9 u**
(§16). Special case worth recording because it is checkable and sometimes applies: if `c` is a power of two
and the interval analysis proves no intermediate leaves the normal range, the scaled partial sums are exact
and the rule is `bit-exact` (verified: `fround(x·4) === x·4` for f32 `x`).

**Check.** Real obligation: the normaliser (linearity). Application: side conditions syntactically, plus a
power-of-two test that may upgrade the f32 status. f32: the revision's tolerance check.

## 10. R2 — `R-fold-form`: bundle co-indexed reductions into one fold

**Form.** Statements `d₁[..] = sum(k) E₁; … d_r[..] = sum(k) E_r;` (each `sum` or `max`) over the same
index name `k` with the same inferred extent become one fold statement binding `d₁…d_r`, with one `let` per
syntactically shared subexpression of the bodies, and component expressions `acc_p + E_p` (for `sum`) or
`max(acc_p, E_p)` (for `max`).

**Side conditions.** Same index name; the extent inferred for `k` from each body must be the same
expression; each body total on the domain (no division by zero, no `exp` overflow — domain conditions, not
extra checks); the shared subexpression is deterministic, which every Tix expression is.

**Real argument.** Definitional, and worth stating so that it is clear nothing is being assumed: a left fold
whose state components are combined independently is *the* product of the r reductions, because the sum of a
finite family is the left-to-right sequence of additions, which is exactly the fold's step. No algebra, no
side condition beyond the index agreement.

**f32 status: `bit-exact`.** Each component performs the same additions, in the same order, on the same
element values; the element expressions are the same trees evaluated on the same operands; no operation is
introduced, removed or moved; the backend never fuses a multiply and an add (`src/typed/f32.ts` documents
that the reference compiler names RNE and never contracts). Measured: **0.00 u — bit-identical — on every run
and on a second independent case** (§16). This is the step that makes "fuse the two reductions into one pass"
free, and it is the reason the derivation's f32 budget is spent entirely on R1 and R4.

**Check.** Real obligation: definitional, recorded as `by-construction` in the verifier's vocabulary. f32:
*exactly* by the structural check of §20 — the two programs' f32 operation sequences agree symbolically — and
the revision's bit-equality check confirms it on generated cases.

## 11. R3 — `R-name`: eliminate or introduce a name

**Form.** (a) Eliminate: a statement `d[lhs] = E;` whose remaining uses all lie inside one consumer, by
substituting `E` for each occurrence, binding to a `let` when several occurrences fall in the same fold step
so the evaluation count is unchanged. (b) Introduce: the converse, used only to bring a program into a shape
another rule matches.

**Side conditions.** `d` is not used elsewhere; the substitution is capture-avoiding, and `d`'s left-hand
indices become the consumer's iteration variables (in the fold case, `d`'s indices must be a subset of the
consumer's fold indices, possibly affinely); the substituted expression is total on the domain, so moving it
into a loop body cannot introduce a trap or a value change; the evaluation count is preserved.

**Real argument.** Substitution. There is no algebra in this rule at all.

**f32 status: `bit-exact`.** The same expression tree, evaluated the same number of times in the same
order, yields the same bits. The only thing that changes is *where the value lives*: a materialised tensor
becomes recomputation inside a loop.

**Check.** By construction, plus the revision's bit-equality. This is the rule that removes the N×N `s` and
`e` tensors, and §15 shows it fires only *after* R4, which is the structural explanation of the memory win.

**Cost note.** (a) removes stores and loads of size N×N (or N×N×D) and replaces them with recomputation of
an O(D) expression per element; whether that is profitable is the cost model's business, not correctness's.

## 12. R4 — `R-recanon`: replace the fixed shift by a running maximum (the FlashAttention step)

**Form.** Given a `max` statement over an index, and a fold over the same index whose per-element weight is
`exp(E − m[i])`:

    m[i] = max(j) E;                                        ( deleted )
    (l[i], n[i,x]) = fold(j) with (l = 0, n[x] = 0)
        let w = exp(E - m[i])  ->  ( l + w , n[x] + w * V[j,x] );

becomes

    (mu[i], l[i], n[i,x]) = fold(j) with (mu = -inf, l = 0, n[x] = 0)
        let mu1 = max(mu, E)
        let w   = exp(E - mu1)
        let c   = exp(mu - mu1)
        ->  ( mu1 , c * l + w , c * n[x] + w * V[j,x] );

**Side conditions.**
1. The `max` statement's index name and inferred extent equal the fold's, and its body `E` is syntactically
   the fold's element expression (after index renaming). *Checked syntactically.*
2. Every use of the fold's state components lies in one expression `C` that is homogeneous of degree zero
   in `(λ, ν)` jointly — here `o[i,x] = n[i,x] / l[i]`. *Checked by the normaliser, symbolically in one
   parameter `c`.*
3. `exp` is positive and strictly monotone (a property of the meaning, used for the join semantics of the
   maximum).
4. The `max` statement has no other use. *Checked syntactically.*

**Real argument.** By induction along the fold: the state after `t` steps is Z({j₁…j_t}). The base is the
initial state, (−∞,0,0) = Z(∅). The step is the template: with the current state Z(J) and the element j, the
element's own summary is Z({j}) = (E_j, e^{E_j−E_j}, e^{0}V_j) = (E_j, 1, V_j), and the template computes
exactly κ(Z(J), Z({j})) — `mu1 = max(μ, E_j)`, `c = e^{μ−mu1}`, `w = e^{E_j−mu1}`. By the representation
lemma this is Z(J ⊎ {j}). ∎ Hence the final state is Z({1..N}) = (m_i, l_i, n_i), and the observation is
unchanged. Note what is *not* used: nothing about the order in which `j` is visited. R4 alone would even be
valid for a permuted visit order; only the f32 meaning would differ, which is why R5 exists as a separate
rule.

**f32 status: `rounding`, and this is the rule's whole interest.** Three concrete differences:
(i) `exp` is applied to different arguments (`s − μ_running` instead of `s − m`), so every weight is the
same mathematical quantity computed from a differently-rounded difference; (ii) two extra multiply-adds per
component per element (the rescaling), i.e. Θ(N·D) extra roundings per row; (iii) the rescaling factor is
`exp(0) = 1` exactly whenever the running maximum does not grow, so most steps in practice rescale by an
exact 1. Two consequences, both measured:
- If `j₁` is the row's argmax, every step rescales by exactly 1 and R4 is **bit-exact** — verified
  bit-identical on 128–512 rows (probe 1; §16 reports the numbers).
- In general the deviation is **2.2–2.6 u**, and — the interesting part — it does *not* grow with the number
  of rescalings. Probe 2 drives the worst case (scores increasing in `j`, so every one of 64–512 steps
  rescaled) and measures **0.5–1.0 u**, *less* than the random case; the no-rescaling case measures exactly
  0. The naive error model "one rounding per rescale, so O(#rescales·u)" is refuted. The mechanism is stated
  in §17: the rescaling factor multiplies `λ` and `ν` identically, so its rounding error is common-mode and
  cancels in `ν/λ`; and the weights that accumulate the most rescalings are the exponentially smallest.

**Check.** Real obligation: the normaliser, from the representation lemma. Context homogeneity: the
normaliser. f32: the revision's tolerance check, with the number of rescalings per row reported in the
evidence so that a change in the numerical behaviour is visible even when the samples pass.

## 13. R5 — `R-reassoc`: reassociate a fold into blocks

**Form.** A fold over `j` becomes a fold over a block index `J`, whose body is an inner fold over the
block's `j` with the same initial state and the same step, followed by `κ` of the outer state with the inner
result. The block partition is by an affine offset: `j ∈ [J·B, J·B + B)` with `B` a constant tile, and the
domain requires `B | N` (so that every block is full and no masking is needed).

**Side conditions.** The fold's state must form a monoid — associativity of the step and the identity laws —
and the partition must preserve the order of the elements. **Order preservation is the real condition, not
commutativity**: a left fold is invariant under regrouping only within its own order, so R5 is licensed by
associativity alone. (The lemma's κ happens to be commutative; the rule does not use that.) The monoid
obligation is discharged once per combine expression, symbolically, and its evidence is fingerprinted with
the rule.

**Real argument.** Associativity and identity of κ give `Z(J₁) ⊗ … ⊗ Z(J_T) = Z(J₁ ⊎ … ⊎ J_T)`, and each
inner fold computes `Z(J_t)` by the R4 induction; the outer fold combines them in the same order, so the
final state is `Z({1..N})`. Same conclusion as R4, one level down.

**f32 status: `rounding`.** `T−1` extra combines, `T` restarts from the identity (for this state, every
restart costs one `exp(0)=1` and one non-trivial combine per block), and the inner sums are accumulated per
block rather than globally. Measured contribution: **1.8–2.6 u**, the same order as R4.

**Why it is a rule and not a backend decision.** The simplest alternative is to leave blocking to the
lowering, and it is what compilers normally do. It falls short here for a specific reason: reassociating the
`j` reduction is a *value-changing* transformation of a Tix program, and the only place in this system where
a value change is checked is the rule chain's own contract, tied to the statement that changed. Pushing it
into the backend would make every kernel's contract depend on an unchecked scheduling choice, and the
parallel `j`-split across GPU threads is exactly a reassociation — so the backend would be making a
numerically observable decision silently. Making it R5 gives it a checked home. If R5 is skipped, the
derived program is still the streaming form, evaluated in one thread per row, and the experiment's "derived
without R5" arm is a useful control.

## 14. R6 — `R-drop-max` (optional): remove the shift under a proved range bound

**Form.** The R4 fold with state `(μ, λ, ν)` becomes the fold with state `(λ, ν)` and `w = exp(E)`: no
maximum, no rescaling. The observation `ν/λ` is unchanged.

**Side conditions.** A *proved* bound `|E| ≤ β` over the contract's domain, via interval arithmetic from the
inputs' declared bounds: `E = (Σ_d q_id k_jd)/√D` and `|q|, |k| ≤ α` give `|E| ≤ α²√D`. Then
β ≤ 87 (so no `exp` overflows f32 — measured: `exp` overflows for arguments above 88.723) and, since the
smallest weight is then ≥ e^{−87} ≈ 1.6e−38 > 0, `λ ≥ N·e^{−87}` stays a normal number, so no term
underflows to zero and `λ > 0`.

**Real argument.** The observation is invariant under *any* shift — `ν/λ` cannot see it — so removing it is
the case `μ ≡ 0` of the gauge invariance, exact over the reals with no side condition at all: over ℝ, `exp`
is never zero and never infinite. The bound is a purely floating-point condition. **This is the clearest
illustration of why the design keeps the algebraic and the numeric obligations apart.**

**f32 status: `range-bounded`.** Inside the bound, R6 *removes* roundings (no rescaling at all) and is
strictly closer to the original. Outside it, it is catastrophic, and the failure is not graceful: probe 1
with the score range pushed to `max|s| = 322.9` produces **8192 of 8192 non-finite outputs** from the no-max
form, while the running-max form produces 0.

**Check.** The bound is proved, not sampled — interval arithmetic over the AST with upward-rounded bounds
and a margin. f32: the tolerance check *plus* the finiteness assertion of §18's observation, and the sampled
cases must include points near the domain's boundary, since the failure is invisible in the middle of the
domain.

---

# Part 4 — The derivation

## 15. The chain, forced at every joint

Each stage below is the whole function body; `return o;` is unchanged throughout and is omitted after `P0`.

**P0 — the given program.**

```text
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
```

**P1 — R1 on `s` and on `o`.** Both divisors are free of their reduction index (`sqrt(D)` is a shape value;
`l[i]` does not depend on `j`).

```text
  p[i, j] = sum(d) q[i, d] * k[j, d];
  s[i, j] = p[i, j] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  n[i, x] = sum(j) e[i, j] * v[j, x];
  o[i, x] = n[i, x] / l[i];
```

**P2 — R2 on `(l, n)`, then R3 on `e`.** Both reductions are over `j` with extent N; `e[i,j]` occurs twice
in the fold's step and is bound to a `let`, so it is evaluated once per element exactly as before.

```text
  p[i, j] = sum(d) q[i, d] * k[j, d];
  s[i, j] = p[i, j] / sqrt(D);
  m[i] = max(j) s[i, j];
  (l[i], n[i, x]) = fold(j) with (l = 0, n[x] = 0)
      let w = exp(s[i, j] - m[i])
      -> ( l + w , n[x] + w * v[j, x] );
  o[i, x] = n[i, x] / l[i];
```

P2 is the **two-pass fused form**: one pass for the maximum, one for the fold, no N×N `e`, `s` still
materialised. Up to P2 the derivation is bit-exact except for R1 — measured: R1 2.0–2.9 u, R2+R3 **0.00 u**.

**P3 — R4.** `m`'s only use is the shift; the fold's index and extent are `m`'s; the state is read only by
`n[i,x] / l[i]`, which is homogeneous of degree zero in `(l, n)`. The `m` statement is deleted.

```text
  p[i, j] = sum(d) q[i, d] * k[j, d];
  s[i, j] = p[i, j] / sqrt(D);
  (mu[i], l[i], n[i, x]) = fold(j) with (mu = -inf, l = 0, n[x] = 0)
      let mu1 = max(mu, s[i, j])
      let w   = exp(s[i, j] - mu1)
      let c   = exp(mu - mu1)
      -> ( mu1 , c * l + w , c * n[x] + w * v[j, x] );
  o[i, x] = n[i, x] / l[i];
```

**P4 — R3 on `s`, then on `p`.** Now that `m` is gone, `s`'s only use is inside the fold body, and `p`'s
only use is inside `s`. Both tensors disappear; the score is recomputed per element.

```text
  (mu[i], l[i], n[i, x]) = fold(j) with (mu = -inf, l = 0, n[x] = 0)
      let sj  = (sum(d) q[i, d] * k[j, d]) / sqrt(D)
      let mu1 = max(mu, sj)
      let w   = exp(sj - mu1)
      let c   = exp(mu - mu1)
      -> ( mu1 , c * l + w , c * n[x] + w * v[j, x] );
  o[i, x] = n[i, x] / l[i];
```

**P4 is the streaming form**: two statements, one pass, no N×N tensor anywhere. Live storage is
`q, k, v, o` (Θ(N·D)) plus `(μ, l, n)` (Θ(N·D)) — against P0's `s, e` (Θ(N²)).

**P5 — R5, tiled.** With tile `B | N`, the inner fold runs over one block of `j`, the outer over blocks;
the combine is κ.

```text
  (mu[i], l[i], n[i, x]) = fold(J) with (mu = -inf, l = 0, n[x] = 0)
      let (bmu, bl, bn[x]) = fold(j in J*B .. J*B + B) with (bmu = -inf, bl = 0, bn[x] = 0)
          let sj  = (sum(d) q[i, d] * k[j, d]) / sqrt(D)
          let bmu1 = max(bmu, sj)
          let w   = exp(sj - bmu1)
          let c   = exp(bmu - bmu1)
          -> ( bmu1 , c * bl + w , c * bn[x] + w * v[j, x] )
      let mu1 = max(mu, bmu)
      let ca  = exp(mu - mu1)
      let cb  = exp(bmu - mu1)
      -> ( mu1 , ca * l + cb * bl , ca * n[x] + cb * bn[x] );
  o[i, x] = n[i, x] / l[i];
```

This is FlashAttention, written in Tix as extended. `B` is the tile width of the kernel, `N/B` the outer
trip count, and a thread per row `i`; a warp or block splits `x` and the tiles.

**Why the order is forced.** Three joints cannot be reordered, and each says something about the derivation:

1. **R1 before R2/R4.** The divisor `l[i]` sits inside the `j` reduction in P0, so no shift is common to all
   terms and no monoid step exists until it is hoisted. Likewise the per-term division by `√D` multiplies
   the number of division roundings by `D` for no algebraic reason.
2. **R4 before R3 on `s`.** `s` has two consumers in P2 — the maximum and the fold. Only R4 removes the
   maximum, and only then does `s` become single-use. **This is the structural reason FlashAttention saves
   memory**: materialising `s` is not caused by the score computation, nor by the softmax, but by the fact
   that the maximum and the weighted sum are two separate passes over `j`; merging them is what lets the
   score tensor die. In compiler terms, R4 is a loop fusion that turns two consumers into one, and R3 is the
   dead-store elimination that follows. That is a much better explanation than "FlashAttention avoids the
   N×N matrix", and it is the kind of explanation a rule chain gives and a hand-written kernel does not.
3. **R5 last.** Reassociation is only expressible once the combine exists, and it is the only rule whose
   real obligation is associativity.

## 16. The algebra is not the numerics, and the numerics are not the algebra

Worth stating as a summary of Part 3–4, because it is the design's main structural claim: **two of the
five rules are bit-exact, and the three that are not are exactly the three that change where roundings land.** No
sequence of bit-exact rewrites reaches the streaming form, because streaming *is* a reassociation of the
softmax's sums and a re-origining of its exponentials. Any design that claims to derive FlashAttention under
a bit-exact contract is either deriving something else or checking nothing.

The compensation is that the deviation is small and, measured, *smaller than the given program's own f32
error*:

| quantity | measured (D = 64, scale 1) |
| --- | --- |
| R1 alone | 2.0–2.9 u |
| R2 + R3 (fusion, de-materialisation) | **0.00 u, bit-identical** |
| R4 alone (running maximum) | 2.2–2.6 u |
| R5 alone (tiling) | 1.8–2.6 u |
| P0 (given) vs the f64 formula | 1.9–2.4 u |
| P4/P5 (derived) vs the f64 formula | 1.6–2.8 u |
| derived vs given | 2.4–3.3 u |

The last three rows are the important ones: the derived form is *as accurate as* the given program, and the
distance between them is smaller than either one's distance to the true answer, because the two share the
dominant error — the f32 evaluation of the scores `s`. The rewrite's own contribution is the difference of
two *correlated* evaluations, not an accumulation of new error. That is what makes a tolerance contract
non-vacuous here: the budget is a few ulps, not "a few percent".

## 17. Where the f32 differences come from, precisely

Probe 3 sweeps four decades of score range at N = 128, D = 64 — where `max|s|` goes from 1.5 to 95 — and
finds the absolute deviation of *both* the given and the derived form from the f64 formula to be about
**1.2 · u · max|s| · ‖v‖∞** (measured, in units of `u` with `‖v‖∞ ≈ 1`: 2.0, 5.7, 30.7, 109.3 at
`max|s|` ≈ 1.5, 6, 24, 95). The
mechanism is elementary: an absolute error `ε` in a score becomes a relative error of about `ε` in that
term's weight, and `o` is a weighted average of `v`'s, so `|Δo| ≲ ε·‖v‖∞ ≤ 1.2 u · max|s| · ‖v‖∞`. The
coefficient is 1.2 rather than `D` because the dot product's errors cancel in the usual way.

Three separate sources, and they must not be conflated:

1. **The conditioning of the problem** — the f32 evaluation of `s` — dominates, and is present in the given
   program. It is a property of the domain (`max|s| ≤ α²√D` for the input bound α), not of the rewrite.
2. **The re-origining of the exponentials (R4)** — the second-order term. It is *not* proportional to the
   number of rescalings (probe 2): the rescaling factor multiplies `λ` and `ν` identically, so its
   rounding error is common-mode and cancels in `ν/λ`; and the weights that carry the most rescalings are
   the exponentially smallest, because exp is decreasing away from the maximum. Both effects are specific to
   *the shift being a maximum*; nothing analogous holds for an arbitrary shift.
3. **The reassociation of the sums (R1, R5)** — the per-term division removal and the block boundaries.
   Bounded by the usual `O(log N · u)` and measured at a couple of ulps.

Two of these three are properties of the problem, not of the compiler: only the second is created by the
derivation, and it is the one nobody would guess the size of (probe 2 was run expecting it to be the largest
term and it is the smallest).

The consequence for the contract is §18's relation: the tolerance must be scaled by `u·max|s|`, not fixed.
A fixed `κ·u·‖v‖∞` with no `M` in it is either vacuous (κ = 1000) or fails on the sharp-softmax regime
(the deviation grows past 100 u at scale 8). This is the same lesson IRWB-011 reached for rendered frames:
a tolerance needs a *principled scale* or it is a number someone chose.

---

# Part 5 — Checking

## 18. The contract for Tix attention

An invariant over three ports — the origin revision, the candidate revision, and the case — with the
following parts, all ordinary uses of `defineInvariant` and of `differential()`'s `compare` hook:

**Domain.** Shapes `N ∈ [1, 4096]`, `D ∈ [1, 128]`, tile `B` dividing `N`; inputs `q, k, v` finite with
`|q|, |k| ≤ α` and `|v| ≤ 1`. For rules not using R6, no bound on α beyond finiteness; for R6, α chosen so
that `α²√D ≤ 87`. Nothing is claimed outside this domain, and the case generator draws only from inside it —
including deliberately, for R6, cases at the boundary.

**Observation.** The returned tensor `o` as a `f32[N, D]` of IEEE bit patterns — `bit-equal` when the
relation is exact — together with the finiteness assertion: a value that is finite in the origin must be
finite in the candidate. On this domain the origin's output is provably finite (`max_j exp(s−m) = 1`, so
`λ ≥ 1`, so `|o| ≤ ‖v‖∞`), so the assertion is not vacuous, and a NaN or an infinity counts as disagreement
rather than as a value that might be close.

**Relation.** Two comparisons, following IRWB-011, both in the max-norm over the whole tensor and both
scaled by the `‖v‖∞` of the case (the natural scale of a convex combination of `v`'s) and by `M` (the
conditioning of the case):

- **paired**, candidate against origin, on the same cases:

      |o_c − o_0|_∞  ≤  u · (4 + M) · ‖v‖∞          where  M = max_{i,j} |s_ij| for that case

- **independent**, candidate and origin separately against the f64 evaluator:

      |o_c − o_ref|_∞ ≤ u · (8 + 2M) · ‖v‖∞   and   |o_0 − o_ref|_∞ ≤ u · (8 + 2M) · ‖v‖∞.

The paired comparison is the primary one — it is what the rewrite controls, and it is what detects a step
that is wrong. The independent comparison catches what the paired one cannot see: an error shared by both
sides, which would follow from a misreading of the given program (for instance reading the priority of `sum`
differently, which §1 shows is a real possibility).

**Where the constants come from.** `M` enters because the dominant error is the f32 representation of the
scores: an absolute perturbation `ε` of `s` perturbs the weights relatively by about `ε`, and `o` is a
weighted average of the `v`'s, so `|Δo| ≲ ε·‖v‖∞`; §17 measures the coefficient at 1.2. The constant term
is the floor of the summation roundings, which does not vanish as `M → 0`. The constants were fitted so that
every measurement in §16 falls inside with headroom of at least 1.7×, and the worst case is the *small*-`M`
one: in units of `u·M` the paired deviation is 2.2 at `M = 1.5`, 1.0 at `M = 6`, 0.54 at `M = 24` and 0.04
at `M = 95`, while the independent one peaks at 1.33. A single-term relation without the floor is tight in
the wrong place; a fixed `κ·u·‖v‖∞` with no `M` cannot hold on the sharp-softmax regime at any `κ` small
enough to be meaningful (§17).

`M` is computable per case from the scores, or bounded a priori from the domain (`M ≤ α²√D`), which is what
lets the relation be stated once for the domain rather than per case; the check uses the case's own `M`
because it is tighter.

## 19. What checks what

| rule | real obligation | how | f32 status | how |
| --- | --- | --- | --- | --- |
| R1 `R-hoist` | linearity of the finite sum | normaliser, once | `rounding` (or `bit-exact` if the divisor is a power of two) | revision tolerance; power-of-two test upgrades |
| R2 `R-fold-form` | definitional | `by-construction` | `bit-exact` | structural operation-sequence check, §20; bit equality on cases |
| R3 `R-name` | substitution | `by-construction` | `bit-exact` | structural check; bit equality on cases |
| R4 `R-recanon` | representation lemma + observation homogeneity | normaliser, once per combine | `rounding` | revision tolerance; rescale count in the evidence |
| R5 `R-reassoc` | associativity + identity, once per combine | normaliser | `rounding` | revision tolerance |
| R6 `R-drop-max` | gauge invariance at μ ≡ 0 | normaliser, once | `range-bounded` | interval proof of `\|E\| ≤ β ≤ 87`; revision tolerance + finiteness |

The division of labour, in the terms IRWB-008 established:

- **Once, at rule definition:** the real obligation and the monoid obligation. Both are symbolic identities
  in a tiny theory (§21), decided by the normaliser, evidence strength `proof` in `verifyRule`'s vocabulary,
  fingerprinted with the rule.
- **Once per application:** the pattern match, the side conditions, and the re-derivation of the edit from
  the before-tree. This is IRWB-008's `derived` outcome and needs no generated input. For R6 only, also the
  interval proof.
- **Once per revision:** the Tix meaning contract of §18 over the whole function. Accepted under
  `assuranceOf`: `checked-exact` for the steps whose f32 obligation is structural, `checked-sampled` for the
  rest. The revision's evidence is the *conjunction*: which steps were derived exactly, which carried a
  `rounding` status, and the measured deviations and rescale counts.

This is why the design's cost claim is plausible: the sampled check runs once per revision, not once per
step. IRWB-008 measured the analogous shape of that claim in the Typed pipeline (838 edits re-derived in
22 ms against 6.2 s for the sampled checks of the same three applications).

## 20. The structural f32 check

R2 and R3's bit-exactness must not rest on sampling, because sampling cannot establish it. The check is
mechanical and exact *on the programs*: for a candidate edit, produce the **f32 operation sequence** of each
output element symbolically in the iteration indices — the list of (operator, operand expressions) pairs in
evaluation order, with the reduction order made explicit — and compare the two sides' sequences componentwise
after index renaming. Equality of sequences implies equality of every partial result, hence of the result,
because the f32 meaning is a function of the operation sequence and nothing else. This is the Tix analogue of
`verifyRule`'s `by-construction` method: a relative proof against the evaluator's own order. Its honest
scope: it proves the *programs* equal under the meaning, which is as strong as anything in this framework
gets short of a formalised semantics. Probe 1 checks that the transcription honours it: R2+R3 measured
exactly 0.00 u, bit-identical, on two independent cases.

## 21. The normaliser, and its fragment

The only symbolic machinery the design needs. It receives a rule's `realObligation` — an equation between
two expressions over the reals — and either decides it or reports failure. Its fragment:

- **Terms**: finite sums with symbolic extents, products, `exp` of an affine form in the symbolic
  variables, `max` of two terms, constants, and one distinguished positive parameter `c` for the gauge.
- **Normal form**: a finite map from "exponent vector" (a linear form in the symbolic variables) to a
  coefficient, i.e. a sum of `coeff · e^{linear}`; two expressions are equal when the maps agree.
- **Laws**: `e^{a+b} = e^a e^b`, `e^0 = 1`, `e^{−∞} = 0`; `max(a,b)` reduced by a case split on `a ≥ b`
  (one level deep is enough for every obligation here, because the lemma's join is binary); linearity and
  distributivity of finite sums; commutativity of multiplication and addition.
- **What it cannot do**: induction over an extent (not needed: the lemma is stated for two parts, and the
  fold induction is over the number of steps, which the rule states as "the state after t steps is Z(J_t)"
  — a schema, instantiated once); inequalities beyond one max case split; anything about `exp` beyond
  addition (no `log`, no monotonicity reasoning inside the fragment, so a rule that needs `log` — LSE's
  observation — gets its *homogeneity* obligation from the `c`-parameterised form instead, see §23);
  transcendental identities of any other kind.

The alternative is a general proof assistant or an SMT solver with a transcendental theory. The simplest
alternative that would *serve the goal* is to accept hand-written arguments as opaque strings; it falls
short exactly where the question bites — "each step's correctness argument is local and mechanical" — since
an opaque string is neither local (it can say anything) nor mechanical (nothing decides it). A solver is
mechanical but brings an untrusted oracle and a large dependency into a pipeline whose whole point is that
each artifact is checked by code you can read. The normaliser is 300–500 lines and is the design's main
piece of new verification code.

## 22. What the checks do not establish

Stated plainly, because a design that hides its gaps is the thing this framework exists to avoid:

- **No proof of the error bound.** The relation's constants are fitted to measurements and then held by the
  sampled check. The `1.2·u·max|s|` law of §17 is an observation over four decades and three seeds, not a
  theorem. A *proof* would need a forward error analysis of the fold, which is a different (and longer)
  research project — one line in "Later".
- **Sampling covers only the cases.** The relation is checked on generated inputs inside the domain. A
  deviation that appears only at, say, `N = 4095` with `B = 128` is invisible unless the generator draws it;
  the generator must therefore include the awkward shapes (`N` not a power of two, the largest `N`, tile
  boundaries) by construction. IRWB-005's mutation measurements are the cautionary tale.
- **The Tix meaning is not the device's meaning.** Tix's `exp` is `Math.fround(Math.exp(x))`; a CUDA kernel
  computes `expf`, which is not correctly rounded and is allowed ~2 ulp of its own. That is a *lowering*, a
  further transformation with its own tolerance obligation (measured on the device), not something the
  derivation's contract can see. The same applies to `max`: Tix's `max(a,b)` is `fround(Math.max(a,b))`,
  which propagates a NaN operand, while the device's `fmaxf` returns the other operand. On the contract's
  domain no NaN ever exists (finite inputs, `exp` of a finite argument, `λ ≥ 1`), so the two agree — which
  is a further reason to keep the domain to finite inputs rather than to widen it and weaken the relation.
- **The paired comparison cannot see a shared error**, and the independent one is only as good as the f64
  evaluator. Both are reported; neither is a proof.

---

# Part 6 — Generality

## 23. What the same rule set reaches

| program | rules needed | what is derived | f32 status |
| --- | --- | --- | --- |
| softmax `y = e/λ` | R2, R3; R4 optional | a one-pass softmax with no stored `e` — R4 optional because `m` alone can be folded with R2 into the same pass | R2/R3 bit-exact |
| `softmax(x)·W` (attention's shape without `q,k`) | R2, R3, R4 | one pass over `j`, output accumulated in the state — this *is* R2 with `V = W` | R2/R3 bit-exact, R4 `rounding` |
| log-sum-exp `LSE = m + log Σ e` | R2, R4 | one-pass LSE; μ must be *reported*, since the observation is `μ + log λ` | R4 `rounding` |
| mean and variance in one pass | R2 only | `(n, Σx, Σx²)` as a fold state — a plain additive monoid | bit-exact |
| RMSNorm / LayerNorm statistics | R2, R3 | mean-square accumulated with the mean, no second pass | bit-exact |
| cross-entropy from logits | R2, R4 | one pass for `(μ, λ)` and the selected logit | R4 `rounding` |
| attention with a constant additive bias | all | as §15, with `E = s + bias[j]` | as §15 |
| attention as above with R6 | R1–R6 | the no-max streaming form | `range-bounded` |

The reach is exactly the reach of the **representation lemma**: a program whose reduction bodies are
`exp(A_j − μ)·w(j)` with a *common* `μ`, consumed only through a gauge-invariant observation. Note how the
table splits: programs whose statistics are *linear* (layernorm, RMSNorm) need only the bit-exact rules and
are therefore checked as strictly as anything in the Typed pipeline; programs with an `exp` need R4 and the
tolerance.

Two entries deserve the detail:

- **LSE is the case that makes the gauge machinery necessary rather than decorative.** The final state of
  the LSE fold is `(m, l)` and the value returned is `m + log l`, which is *not* equal to the two-pass
  version's `(m, l)` state — the running maximum yields `(μ_t, λ_t)` differing by a factor. Over the reals
  the observation is invariant: `μ′ + log(e^{μ−μ′}λ) = μ + log λ`. That is the closed form of
  "homogeneous of degree zero with a compensating component", and the normaliser decides it in the
  `c`-parameterised form. For attention the compensation is empty and the final state is *equal*, which is
  the special case.
- **Layernorm is where the rules reach the form but not the numerics.** `(n, Σx, Σx²)` is a monoid and R2
  derives the one-pass form, bit-exactly. But `Σx² − (Σx)²/n` is catastrophically cancelling, and Welford's
  recurrence is the numerically sound alternative — a *different representation of the same monoid*, related
  to the first by an exact real identity (§24). Welford is therefore reachable in principle by a
  representation-change rule, but the design does not include that rule, and it should not: the choice
  between two representations with the same real meaning and different conditioning is precisely the kind of
  decision that needs its own measured contract. One line in "Later".

## 24. What it fails on, and why

Each failure is a side condition of a rule, so the compiler's *failure* is as local as its success — which
is the property the question is really after.

| program | fails at | why |
| --- | --- | --- |
| attention that also returns `l` (or `n`) | R4, condition 2 | the observation is not homogeneous of degree zero in `(λ, ν)`: it exposes the shift, so the running maximum is not allowed. The two-pass fused form (P2) is still derivable, and is the correct answer. |
| attention with a *data-dependent* mask (`j < len[i]`) | extent inference | Tix extents are static; a reduction range that depends on a value is outside the language, not a limitation of the rules. |
| attention whose shift is the *mean* (`s − mean`) | R4, condition 1 | the shift is not a maximum, so it is not mergeable: you cannot combine two partial summaries without also carrying a count and a mean, and nothing bounds the exponent range. The maximum is the only shift that is both a join-semilattice and range-bounding, which is why this is a real limit and not an implementation gap. |
| dropout, or anything stochastic in the body | R2, purity | the fold's element must be a function of the indices. |
| multi-head attention with a `reshape`/`transpose` | the language | Tix has no reshape; the blocking would be over a different index order. Not a rule failure — a missing tensor algebra — and one line in "Later". |
| attention that also returns the log-sum-exp `m + log l` (a diagnostic a real API exposes) | the contract, not a rule | the two observations need different relations: `o` is a convex combination of `v`'s and scales with `u·max|s|·‖v‖∞`, while `m + log l` is not bounded by that at all. One invariant per observation, and the failure is in stating the second, not in deriving it. |
| Welford's recurrence from `(Σx, Σx²)` | no rule | an exact real identity exists, but it is a change of monoid representation with a numerical argument, which is not in this rule set (§23). |

---

# Part 7 — The experiment

## 25. Hypotheses, primary metrics, and what would refute them

**H1 (performance).** The derived kernel's measured DRAM traffic is Θ(N·D) and its elapsed time is within
25 % of the hand-written streaming kernel, and at least 1.8× better than the unfused lowering, at
`N ∈ {1024, 2048, 4096}`, `D = 64`, `B = 128`, on the GB10.

- **Primary metric:** bytes moved per attention call (DRAM read+write counters) and median elapsed time
  over 200 timed iterations after 20 warm-up iterations, reported with the interquartile range. Secondary:
  achieved occupancy and the number of `expf` evaluations, which is where the derived kernel may differ
  from the hand-written one.
- **Arms:** (a) the derived kernel on the Tix-extended program of P5; (b) the same derivation without R5
  (streaming, one thread per row, no tiling) — the control that isolates what blocking buys; (c) the unfused
  lowering of P0 (materialised `s` and `e`); (d) a hand-written FlashAttention kernel with the same tile.
- **Refuted if:** the derived kernel's traffic is within 1.2× of the unfused one (the memory win did not
  materialise), or its time exceeds the hand-written kernel's by more than 25 %, or it is not at least 1.8×
  faster than (c) in the memory-bound regime. A margin of 25 % is deliberate: the derived kernel recomputes
  `s` per element where the hand-written one may keep it in registers per tile, and that is a real
  difference in flops, not in traffic.

**H2 (locality and mechanicality — the question's actual claim).** Every step of the derivation is accepted
by a check whose obligation is bounded by the rule's own pattern, with no hand-written proof per
application and no whole-program reasoning.

- **Primary metric:** per application, the number of AST nodes the side-condition machinery must inspect,
  and the acceptance time; both must be bounded by a constant (the largest pattern's size) and independent
  of N, D and the program's size. Reported against the elapsed time of one sampled meaning check of the same
  revision, as IRWB-008 did.
- **Refuted if:** any application requires the normaliser to see more than the rule's pattern plus its
  immediate context (e.g. if condition 2 of R4 — observation homogeneity — could not be decided on the
  consumer expression alone), or if the fraction of *derived* edits falls below 1.0 for this derivation, or
  if accepting the whole chain costs more than one sampled check of the final revision.

**H3 (generality).** The rule set derives a streaming form for at least five of the eight programs of §23's
table, and no derivation uses a rule outside the set.

- **Primary metric:** programs derived / programs attempted, with the failure recorded as the first
  side condition that rejected the application. Secondary: how many rules each derivation used, and how many
  needed R4 (the tolerance) versus only the bit-exact rules.
- **Refuted if:** fewer than five are derived, or any derivation requires a rule outside R1–R6, or the
  derivations are all of the same shape (i.e. the table is padded by near-duplicates).

## 26. Measurement setup, and the one thing that could make the whole experiment meaningless

Device: an NVIDIA GB10, one process, `nvcc` for the two baselines' reference numbering. Traffic from
`dram__bytes.sum` (Nsight Compute) if the profiler attaches on this architecture; if it does not, from a
calibrated substitute — peak allocated bytes plus a copy microbenchmark that fixes the achievable bandwidth,
which turns elapsed time into a traffic estimate within about 10 % in the memory-bound regime. That
substitution must be stated with the results, not silently used.

**The trap.** Tix's `exp` is `Math.fround(Math.exp(x))`; `expf` on the device is not that function. If the
kernel uses `expf`, the derived kernel's deviation from the meaning's evaluator includes the device's math
error, which is of the same order as everything measured in §17 — and an experiment that did not separate
the two would be measuring the device's `expf`, not the derivation. So H1's runs are accompanied by a
separate measurement of the *lowering's* obligation: the same kernel with `exp` replaced by a faithful
(double-precision `exp` then round) evaluation, versus `expf`, on identical inputs, reported as its own
deviation in `u`. If that deviation is not small compared with the derivation's, the kernel's accuracy story
belongs to the `expf` lowering and must be stated as such.

## 27. Threats to validity

- **The tile is a free parameter, and R5 is one rule for all tiles.** H1's numbers are for one `B`; a
  derived kernel with the wrong `B` is legitimately slow, and that is a cost-model problem, outside this
  design.
- **The hand-written baseline's quality.** A poor hand-written kernel would make H1 flattering. The baseline
  is therefore written independently and its traffic is checked to be Θ(N·D) before any timing is compared.
- **The domain's `α`.** All the accuracy numbers are at `α ≤ 1` per entry with `D = 64`, i.e. `max|s| ≲ 24`.
  A different domain changes the relation's constants, and §18 says so explicitly; the experiment must
  report the measured `max|s|` of its case set.
- **One derivation is not a rule set.** H3 is the arm that protects against over-fitting the rule set to
  this program; if only attention is derived, the design's central claim reduces to "a compiler can be told
  how to write FlashAttention", which is not the claim.

---

# Part 8 — Decisions, alternatives, and what is deliberately left out

## 28. Significant decisions, and the simplest alternative for each

| decision | simplest alternative | why it falls short |
| --- | --- | --- |
| five rules with separate real and f32 obligations | one pass that recognises the whole pattern and replaces it | a single global correctness argument, which is what the question asks to avoid; it also cannot be reused for §23's other programs |
| a fold with an explicit combine expression | a library template `flash_attention(q,k,v)` with the shapes as parameters | trivially correct, derives nothing, and says nothing about softmax, LSE or layernorm |
| left-fold meaning; associativity as a *rule* side condition | monoid reduce with unordered meaning and associativity as well-formedness | the meaning would stop being a function of the program, and the core's `sum`/`max` already fix an order |
| the shift recanonicalised in the state (R4) | drop the maximum and rely on range bounds (R6 alone) | works only on a domain with `α²√D ≤ 87`; the reported failure mode (8192/8192 non-finite outputs outside it) is why R6 is optional and R4 is not |
| a tolerance relation scaled by `u·(1 + max|s|)` | a fixed `κ·u·‖v‖∞` | vacuous at `κ = 1000`, and too small at any useful κ once the softmax sharpens (measured, §17) |
| an exact bit-equality relation for R2/R3 by structural sequence comparison | rely on the sampled check | sampling cannot establish bit-exactness; the structural check is cheap and decides it |
| the normaliser over a tiny exp-affine theory | hand-written argument strings; or an SMT solver | strings are neither local nor mechanical; a solver brings an untrusted oracle into a checked pipeline |
| blocking as a rewrite (R5) rather than a lowering choice | let the backend tile freely | tiling reassociates the sums, which is value-changing; the check must live where the statement that changed lives |
| sampled tolerance for the whole revision, once | a sampled check per rule application | seven sampled checks at IRWB-008's measured cost per check would dominate everything, and per-step checks cannot see the compounding |
| derive from the Tix source level | derive on a lower tensor IR | the rules would be unrecognisable and the side conditions unreadable; lowering-level rewrites are still needed later for vectorisation |

## 29. Later (one line each; none of these is designed here)

- The Tix front end, extent inference, f32 evaluator and f64 reference evaluator — being built in parallel.
- The Tix meaning contract as registered definitions (IR kinds, the invariant of §18, the case generator).
- The normaliser of §21, including its fragment's exact boundary and its own regression suite.
- The interval analysis of R6, with upward-rounded bounds and a documented margin.
- A forward error analysis of the fold, replacing §17's measured law with a theorem.
- A cost model: when `R3`'s recomputation beats materialisation, and which tile `B` to choose.
- Vectorisation and shared-memory tiling rewrites below R5, which are lowering-level and have their own
  contract.
- Multi-head support: reshape/transpose in Tix, and blocking over a different index order.
- Welford and monoid representation changes generally, with a measured numerical contract.
- A search procedure that *finds* fold formations, rather than recognising the ones §23 lists.
- The `expf` lowering contract, and the device-side measurement of §26's trap.

---

# Part 9 — Open questions

1. **Is condition 2 of R4 ever non-local in practice?** The design assumes the observation of a fold's state
   is a single consumer expression. If a program reads a fold's state in two places, homogeneity must be
   decided on a conjunction of contexts, and the rule's locality weakens. Nothing in §23 needs it; nothing
   proves it cannot happen.
2. **Does the structural f32 check of §20 scale?** It compares operation sequences; for a fold over a
   symbolic extent the sequences are themselves symbolic. The design asserts this is decidable and cheap for
   Tix's expression language; it has not been built.
3. **How tight can the relation be?** §18's `u·(4 + M)` holds every measurement with 1.7× headroom. A pipeline
   that demanded 1.1× headroom would reject some legitimate tilings; nothing here says where the right margin is.
4. **Is the representation lemma the right unit of reuse?** It is stated for one reduction index and one
   `exp`. A program with two nested `exp`-weighted reductions (e.g. two-level attention) would need it twice
   and might need a product monoid. Not attempted.
5. **What does "bytes moved" mean for a kernel whose `k`/`v` are re-read per row?** The Θ(N·D) claim counts
   each of `q, k, v, o` once for the whole call only if `k` and `v` are tiled and reused across rows. With a
   thread per row and no shared memory, the naive streaming kernel reads `k` and `v` Θ(N) times per row, i.e.
   Θ(N²·D) — *no better than the unfused form*. R5 plus a row-tiled schedule is required for the memory
   claim, which is a reason H1 has an arm without R5 (§25).

---

# References

**In this repository**

- `src/framework/contracts/differential.ts` — `differential()`, `compare`, `assuranceOf`, and the memo keys
  that make a sampled check cheap on reuse.
- `src/framework/contracts/definitions.ts`, `src/framework/contracts/README.md` — the definition APIs and the
  operational meaning of `requires`/`ensures`/`preserves`/`correspondence`.
- `src/framework/contracts/analysis-manager.ts` — transaction lifecycle, provisional facts, rollback.
- `src/framework/ir/rewrites.ts`, `src/framework/ir/PATTERNS-AND-REWRITES.md` — rules as data, per-step
  transactions, schedules, budgets, and the semantic acceptance gate a step's `host-accepted` status needs.
- `src/typed/rules/verify.ts`, `src/typed/rules/semantics.ts` — verifying a rule once, and the evidence
  strength order this design's per-rule obligations are ranked in.
- `src/typed/f32.ts` — the bit-exact f32 operator tables, RNE, no fused multiply-add.
- `src/typed/evaluate.ts` — `agrees`, `meaningKept`: the bit-exact relation and the sampled invariant the Tix
  contract deliberately departs from.
- IRWB-008 — the edit validator, `deriveRevision`, the residual, and evidence strength; the source of §19's
  division of labour and of the 22 ms against 6.2 s comparison.
- IRWB-011 — tolerance contracts, the paired/independent comparison pair, and the requirement that a
  tolerance have a principled scale.

**This ticket's measurements** (`scripts/`, outputs in `various/`)

- `01-f32-step-deviation.mjs` — per-rule deviation, the bit-exact fusion, the isolating no-rescaling case,
  the no-max overflow. Outputs: `01-f32-dev-N{128,256,512}-D64-scale{1,4,16}.txt`.
- `02-rescale-count.mjs` — deviation against the rescale count; refutes the O(#rescales) model. Output:
  `02-rescale-count-D32.txt`.
- `03-accuracy-vs-origin.mjs` — derived versus given against the f64 formula over four decades of score
  range. Output: `03-accuracy-vs-origin.txt`.

**External**

- T. Dao, D. Y. Fu, S. Ermon, A. Rudra, C. Ré, *FlashAttention: Fast and Memory-Efficient Exact Attention
  with IO-Awareness*, 2022 — the algorithm derived here, and the block-rescaling recurrence of its
  Algorithm 1.
- M. Milakov, N. Gimelshein, *Online normalizer calculation for softmax*, 2018 — the running-maximum
  recurrence, i.e. R4 stated as a numerically stable identity rather than a kernel.
