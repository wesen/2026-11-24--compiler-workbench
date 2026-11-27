---
Title: 'Research design: deriving streaming attention by checked rewrites'
Ticket: IRWB-021-S
Status: active
Topics:
    - tix
    - cuda
    - compiler
    - ir
    - verification
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/README.md
      Note: assurance levels (declared/checked/transferred/proof) used for once-per-rule evidence
    - Path: repo://src/framework/contracts/differential.ts
      Note: the sampled differential invariant both relations (exact, tolerance) build on
    - Path: repo://src/framework/ir/PATTERNS-AND-REWRITES.md
      Note: the rewrite engine the seven rules target (match, guard, replace, schedules, acceptance gate)
    - Path: repo://src/framework/ir/rewrites.ts
      Note: rewrite registry and schedules; each step reports applied/rejected with evidence
    - Path: repo://ttmp/2026/11/26/IRWB-021-S--deriving-streaming-attention-by-checked-rewrites-flashattention-from-plain-tix/log/01-research-diary.md
      Note: the investigation diary
    - Path: repo://ttmp/2026/11/26/IRWB-021-S--deriving-streaming-attention-by-checked-rewrites-flashattention-from-plain-tix/scripts/01-numeric-probe.mjs
      Note: the host f32/f64 probe whose numbers this document cites
    - Path: repo://ttmp/2026/11/26/IRWB-021-S--deriving-streaming-attention-by-checked-rewrites-flashattention-from-plain-tix/various/01-probe-results.txt
      Note: the probe's measured evidence (80 configurations, 3 negative controls)
ExternalSources: []
Summary: 'Research design (no implementation): a seven-rule library (inline, factor-const, split-index, nest-max, exp-shift, nest-sum, fold-intro) that derives FlashAttention''s streaming form from the plain Tix attention program in thirteen checked applications; the fold construct Tix must add (a reduction over a user-supplied associative combine on a tuple state) with its reals and f32 semantics; per-rule checking (exact argument + exact or tolerance differential gate against the f64 reference, with measured f32 error sources and a calibrated epsilon); generality (softmax, log-sum-exp, one-pass layernorm statistics reached; masked attention, factored exp, cross-frame normalizers not, and why); and a falsifiable GB10 experiment comparing derived kernel time and DRAM bytes against the unfused lowering and a hand-written streaming kernel.'
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: 'Answers the IRWB-021-S research question: can a compiler derive streaming attention by checked rewrites with local, mechanical correctness arguments.'
WhenToUse: Before implementing the Tix fold construct, the rule library, the combine verifier, or the GB10 measurement campaign; and before extending the rule set.
---

# Research design: deriving streaming attention by checked rewrites

## Executive Summary

FlashAttention is not magic; it is four small algebraic facts applied in the right order. This
document designs the research that shows a compiler can find that order, apply it as thirteen
checked rewrite applications, and be held to account at every step. It states each rule in
Tix-level terms with its side conditions and its exact argument over the reals; it gives the
complete derivation from the plain program `P0` to the streaming form `P8`; it specifies the one
construct Tix must gain for the streaming form to be expressible — a reduction whose state is a
tuple, combined by a user-supplied associative combine — with its semantics over the reals and its
f32 meaning; it says, rule by rule, how each application is checked (an exact argument recorded
once, an exact differential gate, a tolerance differential gate against the f64 reference, or
several of these), what the f32 differences are and where they come from, with numbers from a host
probe run for this ticket; it delimits generality (softmax, log-sum-exp, one-pass layernorm
statistics are reached; masked attention, an already-factored `exp`, and a normalizer over a
different score are not, each for a stated reason); and it states a falsifiable hypothesis with a
primary metric — measured GPU time and DRAM bytes of the derived kernel against the unfused
lowering and a hand-written streaming kernel on the GB10 — and the results that would refute it.

Everything below is design. No code is implemented by this ticket; the probe in `scripts/` is
measurement, not implementation.

## Part 1: Problem statement, given context, and the shape of the answer

### 1.1 The question

The plain Tix program `P0` (from the brief) computes single-head attention with an N×N score
matrix:

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];
  return o;
}
```

Two brief details shape everything that follows. First, a reduction's body extends as far right as
possible, so `P0` divides by `sqrt(D)` inside the score sum and by `l[i]` inside the output sum.
Second, the f32 meaning rounds after every operation and accumulates reductions in increasing
lexicographic order — so any change of association order changes bits, and the meaning contract
needs a tolerance relation.

The question is whether FlashAttention's streaming form can be *derived* from `P0`: obtained as a
sequence of rewrites, each checked, each with a local and mechanical correctness argument — rather
than pattern-matched whole, or written by hand. "Local" means: the rule touches a bounded statement
pattern (at most four statements, once, for the final rule), and its argument is one algebraic
identity or one order-of-evaluation fact, checkable without whole-program reasoning beyond extent
and index-freedom conditions. "Mechanical" means: the argument's verification is a fixed procedure
(section 5.5), and the application's gate is a differential check against `P0` on the contract's
domain.

### 1.2 What is given, and what this design assumes

Given and fixed (from the brief):

- The Tix core grammar and its f32 meaning (all operations rounded via `Math.fround`; ordered
  reductions; `sum` from 0, `max` from −∞; inputs finite; shape errors are compile-time check
  errors).
- The framework (`src/framework/`): rewrites are versioned data with `match`, `guard`, `replace`
  and declarations (`src/framework/ir/PATTERNS-AND-REWRITES.md`); every rewrite application is its
  own transaction gated by a semantic acceptance check, and the framework's contract checks each
  pass **against the original program** `P0`, not against the previous revision; differential
  invariants sample cases deterministically from a seed (`src/framework/contracts/differential.ts`);
  evidence has assurance levels declared/checked/transferred/proof
  (`src/framework/contracts/README.md`).
- Built in parallel (not in this worktree): the Tix front end, evaluators, and a meaning contract
  with a tolerance relation.

This design *assumes* the shipped meaning contract has this shape — and depends on nothing more:

- **Domain:** an assignment of concrete shapes to the shape names plus a finite set of input-value
  generators (section 8.3 fixes a concrete domain grid for the experiment).
- **Observation:** the function's returned tensor only. This is a load-bearing assumption: if the
  observation included intermediates (`s`, `e`, …), no storage-avoiding rewrite could ever pass, and
  the question would be settled negatively by fiat. The returned tensor is the only defensible
  observation for this research.
- **Relation:** either *exact* (bit-equality of the observed f32 result) or *tolerance* — the
  candidate f32 result against the **f64 reference** of `P0`, elementwise
  `|cand − ref| ≤ ε_abs + ε_rel·|ref|`, with (ε_abs, ε_rel) contract data.

If the shipped relation differs in form (say, pure relative error), the calibration procedure of
section 6.4 is unchanged in spirit but must be redone; the probe of Step 3 already shows why pure
relative error is the wrong form (near-zero reference elements dominate it: `P0` itself scores
"9.68" under pure relative error on uniform inputs, 0.028 under the mixed form).

### 1.3 The shape of the answer

The answer is a rule set, a construct, a checking design, and an experiment:

- **Seven rules** (section 3): `inline`, `factor-const`, `split-index`, `nest-max`, `exp-shift`,
  `nest-sum`, `fold-intro`. Their arguments use exactly four algebraic facts over ℝ —
  distributivity of a constant over a sum, order-preserving index renaming, iterated max/sum over
  a rectangular split, and the exponent law `exp(a−b) = exp(a−c)·exp(c−b)` — plus one lemma, the
  *streaming lemma* (section 3.7): the FlashAttention state (maximum, rescaled sums) is a
  commutative monoid, and the two-level form equals any full combination tree of that monoid over
  the blocks. That lemma is the entire content of "FlashAttention is one pass"; everything else is
  plumbing.
- **The derivation** (section 4): thirteen applications, `P0` → `P2` → `P3` → … → `P8`, each shown
  as a complete program.
- **The construct** (section 5): `fold` — a reduction over a user-supplied associative combine on a
  tuple state — with combine functions, a declared identity, a `-inf` literal, and per-shape
  specialization for the block size.
- **Checking** (section 6): per rule, which of (recorded exact argument, exact differential gate,
  tolerance differential gate) applies; where the f32 differences come from; how ε is calibrated;
  how a combine is verified once; and the negative controls that keep the gate honest.
- **Generality** (section 7): what else the same rules reach, and what they provably do not.
- **The experiment** (section 8): hypothesis, arms, metrics, protocol, refutation conditions.

## Part 2: Preliminaries

### 2.1 Programs as statement sets

A Tix function is a set of single-assignment statements `t[I] = RHS` plus `return`. Write
`ext(t)` for a statement's index list. A statement's *free indices* are those on the left; its
*bound indices* are reduction indices on the right. An index name `d` is **free in an expression**
`E` (`d ∉ E`) if no subterm of `E` is a reduction binding `d` and no plain/affine use of `d` occurs
in `E` outside such a reduction. Extent inference follows the brief: plain (non-affine) uses fix
extents; affine-only indices require a declared type.

### 2.2 The valid domain

Behaviour is specified only on this domain (outside it, the contract reports a check error; the
brief already makes inconsistent shapes a compile-time error):

- Shapes: `N ≥ 1`, `D ≥ 1`, concrete at call time. The derivation additionally fixes a block size
  `B ≥ 1` with `B | N` and writes `T = N/B` (section 5.3 explains why specialization is needed).
- Inputs: finite f32 values. The experiment's generators (section 8.3) bound them.
- Finiteness of intermediates: all values computed by `P0` and by the derived program must be
  finite on the domain. For `P0` this holds whenever `s` is finite, since every `exp` argument is
  `s[i,j] − m[i] ≤ 0` (so `e ∈ (0, 1]`), `l[i] ≥ 1` (the maximal term contributes `exp(0) = 1`
  exactly, and adding non-negative f32 values to `1` cannot drop below `1`), and `o` is an average
  of `v` rows with weights summing to `l ≥ 1`. The derived form preserves each of these properties
  (section 3.7); the negative controls show what happens when a rule breaks them (section 6.6).

### 2.3 Conventions for the rules

Each rule is stated as: **Pattern** (the before-shape, in Tix syntax with meta-variables `c`, `S`,
`X`, …), **Replace** (the after-shape), **Side conditions** (mechanical: index-freedom, extent
arithmetic, a named guard), **Argument over ℝ** (the exact identity the step rests on), **f32
effect** (what changes, where the difference comes from), **Check** (how the application is gated;
section 6 consolidates). New statements introduced by a rule are ordinary single-assignment
statements; if a rule's introduced statement duplicates an existing one, the duplicate is shared
(one definition), which is itself bit-exact (the defining expression is deterministic).

Reduction order matters to f32 but not to the statements below: reductions always accumulate in
increasing lexicographic order of their indices, innermost listed first.

## Part 3: The rule set

### 3.1 Rule `inline` (and dead-definition removal)

**Pattern.** A statement `t[I] = E` (with no reduction binding any of `I`... in fact no conditions on
`E` at all) and a use of `t[A]` in the body of another statement `u[J] = F`.

**Replace.** Substitute `E[A]` for `t[A]` in `F`. If `t` then has no remaining uses, delete `t`'s
statement.

**Side conditions.** None beyond single-assignment well-formedness (the substituted expression's
free indices must be in scope: every free index of `E[A]` other than the fold/reduction indices
bound in `F` must be among `J` or bound in `F`).

**Argument over ℝ.** Referential transparency: `t` is a function of its inputs only; expanding a
definition preserves the denotation. One line, no cases.

**f32 effect.** None. Every operation is deterministic in the brief's semantics, so recomputing
`E[A]` yields bit-identical values; deleting an unreferenced definition cannot change any observed
value.

**Check.** Recorded argument (trivial) + **exact differential gate**: the candidate's returned
tensor must be bit-identical to `P0`'s on the case suite.

### 3.2 Rule `factor-const` (constant out of a sum)

**Pattern.** A statement `u[I] = sum(d…) (X ⊘ c)` where `c` is a subexpression with `d ∉ c` and `⊘`
is `*` or `/`. The factor may appear on either side of `X`.

**Replace.** `u'[I] = sum(d…) X`; `u[I] = u'[I] ⊘ c` (with the factor kept in the same operand
position). If `c` sits inside further operations that also avoid `d`, the rule applies to the
outermost such layer.

Two uses in the derivation: hoisting `1/sqrt(D)` out of the score sum (the brief's `P0` divides
per element), and hoisting `1/l[i]` out of the output sum. The rule is also used *inside* block
sums to lift a block-constant factor `g[i, jt]` out of a `sum(jj)`.

**Side conditions.** `d ∉ c` (syntactic index-freedom, mechanical); for `/`: `c ≠ 0` on the domain.
For the attention uses: `sqrt(D) > 0` since `D ≥ 1`; `l[i] ≥ 1` on the valid domain (section 2.2).

**Argument over ℝ.** Distributivity: `Σ_d (c·x_d) = c·Σ_d x_d`, and for `c ≠ 0`,
`Σ_d (x_d/c) = (Σ_d x_d)/c`. Finite sums, no limits, no cases.

**f32 effect.** Rounding moves: `D` (respectively `N`) per-element roundings of the multiply/divide
are replaced by one; the sum now adds differently-scaled partials. The probe (Step 3) shows this
rule is the *dominant* error mover among the tolerance steps: on the mixed metric, `P2`'s tolerance
load reached 2.6× `P0`'s on wide-range ("hot") inputs, while the streaming steps on top added at
most 1.26× further.

**Check.** Recorded argument (a ring identity, verifiable exactly by the rational-point method of
section 5.5) + **tolerance differential gate** against the f64 reference.

### 3.3 Rule `split-index` (block an index)

**Pattern.** A reduction index `j` of extent `N`, everywhere bound (in any statement's reductions or
uses).

**Replace.** Replace `j` by `B·jt + jj` with fresh indices `jt` (extent `T`), `jj` (extent `B`), so
every reduction `red(j) X` becomes `red(jt, jj) X[B·jt+jj / j]`. Statements that mention `j` only
affinely acquire a declared type fixing the new extents.

**Side conditions.** `B | N`, `B ≥ 1`, `T = N/B ≥ 1`. The affine map must be monotone in
lexicographic order — `j = B·jt + jj` with `0 ≤ jj < B` is; the guard checks this mechanically for
the family of maps the rule instantiates.

**Argument over ℝ.** Pure renaming: `(jt, jj) ↦ B·jt + jj` is a bijection
`[0,T) × [0,B) → [0,N)` that is strictly increasing in lexicographic order, so every reduction's
accumulation *sequence* (start value, then terms in order) is identical. Over ℝ the sequences were
never order-sensitive for `sum`/`max` anyway; the point is f32:

**f32 effect.** **None — bit-exact.** The per-element values are computed by the same expressions,
in the same order, with the same roundings; only the index algebra changed. The probe confirms
bit-identity of `o`, `l`, `m` on all 80 configurations.

**Check.** Recorded argument + **exact differential gate** (bit-identity against `P0`).

### 3.4 Rule `nest-max` (max over a split)

**Pattern.** `u[I] = max(jt, jj) X` (arising from `split-index`; more generally any two reduction
indices of `X`).

**Replace.** `mb[I, jt] = max(jj) X`; `u[I] = max(jt) mb[I, jt]`.

**Side conditions.** The two indices' extents are independent (rectangular domains); `X` may depend
on both.

**Argument over ℝ.** Max over a Cartesian product is the iterated max: for a total order,
`max_{(a,b)} f = max_a (max_b f)`. One line.

**f32 effect.** **None — bit-exact.** f32 `max` returns one of its operands and is associative and
commutative with identity −∞; on the valid domain there are no NaNs, so the outer max over block
maxima picks the same operand the flat scan would. (Ties and signed zeros are order-independent in
`Math.max`.)

**Check.** Recorded argument + **exact differential gate**.

### 3.5 Rule `exp-shift` (split the shift, introduce the block maximum)

**Pattern.** A statement `u[I] = sum(jt, jj) … exp(S[I, jt, jj] − m[I]) …` (the `exp` may be
multiplied by further factors, e.g. `v[B·jt+jj, x]`), where `mb[I, jt] = max(jj) S[I, jt, jj]`
already exists (introduced by `nest-max`) or is introduced by this rule.

**Replace.** Introduce

```tix
eb[I, jt, jj] = exp(S[I, jt, jj] - mb[I, jt]);
g[I, jt] = exp(mb[I, jt] - m[I]);
```

and replace the summand's `exp(S − m)` by `eb[I, jt, jj] * g[I, jt]`.

**Side conditions.** The *algebraic* identity needs nothing. The **guard** — the part that keeps
the rewrite inside the valid f32 domain — requires `mb` to be the maximum of `S` over `jj`
(the rule matches only that `mb`). This guarantees `eb ∈ (0, 1]` (argument ≤ 0) and `g ≤ 1`, so no
`exp` can overflow regardless of score magnitude. The probe's controls show the guard is not
decorative: shifting by the block *minimum* or *mean* is algebraically exact over ℝ and passes
tolerance on tame inputs, but leaves the finite domain (thousands of non-finite outputs) on
wide-range scores, where the max-shifted form stays finite.

**Argument over ℝ.** The exponent law: `exp(a−b) = exp(a−c)·exp(c−b)` for all reals, because
`(a−c) + (c−b) = a−b` and `exp(x+y) = exp(x)·exp(y)`. One line, no cases, `c` arbitrary.

**f32 effect.** Two `exp`s, one subtraction more, and one multiply per element, each rounded; the
`exp` library function itself carries ≲1 ulp. Per-element differences of a few ulp, bounded because
all three arguments are ≤ 0 pointwise under the guard.

**Check.** Recorded argument (exponent law — section 5.5) + **guard** (structural: `mb` is a
`max(jj)`-reduction of the same `S`) + **tolerance differential gate**; the gate's finiteness
requirement is what catches guard violations the structural check might miss.

### 3.6 Rule `nest-sum` (sum over a split)

**Pattern.** `u[I] = sum(jt, jj) X` (as left by `split-index`).

**Replace.** `ub[I, jt] = sum(jj) X`; `u[I] = sum(jt) ub[I, jt]`.

**Side conditions.** Rectangular extents.

**Argument over ℝ.** Associativity and commutativity of `+` over a finite rectangular index set
(finite Fubini). One line.

**f32 effect.** Reassociation: the flat length-`N` accumulation becomes `T` length-`B`
accumulations plus a length-`T` accumulation. Different partial-sum magnitudes, hence different
roundings; with non-negative summands in `(0, 1]` and the result ≥ 1 there is no cancellation, and
both orders carry O(N·u) relative error in the worst case (`u` = 2^-24).

**Check.** Recorded argument + **tolerance differential gate**.

### 3.7 Rule `fold-intro` (the streaming lemma as a rewrite)

This is the only structural rule, and the only one whose pattern spans more than one statement —
four statements, once, at the end of the derivation.

**Pattern.** For free index lists `I` (and `X` for the contraction component) and block index `jt`,
statements of exactly this shape:

```tix
m[I]        = max(jt) mb[I, jt];
g[I, jt]    = exp(mb[I, jt] - m[I]);
l[I]        = sum(jt) g[I, jt] * lb[I, jt];
ov[I, X]    = sum(jt) g[I, jt] * ob[I, X, jt];
```

**Replace.** Delete `m`, `g`, `l`, `ov`; add

```tix
(m[I], l[I], ov[I, X]) = fold(jt; sc_combine) (mb[I, jt], lb[I, jt], ob[I, X, jt]);
```

with `sc_combine` and its identity from the library (section 4, `P8`), and keep the existing
`o[I, X] = ov[I, X] / l[I]`.

**Side conditions.** `sc_combine` must be a **verified monoid** for the 3-component scalar state:
associative, commutative, with identity `(−inf, 0, 0)`, verified once (section 5.5); the element
components' free indices must match the state components' (mechanical index check).

**Argument over ℝ (the streaming lemma).** Define, on states `(m, w⃗)` (a scalar and a vector of
"sums carried at frame `m`"),

```text
combine(a, b) = (M,  a.w⃗·exp(a.m − M) + b.w⃗·exp(b.m − M)),   M = max(a.m, b.m)
```

*Claim.* Any full combination tree of elements `(m_τ, w⃗_τ)` under `combine` evaluates to
`(M, Σ_τ exp(m_τ − M)·w⃗_τ)` with `M = max_τ m_τ`.

*Proof.* Induction over the tree. A leaf is an element, in frame `m_τ` — consistent with the claim.
For a node combining subtrees with combined sets `S₁`, `S₂`, the inductive hypothesis gives their
values as `(Mᵢ, Σ_{τ∈Sᵢ} exp(m_τ − Mᵢ)·w⃗_τ)`, `i = 1, 2`. The node's frame is
`M = max(M₁, M₂) = max_{τ∈S₁∪S₂} m_τ`, and by the exponent law of rule `exp-shift`,
`exp(m_τ − Mᵢ)·exp(Mᵢ − M) = exp(m_τ − M)`, so the node's value is
`(M, Σ_{τ∈S₁∪S₂} exp(m_τ − M)·w⃗_τ)`. The result is independent of the tree shape and order, so
`combine` is associative and commutative, and the identity `(−∞, 0, 0⃗)` combines trivially
(`exp(−∞ − M) = 0`). ∎

Now match the pattern against the lemma: the source's `m[I] = max(jt) mb` is `M`; its
`l` and `ov` are exactly `Σ_t exp(mb_t − M)·lb_t` and `Σ_t exp(mb_t − M)·ob_t` — the lemma's
right-hand side with elements `(mb_t, (lb_t, ob_t))` — and the `fold` (section 5) is by definition a
full left-combination of those elements starting from the identity. So the replacement denotes the
same function over ℝ.

**f32 effect.** The rescale factors `exp(a.m − M)`, `exp(b.m − M)` are each ≤ 1 (arguments ≤ 0 by
the definition of max), so no overflow; each combine step costs ≤ 2 multiplies + 1 add per
component plus 2 `exp`s, each rounded. The association order differs from the source's flat
two-level sums (it is a left fold), and the running state is rescaled at most once per block in
which the maximum grows. Worst-case relative error O(T·u) beyond the inherited differences, plus
≤ 1 rescale-rounding per block. The probe: the streaming steps (this rule and everything since
`P2`) add ≤ 1.26× on top of `P2`'s load across the whole grid; the total streaming form stayed
within 2.87× of `P0`'s own f32 error (mixed metric).

**Check.** Recorded argument (the lemma, plus the combine's once-verified monoid evidence —
section 5.5) + **tolerance differential gate** against the f64 reference.

**Why this rule carries the algorithm.** Every earlier rule is one-line algebra. All of
FlashAttention's actual content — the running maximum, the rescaling of the running state, the
single pass — is the lemma's monoid, and the lemma's proof is two lines of induction over an
arbitrary tree, using only the exponent law already needed by `exp-shift`. The rule is *directed*:
it consumes the two-level form and produces the fold; it never applies the reverse.

## Part 4: The derivation, `P0` → `P8`, as a sequence of rule applications

Thirteen applications. `B` is a block size chosen per shape class (cost model; the experiment
varies it), `T = N/B`. Types are shown where extent inference needs them. Each step names its rule,
its side conditions, and its gate (bit-exact `≡` or tolerance `≈`); the full program is shown at
each milestone.

**Step 1 (`inline`, application 1).** Substitute `e`'s definition into `l`'s body. `e` still has one
use. Gate: `≡`.

**Step 2 (`inline`, application 2).** Substitute `e` into `o`'s body; `e` is now dead, and its
statement is deleted. Gate: `≡`.

**Step 3 (`factor-const`, application 3).** Hoist `1/sqrt(D)` out of the score sum. Gate: `≈`.

**Step 4 (`factor-const`, application 4).** Hoist `1/l[i]` out of the output sum. Gate: `≈`.

Result — the **canonical source form `P2`**, which is the input pattern the rest of the derivation
recognizes (softmax normalizer + contraction + final division):

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  qk[i, j] = sum(d) q[i, d] * k[j, d];
  s[i, j] = qk[i, j] / sqrt(D);
  m[i] = max(j) s[i, j];
  l[i] = sum(j) exp(s[i, j] - m[i]);
  ov[i, x] = sum(j) exp(s[i, j] - m[i]) * v[j, x];
  o[i, x] = ov[i, x] / l[i];
  return o;
}
```

**Step 5 (`split-index`, application 5).** Replace `j` by `B·jt + jj` everywhere. Gate: `≡`
(bit-exact; the probe verifies `o`, `l`, `m` bit-identical across all 80 configurations):

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  qk[i, jt, jj]: f32[N, T, B] = sum(d) q[i, d] * k[B*jt + jj, d];
  s[i, jt, jj] = qk[i, jt, jj] / sqrt(D);
  m[i] = max(jt, jj) s[i, jt, jj];
  l[i] = sum(jt, jj) exp(s[i, jt, jj] - m[i]);
  ov[i, x] = sum(jt, jj) exp(s[i, jt, jj] - m[i]) * v[B*jt + jj, x];
  o[i, x] = ov[i, x] / l[i];
  return o;
}
```

**Step 6 (`nest-max`, application 6).** Split the maximum into block maxima. Gate: `≡`:

```tix
  mb[i, jt] = max(jj) s[i, jt, jj];
  m[i] = max(jt) mb[i, jt];
```

**Steps 7–8 (`exp-shift`, applications 7–8).** Introduce the block-maximum shift in `l`'s and
`ov`'s summands (the second application shares the introduced statements). Guard: `mb` is the
`max(jj)` of the same `s`. Gate: `≈`:

```tix
  eb[i, jt, jj] = exp(s[i, jt, jj] - mb[i, jt]);
  g[i, jt] = exp(mb[i, jt] - m[i]);
  l[i] = sum(jt, jj) eb[i, jt, jj] * g[i, jt];
  ov[i, x] = sum(jt, jj) eb[i, jt, jj] * g[i, jt] * v[B*jt + jj, x];
```

**Steps 9–10 (`nest-sum`, applications 9–10).** Nest the two sums. Gate: `≈`:

```tix
  l[i] = sum(jt) (sum(jj) eb[i, jt, jj] * g[i, jt]);
  ov[i, x] = sum(jt) (sum(jj) eb[i, jt, jj] * g[i, jt] * v[B*jt + jj, x]);
```

**Steps 11–12 (`factor-const`, applications 11–12).** Lift the `jj`-free factor `g[i, jt]` out of
the inner sums. Gate: `≈`:

```tix
  lb[i, jt] = sum(jj) eb[i, jt, jj];
  ob[i, x, jt] = sum(jj) eb[i, jt, jj] * v[B*jt + jj, x];
  l[i] = sum(jt) g[i, jt] * lb[i, jt];
  ov[i, x] = sum(jt) g[i, jt] * ob[i, x, jt];
```

**Step 13 (`fold-intro`, application 13).** Replace the four statements `m`, `g`, `l`, `ov` (now
exactly the rule's pattern) with the fold. Gate: `≈`. The **streaming form `P8`**:

```tix
// library: the combine, verified once as an associative commutative monoid
// with identity (-inf, 0, 0); scalar components, applied per free-index instance.
fn sc_combine(a: (f32, f32, f32), b: (f32, f32, f32)): (f32, f32, f32) {
  M  = max(a0, b0);
  r1 = exp(a0 - M);
  r2 = exp(b0 - M);
  return (M, a1 * r1 + b1 * r2, a2 * r1 + b2 * r2);
}

fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  qk[i, jt, jj]: f32[N, T, B] = sum(d) q[i, d] * k[B*jt + jj, d];
  s[i, jt, jj] = qk[i, jt, jj] / sqrt(D);
  mb[i, jt] = max(jj) s[i, jt, jj];
  eb[i, jt, jj] = exp(s[i, jt, jj] - mb[i, jt]);
  lb[i, jt] = sum(jj) eb[i, jt, jj];
  ob[i, x, jt] = sum(jj) eb[i, jt, jj] * v[B*jt + jj, x];
  (m[i], l[i], ov[i, x]) = fold(jt; sc_combine) (mb[i, jt], lb[i, jt], ob[i, x, jt]);
  o[i, x] = ov[i, x] / l[i];
  return o;
}
```

This is FlashAttention: per-block scores, block maximum, block exponentials (all in `(0, 1]`),
block normalizer and output accumulator, one fold over blocks with rescaling whenever the maximum
grows, final division. `s` and `e` exist only within one block iteration — as arrays in the
reference semantics, and, after the lowering rules of section 5.6, as block-local temporaries that
never reach device memory. The FLOP count is unchanged (the function *is* an N²·D computation);
what changes is memory traffic: O(N·D) instead of O(N²) bytes.

## Part 5: What Tix lacks — the `fold` construct

### 5.1 The gap, precisely

A Tix reduction produces a single f32 per output element, and its combine is fixed (`+` with start
0, or `max` with start −∞). The streaming form's state is *three* quantities per free-index
instance — a running maximum, a running normalizer, a running output vector — combined by a
rescaling function that is not addition. No arrangement of core-Tix statements expresses it: the
running state is inherently sequential over `jt`, and core Tix has no sequential construct. The IR
therefore needs a reduction whose state is not a single number: **a fold over an index with a
user-supplied associative combine on a tuple state.** Four additions make this expressible; they
are the whole extension.

### 5.2 The extension (call it Tix⁺)

**(a) Scalar tuple types for combines.** `(f32, f32, f32)` — the per-instance state type. Tuples
appear in exactly two places: the parameters and return of a combine function, and the left and
right sides of a fold statement. No tuple-valued tensors, no nested tuples. Combine bodies are
ordinary statements over 0-dimensional tensors (Tix⁺ allows a statement with an empty index list);
field access is positional (`a0`, `a1`, `a2`).

**(b) The `fold` statement.**

```tix
(r1[Is_1], ..., rk[Is_k]) = fold(j; combine) (x1[Je_1], ..., xk[Je_k]);
```

The free indices of each element component `x_i` are exactly the state component's `Is_i` plus the
fold index `j`. Extents: `j` is bound by the fold and inferred from its plain uses in the element
(the core's rule, unchanged — `jt` appears plainly in `mb[i, jt]`, so its extent comes from `mb`'s
type); the `Is_i` are inferred per the core's rule.

**(c) Monoid declarations.** A combine must be declared with an identity:

```tix
monoid sc_combine identity (-inf, 0, 0);
```

The identity is needed to define the fold's start state, so Tix⁺ adds the literal `-inf` (used in
identities; `exp(-inf) = 0` in the f32 meaning, `max(-inf, x) = x`). An explicit non-identity start
is allowed for generality (chunked folds) but is not used by this derivation; verification of the
identity is part of the once-per-combine check (section 5.5).

**(d) Shape specialization for the block size.** The derived program's types mention `T = N/B`,
which is not an affine expression of shape names, so the core grammar cannot write it symbolically.
The derivation is therefore applied **per shape class**: at a call with concrete `(N, D)`, the
compiler chooses `B` (a cost model; the experiment measures over a grid), and `B` and `T` are
literals in the specialized program. This is consistent with the meaning contract, whose domain
already enumerates concrete shapes; every gate runs per shape class. The alternative — derived
shape parameters with constraints (`T·B = N`) — is a language addition listed under Later.

### 5.3 Semantics over the reals

For each instance `ι` of the free indices (e.g. each `i`, and each `x` for the `ov` component):

```text
state ← identity
for j = 0 .. ext(j) − 1:            // increasing order
    state ← combine(state, element(ι, j))
r_i[ι] ← state_i
```

That is: the fold is a **sequential left fold** per instance, and this is the *reference meaning* —
deliberately the same convention as the core's ordered reductions. Associativity is *not* part of
the meaning; it is a **lowering license**: once the combine's associativity (and commutativity,
where the lowering wants it) is verified once, the lowering may reassociate — split the fold range
across thread groups and combine the partial states with the same combine (FlashAttention-2 /
flash-decoding style) — and each such lowering is checked against the fold's reference meaning
under the tolerance relation, and through it against `P0`.

### 5.4 f32 meaning

All state components are f32 values. The identity constants are rounded literals (`-inf` is exact).
For each `j` in increasing order: the element components' values are the f32 values of the
referenced statements (computed by the usual per-operation rounding — and *identically* whether
they were materialized earlier or recomputed inside the fold, since the element statements are pure
and state-independent); then one combine application runs, each of its operations rounded per the
usual rule; the resulting state is carried as f32 into the next step. Multiple fold indices (none
in this derivation) iterate lexicographically, first-listed outermost, as in the core. On the valid
domain every `exp` argument in `sc_combine` is ≤ 0 and every factor is ≤ 1 (section 3.7), so the
fold is overflow-free; the first combine with the identity uses `exp(-inf − M) = 0` and never
`-inf − (-inf)`, because block maxima are finite when scores are.

### 5.5 Verifying a combine once

Each combine in the library carries once-per-version evidence, following IRWB-006's rule-verifier
pattern and the framework's assurance levels:

1. **Associativity and commutativity**, symbolically: case-split on which of the three maxima is
   the largest (3! = 6 cases); within each case `max` resolves to a specific operand and the
   residual identity lives in the ring generated by `exp` of affine forms of the atoms
   (`a0, a1, a2, b0, ...`). Check it by exact rational arithmetic at several random rational
   points: a nonzero rational-coefficient combination of `exp` of *distinct* rational linear forms
   cannot vanish (Lindemann–Weierstrass, linear form), so a 128-bit-precision zero at 5 sampled
   points with distinct exponent values is evidence of the identity, not luck. This is *checked*
   assurance, probabilistic in the mechanism and recorded with its sampling details — not `proof`.
2. **Identity**: `combine(id, x) = x` (a 2-case split, same method).
3. **Sampled f32 conformance** of the combine on edge inputs (`-inf` as the incoming frame, equal
   maxima, zeros), catching slips the symbolic pass cannot express.

Per application, nothing is re-verified; the application's gate is the differential check of
section 6. An external proof assistant certificate for the same propositions would upgrade the
assurance to `proof` via the framework's existing boundary (`recordProof`) — Later.

### 5.6 Lowering rules that turn the fold into the kernel

Four lowering steps sit between `P8` and a kernel; the fourth is optional, and each is itself a
checked pass:

- **L1 element-fuse (exact).** Move the element statements (`s`, `eb`, `lb`, `ob`, `qk` — all
  `jt`-dependent, none state-dependent) into the fold loop. Bit-exact, because their values are
  pure functions of the inputs: computing them per block reproduces identical f32 values. The gate
  is the exact relation.
- **L2 block-local lifetime (exact).** Any tensor whose only consumers are inside one fold
  iteration gets per-block storage (registers/smem), not a device array. This is a liveness fact,
  mechanical from the statement graph; after L1 it covers every N×N-indexed statement. **This is
  the step that delivers the traffic claim** — the derivation makes the lifetimes local; the
  lowering exploits them. The gate is the exact relation (outputs unchanged); the *traffic* effect
  is not assumed but measured (section 8).
- **L3 free-index parallelism (exact).** Instances (`i`-tiles) are independent; distribute them
  over thread blocks. Exact by the absence of cross-instance state.
- **L4 fold-range splitting (tolerance).** Split `jt` across groups and combine the partial states
  with `sc_combine` — legal by the once-verified associativity, checked under tolerance. Not used
  by the primary experiment; listed for completeness.

## Part 6: Checking

### 6.1 The gate

Every rewrite application runs the framework's gate: native validation, the edit, then the
semantic acceptance check — a differential invariant against **`P0`** (the original program), on
the contract's domain, under the contract's relation. The relation is per rule (table below): the
exact relation (bit-equality of the returned tensor) for rules whose f32 effect is provably none,
the tolerance relation (against the f64 reference of `P0`) for the rest. Case suites are seeded and
deterministic (`src/framework/contracts/differential.ts`); the transcript records, for each of the
thirteen applications, the matched pattern with evidence, the gate's outcome, and the case count —
the same per-step records the framework already produces.

### 6.2 Per-rule summary

| # | Rule | Applications | Argument over ℝ (once, recorded) | Per-application gate | f32 difference |
|---|------|---|---|---|---|
| 1 | `inline` | 2 | referential transparency | exact (bit-identity) | none |
| 2 | `factor-const` | 4 | ring distributivity, `c ≠ 0` for `/` | tolerance | per-element factor roundings removed; partials rescaled — the dominant tolerance-step error mover (probe: `P2` load up to 2.6× `P0`'s) |
| 3 | `split-index` | 1 | order-preserving affine bijection on the iteration domain | exact (bit-identity) | none (probe: 80/80 rows bit-identical) |
| 4 | `nest-max` | 1 | max over a product = iterated max | exact (bit-identity) | none (f32 `max` selects an operand) |
| 5 | `exp-shift` | 2 | exponent law (any shift `c`) | guard (shift = block max) + tolerance | 2 `exp` + 1 multiply + 1 subtract rounding per element, all arguments ≤ 0 |
| 6 | `nest-sum` | 2 | finite-sum associativity (Fubini) | tolerance | reassociation; no cancellation (summands in `(0,1]`, result ≥ 1) |
| 7 | `fold-intro` | 1 | streaming lemma (monoid; combine verified once) | tolerance | ≤ 1 rescale (2 roundings/component) per max-growing block; left-fold association; probe: ≤ 1.26× on top of `P2` |

So the answer to "exact argument, tolerance check, or both" is: **every rule carries a recorded
exact argument over ℝ; every application additionally runs a differential gate — exact for rules 1,
3, 4, tolerance for rules 2, 5, 6, 7.** The exact steps cost no tolerance budget; all f32 drift is
spent by four rules, and the probe bounds it (below).

### 6.3 Where the f32 differences come from

Concretely, by source: (i) `factor-const` changes *which* roundings happen (per-element scaling
roundings disappear, one final rounding appears, partial sums carry different magnitudes) — the
probe shows this dominates: `P2`, which is `P0` plus only rules 1–2, already accounts for 2.6× of
the 2.87× worst-case drift; (ii) `nest-sum` and the
fold's left association change the *order* of additions — O(N·u) worst-case relative error both
ways, no cancellation on this program because all `exp`-summands are non-negative and the
normalizer is ≥ 1; (iii) `exp-shift` and the combine's rescale add a few ulp per element/block
through extra `exp`, multiply and subtract roundings, all with arguments ≤ 0, so magnitudes stay in
(0, 1]; (iv) the final division is one rounding in both forms. Nothing in the derivation subtracts
nearly-equal large numbers.

### 6.4 Calibrating ε

The tolerance relation's `(ε_abs, ε_rel)` is contract data, calibrated per input class from
`P0`'s own f32 error (IRWB-011's noise-floor method, with its bias-vs-divergence lesson): run `P0`
f32 against the f64 reference on the class's case suite, take the worst mixed load
`|P0 − ref| / (ε_abs + ε_rel·|ref|)`, and set the safety factor so that ε covers the *derivation's*
added drift. Probe evidence (80 configurations; mixed metric at `ε_abs = 2^-20`):

| input class | max load `P0` at `ε_rel = 2^-10` | max load `P8` | max `P8`/`P0` |
|---|---|---|---|
| uniform ±1 | 0.028 | 0.020 | 1.13 |
| N(0,1) | 0.099 | 0.099 | 1.31 |
| hot (scores ≈ ±15) | 1.063 | 1.048 | 2.87 |
| extreme (scores ≈ ±90) | 9.481 | 4.390 | 2.78 |

Reading: `ε_rel = 2^-10` covers `P0` and `P8` on uniform/normal/hot through `N = 512` — `P0`'s own
noise floor is the binding constraint, not the derivation. The observed worst-case derivation
drift is 2.87× `P0`'s, so a safety factor of 10 on the measured `P0` floor gives the derivation
~3.5× headroom; the design standard is "ε = 10× the measured `P0` floor, floor at `ε_rel = 2^-10`,
per input class". The extreme class is outside that ε *for `P0` itself* — it is excluded from the
contract's domain rather than counted against the derivation. The secondary report (the per-step
`P8/P0` load ratio) separates "within budget" from "systematically worse", so a derivation that
passed at 9.9× would still be flagged for review.

### 6.5 The chain of meanings

Three levels are checked, each against the level above: the GPU kernel's outputs against `P8`'s
reference meaning (the sequential fold; exact for L1–L3, tolerance for L4), and every intermediate
program including `P8` against `P0` (exact or tolerance per rule, as above), and `P0`'s f32 against
the f64 reference (the ε calibration). No step is trusted because a previous step passed; the
framework's contract fixes the comparison target at `P0`.

### 6.6 Negative controls (keeping the gate honest)

Three mutations of the derivation are run through the same gates and must be rejected; if any is
accepted, the checking design is refuted regardless of performance:

- **Broken combine** (drop the incoming state's rescale factor): a genuine correctness mutation;
  the probe shows errors 10²–10⁴× `P0`'s on every class — rejected by any sane ε, and also rejected
  structurally by the once-per-combine associativity check.
- **Min-shift** (shift the element's `exp` by the block minimum): algebraically exact over ℝ (the
  identity holds for any shift), so it *passes tolerance on tame inputs* — the probe confirms this —
  and is rejected only by the **finiteness** part of the domain on wide-range scores, where
  thousands of outputs go non-finite while the max-shifted form stays finite. This control
  demonstrates the honest division of labour stated in section 3.5: the *guard* carries the domain
  argument structurally; sampled checking catches it only when the case generator reaches
  wide-range inputs — so the experiment's domain grid must include them.
- **Mean-shift** (block mean): as min-shift, with earlier overflow onset in some shapes; rejected
  the same way.

## Part 7: Generality

### 7.1 Programs the same rule set reaches

- **Softmax** (the brief's example program): the same derivation minus the contraction component —
  `fold-intro` on a 2-component state `(m, l)` (drop `ov`; the pattern is a sub-pattern), then the
  output `y[i,j] = exp(x[i,j] − m[i]) / l[i]` as a separate map. Reached.
- **Log-sum-exp**: `lse[i] = m[i] + log(l[i])` after the same `(m, l)` fold. Reached.
- **The general pattern**: any program whose statements match, for arbitrary score expression `S`
  (not just `qk/√D` — biases, learned additions, any Tix expression over the inputs) and arbitrary
  value expression `V` (possibly `i`-dependent),
  `m = max(j) S`, `l = sum(j) exp(S − m)`, `ov = sum(j) exp(S − m)·V`, `o = ov/l` — softmax
  followed by a contraction, attention being the instance with `S = qk/√D`, `V = v`. Reached,
  with the same thirteen steps.
- **Multi-head attention**: a free index `h` throughout. Reached (state components gain `h`).
- **One-pass mean/variance (layernorm statistics)**: `μ = sum(d) x[d]/D`,
  `σ² = sum(d) x[d]²/D − μ²` — reached *by the construct* with a different verified monoid: the
  pair-add combine on state `(Σx, Σx²)` (associativity trivial, `fold-intro`'s degenerate case with
  no maximum component). Reached — but note the tolerance gate then does real work: the one-pass
  variance formula cancels where the two-pass one does not, and the gate may (correctly) reject the
  fused form on some input classes. The framework's value here is precisely that the rewrite can be
  *tried, checked, and rolled back*.

### 7.2 Programs the rule set does not reach, and why

- **Masked / causal attention**: not expressible in the Tix core at all (no `select`/`where`;
  arithmetizing a mask with `±huge` breaks the finiteness domain through `exp`). With a future
  `select` primitive the rules apply unchanged (`select` perturbs `S`; the lemma is indifferent to
  how `S` and `V` are computed) — but that is Tix⁺'s problem, not this rule set's. Not reached in
  the fixed core.
- **Already-factored exponentials** (`e = exp(s) · exp(−m)`): the rule set is deliberately
  *directed* — it splits `exp` and factors constants out of sums, never joins. Joining
  (`exp(x)·exp(y) → exp(x+y)`) is the numerically unsafe direction (each factor can overflow), and
  the source form is already streaming-compatible anyway once folded; the derivation leaves it
  alone. Not reached, by design.
- **Cross-frame normalizers** (`o = exp(S − max S)·V / l` with `l` the softmax of a *different*
  score `T`): the pattern of `fold-intro` requires the normalizer and the contraction to share one
  frame. The fix is a product monoid (two `(m, l)` components combined componentwise — still
  associative), which the current pattern does not look for. Not reached by the stated patterns;
  one-line extension, listed under Later.
- **Doubly nested softmax** (softmax over `x` of a tensor that is itself a softmax over `j`): the
  outer `fold-intro` matches (its `S` is the inner fold's result), but the derived kernel
  recomputes the inner fold once per outer block — correct, and the gates pass, but a traffic cost
  model should refuse the rewrite or the lowering must memoize. Reached *formally*, rejected
  *pragmatically*; the design records this as a cost-model responsibility, not a rule-set gap.
- **Max over a different index than the folded one** (`m = max(d) s[i,j,d]`): the pattern requires
  the maximum to range over the fold index. Not reached, correctly: a maximum over another index
  does not stream with the fold and the derivation has nothing to say.
- **Recurrences** (cumulative sums, scans): not expressible in core Tix (no sequential construct
  over an output index), and outside the fold's meaning (the fold returns final states only). Not
  reached; needs a `scan` construct (Later).

The pattern library is small on purpose: seven rules whose arguments are four identities and one
two-line lemma. The reach boundary above is the *matching* boundary, and each miss names its
reason — which is the point of stating generality as part of the research design.

## Part 8: The experiment

### 8.1 Hypothesis

**H.** On the stated domain, the thirteen-application derivation of `P0` → `P8` succeeds with
every gate green, and the derived kernel is streaming and competitive: measured DRAM bytes and GPU
kernel time scale as O(N) in `N` (D fixed), the derived kernel stays within 2× of a hand-written
streaming kernel at every grid point, and the unfused lowering is beaten by ≥ 5× in time at
`N ≥ 1024`, on the GB10.

### 8.2 Arms

1. **Unfused**: `P0` lowered statement-per-kernel; `s` and `e` are device arrays of N² f32. The
   O(N²) baseline.
2. **Derived**: `P8`, transcribed to CUDA by applying the lowering rules L1–L3 mechanically (per
   block: load `k`,`v` tiles, compute the score block, block max, block `exp`, block sums, one
   combine; per-`i`-tile thread block; f32 throughout, no tensor cores — the rules say nothing
   about matmul lowering, so the score sum is a plain f32 dot product).
3. **Hand-written streaming control**: the same algorithm written from the FlashAttention
   description *without* reference to `P8`, same tiling choices, f32, no tensor cores — isolating
   the *derivation* claim from kernel-tuning skill.
4. **Blocked two-level** (optional): the intermediate form before step 13 — per-block `mb`,
   `lb`, `ob` plus a global `m` pass, two passes over the score row, no fold. Its traffic sits
   between arms 1 and 2; measuring it shows the fold, not the blocking, is what buys the final
   factor. It isolates rule 7's contribution.

(Informational, not a refutation arm: any vendor fused-attention routine available on the
machine.)

### 8.3 Domain, metrics, protocol

**Domain.** Shapes `N ∈ {256, 512, 1024, 2048, 4096, 8192}`, `D ∈ {64, 128}`, `B ∈ {32, 64, 128}`
with `B | N`; inputs from the three standard classes of the probe (uniform ±1, N(0,1), hot ≈
scores ±15), plus the wide-range class for the finiteness controls; ε per section 6.4. The
derivation transcript is replayed per grid point (the checks are per shape class).

**Primary metric.** DRAM bytes moved per launch (profiler counters; the GB10's unified memory
makes this the honest traffic measure) and GPU kernel wall time (CUDA events; median of 50 after
10 warmup). Secondary: per-step differential-gate outcomes and f32 error loads (the probe's mixed
metric, re-run on the actual evaluators when the parallel front end lands); the `P8/P0` load ratio
per step; negative-control rejections; derivation length (must stay ≤ 15 applications).

**Fitting.** Log-log fit of bytes and time against `N` per `D`; slopes and their confidence
intervals. The derived kernel's slope claims O(N): unfused must slope ≈ 2.

### 8.4 What refutes H

Any one of the following refutes it, and each names what would have to change:

1. **Any of the thirteen applications fails its gate on any grid point** (exact step not
   bit-identical, or tolerance step outside ε) — the checked-derivation claim is false for this
   rule set; the rule or the ε calibration is wrong and must be fixed, not the data.
2. **The derived kernel's bytes slope ≥ 1.5**, or derived bytes exceed 2× the hand-written
   kernel's at any grid point — the derivation does not actually produce a streaming kernel (most
   likely a lifetime/lowering failure: some N² tensor escaped block-local lifetime).
3. **The derived kernel exceeds 2× the hand-written kernel's time at any grid point, or is ever
   slower than the unfused lowering at `N ≥ 1024`** — the derived form is not competitive; the
   gap must be attributed (tiling? lowering? the fold's sequentialism?) before any claim survives.
4. **Any negative control is accepted by its gate** — the checking design is vacuous and must be
   repaired before any other result counts.
5. **The derived kernel's f32 error load exceeds 10× `P0`'s on any standard-domain grid point** —
   the ε calibration or the rule order is numerically unsound; the probe already bounds the
   expected value at 2.87×, so this would indicate a GPU-path-specific divergence (e.g. a lowering
   bug), which is itself a finding.

Result 1 or 4 refutes the *research question's* core (checked, local derivation); results 2, 3, 5
refute the *performance/accuracy* claims and demote the answer to "derivable but not yet
competitive", with the transcript localizing the failure.

### 8.5 Implementation phases (the plan behind the experiment)

- **Phase 0 (done, this ticket):** the host probe — the algebra, the bit-exactness of steps 1, 3,
  4, the ε calibration evidence, the negative controls. No framework or GPU code.
- **Phase 1:** the Tix⁺ constructs in the IR (fold statement, combine functions, monoid
  declarations) and their evaluators (f32 reference and f64), with the combine verifier of
  section 5.5. Gate: the probe's checks re-run against the real evaluators.
- **Phase 2:** the seven rules as versioned rewrite data against the framework's engine, the two
  relations wired as differential invariants, the pinned thirteen-step transcript. Gate: the
  transcript runs green per shape class on the domain grid; negative controls rejected.
- **Phase 3:** lowering — L1–L3 transcribed CUDA for the derived arm, the unfused lowering, and
  the hand-written control. Gate: kernel outputs against `P8`'s reference meaning.
- **Phase 4:** the GB10 measurement campaign of section 8.3, including the wide-range class and
  the negative-control rejections; analysis of slopes and the refutation checks of 8.4.
- **Phase 5:** generality probes (softmax, log-sum-exp, one-pass layernorm statistics,
  multi-head) through the same transcript machinery, each with its own ε calibration.

### 8.6 What the experiment cannot show

The transcript proves the *existence* of a checked, local derivation for this program family and
measures its yield on one GPU. It does not show search autonomy (the sequence is pinned, not
discovered — IRWB-010's territory), does not cover f16/bf16 tensor-core lowering (different
rounding, different contract), and does not measure end-to-end training throughput. These are
listed under Later rather than absorbed into H, which stays falsifiable as stated.

### 8.7 Open questions

- Does the shipped Tix meaning contract match the assumed shape (domain/observation/return-only,
  elementwise ε against an f64 reference)? If not, section 6.4's calibration procedure is the same
  but its numbers are not.
- Is the sequential left fold's reference meaning cheap enough to check on large `N`, or do the
  gates need the case budget tuned per shape class? (The differential invariant already supports
  case budgets; the question is cost.)
- Will the layernorm one-pass form actually pass its tolerance gate on realistic inputs, or is the
  cancellation fatal at every ε that still admits `P0`? (Phase 5 measures; either answer is a
  result.)
- Can the guard "shift = block maximum" be weakened to "shift ≥ every element of its block" for
  programs whose block statistic is a cheaper over-estimate than the maximum, without losing the
  finiteness argument? The algebra already allows it; the domain claim does too; nothing needs it
  yet.

## Part 9: Design decisions and alternatives

Each decision names its simplest alternative and why it was not taken.

- **D1: rules at the Tix statement level, not at a lowered loop IR.** The algebra that makes
  streaming possible (`exp`-shift, the monoid) is statement-level; at the loop level it is
  obscured by carried-dependence reasoning, and "local, mechanical" would be lost. Alternative:
  derive on loops/SSA after lowering — rejected: the checks would need whole-loop analysis where
  this needs index-freedom tests.
- **D2: the fold's reference meaning is the sequential left fold.** It matches the core's ordered
  reductions, makes the reference deterministic and reproducible, and confines reassociation to
  the *lowering* where the once-verified associativity licenses it and the tolerance gate checks
  it. Alternative: define the fold's meaning as "any order within tolerance" — rejected: an
  ill-defined reference cannot anchor a differential gate or a counterexample report.
- **D3: a minimal tuple state (flat, combine-only) rather than general tuples or a scan.** The
  streaming form needs exactly: k scalar components per instance, one combine, one identity.
  Alternatives: general tensor tuples (more IR surface for no additional reach), or a prefix
  `scan` (reaches more programs — recurrences — but drags in an output-indexing semantics this
  question does not need; Later).
- **D4: per-shape specialization for `B`, `T` rather than derived shape parameters.** `T = N/B` is
  not an affine dim expression, and the meaning contract's domain is per-shape anyway. The
  alternative (shape parameters with constraints) is a language change postponed to Later.
- **D5: both a recorded once-per-rule argument *and* a per-application differential gate.** The
  argument makes the step's correctness local and mechanical; the gate catches what arguments miss
  (guard slips, ε mis-calibration, codegen). Alternative: sampling alone — rejected: sampled
  checking of a structural rule is exactly what the min-shift control shows to be insufficient on
  tame inputs. Alternative: argument alone — rejected: the framework's contract, and this
  repository's habit, is that publication is gated by running checks.
- **D6: ε calibrated from `P0`'s measured f32 error (noise floor) with a 10× safety factor.**
  Alternative: a fixed ulp-derived ε — rejected: the probe shows `P0`'s own load varies by 300×
  across input classes; a fixed ε either rejects `P0` or accepts everything.
- **D7: a pinned derivation transcript (scripted `applyOnce` sequence), not a search.** The
  research question is whether a *derivation exists as checked steps*; search is a later question
  (IRWB-010) once the library is trusted. Alternative: saturation search over the seven rules —
  unnecessary risk of non-termination and of obscuring which steps carried the algorithm.
- **D8: hand-transcribed CUDA for the derived arm, following the written lowering rules.**
  Alternative: build the codegen first — rejected for the first experiment: codegen quality would
  confound the derivation claim; the hand-written control equalizes transcription across arms.
- **D9: the hand-written control uses the same algorithm, tiling and precision as the derived
  kernel.** The claim under test is *derivability*, not kernel-tuning supremacy; a
  tensor-core-tuned vendor kernel is reported informationally. Alternative: compare against a
  production FlashAttention — interesting, but it answers a different question.

## Part 10: Later

One line each; nothing above depends on these.

- A `select`/`where` primitive, extending the pattern library to masked and causal attention.
- Automatic CUDA codegen for `fold` (replacing hand transcription) with its own meaning gates.
- Fold-range splitting across thread groups (L4) and its tolerance measurements.
- Derived shape parameters (`T = N/B`) to avoid per-shape specialization.
- A general `scan` construct for outputs that need per-prefix states.
- Product-monoid matching for cross-frame normalizers.
- Equality-saturation / search over the rule library (IRWB-010's framework).
- External proof certificates for the ℝ fragment via `recordProof` (ITP bridge).
- Multi-head batching and head-parallel lowering.
- A cost model for `B` (analytic traffic model plus autotuning) and a cost gate for rewinds.
- Partial blocks (`B ∤ N`) via masking.
- f16/bf16 and tensor-core score sums (different rounding; new contract, new ε).
- General normalizer weights `u[i,j]` in the softmax pattern.
- Non-identity fold starts (chunked/streams with checkpointing).

## References

- `src/framework/ir/PATTERNS-AND-REWRITES.md` — rules as versioned data; schedules; per-step
  results and acceptance gates.
- `src/framework/ir/rewrites.ts`, `src/framework/ir/patterns.ts` — the engine the seven rules
  target.
- `src/framework/contracts/README.md` — definition APIs, assurance levels, transactions; the
  meaning check against the original artifact.
- `src/framework/contracts/differential.ts` — sampled differential invariants, seeds, case reuse.
- IRWB-006 (`ttmp/2026/11/25/IRWB-006--*`) — rules as verified data; once-per-rule evidence.
- IRWB-008 (`ttmp/2026/11/26/IRWB-008--*`) — exact acceptance of rule-citing edits; meaning
  check v2.
- IRWB-011 (`ttmp/2026/11/26/IRWB-011--*`) — tolerance contracts calibrated on a measured noise
  floor; bias vs divergence.
- `scripts/01-numeric-probe.mjs`, `various/01-probe-results.txt` (this ticket) — the probe whose
  numbers appear in sections 6.3–6.4 and 6.6.
- FlashAttention (Dao et al., 2022) and FlashAttention-2 (Dao, 2023) — the algorithm being
  derived; this design's contribution is the checked derivation path to it, not the algorithm.
