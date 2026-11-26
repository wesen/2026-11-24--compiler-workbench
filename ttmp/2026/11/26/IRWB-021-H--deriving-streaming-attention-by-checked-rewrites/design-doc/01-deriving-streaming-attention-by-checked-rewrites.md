---
Title: Deriving Streaming Attention by Checked Rewrites
Ticket: IRWB-021-H
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
      Note: Transformation invariants and revisioned evidence
    - Path: repo://src/framework/contracts/differential.ts
      Note: Sample comparison callback and inconclusive-case behavior
    - Path: repo://src/framework/ir/PATTERNS-AND-REWRITES.md
      Note: Existing versioned rule and acceptance hooks
ExternalSources: []
Summary: Six local rules, a tuple fold with explicit f32 order, and a falsifiable GB10 comparison.
LastUpdated: 2026-11-26T12:47:51.53443936-05:00
WhatFor: Design a checked derivation of streaming attention from plain Tix.
WhenToUse: Review the algebra, acceptance criteria, or experiment protocol before implementation.
---

# Deriving Streaming Attention by Checked Rewrites

**Proposal:** recognize a shifted exponential reduction and its weighted sums, not an `attention` function or a `q·k` score. Replace the shared row shift with a shift carried by each partial reduction, then tile the reduction and move the score producer into the tile. Check each edit with a small rule-specific validator and check each full candidate against the same original f64 program. A real identity and a passing numerical sample are different kinds of evidence.

## Contract and notation

- **Domain for the experiment:** dense, unmasked self-attention as in the brief, with matching `q,k,v : f32[N,D]`, integer `1 ≤ N ≤ 8192`, `1 ≤ D ≤ 128`, and finite f32 entries with `|q|, |k| ≤ 4`, `|v| ≤ 1` (elementwise). The value bound is a precondition on admitted cases, not a fact inferred from `f32` or a new restriction on core Tix. These bounds keep both score variants, shift differences and sums far from overflow. Scores may tie and exponentials may underflow. No empty row is normalized. The more general algebra below requires nonempty finite real score rows, finite real payloads, and the stated binding conditions; it does not extend this numerical contract to other programs.
- **Observation:** returned shape and every returned element, not `s`, `e`, signed zero, allocation or loop order. For the exact-f32 rules, bit equality (including signed zero) is a stronger local claim. Nonfinite outputs or failed execution on admitted test cases do not pass.
- **Reference and relation:** interpret the *original* Tix program on the same f32 inputs using f64 throughout, retaining source syntax and lexicographic reductions (including the original position of `/sqrt(D)`); no intermediate f32 rounding. Require the same shape and `abs(candidate[i,x] - ref[i,x]) ≤ 2e-4 + 2e-4*abs(ref[i,x])` everywhere, with both outputs finite. Freeze this proposed budget before the first run. Test the original f32 evaluator and the unfused CUDA baseline against it too: if the baseline fails, report that as failure of this experimental contract, not as a rewrite error or a reason to quietly widen the budget. Mixed absolute/relative error handles near-zero outputs from signed values; bitwise equality for all stages would disallow the intended regrouping. Sampled checks can refute, not prove, the f32 relation over this domain.

Fix a row `i`. `a_j` is its score, `w_j` the payload vector `v[j,:]`, `J = [0,N)`. `Σ` is a real sum in proofs; in IR it denotes a reduction with the order specified below. Vector operations are componentwise. All substitutions preserve types, index maps and bindings (alpha-renaming allowed); free-index independence is computed on the matched IR, not guessed from spelling. Pure SSA tensors have no observable materialization. Keep any still-used definitions; erase only when dead. No rule assumes that real algebra is exact f32 algebra.

## Minimal IR extension and its f32 meaning

Use an internal `fold(J, seed, map, combine)` with product state (scalar fields and fixed-by-shape vector fields), pure typed expressions/regions for `map` and `combine`, and projections. `combine : State × State → State`; its first argument is the accumulator. The fold visits the given finite index range in increasing order, applying `acc = combine(acc, map(j))`. Independent output indices such as `i` are captured, read-only. Add lexically scoped tile-local `let` bindings for scalars and slices, and an `Empty | Nonempty(state)` tag (or a valid bit and lazy branch). A partition is a list of increasing contiguous subranges, for fixed positive tile size `B`, `[bB, min((b+1)B,N))` for `0 ≤ b < ceil(N/B)`. Do not evaluate invalid lanes of a partial tile. This is internal IR, not new user-facing Tix syntax.

An ordered tuple fold does not need associativity to execute. Only a checked real summary law allows regrouping; a user-supplied combine is not presumed associative. The f32 interpreter evaluates the explicit fold/partition order, uses the core's `fround` after every numeric primitive, applies max as in the core, rounds vector operations elementwise and does not round a tuple or tag again. Seeds, lets and projections introduce no additional operations. `Empty` is an identity by branching, with no arithmetic on missing fields; using `(-∞,0,0)` without a guard would admit `-∞ - -∞`. A GPU tree or FMA has no implicit license from this semantics; check the resulting code as its own lowering. A scalar `sum` alone cannot jointly carry the shift, scalar mass and vector mass, and introducing an opaque fused-attention opcode would hide the very identity under test.

## Rule catalog and trace

Each arrow acts on the current revision. A checker independently matches the left side, verifies the listed obligations and reconstructs the permitted right side modulo binders, checking the actual edit and unchanged context. The proofs below justify these versioned schemas, not arbitrary callbacks or claims of associativity. **Exact** below names the local check (f32 or reals as marked); **sample** always means the whole returned candidate in f32 against the original f64 reference. Run the sample for every arrow, including exact-f32 arrows, to keep a common acceptance gate against the origin. It is redundant for exact-f32 preservation if the predecessor already passed.

### R1 — Extract an invariant divisor (twice)

`Σ_t (p_t / c) → (Σ_t p_t) / c`, when `c` is independent of `t`, finite and nonzero on the domain, and `p_t` is pure. Over the reals `1/c` distributes across addition. In the source, **both** `/sqrt(D)` and `/l[i]` are inside the respective reduction bodies. First transform the score into `(Σ_d q[i,d]*k[j,d]) / sqrt(D)` (`D>0`). Then extract `/l[i]` from the output sum; a nonempty row with finite scores contains a maximum term of weight `exp(0)=1`, so `l[i]≥1` (also in f32 here, with finite sums). The output is now a numerator divided by `l[i]`. **Exact real + sample:** division happens once after the sum instead of rounding each quotient before accumulation; changed scores also affect the subsequent max and weights.

### R2 — Pack co-indexed sums

Replace co-indexed sums by projections of an ordered fold of their summands with componentwise addition. In the attention match, `M = max_J a_j` and `E_j = exp(a_j - M)`, and the paired definitions `L = Σ_J E_j` and `U[x] = Σ_J E_j*w_j[x]` feeding `U/L` become:

```
(L,U) = fold(J, (0,zeroVec), j ↦ (E_j, E_j*w_j), componentwiseAdd)
return U/L
```

Check the same reduction range, order, score/weight SSA binding and row index on both uses; the normalizer and `E` must be independent of `x`. Permit a zero-width vector for a scalar-only consumer. Over the reals, projecting the tuple sum gives the corresponding sum. In f32, induction on the shared index shows that each field executes the old operations with the same operands, in the same order. The packing does not move multiplication across a reduction. **Exact f32 + sample:** no rounding difference.

### R3 — Replace the common shift with a mergeable summary

Match the R2 fold whose weights use exactly the max of the same score binding over the same row and range. Replace the tuple and its max dependency with projections of

```
(M,L,U) = fold(J, Empty, j ↦ Nonempty(a_j,1,w_j), merge)
```

Here and below the triple on the left unwraps a known nonempty result. `merge(Empty,A) = merge(A,Empty) = A`. For two nonempty triples `A` and `C`:

```
m = max(A.m,C.m)
f = exp(A.m - m); g = exp(C.m - m)
merge(A,C) = Nonempty(m, f*A.l + g*C.l, f*A.u + g*C.u)
```

For a nonempty collection of terms `S`, define `H(S) = (m_S, Σ_S exp(a_j-m_S), Σ_S exp(a_j-m_S)*w_j)` with `m_S = max_S a_j`; `H(∅)=Empty`. A singleton has unit weight. For a partition into `A` and `C`, `m=max(m_A,m_C)` and `exp(a_j-m)=exp(a_j-m_A)*exp(m_A-m)` for each `j` in `A`, and likewise for `C`. Thus `merge(H(A),H(C))=H(A ⊎ C)` (union retaining multiplicities). Induction gives the folded summary; applying the identity to three collections proves associativity on valid real summaries. `L,U` are exactly the old projections over the reals. Accumulating unshifted `exp(a_j)` would be simpler over the reals, but can overflow f32 even on the experimental domain. Remove global `M`/`E` only if no other users remain. **Exact real + sample:** rounded shifts, exponentials, rescale products and sums differ; repeatedly rounding small contributions or underflowing a scale can lose terms that a global-shift sum would round differently. This is not an f32 associativity certificate.

### R4 — Partition a summary fold

Replace the singleton fold by an increasing fold of block summaries: `fold(blocks, Empty, b ↦ fold(J_b, Empty, singleton, merge), merge)`. Check `B>0`, ordered disjoint exhaustive coverage (by the interval formula), matching `merge` and singleton definitions, and the certificate from R3. The partition law yields `H(J)` independent of grouping. This is the point that selects the block schedule; it does not yet prescribe how each block is computed. **Exact real + sample:** inner and outer merges now round a different grouping, including different intermediate maxima and scales.

### R5 — Evaluate each tile using its own fixed shift

For the inner singleton summary fold of R4, substitute `H(J_b)` evaluated by ordinary local reductions:

```
m_b = max_(j in J_b) a_j
p_j = exp(a_j - m_b)
(l_b,u_b) = ordered tuple sum_(j in J_b) (p_j, p_j*w_j)
```

Check the inner fold has the certified singleton and combine, the tile is nonempty (or explicitly return `Empty` before evaluating it), and both local reductions use exactly that tile and the same score. The partition-law proof for R3 made the fold equal to the defining `H(J_b)`, so replacing it by that definition preserves every field over the reals. The outer merge is unchanged. This avoids rescaling the vector for each key inside a tile. **Exact real + sample:** local max/exp and accumulation replace singleton rescaling; only cross-tile rescaling remains, changing how often and where rounding/underflow occur.

### R6 — Sink a pure producer into its tile consumer

When all live score uses are the tile's max and weight computations for the same `(i,j)` (plus uses of those weights confined to the tile), replace the score tensor with a local slice `aTile[i,j in J_b] = score(i,j)` in the outer fold's tile evaluation region; similarly keep `p` local to the tile. Check the reconstructed producer expression including its ordered `d` reduction, capture and range equality, dominance of local uses, and absence of escaping uses. Do not inline into each vector lane or into each use: bind each score once per `(i,j)` and each weight once per `(i,j)`. Substitution of identical pure expressions at equal indices preserves values over the reals and in f32; no arithmetic changes. If scores escape, this storage-removal variant cannot apply. **Exact f32 + sample:** only placement/lifetime changes. Generic producer inlining alone would still need the global max or recompute scores and does not yield the one-pass schedule.

After `R1(score) → R1(output) → R2 → R3 → R4 → R5 → R6`, the IR denotes this row program:

```
state = Empty
for J_b in increasing key-block order:
    aTile[j] = (ordered Σ_d q[i,d]*k[j,d]) / sqrt(D) for j in J_b
    m_b = max(aTile)
    p[j] = exp(aTile[j] - m_b) for j in J_b
    (l_b,u_b) = ordered tuple sum_(j in J_b) (p[j], p[j]*v[j,:])
    state = merge(state, Nonempty(m_b,l_b,u_b))
return state.u / state.l
```

Each key contributes a score only once per row. Row-wide `s` and `e` no longer exist. The final division is outside the fold; normalizing each tile separately would lose its relative mass.

## Acceptance in the Workbench

Use a directed sequence of versioned rules over a Tix adapter to the existing rewrite API. A fixed rule order suffices to test derivability; a general search would introduce a separate question about search cost and heuristics. Match on operators, index bindings and dataflow (including alpha-renamed inputs and statements); the guide to the schedule may name R1–R6 but must not supply a recognized attention kernel in place of a derived artifact. Before a rewrite publishes, use the host verification hook and a transformation invariant with `origin`, `before`, `candidate` ports. The exact local check reads `before` and `candidate` and associates the rule, binder/shape checks and proof schema with those revisions. Range facts for the numeric guard come from the declared domain and the matched arithmetic, not observed sample extrema. The differential invariant reads `origin` and `candidate`; its reference/cache identity includes the origin, domain, evaluator versions and corpus. Recheck the original relation at every step: a tolerance is not transitive, so a chain of adjacent checks would be unsound even as a sampled acceptance policy. Neither a `preserves` declaration nor the matcher alone counts as evidence. If a check rejects, keep that step and its counterexample in the trace, and do not count the derivation as complete.

The contract registry, rewrite acceptance hook and comparison callback in `differential.ts` are existing seams, not a Tix checker. The required domain components are the parallel Tix adapter/evaluators plus this small extension, rule validators and comparison wiring. Use complete decision coverage for the mandatory corpus: treat timeouts or evaluator exceptions on required cases as failed coverage rather than as agreement (the generic differential helper permits inconclusive cases). Record seed, shape, rule and artifact revisions, numerical policy, max error per case and first failing coordinate/input. Also check the actual GB10 outputs against the same reference at the lowering boundary; record contraction order, fusing multiply-add, exp implementation, denormal handling and any changed accumulation order. Use f32 throughout; no TF32 or f16 in the primary comparison. An independent CUDA comparison matters because validating a tuple interpreter does not validate code generation.

## Reach and limits

| Program | Reach of the rules |
| --- | --- |
| Softmax-weighted contraction using arbitrary pure scores and signed payloads | Yes: if written as a common shifted exponential followed by `Σ(e*w)/Σ(e)`, as in the brief. If written with a separate `y_j=e_j/L` and `Σ(y_j*w_j)`, this minimal catalog does not match; one additional real/tolerance normalization must pull the shared denominator through the product and sum. |
| Stable log-sum-exp `M+log(Σ exp(a-M))` | Yes: scalar-only R2, R3 supplies both `M` and `L`, and R4–R6 give the same streaming summary without `U`. Keep the final `M+log(L)`. Its f32 budget/domain needs separate validation. |
| Layernorm statistics | R2 can pack `Σx` and `Σx²` if already written that way. For centered variance, this catalog does not derive a one-pass statistics recurrence: that needs a moment/variance identity and numeric checks (raw moment subtraction can cancel). Even a one-pass stats fold needs the original elements for normalized outputs. |
| Standalone softmax returning all weights; attention with an observable score/weight matrix | No bounded summary suffices to emit irrevocable normalized elements in one pass: later keys change each earlier denominator. Escaping uses prevent R6 from removing the matrix. |
| Nonlinear consumer of each normalized weight, e.g. `Σ tanh(e_j/L)*w_j`; masked rows with no valid keys | The former has no common linear rescale for the stated fields; the latter has no nonempty fold result and requires its own semantics. Neither is matched. |

## GB10 experiment (not yet run)

**Hypothesis:** from plain attention Tix the directed schedule derives, without a hand edit, an f32 streaming CUDA kernel with an accepted trace at every rule and at lowering. For each `N ∈ {2048,4096,8192}` at `D ∈ {64,128}`, it uses at most half the device DRAM bytes and half the median GPU time of the unfused lowering, and takes at most `1.25×` the median GPU time of a hand-written streaming f32 kernel. These are proposed thresholds, not performance claims. A failure of any required match/acceptance, unexpected global score/weight temporary, or reproducible miss of any of those performance thresholds refutes the combined hypothesis. Report semantic and performance outcomes separately. Unavailable hardware or counters make the corresponding result unmeasured, not a pass.

- **Derivation and numerical tests:** require the seven-step trace for the original and an alpha-renamed version (also rename the function). Exercise `N=1`, smaller-than-tile and tile-boundary cases (`B-1,B,B+1,2B+1` within domain), odd `D`, and all benchmark shapes. Use fixed seeds for bounded uniform f32 inputs plus constructed rows with equal scores, repeated maxima in different tiles, a new late maximum, severe exponential underflow, alternating signed values and nearly cancelling outputs. Run the f64 check for every required case at every arrow and for each backend. Include negative cases: escaping/independently shifted weights must block the relevant rule, and a mutated merge with a missing rescale or dropped final tile must fail the exact check; use late-max/tail cases to test that the numerical oracle can catch those mutants independently. Stream rows of the *unmodified* reference as an evaluation strategy if needed, without changing their operation order.
- **Kernels:** compare (1) unfused lowering with materialized `s` and `e`, using competent tiled contractions where applicable, (2) the derived kernel, (3) a separately written streaming kernel under the same f32 precision policy. The streaming lowering assigns a CTA a query tile; keep query and running state on chip, tile K/V and score/weight scratch, predicate the tail, and write only final outputs. Use the same predeclared tile search budget for the streaming kernels and freeze choices on separate tuning cases; record chosen tiles and use the same inputs, layout, device residency and stream for all three paths. Record peak temporary global bytes and inspect allocations/code to verify absence of `N×N` temporaries in (2); measure spills separately.
- **Primary measurements:** CUDA-event median elapsed GPU time for the entire operator (all unfused launches included), and profiler DRAM read+write bytes per operator. Warm up with 20 calls, then collect 100 timed calls per variant and shape, interleave variants across rounds, and report median and IQR; repeat on a quiet, thermally stable GB10. Profile bytes in a separate run with documented cache/replay settings; also report global/L2 traffic if available to distinguish caching from eliminated requests. Fix and record device, driver/toolkit/profiler, power/clock conditions, flags and source revisions. Exclude allocation, transfers, compilation and profiler overhead from timing. Small/tail shapes are diagnostics, not primary performance gates.
- **Traffic model:** the compulsory input/output footprint is `Θ(ND)`, and the rewrite eliminates the `Θ(N²)` intermediate allocations and their materialization traffic. Total traffic is **not** generally `Θ(ND)` at a fixed on-chip tile size: with `B_r` query rows per CTA, logical K/V loads across CTAs can be `Θ(ceil(N/B_r) ND)` before cache reuse, and spilling can add more. Scores still take `Θ(N²D)` arithmetic. Measure rather than infer DRAM bytes from the footprint. If fusion reduces bytes but loses time, compare occupancy, registers/spills and instruction mix against the hand kernel before attributing the loss to the rule algebra.

## Later

- Integrate the Tix adapter and tuple fold with the parallel frontend and meaning contract once they land.
- Implement the rule validators and CUDA lowering, then run the protocol on GB10.
- Add denominator normalization for explicit softmax-then-contraction syntax.
- Derive and validate stable one-pass moment statistics for layernorm.
- Extend the domain to masking, empty rows, multiple heads, gradients and mixed precision.
- Prove uniform floating-point error bounds rather than relying on sampled acceptance.
- Explore broader search and GPU autotuning beyond the directed schedule and bounded tile sweep.
