---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-O
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
      Note: differential() and DifferentialSpec — the shape of a domain/cases/run/compare relation, which the Tix tolerance relation has to fit
    - Path: repo://src/framework/ir/patterns.ts
      Note: the framework pattern language; the design explains why it does not match statements over an index space
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass — the gate every rule application would run through; its meaning-check slot is where the Tix invariant goes
    - Path: repo://src/typed/evaluate.ts
      Note: meaningKept and agrees — today's exact verdict, the thing a tolerance verdict would sit beside
    - Path: repo://src/typed/f32.ts
      Note: the statements about f32 rounding this design leans on (one Math.fround of the double result; no product-sum fusion)
    - Path: repo://src/typed/rules/form.ts
      Note: rules as frozen data (pattern, guard, template) — the model a tensor-rule form would follow
    - Path: repo://src/typed/rules/verify.ts
      Note: the MethodName / Strength / RuleEvidence vocabulary this design reuses for per-rule evidence
ExternalSources: []
Summary: 'A research design, no implementation: can a compiler derive FlashAttention from the plain Tix attention program as a sequence of rewrites whose correctness is local and mechanical? The answer is a four-rule set (Split, Factor, Fuse, Rebase), one new IR construct (a fold over a declared monoid with a non-scalar state and a region body), an f32 meaning for it, a per-rule checking story with measured f32 drift, a generality map, and a falsifiable experiment on the GB10.'
LastUpdated: 2026-11-26T00:00:00-05:00
WhatFor: 'The reference for IRWB-021-O: what the rule set is, what the IR must gain, what is checked and how, and what experiment would refute the thesis.'
WhenToUse: Before implementing the Tix fold, the tensor rule verifier, or a streaming-attention derivation; and when deciding what the Tix meaning contract's tolerance relation must be.
---

# Deriving streaming attention by checked rewrites

## 0. Executive summary

The plain Tix program for single-head attention defines two N×N tensors, `s` and `e`, and re-reads them three
times. The streaming form (FlashAttention) computes the same values in one pass over blocks of `j`, keeping a
running maximum, a running normalizer and a running output, and never stores either matrix.

This document designs the research that would answer whether a compiler can **derive** the second from the first
as a sequence of rewrites, each checked, each with a local and mechanical argument. The design's answer is yes,
and it is small:

- **Four rules** — `Split`, `Factor`, `Fuse`, `Rebase` — take the program as written to the streaming form in five
  applications. Every one of them is a statement about a reduction over an index set, not about attention.
- **One new IR construct**: a `fold` statement over a declared **monoid** — a reduction whose state is a tuple of
  tensors, whose combine is user-supplied, and whose body is a small single-assignment **region** with local
  temporaries. The state type carries the free indices of the statement it binds (`f32[D]` here). Its f32 meaning
  is the plain left fold in increasing lexicographic index order, the same order `sum` and `max` already have.
- **Every rule carries a proof over the reals**: one line of substitution for `Fuse`, distributivity for `Factor`,
  associativity plus the identity law for `Split`, and the two-set identity for `Rebase` — the only non-trivial
  lemma in the set. `Fuse` is additionally **bit-exact in f32** and is checked structurally. `Split`, `Factor` and
  `Rebase` are not bit-exact in f32 and are checked by a scaled tolerance relation, whose scale and constant this
  document derives from measurement.
- The **f32 drift is real and measured**, and it is *not* where one would guess: at N=1024, D=64 the whole rule
  chain moves the outputs by up to 4.5e-2 relative (7.5e-2 on an independent data draw) — but that number is set
  by the **conditioning of the output
  contraction** (up to 4.2e6 for random `v`), not by the rewrites. Measured against the contraction's own term
  scale, the whole chain's drift is 2.85e-7 ≈ 4.8·2⁻²⁴; the plain program is 4.2·2⁻²⁴ from the f64 reference and
  the derived one 5.0·2⁻²⁴, so the derivation costs about one rounding of accuracy and buys the memory.
  Consequences: a relative-only tolerance is not a usable gate at these shapes, and the burden of correctness
  sits on the per-rule evidence, not on the whole-program check.
- **The experiment** is falsifiable in three independent ways: a tolerance violation at the chosen parameters, a
  DRAM-bytes or time result on the GB10 that shows the N² traffic survived, or a rule whose evidence record
  needs a fact about the program rather than about the rule.

What this document does **not** do: no Tix front end, evaluator, tolerance relation, CUDA backend or rule
verifier is implemented here (see §11). The CPU-side probes of §6.3 and §9.5 are the only code written, and they
exist to keep the algebraic and numeric claims honest.

---

## 1. The program, and what "materialises N×N" means in Tix

### 1.1 The program as written (P0)

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);   // N×N
  m[i] = max(j) s[i, j];                          // N
  e[i, j] = exp(s[i, j] - m[i]);                  // N×N
  l[i] = sum(j) e[i, j];                          // N
  o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];      // N×D
  return o;
}
```

Three facts about it matter for everything that follows.

**Two of the five statements bind N×N tensors.** `s` and `e` are the materialisation: `s` is written once and read
twice (by `m` and by `e`), `e` is written once and read twice (by `l` and by `o`). Six of the seven tensor
definitions in this program either produce or consume an N×N tensor.

**Three aggregations share one index.** `m`, `l` and `o` all reduce over `j`. `l`'s summand and `o`'s summand both
mention `m`, and `m` is itself a reduction over `j`. That nesting — a reduction whose summand depends on a
reduction over the same extent — is the whole difficulty, and it is what the `max` exists for: it is a
numerically motivated *dependency*, not a mathematical necessity.

**`o` divides inside the sum.** `sum(j) e[i,j] * v[j,x] / l[i]` divides each term by `l[i]`, and `l[i]` is a
reduction over the same `j`. So `o` cannot be computed until `l` is complete, *unless* the divisor is taken out of
the sum, which is valid over the reals and changes f32 bits (§6.3).

Two conventions of the Tix core are used below and are worth restating because the rules depend on them: a
reduction body extends as far right as possible, so `sum(d) q[i,d]*k[j,d]/sqrt(D)` divides **each term**; and
`sum` accumulates from 0 in increasing lexicographic order of its indices, first listed outermost, with a
`Math.fround` after every step.

### 1.2 The target form (P5, in words)

For each row `i`, one pass over blocks of `j` (width `B`, `B | N`):

```text
state := (-inf, 0, 0)                         # (running max m, running normalizer l, running numerator t)
for each block K of B consecutive j:
    u  := the block's scores            u[j] = sum(d) q[i,d]*k[j,d]/sqrt(D)
    mK := max over K of u
    m' := max(m, mK)                   # the running max, after this block
    a  := exp(m - m')                  # 1 when the maximum did not grow; 0 for the first block
    l  := l*a + sum over K of exp(u[j] - m')
    t  := t*a + sum over K of exp(u[j] - m') * v[j,:]
    m  := m'
o[i,:] := t / l
```

Nothing with an N×N shape exists. The live state per row is one scalar triple plus a D-vector, and the per-block
temporaries are `B` scores and `B` exponentials.

### 1.3 What may be claimed about memory

The claim the derivation supports, stated precisely:

- **Storage**: the derived program's live state is `O(D)` per row processed, or `O(Bq·D)` for a block of `Bq` rows;
  the plain program's peak is `Θ(N² + N·D)` values. This is a statement about the *program*, and it is what the
  rules establish.
- **Traffic**: not `O(N·D)`. Streaming all of `k` and `v` once per row is `Θ(N²D)` reads. Traffic becomes
  `Θ(N²D/Bq + N·D)` only with an additional schedule decision — tiling a block of `Bq` rows of `q` against a tile
  of `k`,`v` so the tile is read once per `Bq` rows. That decision is a **lowering choice**, not a rule in this
  document, and the experiment (§9) measures actual DRAM bytes rather than asserting a bound. The safe claim,
  and the one the experiment tests, is that the derived program's traffic drops from "materialise, write and
  re-read N²+N²D bytes" to "read k,v a bounded number of times".

---

## 2. What the framework gives us today

Everything in this section exists in this worktree; nothing here is proposed.

### 2.1 Every pass application is checked

`applyPass` (`src/framework/passes/define-pass.ts:190`) is the only way a pass may publish a revision. It diffs the
result against its input, rejects changes outside the pass's declared writes (`undeclaredWrites`), runs the
pass's **meaning check** — a v6 `InvariantDefinition` over the `{origin, candidate}` pair — and verifies the
pass's claims about which analyses it preserves. A pass that produces a wrong program is rejected and nothing is
published.

For this design that means: a rule application is safe to publish **if and only if** it comes with an invariant
that says what "the same program" means, at the strength the rule needs. §6 designs that invariant for Tix.

### 2.2 The shape of a meaning check: domain, cases, run, compare

`differential(spec)` (`src/framework/contracts/differential.ts`) packages the sampled method as an ordinary
invariant. Its `DifferentialSpec` is, for our purposes, exactly the triple the brief asks for:

| contract element | `DifferentialSpec` field |
| --- | --- |
| **domain** | `inputs`, `count`, `seed`, and `cases(inputs, random, count)` — the generated cases |
| **observation** | `run(side, value, kase, inputs)` — what each side produces for a case |
| **relation** | `compare(baseline, subject, kase)` and `inconclusive(outcome)` — the verdict |
| (provenance) | `baseline`, `subject`, `baselineKey`, `subjectKey`, `decide` |

The evidence records method, total/agree/disagree/inconclusive counts and the first counterexamples, and a run with
no decided case **fails** rather than passing vacuously. The two existing instances are
`typed.meaning-kept` (`src/typed/evaluate.ts:594`) whose relation is `agrees` — exact results plus exact bytes,
traps agreeing with traps, faults never agreeing — and its stronger variant in `src/typed/cases-strong.ts`.

There is **no tolerance relation anywhere in the tree** (`grep -rn tolerance src/` finds nothing). The Tix
contract's tolerance relation is being built in parallel and is not in this worktree; §6.1 therefore specifies the
relation this design needs as a *requirement on that relation*, with the numbers that make it fit for this use.

### 2.3 Rules as data, and evidence per rule

IRWB-006 B1/B2 built the model this design reuses. A rule is plain frozen data — `{name, version, about, types,
lhs, where, rhs, because, note}` (`src/typed/rules/form.ts`) — and `src/typed/rules/verify.ts` verifies a rule
*once*, for every input of its declared types, recording one `MethodResult` per method and a single `Strength`:

```text
strength: 'proof' | 'exhaustive' | 'reduced-width+argument' | 'sampled' | 'by-construction'
methods:  'structural' | 'by-construction' | 'symbolic-linear' | 'bitwise-w1'
        | 'exhaustive-w8' | 'random-32' | 'f32-special' | 'exhaustive-32'
```

Two properties of that design carry over unchanged, and one does not.

- It carries over that a rule's evidence is **independent of any program**: a counterexample from any method
  rejects the rule, and the evidence is keyed by the rule's name and version.
- It carries over that **reduced-strength methods count only with an argument** that the property does not depend
  on the reduced parameter (`exhaustive-w8` holds for rules with a stated widening argument; `x * 256 → 0` at 8
  bits is the cautionary example). The tensor analogue is "exhaustive over *tiny extents*, plus an argument that
  the rule is parametric in the extent and in the values" (§6.2).
- It does **not** carry over that rules are pattern → template replacements over value trees. A tensor rule
  rewrites a *statement* (a definition over an index space with reductions); the pattern language of
  `src/framework/ir/patterns.ts` matches entities and operations of an IR's projection, so a tensor-rule form and
  matcher would be new work, explicitly out of scope here (§11).

---

## 3. The Tix extension: one new statement form

The core has reductions over a **scalar** (`sum`, `max`) whose combine is built in. The streaming form needs a
reduction whose state is not a number and whose combine is written by the user. That is the whole of what Tix
lacks; everything else in this document is a rewrite over the existing language.

### 3.1 What is missing, item by item

| Needed | Why the core cannot express it | Provided by |
| --- | --- | --- |
| a **non-scalar state**: a running maximum, a running normalizer, and a running `f32[D]` numerator | `sum`/`max` produce one number; two separate reductions cannot carry each other's maxima | the state type of `fold` |
| a **user-supplied combine** | `sum`'s combine is `+` and `max`'s is `max`, fixed; the rebasing combine is neither | `monoid ... combine` |
| a **region body** with local temporaries | `sum`'s body is one expression. The state needs `u` computed once and read three times (max, normalizer, numerator); an expression-valued body would recompute it (twice more per index) and, worse, could not be recognised as the *same* `u` by the rebasing rule | `fold (...) M { ... yield ... }` — a statement list ending in `yield` |
| a **projection from state to answer** | the answer is `t/l`, a function of two state components, and the division must happen after the whole extent | the bound names of the `fold` statement |

### 3.2 Syntax (proposed; `x-tix`)

Two additions to the fixed core, one at top level and one as a statement, plus one expression form:

```text
decl    := 'monoid' NAME '(' dims ')' '{' state unit combine '}'          // top level, beside fn
state   := 'state' NAME '=' '(' NAME ':' type (',' NAME ':' type)* ')' ';'
unit    := 'unit' '(' expr (',' expr)* ')' ';'
combine := 'combine' NAME ',' NAME '=' expr ';'
stmt    := ... (as in the core)
         | binds '=' 'fold' '(' NAME (',' NAME)* ')' NAME '{' stmt* 'yield' expr ';' '}'
binds   := bind (',' bind)*                                                // one bind per state component
bind    := NAME '[' NAME (',' NAME)* ']'
expr    := ... | 'let' NAME '=' expr 'in' expr      // only inside a combine body
```

The fold's body is a brace-delimited statement list ending in `yield`; nothing else in the core has a nested
statement list, which is why the braces rather than a keyword do the work. The `let` is needed in exactly one
place: a combine has no statement list to bind a name in, and the rebasing combine reads the merged maximum three
times. It binds once, with the same rounding as any other operation.

A `monoid` declaration names a state type, an identity and a combine. The state type is parameterised by the shape
names in its declaration (here `X`, which the statement instantiates with the extent of the free index `x`).

The fold statement binds one or more tensors (the state components, each with its own index names) to the summary
of the fold over the listed reduction indices.

### 3.3 The declaration the derivation uses

```text
// the summary of a set of scores, relative to that set's maximum
monoid softmax_state(X) {
  state    S = (m: f32, l: f32, t: f32[X]);
  unit     (-inf, 0, zeros[X]);
  combine a, b = let c = max(a.m, b.m) in
                 ( c,
                   a.l * exp(a.m - c) + b.l * exp(b.m - c),
                   a.t * exp(a.m - c) + b.t * exp(b.m - c) );
}
```

`zeros[X]` and the `t` component being a tensor are what make the state non-scalar; `exp(a.m - c)` is what makes
it a *rebase* rather than a plain product monoid.

### 3.4 Semantics

**Index semantics.** The fold's reduction indices range over their inferred extents exactly as `sum`/`max`'s do
(plain uses on the right of the bind, or the statement's declared type for purely affine uses). The region is
evaluated once per index tuple, in increasing lexicographic order of the reduction indices, first listed
outermost.

**Value semantics.** The bound tensors are components of

```text
fold(⊕, unit, λ j. region(j))  =  ((unit ⊕ g(j₁)) ⊕ g(j₂)) ⊕ … ⊕ g(j_K)
```

where `g(j)` is the region's yielded state value for `j`. The state components' free index names (here `i`, `x`)
are bound outside the fold, so the fold is per free-index tuple.

**Scope rule (checked at compile time).** A region may read: its reduction indices, the free index names of the
bind, the function's parameters, and shape names — and the tensors its own statements define. It may **not** read
a tensor defined *outside* the region. This is what makes a fold's generator pointwise — and it is what makes the
rebasing rule's side conditions decidable.

**f32 meaning.** Every literal, shape value, operation and function result is `Math.fround`ed; the region's
statements are evaluated in order with a rounding after each; the accumulate is the left fold above, with a
rounding after each combine and after each operation *inside* the combine, in the order written; `exp(-inf - m)`
is `0`, and `-inf - m` is `-inf` for finite `m` under IEEE arithmetic, so no NaN arises at the first block.

**Supported domain.** The fold is specified only for a declared monoid whose combine is associative with `unit` as
a two-sided identity — a property of the declaration, verified once (§4.5), not re-checked per statement. Beyond
that: every reduction extent is inferred consistently with the rest of the program, and shape values in a state
type resolve. Outside this domain the fold statement is a compile-time check error; no behaviour is specified.

### 3.5 Design decisions

**D1 — A fold with a declared monoid, not "a reduction with an inline combine".**
*Alternative*: `fold (⊕)`, the combine written at the statement. *Chosen instead*: the monoid is a top-level
declaration, because associativity, the identity law and the two-set identity are properties of the combine
**alone** and should be verified once, for all statements that use it, rather than once per statement. This is
the same reasoning that made IRWB-006's rules data with evidence keyed by rule version.

**D2 — f32 meaning is the left fold in lexicographic order.**
*Alternatives*: (a) leave the association order unspecified (any order, so implementation-defined) — rejected,
because then the meaning contract has no single meaning to compare against; (b) a balanced tree fold — rejected,
because it would be a different rounding sequence from `sum`'s left-to-right, so `fold` and `sum`/`max` would
disagree about "the same" reduction, and `Rebase`'s special case (§4.4) would not hold; (c) the plain left fold —
chosen, because it matches the order `sum` and `max` already specify and makes the blocked form a *visible*
rewrite (`Split`) rather than a hidden one.

**D3 — the live running triple is a lowering, not source syntax.**
The streaming kernel's `m := max(m, mK)` in a loop is not Tix. In Tix the blocked form is a **nested fold**: an
inner fold produces each block's summary and the outer fold combines them. The kernel is the lowering of that
nested fold, and §5.4 shows that the lowering introduces no rounding of its own, so the kernel's f32 behaviour is
exactly the meaning of the nested fold. *Alternative*: add loops and mutation to Tix — rejected, because
single-assignment is what makes each rule a local substitution with no aliasing or ordering side conditions.

**D4 — `B | N` as a side condition of `Split`.**
*Alternative*: a masked or short tail block, `min(B, N - jb*B)`. Rejected *for this design* because the core's
extents are affine expressions of shape names and integers, and a `min` of those is not affine; the condition is
cheap to satisfy by construction (pad N) and keeps every index expression affine. Tail handling is a Later item.

---

## 4. The rule set

Four rules. Each is stated as premise → conclusion over *index sets*, because that is what makes the arguments
local: every rule is about how one aggregation, or two aggregations sharing an index set, may be rewritten, with
no reference to attention.

Throughout, `J` is the reduction index set, `K` a subset (a block), `u` (scores), `a`, `b` (pointwise factors) are
values at each `j ∈ J`, and `exp` denotes the real exponential with `exp(x+y) = exp(x)exp(y)`, `exp(0) = 1`,
`exp` strictly increasing, `exp(-∞) = 0`.

### 4.1 R1 — `Split`: a reduction over a partitioned extent is a reduction of reductions

**Premise.** `⊕_{j<N} F(j)` where `⊕` is a declared monoid's combine (that is: `sum`, `max`, or `fold(M)`), `B` a
positive integer, `B | N`.

**Conclusion.** `⊕_{jb<N/B} ( ⊕_{jt<B} F(jb*B + jt) )`.

**Side conditions.** (i) `B | N` [D4]; (ii) the concatenation of the blocks in increasing `jb` is the index set in
its declared order (lexicographic, first listed outermost) — this is what `j := jb*B + jt` means for affine index
arithmetic; (iii) `⊕` is associative with `unit` as two-sided identity.

**Argument over the reals.** `j ↦ jb*B + jt` is a bijection from `{0..N/B-1} × {0..B-1}` onto `{0..N-1}`,
order-preserving when read `jb` outer, `jt` inner. The left fold of an associative operation over a concatenation
equals the left fold of the left folds of the parts, supplied with the identity at each part's start:
`((e⊕f₁)⊕f₂)⊕((e⊕f₃)⊕f₄) = ((((e⊕f₁)⊕f₂)⊕f₃)⊕f₄)` because `e⊕f₃ = f₃` (the identity law) and `⊕` is
associative, which regroups the four `⊕`s into the flat left fold. ∎

**f32 verdict — depends on `⊕` and is measured.**

- For `max`: **exact**. `max` performs no arithmetic, so any grouping gives the same f32 value (measured: 0 of 4
  block widths change the result of a 1024-element max).
- For `sum`, and for any `fold` whose combine rounds: **not bit-exact**. A regrouping changes which partial sums
  are rounded. Measured on 1024 f32 terms: 4 of 4 block widths change the bits. Measured on the attention
  program: `Split` at B=64 on top of `Factor` moves outputs from 3.80e-2 to 4.48e-2 (raw relative, N=1024, D=64).
- The rule preserves the **order** of the operands and only groups them. That is why the drift stays a random
  walk (`√K·ε`) rather than a permutation's unbounded regrouping, and it is the reason the tolerance of §6.1 can
  be `ε√K`-shaped.

**Checked by.** Proof obligation (the argument above, with (i)–(iii) discharged from the statement's own extents
and the monoid's declared evidence), plus an **exhaustive-over-tiny-extents** f32 differential (all `N ≤ 6`, all
divisors `B`, over values including zeros of both signs, subnormals, ±max-finite and ties), plus a sampled
differential at working sizes. Strength: `proof` for the real claim; `exhaustive` for the index arithmetic;
`sampled` for the f32 claim (measured value space, not proved).

### 4.2 R2 — `Factor`: a reduction-index-free factor moves in and out of a sum

**Premise.** `sum(j) c * F(j)` or `sum(j) F(j) / c`, where `c` does not mention `j`.

**Conclusion.** `c * (sum(j) F(j))` or `(sum(j) F(j)) / c` respectively (and the converse directions).

**Side conditions.** (i) `j ∉ fv(c)` — decidable on the bound/stated index names; (ii) for the dividing
direction, `c ≠ 0` (part of the program's domain: `l[i] ≥ 1` for attention, §4.4).

**Argument over the reals.** Distributivity of `*` over a finite sum:
`Σ_j c·F(j) = c·Σ_j F(j)` by induction on `|J|` from `c(x+y) = cx + cy`; the division direction is the same with
`c = 1/d`. ∎

**f32 verdict — not bit-exact, and the largest single contributor of the derivation.** `a·(b+c) ≠ a·b + a·c` in f32,
and `Σ (x/d)` vs `(Σ x)/d` likewise. Measured: the `o` statement's `sum(j) e*v/l` → `(sum(j) e*v)/l` moves outputs
by up to 3.80e-2 raw relative, and by 3.08e-7 = **5.2·ε** against the contraction's term scale, at N=1024, D=64
(one division per row instead of one per term). That single rule accounts for the largest share of the whole
chain's drift — 5.2·ε of the chain's 4.8·ε, the two partly cancelling.

**Checked by.** Proof obligation (one line); f32: sampled differential at several shapes and value
distributions. Strength: `proof` (real) + `sampled` (f32). There is no exhaustive f32 method for this rule: its
counterexample space is all finite value assignments.

### 4.3 R3 — `Fuse`: a pointwise tensor joins the region of its consumers

**Premise.** A statement `a[I] = BODY` all of whose uses are pointwise reads inside bodies of statements, and
whose value is not otherwise observed.

**Conclusion.** `BODY` is substituted for each use; when two or more uses are inside the same reduction (or fold)
region, the substituted value is bound **once** to a local temporary at the head of that region and the uses read
the temporary. `a` disappears when it has no other use.

**Side conditions.** (i) all Tix expressions are pure, so substitution cannot reorder effects; (ii) single
assignment, so `a`'s definition dominates every use; (iii) the binding temp is placed at the head of the region
and the region's statement order is otherwise unchanged — that is what makes the result's evaluation order equal
to the original's.

**Argument over the reals.** Substitution of equals: if `a[I] = BODY` and no use of `a` is separated from that
definition by a redefinition (vacuous under single assignment), replacing `a[I]` by `BODY[I/i]` preserves every
value. ∎ (This rule proves nothing interesting, which is exactly why it must be *checked* rather than argued: its
content is entirely about whether the operator sequence survived intact.)

**f32 verdict — bit-exact, provided the region binds once.** The substituted expression is the same operator tree
evaluated in the same order with the same roundings; duplicating it (when there are several uses in *different*
reductions) does not change any value, only the work. Measured: after `Factor`, fusing `s` and `e` away (three
recomputations of the score, transients) leaves every output bit unchanged at N=1024, D=64 — **identical**, not
merely close.

**Checked by.** A **structural** check — the fused region's operator tree is compared to the eliminated
definition's, node for node, in evaluation order — plus a sampled f32 differential as a second, independent
method. Strength: `proof` (for the f32 claim, by the order argument) and `structural` as the method that
establishes it. This is the only rule in the set whose f32 claim is a proof, and it is the rule that removes the
N×N tensors.

*Note on work duplication.* Fusing a multi-use definition into several consumers recomputes it. That is a
*quality* concern, not a correctness one: every intermediate program of the derivation must be correct, not fast,
and here the duplication is removed by `Rebase` one step later (the region binds `u` once, and the running
state supplies all three consumers). A derivation engine that refused the duplication would not reach the target.

### 4.4 R4 — `Rebase`: a nested aggregation over `max` becomes a fold over the summary monoid

This is the rule that carries the mathematics, and the only one whose premise mentions `max`.

**Premise** (one statement family, over one index set `J`, syntactically):

```text
m[i]      = max(j) U(i, j);
l[i]      = sum(j) exp(U(i, j) - m[i]);
t[i, x]   = sum(j) exp(U(i, j) - m[i]) * W(i, j, x);
o[i, x]   = t[i, x] / l[i];                                    // j-free divisor
```

where `U` and `W` are expressions over the statement's indices, parameters and shape values only, and the three
reductions list the same index `j`.

**Conclusion.**

```text
(m[i], l[i], t[i, x]) = fold(j) softmax_state(X) {
    u = U(i, j);
    yield (u, 1, W(i, j, x));
};
o[i, x] = t[i, x] / l[i];
```

**Side conditions.** (i) the three reductions share the *same* index list and hence the same index set `J`
(decidable on the statements' inferred extents); (ii) the argument of every `exp` is syntactically `U - m[i]` with
the *same* `U` as the `max`'s body — this is why `Fuse`'s region, which binds `u` once, makes the rule applicable
where three separate inline copies would not be recognisable; (iii) the divisor of `o` is `l[i]`, j-free, so
`Factor`'s law licenses the projection `t/l`; (iv) the monoid used is `softmax_state` (`X` instantiated with the
extent of `x`).

**Argument over the reals — the two-set lemma.** For `K ⊆ J`, write

```text
M_K      = max_{j∈K} u_j
L_K      = Σ_{j∈K} exp(u_j - M_K)
T_K[x]   = Σ_{j∈K} exp(u_j - M_K) * w_{j,x}
```

For disjoint `K₁, K₂` and `M = max(M_{K₁}, M_{K₂})`:

```text
M_{K₁∪K₂} = max(M_{K₁}, M_{K₂})                                            (max of a union)
L_{K₁∪K₂} = L_{K₁}·exp(M_{K₁}-M) + L_{K₂}·exp(M_{K₂}-M)                    (see below)
T_{K₁∪K₂} = T_{K₁}·exp(M_{K₁}-M) + T_{K₂}·exp(M_{K₂}-M)
```

For `j ∈ K₁`, `exp(u_j - M) = exp(u_j - M_{K₁}) · exp(M_{K₁} - M)` by `exp(x+y)=exp(x)exp(y)`; the factor
`exp(M_{K₁}-M)` does not depend on `j`, so it comes out of the sum by `Factor`'s law; the `K₂` sum is identical
with `M_{K₂}`. Adding the two gives the second line, and the third by the same step applied to each `w_{j,x}`.

Three consequences, and each is the piece the design needs:

1. **The combine is exactly `softmax_state.combine`.** The three lines above are the declared combine with
   `a = summary(K₁)`, `b = summary(K₂)`.
2. **The combine is associative**, because `summary` is a function *of the index set*: `(K₁∪K₂)∪K₃ = K₁∪(K₂∪K₃)`,
   so combining in either grouping yields `summary` of the same set. The argument is a property of the monoid
   (checked once, §4.5) and not of any program.
3. **The fold's result is the program's answer.** With `K = J`, the statements' `m`, `l`, `t` are exactly
   `M_J`, `L_J`, `T_J`; `o = T_J/L_J` equals the premise's `Σ_j exp(u_j-M_J)w_j / L_J` by `Factor`'s law. ∎

Two numerical facts fall out of the lemma and are worth recording because they are what the `max` is *for*: since
the term at the maximizing `j` contributes `exp(0) = 1`, `L_K ≥ 1` for every nonempty `K` (so the divisor is never
0 and `exp` never overflows — its argument is `≤ 0`); and the state is bounded in the same way the plain form is,
so `Rebase` introduces no overflow the premise did not already have.

**f32 verdict — not bit-exact in general; bit-neutral for a single block.** Two measured facts:

- With one block (`B = N`) the single rescale factor is `exp(-∞ - M_J) = 0` and it multiplies a zero state, so
  nothing is dropped; the exponentials are `exp(u - M_J)` exactly as in the premise, and the accumulation order is
  the same: the outputs are **bit-identical** to the premise's. Measured: `identical`.
- With several blocks, the exponentials are taken against *running* maxima instead of the final one, and each
  block's contribution is rescaled: the bits change. Measured: at B=64 on top of `Factor` the drift of the whole
  chain is 4.48e-2 raw relative (vs 3.80e-2 for `Factor` alone) at N=1024, D=64, and 2.85e-7 = 4.8·ε against the
  contraction's term scale — *less* than `Factor`'s own 5.2·ε, because the two drifts partly cancel.
- The rescale is the identity (`exp(0) = 1` exactly) whenever the running maximum does not grow, which is most
  blocks: measured 15.3% of blocks rescale at N=1024, D=64, B=64 (5.7% at B=16), and after the global maximum has
  been seen (45.7% of blocks at B=64) the accumulation carries the plain form's bits.

**Checked by.** Proof obligation for the real claim (the lemma, with (i)–(iv) discharged) + the monoid's evidence
(§4.5) + a sampled differential: candidate = the premise program with `m`,`l`,`t`,`o` observed, baseline = the
fold program, at tiny extents exhaustively and at working sizes sampled, with the tolerance relation of §6.1.
Strength: `proof` (real) + `sampled` (f32).

### 4.5 Monoid evidence (once per declaration, not per application)

`Rebase` and `Split` apply a combine whose laws must hold. Those laws are checked on the *declaration*:

| law | how | strength |
| --- | --- | --- |
| `unit ⊕ s = s = s ⊕ unit` | argument over the reals (`exp(-∞-m)=0`, `max(-∞,m)=m`), plus a sampled f32 check on random states | `proof` + `sampled` |
| associativity | argument: `summary` is a function of the index set (pure set algebra), plus a sampled f32 check on triples of random states | `proof` + `sampled` |
| the two-set identity (for `Rebase`) | the lemma of §4.4, instantiated per monoid | `proof` |

The sampled f32 checks cannot prove the law — floating-point `⊕` is not associative — they catch a combine that was
*implemented* differently from the one that was argued about. This is the same division of labour as IRWB-006's
`exhaustive-w8` + `argumentFor`.

---

## 5. The derivation, as a sequence of rule applications

### 5.1 Notation

Each step names the rule, the statements it touches, and the side conditions it discharges. `P0` is the program in
§1.1.

### 5.2 The programs

**P0 — as written.** (§1.1.)

**P1 — after `Factor`.** The divisor `l[i]` leaves the summand of `o`; a new statement `t` binds the numerator.

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  l[i] = sum(j) e[i, j];
  t[i, x] = sum(j) e[i, j] * v[j, x];
  o[i, x] = t[i, x] / l[i];
  return o;
}
```

**P2 — after `Fuse`, twice.** `s` and `e` disappear into their consumers. Correct, and deliberately wasteful: the
score is recomputed three times and `exp` twice.

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  m[i] = max(j) (sum(d) q[i, d] * k[j, d] / sqrt(D));
  l[i] = sum(j) exp((sum(d) q[i, d] * k[j, d] / sqrt(D)) - m[i]);
  t[i, x] = sum(j) exp((sum(d) q[i, d] * k[j, d] / sqrt(D)) - m[i]) * v[j, x];
  o[i, x] = t[i, x] / l[i];
  return o;
}
```

**P3 — after `Rebase`.** The three aggregations become one fold whose region binds `u` once. This is the step that
both removes the nesting and removes `Fuse`'s duplication. `s` and `e` are gone; no statement has an N×N shape.

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  (m[i], l[i], t[i, x]) = fold(j) softmax_state(D) {
    u = sum(d) q[i, d] * k[j, d] / sqrt(D);
    yield (u, 1, v[j, x]);
  };
  o[i, x] = t[i, x] / l[i];
  return o;
}
```

**P4 — after `Split`.** The block structure appears as an inner fold over `jt` and an outer fold over `jb`.
Still source-level Tix; still no loops; the block factor `B` is a schedule parameter of this rule application.

```tix
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  (m[i], l[i], t[i, x]) = fold(jb) softmax_state(D) {
    (ma[i], la[i], ta[i, x]) = fold(jt) softmax_state(D) {
      u = sum(d) q[i, d] * k[jb * B + jt, d] / sqrt(D);
      yield (u, 1, v[jb * B + jt, x]);
    };
    yield (ma[i], la[i], ta[i, x]);
  };
  o[i, x] = t[i, x] / l[i];
  return o;
}
```

**P5 — the lowering of P4 (not a rewrite).** Per row, one running triple over blocks:

```text
m := -inf; l := 0; t := zeros[D]
for jb in 0..N/B-1:
    (ma, la, ta) := inner fold of block jb over jt          # exact meaning of the inner fold
    (m, l, t)     := (m, l, t) ⊕ (ma, la, ta)               # exact meaning of the outer fold
o[i,:] := t / l
```

P5 is the plain left fold over the block summaries, which is what the outer fold *means*. §5.4 makes this the
statement that the lowering adds no rounding of its own.

### 5.3 The application table

| # | rule | on | side conditions discharged | f32 verdict |
| --- | --- | --- | --- | --- |
| 1 | `Factor` | `o[i,x] = sum(j) e*v/l` → `t[i,x] = sum(j) e*v`; `o[i,x] = t/l` | `j ∉ fv(l[i])`; `l[i] ≠ 0` (domain, §4.4) | not bit-exact; measured 3.80e-2 raw / 3.08e-7 (5.2·ε) scaled |
| 2 | `Fuse` | `s` into `m` and into `e` | all uses pointwise, single assignment, region binds once | **bit-exact** (measured identical) |
| 3 | `Fuse` | `e` into `l` and into `t` | as above | **bit-exact** (measured identical) |
| 4 | `Rebase` | `m`, `l`, `t`, `o` — the three nested aggregations over `j` | same index list; same syntactic `U`; divisor j-free; monoid `softmax_state` | not bit-exact with several blocks; **bit-identical with one block** |
| 5 | `Split` | the fold over `j`, `B \| N` | associativity + identity of `softmax_state`; order-preserving re-index | not bit-exact (regrouping); measured 4.48e-2 raw / 2.85e-7 (4.8·ε) scaled |

Five applications, four rules, one new construct. Nothing else changes: the function signature, the `d`-contraction
inside the region, the final division and the return are untouched from P0 to P4.

### 5.4 Why the lowering is not a hidden sixth step

The obvious worry is that P4 is "source Tix" and P5 is "a kernel", so the derivation's conclusion is not really the
thing that runs. It is, and the argument is short:

The outer fold's meaning is the left fold over its generator values. Its generator values are the block summaries,
each of which is the inner fold's meaning. A lowering that (a) computes each inner fold in its declared order and
(b) applies the combine to the running state in increasing `jb` computes exactly that left fold. So P5's f32
values **are** P4's meaning, with no additional rounding rule to check. The one thing the lowering may not do is
reassociate (a tree reduction over blocks, or a warp-level reduction with a different grouping) — that would be a
further application of `Split`, and it would need the tolerance check of its own.

This makes the pipeline's obligations crisp: *source* rules are checked by the meaning contract; the *lowering*
has one requirement, "compute the left fold in the declared order", and the way to test it is a differential
between the CPU interpretation of P4 and the CUDA execution of P5 at a shape where everything else is exact
(§9.3, arm (e)).

---

## 6. Checking

### 6.1 The Tix meaning contract (requirement on the parallel build)

Every rule application is published through `applyPass`, so it must `ensure` an invariant over `{origin,
candidate}`. For Tix that invariant is a `differential(...)` (§2.2) with the following domain, observation and
relation. The tolerance relation itself is being built in parallel; this is the specification it has to satisfy
for this derivation to be checkable, with the measurements that fix its parameters.

**Domain.**

- *Shapes*: `N, D` with `B | N`; the case generator draws from a fixed list — tiny (`N ≤ 4`, for exact reasoning),
  boundary (`N` prime near a multiple of `B`, `D ∈ {1, 2, 3}`), working (`N ∈ {64, 256, 1024}`, `D ∈ {8, 16, 64}`)
  — and records which ones it used in the evidence.
- *Input values*: four distributions, each of which exercises something the rules are sensitive to:
  (i) uniform in `[-1, 1]`; (ii) scaled up so scores span ~60 in log (`exp` underflows for the smallest scores,
  which the plain and derived forms must treat the same way); (iii) degenerate: all zeros, one-hot `v`, two
  identical rows of `q` (ties in the `max`); (iv) bounded-exponent values that keep the output contraction
  well conditioned (`|Σ e v| ≈ Σ|e v|`).
- *Excluded*: inputs that overflow the f32 range anywhere in either program. That is a property of the case
  generator, not a runtime guard.

**Observation.** The returned tensor `o`, **plus** the intermediate tensors `m` and `l` when the programs declare
them observable. This matters more than it looks: `o` alone can be catastrophic for *relative* comparison, while
`m` and `l` are well conditioned (`l ∈ [1, N]`, `m` is a max of the scores), so observing them separates "a rule
moved the answer" from "the answer is a difference of large terms".

**Relation.** Per element, a mixed absolute/relative comparison with the scale taken from the **reference run**:

```text
close(a, b)  ⟺  |a - b| ≤ rel·max(|a|, |b|) + abs·σ        with  abs = ε·√K,  ε = 2⁻²⁴
σ  = Σ_j |e_ij·v_jx| / l_i        for an element of `o`      (the contraction's term scale, from the f64 reference)
σ  = max(|a|, |b|)                for an element of `m` or `l`
K  = the largest sum extent in the program
```

Measured justification (§6.3): the whole derivation's drift against that scale is **2.85e-7 = 4.8·ε** at
N=1024, D=64, and ε·√K = 1.9e-6 = 32·ε, i.e. the bound has ~6.7× margin at that size (and 5× at K=256, where the
measured drift is 3.2·ε against a bound of 16·ε). With a *pure relative* relation
(`abs = 0`) the same comparison needs `rel` between 3e-2 and 8e-2 depending on the data draw, because the raw
relative error is set by the output's conditioning (measured up to 4.2e6), not by the rules — and the plain
program's own distance to the f64 reference is of the same order (8e-3 … 3e-2), so such a relation would be
measuring the data rather than the derivation.

**Verdict.** The standard one from `differential`: agree / disagree with the first counterexamples / inconclusive
if either side hits the evaluation step limit, and a run with no decided case fails.

**What the relation is not.** It is not a proof, it cannot distinguish a rule error from conditioning, and it is
asymmetric (`baseline = origin` supplies `σ`). The burden of correctness is therefore on the per-rule evidence
below; the meaning check is the safety net that catches an implementation that disagrees with its rule.

### 6.2 Per rule: what is checked, and at what strength

| rule | exact argument over ℝ | f32 check | strength |
| --- | --- | --- | --- |
| `Split` | associativity + identity + order-preserving re-index (§4.1) | exhaustive tiny extents (`N ≤ 6`, every divisor `B`) + sampled working sizes, tolerance relation; `max` exact | `proof` (ℝ), `exhaustive` (index arithmetic), `sampled` (f32) |
| `Factor` | distributivity (§4.2) | sampled over the four value distributions and all working shapes | `proof` (ℝ), `sampled` (f32) |
| `Fuse` | substitution (§4.3) | **structural**: operator trees compared node for node in evaluation order, plus a sampled differential | `proof` (ℝ and f32) |
| `Rebase` | two-set lemma (§4.4) + monoid evidence (§4.5) | sampled differential with `m`,`l`,`t` observed; exact single-block case as a regression | `proof` (ℝ), `sampled` (f32) |

Two operational rules for the evidence records, which are what make the claim "local and mechanical" testable
rather than rhetorical:

1. **A rule's evidence may name**: the rule's own side conditions, its argument, its monoid's evidence, and the
   results of its methods. **It may not name**: the program it fired on, the pass that hosted it, other rules'
   applications, or the derivation. An evidence record that needs a program fact falsifies the thesis (§9.1, H3).
2. **A rule's f32 method is decided by the rule's own kind**, not by the program: an operator-order-preserving
   rule is structural; an arithmetic-regrouping rule is sampled. A rule that needs a *program-shaped* method
   (for example "check this rule only on attention") is not a rule but a template, and it is the alternative
   design of §8.1.

### 6.3 Where the f32 differences come from (measured)

All numbers from `scripts/01-f32-and-exact-algebra-probe.mjs` and `scripts/02-derivation-stages-probe.mjs`
(outputs in `various/01-*.txt`, `various/02-*.txt`; Node v24.18.0, `Math.fround` for every operation, `Math.exp`
for `exp`, sums accumulated in increasing index order with a rounding after each step — the Tix meaning as
specified).

**The algebra is exact.** With exact `BigInt` rationals, `exp` replaced by the multiplicative surrogate `3^x` on
integer exponents, and integer inputs, every intermediate program P1…P5 equals P0 **exactly**, for every block
width tried (B ∈ {1, 2, 3, N}, N ∈ {4, 6, 8}, D ∈ {4, 9}). So the rules' real-algebra claims survive contact with
a real evaluator, not just with the argument.

**The f32 chain, stage by stage** (N=1024, D=64, random `q,k,v` in `[-1,1]`):

| stage | raw relative difference vs P0 | bit-identical? |
| --- | --- | --- |
| P1 (`Factor`: divide out of the sum) | 3.80e-2 | no |
| P2 (`Fuse` twice) | 3.80e-2 | **yes, vs P1** |
| P3 (`Rebase`, one block) | 3.80e-2 | **yes, vs P1** |
| P4 (`Split`, B=64) | 4.48e-2 | no |

So: `Fuse` costs nothing, `Rebase` costs nothing until the fold is blocked, and the whole drift is dominated by
one division moving from inside a sum to outside it. The same stages against the contraction's term scale, and
against a double-precision run of P0 on the same data:

| stage | vs P0, scaled | vs f64, scaled |
| --- | --- | --- |
| P1 (`Factor`) | 3.08e-7 (5.2·ε) | 3.00e-7 (5.0·ε) |
| P2 (`Fuse`) | 3.08e-7 (5.2·ε) | 3.00e-7 (5.0·ε) |
| P3 (`Rebase`, one block) | 3.08e-7 (5.2·ε) | 3.00e-7 (5.0·ε) |
| P4 (`Split`, B=64) | 2.85e-7 (4.8·ε) | 3.00e-7 (5.0·ε) |
| P0 (plain), reference | — | 2.49e-7 (4.2·ε) |

Two bitter pills follow, and both are in the design on purpose:

- **The raw relative number is meaningless.** At these shapes the output contraction cancels: with random `v`,
  `Σ_j e_ij v_jx` is a sum of ~1024 terms with random signs, so `cond = Σ|terms|/|Σ terms|` reaches 4.2e6. It is
  also unstable across data draws: an independent draw of the same size gives 1.3e-2 for the same one-rule stage
  instead of 3.80e-2. Against
  the term scale, the plain program is 4.2·ε from the f64 reference and the fully derived one is 5.0·ε: **the
  derivation costs about one rounding of accuracy and buys the memory.** It does not make the answer better — a
  claim the design states explicitly, because the measurement refutes the folklore that online softmax is more
  accurate (it is more *robust* — bounded state, no overflow — not more precise).
- **A relative-only tolerance is not a gate.** Since the plain program is itself 2.9e-2 away from f64 in the raw
  metric, a relation loose enough to accept any correct rewrite also accepts a great deal else. Hence §6.1's
  σ-scaled relation and §6.2's per-rule burden.

**Where the residual drift sits, precisely.** `ε·√K` is the random-walk bound for a length-`K` f32 sum. Measured
scaled drift at `K = 1024` is 4.8·ε against a bound of 32·ε (6.7× margin); at `K = 256` it is 3.2·ε against 16·ε
(5×). A regrouping rule cannot beat `ε√K`, and none of them does.

**One measurement that will not be available until the GPU exists.** The Tix f32 meaning is
`fround(Math.exp(x))` — a *double-rounded* value, which `src/typed/f32.ts` can justify for `+ - * / sqrt`
("53 ≥ 2·24 + 2") but **not** for `exp`. A CUDA kernel uses `expf`, and `nvcc` contracts `a*b + c` into an FMA by
default. Both are f32-semantics differences between the meaning and the kernel that no rewrite rule is responsible
for. The design's position: the CUDA backend must compile with `--fmad=false` (one flag, and `src/typed/f32.ts`
already states that the compiler "never fuses a product and a sum"), and the `exp` difference is *measured* by the
hand-written arm of the experiment (§9.3), which is the noise floor every other arm has to beat.

### 6.4 What these checks do not do

- They do not prove the f32 claims of `Split`, `Factor`, `Rebase`. No finite sampling can. The `ε√K` bound is an
  argument plus a measurement, not a theorem, and it is labelled `sampled` wherever it is used.
- They do not check the *backend's* meaning-preservation for folds (§5.4); that is one differential test and a
  stated requirement, not a proof.
- They do not validate the monoid's laws for a monoid other than `softmax_state`; §7 lists the instances claimed
  and marks which are checked here (one) and which are not (the rest).

---

## 7. Generality

### 7.1 Programs the same rules reach

The rules are about aggregations over an index set; `Rebase` is the only one that mentions `max`, and even it is a
schema: **Rebase(M)** applies whenever a family of aggregations over a common index set has a *two-set identity*
for a declared monoid `M`.

| program | rules needed | monoid instance | status |
| --- | --- | --- | --- |
| this attention | `Factor`, `Fuse`×2, `Rebase`, `Split` | `softmax_state` | checked here exactly (§6.3) and by the probes |
| softmax alone (`y = e/l`) | `Fuse`, `Rebase` (with no `t` component) | `softmax_state` restricted to `(m,l)` | follows; the sub-monoid is `softmax_state` with `t` dropped |
| log-sum-exp in one pass (`m + log(l)`) | `Rebase` (two components), then the existing `log` | `(m,l)` | follows |
| softmax followed by a contraction (`lse`, then `y = e/l @ W`) | `Factor`, `Fuse`, `Rebase`, `Split` | `softmax_state` with `W` in place of `v` | follows — this is attention with `k = I`; the same five applications |
| layernorm / variance statistics in one pass | `Factor`, `Fuse`, `Rebase`(mean) | `(n, Σx, Σx²)`, identity `Σ(x−x̄)² = Σx² − (Σx)²/n` | **claimed, not checked**; the two-set identity is the power-sum one, and it needs its own §4.4-style lemma |
| min-based variants (min-max normalisation) | `Rebase`(min) | `(min, Σ exp(x − min)·c)` | **claimed, not checked**; the rebasing factors are `exp(min₁ − min) ≥ 1`, so this instance also needs a bounded-range argument that the `max` instance gets for free |
| split-K / two-block attention (the same fold over a partition of a *materialised* summary array) | `Split` only, with the block summaries stored | `softmax_state` | follows: still `O(N·B)` storage instead of `O(N²)`, and it is what an `i`-tiled lowering needs |
| grouping several `j`-aggregations into one pass at all | `Rebase`'s premise is a *family* of aggregations; joining them is the product of monoids | — | this is why `Rebase` has no separate `Join` rule (§4.4): a joint rule would apply only to a form `Rebase` already produces |

The unifying criterion, stated so it can be tested: **a program is reachable iff its nested aggregation over a
common index set can be rebased by a two-set identity for some declared monoid.** Everything else the rules do
(removing a divisor, fusing tensors, splitting an extent) is generic and needs no justification per program.

### 7.2 Programs the rules fail on, and why

Each failure is a *specific side condition* of a specific rule, which is the point: a derivation that fails should
say where, not leave a wrong program.

| program | where it stops | why |
| --- | --- | --- |
| `m[i] = median(j) s[i,j]`, then `exp(s - m)` | `Rebase` | there is no finite-dimensional sufficient statistic for a median: no two-set identity exists, so the rule's proof obligation cannot be discharged. The rule *declines*; nothing wrong is produced. |
| `o[i,x] = sum(j) exp(s[i,j] - max(t) s[i,t]) * v[j,x]` with `t` ranging over `j+1..N` | `Rebase` | the `max`'s index set is not the sum's index set (side condition (i)), and the two-set identity does not hold for a *dependent* range. |
| `a[i] = argmax(j) s[i,j]; o[i,x] = v[a[i], x]` | `Rebase`, and then the language | the `(max, firstIndex)` monoid exists and the state is fine, but the projection needs `v` indexed by a *data value*; core Tix requires indices to be affine in index names. A `gather` construct would be needed (§11). |
| prefix sums / cumulative max (`y[i,j] = sum(t) s[i,t]` over `t ≤ j`) | `Rebase` (produced a whole-extent summary, not prefixes) | a scan is not a fold: the output is one value per prefix, so the construct would need an output per index, not one state. |
| `y[i] = sum(j) x[j] * (sum(t) x[t])` (no `max`, so no rebase) | nothing stops it — and nothing improves it | `Rebase`'s premise does not match, so no rule fires; the program is loop-invariant-code-motion's problem, not this rule set's. |
| two-pass / recompute attention (the deterministic-backward variant) | `Split` gives the two loops, but the *second* pass needs the first pass's `m`,`l` as an input tensor | reachable in fact (`m`,`l` are `O(N)` and legal to materialise), but it is a *different* derivation; it is not in this rule set. |
| attention with a mask applied to the scores (`s + mask[i,j]`) | nothing: it is reachable | `U` is any pointwise expression, so a mask is inside the premise — worth noting, because masked attention is where hand-written kernels usually go wrong. |

---

## 8. Alternatives considered

**8.1 Pattern-matched template kernels (the cheapest thing that works).** Recognise the *shape* of the program
(softmax over `j`, then a contraction over `j`) and emit a hand-written streaming kernel. *Falls short*: the
justification is one whole-program tolerance check with no local structure, so a failure localises to nothing; and
the recogniser is a program-shaped rule, which is exactly the property §6.2 forbids. *Kept as an experimental
arm* (§9.3, arm (d)) because it bounds what the derivation buys over the cheap approach.

**8.2 Associative-reduction fusion only (`Split` + `Factor` + `Fuse`).** This is what an ordinary tensor compiler
does: fuse elementwise chains into producers and consumers, fuse reductions that share an index set, block them.
*Falls short*: it reaches P2 (no N×N tensors!) and stops, because `l` and `t` cannot be accumulated until `m` is
known. P2 still runs three passes over all of `k` per row and recomputes the D-contraction three times. This is
the sharpest evidence that `Rebase` is the irreplaceable rule, and P2 is accordingly an experimental arm (§9.3,
arm (e)).

**8.3 Hand-write the streaming kernel and check it against the original.** One tolerance check, no rules.
*Falls short*: no locality, no reuse for the next program (log-sum-exp, layernorm), and the reasoning is a human
argument outside the framework. It is also already the status quo this research is trying to beat. It appears in
the experiment as the *hand-written* arm, which is what the derived kernel is measured against.

**8.4 Do it in a proof assistant.** Strongest possible guarantee; a real two-set lemma, real associativity.
*Falls short* of the question asked: the question is whether the *compiler* can do it with checks the framework
already has. It is the natural **Later** step for the four monoid laws, which are exactly the kind of finite,
monoid-level fact a proof assistant does well.

**8.5 E-graph / equality saturation over the rule set.** Interesting for finding *other* derivations, but it is a
search strategy for applying the same four rules, not a replacement: the streaming form's core term (the summary
monoid) has to be *introduced* by `Rebase` before any saturation can find it. *Kept as a Later item*, because the
hand-written chain of §5 is a sufficient witness for the research question.

**8.6 Chosen: four rules, one new construct.** It is the smallest rule set that reaches P5 (§8.2 shows that
`Split`, `Factor` and `Fuse` together do not), each rule's argument fits in a paragraph, and each rule's f32
verdict is decided by the rule's own kind rather than by the program.

---

## 9. The experiment

### 9.1 Hypotheses and what would refute them

**H1 — Correctness.** The derived kernel agrees with the f64 reference under §6.1's relation with `abs = ε·√K`,
`rel = 0`, on every shape and every input distribution of §6.1's domain, **and so does the unfused lowering** (same
relation, not a weaker one).
*Refuted by*: one element outside the bound; or the derived kernel passing only with a strictly looser tolerance
than the unfused lowering (that would say the rules, not the arithmetic, are the error source).

**H2 — Memory and time.** On the GB10, for `N ∈ {1024, 2048, 4096}`, `D ∈ {64, 128}`, batch 8, heads 8:
`dram_bytes(derived) ≤ 2 × dram_bytes(hand-written)` and `dram_bytes(derived) ≤ 5% × dram_bytes(unfused)`, and
`time(derived) ≤ 1.5 × time(hand-written)`.
*Refuted by*: the bytes ratio to the unfused lowering not falling below 5% (the N² traffic survived), or the
derived kernel more than 1.5× slower than the hand-written one (something other than the derivation dominates, and
the "compiler derives a competitive kernel" claim is dead).

**H3 — The derivation is what does it, and it is local.** The final revision contains no statement binding a tensor
whose shape has an N×N factor, and each of the five applications carries an evidence record that names only its
own rule's side conditions (§6.2).
*Refuted by*: any N×N tensor left in the final revision (then the rules did not cover the program and H2 would be
measuring the wrong thing); or any evidence record that had to cite the program, the pass or another application.

**H4 — Controlled falsifier of the side conditions.** With `B = N` (one block), the derived kernel is
**bit-identical** to P1 — `Rebase` and `Split` add nothing at one block, and the single rounding `Factor` moved is
not part of the claim — and with `B | N` violated the derivation is a compile-time check error rather than a
silently wrong kernel.
*Refuted by*: a single differing bit at `B = N` (a rule's side condition is under-specified, and §4.4's "bit-neutral
for one block" is false); or a program with `B ∤ N` being accepted.

### 9.2 Arms

| arm | what it is | what it isolates |
| --- | --- | --- |
| (a) **unfused** | P0 lowered directly, materialising `s` and `e` | the baseline the derivation improves on |
| (b) **derived** | P4/P5 after the five applications | the thesis |
| (c) **hand-written** | FlashAttention-2, same shapes, same `--fmad=false`, same tile sizes | the distance to the state of the art, and the platform's `exp`/rounding noise floor |
| (d) **template** | pattern-matched kernel (§8.1) | what the cheap approach buys; if (b) ≈ (d), the derivation's value is the *checking*, not the speed |
| (e) **nested** | P2/P3 without `Split` | isolates `Rebase` (no N×N storage, still `O(N²)` recomputation) from `Split` (the traffic) |
| (f) **one-block** | P5 with `B = N` | H4: the exactness control |

### 9.3 Metrics, and how they are obtained

- **DRAM bytes** per kernel: `ncu --metrics dram__bytes_read.sum,dram__bytes_write.sum,gpu__time_duration.sum
  --kernel-name-base demangled --csv ./bench`. One row per arm per shape, recorded verbatim.
- **Time**: median of 200 timed launches after 20 warm-ups, on one device, with the clock locked if the host
  allows it; recorded with the driver and `compute_cap` from
  `nvidia-smi --query-gpu=name,compute_cap,driver_version,memory.total --format=csv`.
- **Occupancy and spills** (`launch__registers_per_thread`, `launch__occupancy_limit_*`,
  `smsp__sass_spills_*`), because a derived kernel that spills has lost the game for reasons unrelated to the rules.
- **Checking cost**: wall time of the four rule verifications, of the monoid evidence, and of the per-application
  meaning checks (the derivation is only "mechanical" if a human can wait for it). Report minutes, per pass and
  total.
- **Rule accounting**: applications per rule per program, and the strengths of the evidence they required — the
  number the thesis is really about.

### 9.4 Workloads

Single-head attention as specified, at the shapes above; plus, in the same harness and with the same arms, a
**softmax-then-contraction** and a **log-sum-exp** program (§7.1) to check that the same four rules fire on a
program they were not designed against. That is the cheapest available test of §7.1's criterion.

### 9.5 What has already been measured here, and what has not

Measured in this worktree (CPU, Node v24.18.0): the exactness of the algebra, the per-stage f32 drift, the bit
identity of `Fuse` and of `Rebase` at one block, the effect of blocking on a plain f32 sum and max, the rescaled
fraction of blocks, and the conditioning that explains the drift. Probe scripts and outputs are listed in §12.
No CUDA toolchain is present in this worktree (`nvidia-smi`, `nvcc`, `ncu` all absent — verified), so every GPU
number in §9.1–9.4 is to be produced on the GB10 host, and the numbers above are *predictions* of what the
CPU-side meaning will say, not measurements of the kernel.

### 9.6 Threats to validity

- **Conditioning.** With random `v`, the output contraction cancels by up to `4e6`, so a raw relative comparison
  measures the data. Mitigation: §6.1's σ-scale, plus observing `m` and `l`.
- **Platform noise.** `expf` vs `exp` in f64, and FMA contraction, are larger than some rule drifts. Mitigation:
  `--fmad=false`, and arm (c) as the measured noise floor.
- **A tolerance that is too loose to be interesting.** Mitigation: H1's requirement that the derived arm passes the
  *same* relation as the unfused arm, and H3's structural check on the final revision.
- **A distribution of shapes narrow enough to hide a side condition.** Mitigation: `D ∈ {1, 2, 3}` boundary shapes
  and the degenerate distribution (ties in `max`, one-hot `v`, all-zero `q`) in §6.1.
- **The derivation could be right and the schedule bad.** H2's bytes ratio and arm (e) separate the two.

---

## 10. Risks and limits

1. **`Rebase` is a schema, and one instance is checked.** Two of the eight rows of §7.1 (layernorm's power-sum
   identity and the min-based monoid) rest on a two-set identity written down but not verified here. If one of them
   is wrong (the power-sum one is the risky one, because of the cancellation in `Σx² − (Σx)²/n`), the generality
   claim narrows by that instance, not the design.
2. **The tolerance relation is not in this worktree.** §6.1 is a requirement on a parallel build, and the numbers
   in it are measured *here* against a locally written reference, not against the real contract. If the parallel
   contract's relation cannot take a per-element σ, §6.1's fallback is the mixed form with `σ = max(|a|,|b|)` and a
   much larger `rel` labelled `sampled` — weaker, and the report should say so.
3. **`Fuse`'s bit-exactness depends on the region binding once.** A backend or a rule engine that recomputes the
   temp is still correct (duplication) but a *structural* check that expects one binding would reject it. The
   evidence record must therefore state which of the two it checked.
4. **H4 is the design's weakest link.** "Bit-identical at `B = N`" holds because the rescale factors are exactly 1
   or 0, which is a property of IEEE `exp(0) = 1`, not of the rules. Any backend whose `exp` is not exactly 1 at 0
   refutes it; no real `expf` fails that, but the report should record the assumption rather than the conclusion.
5. **Nothing here says the derived kernel is fast.** Tiles, shared memory, warp reductions, async copies are all
   lowering. H2 can be refuted by a bad schedule while the derivation is flawless, and the arms are chosen so that
   this is distinguishable from a refutation of the thesis.

---

## 11. Later (one line each, deliberately not designed here)

- The Tix front end, shape/extent inference, evaluator and the tolerance meaning contract — being built in
  parallel, not in this worktree.
- The CUDA backend, the tile schedule, `B`'s autotuning, shared-memory layout and async copies of `k`,`v` tiles.
- A tensor-rule form (pattern/guard/template over statements) and its verifier, the analogue of
  `src/typed/rules/form.ts` + `verify.ts` for statements rather than value trees.
- Tail handling for `B ∤ N` (a masked or short final block), which needs an extent form beyond affine expressions.
- The mean/variance, min-based and multi-component monoid instances of §7.1, each with its two-set lemma.
- A `gather` construct, without which `argmax`-then-index (`v[argmax]`) is outside the language (§7.2).
- Scans (prefix sums, cumulative max) as a construct distinct from the fold.
- The two-pass/recompute (deterministic backward) attention and split-K / grouped-query variants.
- Proof-assistant discharge of the monoid laws and the four rules' real-algebra obligations.
- An e-graph search over the four rules to find derivations other than the hand-written chain of §5.
- Compensated (Kahan / two-product) accumulation, which would let the derived form be *more* accurate than the
  plain one — the measurement in §6.3 says it currently is not.
- A rule-level cost model, so a derivation engine can prefer one rule order over another; §5 has one chain only.

---

## 12. Evidence

| file | what it is |
| --- | --- |
| `scripts/01-f32-and-exact-algebra-probe.mjs` | exact-rational check of the whole derivation; per-shape f32 drift of streaming vs plain and both vs f64; conditioning; the `Factor` rule's own effect; how often the rescale is the identity |
| `various/01-f32-and-exact-algebra-probe.txt` | its output (45 lines) |
| `scripts/02-derivation-stages-probe.mjs` | each intermediate program P1…P4 evaluated once over an abstract field, in exact rationals (all `EXACT` vs P0) and in f32 (per-stage drift and pairwise bit identity); `Split` in isolation on a plain sum and a max |
| `various/02-derivation-stages-probe.txt` | its output (34 lines) |

Both run with `node` v24.18.0 from the repository root; no dependencies beyond the standard library. The exact
arithmetic is `BigInt` rationals with `exp` replaced by `3^x` on integer exponents — the only property of `exp` any
rule uses is multiplicativity, which the design states explicitly in §4.

Framework files this design leans on, for the reader: `src/framework/passes/define-pass.ts` (the gate),
`src/framework/contracts/differential.ts` (the meaning-check shape), `src/typed/evaluate.ts` (today's exact
verdict), `src/typed/rules/verify.ts` and `src/typed/rules/form.ts` (rules as data with per-rule evidence),
`src/typed/f32.ts` (the f32 rounding statements the meaning rests on).
