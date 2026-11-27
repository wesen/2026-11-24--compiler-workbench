---
Title: 'Deriving FlashAttention from the plain Tix attention program: a checked-rewrite research design'
Ticket: IRWB-021-R
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/README.md
      Note: the transformation/property/evidence model (declared, checked, proof assurances) that the nine rules and the Associative property register into
    - Path: repo://src/framework/contracts/differential.ts
      Note: the sampled differential invariant (cases, seeds, relations, first counterexamples) that every rule application's ensures clause instantiates
    - Path: repo://src/framework/ir/PATTERNS-AND-REWRITES.md
      Note: the pattern API the rules' syntactic side conditions will be expressed against once a Tix adapter exists
ExternalSources:
    - https://arxiv.org/abs/2205.14135 (FlashAttention)
    - https://arxiv.org/abs/2307.08691 (FlashAttention-2)
    - https://arxiv.org/abs/1805.02867 (Milakov & Gimelshein, online normalizer calculation for softmax)
    - https://en.wikipedia.org/wiki/Algorithms_for_computing_variance (Chan, Golub & LeVeque parallel variance combine)
    - https://arxiv.org/abs/1612.05201 (Taco, tensor algebra compilation with workspaces)
    - https://arxiv.org/abs/1802.10523 (egg / equality saturation)
Summary: 'A research design for deriving the streaming (FlashAttention) form of single-head attention from the plain Tix program by a sequence of nine checked rewrites: the missing Tix construct (a reduction over a tuple state with a user-supplied associative combine, with sequential and blocked/two-pass f32 meanings), the rules with their side conditions and real-algebra arguments, the step-by-step derivation, the per-rule checking scheme in the framework contract (domain, observation, exact or tolerance relation against the f64 reference), a generality analysis (softmax, log-sum-exp, fused moments reached; causal masking, Welford variance, scans not reached), and a falsifiable GB10 experiment (derived kernel vs unfused lowering vs hand-written streaming kernel, measured time and DRAM bytes).'
LastUpdated: 2026-11-26T22:00:00-05:00
WhatFor: Settling whether the IR Workbench's checked-rewrite methodology, extended with one IR construct, can derive a hand-written-class streaming kernel from an index-notation source, with every step locally verified.
WhenToUse: Before implementing the Tix state-reduction construct, registering the streaming rewrite rules, or building the CUDA lowering and GB10 measurement rig; before extending the rule set to other softmax-family programs.
---

# Deriving FlashAttention from the plain Tix attention program: a checked-rewrite research design

## 0. Executive summary

The question is whether a compiler can *derive* FlashAttention — the streaming, O(N·D)-memory form of attention — from the plain index-notation program, as a sequence of rewrites each of which is checked and each of whose correctness arguments is local and mechanical. This design answers it constructively for the given Tix core, and states the experiment that would falsify the answer.

The answer has three parts:

1. **One missing construct.** Tix reductions collapse an index to a single number with a fixed, built-in operation. The streaming form needs a reduction whose state is a *tuple* (running maximum, running normalizer, running output) combined by a *user-supplied* operation. Section 4 defines this **state reduction**: grammar, typing, semantics over the reals, and its exact f32 meaning (a left fold in increasing index order, rounding after every operation — the same convention as Tix's `sum` and `max`).
2. **Nine rules, six steps.** Section 5 states each rewrite rule in Tix-level terms with its side conditions and its algebraic argument over the reals; the arguments rest on one lemma (the rescaling lemma, Lemma 1) and its payload extension (Lemma 2). Section 6 derives the streaming form from the given program in six checked steps; the final program never materializes the N×N score matrix and its blocked, two-pass meaning *is* the FlashAttention-2 algorithm.
3. **Per-rule checking in the framework contract.** Section 7 instantiates the framework's meaning contract for each rule: a domain (shape ranges and bounded generated inputs), an observation (the returned tensor), and a relation — bit-exact for the rules that provably preserve the f32 value sequence (INLINE, FUSESUMS), tolerance against the f64 reference of the original program for the rules that provably change it (all others). An explicit f32 error model sets the tolerance; the experiment measures the headroom.

One rule per line:

- **R1 FACTOR-OUT**: move a reduction-index-free divisor (or multiplier) out of a `sum` body — real argument: distributivity; f32 differs; tolerance.
- **R2 INLINE**: substitute a definition's expression for its references — identical operation sequence, bit-exact; exact relation.
- **R3 PAIR**: fuse `m[i] = max(j) S` with `l[i] = sum(j) exp(S − m[i])` into a streaming pair state (max, normalizer) with the rescaling combine — Lemma 1; tolerance (max component bit-exact).
- **R4 PAYLOAD**: extend a streaming pair with an output accumulator consuming the same weights — Lemma 2; tolerance.
- **R5 BLOCK**: re-associate the state reduction's sequential fold into consecutive blocks — associativity of the combine; tolerance; requires the `Associative` property.
- **R6 TWOPASS**: evaluate each block as block-max then one accumulating pass instead of a per-element fold — Lemma 1/2 restricted to the block; tolerance. This step produces the literal FlashAttention inner loop.
- **R7 MAXSHIFT**: introduce the stabilizing maximum into an unstabilized sum of exponentials — Σe^E = e^M·Σe^(E−M); tolerance (used for log-sum-exp, not by attention).
- **R8 LOGRESOLVE**: `log(exp(a)·b) = a + log(b)` for b > 0 — tolerance (log-sum-exp).
- **R9 FUSESUMS**: fuse independent sums over a shared index into one tuple state with componentwise-add combine — bit-exact (same accumulation order per component); exact relation (layernorm statistics).

The experiment (Section 9) is run on the GB10: the rule-derived kernel against the literal unfused lowering and a hand-written streaming kernel, measured wall-clock time and DRAM bytes moved, with pre-registered refutation thresholds, plus per-step contract results and measured tolerance headroom as evidence for the derivation claim itself.

## 1. Problem statement and the claim

The plain program materializes three N×N intermediates (`s`, `e`, and the read traffic they cause) and moves ≥ 6·4·N² bytes of score-matrix traffic through DRAM in addition to the O(N·D) input/output traffic. FlashAttention computes the same function with a running (max, normalizer, output) state rescaled whenever the maximum grows, keeping every score tile in on-chip memory, and is written by hand today.

The research claim this design settles is:

> The streaming form is reachable from the plain program by a fixed, small set of rewrite rules over an index-notation IR with one added construct, such that (a) each application's side conditions are syntactic and mechanically checkable, (b) each application's correctness argument over the reals is a single recorded lemma, and (c) each application is accepted or rejected by the framework's meaning contract under a relation (exact or tolerance) that is stated in advance.

The claim is about the *derivation*, with a supporting claim about *payoff*: the derived kernel should behave like the hand-written one, not like the unfused lowering. Both are falsifiable (Section 9).

## 2. Preliminaries and assumptions

### 2.1 The Tix core as given, and two scoping facts that matter

The Tix core and its f32 meaning are fixed by the brief and treated as given. Two consequences of its scoping rule ("a reduction's body extends as far right as possible") drive rule applications later:

- In `s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);` the divisor `sqrt(D)` is *inside* the sum body.
- In `o[i, x] = sum(j) e[i, j] * v[j, x] / l[i];` the divisor `l[i]` is likewise inside the sum body: the plain program divides every term by the normalizer and then sums.

Over the reals these coincide with the more usual "divide once" forms; in f32 they do not (Section 7.4). Rule R1 exists precisely to close this gap mechanically rather than by silent re-association.

### 2.2 The framework contract this design plugs into

The IR Workbench framework (this worktree) already provides, independently of any domain:

- immutable artifacts with content-hash revisions (`src/framework/core/data.ts`);
- versioned definitions: IR kinds, properties, analyses, invariants, transformations with `requires`/`ensures` and cache policy (`src/framework/contracts/README.md`);
- the **sampled differential invariant** (`src/framework/contracts/differential.ts`): generate cases deterministically from a seed, run a baseline and a subject, compare with an exact or approximate `compare`, record agreement/disagreement/inconclusive counts and the first counterexamples;
- an evidence model with explicit assurance levels — `declared` (assertion, cannot authorize), `checked` (the checker ran or its valid evidence was reused), `proof` (a property-specific external certificate verifier accepted a certificate) — and the explicit statement that the framework contains no theorem prover.

This design uses exactly that machinery. Each rewrite rule is a transformation whose `requires` is a syntactic pattern analysis (a property on the before-artifact), whose `ensures` is a differential invariant relating before and after, and whose algebraic argument over the reals is a recorded part of the rule's registration — a human proof stated as a lemma, not a machine-checked one, with the machine's guarantees being the side conditions and the per-application differential check. Where a rule additionally needs an algebraic property of a user-supplied function (R5 needs associativity of the combine), that property is registered with the strongest evidence the framework supports: a dedicated versioned checker recognizing the proved family (`proof`-backed), with sampled evidence as the documented weaker fallback.

### 2.3 Assumed from parallel work, and out of this worktree

The Tix front end (parser, typed AST, extent inference), the f32 evaluator with the given meaning, and a meaning contract with a tolerance relation are being built in parallel and are not in this worktree. This design additionally *requires* of that work: an **f64 evaluator** (the same programs, same operation order, every operation computed in IEEE double and unrounded at f32) to serve as the reference. A CUDA path for Tix programs (statement-per-kernel lowering, and a lowering of the Section 4 construct) does not exist yet; building it is the follow-on implementation ticket (Section 11), and the experiment in Section 9 depends on it. Everything in Sections 3–8 is checkable with the host evaluators alone.

## 3. The target form, stated algebraically

For one row `i`, the plain program computes, over the reals,

```
m_i = max_j s_ij                    s_ij = (Σ_d q_id · k_jd) / √D
ℓ_i = Σ_j exp(s_ij − m_i)
o_ix = Σ_j exp(s_ij − m_i) · v_jx / ℓ_i
```

(after R1 moves the divisor out; see Section 6). FlashAttention's content is that `(m, ℓ, o)` can be accumulated over disjoint blocks of `j` if each partial state is rescaled when the maximum grows. Concretely, with a per-block triple `(m_K, ℓ_K, acc_K)` for a block `K ⊆ {0..N−1}`:

```
m_K  = max_{j∈K} s_ij
ℓ_K  = Σ_{j∈K} exp(s_ij − m_K)
acc_Kx = Σ_{j∈K} exp(s_ij − m_K) · v_jx
```

two triples combine by

```
M = max(m_A, m_B)
ℓ  = ℓ_A · exp(m_A − M) + ℓ_B · exp(m_B − M)
acc_x = acc_Ax · exp(m_A − M) + acc_Bx · exp(m_B − M)
```

and `o_ix = acc_{full}/ℓ_full`. The whole design rests on the fact that this combine is associative with identity `(−∞, 0, 0)`, so *any* partition of the j range into blocks gives the same real result as the plain program — in particular the sequential one-block-at-a-time sweep. That fact is Lemma 1 below. Nothing in the target form requires storing `s` or `e`; the state per row is one scalar pair plus a length-D accumulator.

## 4. What Tix lacks: the state reduction

### 4.1 The construct

Tix's `sum`/`max` reduce an expression over an index to a single number per free-index point, with a fixed built-in combine. The streaming form needs a reduction whose state is a *tuple of tensors* and whose combine is *user-supplied*. Grammar (an extension of `stmt`):

```
stmt   := ... | treduce
treduce := '(' NAME (',' NAME)* ')' '[' idx (',' idx)* ']' '=' 'reduce' '(' NAME ')'
           'init'   '(' expr (',' expr)* ')'
           'emit'   '(' expr (',' expr)* ')'
           'combine' '(' NAME ',' NAME ')' '{' stmt* 'return' '(' expr (',' expr)* ')' ';' '}'
           schedule?
schedule := 'blocked' '(' NUMBER ')' ('twopass')?
```

The left-hand names are the state components. Inside `combine(u, w)`, the two argument states are referenced by qualified component references `u.m[i]`, `w.acc[i, x]` (component name, then an index list over that component's own indices). Combine-body statements are ordinary Tix statements over index lists that are subsets of the statement's free indices; `return` gives the new tuple. Example — the final derived program of Section 6:

```
fn attention(q: f32[N, D], k: f32[N, D], v: f32[N, D]): f32[N, D] {
  (m, l, acc)[i, x] = reduce(j)
      init(-inf, 0.0, 0.0)
      emit(sum(d) q[i, d] * k[j, d] / sqrt(D), 1.0, v[j, x])
      combine(u, w) {
        M[i]     = max(u.m[i], w.m[i]);
        r1[i]    = exp(u.m[i] - M[i]);
        r2[i]    = exp(w.m[i] - M[i]);
        return (M, u.l[i] * r1[i] + w.l[i] * r2[i],
                   u.acc[i, x] * r1[i] + w.acc[i, x] * r2[i]);
      }
      blocked(B) twopass;
  o[i, x] = acc[i, x] / l[i];
  return o;
}
```

Notes: `-inf` is admitted as a literal (the f32 value −Infinity; Tix's `max` already starts at −∞). Emit components may contain nested reductions over indices other than the bound index, evaluated with their own ordinary meaning.

### 4.2 Typing and shapes

Each component is a tensor over an index list that is a **subset of the statement's free index list** (the union of all components' index lists; `m` and `l` over `[i]`, `acc` over `[i, x]` above). Components are interpreted on the full free-index product by the **projection convention**: a component's value at a full point is its value at the projection of that point (constant along the indices it does not carry). Extents are inferred exactly as in the Tix core (plain uses on the right; affine-only indices require a declared type). Well-formedness (compile-time check errors, per the Tix core's conventions):

- `init`, `emit`, `combine`-return and the left-hand components agree pairwise in arity and component types (after projection);
- `init` does not reference the bound index `j`;
- `emit` components reference only the free indices, `j`, parameters and shape names;
- the combine body references only its parameters' components, its own statements, shape names and the free indices; no reduction in it binds `j`;
- the extent of `j` is inferable; with `blocked(B)`, `B` divides that extent (this is a side condition of blocking, Section 5 R5 — without it the rewrite is not attempted; the construct itself is well-formed with any B ≥ 1, and empty blocks are a check error);
- with `twopass`, the emit is a member of the registered rescaling family (first component an arbitrary `S`, second component the literal `1.0`, remaining components arbitrary — see R6).

### 4.3 Semantics over the reals

Let `F` be the free-index product and `J` the range of `j`. A **state** is a tuple of tensors as above, i.e. a function from `F` into the component product (constant along non-component indices). The value of the statement is defined by the schedule:

- **Sequential (default):** `state₀ = init`; for `t = 0 … |J|−1` in increasing `j` order: `state_{t+1} = combine(state_t, emit(j_t))`. The result components are `state_{|J|}`'s.
- **Blocked(B):** for `t = 0 … |J|/B − 1` in increasing block order: `v_t` = the sequential-fold value restricted to block `t` (starting from `init`); `state_{t+1} = combine(state_t, v_t)`.
- **Blocked(B) twopass:** as blocked, except each block value is computed as: pass 1, `m_t = max` over the block of the emit's first component `S` (an ordinary `max` reduction); pass 2, the remaining components as ordinary `sum` reductions over the block: component `k` is `Σ_{j∈block} exp(S − m_t) · emit_k(j)` (for the family where `emit₂ = 1.0`, the normalizer is `Σ exp(S − m_t)` and each payload `Σ exp(S − m_t) · emit_k`).

The projection convention makes the fold pointwise on `F`: scalar components are shared across the indices they do not carry, and an implementation may compute them once per projection — the semantics is unchanged because the combine body is pure.

### 4.4 The f32 meaning

Exactly the Tix core convention, extended to the fold: every literal (including `-inf`), shape value, operation and function result is rounded to f32 (`Math.fround` of the double result); the sequential fold and the per-block folds of the blocked schedules proceed in increasing `j` order, rounding after each operation; `max`/`min` are exact selections; `exp`, `log`, `sqrt`, `tanh` as in the core. With the rescaling-family init `(−∞, 0, …)`, the first combine computes `exp(−∞ − M) = 0` and `0 · 0 = 0` — no NaN arises provided every emitted `S` is finite, which holds on the contract domain (Section 7.2).

### 4.5 What is deliberately not in the construct

- No associativity requirement for well-formedness: the sequential meaning is defined for *any* combine. Associativity is a separate, separately-evidenced property that only rule R5 needs. Baking it into well-formedness would exclude useful non-associative folds and confuse meaning with a rewrite precondition.
- No scan: intermediate states are not observable; the result is only the final state. Prefix problems (cumsum, associative scans) are out of scope (Section 8.2).
- No scheduling freedom below the schedule clause: `blocked(B) twopass` fixes the meaning exactly; parallelism over free indices is free (the folds at distinct points of `F` are independent), but the order over `j` is fixed by the meaning. Any further reordering (e.g. software pipelining) lives below the meaning level and answers to the device-side check (Section 7.5).

## 5. The rewrite rules

Each rule is stated as: **pattern** (syntactic, over statements), **rewrite**, **side conditions** (mechanical), **algebraic argument over ℝ**, and **check** (what accepts the application). Two lemmas carry all the arguments.

**Lemma 1 (rescaling).** Let `J` be a finite nonempty set and `s: J → ℝ`. For `K ⊆ J` define `M(K) = max_{j∈K} s_j` (`M(∅) = −∞`) and `L(K) = Σ_{j∈K} exp(s_j − M(K))`. For disjoint `A, B ⊆ J`, with `M = M(A∪B)`:

```
M(A∪B) = max(M(A), M(B))
L(A∪B) = exp(M(A) − M) · L(A) + exp(M(B) − M) · L(B)
```

with the conventions `exp(−∞) = 0`, and an empty side contributing `(−∞, 0)` identically. *Proof:* split the sum defining `L(A∪B)` at `A`/`B` and factor `exp(M(A)−M)` resp. `exp(M(B)−M)` out of each part, using `exp(s_j − M) = exp(s_j − M(A)) · exp(M(A) − M)`. ∎

**Lemma 2 (payload).** With `h: J → ℝ^X`, define `A(K)[x] = Σ_{j∈K} exp(s_j − M(K)) · h_j[x]`. The same split and factorization gives `A(A∪B)[x] = exp(M(A)−M)·A(A)[x] + exp(M(B)−M)·A(B)[x]`, pointwise in `x`. ∎

**Corollary (singleton fold).** The sequential fold over `j ∈ K`, from `init = (−∞, 0, 0)`, with `emit(j) = (s_j, 1, h_j)` and the combine of Lemmas 1–2, ends at exactly `(M(K), L(K), A(K))` — by induction on the fold: the state after a prefix `P` is `(M(P), L(P), A(P))`, and one more singleton is Lemma 1/2 with `A = P`, `B = {j′}`. In particular the combine is associative with identity `(−∞, 0, 0)`, because both groupings of a three-way combine compute the `(M, L, A)` of the union. ∎

### R1 — FACTOR-OUT (tolerance)

**Pattern.** A statement `y[i…] = sum(j) E / c;` where the parsed reduction body is `E / c` (the Tix scoping puts the divisor inside), or `sum(j) E * c`, and `c` contains no occurrence of `j` and no reduction binding `j`.
**Rewrite.** `y[i…] = (sum(j) E) / c;` (resp. `(sum(j) E) * c`).
**Side conditions.** `c` is `j`-free (mechanical); and `c ≠ 0` on the contract domain. For attention's `c = l[i]`: the f32 argmax term is exactly `exp(0) = 1`, so `l[i] ≥ 1` holds in f32 by construction — recorded as part of the rule's domain argument, and the differential check's case validity confirms it.
**Real argument.** `Σ_j (E_j / c) = (Σ_j E_j)/c` by distributivity (`c ≠ 0`); likewise for multiplication.
**Check.** Tolerance: the rounding points move (N divisions become one; Section 7.4). Also the *direction* of this rule is fixed by the derivation (factor *out*, never in) — the strategy-level annotation, not the check, enforces direction.

### R2 — INLINE (exact)

**Pattern.** A statement `x[i…] = E;` and references `x[aff…]` elsewhere.
**Rewrite.** Substitute `E` (with `aff` substituted for `x`'s index names; bound indices α-renamed to avoid capture) for each reference; delete `x`'s statement if now unreferenced.
**Side conditions.** Single assignment (always in Tix); no index capture after renaming; extents of the substituted affine expressions are already implied by the original reference's validity.
**Argument (ℝ and f32).** The stored value at `x[aff]` and the substituted expression at the same point are produced by the same operations on the same operands in the same order, in f64 and in f32 — loading a stored f32 and recomputing it are bit-identical. This holds for references inside `emit` components of a state reduction as well.
**Check.** Exact relation (bit-equality of the return value on all cases). The constructive argument is the proof; the differential check is a cheap audit of the substitution machinery.

### R3 — PAIR (tolerance; max component bit-exact)

**Pattern.** Two statements

```
m[i…] = max(j) S;
l[i…] = sum(j) exp(S − m[i…]);
```

whose free index lists agree, whose `j` has the same inferred extent, and whose two occurrences of `S` are syntactically identical up to α-renaming of `j` (normalized-form comparison).

**Rewrite.** Delete both statements; introduce the tuple statement

```
(m, l)[i…] = reduce(j) init(-inf, 0.0) emit(S, 1.0) combine(u, w) {
  M[i]  = max(u.m[i], w.m[i]);
  r1[i] = exp(u.m[i] - M[i]);
  r2[i] = exp(w.m[i] - M[i]);
  return (M, u.l[i] * r1[i] + w.l[i] * r2[i]);
};
```

reusing the original names `m` and `l`, so remaining references elsewhere need no rewriting.

**Side conditions.** The syntactic pattern above; extents inferable; component shapes agree (`m` and `l` over `[i…]`).
**Real argument.** Corollary with `K = J`: the fold value is `(M(J), L(J))`, which is exactly `(m, l)` as defined by the two statements.
**Check.** Tolerance overall. Constructive exact sub-fact worth recording: the `m` component is *bit-exact* — the emitted `S` values are the same f32 numbers the `max` statement saw, and max is an exact selection, so the folded maximum equals the original `m` bit-for-bit. Only `l` deviates (rescale multiplications; different intermediate exp arguments).

### R4 — PAYLOAD (tolerance)

**Pattern.** A pair statement produced by R3 (mechanically: a state reduction whose combine is the registered two-component rescaling combine) with body `S`, and a statement

```
o[i…, x…] = (sum(j) W * V) / l[i…]
```

where `W` is syntactically `exp(S − m[i…])` with the *same* normalized `S` as the pair, and `V` is any expression over `i…, x…, j` and parameters (it may depend on `i…`; that changes nothing below).

**Rewrite.** Extend the pair's state with a third component `acc` (index list `[i…, x…]`; the statement's free list becomes the union), with `init` gaining `0.0`, `emit` gaining `V`, and the combine's return gaining `u.acc * r1 + w.acc * r2` (the same rescale factors); replace the `o` statement by

```
o[i…, x…] = acc[i…, x…] / l[i…];
```

**Side conditions.** The weight `W` must be *exactly* the pair's exponential expression (the weights that normalize the payload must be the same numbers the pair normalizes — this is the load-bearing condition; see Section 8.2 for what fails without it); `l[i…]` is referenced only as the divisor shown.
**Real argument.** Lemma 2 and the Corollary: the extended fold ends at `(M, L, A)` with `A[i,x] = Σ_j exp(s_ij − M)·V_j`, and `o = A/L` equals the original `(Σ_j W·V)/l` because `W` and `l` are `M`- and `L`-equal.
**Check.** Tolerance (extra rescale multiplications and re-roundings on the accumulator).

### R5 — BLOCK (tolerance; requires the Associative property)

**Pattern.** Any well-formed state-reduction statement with the sequential schedule.
**Rewrite.** Add `blocked(B)`.
**Side conditions.** `B` divides the extent of `j` (no empty blocks; this also keeps the `−∞ ⊕ −∞` case out of the combine); the combine's `Associative` and `Identity` properties are established (Section 7.6: `proof`-backed for the registered rescaling family by the Corollary; sampled evidence otherwise, recorded as such).
**Real argument.** The blocked evaluation is a regrouping of the same singleton fold; by associativity, every grouping yields the same value.
**Check.** Tolerance: regrouping changes the rounding points (Section 7.4). The real argument is what licenses attempting it; the differential check decides acceptance.

### R6 — TWOPASS (tolerance)

**Pattern.** A `blocked(B)` state reduction of the registered rescaling family — mechanically: `emit = (S, 1.0, V₁, …, V_q)` (the shape the PAIR/PAYLOAD rules produce).
**Rewrite.** Add `twopass`.
**Side conditions.** The emit-family check; `S` finite on the domain.
**Real argument.** By the Corollary restricted to one block, the within-block sequential fold equals `(m_t, Σ_block exp(S−m_t), …, Σ_block exp(S−m_t)·V_k)`, which is precisely the two-pass block value of Section 4.3.
**Check.** Tolerance: the per-element rescales inside the block disappear (fewer operations, different rounding), and the pass-1 maximum is again bit-exact by selection. After this rewrite the meaning is, statement for statement, the FlashAttention-2 inner loop.

### R7 — MAXSHIFT (tolerance; reaches unstabilized sources)

**Pattern.** `l[i…] = sum(j) exp(E);` with any `j`-dependent `E`.
**Rewrite.** Introduce `m[i…] = max(j) E;` and rewrite the statement to `l[i…] = exp(m[i…]) * sum(j) exp(E − m[i…]);`.
**Real argument.** `Σ_j e^{E_j} = e^{M} · Σ_j e^{E_j − M}` (factor `e^M` out of every term; for the argmax term `e^0 = 1`).
**Check.** Tolerance — values change (on representative domains, for the better; the check does not care). Note the direction: this rule *introduces* the stabilizer, the opposite of a simplifier's instinct; the derivation's strategy layer fixes direction.

### R8 — LOGRESOLVE (tolerance)

**Pattern.** `y[i…] = log(exp(a[i…]) * b[i…]);` with `b > 0` on the domain.
**Rewrite.** `y[i…] = a[i…] + log(b[i…]);`.
**Real argument.** `log(e^a · b) = a + log b` for `b > 0`. For the softmax pair, `b = ℓ ≥ 1` (the f32 argmax term is exactly 1), so the positivity condition is discharged like R1's.
**Check.** Tolerance.

### R9 — FUSESUMS (exact)

**Pattern.** Statements `y₁[i…] = sum(j) E₁; …; y_k[i…] = sum(j) E_k;` with the same `j` and extent, whose bodies are mutually independent (no `y_p` referenced in `E_q`).
**Rewrite.** One tuple statement `(y₁, …, y_k)[i…] = reduce(j) init(0.0, …, 0.0) emit(E₁, …, E_k) combine(u, w) { return (u.y₁ + w.y₁, …, u.y_k + w.y_k); };` reusing the names.
**Argument (ℝ and f32).** Each component of the fold adds, at every step, exactly the term the corresponding standalone `sum` added, in the same order with the same per-step rounding — bit-exact per component.
**Check.** Exact relation.

## 6. The derivation

`P0` is the given program. Write `S` for the shared score expression `sum(d) q[i, d] * k[j, d] / sqrt(D)` (a reference `s[i,j]` until step 5). Extent notes: `x` is inferred from `v[j,x]`, giving `X = D` here.

**Step 1 — R1 on `o` (divisor `l[i]`).** The plain `o` divides every term by the normalizer (Tix scoping, Section 2.1). FACTOR-OUT gives:

```
s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
m[i] = max(j) s[i, j];
e[i, j] = exp(s[i, j] - m[i]);
l[i] = sum(j) e[i, j];
o[i, x] = (sum(j) e[i, j] * v[j, x]) / l[i];        // P1
```

R1 is *not* applied to `s` (the `sqrt(D)` divisor): nothing downstream needs it, and moving it would only change rounding. That choice is a strategy annotation recorded with the derivation, not a check outcome.

**Step 2 — R2 on `e` (two references).** Substitute `exp(s[i,j] − m[i])` into `l` and `o`; `e`'s statement is deleted (now dead):

```
l[i] = sum(j) exp(s[i, j] - m[i]);
o[i, x] = (sum(j) exp(s[i, j] - m[i]) * v[j, x]) / l[i];   // P2
```

**Step 3 — R3 on the pair `{m, l}`.** The pattern matches with `S = s[i,j]`:

```
s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
(m, l)[i] = reduce(j) init(-inf, 0.0) emit(s[i, j], 1.0) combine(u, w) { …pair… };
o[i, x] = (sum(j) exp(s[i, j] - m[i]) * v[j, x]) / l[i];   // P3
```

**Step 4 — R4 on `o`.** The weight `exp(s[i,j] − m[i])` matches the pair's `S`; the payload is `V = v[j, x]`:

```
s[i, j] = sum(d) q[i, d] * k[j, d] / sqrt(D);
(m, l, acc)[i, x] = reduce(j) init(-inf, 0.0, 0.0) emit(s[i, j], 1.0, v[j, x]) combine(u, w) { …triple… };
o[i, x] = acc[i, x] / l[i];                                 // P4
```

**Step 5 — R2 on `s` (one reference, inside the emit).** Substituting the score expression into the emit deletes the N×N statement — from here on the program *cannot* materialize the score matrix:

```
(m, l, acc)[i, x] = reduce(j) init(-inf, 0.0, 0.0)
    emit(sum(d) q[i, d] * k[j, d] / sqrt(D), 1.0, v[j, x]) combine(u, w) { …triple… };
o[i, x] = acc[i, x] / l[i];                                 // P5
```

**Step 6 — R5 then R6 (schedule).** `blocked(B)` with `B` dividing `N`, then `twopass`, giving the program shown in Section 4.1 (P6). Its f32 meaning is: per free point, blocks of `j` in increasing order; per block, the two-pass value (block max, then one accumulating pass of `exp(S − m_t)` and `exp(S − m_t)·v`); the running state rescaled by `exp(m_old − M)` at each combine; final normalization `acc/l` once. That is FlashAttention-2's algorithm, f32 operation for operation.

Eight rule applications (`R1, R2, R2, R3, R4, R2, R5, R6` — six distinct rules), each checked independently, in six derivation steps. A live-memory analysis of P6 (statements' extents, no N×N tensor anywhere) is recorded as part of step 5/6's evidence: the memory claim is checked at the source level, not just inferred from timings.

## 7. Checking

### 7.1 The contract per rule

Each rule is a framework transformation: `requires` = the syntactic pattern analysis (a versioned analysis over the before-artifact, returning the match bindings); `ensures` = a sampled differential invariant in the style of `src/framework/contracts/differential.ts`, with the before-program as baseline, the after-program as subject, and the rule's relation. Per rule:

| rule | real argument | f32 effect | relation |
|---|---|---|---|
| R1 FACTOR-OUT | distributivity | rounding points move | tolerance |
| R2 INLINE | identical op sequence | none (bit-identical) | exact |
| R3 PAIR | Lemma 1 + Corollary | rescale mults; exp args change | tolerance (max bit-exact) |
| R4 PAYLOAD | Lemma 2 + Corollary | same, on the accumulator | tolerance |
| R5 BLOCK | associativity (property) | regrouping | tolerance |
| R6 TWOPASS | Corollary, per block | per-step rescales vanish in-block | tolerance (block max bit-exact) |
| R7 MAXSHIFT | factor e^M | values change (stabilize) | tolerance |
| R8 LOGRESOLVE | log law, b > 0 | rounding points move | tolerance |
| R9 FUSESUMS | componentwise | none (bit-identical per component) | exact |

### 7.2 Domain

The contract's domain is explicit and shared by all rules in this family:

- **Shapes.** `N ∈ [1, 1024]`, `D, X ∈ [1, 256]`, sampled from fixed lists (`N: {1, 2, 3, 5, 8, 16, 64, 128, 256, 512, 1024}`; `D, X: {1, 2, 3, 8, 64, 128, 256}`). When the program contains `blocked(B)` (from step 6 on), generated `N` are multiples of `B` — the case generator consults the schedule clauses; this is exactly R5's side condition, restated on the domain.
- **Input values.** i.i.d. uniform in `[−1, 1]` per element, from the framework's seeded generator (mulberry32 in `differential.ts`), seeds recorded, cases replayable. This bound keeps every score finite with `|s_ij| ≤ √D ≤ 16` and every exp argument in `[−32, 0]`: no overflow, no underflow to subnormals, so the measured deviations are pure rounding effects. Inputs are finite, per the Tix core's domain.
- **Cases.** 64 input cases per shape configuration, 12 shape configurations per program (deterministic from the seed), first counterexample retained by the invariant's evidence record. The f64 reference (P0 in f64) is computed once per case and shared across the whole chain; each rule application then evaluates only its own before/after f32 programs.

Behaviour outside this domain is not claimed and is a compile-time or per-case check failure, per the framework's contract model.

### 7.3 Observation and relations

- **Observation.** The function's returned tensor. Intermediate statements (including `s`, `e`, `m`, `l`) are internal: deleting or fusing them is exactly what the rules do, so only the return carries the meaning. (If a derivation ever needs an intermediate to be part of the meaning, that function must return it — the source language defines the meaning.)
- **Exact relation** (R2, R9): bit-equality of the return on every case.
- **Tolerance relation** (all other rules). With `r` the f64 reference of the original program P0, `b` the before-program's f32 return and `a` the after-program's, the application passes iff for every element:

```
|a − r| ≤ τ_abs + τ_rel · |r|        (accuracy against the reference)
|a − r| ≤ |b − r| + τ_abs + τ_rel · |r|   (no regression beyond the same budget)
```

  with `τ_rel = 2⁻¹⁰` and `τ_abs = 2⁻¹⁰ · max|r|` over the tensor (for the chosen generator, `|o| ≤ 1`, so `τ_abs ≤ 2⁻¹⁰`).

**Error model behind the tolerance** (why these numbers): `o` is a convex combination of the `v` rows (weights `e/ℓ ≥ 0` summing to 1 over ℝ), so there is no cancellation amplification. Each accumulated term picks up one rounding per combining operation; the derived form performs per row about `3N` state operations plus the length-`D` inner sums, giving a relative bound of roughly `(3N + 2D + 4)·u` with `u = 2⁻²⁴` — at `N = 1024, D = 256` about `2.2·10⁻⁴`, i.e. ≥ 4× headroom under `τ_rel = 2⁻¹⁰ ≈ 9.8·10⁻⁴`. The no-regression clause holds because the streaming form adds only the rescale multiplications (≈ a factor ≤ 2–3 in op count over the same terms, well inside the same budget). **This model is itself a falsifiable sub-hypothesis (H1b in Section 9): the experiment measures the actual maximum deviation and the headroom; measured headroom below 2× refutes the model**, and the rule versions and domain must then be re-registered with corrected tolerances.

### 7.4 Where the f32 differences come from

An explicit inventory, per source of difference:

1. **Moved rounding points** (R1, R8): one division instead of N; one log of a product instead of a sum. Same real value, different f32 value.
2. **Changed accumulation order / grouping** (R5, R6): regrouping a fold changes the sequence of additions and removes or adds per-step rescale multiplications.
3. **Different intermediate magnitudes** (R3, R4): the streaming form evaluates `exp(s_ij − m_running)` with the *running* maximum, not the final one; the values differ, and the rescale factors `exp(m_old − M)` (each rounded) restore them over ℝ but not in f32. All exp arguments stay ≤ 0 — no overflow is possible in the streaming form, on any domain where the scores are finite.
4. **Exact parts** (worth recording as constructive facts): every `max` (the `m` statement, block maxima, running maxima) is a selection among the same f32 values, so it is bit-exact throughout the chain; R2 and R9 provably change nothing at all.
5. **Underflow/overflow boundary**: on the contract domain there is none (Section 7.2). On wider domains (|scores| ≥ ~88) small weights flush to zero in f32; the convex-combination structure bounds the effect on `o` by the flushed weight mass (≤ N·1.4·10⁻⁴⁵ relative to ℓ ≥ 1), but this design makes no claim there.

### 7.5 Device-side checking

The host f32 meaning is `Math.fround`-based; a CUDA kernel's `expf` (≈ 2 ulp) and default FMA contraction produce different f32 values. The design therefore keeps two relations: the derivation chain is checked on the host evaluator with the relations of 7.1, and the *final kernel* is additionally checked on the GB10 against the same f64 references with a device tolerance `τ_device,rel = 2⁻⁹`, justified by adding the expf and FMA terms to the model. The checked performance build disables FMA contraction (`--fmad=false`) so that the checked binary and the reported binary differ only in flags; both are checked, and the flag choice is recorded with the measurements.

### 7.6 Properties and assurance levels

R5 requires `Associative(combine)` (and `Identity(init)`). For the registered rescaling family (the combines of R3/R4, any arity of payload components), the Corollary of Section 5 is the proof; it is registered as a dedicated versioned checker that recognizes the family syntactically, giving `proof`-backed assurance on the combine's provenance. A user-supplied combine outside the family can be evidence-checked by sampled f64 associativity over generated states — that is `checked` assurance, not proof; the design admits it (acceptance of the R5 application then rests entirely on the differential tolerance check, and the evidence record says so), but the attention derivation uses only the proof-backed family. This split mirrors the framework's declared/checked/proof model exactly.

## 8. Generality

### 8.1 Programs the same rule set reaches

- **Softmax** (the brief's example program): R2 inlines `e`, R3 pairs `{m, s}`, and `y[i,j] = exp(x[i,j] − m[i]) / l[i]` follows from the components — a streaming two-pass softmax with no `e` materialization. Reached by a strict subset of the attention path.
- **Softmax followed by any contraction** (attention's generalization: `y[i,…] = (Σ_j exp(S−m)·V)/l`, `V` arbitrary over `i, j, x`, row bias `b[i,j]` inside `S`, per-row temperature, multi-head with a batch index `h`, ragged `D` — anything that keeps the pattern): R1 → R2 → R3 → R4. Reached.
- **Log-sum-exp** from an unstabilized source `lse[i] = log(sum(j) exp(E))`: R7 introduces the max, R3 pairs, R8 resolves the log: `m + log(ℓ)`. Reached (this is why R7 and R8 are in the set at all — the attention program does not use them).
- **Fused moments** (mean and second moment of a row in one pass, layernorm statistics up to the normalization step): R9 fuses any number of independent sums over a shared index, bit-exactly. Reached.
- **The "safe softmax"** (global max first, then one pass): the `b = N` corner of R5. The rule set thus derives a *family* of which FlashAttention is the `b ≪ N` member — a useful sanity check that the rules are doing algebra, not pattern-matching a known kernel.

### 8.2 Programs it fails on, and why

- **Weight mismatch**: `o = Σ_j g(s_ij)·v_jx` with `l = Σ_j exp(s_ij)` — R4's side condition (the payload's weight is exactly the pair's exponential) fails. Generalizing would need pairing over two different reductions of the same scores (two normalizers in one state); no rule in the set does this.
- **Causal / masked attention**: the algebra survives (masked scores are `−∞`, contributing zero weight; every lemma tolerates `−∞` emit values as long as some score is finite), but the fixed Tix core has no `select`/`where`, so the source cannot be written. A surface-language gap, not a rule-set gap.
- **Variance from moments, on ill-conditioned rows**: `var = E[x²] − μ²` requires a polynomial-expansion rule this set deliberately excludes; and the check-based rejection is the *point* — on near-constant rows the rewrite is real-exact but numerically catastrophic, and the per-case tolerance relation correctly refuses it. Welford/Chan one-pass variance (an associative `(count, mean, M2)` combine in the same construct) is reachable in principle but has no rule here.
- **The backward pass**: recompute-based backward attention is an algorithmic *choice about what to compute*, not an algebraic identity of the forward program; no meaning-preserving rewrite can introduce it.
- **Scans** (cumsum, prefix-softmax): the construct's meaning exposes only the final state; intermediate states are not observable. Needs a scan construct (Later).
- **Anything whose reduction state must be shared across free-index points** (e.g. a normalizer shared across a whole tensor rather than per row): the construct's state is per free-index point by construction.

## 9. The experiment

### 9.1 Hypotheses (pre-registered, falsifiable)

- **H1 (derivability).** The derivation of Section 6 runs to P6 with every step's contract passing on its first application, using the rule set exactly as stated. **Refuted** if any step's differential check fails on an in-domain case whose side conditions matched — that convicts the specific rule's real argument, side condition, or error model.
- **H1b (error model).** Measured maximum deviation of every rewritten program from the f64 reference is at most half the tolerance (`headroom ≥ 2×`) on every case. **Refuted** by any case with headroom < 2×; consequence: re-derive the model, re-register rule versions.
- **H2 (kernel quality).** For all tested shapes, `T_derived ≤ 1.25 · T_hand`, where both kernels sweep the same block sizes and report their best. **Refuted** by any shape exceeding 1.25×. (If only H2 fails with H1/H3 holding, the *lowering* is weak — a separate implementation ticket — not the derivation claim.)
- **H3 (memory claim).** The derived kernel moves no N²-term bytes: measured DRAM bytes `B_derived ≤ 1.1 ×` the analytical streaming model (Section 9.3) for every tested shape; and `B_derived ≤ 0.5 · B_unfused` for `N ≥ 2048` with `D ∈ {64, 128}`. Also compile-time: P6's live-memory analysis shows zero N×N tensors (part of H1's evidence, repeated here because it is the crisp structural form of the claim).
- **H4 (payoff).** `T_derived ≤ 0.5 · T_unfused` for `N ≥ 2048`, `D ∈ {64, 128}`; for `D = 256` the time ratio is reported against the byte-model ratio (expected ≈ 0.6) with a 30% agreement band. **Refuted** by any tested shape outside its bound.
- **H5 (generality).** The unmodified rule set derives streaming forms for the softmax example, log-sum-exp, and fused moments, each passing its contract. **Refuted** if any pattern fails to match (a side-condition gap) or any check fails.

The research claim of Section 1 stands with H1 + H3 (+ H5); H2 and H4 calibrate quality and payoff respectively, and their failure modes are named above so a negative result cannot be reinterpreted post hoc.

### 9.2 Apparatus

- **Host** (this worktree's framework + the parallel Tix front end/evaluators): the derivation as a recorded sequence of framework transformation executions — pattern analysis results, per-step differential evidence, revision hashes, and the f64 references — all in the contract runner, Node 24.
- **Device**: NVIDIA GB10 (Grace Blackwell, CUDA-capable), CUDA C++.
- **Kernels**: (a) *unfused* — the literal statement-per-kernel lowering of P0 (five kernels: `s`, `m`, `e`, `l`, `o`), tiled matmuls, intermediates in global memory; (b) *hand-written* — an FA2-style f32 streaming kernel written directly in CUDA; (c) *derived* — the lowering of P6 (one CTA per row-tile, sequential over j-blocks, state in registers, K/V blocks staged through shared memory), implementing the P6 schedule exactly, FMA contraction disabled in the checked build (Section 7.5).
- **Shapes**: `N ∈ {512, 1024, 2048, 4096}`, `D = X ∈ {64, 128, 256}`, block sizes `B ∈ {16, 32, 64, 128}` swept for all three kernels; `B | N` enforced (the domain).

### 9.3 Metrics and the byte model

- **Time**: CUDA-event wall clock, median of ≥ 100 runs after 20 warmup runs, per shape and block size.
- **Bytes**: Nsight Compute `dram__bytes.sum`, plus the analytical model:
  - *unfused*: `≈ 24·N² + 4N²·(D+B)/B` bytes — six full traversals of the score intermediates (`s` write, `m` read, `e` read+write, `l` read, `o` read) at 4 bytes each, plus tiled restreams of `k` and `v`;
  - *derived* (row tile `R`): `≈ 8·N²·D/R + O(N·D)` bytes — `k` and `v` restreamed once per row tile, no N² term;
  - *hand*: the same model as derived.
  With `R = B = 64` and `D = 128`: unfused `≈ 40N²`, derived `≈ 16N²` — the source of H4's 0.5 threshold at small `D`; at `D = 256` the model ratio is ≈ 0.57, hence H4's reporting clause there.
- **Correctness on device**: all three kernels compared against the same host f64 references under `τ_device` (Section 7.5), on the same fixed input cases used by the host chain.
- **Derivation artifacts**: rule applications count, evidence records, measured tolerance headroom (H1b), the live-memory analysis of P6.

### 9.4 What refutes the research claim

Not a tuning shortfall but a structural failure: no sequence of the stated rules connects P0 to a streaming form on the real program (a side condition that does not hold — e.g. the Tix scoping of `o`'s divisor defeated R1); or a rule that is real-exact but whose f32 deviation escapes the pre-registered tolerance on the accepted domain (H1/H1b); or a derived kernel that nevertheless materializes N² traffic (H3). Any of these convicts a specific named rule or the error model — that is what makes the design falsifiable rather than merely evaluative.

## 10. Alternatives considered

- **Fold with built-in rescale vs. user-supplied combine.** The simplest alternative: hard-code a `softmax_reduce` with the (m, ℓ, acc) state and FlashAttention's combine. It would reach attention only — not LSE, not fused moments, not future combines (Welford). Chosen: the general tuple reduction with user combine; the rescaling family is then a *property* (proof-backed, Section 7.6) rather than the construct's meaning, and the same construct serves R9's trivial combine.
- **One fusion mega-rule vs. decomposed rules.** Fusing all five statements in one rewrite needs the same lemmas but a brittle 5-way pattern, and cannot stop partway (softmax would not match). Chosen: FACTOR-OUT/INLINE/PAIR/PAYLOAD decomposition — each argument one lemma, each pattern two statements.
- **Requiring stabilized sources vs. introducing the stabilizer (R7).** Simplest alternative: only accept sources that already subtract the max. That excludes plain LSE and plain softmax-without-max sources. Chosen: keep R7; direction is a strategy annotation.
- **Blocking as part of the construct's meaning vs. a separate checked rewrite (R5/R6).** Baking `B` into the semantics makes meaning depend on a tuning knob and hides the reassociation from the contract. Chosen: schedule clauses introduced by rewrites under the same contract as everything else.
- **End-to-end-only checking vs. per-step.** Checking only P0 against P6 is simpler but cannot attribute a failure to a rule, cannot reuse verdicts per revision, and abandons the ticket's premise (local, mechanical steps). Chosen: per-step differential invariants; the f64 reference computed once per case makes the chain cheap.
- **Tolerance everywhere vs. exact where provable.** Uniform tolerance would pass R2/R9 applications that are actually broken in unobserved ways (e.g. a capture bug that happens to stay in tolerance). Chosen: bit-exact relations where the op-sequence argument gives them; tolerance only where the error model says f32 must differ.
- **Equality saturation / e-graph search vs. directed rules.** An e-graph over the Tix extension could *search* the rule set (and find derivations nobody wrote down). It does not remove the need for exactly these rules and their justifications — every match still needs its algebraic license. Chosen: directed rules with a recorded derivation; the search layer is Later.

## 11. Phased plan (for the follow-on implementation ticket)

1. **Construct** — state reduction in the Tix front end and both evaluators (sequential, blocked, two-pass meanings), with the well-formedness checks of Section 4.2. (Depends on the parallel Tix work.)
2. **Framework registration** — the nine transformations, their pattern analyses, the rescaling-family checker (`Associative`, `Identity`), the exact and tolerance invariants, the domain generator of Section 7.2.
3. **Derivation run** — apply Section 6 to the attention program as a recorded strategy; produce the evidence chain and the live-memory analysis.
4. **Lowering** — CUDA lowering of the construct (P6 schedule) and the unfused statement-per-kernel lowering of P0.
5. **GB10 rig** — timing, Nsight counters, on-device checks; the H1–H5 verdicts.
6. **Generality corpus** — softmax, LSE, fused moments, bias/temperature/multi-head attention variants; H5.

## 12. Later

- Causal/ragged attention: add a `select` builtin to the Tix core; the algebra and rules are unchanged.
- Backward-pass streaming (dK, dV): a second derivation over the same construct.
- A Welford/Chan `(count, mean, M2)` combine family with its own pairing rule for exact one-pass variance.
- A scan construct exposing intermediate states (cumsum, prefix problems).
- f16/bf16 and mixed-precision domains; the f32 meaning is the contract here.
- Autotuned block-size selection under the contract (the sweep is manual in this design).
- Equality-saturation search over the rule set to find derivations beyond the hand-recorded one.
- FA3-class numerics (unnormalized accumulator with a separate logsumexp correction) as an alternative combine family.
- Adversarial input search (mutation-style) to stress the tolerance relations beyond the uniform generator.
- A strategy layer deciding rule order and direction (R7's direction, R1's non-application to `s`).

## 13. Related work

FlashAttention (Dao et al., arXiv:2205.14135) and FlashAttention-2 (arXiv:2307.08691) define the target algorithm; the online-softmax rescaling identity and its use for memory-efficient normalization appear in Milakov & Gimelshein (arXiv:1805.02867). The (max, weight-sum) rescaling combine is the soft-max monoid known from the MapReduce/aggregation literature; this design's Lemma 1 is its associativity proof, and its payload extension (Lemma 2) is what attention needs. Chan, Golub & LeVeque's parallel-variance combine is the analogous associativity for R9's future Welford extension. On the compilation side, Taco (arXiv:1612.05201) compiles index notation with workspaces and fusion but not streaming reassociation with checked meaning; Halide and TVM/TensorIR separate meaning from schedule but check schedules by testing, not by per-rewrite meaning contracts; equality saturation (egg, arXiv:1802.10523) is the search-layer alternative discussed in Section 10; Exocompilation proves schedules against semantics but is expert-programmed per kernel. The delta claimed here is narrow and precise: the streaming form reached by directed, individually checked rewrites, each with a pre-registered exact or tolerance relation against the original program's meaning, in a framework whose evidence model distinguishes proof from sample.
