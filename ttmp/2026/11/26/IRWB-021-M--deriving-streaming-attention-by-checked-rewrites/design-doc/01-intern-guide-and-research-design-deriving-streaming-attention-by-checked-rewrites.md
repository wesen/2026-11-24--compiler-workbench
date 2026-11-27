---
Title: Intern guide and research design — deriving streaming attention by checked rewrites
Ticket: IRWB-021-M
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: the sampled meaning check as a differential invariant; the shape a tolerance relation has to fit
    - Path: repo://src/framework/contracts/types.ts
      Note: CaseComparison, CheckResult, Assurance, Preservation, Correspondence - the vocabulary the new contract extends
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass, the stage list every pass goes through and where a contract is consulted
    - Path: repo://ttmp/2026/11/25/IRWB-006--rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks/design-doc/01-intern-guide-rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks.md
      Note: the rule-as-data architecture and the evidence-strength vocabulary this design reuses
    - Path: repo://ttmp/2026/11/26/IRWB-008--exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-as-the-standard-for-new-pipelines/design-doc/01-intern-guide-exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-for-new-pipelines.md
      Note: exact derivation of edits and the step-level vs chain-level warning; this design's checking is exact where it can be and tolerance where it cannot
    - Path: repo://ttmp/2026/11/26/IRWB-011--sketch-image-level-contracts-for-float-freedom-tolerance-contracts-judged-on-rendered-frames/design-doc/01-sketch-guide-image-level-contracts-for-float-freedom.md
      Note: the proposal for a measured tolerance contract and a checked-tolerance assurance, which this domain needs for real
ExternalSources: []
Summary: "Research design for deriving FlashAttention from plain Tix attention by five checked rewrites. Adds one Tix construct (a fold whose carry is a tuple, defined by an identity and a combine), states each rule with its real-algebra argument and its f32 behaviour, measures the f32 behaviour on the host (12 probes), and states a falsifiable device experiment on the GB10. Design only; nothing implemented."
WhatFor: "Before building the Tix rule table, the fold construct, the tolerance contract or the CUDA lowering, and when reviewing the claim that streaming attention is a compiler derivation rather than a hand-written kernel."
WhenToUse: "When picking up the Tix-to-CUDA track, when writing the first rewrite rule for a tensor domain, or when someone asks what 'checked' can mean for a rewrite whose real algebra is exact and whose f32 arithmetic is not."
LastUpdated: 2026-11-26T22:10:00-05:00
---

# Intern guide and research design: deriving streaming attention by checked rewrites

## How to read this guide

The deliverable of this ticket is a **design**, not code. It answers one question: can a
compiler derive FlashAttention from the plain, materializing Tix program by a sequence of
rewrites, each of which is checked, and each of whose correctness argument is local and
mechanical?

The answer this document argues for is **yes, with one new construct and five rules, and with a
kind of checking that is weaker than the one the Typed pipeline uses.** Both halves of the
sentence are load-bearing: the interesting rewrites are *not* bit-exact, so the guarantee this
domain can have is "the same function over ℝ, and within a measured budget in f32". Part 3
measures how much weaker that is, and the answer (§9.9) is the reason the design looks the way it
does.

- **Part 1** is the system as it is: the framework, what a second domain has to supply, and the
  Tix core this design is written against.
- **Part 2** is the mathematics and the background, from scratch: why the plain program
  materializes an N×N matrix, what FlashAttention actually does, and why the state it keeps is
  a monoid element.
- **Part 3** is what was measured, on the host, in this ticket's `scripts/01-f32-probe.mjs`.
  Every f32 claim in Parts 4 and 5 is backed by a number there, and two of the numbers
  contradicted what I expected before I ran the probe.
- **Part 4** is the design: the construct Tix lacks, the five rules, the derivation, the
  checking, and the generality.
- **Part 5** is the experiment that would settle whether any of this is worth having.
- **Part 6** is decisions against alternatives, risks, and what is deliberately left out.

Where the brief asked for something specific:

| the brief asks for | section |
|---|---|
| the rewrite rules, in Tix-level terms, side conditions, exact algebra over ℝ, and the derivation as a sequence | §12, §13, Appendix A |
| what Tix lacks: a reduction whose state is not a single number, its semantics and its f32 meaning | §11 |
| checking: per rule, exact argument or tolerance; where the f32 difference comes from; domain, observation, relation | §14, with §9 and §10 for the measurements |
| generality: what else the rule set reaches, what it fails on and why | §15 |
| the experiment: falsifiable hypothesis, primary metric, what would refute it | §16 |

Two things this document does **not** do, because they are outside the question: it does not
design a kernel-tuning strategy, and it does not design the Tix front end or evaluators, which
are being built in parallel. §3 states exactly which interfaces this design assumes.

---

# Part 1: The parts of the system you need

## 1. The framework in one page

The IR Workbench framework in `src/framework/` is domain-parametric. Every domain (Typed→RV32
today; Tix→CUDA is the second) supplies a *program* type, an *adapter* that freezes and hashes
it, an *evaluator*, and *contracts*. Everything else is shared.

- **A revision** is a frozen artifact: `createIRArtifact` validates the native value and hashes
  it (`src/framework/ir/adapters.ts:128`). Origins, edit lists and contract evidence are outside
  the hash.
- **A pass** is a body plus declarations: which kinds of node it may write, which analyses it
  must preserve (`definePass`, `src/framework/passes/define-pass.ts`).
- **`applyPass(pass, before, options)`** (`define-pass.ts:190`) runs the body, freezes the
  output, diffs it against the input, refuses undeclared writes, builds a correspondence, and
  then consults a **contract** (`manager.verifyTransformation`). Nothing is published unless
  every stage succeeds.
- **A contract** is a `TransformationDefinition` (`src/framework/contracts/types.ts:127`) with
  required conditions, preserved properties and correspondence requirements. A condition is a
  property or invariant; an invariant is `check(ctx, inputs) -> CheckResult`
  (`types.ts:89`), and the manager records a `PropertyFact` (`types.ts:202`) with an `assurance`
  drawn from `declared | checked | transferred | proof` (`types.ts:161`).
- **A meaning check is a differential invariant.** `differential(spec)`
  (`src/framework/contracts/differential.ts:98`) takes ports (a `baseline` and a `subject`), a
  case generator, a `run` for each side, a `compare` returning `true` or
  `{ok, reason}` (`CaseComparison`, `:26`), and an `inconclusive` predicate. It decides case by
  case and records counts and the first counterexamples. `assuranceOf(evidence)` (`:325`) maps a
  sampled check to `checked-sampled` and anything else to `checked-exact`. **There is no entry
  for "within a bound".**
- **Replay.** A differential spec may supply `baselineKey` and `subjectKey`
  (`differential.ts:57`, `:63`); a decided verdict is then kept under
  `(baseline key, case index, subject key)` and replayed instead of re-evaluating. The keys are
  domain-supplied and domain-meaningful.
- **Rewrite rules are data** (IRWB-006). A `Rule` has a name, a version, a pattern, optional
  guards, a replacement template, and is applied by a compiled visitor. Each rule carries an
  **evidence record** pinned to a SHA-256 *fingerprint* of the rule's canonical data, whose
  strength is one of
  `proof > exhaustive > reduced-width+argument > by-construction > sampled`. A test fails if a
  rule no longer matches its record.
- **Exact derivation of edits** (IRWB-008) re-derives an accepted edit from the rule tables
  alone, so that a rule-backed step need not be sampled at all. It works because the Typed rules
  are *bit*-exact: an i32 rule that is sound is sound for every 32-bit input, so re-deriving the
  edit is as strong as evaluating it.
- **Contract version strings** are a major number plus a hash of everything that can change a
  decision (case count, seed, inputs, generator, and — once rules are in play — the rule sets'
  and evidence fingerprints). Two checks with the same version string are the same check.

The lesson IRWB-008 ends with, which this design inherits: report the strength of a *step* and
the strength of the *chain* separately, and never present a chain as exact because most of its
steps were.

## 2. What a second domain has to supply, and what the framework cannot supply

A Tix domain brings: an IR type and adapter for Tix programs, an f32 evaluator (the meaning of
the language), an f64 evaluator (the reference), a differential spec, a rule table, and an
evidence record per rule. All of that fits the interfaces above except three things:

1. **A relation that is not agreement.** `CaseComparison` is `{ok, reason?}`. A tolerance check
   needs to carry a *distance* and to be reported as "within a budget", not as "agreed"
   (IRWB-002's item D6 and IRWB-011 §5 both propose this shape; nothing implements it).
2. **An assurance value for it.** `assuranceOf` knows `checked-sampled` and `checked-exact`.
   IRWB-011 §17 proposes `checked-tolerance`; this domain needs it, and needs it to be *weaker*
   than `checked-exact` in the evidence-strength order (IRWB-008 §19), because a tolerance step
   is exactly a step whose guarantee is "close enough", not "the same".
3. **A budget that is a function of the program.** IRWB-011 set its budget in units of the
   scene's own Monte Carlo noise — a property of the *scene*. The natural analogue here is the
   plain program's own f32 error, which is a property of the *program and the input class*, so
   the budget is measured per case and reported with the evidence rather than fixed in the
   contract's parameters. §14 states this precisely.

Nothing in the framework assumes meanings are bit-exact; the assumption lives in Typed's
contract, not in the framework.

## 3. The Tix core this design is written against

The fixed core is the one in the ticket brief: functions of `f32` tensors whose dimensions are
affine expressions of shape names, statements that each define a tensor once with inferred
extents, `ref`s with affine index expressions, four pointwise functions, and `sum`/`max`
reductions whose body extends as far right as possible. Its f32 meaning is fixed: every literal,
shape value, operation and function result is `Math.fround` of the double result, and `sum` and
`max` accumulate in increasing lexicographic order of their indices, rounding after each step.

Four consequences of that definition are used repeatedly below and are worth naming now:

- The meaning is **order-sensitive**. A rewrite that changes the order of a reduction changes the
  meaning, exactly as in C with `-ffast-math` off.
- The meaning is **total** on the domain of the brief (finite inputs, consistent shapes). There
  are no traps other than a non-finite result, so "agreement" could in principle be bit
  equality; it just is not achievable (Part 3).
- The evaluator is a **specification**, not an implementation detail: a rule whose replacement
  is a different order of the same operations does not preserve the meaning. Every rule in §12
  therefore states what it does to f32 values. Two of the six (§12) turn out to be bit-exact, one
  is bit-exact for a single choice of its parameter, and three are not bit-exact at all.
- **Extents are inferred**, not declared: an index's extent comes from a plain use on the right,
  and a dimension may be a shape expression. The extension in §11 must inherit this, or every
  Tix program in this domain would need extent annotations.

The parallel work (front end, evaluators, meaning contract) is not in this worktree. This design
therefore fixes the **interface** it needs, not the implementation:

```text
tix.parse(text)                     -> TixProgram            (syntax, extents checked, errors reported)
tix.evalF32(program, inputs)        -> { tensors, status }   (the brief's f32 meaning, exactly)
tix.evalF64(program, inputs)        -> { tensors, status }   (the same statements in binary64)
tix.blocks(program)                 -> Artifact             (this domain's IR type and adapter)
tix.meaningWithin(params)           -> InvariantDefinition  (§14)
```

`tix.evalF64` is *not* the reference for transcendental accuracy — a binary64 `exp` is accurate
to about one ulp of 2⁻⁵³, which is five orders of magnitude below the smallest budget in §14, so
it is enough. §17 records the alternative and why it is not needed.

---

# Part 2: Background, from scratch

## 4. Attention, and what the plain program materializes

Written plainly, single-head attention is five statements:

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);     // N x N scores
  m[i] = max(j) s[i, j];                            // N row maxima
  e[i, j] = exp(s[i, j] - m[i]);                    // N x N unnormalized weights
  l[i] = sum(j) e[i, j];                            // N normalizers
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];        // N x D output
  return o;
}
```

`N` is the sequence length and `D` the head dimension; both are shape names bound by the
inputs' types when the function is called.

Two crossings of the N×N matrix are forced by the *program*, not by the language: `s` is
written by the first statement and read by the second and third; `e` is written by the third and
read by the fourth and fifth. A backend that does not fuse reductions must therefore move
Θ(N²) elements, and the plain program's own semantics say nothing about *keeping* `s` or `e`.

The traffic, in units of f32 elements, is dominated by the N² terms:

```text
unfused:  q,k,v read (3ND)  +  s written (N²)  +  s read twice (2N²)
        +  e written (N²)  +  e read twice (2N²)  +  v re-read per row (N²)  +  o written (ND)
        =  7N² + 4ND  elements
```

(That is the count probe 10 implements, `traffic()` in `scripts/01-f32-probe.mjs`.)

FlashAttention's claim is structural: if the two reductions over `j` are performed in one pass
that keeps a small state per row `i`, neither `s` nor `e` needs to exist, and the traffic becomes

```text
tiled, K and V resident in cache:   q read + o written + k,v read once  =  4ND elements
tiled, K and V streamed per row-block:  ND + (N/Bq)·2ND + ND           =  2ND(1 + N/Bq)
```

with `Bq` the number of rows an i-block covers. Probe 10's table (§9.9) puts the first form at
15× to 113× less traffic than the unfused form for N from 512 to 8192, and the second at 1.8× to
3.5× — so **whether K and V stay in cache decides whether the asymptotic claim is what is
measured**, which is why the experiment in §16 measures bytes rather than trusting the model.

## 5. The mathematics of the streaming form: three facts and one theorem

Fix a row `i` and write `s_j` for `s(i,j)`, `v_j` for the vector `v(j,·)`. For a finite set `J`
of indices define the **state** of `J`:

```text
M(J) = max_{j in J} s_j
L(J) = sum_{j in J} exp(s_j - M(J))
O(J) = sum_{j in J} exp(s_j - M(J)) * v_j          (componentwise, a vector of D numbers)
A(J) = O(J) / L(J)                                  (the attention output for this row)
```

`A` is a weighted average of the `v_j` with weights `exp(s_j − M(J))`, which is the softmax. The
plain program computes `A({0..N−1})` by first computing `M`, then `L` and `O`, then the quotient.
Three facts make the one-pass form possible.

**Fact 1 (singleton).** For `J = {j}`: `M = s_j`, `L = 1`, `O = v_j`. So a single index
contributes the state `(s_j, 1, v_j)`.

**Fact 2 (union).** For disjoint `J₁`, `J₂` and `M = max(M(J₁), M(J₂))`:

```text
L(J₁ ∪ J₂) = exp(M(J₁) − M)·L(J₁) + exp(M(J₂) − M)·L(J₂)
O(J₁ ∪ J₂) = exp(M(J₁) − M)·O(J₁) + exp(M(J₂) − M)·O(J₂)
```

The proof is two lines and uses exactly one identity: for `j ∈ J₁`,
`exp(s_j − M) = exp(M(J₁) − M)·exp(s_j − M(J₁))`, from `exp(a+b) = exp(a)exp(b)`. Then sum over
`j ∈ J₁`, add the same over `J₂`, and use `M ≥ M(J₁), M(J₂)`.

**Fact 3 (associativity).** Write `combine` for the operation Fact 2 describes on states:

```text
combine((M₁,L₁,O₁), (M₂,L₂,O₂)) = (M, L, O)   with  M = max(M₁, M₂)
                                          L = exp(M₁−M)L₁ + exp(M₂−M)L₂
                                          O = exp(M₁−M)O₁ + exp(M₂−M)O₂
```

`combine` is associative, and `(−∞, 0, 0)` is its two-sided identity (using `exp(−∞) = 0`,
`0·0 = 0` and the convention that a state with `M = −∞` has `L = O = 0`). Associativity is *not*
postulated: it follows from Fact 2, because both `combine(combine(α,β),γ)` and
`combine(α,combine(β,γ))` equal the state of the union of the three index sets, computed as in
Fact 2 with the partial maxima. Written out, the two sides are the same expression with the
parentheses moved, and the identity `exp(a−b)exp(b−c) = exp(a−c)` closes it.

**Theorem (one pass is enough).** Let `J = J₁ ⊕ J₂ ⊕ … ⊕ J_k` be any partition of `J` into
consecutive segments in increasing index order, and let `σ_t` be the state of segment `J_t`. Then

```text
combine(σ_1, combine(σ_2, … combine(σ_{k−1}, σ_k)))  =  (M(J), L(J), O(J))
```

and therefore `A(J)` is the quotient of the last two components. The proof is induction on the
number of segments using Facts 1–3 and the observation that a segment's state, being the state
of a set, is what Fact 2 combines. Concretely, for the two-segment case, the right-hand side's
`L` is `exp(M(J₁)−M)·L(J₁) + exp(M(J₂)−M)·L(J₂)`, which is `L(J₁∪J₂)` by Fact 2.

Three consequences, and they are the whole design:

1. The **singleton state** of index `j` is `(s_j, 1, v_j)` — a *lift* of one index, not a partial
   sum. A reduction whose state is a plain number cannot express this, because the lift is a
   triple and the combine is a ratio-forming operation (§11).
2. The **quotient is taken once**, at the end, over the final state.
3. The association is free: any partition into consecutive segments gives the same `A` *over the
   reals*. This is what licences blocking (`Bq`, `Bc` tiles) and, in principle, a parallel split
   of the `j` axis into interleaved rather than consecutive segments — that needs commutativity as
   well, which is §19's item.

**Corollary (the plain program is already a special case).** `A(J)` does not depend on which
offset the weights are normalized against, because the offset cancels in the quotient. The plain
program's `max` is the choice of offset `M(J)`; the naive program `exp(s_j)` with no offset is
the choice `0`. So *the plain program's `max` is itself a rewrite*, rule R2 below, and the only
content FlashAttention adds over it is the *association* (R3, R5). That reframing matters,
because it means the rule set is not a special-purpose "attention" gadget: it contains the rule
that derives the plain program *and* the rule that makes it stream.

## 6. Reductions with a state, from scratch

A reduction in Tix is a fold over an index with an accumulator of the *element's* type: `sum`
accumulates an f32, `max` an f32. A language where the accumulator could be a tuple and the
combination a user expression is the standard `foldMap` of a monoid:

```text
foldMap : (M, ⊕, e) -> (j ↦ m_j) -> M
foldMap(M, ⊕, e)(f) = e ⊕ f(0) ⊕ f(1) ⊕ … ⊕ f(E−1)
```

with `⊕` associative and `e` its identity. Associativity plus the identity law are exactly what
makes the *value* of a `foldMap` independent of the association. In a language with an
*order-sensitive* semantics (§3), `foldMap` has a meaning whether or not `⊕` is associative —
the meaning is "left to right" — but only an associative `⊕` lets a rule *re-associate* it. That distinction is the single most important design decision
in this document, and §11 makes it explicit: **the construct needs no monoid law to have a
meaning; the re-association rule needs one and checks it.**

Attention instantiates `foldMap` with a state type that is a *product*:

```text
M = f32            (the running maximum, a scalar per row)
L = f32            (the running normalizer, a scalar per row)
O = f32[D]         (the running unnormalized output, a vector per row)
⊕ = combine above, e = (−∞, 0, 0)
lift(j) = (s(i,j), 1, v(j,·))
```

Two smaller instances of the same shape are worth remembering, because they are how §15 argues
generality: log-sum-exp uses `(M, L)` with the same `combine` restricted to two components, and
RMSNorm uses `(S)` with `⊕ = +` — a one-component state, i.e. an ordinary `sum`.

## 7. Three grades of "checked", and why this domain cannot have the strongest

A rewrite `L → R` in a float language can be checked in three grades, and the choice is forced
per rule, not per project.

| grade | claim | what it needs | example |
|---|---|---|---|
| **bit-exact** | for every input, the f32 value of `R` is bit-identical to that of `L` | a structural argument: the same operations in the same order on the same values | R4 (fusion), R0 (α-renaming) |
| **real-exact with a range condition** | over ℝ, `R = L` for every input; over f32, `R = L` whenever the intermediates stay in range, and the range condition is discharged statically | an algebraic identity plus a value-domain side condition | R2 (offset invariance): exact over ℝ for *any* offset, exact in f32 when the offset is at least the largest score minus a margin (§9.7) |
| **real-exact with a tolerance** | over ℝ, `R = L` for every input; over f32, `‖R − L‖` stays inside a measured budget | an algebraic identity plus a measured error inflation | R1, R3, R5 |

The reason this domain cannot have the Typed pipeline's grade ("exact acceptance of rule-backed
edits", IRWB-008) is that the interesting rules are in the third row. `exp` is not a rational
function, a rescale is not a no-op in f32, and the sum of `exp(s_j − M)` over `j` is not the same
f32 number when the parenthesisation changes. IRWB-006's evidence vocabulary already anticipated
this: `sampled` is its weakest strength, and a `sampled` rule is exactly one whose argument runs
out where f32 begins. Part 3 measures how much difference that leaves on real inputs, and the
answer is: **a few parts in 10⁶ of the row's largest output element, growing with the score
range** — see §9.1, §9.6 and the mechanism in §9.12.

---

# Part 3: What was measured

## 8. Method

`scripts/01-f32-probe.mjs` implements, in plain Node 24 with no dependencies, seven
evaluations of the same attention function and a set of comparisons:

```text
ref      the plain program's statements in binary64            (the "f64 reference")
P0       the plain program in f32, per the brief's meaning
P1       P0 with the division slid out of the two sums                     (rule R1)
P2       the quotient written over an explicit offset u                    (rule R2)
P3       the one-pass fold with carry (M, L, T)                            (rule R3)
P4       the fold re-associated into blocks of width B                     (rule R5)
P5       the offset dropped, u = 0, i.e. R2 applied without its f32 guard  (R2 unguarded)
```

The f32 semantics is the brief's: every literal, operation and function result is
`Math.fround` of the double result, sums start at 0 and accumulate left to right rounding after
each step, `max` starts at −∞. Caveat that applies to every number below: `Math.exp` is the
host's `exp` rounded to f32 by `Math.fround`, which is a *correctly rounded* f32 `exp` in the
sense that it rounds the double value; a CUDA `expf` need not agree with it (this is risk 4 in
§18, and it is the largest gap between "the contract holds" and "the device is right").

Errors are reported three ways, because the naive one is misleading:

- **maxAbs**: the largest absolute difference from the reference.
- **maxRowRel**: the largest elementwise difference divided by the *row's* largest output
  element — the scale an attention output actually has. This is the number to watch: an
  elementwise relative error is unbounded near a cancellation, so `|a−b|/|b|` is not a metric
  for a contraction.
- **ratio** and **worse**: `|cand − ref| / max(|P0 − ref|, 1 ulp of the row scale)` elementwise,
  and the count of elements where the candidate is more than 4 ulps of the row scale off while
  the plain program is less than 1 ulp off. The denominator is floored because P0 is sometimes
  bit-equal to the reference for an element, and dividing by that zero says nothing.

Commands, and the exact worktree state, are in the diary (`log/01-*.md`, step 3). The whole
probe runs in 5 s. Outputs: `various/01-f32-probe.txt` and `.json`.

## 9. Results

### 9.1 The plain program's own error is the yardstick (probe 1)

```text
   N     D   maxAbs      maxRowRel   NaN/inf
    16     8   2.452e-7  1.750e-7    0
    64    16   3.510e-7  6.287e-7    0
    64    64   4.446e-7  7.497e-7    0
   256    32   2.795e-7  1.025e-6    0
   256   128   4.442e-7  1.173e-6    0
   512    64   3.330e-7  1.668e-6    0
```

The *plain* program, written exactly as in the brief, is off by about 1 to 1.7 parts per million
of the row's largest element on N(0,1) inputs. That is the noise floor of this domain: any
tolerance budget smaller than this would reject the program the derivation starts from, so the
budget is stated as a multiple of it (§14).

### 9.2 Self-checks: two of the claims are bit-exact, and one is exactly nil (probe 0)

```text
(a) fold with the score computed inline vs precomputed (rule R4): 0 of 2048 elements differ
(b) blocked fold with B = N vs the plain fold (rule R5 boundary): 0 of 2048 elements differ
(c) offset form vs the division-slid plain form (R2 at u = max):  0 of 2048 elements differ
```

(a) is the claim that **the rewrite which removes the N² tensor costs nothing in accuracy**:
substituting the score's definition into the fold's element expression reproduces the same f32
values bit for bit. R4 is the only rule that changes memory traffic, and it is bit-exact. This is
the single most encouraging number in the ticket.

(c) is the claim that **R2 with `u` equal to the final max changes nothing at all**, so the whole
f32 difference of the derivation is attributable to the *running* max (R3) and to the
reassociation (R5) — not to the quotient form. It also means the probe's P2, P3 and P0 differ
only in how the offset moves.

Caveat on (c): the self-check ran at `D = 16`, where `sqrt(16) = 4` is exact, so the score's
division slide is exactly nil there too. Probe 12 separates the two slides properly.

### 9.3 Derived forms against the reference (probe 2, N = 256, D = 32, N(0,1))

```text
   form                                       maxAbs      maxRowRel   ratio  worse
   P1 division slid out of both sums (R1)   4.064e-7  1.218e-6     10.2     44
   P2 quotient over an explicit offset (R2) 3.468e-7  1.093e-6      8.7     24
   P3 single-pass carry fold (R3)           3.468e-7  1.391e-6      8.7     47
   P4 fold in blocks of 64 (R5)             3.262e-7  9.840e-7      4.8      4
   P4 fold in blocks of 16 (R5)             2.815e-7  9.772e-7      4.0      0
   P5 offset dropped, u = 0 (R2 unguarded)  3.419e-7  9.999e-7      7.8     62
```

Every derived form is within 1.4× the plain program's error on this input, and the *blocked*
fold is closer to the reference than the flat fold. **P5 looks harmless here** — same error as
P4 — because the inputs are N(0,1) and the scores never exceed ±8, far below the 88.7 at which
`exp` overflows. §9.7 shows what happens when they do. This is the measurement that justifies a
value-domain side condition rather than a per-rule sampling argument.

### 9.4 Re-association alone (probe 3): it changes most elements, by a few parts in 10⁶

```text
   B    differing elements   max ulps   maxRowRel
     1           0 of 8192        0.0   0.000e+0
     2        7662 of 8192     7919.0   1.387e-6
     4        7625 of 8192     4525.0   1.179e-6
    16        7551 of 8192     7116.0   1.305e-6
    64        7566 of 8192     5993.0   1.387e-6
   256           0 of 8192        0.0   0.000e+0
```

`B = 1` and `B = N` reproduce the flat fold exactly, which is the probe's self-check; every
intermediate block width changes about 92 % of the elements. The **ulp column is large and the
`maxRowRel` column is small**, which is the difference between an element that is near zero
(where ulps are meaningless) and the row's scale (where the answer lives). A contract phrased in
ulps per element would be unusable here; §14's relation is phrased against the row scale for
exactly this reason.

### 9.5 The combine is *not* associative in f32 (probe 4)

```text
trials 20000: identical 3547, differing 16453 (82.3 %); worst normalizer rel diff 1.330e-7
```

82 % of random triples of singleton states give a different answer under the two
parenthesisations, by up to 1.3 ulps of the normalizer. So:

- **R5's associativity obligation cannot be discharged by an exact f32 argument.** It must be a
  real-algebra proof plus a measured tolerance (Part 3's grade 3).
- The real-algebra proof *is* available and is one line (Fact 3), which is the only reason the
  rule is worth having.

### 9.6 The adversary for R3: a running max that grows at every element (probe 5)

Row 0's scores are a staircase `s(0,j) = j·step`, so the fold rescales its whole state 256
times; the other rows are N(0,1).

```text
   step    P0 maxRowRel   P3 maxRowRel   P3/P0   P4(B=32) maxRowRel
    0.01   4.956e-7   2.424e-7     2.03   1.722e-7
    0.05   5.223e-7   6.119e-7     2.52   5.922e-7
     0.1   1.439e-6   1.209e-6     1.14   1.324e-6
     0.2   3.115e-6   3.305e-6     1.18   3.305e-6
     0.4   7.646e-6   7.646e-6     1.01   7.646e-6
     0.8   1.395e-5   1.384e-5     1.03   1.384e-5
```

Two findings, one expected and one not.

- **The error grows with the score range, not with the number of rescales.** From a 2.5-nat range
  to a 204-nat range the error rises by a factor of 30, and at 204 nats the plain program and
  the fold are identical to three digits. The mechanism is the one from §9.12: an absolute
  perturbation `δs` in a score becomes a relative perturbation `≈ |s|·δs` in the weight
  `exp(s)`, and the score's magnitude — not the association — sets the sensitivity.
- **The staircase, which is the worst case for a running maximum, does not hurt.** P3/P0 stays
  between 1.0 and 2.5. A rescale per element does not accumulate visibly, because each rescale's
  rounding is relative to the accumulated magnitude it acts on.

### 9.7 The offset is a validity condition, not an accuracy one (probe 7)

```text
q = k = 10, D = 8, so s = 800/sqrt(8) = 282.8; exp overflows above 88.72
P0 maxRowRel 0.000e+0, NaN/inf 0
P2 (max offset) maxRowRel 0.000e+0, NaN/inf 0
P3 (fold)       maxRowRel 0.000e+0, NaN/inf 0
P5 (u = 0)      maxRowRel 0.000e+0, NaN/inf 256 of 256
```

Over ℝ, P5 computes the identical function. In f32, **every one of the 256 output elements is
inf or NaN**. This is the cleanest example in the ticket of a rewrite that is *exactly* sound
over the reals and *catastrophically* unsound in f32, and it is why R2 carries a side condition
that is a value-domain fact (§12, R2). It also explains why the derivation is worth doing rather
than hand-waving: the derived program is *self-guarding* — with `u` the running maximum, `s − u ≤
0` holds by the fold's own invariant, so R2's f32 condition is discharged structurally, with no
range analysis at all.

### 9.8 The subnormal rescale is invisible, and here is the bound (probe 6)

The one place where the streaming form could in principle be *qualitatively* worse than the
reference is the rescale: the reference computes `exp(s_j − M)` once per element with the final
`M`, while the fold multiplies an accumulated state by successive `exp(M_old − M_new)` factors,
and those products can pass through the subnormal range. Predicted bound: the mass present before
a rescale of `exp(−Δ)` is at most `N` (each weight is ≤ 1), so the mass it can lose is at most
`N·exp(−Δ)`, invisible once `exp(−Δ) < 2⁻²⁴/N`, i.e. `Δ > 16.6 + ln N` (about 25 nats at
N = 4096).

```text
   gap    m   ref L         fold L        rel diff     prediction N*e^-gap     (N = 4096)
     10 1000   3.095e+3    3.095e+3    0.000e+0    1.860e-1
     20 1000   3.095e+3    3.095e+3    0.000e+0    8.442e-6
     40 1000   3.095e+3    3.095e+3    0.000e+0    1.740e-14
    100 1000   3.095e+3    3.095e+3    0.000e+0    1.524e-40
    160 1000   3.095e+3    3.095e+3    0.000e+0    1.334e-66
```

The measured relative difference is zero at every gap, so the underflow asymmetry is real in the
arithmetic and invisible in the answer. The reason is a small theorem worth recording: for the
product of rescale factors to become subnormal at all we need `exp(−Δ) < 1.2e-38`, and then the
predicted loss is at most `N·1.2e-38 ≤ 2e-31` for `N ≤ 2²⁴` — seven orders of magnitude below one
ulp of a normalizer that is at least 1. **So for N ≤ 2²⁴ a subnormal rescale can never change the
f32 output.** The risk in §18 is recorded accordingly: real, bounded, and not a reason to
withhold the rule.

### 9.9 Traffic (probe 10) and the two slides separately (probe 12)

```text
    N      D   unfused      resident   ratio   streaming   ratio
     512    64  1.966e+6  1.311e+5    15.0   5.898e+5    3.33
    2048    64  2.988e+7  5.243e+5    57.0   8.651e+6    3.45
    4096   128  1.195e+8  2.097e+6    57.0   6.816e+7    1.75
    8192   128  4.740e+8  4.194e+6   113.0   2.705e+8    1.75
```

```text
    form                                         elementwise  worst case    row-RMS  worst case
    no slide at all (P0)                             0                  0
    output slide only (R1, required by the fold)    10 512x64 normal     1 128x16 normal
    score slide only (R1, optional)                173 256x128 wide    63 256x128 wide
    both slides                                    173 256x128 wide    63 256x128 wide
```

Probe 12 is the most decision-relevant measurement in the ticket, and it forced a change to the
rule set I had planned:

- **The slide the streaming form forces — moving `/l[i]` out of the `j`-sum — costs at most 10
  ulps of the row scale (1 ulp row-RMS).** The fold *cannot* divide each term by the final
  normalizer, so this rewrite is not optional, and it is cheap.
- **The slide the streaming form does not need — moving `/sqrt(D)` out of the `d`-sum — costs 173
  ulps elementwise and 63 ulps row-RMS at 256×128 on wide inputs.** It is a legitimate
  optimization (scale `q` once instead of dividing every product) and it must not be in the
  checked chain by default. The mechanism is again §9.12: it perturbs the *scores*, and `exp`
  amplifies an absolute score perturbation by `|s|`, which is large exactly in the "wide" class.
- `sqrt(D)` is exact when `D` is an even power of two, which is why the score slide measures
  exactly nil at D = 16 and D = 64 and expensive at D = 32, 100, 128. A rewrite whose cost
  depends on a shape name being a power of two is a rewrite that needs a side condition, not a
  surprise.

### 9.10 What the tolerance relation needs (probe 11)

The relation is `|cand − ref| ≤ κ·|P0 − ref| + f·ulp(rowScale)`, elementwise, and the same with
row-RMS norms. Probe 11 reports the smallest `f` with no violating element, aggregated over 6
shapes × 3 input classes × 5 forms:

```text
    form                                     kappa=1  kappa=2  kappa=4   (row-RMS: kappa=2)
    P1                                         178      173      165         63
    P2                                          13       11       10          1
    P3                                          13       12       11          2
    P4/64                                        5        5        5          1
    P4/16                                        6        6        5          1
```

Read this carefully, because it is not what a first design would assume:

- The floor is **insensitive to κ over 1..4**: the errors are either at the floor or far above
  it. Multiplying the plain program's error by 4 buys almost nothing.
- The **elementwise** floor needs ~12 ulps for the fold forms and ~173 for the score slide; the
  **row-RMS** floor needs 1–2 ulps for the fold forms and 63 for the score slide. The elementwise
  and the aggregate statements are answering different questions, and a contract needs both: the
  aggregate to catch a systematic drift, the elementwise to catch a single grossly wrong element.
- Since the score slide is excluded from the chain (§9.9), the constants the contract uses are
  `κ = 2`, `f_rms = 2` (measured 2) and `f_el = 16` (measured 12, rounded up to the next power of
  two for margin). §14 states why they are in the contract's version key.

### 9.11 What was not measured

- **Anything on a GPU.** No CUDA toolchain, no GB10 and no profiling in this worktree. All of §16
  is a design, and the probe says nothing about device time or bytes.
- **The device's `exp`.** The probe's `exp` is the host's, rounded. A CUDA `expf` differs (risk
  R4).
- **N above 512 on the host.** The probe is O(N²) per call in interpreter-level JavaScript; 8192
  would be a minute per call and is unnecessary for the f32 conclusions.
- **Multi-head, batching, masks.** They change the program's index structure, not the rules; §15
  says which of them the rule set reaches.

### 9.12 One mechanism explains most of the numbers

`exp` amplifies an absolute perturbation of a score by the score's magnitude:

```text
s' = s + δ  =>  exp(s') = exp(s)·exp(δ) ≈ exp(s)(1 + δ)      for the weight
but if δ is relative (δ = ε·s) then exp(s(1+ε)) = exp(s)·exp(sε) ≈ exp(s)(1 + |s|ε)
```

So a rewrite that perturbs the *scores* pays `|s|·ε`, and a rewrite that only reassociates the
*weights* or the final division pays `ε`. That is exactly the measured split between the two
slides (§9.9), the growth with the score range (§9.6) and the plain program's own error growth
(§9.1). It is also the reason the rule set should be read as two families:

```text
score-side rewrites    touch the expression that defines s        -> sensitive to |s|
state-side rewrites    reassociate weights, normalizers, output   -> first order in u only
```

R3 and R5 are state-side and safe; R1's optional application is score-side and expensive; R2 with
a bad offset is score-side and fatal.

---

# Part 4: The design

## 10. What the numbers decided

| measurement | decision it forced |
|---|---|
| fusion is bit-exact (§9.2a) | the rule that removes N² is exact; no tolerance is spent on it |
| R2 at `u` = final max is bit-exact (§9.2c) | the derivative's f32 difference is attributable to the running max and the reassociation, not the quotient form |
| the combine is not associative in f32 (§9.5) | R5's obligation is a real proof plus a measured tolerance, never an f32 proof |
| `u = 0` gives 100 % NaN at large scores (§9.7) | R2 carries a *value* side condition, discharged structurally when `u` is a fold's running max |
| the forced slide is cheap, the optional one is not (§9.9) | R1 is in the chain once (output); the score slide is a separate rule, off by default |
| the floor is insensitive to κ (§9.10) | the relation is stated with a *floor*, and the floor is the honest statement of accuracy |
| the subnormal rescale is bounded and invisible (§9.8) | not a reason to exclude R3; recorded as a bounded risk |
| traffic gains 1.75× to 113× depending on cache (§9.9) | the experiment measures bytes, not a model |

## 11. What Tix lacks: a fold whose carry is a tuple

### 11.1 The construct (extension E1)

Tix's reductions return a single scalar per instance: `sum(k)` and `max(k)` accumulate the
element's own value. The streaming form needs a carry of three components with *different* index
sets (`M` and `L` per row, `T` per row and per output channel) and a combine that is not
componentwise. The extension is one new statement form:

```text
stmt        := ... | foldtarget (',' foldtarget)* '=' 'fold' '(' NAME ')' 'over' '(' expr (',' expr)* ')'
                      'with' '(' binds ')' '(' binds ')' '=>' '(' expr (',' expr)* ')'
                      'from' '(' expr (',' expr)* ')' ';'
foldtarget  := NAME '[' NAME (',' NAME)* ']'
binds       := bind (',' bind)*
bind        := NAME | NAME '[' NAME (',' NAME)* ']'
```

The extension also adds the literal `inf` (and so `-inf`), because the identity of the attention
fold is `(−∞, 0, 0)` and the core's grammar has no infinity.

Written out, the streaming state of the attention program is:

```tix
(M[i], L[i], T[i, x]) = fold(j) over (s[i, j], 1.0, v[j, x])
    with (m1, l1, t1[x]) (m2, l2, t2[x]) => (
        max(m1, m2),
        exp(m1 - max(m1, m2)) * l1 + exp(m2 - max(m1, m2)) * l2,
        exp(m1 - max(m1, m2)) * t1[x] + exp(m2 - max(m1, m2)) * t2[x])
    from (-inf, 0.0, 0.0);
```

Read it as: *for each instance of the statement's free indices, start from `from`, and for each
`j` in increasing order combine the running state (the first bind list) with the state that `j`
contributes (the second bind list, built from `over`); bind the final state to the targets.*

### 11.2 Extents and typing, inherited

The extension does not add an inference rule; it reuses the core's:

- The fold index `j`'s extent is inferred from its plain uses in the `over` expressions
  (`v[j, x]` gives `N`). If a fold index appears only affinely, the statement needs a declared
  type, as in the core.
- A carry index (`i`, `x`) has its extent inferred from its plain uses in `over`, in the combine
  body, or in the targets' declared type. `x` is plain in `v[j, x]`, so `T` gets extent `D`
  without an annotation.
- Scalar carries (`M`, `L`) have no index, so they are per-row scalars; that is how the tuple's
  components get *different* ranks, which is the point.
- The bind lists must have the same length and matching component types; the `from` tuple must
  match the state type. All of this is the ordinary check, and a mismatch is a compile-time check
  error, as everywhere in Tix.

### 11.3 Semantics: what the f32 meaning of the construct is

The meaning is defined, not derived, and it is defined the way the core defines everything else:

```text
for each instance of the free indices:
    state <- evaluate the `from` tuple, rounding each element to f32
    for j = 0, 1, ..., E-1, in that order:
        elem  <- evaluate the `over` tuple with the fold index bound to j
        state <- evaluate the combine body with the first bind list bound to `state`
                 and the second to `elem`, rounding after every operation
    bind the components of `state` to the targets
```

Three properties follow, and each one is a design decision:

1. **The fold is left to right, and that is the meaning.** The construct is well defined for *any*
   combine, associative or not. This is what lets the language be honest about its f32 semantics:
   there is no "it does not matter how you group it", because in f32 it does (probe 4).
2. **The identity is part of the tuple's value, not a special case.** `(−∞, 0, 0)` is evaluated
   like any other tuple; the first combine sees `m1 = −∞` and computes `exp(−∞ − s) = 0` and
   `0·0 = 0`, which are exact in f32 for every finite `s`. So the first step is exact, and the
   construct needs no "empty fold" convention beyond `exp(−∞) = 0`.
3. **The single-pass state is observable.** A statement's value can be inspected (the evaluator
   returns every statement's tensor; the contract can pick any of them), which is how a contract
   can check the normalizer that the fold carried rather than only the final output. Probe 6's
   `fold L` column is exactly that.

### 11.4 The two obligations, declared separately

The construct's meaning needs no law. Two rules need one, and the language makes them explicit
annotations on the statement, which the checker verifies:

| obligation | needed by | statement of it | discharged by |
|---|---|---|---|
| `identity` | R5, and any parallel lowering | `combine(from, X) = X` and `combine(X, from) = X` for every reachable state `X` | a real identity (1 lemma) + a measured f32 check on sampled states |
| `assoc` | R5 | `combine(combine(A,B),C) = combine(A, combine(B,C))` for reachable `A,B,C` | a real identity (1 lemma) + a measured f32 check (which *fails* to be exact: 82 % of triples differ, §9.5) |
| `commute` | split-K, tree reductions, parallel `j` | `combine(A,B) = combine(B,A)` | a real identity (holds: max and `+` commute), but *not* exact in f32, and not needed for §13 |

For attention's combine, all three have one-line real proofs *because the combine is the union
operation* (Fact 2), and `identity` is exact in f32 too — with one edge case that any
implementation must know about. `combine(from, from)` is `(−∞, exp(−∞ − (−∞)), …)`, i.e. `exp(NaN)`:
**two empty states do not combine**. Over ℝ the expression is `0·0` written as `exp(−∞)·0` and the
convention saves it; in f32 `−∞ − (−∞)` is NaN and carries. A left fold never does this, because its
first combine has a finite element on one side (inputs are finite), and a blocked fold does not
either, because every block has at least one index. A *parallel* combine of two partial folds can,
if the `j` axis is shorter than the number of workers — which is one more reason §19 puts split-K
behind `commute` and a partition that keeps every part non-empty. `assoc` is exact over ℝ and not
in f32.
`commute` over ℝ holds (max and addition commute), which is why a split-K version is
*mathematically* available even though §13 does not need it — and, since it is not exact in f32,
that version would need its own evidence record rather than inheriting R5's.

### 11.5 What this extension deliberately does not add

- **No loop or mutable accumulator.** A hidden `for` loop would be a second, un-analysed statement
  form and would break the single-assignment property the framework's diffing relies on.
- **No records or higher-order functions.** The combine is an inline expression over named
  binds, which keeps Tix first-order and makes the checker's job (compare the body to the union
  formula) a syntactic normalization rather than a call-graph analysis.
- **No `where` predicate on reductions.** Masks are additive terms on the scores (§15.1).
- **No blocked index axis.** §11.6 argues it is needed for a *checked blocked kernel* and not for
  the derivation itself.

### 11.6 The second extension (E2): shape names inside `aff`, and a block index

A blocked kernel is the same fold re-associated (R5). To *write down* the re-associated program in
Tix one needs `j = b·B + t` in a `ref`, and the core's `aff` admits index names and integers
only. The extension: allow shape names in `aff`, and allow a fold's index to be declared as a
block pair:

```text
fold blocks(B) t            -- the outer index b ranges over N/B, the inner t over B
... over (sum(d) q[i, d] * k[b * B + t, d] / sqrt(D), 1.0, v[b * B + t, x]) ...
```

Extent inference is unaffected because `blocks(B)` *declares* both extents, so no inference is
needed inside the `aff`. This is the one place where the extension trades inference for
annotation, and it is worth it: without it, "blocked" lives only in the CUDA backend and the
compiler never sees the artifact whose traffic is the experiment's primary metric.

**Decision: the derivation ends at the unblocked fold (A4) and R5 is applied once, with a
symbolic `B`, to produce the blocked program (A5).** The alternative — leaving blocking entirely
to the backend — was rejected because then the primary metric of §16 is a property of hand-written
backend code, not of a checked artifact.

## 12. The rule set

Notation. `E` is the extent of a reduction's index. `fv(x)` is the set of index names free in
`x` (not bound by a reduction inside `x`). A **j-free** expression is one whose `fv` does not
contain the reduction index. "Real argument" means: a proof over ℝ for every instance of the
pattern, using only the identities named. "f32" means: what the probe measured for that rule.

Each rule is one row of a table with a fingerprint and an evidence record (IRWB-006's form). The
*rule* is verified once; each *application* is checked structurally plus, where noted, by a
discharged side condition.

### R0 — α-renaming and copy propagation (structural, bit-exact)

`d[I] = d2[σ(I)]` with `σ` a bijection of index names ⇒ replace uses of `d[I]` by `d2[σ(I)]` and
drop the statement. No arithmetic. Real: identity. f32: bit-identical (same value, same order).
Checker: exact, structural. **This exists only so the other rules can match index names
modulo renaming; it is in the table because a table with a hole in it cannot be closed.**

### R1 — slide a reduction-index-free factor out of a reduction (real-exact, f32-tolerance)

```text
LHS   c[i,..] = sum(j) ( f[i,j,..] * g[i,..] )        or   sum(j) ( f[i,j,..] / g[i,..] )
RHS   h[i,..] = sum(j) f[i,j,..] ;  c[i,..] = h[i,..] * g[i,..]   (or  h[i,..] / g[i,..] )
```

**Side conditions.** (i) `j ∉ fv(g)`; (ii) `h` is fresh; (iii) the reduction's index and extent
are unchanged, and the accumulator order is unchanged (increasing `j`); (iv) nothing else changes.

**Real argument.** By induction on `E`: `Σ_{j<E}(f_j·g) = (Σ_{j<E} f_j)·g` uses distributivity
and associativity of `+` and commutativity of `·` in ℝ. Division is multiplication by `1/g`,
with side condition (i) making `g ≠ 0` a precondition of the *evaluation* (the brief's domain
excludes a division by zero, and Tix reports a non-finite result rather than trapping).

**f32.** Not exact: `E−1` roundings move from one place to another. Measured (§9.9, probe 12):
the *output* slide (the one the fold forces) costs ≤ 10 ulps of the row scale elementwise and
1 ulp row-RMS over 6 shapes × 2 classes; the *score* slide costs 173 / 63 because `exp`
amplifies an absolute score perturbation by `|s|` (§9.12).

**Check.** Rule evidence: a real proof in the ring of polynomials over the sum's index (complete
for this fragment — the only operations are `+`, `·`, and division by a `j`-free factor, so
normalization is a polynomial comparison) with strength `proof` **for the real claim only**,
recorded with a f32 note; plus the measured inflation above. Application check: side conditions
(i)–(iv), structural.

### R2 — normalize the weights by any offset (real-exact for every offset; f32 needs a range condition)

```text
LHS   m[i] = max(j) s[i, j];
      l[i] = sum(j) exp(s[i, j] - m[i]);
      t[i, x] = sum(j) exp(s[i, j] - m[i]) * y[i, j, x];
RHS   u[i] = <any tensor of type f32[N], in scope or added as a parameter>;
      l[i] = sum(j) exp(s[i, j] - u[i]);
      t[i, x] = sum(j) exp(s[i, j] - u[i]) * y[i, j, x];
```

with the final quotient unchanged. `y` is any factor, `j`-free or not; the rule touches only the
offset.

**Side conditions.** Real: **none** — not even that `u` bounds `s`. f32: (a) every `s[i,j] − u[i]`
must be `≤ 88.72 − ln E` so that no `exp` and no sum overflows; (b) the normalizer must not be
zero; both are implied by `u[i] ≥ max_j s[i,j]`, which is the natural choice and the one the
derivation makes.

**Real argument.** Let `m_i = max_j s(i,j)` and `λ = exp(m_i − u_i) > 0`. Then for every `j`,
`exp(s_ij − u_i) = λ·exp(s_ij − m_i)` by `e^{a+b} = e^a e^b`. Summing, `l(u) = λ l(m)` and
`t(u) = λ t(m)`, so `t(u)/l(u) = t(m)/l(m)`. Two lines, no side condition, **and this is the
rule that derives the plain program itself** (take `u = m`, i.e. LHS from a naive program that
omits the max).

**f32.** (a) With `u = m` the rewrite is *bit-exact* — measured, 0 of 2048 elements differ
(§9.2c) — because `exp(s−m)` is computed identically. (b) With `u = 0` and scores of 282.8,
**256 of 256 outputs are inf/NaN** while the reference is exact (§9.7). So R2's f32 safety is
entirely in its side condition, and the side condition is about *values*, which no amount of
sampling over N(0,1) inputs would have found (§9.3).

**Check.** Rule evidence: real proof (strength `proof` for the real claim), plus a **side
condition discharged per application**, in one of two ways:
- *structurally*, when `u` is the running maximum of a fold whose element is `(s, …)` — then
  `s − u ≤ 0` by §11.4's invariant, so (a) and (b) hold with no range analysis;
- *by range analysis* otherwise (an interval or affine bound on `s − u`), which the Tix checker
  would have to provide; §19 lists it as not-in-scope, and it is the reason the derivation does
  not take the "lazy offset" shortcut.

### R3 — extract the reduction group as a fold (real-exact by induction; f32-tolerance)

```text
LHS   m[i] = max(j) s[i, j];
      l[i] = sum(j) exp(s[i, j] - m[i]);
      t[i, x] = sum(j) exp(s[i, j] - m[i]) * y[j, x];
RHS   (M[i], L[i], T[i, x]) = fold(j) over (s[i, j], 1.0, y[j, x])
            with combine from (-inf, 0.0, 0.0);
```

**Side conditions.** (i) all three reductions range over the same index `j` with the same extent
(inferred: `N`); (ii) the offset in the two sums is *exactly* the first statement's value
(syntactically the same ref); (iii) each summand is `exp(s − offset)` times a factor `g` that
mentions neither the offset nor any value the group itself defines — `g` may depend on `j`, and in
attention it is `1` and `v[j,x]`; the condition that bites is the second half: the *output* sum's
factor contains `l`, which the group defines, which is why R1 must run first; (iv) `s` is defined
at exactly these indices and is not needed at a different index pattern elsewhere (if it is, the
statement stays and is recomputed — R4's cost side condition); (v) the combine body, after α-renaming and arithmetic normalisation, *is* the union
formula of Fact 2 — component by component: a max of the two maxima, and each of the other
components an `exp(a−max)·(component of a)` plus the same for `b`; (vi) the `from` tuple is the
identity of that combine.

**Real argument (the local, mechanical part).** For a prefix `j < n` define `σ_n` by the fold. Claim:
`σ_n = (M_n, L_n, O_n)` — the state of the index set `{0..n−1}`, in the sense of §5.
*Base*: `σ_0 = (−∞, 0, 0)` and the state of the empty set is `(−∞,0,0)`. *Step*: `σ_{n+1} =
combine(σ_n, (s_n, 1, y_n))`. By Fact 2, `combine(σ_n, singleton(s_n))` is the state of
`{0..n−1} ∪ {n}` — i.e. `(max(M_n, s_n), Σ_{j≤n} exp(s_j − max(M_n,s_n)), Σ_{j≤n} exp(...)y_j)`. At
`n = E` the components are `M = max_j s_j = m`, `L = Σ_j exp(s_j − m) = l`,
`T = Σ_j exp(s_j − m) y_j = t`. QED.

The two identities the proof uses are exactly Fact 2's: splitting a sum over an index range into
"the prefix" and "the last element", and `exp(a−c) = exp(a−b)exp(b−c)`. **This is what "local and
mechanical" means here**: one induction, three lines, two lemmas, no program-specific reasoning.
The rule is verified once; every application is an instance of the same induction.

**f32.** Not exact, for one reason only: the offset is now the *running* maximum, so different
`exp(s − ·)` arguments are computed than the reference's. Measured (§9.3, §9.6): 1.39e-6 vs the
plain program's 1.03e-6 of the row scale at 256×32; between 1.0× and 2.5× the plain program's
error on the staircase adversary. R3's own contribution is exactly zero when `u` is the final max
(§9.2c), which isolates the running max as the sole cause.

**Check.** Rule evidence: the induction above, discharged by a **specialized normalizer for sum
comprehensions** with a fixed lemma set (range split, `exp` law, distributivity, max absorption);
strength `proof` over ℝ, and the boundary of the fragment recorded. The fragment is: sums of
`exp(score − offset)` times arbitrary factors, plus maxima of the scores, with the offset one of
the scores or a `j`-free expression. Outside it — a summand that is a *power* of `exp`, a sum of
`exp`s of two different scores, a reduction whose offset is not the group's own maximum — the
normalizer is not complete, and the application must come out **residual** (not derivable, hence
sampled), never "probably fine". Application check: side conditions (i)–(vi), structural, plus
(v)'s normalization.

### R4 — fuse a pointwise definition into its single pointwise use (bit-exact)

```text
LHS   d[I] = expr;   ...   <a fold or expression that reads d[I] at exactly the pattern I>   ...
RHS   (expr substituted for that read); the statement for d is deleted
```

**Side conditions.** (i) the read's index list equals the definition's, up to an index bijection
(`d[i, j]` inside a fold over `j` with free `i` matches a definition with indices `(i, j)`);
(ii) `d` has no other read, or the cost model accepts recomputation (duplicating a read duplicates
work but not values); (iii) the substitution does not reorder any evaluation — the substituted
expression is evaluated once, at the point of the read, in the same order.

**Real argument.** Substitution in a comprehension; nothing to prove. **f32: bit-exact** — the
same operations in the same order on the same values produce the same `Math.fround` results.
Measured: 0 of 2048 elements differ (§9.2a).

**Check.** Exact, structural; no tolerance, no samples. **This is the rule that removes the N×N
tensor, and it is the one rule that costs nothing in accuracy.**

### R5 — re-associate a fold into a fold of folds (blocking; real-exact, f32-tolerance)

```text
LHS   (state) = fold(j) over E[j] with w from z
RHS   (state) = fold blocks(B) t over ( fold(t) over E[b*B + t] with w from z ) with w from z
```

**Side conditions.** (i) `identity(z)` and `assoc(w)` are declared on the statement and hold
(§11.4); (ii) `B` divides `E` (or the last block is short, which the `over` expression can mask
with an additive `−inf` — §15.1); (iii) the block order is increasing `b`, matching the original
index order; (iv) the state type is unchanged.

**Real argument.** Identity plus associativity give that a left fold over a concatenation of
consecutive segments equals the left fold, in the same order, of the segment states. Induction on
the number of blocks, one line per step. Over ℝ this is unconditional once (i) holds; combined
with R3's theorem it says every blocking of the `j` axis gives the same `A`.

**f32.** Not exact: §9.5 measures 82.3 % of random triples differing under the two
parenthesisations (worst 1.3 ulps of the normalizer), and §9.4 measures 92 % of elements moving
when `B` changes. But the *blocked* fold is closer to the reference than the flat one (floor 5 vs
12 ulps, §9.10), because fewer rescales happen: a block's max is fixed for the whole block, so
each element is rescaled at most once per block boundary rather than once per element.

**Check.** Rule evidence: `assoc` and `identity` from Fact 2/3 (one line each), strength `proof`
over ℝ; the f32 behaviour measured per table version. Application check: (i)–(iv) plus the
`assoc`/`identity` evidence record of the specific combine body, pinned by fingerprint.

### Summary of the rule set

| rule | changes | over ℝ | over f32 | checked by |
|---|---|---|---|---|
| R0 α-renaming | names | identity | bit-exact | structural |
| R1 slide | where a factor is applied | `proof` | ≤ 10 ulps (output) / 173 (score) | real proof + measured tolerance |
| R2 offset | the normalizing offset | `proof` (any offset) | bit-exact at `u = m`; inf/NaN below the range bound | real proof + per-application range obligation |
| R3 fold extraction | materialized tensors → state | `proof` (induction) | 1.0–2.5× the plain error | real proof (fixed lemma set) + measured tolerance |
| R4 fusion | memory | identity | bit-exact | structural, exact |
| R5 re-association | the order of the fold | `proof` (assoc) | 92 % of elements move; ≈ same magnitude | real proof (assoc) + measured tolerance |

## 13. The derivation, step by step

Each step is one rule application at one site. each step names the rule; the side conditions of §12 are
discharged as noted. Programs are written as they would appear in a Tix file.

### A0 — the program as given

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

Extents, as the core infers them: `i` from `q[i,d]` and `s[i,j]` ⇒ `N`; `j` from `k[j,d]` and
`v[j,x]` ⇒ `N`; `x` from `v[j,x]` ⇒ `D`; `d` bound by `sum(d)` with extent `D` from `q[i,d]`.

### Step 1 (A0 → A1): R4 on `e` — the weight tensor becomes an expression

`e` is read by two statements, so R4's side condition (ii) is the *recomputation* branch: the
definition is substituted into both readers and the statement is deleted. Nothing about values
changes (the same `exp` on the same arguments, in the same order, once per reader); the cost is a
second `exp` per element *in this intermediate program*, which Step 3 removes again by folding
both sums into one pass.

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  l[i] = sum(j) exp(s[i, j] - m[i]);
  o[i, x] = sum(j) exp(s[i, j] - m[i]) * v[j, x] / l[i];
  return o;
}
```

Side conditions: each read's index list `(i, j)` equals the definition's ✓; recomputation
accepted ✓; order unchanged ✓. **Bit-exact.** This step is not optional: R3's pattern is stated
over the summand `exp(s − offset)·factor`, and a defined name standing for that `exp` is not the
same tree. Making the substitution a recorded rule application rather than "R3 looks through
definitions" is deliberate — a checker that unfolds definitions on its own is a checker whose
reach is hard to state.

### Step 2 (A1 → A2): R1 on the output statement — the forced slide

```tix
  tt[i, x] = sum(j) exp(s[i, j] - m[i]) * v[j, x];
  o[i, x] = tt[i, x] / l[i];
```

Side conditions: `j ∉ fv(l[i])` ✓; `tt` fresh ✓; order unchanged ✓. Real argument:
`Σ_j ((exp(s−m)·v)/l) = (Σ_j exp(s−m)·v)/l`. This is the step the one-pass form requires: after
it, `l` is used once, outside the reduction. f32: measured ≤ 10 ulps of the row scale (§9.9).

### Step 3 (A2 → A3): R3 on `{m, l, tt}` — the state appears

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  (M[i], L[i], T[i, x]) = fold(j) over (s[i, j], 1.0, v[j, x])
      with (m1, l1, t1[x]) (m2, l2, t2[x]) => (
          max(m1, m2),
          exp(m1 - max(m1, m2)) * l1 + exp(m2 - max(m1, m2)) * l2,
          exp(m1 - max(m1, m2)) * t1[x] + exp(m2 - max(m1, m2)) * t2[x])
      from (-inf, 0.0, 0.0);
  o[i, x] = T[i, x] / L[i];
  return o;
}
```

Side conditions, checked: the three reductions all range over `j` with extent `N` ✓; the sums'
offset is exactly `m[i]` ✓; summands are `exp(s − m)·1` and `exp(s − m)·v[j,x]` ✓; `s` is read
only here ✓; the combine body is the union formula ✓; `from` is its identity ✓. After this step
`m`, `l` and `tt` are gone; `s` is the only N×N tensor left, and it is read only inside the
fold's element.

The theorem of §5 applies with `J_t = {t}`: the fold's components at the end are `(M, L, O)` of
the whole index set, so `T/L = O/L = A` — the same number the plain program computes, over ℝ.

### Step 4 (A3 → A4): R4 on `s` — the N×N tensor disappears

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  (M[i], L[i], T[i, x]) = fold(j) over ((sum(d) q[i, d] * k[j, d] / sqrt(D)), 1.0, v[j, x])
      with (m1, l1, t1[x]) (m2, l2, t2[x]) => (
          max(m1, m2),
          exp(m1 - max(m1, m2)) * l1 + exp(m2 - max(m1, m2)) * l2,
          exp(m1 - max(m1, m2)) * t1[x] + exp(m2 - max(m1, m2)) * t2[x])
      from (-inf, 0.0, 0.0);
  o[i, x] = T[i, x] / L[i];
  return o;
}
```

Side conditions: the read's index list `(i, j)` equals the definition's ✓; single reader ✓;
evaluation order unchanged ✓. **Bit-exact** (§9.2a). This is the streaming form: one pass over
`j`, a state of `2 + D` numbers per row, no N×N tensor. Note that the inner `sum(d)` still extends
to the end of its own parenthesised group, which the core's "as far right as possible" rule
already gives — no new parsing rule is needed.

**A4 is the answer to the question.** R4 + R1 + R3 + R4 take the plain program to a program that
computes the same function over ℝ in one pass and whose f32 output is within a measured budget of
the plain program's own accuracy. Everything FlashAttention does by hand is in that text.

### Step 5 (A4 → A5): R5 — blocking, for the kernel

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  (M[i], L[i], T[i, x]) = fold blocks(B) t over (
      fold(t) over ((sum(d) q[i, d] * k[b * B + t, d] / sqrt(D)), 1.0, v[b * B + t, x])
          with combine from (-inf, 0.0, 0.0))
      with combine from (-inf, 0.0, 0.0);
  o[i, x] = T[i, x] / L[i];
  return o;
}
```

Side conditions: `assoc` and `identity` declared and evidenced for `combine` ✓ (Facts 2–3);
`B | N` ✓ (if not, the last block's `over` masks the tail with `−inf`); increasing block order ✓;
state type unchanged ✓. `combine` abbreviates the same body as in A4. f32: not exact, ≈ same
magnitude as A4 and slightly closer to the reference (§9.10).

The subsequent lowering (tiles in shared memory, one row-block per CTA, `k`/`v` streamed) is a
backend decision, not a rewrite: **the rules decide the traffic's asymptotics, the lowering decides
the constant.**

### The chain, in one picture

```text
 A0 ──R4(e)──► A1 ──R1──► A2 ──R3──► A3 ──R4(s)──► A4 ══R5══► A5 ──lowering──► CUDA
 given  e to    /l out   the three   the        s into    no N×N   blocked   (same
        an       of the   reductions  fold with  the fold  tensor            algebra)
        expr     j-sum    become one  its state
 grade: bit-exact  tolerance  tolerance  bit-exact   tolerance
```

A4 is the streaming form and A5 the blocked one. The probe's P1, P2, P3, P4 correspond to A2
(with and without the score's slide), A3/A4, and A5 respectively; the probe's P5 is the `u = 0`
variant of A0, which is not on this chain at all.

and, in the other direction, the same rule set derives the program we started from:

```text
 naive   w[i,x] = sum(j) exp(s[i,j]) * v[j,x] / (sum(j) exp(s[i,j]))
    │
    ├─ R2 with u = max(j) s[i,j] ──►  A0     (the plain program's max is itself a rewrite)
    └─ R2 with u = 0 ──────────────►  the unguarded variant (real-exact, f32-fatal:
                                              256/256 inf at scores of 282.8, §9.7)
```

## 14. Checking

### 14.1 What is being checked, and what is not

Three separate claims, checked three different ways, and no claim is allowed to borrow strength
from another:

1. **The rewrite sequence is a valid Tix-in / Tix-out derivation.** Checked per application by the
   rule table: the pattern matches, the side conditions hold, the fingerprint'd evidence record is
   present. Strength: a real-algebra proof per rule (R1, R2, R3, R5) or bit-exactness (R0, R4).
2. **The derived program computes the same real function as r0.** This is *implied* by (1) when
   every rule's real claim holds — that is what a real proof buys, and it is the reason to have
   rules rather than a bespoke pass: the argument is transportable, and it is checked once.
3. **The derived program's f32 behaviour is within a budget of r0's meaning.** This is *not*
   implied by (1), cannot be, and is checked by the tolerance contract of §14.2 on a domain of
   shapes and input classes.

Claim (3) is the only one that touches f32 values, and it is the reason the framework's
`checked-exact` is not available. What the derivation adds over a hand-written kernel is that
claim (1) is *checked and local*, and claim (3) is measured against the plain program's own
error rather than against an absolute constant chosen by feel.

### 14.2 The contract's domain, observation and relation

```text
id: tix.meaning-within        version: 1+<hash of everything below>

ports
  origin     tix.blocks    r0, frozen, never the previous revision
  input      tix.blocks    the revision the pass was applied to
  candidate  tix.blocks    the revision the pass produced
  params     TixParams     the domain below

domain  (what the check quantifies over)
  shapes     (N, D) in {(16, 8), (64, 32), (256, 64), (512, 128)}, plus every shape
             pair a Tix program in the corpus declares and is called at
  values     classes: normal(0,1); uniform(-1,1); wide (q,k ~ N(0,8), v ~ N(0,100));
             staircase (one row whose running max grows at every element); large-offset
             (scores of magnitude ~283, so that an unguarded offset overflows);
             near-tie (two elements within 1 ulp of each other per row)
  seed       7 (a recorded seed, so a counterexample is reproducible)
  count      8 inputs per (shape, class)          4 shapes x 6 classes x 8 = 192 cases

observation  (what is compared)
  for each case: the returned tensor, flattened in lexicographic index order, plus a status
  { finite | has-non-finite | shape-mismatch }
  plus the three evaluations the relation needs:
      ref = evalF64(r0, case)          the reference
      p0  = evalF32(r0, case)          the plain program's own f32 error
      cand= evalF32(r_k, case)

relation  (tolerance, per case, two clauses)
  aggregate:   for every row i:  ||cand_i - ref_i||_2 <= kappa * ||p0_i - ref_i||_2
                                                       + f_rms * ulp(scale_i) * sqrt(D)
  elementwise: for every element: |cand - ref| <= kappa * |p0 - ref| + f_el * ulp(scale_i)
  and:         status(cand) = status(ref)   (a non-finite element must be non-finite in both)

constants   kappa = 2, f_rms = 2, f_el = 16      (measured floors 1..2 and 12; x2 margin, §9.10)
scale_i     max_x |ref_i,x|  (the row's largest element; ulp(s) = 2^(floor(log2 s) - 23))
note        the sqrt(D) in the aggregate clause makes it comparable to the elementwise one:
            an RMS over D elements of a per-element floor is that floor times sqrt(D)
```

Four properties of this relation are deliberate and each has a measured justification:

- **It is not a per-element relative error.** A contraction's elementwise relative error is
  unbounded near a cancellation: §9.4 shows the same rule at the same shape moving elements by
  7000 ulps while the row is within 1.4e-6 of its scale. A relative-error contract would reject
  the plain program itself.
- **The yardstick is `p0`, not a constant.** "No worse than twice the plain program's own error,
  plus a floor" is a statement a domain expert can review without knowing anything about the
  derivation. It also means the contract's tightness *scales with the input class*: on `wide`
  inputs both are an order of magnitude worse than on N(0,1) (§9.1, §9.10), and the relation stays
  satisfied because it is stated against `p0` rather than against a constant.
- **The floor is not zero and it is not small.** 16 ulps of the row scale elementwise is 2e-6
  relative; a contract without it would demand that the forced output slide cost nothing, which
  §9.9 shows it does not.
- **The status clause is separate.** A rewrite can be within the numeric budget on every finite
  element and still turn the whole program into NaN — the `u = 0` variant is within
  tolerance on N(0,1) inputs (§9.3) and 100 % non-finite at large scores (§9.7). The
  status clause is what catches that, and it is checked independently of the numeric budget.

### 14.3 How each rule's application is checked

| rule | application check | strength | cost |
|---|---|---|---|
| R0 | structural (index bijection) | exact | µs |
| R1 | side conditions (i)–(iv) | structural; the real claim is the rule's | µs |
| R2 | side conditions, *including* the range condition on `u` — discharged structurally when `u` is a fold's running max, otherwise by range analysis (not in scope, §19) | structural + one real lemma | µs |
| R3 | pattern over the statement group; extents; `j`-freeness; offset identity; the combine body normalizes to the union formula | one real induction per rule, one normalization per application | ms |
| R4 | index-pattern equality, single-reader test, order preservation | exact | µs |
| R5 | `assoc`/`identity` evidence for the specific combine fingerprint; block-order test | as the rule's | µs |

Plus, once per *pass*, the tolerance contract of §14.2 over its cases. Nothing in the table is
sampled at the rule level: the rule-level claims are real claims or structural claims, and the
only sampling in the system is where the f32 gap is (which is the honest place to sample).

### 14.4 Evidence, strength and version keys

```text
RuleEvidence (per rule, once; IRWB-006's shape)
  { rule, version, fingerprint, verdict, strength: 'proof' | 'exact' | 'measured',
    realArgument: string,        the induction or the two-line cancellation, in prose + steps
    f32: { maxRowRelInflation, ulpFloorElementwise, ulpFloorRms, cases },   from the probe
    fragmentBoundary?: string }  for R3: what the normalizer is complete for

DerivationEvidence (per pass)
  { rules: [{ name, version, fingerprint, at: <site> }],   the sequence, in order
    strength: weakest rule strength,                       IRWB-008 §19's discipline
    residual: [] | [reasons] }                             what could not be derived

ToleranceEvidence (per pass)
  { method: 'sampled-tolerance', cases, seed, shapes,
    worst: { ratio, maxRowRel, case }, counts: { within, outside, nonfiniteMismatch },
    assurance: 'checked-tolerance' }
```

The contract's version string hashes the domain (shapes, classes, counts, seed) **and** every
rule fingerprint in the derivation table, because a change to a rule changes what the derivation
claims. Editing a rule without re-verifying it therefore changes the contract's identity, exactly
as editing a case parameter does today.

**Where the assurance sits in the order.** IRWB-008 §19's order is
`proof > exhaustive > reduced-width+argument > by-construction > sampled`. A tolerance step is
*not* comparable to any of these: it is stronger than `sampled` (it has a per-element bound and a
status clause) and weaker than `by-construction` (it does not cover every input). §17 proposes
inserting `checked-tolerance` between `by-construction` and `sampled`, and records that this
ordering choice is the same open question IRWB-008 flagged.

### 14.5 The chain-level warning, for this domain

An attention program's derivation is `tolerance` at the R1, R3 and R5 steps and `exact` at R4. So
the *chain* is `checked-tolerance` even at the step where R4 fires, and the workbench must not
present the streaming program as "exactly the same program". The strongest true statement is the
pair (1)/(3) of §14.1: *same function over ℝ, same f32 answer within the measured budget.* For
reporting, the useful pair of numbers is `maxRowRel(cand)` and `maxRowRel(p0)` side by side, so a
reader sees "the derived kernel is 1.3× as far from the exact answer as the program you wrote",
which is the sentence the design is trying to make true.

### 14.6 Cost

- Contract: 4 shapes × 6 classes × 8 inputs = 192 cases; each case evaluates three programs. At
  N=256, D=64 the f32 evaluator does about 5·10⁶ rounded operations per case in a naive
  interpreter, so a contract is seconds, not minutes. The evaluator being built in parallel may be
  much faster; the design does not depend on which.
- Rule evidence: computed once per rule version, in the probe (5 s for everything).
- Derivation check: milliseconds per pass (pattern matching over a program with one fold).

## 15. Generality

### 15.1 What the same rule set reaches

| program | rules | what comes out | status |
|---|---|---|---|
| **softmax followed by a contraction** (`y[i,x] = Σ_j softmax(x)[i,j]·W[j,x]`) | R1, R3, R4, R5 | streaming fused softmax-matmul: one pass over `j` per output block, no N×C weight matrix | reached |
| **log-sum-exp** (`lse[i] = log(Σ_j exp(x[i,j]))`) | R2 (with a `log`), R3 | state `(M, L)`, i.e. the two-component instance; `lse = M + log L` | reached (the simplest instance of the construct) |
| **softmax statistics, one pass** (`m`, `l` of a softmax) | R2, R3 | the three-pass softmax becomes a two-pass one (statistics, then the write of `p`) | reached |
| **RMSNorm statistics** (`s[i] = Σ_c x[i,c]²`) | R3 with `⊕ = +` | a one-component state; an ordinary `sum` with a tuple of one, i.e. no new rule at all | reached trivially |
| **attention with an additive mask** (`s[i,j] − (mask[i,j] ? 0 : large)`) | R1, R3, R4, R5 | a streaming masked attention; the mask is a term of the score, not a range predicate | reached |
| **layer statistics in one pass** (mean and variance together) | R3 + a *new* rule | see §15.2: the construct reaches it, the rule set does not yet | needs R6 |

### 15.2 What it fails on, and why

1. **LayerNorm in one pass, by `Σ(x−μ)² = Σx² − nμ²`.** The construct reaches it (state
   `(n, Σx, Σx²)`), but the identity is *not* in the rule set, and it is not a good rule: it
   cancels catastrophically when `μ² ≫ var`, so a program whose data is nearly constant gets a
   variance of noise. A rule for it is possible (real-exact, f32 with a *conditional* budget that
   fails on near-constant rows) but it must be a separate rule with its own measured floor, and
   the honest form is Welford's, whose combine is rational and therefore has a larger f32 error.
   **This is the clearest case of the rule set being about a *shape* of program, not about
   attention.**
2. **Softmax itself (writing `p[i,j]`), in one pass.** `p` is a per-element output that depends on
   the *final* state, and R3's replacement binds the fold's components, which are reductions. So
   `softmax` is not reachable in one pass, and no rule in the set is missing — the program's
   output is not a function of the state alone. What is missing is a *recompute* rule ("second
   pass over the same index with the final state"), which is a different rule with a different
   proof obligation (it costs a re-read, so it is a traffic change, not a value change).
3. **A max whose index set differs from the sums'.** If the normalizer summed over a subset, the
   offset would no longer bound the summands, so R2's f32 guard fails while its real claim still
   holds. Such an application cannot be *derived* — the guard is a real theorem in one direction
   and a f32 fact in the other — so it must come out residual and be decided by sampling, which
   the status clause of §14.2 catches (§9.7 is the measured case).
4. **A summand that is not a lift of one index.** Sliding-window or local attention,
   `Σ_{j in [j0(i), j1(i))} exp(s_j − m)`, and anything whose offset is not the *prefix* maximum:
   R3's induction does not apply, because its invariant is "the state of the prefix seen so far".
   The construct can still carry such a state (a ring buffer of `B` scores is a tuple), but there
   is no re-association law for it and R5 would have no `assoc` to lean on. This is the boundary
   between "a reduction with a summary state" and "a scan with a window", and the rule set is on
   the first side of it.
5. **`argmax`.** The state is `(max, index)` and the natural combine is not associative on ties:
   `combine((5,2),(5,7))` has two answers depending on the parenthesisation. Fixable by a
   tie-breaking rule (smaller index wins), which makes it associative — and *only* then does R5
   apply. A rule set without the tie-break silently changes programs.
6. **Anything that must be bit-identical.** If a user's contract is "the compiler must not change
   a single bit", only R0 and R4 qualify, and the derivation stops at A1 with `s` still materialized
   (the fold *is* the change). §9.9 measures what that costs: the whole point of the exercise.
7. **A non-associative combine with a *scalar* state.** Then the construct still has a meaning but
   R5 does not apply, so no blocking, so no kernel. The rule set says so instead of silently
   producing a fast wrong program.

### 15.3 What generality means for the deliverable

The rule set is five rules *because* attention's three facts are the general case, not because
attention was reverse-engineered: a state, an identity, a combine, and a quotient at the end. Any
program of the shape

```text
    summary[i] = fold(j) <state lift>
    out[i, ..] = <a function of summary[i]>
```

is in scope, where the fold's state is anything the construct can carry. Programs whose output is
*per element of the folded axis* are out of scope (§15.2, item 2). That boundary is worth stating
in the ticket's summary, because it is the boundary that decides which of the workbench's
tensor programs the machinery can help.

---

# Part 5: The experiment

## 16. The experiment

### 16.1 Hypothesis

**H1 (derivation).** The rule set of §12 applies to the A0 program with every side condition
discharged automatically by the checker — no human-supplied annotation beyond the `assoc`/
`identity` declarations — and produces A4 and, with one `B`, A5. The sequence is recorded with
one fingerprint per application.

**H2 (accuracy).** The derived kernel's output satisfies §14.2's relation against the f64
reference on every shape and input class in its domain, with the measured constants
`κ = 2, f_rms = 2, f_el = 16`, and no case is worse than 2× the plain program's row-RMS error.

**H3 (traffic and time, the primary claim).** On the GB10, for N ∈ {512, 2048, 4096, 8192} and
D ∈ {64, 128}, the derived kernel (A5 lowered by the CUDA backend with block sizes derived from
the device's shared-memory budget, and *no* hand tuning of the inner loop) achieves

```text
  DRAM bytes   <= 1.25 x  the hand-written streaming kernel's bytes
  DRAM bytes   <= 1/3   x  the unfused lowering's bytes           (the asymptotic claim)
  median time  <= 1.5  x  the hand-written streaming kernel's time
```

**Primary metric: bytes moved (DRAM), with device time second.** Bytes because the whole claim is
a memory-traffic claim, because bytes are a *property of the artifact plus the lowering* while
time is a property of the vendor's compiler, and because bytes are measurable without a tuning
budget. Both are reported as ratios to the hand-written kernel, with the unfused lowerings as the
second baseline.

### 16.2 The four kernels and the ablation

```text
K0  unfused        A0 lowered with elementwise fusion only; s and e materialize (the baseline
                   to beat, and the "what the program says" reference)
K1  fold, flat     A4 lowered as one loop over j; no blocking (isolates the two R4s and R3)
K2  fold, blocked  A5 lowered with Bq/Bc from the SMEM budget (isolates R5's effect)
K3  hand-written   an FA2-style kernel, hand tuned by a person
R   CPU reference  evalF64(r0) (the contract's reference)
```

K0→K1 isolates "no N×N tensor" (R4, R3); K1→K2 isolates "blocked state in shared memory" (R5);
K2→K3 is "how much hand tuning the derivation gives away". Reporting only K2/K3 would hide which
rule bought what, and the ablation is the part of the experiment that would still be interesting
if H3 failed.

### 16.3 Procedure

1. Freeze the four artifacts and their revision hashes; record the derivation evidence for A4/A5.
2. For each (N, D, class): generate inputs from the recorded seed; run R on the host; run
   K0..K3 on the device; check §14.2's relation for each against R (this is H2).
3. Measure per kernel: `dram__bytes.sum`, `lts__bytes.sum` (L2), `gpu__time_duration.sum` (or
   CUDA events), 50 warm iterations, median and IQR; report bytes per (N,D) and the three ratios.
4. Measure the same four kernels on a device with L2 pressure (e.g. N = 8192 at D = 128, where
   K+V = 8 MB may or may not stay resident) so that §4's two traffic models are distinguishable.
5. Record compile time: the derivation check and the tolerance contract, per pass.

### 16.4 What would refute it

Any one of these falsifies the design as stated, and each one points at a specific section:

| finding | what it refutes |
|---|---|
| K2 moves ≥ 2× K3's DRAM bytes at any shape | H3, and §11.6's claim that blocking can be a checked re-association: if the lowered artifact cannot keep the state resident, the derivation's traffic advantage is not realizable |
| K2 is ≥ 2.5× slower than K3 at every shape | H3's practical form: the derivation is correct but not worth having |
| any case outside §14.2's relation on a non-adversarial class | H2: the budget's constants are wrong, and §9.10's floors must be re-derived (which would also mean the derivation is less accurate than measured) |
| a side condition that the checker cannot discharge without a new analysis (e.g. R2's range condition when `u` is not a running max) | H1, and §12's claim that each application is mechanical |
| the derivation applies to attention but not to the other programs of §15.1 | the generality claim (§15), though not H1–H3 |
| `expf` on the device differs from the f32 evaluator enough to break the relation on a plain N(0,1) case | the contract's transferability to the device (risk 4) — and it would make §16.2's H2 a statement about the emulator only |

The last row is the one I would check first, before measuring any time: if the device's `exp` is
not the language's `exp`, the contract governs nothing on the device and the experiment measures
a program the compiler did not verify.

### 16.5 Cost and what is needed

A GB10, `nvcc`/CUDA 12.x, `ncu`, and the Tix evaluators. Nothing in this worktree is on that
path yet, so the experiment's first deliverable is a two-kernel smoke test (K0 vs K2 at N = 512,
D = 64) whose only purpose is to show the harness, the byte counters and the reference agree
before any of the numbers in §16.3 mean anything.

---

# Part 6: Decisions, risks, and what is left out

## 17. Decisions, with the simplest alternative each time

**D1. The deliverable is a rule table plus a recorded sequence, not a search.**
The simplest alternative is what people do: write the kernel, check it against the program with
one sampled contract. It falls short on the question asked — the argument becomes global ("this
kernel matched on 200 cases"), not local — and it transfers to nothing. The second alternative is
one monolithic rule, `attention → flash attention`, which is local only in a trivial sense (it has
one instance) and mechanical only by appeal to a paper. The third is an e-graph search over the
same table (IRWB-010's machinery): compatible, and where this should end up, but a search cannot
be reviewed as an argument, whereas the sequence can. The sequence is also a certificate: a search
that finds A4 can be *checked* by matching it against the table.

**D2. The construct is a fold with an inline combine body.**
Alternatives: (a) a named monoid declared per program — better for reuse and for the evidence
table (one evidence record per monoid rather than per statement), worse for pattern matching,
because a fold whose combine is `attention.monoid` no longer *is* the union formula the checker
compares against; (b) higher-order functions/records — needs a type system this language does not
have; (c) a hidden loop with mutable accumulators — breaks single assignment, which the
framework's diff and correspondence rely on. The inline body wins because the checker's job (does
this body equal the union formula?) is a normalization when the body is present and a call-graph
walk when it is not.

**D3. The state is a heterogeneous tuple with per-component extents.**
Alternative: one tensor with a synthetic leading axis of size `2 + D` and masking; falls short
because the components' extents differ (`M`, `L` per row; `T` per row and channel), so the
synthetic axis would mix ranks and make the fold's element expression deal with a ragged shape.
The tuple is what the mathematics is; making the IR match the mathematics is the whole point.

**D4. Blocking is written down in Tix (E2) but is not required for the derivation.**
Alternative: leave blocking to the backend; falls short because the primary metric then measures
hand-written code (§16.1's K2 vs K3 distinction collapses). Alternative: make Tix blocked
throughout; falls short because every reduction in the language would need block algebra. The
chosen position — the derivation ends at A4, R5 produces A5, the backend lowers A5 — keeps the
checked artifact's traffic claim real without burdening the core language.

**D5. The relation is row-aggregate with an elementwise guard, with measured constants.**
Alternatives: elementwise relative error (falls short: unbounded near cancellation, §9.4); ulp
distance per element (falls short for the same reason, and §9.4 shows 7000-ulp elements in a
1e-6-accurate row); a fixed absolute tolerance (falls short because the right scale is the input
class's, §9.1 vs the `wide` class); bit equality (impossible: §9.5). The chosen form is the
weakest one that still has teeth: it catches a drift, a gross element and a non-finite pattern,
and it states its own accuracy floor in a unit a reviewer can interpret.

**D6. The reference is the f64 evaluation of r0.**
Alternative: exact rational arithmetic with a correctly-rounded `exp` — falls short on the
transcendental and would cost more than it buys, since f64's error (~1e-16) is five orders below
the smallest floor (2e-6). This is the one place where a cheaper choice is justified by the
measured numbers rather than by principle.

**D7. The running maximum lives in the source (the fold), not in the backend.**
Alternative: the backend keeps the max in a register and rescales; falls short because then R2's
f32 guard has nothing structural to lean on — the "self-guarding" property (§9.7) depends on the
invariant of the *fold statement*, which only exists if the fold is in the IR.

**D8. A new contract id, `tix.meaning-within`, with its own version space.**
Alternative: reuse `typed.meaning-kept` with a different version — falls short because the two
domains' relations are different kinds of object (agreement vs tolerance), and a shared id would
let a tolerance revision masquerade as an exact one in the workbench's assurance column.

**D9. `checked-tolerance` sits between `by-construction` and `sampled`.**
Alternative: put it above `reduced-width+argument` because it covers every input in the domain —
falls short because it is a *sampled* quantifier over the domain, not a proof. The order proposed
here matches IRWB-008 §19's open question; the implementation should record counts per strength so
a stricter policy is computable later.

## 18. Risks

| risk | why it is real | mitigation |
|---|---|---|
| **risk 1: the budget is loose in the last two digits.** The forced slide costs ~1e-6 of the row scale and the floor is 16 ulps; a user who needs 1e-7 gets nothing. | §9.9: the slide is *forced* by the one-pass form; there is no streaming form in f32 without it. | State the accuracy cost as part of the feature (the two numbers side by side, §14.5); refuse the derivation under a contract tighter than the measured floor rather than silently missing it. |
| **risk 2: a rewrite that looks free is expensive on scores.** R1 applied to the score costs 173 ulps because `exp` amplifies an absolute score error by the score's magnitude (§9.12). | The rule is legitimate and tempting (scale `q` once). | Keep it out of the chain by default; give it its own evidence record and its own measured floor; never apply score-side rules under the same budget as state-side ones. |
| **risk 3: the fragment boundary.** R3's checker is complete for (max, exp, +, and multiplication by anything that is not a score term). Outside it, the application must come out residual — and a checker that normalizes *approximately* would silently accept a wrong derivation. | The normalizer is new code with a small theory. | Test it against a corpus of programs deliberately just outside the fragment, each of which must be residual; record the boundary in the evidence record (§14.4). |
| **risk 4: the device's `exp` is not the language's.** `expf` with fast-math, `--use_fast_math`, or an approximate `__expf` changes the weights by more than the budget. | The contract governs the f32 evaluator; nothing in the framework notices that the *device* computed something else. | Backend flags fixed and recorded in the artifact (no fast-math, no `-ffast-math`, no FMA contraction unless the contract models it); a device-vs-evaluator equality test on a sample of the contract's cases as a gate (§16.4's last row). |
| **risk 5: contraction.** If the backend fuses `a·b + c` into an FMA, results change exactly as IRWB-011 §6 measured for Candela. | The tuple combine is *made* of `a*b + c`. | Same as risk 4; the contract's version key includes the backend's float mode. |
| **risk 6: the derivation is a hand-written strategy.** Nothing in this design searches for the sequence; it is the sequence in §13. | A different program needs a different sequence. | That is what "design only" means here; the strategy's job is rule *selection*, and §15 lists the programs it must handle. |
| **risk 7: overfitting the rules to attention.** | Five rules look tailored. | §15.1 lists four other programs the same set reaches and §15.2 lists the ones it must refuse; a rule that only fires on attention's exact statement grouping is a smell. |
| **risk 8: the probe's `exp`.** The measurements use the host's `exp` rounded to f32; a CUDA `expf` differs. | Same as risk 4, at the measurement level. | Re-run the probe against the device's `expf` values when the backend exists; the conclusions are about *order of magnitude* and would survive a 10× change. |
| **risk 9: N² cost of the probe.** Device-scale shapes were not measured on the host. | §9.11. | The device experiment covers exactly the shapes the probe could not. |

## 19. Later

- A blocked index axis in Tix as a first-class shape (E2 today is an annotation).
- Masks as range predicates on reductions (`where`), instead of additive score terms.
- Split-K / tree reductions, which need `commute` (§11.4), a partition with no empty part, and a parallel lowering.
- A second-pass "recompute" rule, which is what one-pass softmax needs (§15.2 item 2).
- Rule selection as a strategy (IRWB-010's search over the same table, with the sequence as a certificate).
- The backward pass (three more programs with the same shape; not designed here).
- Multi-head and batching, which are an extra statement index and not a new rule.
- A `let` inside a combine body, so `max(m1,m2)` is computed once instead of three times.
- fp16/bf16 as a second precision domain, with its own budgets.
- Range analysis for R2's guard when `u` is not a running max (the "lazy offset" case).
- A device-vs-evaluator equality gate, which turns risk 4 into a checked condition.
- The inverse direction: recognizing a hand-written streaming kernel as the image of a derivation.

## 20. If this were implemented: phases and acceptance

Each phase has its own acceptance measurement; a phase that misses it stops the track rather than
being absorbed.

| phase | deliverable | acceptance |
|---|---|---|
| P0 (done) | the probe `scripts/01-f32-probe.mjs` and its numbers | reproducible in 5 s; the self-checks of §9.2 pass |
| P1 | the `fold` statement in the Tix IR: parse, extents, `evalF32`, `evalF64` | the probe's P0 and P3 programs, written in Tix, evaluate to the probe's tensors bit for bit |
| P2 | the rule table as data, with fingerprints and evidence records | every rule has an evidence record; a mutated rule fails the fingerprint test |
| P3 | the R3 normalizer and the per-application checker | every program of §15.1 derives; every program of §15.2 comes out residual with a reason |
| P4 | the derivation strategy for §13 | the sequence is reproduced with no human input; the derivation evidence lists R4, R1, R3, R4 (and R5 for the blocked artifact) |
| P5 | `tix.meaning-within` and `checked-tolerance` | the contract accepts A4/A5 on every shape and class, and rejects the `u = 0` variant on the large-offset class |
| P6 | the CUDA lowering of A4 and A5 | K0 and K2 run; the device-vs-evaluator equality gate passes on the contract's cases |
| P7 | the experiment of §16 | H1–H3 measured, or refuted with the numbers that refute them |

---

# Appendix A: the derivation in one page

```text
A0 (given)   s = Σ_d q·k/√D ;  m = max_j s ;  e = exp(s−m) ;  l = Σ_j e ;  o = Σ_j e·v/l
   │
   ├─ R4 (e)         e[i,j]  →  exp(s[i,j] − m[i]) in both readers, e deleted
   │                 real: substitution; f32: bit-exact
   │
   ├─ R1 (output)    Σ_j (exp(s−m)·v/l)  →  (Σ_j exp(s−m)·v)/l   [forced by the one-pass form]
   │                 real: distributivity; f32: ≤ 10 ulps of the row scale
   │
   ├─ R3             {m, l, tt}  →  fold(j) over (s, 1, v) with the union combine
   │                 real: prefix induction (base = identity, step = union formula)
   │                 f32: running max instead of final max; 1.0–2.5× the plain error
   │
   ├─ R4 (s)         s  →  substituted into the fold's element; the N×N tensor is gone
   │                 real: substitution; f32: bit-exact (0 of 2048 elements differ)
   │                 == the streaming form ==
   │
   └─ R5             fold(j)  →  fold(b) of fold(t),  j = b·B + t     [blocking]
                     real: identity + associativity (both from the union formula)
                     f32: 92 % of elements move; same magnitude, slightly closer to the reference
```

```text
the other direction, same rule set:
   naive   w = Σ_j exp(s)·v / Σ_j exp(s)
      ├─ R2(u = max(j) s) ──► A0        the plain program's max is itself a rewrite
      └─ R2(u = 0) ─────────► unguarded  real-exact, f32-fatal: 256/256 inf (§9.7)
```

# Appendix B: what the probe measured, and how to re-run it

```bash
cd ttmp/2026/11/26/IRWB-021-M--deriving-streaming-attention-by-checked-rewrites
node scripts/01-f32-probe.mjs --json various/01-f32-probe.json | tee various/01-f32-probe.txt
```

| probe | what it answers | section |
|---|---|---|
| 0 | are fusion and the blocked boundary bit-exact? is R2 at `u = max` bit-exact? | §9.2 |
| 1 | the plain program's own error (the yardstick) | §9.1 |
| 2 | each derived form against the reference | §9.3 |
| 3 | re-association alone, by block width | §9.4 |
| 4 | is the combine associative in f32? | §9.5 |
| 5 | the staircase adversary (a running max that grows at every element) | §9.6 |
| 6 | the subnormal rescale, and the bound that makes it invisible | §9.8 |
| 7 | dropping the offset: 100 % inf/NaN where ℝ says "identical" | §9.7 |
| 8 | the division slide alone | §9.3, §9.9 |
| 9 | input classes (normal, uniform, wide) | §9.10 |
| 10 | the traffic model, both cache assumptions | §9.9, §4 |
| 11 | the tolerance relation's constants | §9.10 |
| 12 | the two division slides separately — the measurement that changed the rule set | §9.9 |

Limitations, stated once: the probe is a host-side model of the Tix f32 semantics, not the Tix
evaluator; its `exp` is the host's; it evaluates O(N²) per call so N ≤ 512; it measures nothing
about CUDA. Its conclusions are about orders of magnitude and about which rewrite is cheap, both
of which a correct evaluator and a device `expf` would not overturn by a factor of ten. §9.11 is
the full list.

# Appendix C: glossary

| term | meaning here |
|---|---|
| **attention** | single-head scaled dot-product attention, the P0 program of §13 |
| **streaming form** | a program that computes attention in one pass over `j` with a per-row state, storing no N×N tensor |
| **FlashAttention** | the hand-written kernel that realizes the streaming form; the *target* of the derivation, not its method |
| **state / carry** | the fold's tuple, `(M, L, O)`: running max, running normalizer, running unnormalized output |
| **combine** | the operation that merges two states; for attention it is Fact 2, the union of index sets |
| **lift** | the singleton state an index contributes, `(s_j, 1, v_j)` |
| **offset** | the value subtracted inside `exp` before summing; `−∞` at the identity, the running max in the fold |
| **real-exact** | equal over ℝ for every input; says nothing about f32 |
| **bit-exact** | equal as f32 values for every input |
| **row scale** | the largest absolute output element in row `i`; the unit of every relative error in this document |
| **ulp** | unit in the last place; one step between adjacent f32 values near a given magnitude |
| **checked-tolerance** | the assurance a tolerance contract attains: measured within a bound, not proved equal |
| **residual** | a change a rule table could not derive; sampled, never silently accepted |
| **score-side / state-side rewrite** | touches the expression defining the scores (sensitive to the score's magnitude) vs only the weights' association (first order in `u`) |
