---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-D
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
    - Path: repo://src/framework/contracts/differential.ts
      Note: Sampled invariant with a domain-supplied comparison
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Transformation input and output acceptance
    - Path: repo://src/typed/passes.ts
      Note: Typed pins the original artifact at every optimization gate
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:40:09.639841503-05:00
WhatFor: ""
WhenToUse: ""
---

# Deriving streaming attention by checked rewrites

A directed sequence of five rules suffices over the reals. It exposes a normalized weighted sum, replaces the full-row softmax with a summary of each prefix, partitions the prefix computation into tiles, and sinks the score producer into each tile. The experiment tests whether those steps also hold within a fixed f32 tolerance and let the CUDA backend match the performance of hand-written streaming attention.

## Supported inputs

The first experiment covers the supplied dense, unmasked, single-head function with matching `q, k, v: f32[N,D]`, integer `1 ≤ N ≤ 4096`, and `D ∈ {1, 32, 64, 128}`. Each input is an already-rounded finite f32, with `|q|, |k| ≤ 2` and `|v| ≤ 1`. The output is the full `f32[N,D]` tensor. Positive extents give a nonempty reduction, and the bounds keep score, normalizer and numerator arithmetic away from overflow. Terms with small softmax weights can still underflow. These bounds define the experimental contract, and its sampled checks provide evidence within that domain.

The source score is `S(i,j) = sum(d) (q[i,d] * k[j,d] / sqrt(D))`: the division is inside the reduction. Keep that scalar expression and the ascending `d` loop throughout the derivation. The source output similarly sums the **divided terms**. Below, fix a row `i`, call its score `S_j`, and write `P_j` for a pure payload vector with components `v[j,x]`. The rules apply to a finite nonempty ordered index range and may capture outer row and shape bindings.

## Reduction IR

Add an internal structured fold `fold(j in J, identity, map(j), combine)`, with tuple construction and projection and a statically shaped f32 vector field. The identity and the pure, typed map and combine regions are explicit. Each region can capture immutable tensors and shape bindings. The IR also needs a scoped region for temporary tile values and an ordered outer fold over the tiles. The Tix grammar stays fixed. A tuple of separate scalar reductions would repeat or hide the shared maximum and rescaling. A structured fold exposes this dependence once and carries the whole row state. A dedicated attention operation would hide the algebra and would only recognize the whole attention pattern.

The ordinary fold is a left fold, starting from the identity and visiting the range in increasing order. The real interpretation uses exact arithmetic, and the f32 interpretation evaluates the named operations in their stated order using the core f32 rules, including rounding after each multiplication, subtraction, addition, division and exponential. Tuple construction, region boundaries, copies and projection introduce no arithmetic. A combine region is executable without an associativity assertion. A rule that changes the grouping must verify the particular real identity and pass the f32 gate. This experiment needs just the componentwise sum and the rebase combine below.

The rebase summary of a nonempty set of positions `A` is

```text
m_A = max(j in A) S_j
l_A = sum(j in A) exp(S_j - m_A)
u_A = sum(j in A) exp(S_j - m_A) * P_j
T(A) = (m_A, l_A, u_A)
```

Use a distinct empty tag as the identity. Combining with empty returns the other operand unchanged before doing arithmetic. A singleton maps to `(S_j, 1, P_j)`. To combine two nonempty states `(m_a,l_a,u_a)` and `(m_b,l_b,u_b)`, compute

```text
m = max(m_a, m_b)
a = exp(m_a - m)
b = exp(m_b - m)
l = (a * l_a) + (b * l_b)
u[x] = (a * u_a[x]) + (b * u_b[x])
return (m, l, u)
```

This also specifies the f32 operation boundaries. An empty tag avoids evaluating the subtraction of two infinite sentinels. The first tile may be short, and the last tile uses just its live positions. No synthetic scores participate.

## Directed derivation

Run the following rules in order. Every exact argument is a template with explicit binding and range checks. Each matcher only needs the defining expressions, scopes, uses and domain facts mentioned in its rule.

1. **Factor the normalizer.** Match `sum(j) (W_j * P_j[x] / L)` and replace it with `(sum(j) W_j * P_j[x]) / L`, where the parenthesized sum ends before the division. Require `L` to be free of `j` and nonzero, with the sum over the same finite range. Here `L = sum(j) exp(S_j - max_k S_k)` is at least one because a maximum is attained. Distributivity of multiplication by the constant `1/L` proves the real identity. The f32 program trades one rounded division per term for a rounded division after a differently scaled accumulation. Check the rule schema and compare the result with the original f64 program. For three equal scores and values `[1, 1, f32(0.09)]`, the f32 outputs are approximately `0.69666672` before and `0.69666666` after.

2. **Zip the sums.** Replace the normalizer and numerator sums with `(L,U) = fold(j, (0,0), (W_j, W_j * P_j), componentwiseAdd)` and return `U[x]/L`. Require the same ordered range, zero initializers, independent sums, pure terms and no change to the body expression in any component. The projection of each prefix equals the original scalar prefix by induction on its length. This also proves bitwise f32 preservation against the immediate predecessor because each component has the same operations and order, including the zero initialization. Run the common f64 gate as well.

3. **Replace the global shift with a prefix summary.** Match the zipped fold with `W_j = exp(S_j - M)` and `M = max(j) S_j` over the same range and score expression. The shift must be common to both fields and the payload must be independent of it. Replace the fold with `fold(j, empty, (S_j,1,P_j), rebase)` and keep the `u/l` projection. In the degenerate form with no weighted payload, the same rule matches a single denominator sum and produces only `(m,l)`. Other users of the old global intermediates preclude this instance, except for direct users of `M` or `L` that can be redirected to the corresponding final projection. Each term expressed at `m_a` becomes a term expressed at `m` by multiplication by `exp(m_a-m)`, since `exp(S_j-m_a) * exp(m_a-m) = exp(S_j-m)`. This applies to every term of both sums. Thus `rebase(T(A),T(B)) = T(A ∪ B)` for disjoint sets, and both groupings of three disjoint sets summarize their union. At the end the shift is exactly the original global maximum over the reals. The checker instantiates this identity using the actual maximum, shared weight and payload bindings. In f32, multiple rounded exponentials and multiplies replace one rounded exponential for some terms, and previous sums are rescaled and rounded when the max changes. Tiny factors or contributions can underflow. Run the f64 gate.

4. **Fold consecutive tiles.** Partition the range at constant width `B > 0` into `J_t = [tB, min((t+1)B,N))` for `0 ≤ t < ceil(N/B)`. Replace the singleton fold with `fold(t, empty, blockSummary(J_t), rebase)`. Here `blockSummary` computes `T(J_t)` directly with a tile max, rounded exponentials shifted to that max, and ascending local sums starting at zero. Check by construction that the blocks are ordered, nonempty, disjoint and exhaustive, that local index substitution preserves the score and payload, and that the combine is the rebase schema. The direct tile summary is the same real summary that the singleton fold computes on that tile by Rule 3. Repeated union gives the full summary. In f32, local sums start anew, rounds occur at different points, and a block uses direct local weights in place of repeated prefix rescaling. Check against the original f64 program. This form gives the backend a bounded local tile to parallelize and a single ordered fold between tiles.

5. **Sink tile producers.** Substitute the pure score definition at the tile's score uses with hygienic index substitution and bind it once per live tile position inside the tile region. Keep the corresponding shifted weight there as a local value. Require same indices, types, operations and reduction order, and verify by use counts that the obsolete global score, weight and maximum definitions have no surviving users before dropping them. Substitution of a pure definition at the same bindings gives the same value, and dropping unused definitions leaves the observation unchanged. The f32 result is bitwise identical to Rule 4 when values and scalar operation order are preserved. Run the common f64 gate as well.

The resulting row program is

```text
for each output row i:
  acc = empty
  for each tile J_t in order:
    z[j] = sum(d) (q[i,d] * k[j,d] / sqrt(D)) for j in J_t
    m_tile = max(j in J_t) z[j]
    w[j] = exp(z[j] - m_tile) for j in J_t
    l_tile = sum(j in J_t) w[j]
    u_tile[x] = sum(j in J_t) (w[j] * v[j,x])
    acc = rebase(acc, (m_tile, l_tile, u_tile))
  output[i,x] = acc.u[x] / acc.l
```

The outer state and a bounded tile are live per row. Each score is computed once per `(i,j)`. A row tile can reuse K/V loads across several query rows. On the supported domain the denominator also stays at least one in f32. Each block contains a term with weight one, and each rebase retains a factor of one on a state whose maximum is the merged maximum.

## Acceptance in the workbench

Use one versioned domain invariant to check the instantiated rule template against the immediate input and proposed output. For each rule inspect the bindings, positive extent/domain requirements, projections and actual edits. In particular verify that the surrounding region and score computation are unchanged except for the specified substitution. These are structural checks of instances of the exact arguments above. A report that only names a rule supplies no such evidence.

Use a second invariant for numeric acceptance. Pin the unmodified source revision as `origin`. Evaluate it with f64 arithmetic at every operator, retaining source grouping, reduction order and division placement and widening the same f32 input values. Compare the candidate evaluated with the f32 semantics to this reference on one common case set. The observation is output shape and all returned values in index order. Require shape equality, finite outputs, and for every component

```text
abs(candidate - reference) <= 3e-4 + 3e-4 * abs(reference)
```

This is a proposed fixed experimental budget. Record the original f32 result against the same bound as a control. Every step uses the full original-reference check, including the steps that preserve the predecessor bitwise. Comparing adjacent tolerant revisions would permit drift. Report signed-zero distinctions in the immediate bitwise check for Rules 2 and 5. The real proofs apply to all instances satisfying their premises. Numerical acceptance is a sampled relation to the f64 reference, without a universal f32 error bound.

The worktree already has a `differential()` invariant with independent baseline and subject runs and a domain-supplied comparator. A Node 24 probe calling it through `AnalysisManager.checkInvariant` accepted 1.125 and rejected 1.5 relative to 1 under an absolute budget of 0.25. `defineTransformation` and `applyPass` can gate each directed edit with the immediate input, origin and candidate as separate ports, as the Typed optimizer does for its original-program check. Use one pass per rule for the fixed sequence. A saturating search adds choices the experiment does not require. The missing Tix-specific piece at this interface is a rule-instance checker, plus the domain IR, evaluators and concrete invariant. [Differential invariant](../../../../../../src/framework/contracts/differential.ts), [pass API](../../../../../../src/framework/passes/define-pass.ts), [Typed optimization contract](../../../../../../src/typed/passes.ts).

Use 64 seeded random small cases with `N ≤ 129`, plus deterministic cases for `N = 1, B-1, B, B+1, 2B+1` for each candidate tile width `B ∈ {32, 64, 128}` and supported `D`. Include tied scores, a new maximum in each tile, an early dominant maximum, alternating-sign values, and saturated scores with tiny weights. Make partition and rebase checks fail on deliberate edits such as dropping a tail position and rescaling just `l`. Record rule version, input and output revisions, shape, seed or fixture, budget version, and first failing output index and values. Require a decision for every scheduled case. For generated CUDA, apply the same reference comparison to the returned device tensor. Parallel trees in tile reductions and CUDA elementary math can change rounding further. Keep score ordering and per-term division fixed, disable multiply-add contraction in the score loop, and use f32 throughout for the experiment.

## Generality

| Program | Reach of these rules |
| --- | --- |
| Stable softmax followed by a contraction with a pure value payload | Reached when the weights share exactly the maximum and normalization and only the contraction is observed. The same summary works with multiple payload columns. |
| Stable log-sum-exp, `M + log(sum(j) exp(S_j-M))` | Reached by specializing the summary to `(m,l)` and retaining the `m + log(l)` finalizer. With no numerator, factoring and zipping are unnecessary. Its tolerance requires a separate contract. |
| Layernorm statistics | The same fold construct can carry `(count,mean,M2)`, but the rebase rule only proves exponential shifts. A centered-variance program needs a separate moment-combine identity. Applying layernorm to all positions still needs the elements after the statistics are known. |
| Standalone softmax or attention that also returns its weights | The summary can compute the denominator, but the caller observes every score-dependent weight. This schedule cannot finalize those weights before the row summary is complete. It would need storage or another traversal. |
| Causal masking with empty rows, or arbitrary score/payload expressions with additional cross-row dependencies | The matcher requires a dense nonempty shared range and a pure payload available at each position. Mask-specific domains or dependencies outside the tile need their own legality arguments. |

## GB10 experiment

**Hypothesis.** From the plain Tix function, a fixed sequence of checked rule applications emits a single streaming f32 CUDA kernel that meets the fixed error budget and beats a materializing lowering, while approaching an independently hand-written streaming kernel. Treat a fused attention library call or a special-case handwritten replacement in the compiler as a failed derivation.

At `N ∈ {2048,4096}` with `D=64`, require all five rules to apply and pass their checks and require the CUDA outputs to pass on the device cases. Use identical seeded inputs across variants, check at least one seeded and one structured input per primary shape, and measure the following variants on one GB10 with fixed build settings:

- The unfused lowering of the original Tix, including materialized score and exponential tensors and all stage launches.
- The derived row-tiled kernel, with tile-local scores and weights and an ordered tile fold.
- An independent hand-written streaming kernel with the same f32 input, output and score arithmetic constraints and the same correctness gate.

The primary metric is median elapsed GPU time for the full device computation, with device DRAM read plus write bytes as a co-measurement of the memory claim. Warm up 20 times, time 100 runs with same-stream CUDA events, report median and interquartile range, and collect hardware-counter traffic in separate profiling runs. Keep inputs and outputs device-resident during timing, and report tile widths, launch geometry, toolchain and device. Freeze tile choices and arithmetic constraints before collecting the primary results. Check generated allocations and global stores for the absence of `N×N` buffers. Include `N=512` and `D=32,128` as secondary runs to see where launch overhead or state size changes the trade-off.

Prespecify success at **both** primary shapes as derived time ≤ 75% of unfused time, derived DRAM bytes ≤ 75% of unfused bytes, and derived time ≤ 125% of hand-written streaming time. A rejected rule, correctness failure, square intermediate, or missed threshold at either shape refutes the corresponding part of the hypothesis. If the hand-written control misses correctness, the performance comparison is invalid and the control must be repaired with the budget held fixed.

These rules remove square intermediate allocation and round trips. Total DRAM traffic also depends on K/V reuse. With `R` query rows per block, one K/V sweep per row block can request `O(ceil(N/R) · N · D)` elements before cache reuse, plus the `O(ND)` Q/output traffic. Near-linear measured traffic is possible with sufficient reuse. The experiment measures it instead of assuming that streaming state alone guarantees it.

## Later

- Connect the Tix front end, structured-fold evaluator and rule guards when the domain IR and reference evaluator land. Add the internal fold and tile region to the domain IR.
- Implement the tiled CUDA lowering, profiling harness and hand-written CUDA control when the backend is available.
- Extend the domain and rules for masks, empty rows, and centered-moment statistics after the dense result.
- Explore schedule search and universal f32 error bounds after testing the fixed derivation.
