---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-G
Status: review
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
      Note: Existing transaction and evidence model; the Tix checker supplies its own assurance.
    - Path: repo://src/framework/contracts/differential.ts
      Note: Sampled invariant supports a fixed origin and domain-specific tolerance comparison.
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Existing rewrite application carries extra contract inputs and checks the output before publication.
ExternalSources: []
Summary: A local rewrite derivation, meaning contract, and falsifiable GB10 experiment for single-head f32 attention.
LastUpdated: 2026-11-26T12:47:51.600474281-05:00
WhatFor: Evaluate whether checked tensor rewrites can derive a competitive streaming attention kernel.
WhenToUse: When reviewing the Tix structured reduction, attention derivation, or experiment protocol.
---

# Deriving streaming attention by checked rewrites

## Proposal and scope

Derive a bounded, row-local summary from the source's shared exponential weights; partition its reduction; then make only one tile of scores and weights live at a time. The matcher uses def-use and index structure, not a function name or an attention-specific kernel replacement. The research has two distinct questions: can each rewrite be justified mechanically, and does the resulting GPU program pass the numerical contract and perform competitively? Only the first is argued here; no implementation or measurement is reported. A tiled two-sweep lowering could first find the row max, then recompute scores to form the two sums without storing `s/e`; it would not answer whether one sweep is derivable.

**Domain.** The attention experiment is specialized to consistent dense `q,k,v : f32[N,D]`, integer `1 ≤ N ≤ 4096`, `1 ≤ D ≤ 128`, finite f32 inputs with `|q|,|k| ≤ 2.5` and `|v| ≤ 1`. The compiler needs the shape and value restrictions as facts of the workload contract; samples alone cannot establish them. The core Tix program's meaning is unchanged. These bounds keep naive scores below 72 in magnitude and keep sums, rescaling and divisions finite; they still allow tiny exponential weights to underflow. Every nonempty stabilized group has a weight exactly one in the IR evaluator, so a final positive denominator does not require a numerical guess. Empty rows, nonfinite scores and other domains are not covered by this claim.

**Parsing matters.** Write `a(i,j) = sum(d) (q[i,d]*k[j,d]/sqrt(D))` for the source score. The division is per term, not after the dot. The source output is `sum(j) ((e[i,j]*v[j,x])/l[i])`, not `(sum(j) e[i,j]*v[j,x])/l[i]`. The score expression, including its `d` order and rounding points, is opaque to these rewrites. In the rules, `J` denotes the nonempty reduction domain, `i` the fixed row, and `x` a payload component. Suppressed indices are held fixed, not implicitly summed.

## Minimal internal extension: structured reduction with an explicit schedule

Use a pure internal `fold(J, lift, identity, combine; tree)` returning a typed product, with projections. `lift` is a lexically scoped term producing the state for a single index; `combine` is a typed expression over two states, with no tensor writes, other effects, or dependence on the enclosing traversal. States may contain scalars and fixed-by-shape vectors. A small tag distinguishes empty from nonempty states. `tree` denotes a deterministic parenthesization with the indices as leaves exactly once in increasing order (the default is a left fold seeded with `identity`; no indices returns `identity`). A tile-local `let` may bind a finite slice of an indexed expression using `lo ≤ j < hi`; its scope ends before the next tile. This is IR notation, not a change to Tix syntax. Scalar built-in reductions alone cannot update a vector in lockstep with the running maximum; a bespoke `FlashAttention` op would hide the derivation. A general fold is enough, but reassociation is authorized only for certified combines, not on the strength of a user's `associative` annotation.

For a finite score `a_j` and payload vector `b_j`, use the state `Empty | (m,L,U)` with `U` of the payload's shape. The singleton lift is `(a_j, 1, b_j)`; `Empty` is the identity. Define the combine `⊗` by returning the other operand unchanged if either is `Empty` (two empties give `Empty`). For two nonempty states:

```text
h  = max(mA, mB)
p  = exp(mA - h)
r  = exp(mB - h)
L' = p*LA + r*LB
U'[x] = p*UA[x] + r*UB[x]
return (h, L', U')
```

In the **real model**, for every nonempty finite collection `S` of labelled leaves the summary is

```text
F(S) = (mS, Σ[j∈S] exp(a_j-mS), Σ[j∈S] exp(a_j-mS) b_j)
mS   = max[j∈S] a_j
F(∅) = Empty
```

For disjoint groups `A,B`, `h = m(A∪B)` and `exp(a_j-h) = exp(a_j-mA) exp(mA-h)` on `A` (likewise on `B`). Distribute the factor over the two sums, componentwise for `U`. Thus `F(A) ⊗ F(B) = F(A∪B)`. This gives an associative identity law on the reachable real states by considering any three disjoint groups and the same union. It also gives a mechanical proof by induction on any permitted tree. No algebra with `−∞−(−∞)` is involved.

In the **f32 model**, lift fields and numeric constants are f32. Use Tix rounding for every scalar operation in the combine: e.g. `p = fround(exp(fround(mA-h)))`, `L' = fround(fround(p*LA) + fround(r*LB))`, likewise for each component; `h` uses Tix `max`. The tag branch evaluates only the selected expression, without any floating operations for empty merges. No wider accumulators, FMA, or implicit tree changes. The default left fold and any explicit tile tree have different f32 meanings in general. Final division, where used, is one rounded division per component. The algebraic certificate proves associativity only in the real model, never bitwise in f32.

## Rules and application checks

All five rules require well-typed, pure Tix/IR, valid inferred extents and capture-free substitution. Each application supplies the matched term and shape/index bindings; the checker re-matches the input, constructs the expected replacement and confirms only that region (and its justified uses) changed. Proofs below are rule schemas with checked premises, not a plan for a general symbolic theorem prover. “Tolerance” means the fixed **original** f64 reference gate in the next section, not comparison to the previous revision.

| Rule | Rewrite and side conditions | Local real argument | Application check and f32 delta |
| --- | --- | --- | --- |
| **R1. Extract invariant divisor** | `sum(j) (P_j / L) → (sum(j) P_j) / L`. Also match `sum(j) ((w_j / L)*b_j)` with `P_j = w_j*b_j` after pure producer substitution. `L` has no free `j`, is finite and nonzero; here it is the nonempty row's stabilized sum. | Multiplication by `1/L` distributes over the finite sum, and commutes with multiplication by `b_j`. | Exact match, index independence and positivity witness (one `exp(0)`), plus tolerance. Moves rounding of divisions outside the sum, changes summands and accumulator magnitudes; multiplication can round in a different place in the second form. |
| **R2. Lift centered aggregates** | Replace projections of `m=max(j)a_j`, `L=sum(j) exp(a_j-m)`, `U[x]=sum(j) exp(a_j-m)*b_j[x]` with projections of `fold(J, j ↦ (a_j,1,b_j), Empty, ⊗; left)`. Match the same finite score term, same `J`, same row anchor for all weights, `m,L` independent of `x`, and pure payload with no dependence on aggregates being replaced. Only replace matched uses; require no unmatched consumers of score/weight tensors to eliminate their materialization in R5. If `U` is unused it may be omitted (zero payload components). | The original triple is `F(J)` by definition, and induction with the merge law yields exactly `F(J)` from the singleton lift. | Exact structural check and merge certificate, plus tolerance. Exponentials now use differences of successive maxima; rescaling can repeatedly round or underflow, and weighted products and sums round in a different order. |
| **R3. Partition the fold** | Replace the left fold of leaves with a left fold of block results, each an increasing left fold, with the same lift, identity and combine. For integer `B>0`, block `t` is `[tB,min((t+1)B,N))`, `0 ≤ t < ceil(N/B)`. Require a certified combine and an ordered, disjoint cover, with the tail clipped, not padded with score sentinels. | Each inner fold computes `F(J_t)`; successive outer prefixes summarize the exact union by the merge law. More generally this is reassociation and identity insertion for the certified combine. | Exact certificate and cover check, plus tolerance for the regrouped arithmetic and changed maximum/rescale history. |
| **R4. Expand a tile summary** | Replace an inner fold of the R2 lift and combine over a nonempty block by tile-local `m_t=max(j∈J_t)a_j`, `w_j=exp(a_j-m_t)`, `L_t=sum(j∈J_t)w_j`, `U_t[x]=sum(j∈J_t)w_j*b_j[x]`. Retain the same domain and payload and order scalar reductions by increasing `j`. Apply inside a block, not to the outer fold. | Both expressions denote `F(J_t)`, by the same induction as R2. This direction avoids doing the rescale once per key within a tile. | Exact match and same summary certificate, plus tolerance. Tile weights now use one fixed maximum; exponentiation and summation paths differ from the singleton fold. |
| **R5. Sink producers, erase dead tensors** | Inline pure indexed definitions at their tile-local uses (or bind the exact expression once in the tile); erase a tensor only when it has no remaining uses or observations. Check the affine substitutions, bounds, def-use and type/extent preservation, and keep all roundings and reduction trees. In this application, one row owner holds all `x` components and advances blocks in order. | Each tensor element denotes its defining expression with the same indices; substitution is equality, and removing an unused pure definition cannot change the return. | Exact including f32: the same operations on the same inputs recompute the same bits, including signed zero, in the specified evaluator. Also run the original f64 gate for this new whole-program revision. This rule does not certify any new backend arithmetic or placement of register spills. |

## Derivation on the given program

1. **R1** leaves `s,m,e,l` as written and exposes `u[i,x] = sum(j) (e[i,j]*v[j,x])`, followed by `o[i,x]=u[i,x]/l[i]`. Neither `sqrt(D)` nor the scale in `s` moves.
2. **R2** matches one row of `m,l,u` through `e`; with `a_j=s[i,j]` and `b_j=v[j,:]`, the normalized output is `U[x]/L` of the singleton fold. `m` and `e` now have no separate purpose. This step alone does not require that the producer `s` be fused.
3. **R3** factors that fold through consecutive key blocks. The outer state summarizes the prefix through the last completed block; associativity is used only on the real proof side.
4. **R4** turns each inner fold into a max and the paired weighted sums in that block. The outer combine remains intact.
5. **R5** computes each score in the block from `q,k` at the original rounding points and uses `v` there. Dead full-row/whole-program tensors `s,m,e,l,u` (if still represented as separate definitions) disappear. A tile may hold scores and weights so neither dot products nor exponentials are repeated per output component. The final form, with the old prefix denoted by `(m,L,U)`, is:

```text
for each row i (or independent group of rows):
    state = Empty
    for J_t in increasing key-block order:
        a[j]    = sum(d) (q[i,d] * k[j,d] / sqrt(D))  for j in J_t
        m_t     = max(j in J_t) a[j]
        w[j]    = exp(a[j] - m_t)
        L_t     = sum(j in J_t) w[j]
        U_t[x]  = sum(j in J_t) (w[j] * v[j,x])
        state   = state ⊗ (m_t,L_t,U_t)
        // Nonempty update: h=max(m,m_t), p=exp(m-h), r=exp(m_t-h);
        // m=h, L=p*L+r*L_t, U=p*U+r*U_t (all RHS use old fields).
    o[i,x] = U[x] / L
```

Each row walks `j` once in tiles. A CUDA schedule can assign a query tile to one cooperative block, share its `k,v` loads among those queries, and keep scores/weights in tile-local storage. Parallelize across queries, scores and payload components without changing the stated reduction order in the initial experiment. Check block ownership, tail coverage, local lifetimes and index mapping when lowering; only the output is returned, with no global score or weight buffer. The point of the schedule is to test whether the derivation yields an efficient mapping, not to claim that removing a buffer proves a byte count.

**Storage versus traffic.** The persistent tensor footprint is O(N·D), and per-block scratch depends on tile sizes, not `N`. The arithmetic is still O(N²·D). The O(N·D) footprint and compulsory I/O do not imply O(N·D) total device-memory traffic for fixed tile sizes: a query tile of size `Bq` independently sweeping `k,v` can issue O(N·D·ceil(N/Bq)) bytes of `k,v` loads before cache reuse. Measure off-chip traffic and distinguish it from logical loads and the eliminated O(N²) intermediate writes/reads. Do not assume caching or absence of spills.

## Meaning contract and acceptance

- **Domain:** the shape/value contract above, including its bounds as pass premises; later generality examples have their own domains. Use the original f32 input bits, widening exactly for the reference. **Observation:** the returned tensor's shape and all values in index order; intermediate tensors, allocation and reduction traces are not observable.
- **Exact relation:** each rule instance has a local real equivalence certificate; R5 additionally preserves the f32 evaluation literally. Use an independent schema checker with versioned lemmas (finite-sum linearity, `exp(x+y)=exp(x)exp(y)`, the summary homomorphism and substitution) and registered validators for premises. The pass must not certify its own arbitrary rewrite. Test that incorrect rescale signs, mismatched reduction indices, a missing tail and erasing a live use are rejected by the checker, even on inputs that would mask the error.
- **Numerical relation:** for every output component `c` of a checked case, require equal shape, finite values and `|candidate_c − ref_c| ≤ 0.002 + 0.001|ref_c|`. The reference is the *original* Tix AST evaluated in f64 with the original grouping and lexicographic orders, without `fround` (not the previous f32 revision or a transformed f64 program). The absolute floor handles cancellation near zero; the constants are fixed proposed research thresholds for `|v|≤1`, not proven roundoff bounds. Check original f32 against the same gate as a control. Run it against every candidate IR revision and the actual CUDA outputs; CUDA exp/sqrt/division implementations may differ from the evaluator. Use f32 inputs/accumulators, no TF32, fast-math, intentional flush-to-zero, FMA contraction or reciprocal substitution in the initial comparison. Record compiler settings and inspect the generated code; don't infer CUDA bitwise equivalence. A numerical disagreement on a valid case is evidence against the candidate/contract, not an invitation to widen the thresholds after looking.
- **Evidence, not a global f32 proof:** run seeded random and adversarial cases covering singleton rows, ties and constant inputs, near ties, monotone rising/falling block maxima, the winning score in the last tail, mixed signed payloads/near-zero outputs, score dot cancellation and extreme gaps (underflow). Include `N=B−1,B,B+1,2B+1` where valid, odd `D`, shape endpoints and the timed fixtures. Fix the generator, shape matrix and seeds before compiling; reserve separate seeds and adversarial cases for held-out checks. Record maximum error and worst case, exact failing input bits (or reproducible fixture and index), rule revision, and block/tree schedule. A missing or timed-out mandatory case leaves the gate unestablished. The sampled approximation is not a universal f32 guarantee, and adjacent tolerant comparisons would not compose. The fixed reference prevents error budgets from accumulating across passes.

**Framework fit.** Use one artifact revision per accepted rule application. A Tix transformation's `requires` checks domain/structural premises; `ensures` checks a replayable local correspondence from `input` to `output` and binds the versioned meaning invariant's `origin`/`candidate` ports to the immutable source and `output`, respectively. `applyPass` can pass the origin via `contractInputs` and gate publication with `verifyTransformation`; the generic differential invariant already supports domain-provided evaluation, comparison, sample generation and evidence. The Tix gate must additionally require all mandatory cases to be decided; the generic helper can accept a mix of agreement and inconclusive results. Key reusable reference work to the original revision plus the reference/domain/suite versions, and candidate evidence to those plus the exact candidate and schedule/evaluator versions. Failed checks do not authorize the candidate; the previous accepted revision or unfused program remains the alternative. The framework supplies transaction/evidence hooks, not the Tix evaluator or a proof engine. A simpler sampled-only pass would not answer the question about local correctness; bitwise equality alone would reject permissible rescheduling.

## Where the rules generalize, and where they stop

- **Softmax then contraction:** with `y[i,j]=e[i,j]/l[i]`, a pure contraction `z[i,x]=sum(j) y[i,j]*b[j,x]` is the second form of R1 after R5 inlines `y`. The rest is identical. Finite score expressions other than dots (e.g. a finite additive bias) work structurally if tile-local; the separate workload must still satisfy its own numerical contract. A scalar expected value is the one-component case.
- **Stable log-sum-exp:** for `m[i] + log(l[i])` use R2 without `U`, then R3/R4/R5 as above. Completion has `L>0`, so `m+log(L)` is the original real result. For plain `log(sum(j) exp(a_j))`, first introducing the stabilizing shift would need another rule; it does not match this set as written.
- **Layernorm statistics:** the fold *can represent* a mergeable mean/variance state, but these rules do not derive it. In particular `sum(j) (x_j-mean)^2` has a different dependence on the anchor; the exponential rescale certificate says nothing about this centered square. Even packing raw first and second moments would need an independent product-of-sums rule, and deriving variance via `E[x²]−E[x]²` would need a cancellation-aware contract.
- **Full softmax or returned weights:** every output weight depends on the final normalizer. The summary suffices for an aggregate, not for emitting earlier weights as final values; returning those weights requires storing or revisiting per-key information. A second nonlocal live consumer (e.g. a contraction of weights with other weights across two indices) can also defeat R5. Nonlinear dependence on a global intermediate, score producers that themselves require nonlocal data, or a payload size growing with `N` can invalidate the bounded-state/traffic benefit even if the fold is legal.

## GB10 experiment and decision rule

**Hypothesis.** Starting only with the given Tix AST, the ordered strategy R1→R2→R3→R4→R5 (match by structure) emits a single streaming kernel with no global `s/e` buffers, passes all prespecified local and numerical gates, and meets the following proposed thresholds on GB10. For each of the six primary shapes `N={1024,2048,4096}` × `D={64,128}`, the median GPU latency ratios satisfy **unfused/derived ≥ 1.2** and **derived/hand-streamed ≤ 1.25**. At `N=4096`, for both `D`s, measured off-chip read+write bytes are **at most 75% of unfused**. Report bytes for hand-streamed too; near parity or deviation helps diagnose the schedule. These are target outcomes, not predictions derived from big-O.

| Variant | What to run |
| --- | --- |
| Unfused | CUDA lowering of the original statements with explicit global score and exponential tensors; use competent tiled/coalesced kernels where applicable, not a one-thread reference evaluator. |
| Derived | Same source; retain the checked revision chain and run the automatically lowered streaming form, with no manual edits to emitted attention code. |
| Hand-streamed | An independent CUDA implementation of the running-max block algorithm, using the same f32 precision and math constraints, not a mixed-precision library substituted as a baseline. |

**Procedure.** Use the same resident dense buffers, layouts and workload, one GB10, and log device/driver/toolchain, flags, tile sizes, clocks/power regime and launch parameters. For both streaming variants, try the same fixed grid of `Bq∈{4,8,16}`, key block size `B∈{16,32,64}` on tuning inputs separate from test fixtures. Freeze each variant's fastest legal schedule per shape and gate those revisions before measurement. For timings warm up each variant (at least 20 evaluations); use CUDA event intervals for whole invocations (all unfused launches included), excluding allocation, compilation and transfers, in at least 100 interleaved repetitions per shape. Report medians, paired 95% bootstrap intervals on the ratios, and spread. Profile bytes in separate matched runs with the same cache starting protocol for all variants (cold-cache profiling via eviction outside the measured interval); sum validated device DRAM read/write counters across the invocation and name those counters. If GB10 does not expose usable counters, report bytes as unmeasured, not replaced by an allocation estimate. Also report temporary global allocation, spills, launch count, and signed/absolute error summaries. Timed fixtures must pass the same all-component reference check for all variants.

**Refutation:** inability to derive or locally certify any step, an out-of-tolerance valid case, or global score/weight materialization refutes the corresponding derivation/meaning claim. A verified kernel can still fail the performance hypothesis: a reproducible miss of any latency or byte threshold refutes that part. An interval straddling a latency threshold or unavailable byte counters leaves that part inconclusive, not successful. Report which part failed rather than conflating semantic validity with throughput. The unfused baseline tests the value of streaming; the hand kernel tests whether automatic scheduling leaves a meaningful performance gap.

## Later

- Attach the structured fold, checker and strategy to the parallel Tix front end, evaluators and meaning contract when available.
- Implement CUDA lowering and the GB10 benchmark fixtures, gate and profiling runs.
- Explore further CUDA schedules, tensor cores and mixed precision under separate contracts.
- Add separate moment identities and a numerical study for centered layernorm statistics.
- Extend to masked/causal, multi-head, backward passes, and empty or nonfinite rows.
- Establish uniform f32 error bounds if sampled assurance is insufficient for deployment.
