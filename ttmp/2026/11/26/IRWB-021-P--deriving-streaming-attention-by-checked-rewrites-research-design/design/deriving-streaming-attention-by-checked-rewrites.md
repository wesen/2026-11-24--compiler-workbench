---
Title: 'Deriving streaming attention by checked rewrites: research design'
Ticket: IRWB-021-P
Status: draft
Topics:
    - compiler
    - design-doc
DocType: design-doc
Intent: long-term
Owners:
    - manuel
RelatedFiles: []
ExternalSources: []
Summary: >
  Research design for deriving a FlashAttention-style streaming kernel from the
  plain Tix attention program by a sequence of rewrites, each checked locally
  (exact f32, exact over the reals, or tolerance against an f64 reference),
  on the IR Workbench contract framework, targeting CUDA on the GB10.
LastUpdated: 2026-11-26
---

# Deriving streaming attention by checked rewrites: research design

**Ticket:** IRWB-021-P · **Status:** design (no implementation in this ticket)

## Executive Summary

Single-head attention written the plain way in Tix materializes an N×N score
matrix. FlashAttention computes the same function in one pass over blocks of
`j`, keeping a running maximum, a running normalizer and a running output,
rescaled whenever the maximum grows, with O(N·D) memory traffic. This document
designs the research that answers: **can a compiler derive the streaming form
from the plain program as a sequence of rewrites, each with a local and
mechanical correctness argument?**

The answer is designed as a rule set of seven rewrite rules over an extension
of Tix with one new construct — a `fold` with a tuple state and a certified
associative combine — plus a worked derivation from the plain program to the
streaming form, a checking plan per rule (exact, tolerance, or both) mapped
onto the framework's `defineTransformation` / `defineInvariant` machinery, a
generality analysis (which other programs the same rules reach, which they
provably refuse), and a falsifiable experiment on the GB10.

The central design decision: the derivation is split so that **only two rules
ever leave the f32-exact world** (the rescale rule R5 and the blocking rule
R6). Everything else — fold introduction, fusion, fold merging, block-body
re-expression — is f32-exact by construction and checkable by bitwise
comparison against the f32 evaluator. This keeps the tolerance machinery, and
its calibration burden, confined to the two steps where reassociation is
inherent.

## Problem Statement

The plain program:

```
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
}
```

stores `s` and `e` (each N×N). FlashAttention never materializes them: it
streams blocks of `j`, maintaining per-row state (running max `m`, running
normalizer `l`, running output `u`), rescaling `l` and `u` by
`exp(m_old − m_new)` whenever the running maximum grows, and dividing by `l`
once at the end.

The question is not whether a compiler *can be built* to do this — it is what
the derivation must look like so that **each step's correctness argument is
local and mechanical**, in a framework where every optimization pass is checked
against the original program. Three sub-questions must be settled:

1. What are the rewrite rules, stated at Tix level, with side conditions and
   exact algebraic arguments over the reals?
2. What does Tix lack? (Answer, developed below: a reduction whose state is
   not a single number.)
3. How is each rule's application checked — exact argument, tolerance check
   against an f64 reference, or both — and what exactly are the f32
   differences and their sources?

## The Tix core and what it lacks

### Fixed core, taken as given

Tix as specified in the ticket brief: f32 tensors with affine shapes,
single-assignment statements, expression-level `sum`/`max` reductions with
rightmost-extent bodies, `exp/log/sqrt/tanh` and binary `max/min` calls, and an
f32 meaning where every operation rounds (`Math.fround` of the double result)
and reductions accumulate in increasing lexicographic order of their indices,
rounding after each step. Inputs are finite. Reduction indices are inferred
from plain uses; a shape name in an expression denotes its numeric value.

Two core features the derivation relies on and that already exist:

- **Partial-index broadcasting.** `e[i, j] = exp(s[i, j] - m[i])` reads `m[i]`,
  a ref indexed by a subset of the statement's left-hand indices. The fold
  extension below inherits exactly this convention.
- **`sum` and `max` as monoid accumulations** with stated identities (0 and
  −∞) and a stated evaluation order (lexicographic, first index outermost).
  The f32 meaning of a fold is defined to coincide verbatim with this, which
  is what makes rule R1 exact.

### The missing construct: `fold` with tuple state and a certified combine

The streaming form needs at least one reduction whose state is not a single
number: `(m, l, u)` — a scalar, a scalar, and a D-vector, jointly updated.
Plain `sum` and `max` cannot express this. What the IR needs is:

> **A sequential reduction over one or more indices carrying a tuple state,
> with an explicit initialization and step, whose result is extracted from the
> final state.**

Proposed surface syntax (an extension; nothing else in the core changes):

```
fold-stmt := NAME '=' 'fold' '(' NAME (',' NAME)* ')' '{'
               'init' '{' stmt* '}'
               'step' '{' stmt* '}'
             '}' ';'
```

- The fold's bound indices (`j`, `jb`, …) range over extents inferred exactly
  like reduction indices in the core (from plain uses in the step body).
- `init` and `step` bodies are ordinary Tix statement blocks. Statements in
  them define **state components**: tensors indexed by any subset of the
  enclosing function's free indices (the indices that survive the fold, e.g.
  `i`, and broadcast axes such as `x`), plus the fold's own bound indices
  inside `step`. Partial-index broadcasting applies as in the core.
- **Sequential override semantics** inside `step`: on entry, every state
  component is bound to its incoming value; a statement assigns the outgoing
  value; later statements in the same block read the newly assigned value,
  earlier statements read the incoming value. On exit, the last assignment of
  each component is the state carried to the next index value. `init` runs
  once, before the first index value, in statement order.
- After the fold, ordinary statements (including the function's `return`) may
  read the final state. This is the only way the fold produces values.
- One new literal is required: `neg_inf` (f32 −∞), for max identities. No
  other new operator, call, or type is needed; the state's shape is inferred
  like any statement's.

**Real-number semantics.** The fold computes the sequential composition of
`step` over the bound indices in increasing lexicographic order, starting from
`init`, over the reals (−∞ and +∞ included, exp/log/sqrt/tanh/max/min with
their real meanings). This is an *exact* specification: no rounding.

**f32 semantics.** Identical execution, with `Math.fround` applied after every
arithmetic operation, comparison-free call result, and state write — precisely
the core's discipline, extended with: `neg_inf` is the f32 −∞; and within a
step, reads-before-assignment see the f32 incoming state. Consequently:

> `sum(j) body` and `max(j) body` are *definitionally* the folds with
> single-number state, init 0 / −∞, and step `t' = t + body` / `t' = max(t,
> body)`, in the same lexicographic order with the same per-step rounding.

This definitional coincidence is the pivot of the whole design: it makes rule
R1 exact not just over the reals but in f32, and it makes `sum`/`max` usable
*inside* fold steps (rule R7) without a new semantics.

**What the fold is not.** It is not a parallel-reduction primitive and carries
no concurrency semantics; GPU mapping (blocks over `i`, one CTA per row block,
warp-level j-parallelism inside the D-contraction) happens downstream of the
derivation and is out of scope here (see Later). The fold's sequential lex
order is the *meaning*; the backend may reassociate only by going through the
checked rules again (that is precisely what R6 does, once, at block
granularity).

### Certified combines, not arbitrary user combines

The brief asks for "a reduction over a user-supplied associative combine". The
design deliberately narrows this: **the combine is supplied, but from a
certified scheme family**, each family member proved associative once, over
the reals, at the family level. Rationale: mechanical checking of
associativity for arbitrary user expressions is not decidable in general; the
framework's requires-clause would be undischargable. The families needed
here:

- **Plus** — state (a₁,…,a_k), combine = componentwise +. Covers plain sums,
  sum/sum-of-squares statistics.
- **Max** — componentwise max.
- **Exponential-normalized sum ("flash")** — state (m, a₁,…,a_k) with
  combine: given states (m₁, a⃗₁) over set S₁ and (m₂, a⃗₂) over S₂, with
  a⃗_t = Σ_{j∈S_t} exp(s_j − m_t)·w⃗_j:

  ```
  m  = max(m₁, m₂)
  a⃗  = a⃗₁ · exp(m₁ − m) + a⃗₂ · exp(m₂ − m)
  ```

  Identity: (−∞, 0⃗). Associativity over the reals is proved once for the
  family via the canonical-form invariant (proof under rule R5 below); each
  *use* instantiates it with a specific s and w⃗, and the per-instance side
  condition (s and w⃗ shapes, finiteness) is checked mechanically.
- **Log-domain exponential-normalized sum** — state (m, t) with t in log
  space, combine `t = log(exp(t₁ + m₁ − m) + exp(t₂ + m₂ − m))`. For
  log-sum-exp. Same family proof, transported through exp/log.

## The rewrite rules

Each rule is stated as a pattern over (an extension of) Tix with side
conditions, an algebraic argument over the reals, and a checking tier. The
checking tiers used throughout:

- **[EXACT-f32]** the rewritten program's f32 output is *bitwise identical*
  to the original's on the contract domain. Checked by running both through
  the f32 evaluator on contract inputs and comparing exactly; plus the
  algebraic argument that the execution traces coincide.
- **[EXACT-ℝ]** the reals argument is the check; f32 results differ, so the
  application is additionally gated by **[TOL]**.
- **[TOL]** a tolerance check against an f64 reference (defined under
  "Checking" below); the f32 differences and their sources are stated per
  rule.

Throughout, `j` is a reduction index, `i` (and `x`) are surviving indices, all
tensors are f32, and all inputs are finite (the core's domain).

---

### R1 — reduce→fold (definitional re-expression)

**Pattern.** Any expression-level `sum(j₁,…,j_k) body` or `max(…) body`,
whether as a whole statement RHS or nested in a statement RHS, is replaced by
a `fold` statement (hoisted to statement position, in original statement
order) producing a state component of the same shape, with init 0 / −∞ and
step `t = t + body` / `t = max(t, body)`, and the original use replaced by a
ref of the fold's result.

**Side conditions.** None beyond core well-formedness (extent inference
succeeds; the body extends as far right as in the core).

**Argument.** Definitional: the fold's f32 semantics is *stated* to coincide
with the core reduce's semantics, verbatim (same identity, same lexicographic
order, same per-step rounding). Over the reals the two are likewise the same
computation.

**Checking. [EXACT-f32]** Bitwise equality against the f32 evaluator; the
argument is one line because the semantics was designed to make it so.

---

### R2 — division hoisting out of a reduction

**Pattern.** `sum(j) a(j) / c` → `(sum(j) a(j)) / c`, where `c` is an
expression in which `j` does not occur (it may depend on surviving indices,
shape names, and other statements). Symmetrically for `max` with
`max(j) a(j) / c` when `c > 0`.

**Side conditions.** (i) `j` does not occur in `c`; (ii) `c ≠ 0` for all
valid inputs — discharged per instance (below); (iii) for the `max` variant,
`c > 0` pointwise.

**Argument (reals).** Multiplication by the scalar `c⁻¹` distributes over
finite real summation: `Σ_j (a_j / c) = (Σ_j a_j) / c`. Monotonicity of
division by a positive constant gives the `max` variant.

**Instance discharge for attention.** After applying R2 to
`o[i,x] = sum(j) e[i,j] * v[j,x] / l[i]`, `c = l[i]`, which is independent of
`j`. `l[i] > 0`: `l[i] = Σ_j exp(s[i,j] − m[i])`, and since inputs are finite,
`m[i]` is finite and attained at some `j*`, so the `j*` term is `exp(0) = 1`
and all terms are positive; hence `l[i] ≥ 1 > 0`. This is an exact,
mechanically statable argument (positivity of `exp`, attainability of the
max over a nonempty finite index set — `N ≥ 1` is part of the domain).

**f32 differences.** Dividing each product by `l` (N roundings per output
element) versus dividing the finished sum once (one rounding) — the derived
form is *more* accurate, but different; reassociation-free yet not bitwise
stable. **[EXACT-ℝ + TOL]**.

---

### R3 — producer fusion into a fold step

**Pattern.** A statement `t[indices] = rhs;` whose result is read only inside
`step` bodies of folds over an index `j` that `t` is indexed by, at the
point where the fold's bound index has value `j`. Each such read `t[…, j, …]`
is replaced by `rhs` with the read's index expressions substituted for `t`'s
left-hand indices; `t`'s definition disappears (if no reads remain outside
folds).

**Side conditions.** (i) `t` is single-assignment (always, in the core);
(ii) every remaining read of `t` is inside a `step` body of a fold bound on an
index that positions `t` exactly at the current index value — no read of
*t*-at-a-different-*j* (no stencil, no lookahead); (iii) if `rhs` contains a
nested reduce over an inner index (e.g. the `d`-contraction in `s`), the
substitution carries it along as an inner fold; the inner index's extent
inference is unaffected.

**Argument.** Pure program restructuring: the same expression is evaluated at
the same index point, in the same enclosing order. No numerical content.

**Checking. [EXACT-f32]** Bitwise equality. Note the deliberate cost
consequence: fusing `s` re-computes the `d`-contraction per `j` value — that
is exactly the FLOPs-for-bytes trade FlashAttention makes, and it is the
reason the derived program's traffic is O(N·D). The fusion itself is checked
numerically exact; the cost model's blessing is a separate, downstream
decision.

---

### R4 — fold merge (independent accumulators over the same index)

**Pattern.** Two folds `F₁`, `F₂` bound over the same index list in the same
order, whose `step` bodies do not read each other's state components, merge
into one fold whose state is the tuple of both states and whose `step` body is
the concatenation of both step bodies (statement order preserved, first F₁
then F₂, or any interleaving that respects intra-fold data dependence —
concatenation always does).

**Side conditions.** (i) identical bound index lists, hence identical
iteration order; (ii) no state read of `F₁` in `F₂`'s step or vice versa;
(iii) both folds' `init` bodies are side-effect-free statement blocks
(they are, in the core's statement language).

**Argument.** The two sequential compositions over the same index sequence
commute because they act on disjoint state components.

**Checking. [EXACT-f32]** Bitwise equality: each accumulator undergoes the
identical sequence of rounded operations in the identical order as before.

This rule is used in the attention derivation to merge the `l` and `u` folds
before R5 (they both read the final `m`, neither reads the other). It is also
the workhorse for other programs (e.g. layernorm's sum/sum-of-squares).

---

### R5 — running-max rescaling (the algebraic heart)

**Pattern.** The two-pass normalization pattern: a fold `F_m` over `j`
computing `m = max(j) s(i, j)` (per surviving index `i`), followed by one or
more folds over `j` whose per-element step has the **normalized-product form**

```
acc = acc ⊕ φ(s(j) − m_final) ⊙ w(j)
```

where `⊕` is any certified family's accumulation on `acc` (here: `+` on `l`
and on each `u[:, x]`), `φ = exp` (a certified family requires `φ` to satisfy
the homomorphism law `φ(a−c) = φ(a−b) · φ(b−c)` over the reals), and `w(j)` is
any expression independent of the accumulators (`v[j, x]`; for plain softmax,
`w = 1`).

Rewritten to a **single fold over `j`** with tuple state `(m, accs…)`, init
`(−∞, identities…)`, and per-element step:

```
m'    = max(m, s(i, j))
g     = exp(m − m')
acc'  = acc · g + φ(s(i, j) − m') ⊙ w(j)
```

(`g` reuses `m` before its reassignment — the fold's sequential override
semantics; when `m' = m`, `g = exp(0) = 1` exactly.)

**Side conditions.** (i) `φ` is `exp` (or another certified homomorphism);
(ii) the consumers' steps match the normalized-product form with the *same*
`s(i, j)` and per-consumer `w(j)`; (iii) consumers' `⊕` are from the Plus
family (or another family closed under this rescaling); (iv) `w(j)` does not
read the running state.

**Argument (reals).** The **canonical-form invariant**: after processing any
finite set of `j`-values `S` (in any order, hence in particular the
lexicographic prefix order), the state satisfies

```
m  = max_{j∈S} s(j)
acc = Σ_{j∈S} exp(s(j) − m) ⊙ w(j)
```

*Induction.* Empty `S`: `(−∞, Σ over ∅) = (−∞, 0)` — the identity, and the
formulas hold with the usual ∅-conventions. Step: given the invariant for `S`
and adding `j₀` with `t = s(j₀)`, `m' = max(m, t)`, then

```
acc' = acc · exp(m − m') + exp(t − m') ⊙ w(j₀)
     = Σ_{j∈S} exp(s(j) − m)·exp(m − m') ⊙ w(j)  +  exp(t − m') ⊙ w(j₀)
     = Σ_{j∈S} exp(s(j) − m') ⊙ w(j)  +  exp(t − m') ⊙ w(j₀)      [φ-law]
     = Σ_{j∈S∪{j₀}} exp(s(j) − m') ⊙ w(j)                        ∎
```

using `φ(a−c) = φ(a−b)·φ(b−c)` with `(a,b,c) = (s(j), m, m')`. This is also
the associativity proof for the flash combine family: combining canonical
states of `S₁` and `S₂` yields the canonical state of `S₁ ∪ S₂`, by the same
one-line computation at block granularity; the identity element is the empty
set's canonical state. The final division by the final `l` (already hoisted
by R2) reproduces the two-pass result over the reals:

```
o(i, x) = u(i, x) / l(i) = Σ_j exp(s−m)·v / Σ_j exp(s−m) = Σ_j softmax-weights · v
```

**f32 differences and their sources.** The two-pass program rounds `exp(s −
m_final)` once per element against a fixed final max; the streaming program
rounds each *rescale* `exp(m − m')` and one multiply per accumulator per
growth event, then per-element work against the current running max. Every
rescale factor is in (0, 1] (since `m ≤ m'`), so no overflow is introduced;
exponents are ≤ 0 throughout, which is the well-known stability property of
the form. The number of rescale events per row is at most the number of
running-max increases (≤ N). The accumulated rounding is of the same order ε·N
as the plain program's own N-term left-fold accumulation. One IEEE edge case
is discharged exactly, not by tolerance: on the first step, `m = −∞`, so
`g = exp(−∞ − m') = exp(−∞) = 0` and `0 · 0 + …` is exact (no NaN pathway, as
`s` is finite and `m'` is finite from the first element on).

**Checking. [EXACT-ℝ + TOL]** Tolerance against the f64 reference (both for
the derived program and, as a cross-check, the plain program), with the error
budget reflecting the rescale-event count; see "Checking".

---

### R6 — blocking (per-element fold → blocked fold with combine)

**Pattern.** A fold over `j` with per-element step → a fold over block starts
`jb` (extents from an affine tiling `N / B`), whose step body contains (a) a
**local sub-fold** over the block's inner indices `jb₂` re-deriving the
block-local state, and (b) one application of the **certified combine** at the
block boundary, merging the incoming state with the block-local state.

**Side conditions.** (i) The fold's combine is a certified family instance
(here: flash); (ii) the block-local sub-fold is itself a fold over `jb₂` with
the same per-element step restricted to the block, with *fresh* state
initialized at the identity — this restriction is what makes the rule local;
(iii) `B` divides `N` (remainder blocks: see Later).

**Argument (reals).** Associativity of the certified combine (proved at
family level, above): a left fold over blocks with combines equals the
per-element left fold, because both compute the canonical state of the full
index set. Formally: per-element fold = fold over singleton blocks; grouping
adjacent singletons into blocks and using associativity (twice: to collapse
each block and to keep the outer order) preserves the result.

**f32 differences and their sources.** The summation tree changes from a left
fold of N terms to (a tree/short left fold of ≤ B terms per block, then a left
fold over N/B blocks). Rounding differences are of order ε·log B within a
block and ε·(N/B) across blocks — typically *smaller* than the plain
program's ε·N. This is why the tolerance relation must be two-sided (see
"Checking"): the derived form can be *more* accurate than the original f32
program, and a one-sided bound against the plain program would be the wrong
contract.

**Checking. [EXACT-ℝ + TOL]** with the combine's associativity obligation
discharged at the family level and the per-instance side conditions checked
mechanically (shapes, finiteness, B | N).

---

### R7 — block-body re-expression in plain Tix

**Pattern.** A block-local sub-fold inside a `step` body, whose per-element
step is `t = t + exp(s − m_block) ⊙ w` with a preceding `m_block =
max(jb₂) s`, is replaced by ordinary core statements and core reduces over
`jb₂`:

```
mB[i]    = max(jb₂) s[i, jb₂];
eB[i, jb₂] = exp(s[i, jb₂] − mB[i]);
lB[i]    = sum(jb₂) eB[i, jb₂];
uB[i, x] = sum(jb₂) eB[i, jb₂] * v[jb₂, x];
```

**Side conditions.** The sub-fold's state is exactly `(m, l, u)` of the flash
family and the step matches; the `jb₂` range is the block extent.

**Argument.** Inverse of R1 at block scope, plus the observation that the
block-local computation is literally the original program's `m`/`e`/`l`/`u`
statements with `j` restricted to the block and `m` block-local.

**Checking. [EXACT-f32]** By R1's definitional argument, a core `sum`/`max`
*is* the corresponding fold; re-expressing it cannot change a single rounded
operation.

---

## The derivation, as a sequence of rule applications

Annotated with the checking tier each application carries:

| # | Rule | Applied to | Tier |
|---|------|-----------|------|
| 1 | R1 | the `d`-sum in `s`, the `j`-max in `m`, the `j`-sums in `l` and `o` → four folds | EXACT-f32 |
| 2 | R2 | `o`'s fold: `sum(j) e·v / l[i]` → `u[i,x] = sum(j) e·v`, `o = u / l` | EXACT-ℝ + TOL |
| 3 | R3 | fuse `s` (with its inner `d`-fold) into `m`'s, `l`'s and `u`'s folds; fuse `e` into `l`'s and `u`'s folds; `s`, `e` disappear as materialized tensors | EXACT-f32 |
| 4 | R4 | merge `l`'s and `u`'s folds (both read final `m`, independent states) into one `(l, u)` fold | EXACT-f32 |
| 5 | R5 | `(m`-fold`; (l,u)`-fold with normalized-product steps` → single running fold `(m, l, u)` with rescale | EXACT-ℝ + TOL |
| 6 | R6 | block the running fold over `jb` with block size B; local sub-fold + flash combine | EXACT-ℝ + TOL |
| 7 | R7 | re-express the block-local sub-fold as plain Tix statements | EXACT-f32 |

Note the load-bearing ordering: R4 cannot merge `m` with `l`/`u` *before* R5
(the `l`/`u` steps read `m`'s *final* value — a true data dependence), which
is exactly why R5 exists. After R5 the dependence is internalized into the
rescale, and the program is one pass.

### The derived program (Tix + fold), block size B

```
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  acc = fold(jb) {
    init {
      m[i] = neg_inf;
      l[i] = 0;
      u[i, x] = 0;
    }
    step {
      s[i, jb2]  = sum(d) q[i, d] * k[jb2, d] / sqrt(D);
      mB[i]      = max(jb2) s[i, jb2];
      eB[i, jb2] = exp(s[i, jb2] - mB[i]);
      lB[i]      = sum(jb2) eB[i, jb2];
      uB[i, x]   = sum(jb2) eB[i, jb2] * v[jb2, x];
      g[i]       = exp(m[i] - max(m[i], mB[i]));
      m[i]       = max(m[i], mB[i]);
      l[i]       = l[i] * g[i] + lB[i];
      u[i, x]    = u[i, x] * g[i] + uB[i, x];
    }
  }
  o[i, x] = u[i, x] / l[i];
  return o;
}
```

Reading: `jb` ranges over block starts (`N/B` values), `jb2` over positions
within the block (`B` values — the core's extent inference over affine
`jb·B + jb2` positions is part of the fold extension's inference rules, same
mechanism as the core's affine indices). Everything inside `step` other than
the last three assignments is rule R7's plain-Tix block body — the original
program, block-localized. The final `o` statement is R2's hoisted division.
Nothing N×N is ever named as a live tensor across `j` blocks; the largest
block-scope tensors are B×D-shaped per row.

The derivation is 7 applications on this program. The checker's obligations:
R2's `l > 0` discharge, R5's φ-law instance, R6's `B | N` and combine-family
membership — each a mechanical, per-application fact.

## Checking

### The contract, in framework terms

The framework's contract layer (`src/framework/contracts/`: `defineIR`,
`defineProperty`, `defineAnalysis`, `defineInvariant`,
`defineTransformation`) and its pattern/rewrite layer
(`src/framework/ir/patterns.ts`, `rewrites.ts`) already provide everything the
design needs; nothing new is required from the framework. Mapping:

- **Each rule is a `defineTransformation`**: `inputs` = the pre-rewrite Tix IR
  artifact, `outputs` = the post-rewrite artifact; `requires` = the pattern
  match (`matchAll` over the adapter view) *plus* the rule's side conditions
  as registered semantic predicates (`PatternPredicateRegistry`);
  `ensures`/`preserves` = the rule's checking tier (below);
  `correspondence` = the record tying input and output revisions under the
  declared relation; `cache: 'pure'`.
- **The meaning contract** for the Tix domain (owned by the parallel front-end
  work; this design states what it must supply): domain = shapes (with `N ≥
  1`, `D ≥ 1`, `B | N` where R6 was applied) and finite f32 input values;
  observation = the function's returned tensor(s) read elementwise; relation =
  either **exact** (bitwise f32 equality against a reference program's f32
  evaluation on the same inputs) or **tolerance** (below).
- **[EXACT-f32] applications** are checked by *exact* relation: the framework
  runs the f32 evaluator on contract inputs (a fixed sweep plus adversarial
  boundary inputs — maxima attained at first/last index, single-element rows,
  all-equal rows) and requires bitwise equality. No tolerance is involved.
- **[TOL] applications** are checked by an `defineInvariant` over input/output
  ports with two relations:
  1. **Against the f64 reference**: the same program evaluated in f64 (no
     intermediate rounding), compared elementwise with
     `|o_der − o_f64| ≤ α + β·|o_f64|`, where `(α, β)` are derived from an
     op-count bound: an accumulation of `C` f32 roundings into one output
     element gets `β ≈ c · ε_f32 · C` with `C` computed *symbolically from
     the derivation* (R5 contributes the rescale-event bound, R6 contributes
     `log B + N/B`). Calibrated empirically on the GB10 input sweep.
  2. **Against the plain f32 program**, *two-sided*: `|o_der − o_plain| ≤ α'
     + β'·(|o_f64| + margin)`. Two-sided because R6 typically *reduces*
     accumulated error; a one-sided "derivated must match plain" bound would
     misfire.
- **Per-application evidence** is recorded as correspondence records naming
  the exact input/output artifact revisions and the relation that was checked,
  which is exactly the framework's `correspondence` clause; a failed check is
  a recorded fact, and the pass is rejected (the plain lowering remains
  available — derivation failure degrades to the unfused kernel, never to
  wrong code).

### Where the f32 differences come from (summary)

| Rule | Source of f32 difference | Bound driver |
|------|--------------------------|--------------|
| R1, R3, R4, R7 | none (bitwise) | — |
| R2 | per-element division rounding vs one final division | +2 ulp per element |
| R5 | rescale multiplies `exp(m − m') ≤ 1` per growth event; per-element exp against running vs final max | ε · (growth events + N) |
| R6 | summation tree reshaped (left-fold → block tree + block left-fold) | ε · (log B + N/B) |

The one qualitative hazard in the whole derivation is **R5's repeated
rescaling driving `l` and `u` toward underflow together** when `m` far
exceeds early blocks' scores; the final division cancels the common factor
only up to rounding. This is part of the TOL budget (the op-count formula
already counts the rescale multiplies) and is monitored in the experiment's
input sweep by including rows with strongly skewed score profiles.

## Generality

### Programs the same rule set reaches

- **Softmax followed by a row-wise contraction** — the derivation above is
  the instance with `w = v[j, x]`; plain softmax is the instance with `w = 1`
  (state `(m, l)` only, no `u`, no R2). Same 7 applications, fewer statements.
- **Log-sum-exp** — state `(m, t)` with the log-domain certified family;
  R1/R3/R4 as above, R5 with `φ = exp` and the log-space combine, R6/R7 with
  the log-domain block body. Checking tier: TOL with a *looser* calibration,
  because f32 `exp`/`log` round-trips dominate the budget (flagged as a
  distinct tolerance tier in the contract, not a new rule).
- **One-pass layernorm statistics** — mean and variance as running
  `(count, Σx, Σx²)` via R1 + R4 + R6 with the Plus family; no R5 (no max).
  The derivation is trivially exact over the reals; the *tolerance check* is
  where the difficulty lives (`Σx² − (Σx)²/c` catastrophic cancellation) —
  this is a contract-calibration stress case, and the design expects it to
  require either f64 accumulators in the state or a variance-scaled tolerance
  tier. The rule set reaches the program; the tolerance tier is the open
  piece.
- **Min-variants** — symmetric to max (the certified family carries through
  with `min` and negation).
- **Multi-head attention** — `H` is a broadcast axis; every rule applies
  per `(h, i)` fiber unchanged; no new rule, no new side condition.
- **`max(j)` followed by multiplicative consumers with `tanh` scores** —
  reaches only if the score function `φ` satisfies the homomorphism law; pure
  `tanh` does not, so R5 refuses (see failures) but R1–R4, R6 with the Plus
  family (no max) still apply where the program shape allows.

### Programs the rule set refuses — and why that is a feature

- **`var = sum(j) (x[i,j] − mean_final[i])²`** — the shift is by the *final*
  mean, which is not available until the pass ends; there is no homomorphism
  to rescale by. R5's side condition (normalized-product form) fails;
  non-application is *checked and reported*, and the program keeps its
  materialized lowering. (Welford's algorithm is a different certified family
  with a different step shape — Later.)
- **A combine that is not associative** (e.g. a running harmonic mean folded
  in user style) — cannot be admitted at all under the certified-family
  design; the requires-clause rejects it mechanically. The failure mode is
  "no rewrite applied", never "wrong kernel".
- **Consumers that use the normalizer non-multiplicatively** — e.g.
  `o[i,x] = sum(j) e[i,j] * v[j,x]` followed by `y = tanh(o / l)` where the
  `tanh` was fused *inside* the sum; R5's step-shape side condition fails.
- **Stencil or cross-index reads of a fused producer** (R3 side condition
  ii): a consumer reading `s[i, j+1]` inside a fold over `j` blocks fusion —
  again a checked refusal.
- **Reductions whose inner index depends on the outer's running state** —
  e.g. scores normalized by the running `l` mid-pass; the fold's step-shape
  conditions reject it.

In every refusal case the obligation is a mechanically checkable side
condition, so the compiler's answer is "derivation stops here, keeping the
last correct program", with the reason recorded as a fact.

## The experiment

**Hypothesis (falsifiable).** On the NVIDIA GB10, for `N ∈ {1024, 4096,
16384}` and `D ∈ {64, 128}`, single head, f32:

- **H1 (traffic).** The derived kernel's measured DRAM traffic is within 3×
  of `4·(3·N·D + N·D)` bytes (three inputs + one output) and grows O(N·D) —
  i.e., at the largest N it is asymptotically below the unfused lowering's
  O(N² + N·D) traffic.
- **H2 (time).** The derived kernel's GPU time is within 2× of a
  hand-written streaming (FlashAttention-style) kernel at matched tile shape.
- **H3 (checking).** Every rule application's check (exact or tolerance)
  completes in time polynomial in program size, and a mutation suite of
  systematically injected algebraic errors (dropped rescale factor, `+`
  instead of the flash combine, rescale applied to `m`, division hoisted
  without the `c ≠ 0` discharge) is rejected by the checker in 100% of
  injections.

**Primary metrics.** GPU time (CUDA events, median of ≥ 30 reps after
warmup) and DRAM bytes (profiler counters) for (a) the derived kernel, (b)
the unfused lowering of the original program compiled by the same backend,
(c) a hand-written streaming kernel. Secondary: elementwise max/mean error
against the f64 reference for all three, and the checker's per-application
time and evidence volume.

**Refutation conditions.** H1 falls if derived-kernel traffic grows
superlinearly in N at fixed D (measured slope), or exceeds 3× the streaming
floor; H2 falls if the derived kernel is > 2× slower than the hand-written
kernel at the largest config; H3 falls if any mutation is accepted, or any
check is superpolynomial. H3 falling refutes the *research question itself*
(the derivation is not mechanically checkable as designed) independently of
performance; H1/H2 falling refutes the *practical claim* (the derivation
reaches a kernel worth having).

**Dependency.** The comparison requires a CUDA lowering of the fold IR. The
derivation, its checks and the derived IR are this ticket's deliverable; the
backend and the measurement harness are sibling work (Later). H3 is
executable against the IR and evaluator alone and does not wait for the
backend.

## Design Decisions

1. **Two-tier exactness.** Only R5 and R6 leave the f32-exact world; all
   other rules are bitwise-checkable. Alternative — treating every rule as a
   tolerance step — was rejected because it would spread calibration burden
   over rules whose f32 behavior is provably identical, weakening the
   framework's "checked" guarantee to statistical everywhere.
2. **Fold semantics mirrors the core's reduce semantics verbatim.** This is
   what makes R1 exact and lets R7 invert it for free. Alternative — a
   tree-reducing fold — would be more GPU-natural but would break R1's
   exactness and push tolerance into four rules instead of two.
3. **Certified combine families, not arbitrary user combines.** Mechanical
   associativity checking of arbitrary expressions is undecidable; a vetted
   family library keeps every obligation dischargeable. The brief's
   "user-supplied combine" is honored in the sense that programs select the
   family and instantiate it; the algebra is vetted once per family.
4. **Blocking before block-body re-expression (R6 then R7).** Keeps the
   combine at the only place it is needed (block boundaries) and shows the
   final program is *mostly plain Tix*, which matters for the shared
   front end.
5. **Two-sided tolerance against the plain program.** Because R6 can improve
   accuracy; a one-sided bound would encode the wrong relation.
6. **Sequential-override state semantics inside `step`.** Simple to state,
   simple to check, directly encodes `g = exp(m_old − m_new)` without an
   old/new naming apparatus. Alternative — explicit `old(m)`/`new(m)`
   functions — adds syntax without adding checkability.

## Implementation Plan (research steps, in order)

1. Write the fold extension's semantics as a spec page (this document's
   "missing construct" section, promoted) and get it agreed with the Tix
   front-end/contract work so the f32 meaning is fixed once.
2. Encode the seven rules as `defineTransformation` definitions with pattern
   predicates; encode R1–R7's side conditions as
   `PatternPredicateRegistry` predicates; verify matching on the attention
   program and the softmax program.
3. Implement the [EXACT-f32] checker first (evaluator diff, bitwise) and the
   derivation driver applying R1→R7 with recorded correspondence; run it to
   produce the derived IR for attention and softmax.
4. Implement the [TOL] invariant with the op-count budget; calibrate `(α,
   β)` on the input sweep; run the mutation suite (H3).
5. Hand the derived IR to the CUDA-lowering ticket for the GB10 experiment
   (H1, H2).

## Open Questions

- The exact shape of the op-count-based tolerance budget (`β ≈ c·ε·C`): the
  constant `c` and the treatment of `exp`/`log` calls in the count need
  calibration against the f64 reference on real sweeps; the *structure* (per
  output element, derived from the derivation) is fixed here.
- Whether R5 should admit `φ` = other exponential-family functions beyond
  `exp` (e.g. `exp(c·x)` with `c` a shape constant — the law carries through
  with a `c`-power rescale); mechanically checkable, deferred until a program
  needs it.
- Remainder blocks (`B ∤ N`): the derivation as specified requires `B | N`;
  the fix (a final partial block whose combine is applied with an identity
  block) is mechanical but adds a case to R6's side conditions — Later.

## Later

One line each, deliberately out of scope:

- Tix parser/front-end and f64/f32 evaluator implementation (parallel ticket; this design consumes them).
- CUDA lowering of the fold IR and GPU mapping (blocks/CTAs/warps) — sibling ticket; H1/H2 depend on it.
- Automatic block-size `B` selection from a cost model.
- Welford-family combine for numerically robust one-pass variance.
- Top-k / argmax state families (non-f32-tensor states).
- Multi-head and multi-query batching in the experiment matrix.
- Fusing `sqrt(D)` scaling into the `q` operand (a trivial hoisting rule, not needed for the research question).
- Tolerance-parameter calibration tooling as a user-facing command.

## References

- Ticket brief: IRWB-021-P (research question, Tix core spec, constraints).
- `src/framework/contracts/README.md` — semantic pass contracts (`defineTransformation`, `defineInvariant`, correspondence).
- `src/framework/ir/PATTERNS-AND-REWRITES.md` — pattern API, `PatternPredicateRegistry`, match evidence.
- FlashAttention (Dao et al., 2022) — the hand-written streaming form this derivation targets; used only as ground truth for H2, not as a derivation input.
