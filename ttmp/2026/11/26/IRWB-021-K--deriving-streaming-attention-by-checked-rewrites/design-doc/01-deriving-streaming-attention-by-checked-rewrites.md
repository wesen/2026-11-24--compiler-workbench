---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-K
Status: review
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
      Note: Origin-based sampled comparison with a domain-owned relation
    - Path: repo://src/framework/ir/PATTERNS-AND-REWRITES.md
      Note: Versioned matching, directed scheduling, and transactional acceptance
    - Path: repo://src/typed/evaluate.ts
      Note: Existing Typed origin-check integration pattern
ExternalSources: []
Summary: A local algebraic derivation, f32 acceptance contract, and GB10 experiment for compiler-derived attention.
LastUpdated: 2026-11-26T12:54:47.07145861-05:00
WhatFor: Design a checked derivation and an experiment that can reject it.
WhenToUse: When evaluating streaming reduction rewrites for Tix.
---

# Deriving streaming attention by checked rewrites

**Proposal.** Derive the online recurrence by changing the representation of a weighted sum: a partial sum carries the maximum at which its weights were computed. Merging two partial sums first puts them at a common scale. A CUDA lowerer sees a tiled fold, not an `attention` opcode. This is a research design; neither the rewrite checker nor the GB10 results exist in this worktree.

## Scope and notation

For the algebra, take `N,D > 0`, finite real inputs, and matching extents as in the brief. For fixed `i`, write `a_j = s[i,j]`, `b_j[x] = v[j,x]`, and `J = [0,N)`. Keep the score expression **as parsed**: `a_j = sum(d) (q[i,d] * k[j,d] / sqrt(D))`, with the division inside the `d` reduction. Likewise the source output divides *inside* the `j` reduction. No score rescaling or change to the `d` reduction is part of the derivation. The supported f32 research domain is narrower (§ Checking).

## IR addition: an ordered fold with product state

Add one typed internal region operation, not new surface Tix syntax:

```text
fold(k in I; init = z; combine = C) { B(k) }
```

`I` is an explicit ordered integer index domain, including clipped tile intervals. `z` and `B(k)` have the same type `T`, and `C : (T,T) -> T` is a pure region. State types are scalars, fixed-shape products (including row vectors with call-bound extents), and optionally `Empty | Present(T)`. Regions use ordinary Tix scalar operations plus pure local bindings, tuple construction/projection, and a lazy case split on the tag. Vector operations in this document abbreviate elementwise scalar operations; they introduce no hidden reductions. The shape checker checks types, defined/in-bounds index domains and captured bindings. Bindings are lexical and a body or combine has no effects and cannot access a previous accumulator except through `C`.

An invocation returns the left fold from `z`: for each `k` in increasing lexicographic order evaluate `B(k)`, then replace the state with `C(state,B(k))`. An empty domain returns `z`. The f32 interpretation is the same as Tix within both regions: round every numeric operation (including `exp`, `sqrt`, `max` and each vector component operation) using `Math.fround` of the JS result; construction, projection, tags and indices do not round. A maximum uses Tix's scalar `max` semantics. In a tagged combine, empty operands return the other operand without arithmetic (no `-∞ - -∞`); only a nonempty result is projected by the attention finalizer. A combine need not be associative to run a left fold. Repartitioning or reordering requires a law for the matched combine on its reachable states and a new numerical check when the f32 evaluation changes. In particular a real monoid certificate is **not** an f32 associativity flag.

Keeping independent scalar reductions is enough to express the original statistics, but not to share a loop-carried anchor with a vector of partial outputs. One ordered product fold exposes that dependency for checking. Substituting an attention intrinsic would be simpler to lower, but would not derive or check the recurrence in steps.

## Rules and local proofs

Match the typed, index-bound expression graph, not printed text. Each rule is a schema on a small before/after region. Captures must be pure; match equality includes binder identity up to alpha-renaming, shapes, and SSA dependencies, not approximate equality. Replacements preserve the region's free indices and outgoing values (except dead bindings); guards verify all uses before deleting any producer. Real proofs below concern only legal instances of each schema.

**R1 — Factor an invariant denominator out of a sum.**

```text
sum(j) (h_j / L)              -> (sum(j) h_j) / L
sum(j) ((w_j / L) * b_j[x])   -> (sum(j) (w_j * b_j[x])) / L
```

`L` has no `j` dependency (including transitive captures), is finite and nonzero in the supported domain, and the sum range is unchanged. The second form also uses `(w/L)*b = (w*b)/L` over the reals. Multiplication by `1/L` distributes over a finite sum. In attention `L = sum_j exp(a_j-M)`, where `M = max_J a`; at least one term is 1, so `L >= 1`. Check that provenance, rather than recognizing a tensor named `l` or inferring nonzero from sampled values.

**R2 — Zip sibling reductions.** Replace sibling sums over the same ordered index domain and same outer context by projections of one componentwise additive fold. In the weighted case:

```text
(L,U[:]) = (sum_j w_j, [sum_j (w_j * b_j[x])]x)
         -> fold(j in J; (0,zeros); componentwise +) { (w_j, [w_j*b_j[x]]x) }
```

Here `w_j` does not depend on `x`, `b_j` has fixed payload shape, and there are no dependencies between the accumulations. The rule works for independent other summands too. Projection of the initial state and each combine is the original scalar initial value and step; induction on `j` proves the result, even with f32, since each component sees precisely the same operations in the same order. Sharing a pure `w_j` preserves its rounded value. In particular, the `L` leaf is `w_j`, not an inserted arithmetic operation.

**R3 — Partition a homogeneous fold into tile folds.** With identity `z` and combine `C`, replace `fold(j in J; z; C) { B(j) }` by `fold(t; z; C) { fold(j in J_t; z; C) { B(j) } }`. This also applies to core `max` by viewing it as such a fold. For a positive integer tile size `B`, `t` runs over `[0,ceil(N/B))` and `J_t = [tB,min(N,(t+1)B))`. Check that tiles are nonempty, disjoint, exhaustive and in source order; the inner bodies are unchanged, including any common anchors. Use only componentwise sum with zero and scalar max with `-∞` here. For ordered concatenation of two nonempty segments, the combined fold results equal a single reduction: `z` is neutral and `C` is associative over the reals (extended with the bottom identity for max). Induction over segments proves the tile rule without requiring commutativity.

**R4 — Factor a change of anchor out of each tile.** Match the tiled additive fold from R3 with leaves `exp(a_j-M)` and `exp(a_j-M)*b_j[x]` (or just the scalar first component), tracing pure definitions, and the tiled max of the same `a_j` over the same partition. For a tile `T`, denote its max by `m_T` and its anchored sum by

```text
P_T(h) = sum over j in T of (exp(a_j-h), [exp(a_j-h)*b_j[x]]x).
```

Replace inner `P_T(M)` by `exp(m_T-M) * P_T(m_T)`; keep the outer addition and `M = max_t m_T` for now. Check that the captured anchors are finite and independent of `j` in the tile, and that only the shared exponential depends on the anchor (in particular `b_j` does not). Per leaf `a_j-M = (a_j-m_T) + (m_T-M)`, so its weight factors by `exp(u+v)=exp(u)*exp(v)`. Distribute the common scalar over every component sum. Both exponent arguments in the replacement are nonpositive; do not rewrite to uncentered `exp(a_j)` or `exp(M)`.

**R5 — Fold the max and rescaled tile sums together.** Match the pair of results

```text
M = max_t m_t
P = sum_t exp(m_t-M) * p_t        // p_t = P_{J_t}(m_t)
```

where the two reductions enumerate the same nonempty collection of tiles, their finite leaf summaries `(m_t,p_t)` do not depend on `M`, and every anchor consumed by the outer weighted sum is that same `M`. Replace the pair by projections of `fold(t; Empty; merge) { Present(m_t,p_t) }`. Write `p=(l,u[:])` and define

```text
merge(Empty,S) = merge(S,Empty) = S
merge((mA,pA), (mB,pB)):
    m = max(mA,mB)
    alpha = exp(mA-m); beta = exp(mB-m)
    return (m, alpha*pA + beta*pB)
```

For any nonempty group `G` of tile leaves, the invariant is `m_G=max_{t in G} m_t` and `p_G=sum_{t in G} exp(m_t-m_G)*p_t`. It holds for a singleton by `exp(0)=1`. For disjoint groups `A,B`, take `m=max(m_A,m_B)`; `exp(m_A-m)*exp(m_t-m_A)=exp(m_t-m)` for every `t` in `A` and likewise for `B`. Thus the merge produces the summary of the concatenation. Both parenthesizations of three groups summarize the same union, proving associativity on these states; the tag gives an identity. Induct over `t` and project to recover exactly `(M,P)`. This proof does not assume `p_t` is positive; only the `l` component of a valid attention tile must be positive for the final division. No global anchor is evaluated as a separate pass after this rewrite.

**R6 — Fuse a pure producer at its consuming scope.** Replace a captured tensor read by a binding in the smallest consumer region enclosing its uses, substituting the read's indices (capture-free); delete the tensor definition only if it has no remaining use. For attention, localize the tile-max producer first, then `s[i,j]` once per `(i,j)` in the tile, shared by its max and weight consumers. Check shape and index substitution, that all old dependencies are available at the new scope, and that it preserves the whole scalar expression and reduction order. To claim elimination of a global temporary, require all its consumers to be covered and the new local buffer to fit the chosen tile schedule. Exact argument: a read of an immutable pure tensor equals the value of its defining expression at those indices. Scope and storage changes do not change rounding. The rule can also substitute a pointwise producer before R1 to expose a normalized weight. It does not license arbitrary reassociation or duplication of score computation in the chosen schedule.

## Derivation on the source

| Stage | Live computation for each `i` (suppress `i`) |
| --- | --- |
| Source | `M=max_J a`, `w_j=exp(a_j-M)`, `L=sum_J w_j`, `o[x]=sum_J ((w_j*b_j[x])/L)` |
| R1 | `o[x]=U[x]/L` with `U[x]=sum_J (w_j*b_j[x])` |
| R2 | `(L,U)=P_J(M)` as one additive product fold; `M` still computed separately |
| R3, max then add | `m_t=max_{J_t} a`, `M=max_t m_t`; `(L,U)=sum_t P_{J_t}(M)` |
| R4 | `(L,U)=sum_t exp(m_t-M)*P_{J_t}(m_t)`; remove the now-unused globally anchored `e` binding |
| R5 | `(M,(L,U))=fold(t; Empty; merge) { (m_t,P_{J_t}(m_t)) }`; project `L,U`, discard the final `M` |
| R6, tile max then scores | Bind `m_t` and the score tile locally in the fold body; compute `P_{J_t}(m_t)` there; no global `s`, `e` or tile-summary array |

The last row is a loop over `t`. On the first tile the running summary is the tile summary; thereafter it sets `m'=max(m,m_t)`, `l'=exp(m-m')*l+exp(m_t-m')*l_t`, and `u'[x]=exp(m-m')*u[x]+exp(m_t-m')*u_t[x]`. After the last tile, write `u[x]/l`. The max and the weighted sum read the same on-chip score tile; the pass over keys is single-pass at tile granularity, not one scalar read of each score inside the tile. `B=1` is the simpler singleton recurrence, useful as a control; bigger tiles amortize the merge and expose parallel work. A clipped final tile adds no padded keys.

## Checking

### Contract for the experiment

- **Domain:** `1 <= N <= 8192`, `1 <= D <= 128`, three matching `f32[N,D]` inputs, all entries finite f32, `|q|,|k| <= 4`, `|v| <= 1`. This qualifies only invocations in that domain, not a change to source Tix. The research harness checks membership for each invocation; an optimized variant cannot assume arbitrary Tix callers meet these preconditions based on sample results. All finite f32 inputs would be a simpler domain declaration, but products can overflow there. The chosen bound keeps scores and sums finite: real scores have magnitude at most `16*sqrt(D)` (with rounding slack for f32), exponential weights are at most 1, and normalizers have a max term of 1. For the merged normalizer, a child with the winning maximum has scale 1, keeping that contribution. Neither empty reductions nor all-masked rows are needed.
- **Observation:** the returned tensor's shape and every element, with no observable temporary tensors. A run must produce all elements and be finite; `+0` and `-0` are equivalent under the tolerance relation.
- **Reference:** evaluate the *original* parsed core on those same f32 inputs lifted exactly to f64, using double operations/functions and the original lexicographic orders with no f32 intermediate rounding. This is a numerical oracle, not the real proof and not a license to reinterpret the original source syntax. Also run the original f32 program against that oracle at the start. A source failure is a failure of the proposed numerical qualification; report it separately from rewrite drift.
- **Relation:** matching shape and for every coordinate `|candidate - reference| <= 2e-4 + 1e-3*|reference|`. These are proposed experimental constants to freeze before sampling/tuning. Absolute tolerance matters with cancellation near zero; a relative-only or ULP-only gate there would test a different objective. Report the max ratio of error to budget with its coordinate, not just a mean. The approximation is explicitly to the f64 evaluation of the origin; it does not assert bit equality to the core's f32 result.

### Per-application evidence

Every row below needs an exact local check **and** the origin tolerance gate on the whole candidate. The exact check for R2, R3-max and R6 also establishes f32 equality to their immediate predecessor under the specified evaluator; use pairwise bit equality (including zero sign) as an additional regression check for those instances. Do not use adjacency as a tolerance baseline: acceptance is not transitive under a tolerance relation.

| Rule | What the local verifier checks | f32 effect to test |
| --- | --- | --- |
| R1 | Denominator provenance/nonzero and free-index independence; reconstruct the factored form. | Many per-term divisions become one; weighted products and cancellations round at different points. |
| R2 | Equal domains/initializers and exactly the projected scalar steps, with independent components. | No change to per-component values or order; only sharing and interleaving. |
| R3 | Exact covering partition, inner captures unchanged, recognized sum or max law. | Addition regrouped with per-tile zeros, so roundoff and cancellation can change; max only selects an operand (including the same zero-tie convention). |
| R4 | Match exponent, anchor and payload, plus the same tile max; replay factorization componentwise. | Rounded differences, `exp`, and tile-level multiplications replace globally shifted weights; underflow can occur at different points. |
| R5 | Match the two outer reductions and independent leaf summaries; replay the summary/merge lemma and check exact projections. | Partial outputs and normalizers may be repeatedly rescaled and added in a different order; tiny contributions can round away or underflow differently. |
| R6 | Check exact capture-free substitution, local sharing, unchanged operation order, and no live uses of deleted definitions. | None in the IR evaluator. CUDA's functions, scheduling and arithmetic are checked separately. |

Use a small Tix verifier for those schemas: given versioned rule ID, matched bindings, explicit index domains and exact before/after revisions, re-match the old region, check the guards, reconstruct the unique permitted replacement (up to renaming), and check the actual edit including unchanged surroundings. The trusted lemmas are the real identities above; there is no need for a general-purpose prover or for comparing arbitrary symbolic exponentials. Comparing only outputs on random inputs would not check the claimed identities or catch every wrong partition/index. Testing targets the extra f32 question, not the proof over reals.

The current framework has transactional rewrites and versioned relational invariants, but no Tix verifier or f64 oracle in this worktree. Use a directed `applyOnce` sequence through the rewrite acceptance gate rather than general rule search; the experiment tests one derivation and needs an inspectable stopping point: require the structural/lemma check, then a domain-specific `differential()` invariant with `origin` as baseline (as in the existing Typed origin pattern), running f64 on `origin` and f32 on `candidate`. Supply the experiment's comparison and a pinned case manifest; the generic differential helper is not itself a tolerance policy. Treat any missing, inconclusive, nonfinite or out-of-tolerance required result as unqualified (even though the helper can report agreement among decided cases). Record origin/parent/candidate revisions, rule and evaluator versions, partition, seed/manifest, corpus coverage, worst ratios and first counterexamples. Reuse origin results only with the same origin and complete contract/corpus version. Accept a revision only after both gates; on rejection, don't claim the derivation reached a fused kernel. This needs a Tix adapter and a small instance verifier on the existing framework, not a change to the framework scheduler or a new prover.

### Corpus and numerical controls

Freeze a manifest before measuring: small and tail shapes (`N=1,2,31,32,33,63,64,65,257`, `D=1,7,64,128`), every benchmark shape below, and all candidate tile widths (also `B=1` in the small checks). On the small grid run 16 seeded draws per shape plus constructed cases; on every benchmark shape run two seeded draws and sharply separated / near-tied score cases. Use uniform bounded samples and include all-zero logits, repeated maxima crossing tile boundaries, successive maxima near the end of the row, extreme positive/negative scores (including f32 underflow of some weights), one-hot values, and signed/cancelling and near-zero outputs. Test mutation negatives (e.g. swap merge scales, drop the last key) so a verifier or harness accepting a deliberately wrong candidate fails the study. Use the same oracle for CUDA outputs on the corpus, including actual large shapes; budget that evaluation separately from kernel time. This is sampled numerical assurance, not a theorem for every f32 array in the domain.

## What else this reaches

These are structural matches and real-law applications, not claims that the attention domain and tolerance qualify other programs. Each program needs its own origin and numerical contract.

| Program | Reach or boundary |
| --- | --- |
| Stable softmax followed only by a linear contraction in `j` | Inline the softmax output read by R6, use the second R1 pattern, then R2–R6. The value payload may have a different width or several channels; it must be local to the key and independent of the normalization. Scores need not be dot products. |
| Stable log-sum-exp `M + log(sum_j exp(a_j-M))` | Keep only the scalar `L` component (no zipping needed); partition max and sum, factor the anchor, merge `(m,l)`, then finalize `m+log(l)`. Pre-shifted source required by these rules; this does not fix naive uncentered `exp` overflow. |
| Layernorm raw moments | R2 and optionally R3 zip `sum_j x_j` and `sum_j (x_j*x_j)` in one pass for statistics; keep the existing mean and variance finalizers. Applying weights to the original row still reads it again unless it is retained. A two-pass centered variance does **not** match: converting it to `E[x²]-E[x]²` needs a new rule and may be numerically unacceptable near constant rows. |
| Full softmax or returned score/weight tensor | Every returned weight is observable and depends on the completed normalizer. The rules cannot replace the returned `N×N` tensor with one row summary; one would need to retain values or read/recompute them again. |
| Nonlinear or cross-key consumers, e.g. `sum_j tanh(y[i,j])*v[j,x]` or ranks of normalized weights | R1 and the scalar change of anchor cannot move a shared scale through `tanh` or supply cross-key order statistics. They do not have the required additive payload. |

## GB10 experiment

Run this study in two stages once the Tix frontend, evaluators and contract are available: qualify the revision trace in the evaluator first, then qualify and measure the CUDA artifacts. The staged design distinguishes a missing derivation from a slow lowering.

**Hypothesis.** The unannotated source (and variants with renamed tensors/indices) reaches an accepted single tiled CUDA kernel through R1–R6 using no attention-specific lowering substitution. On **each** primary shape `N in {4096,8192}`, `D in {64,128}`, it moves at most half the off-chip bytes of the materialized lowering, takes at most `1/1.5` of the materialized lowering's median time, and takes at most `1.25×` the median time of the hand-written streaming comparator. Both the accepted revision chain and the GPU outputs must pass the frozen numerical qualification.

**Lowering under test.** One thread block owns a tile of `Bq` query rows; hold its running `(m,l,u)` in registers/shared storage, load each key/value tile of `Bj` rows, compute its score tile, summarize, merge, discard, and write the query output tile once. The backend should lower tile-local producers, product state, and a loop from generic IR constructs; it must not infer the recurrence from a library call or function name. Use a fixed small search grid `Bq in {8,16,32}`, `Bj in {32,64}`; exclude configurations that do not fit target resource limits and apply the same tuning budget to both streaming variants on separate tuning data. Keep `d` in source order with separate rounded multiplies, divides and adds; no mixed precision, fast math, FMA contraction or flush-to-zero for the experiment. Within-tile `j` trees, if used, are explicit schedule changes with an exact real-law check for the affected fold and a fresh origin comparison. Hardware `exp`/`sqrt`/division may differ from the JS-rounded reference even then. Apply the tolerance gate to the actual GPU artifact and not just a simulation. All baselines use the same input types and arithmetic policy.

**Comparators and metrics.** Compare the derived kernel with (1) a competitive materialized lowering of the same source that writes global `s` and `e` and (2) a manually scheduled CUDA kernel for the same online recurrence, with no compiler rewrite rules. Time the entire attention call's GPU kernels, with data device-resident and allocations out of the timed region. Use CUDA events after warm-up (e.g. 20 calls), report median and p10/p90 for 100 calls with interleaved variants on the same GB10. Separately profile hardware off-chip read plus write bytes for all kernels of each call, starting each profiled call with a cold GPU cache. Do not flush between kernels of the same call; log the cache control used. This separates bytes moved by the call from whether its inputs happened to survive a previous timed repetition. Report ratios against both baselines, launch count, peak global scratch and register spills; report `N=1024,2048,4097` as secondary shapes to inspect launch overhead, scaling and tails. Record target, CUDA/tool and driver versions, clocks/power mode, arithmetic modes and tile choices. Missing or unreliable byte counters leave the byte claim untested, not established by timing or by allocation size.

**What the byte metric means.** The kernel does `Θ(N²D)` arithmetic but allocates no global `N×N` temporary. The compulsory read/write volume is `Θ(ND)`; actual off-chip traffic need not be. With no reuse across thread blocks, tiling requests roughly `4 * (2ND + 2 ceil(N/Bq) ND)` bytes for Q/output and repeated K/V reads (before cache effects and spills). With effective shared-cache reuse this can approach `Θ(ND)` at studied sizes. Distinguish measured off-chip traffic from tile load requests and global scratch. Removing score writes alone does not prove the advertised asymptotic traffic claim.

**Decision.** A missing or rejected rewrite, a valid required case that fails tolerance, or any primary shape missing a performance threshold refutes the combined hypothesis for this design. Keep semantic and performance verdicts separate: a locally checked streaming derivation might succeed even when GPU resource limits, K/V reloads or code quality erase the speedup. Check the rewrite trace, allocation/address-space plan and byte counters to distinguish those outcomes. A hand-picked final kernel would not answer the derivation question, even if it ran faster.

## Later

- Run evaluator qualification when the parallel Tix frontend, evaluators and meaning contract are available.
- Build and measure the experimental CUDA artifacts when the target and profiling tools are available.
- Causal and arbitrary masks, including normalization semantics for empty rows, require new syntax or equivalent core encodings and guards.
- Batches, heads, training/backward passes and dropout need separate matching and contracts.
- Welford merge for centered layernorm statistics is a new summary law, not part of this rule set.
- Tensor-core, reduced-precision and fast-math modes need their own numerical experiments.
- A recomputing two-pass fused baseline would separate materialization savings from the online algorithm's other tradeoffs.
- Universal f32 error proofs and broad rewrite search are outside this bounded study.
