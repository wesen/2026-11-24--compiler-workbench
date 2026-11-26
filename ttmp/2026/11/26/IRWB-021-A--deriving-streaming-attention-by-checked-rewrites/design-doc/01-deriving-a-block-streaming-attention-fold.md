---
Title: Deriving a block-streaming attention fold
Ticket: IRWB-021-A
Status: complete
Topics:
    - compiler
    - ir
    - verification
    - performance
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/conformance/03-strategy-contracts.ts
      Note: Runnable example of semantic edit acceptance and rejection
    - Path: repo://src/framework/contracts/differential.ts
      Note: Side-specific evaluations and sampled comparison against the origin
    - Path: repo://src/framework/ir/rewrites.ts
      Note: Directed rule application and per-edit verify hook
ExternalSources: []
Summary: Six local rewrite laws derive an ordered product fold with real proofs, sampled f32 acceptance and a GB10 measurement protocol.
LastUpdated: 2026-11-26T12:40:18.126398792-05:00
WhatFor: Review the derivation, guard conditions and proposed experiment.
WhenToUse: Before implementing or evaluating the Tix streaming-attention rewrite sequence.
---

# Deriving a block-streaming attention fold

**Yes over the reals.** The quantity that composes is the pair of sums *expressed at a common score maximum*. One sum counts exponential weight, the other counts exponential-weighted value. A block can compute both at its own maximum, then convert them to the maximum of any larger block with one scale factor. This gives a compiler a local reason to discard past scores. Whether the resulting f32 program meets a particular error budget and beats the materializing GPU program are separate, falsifiable questions.

## Start with the parsed program

Fix a query row `i`. The following names abbreviate pure expressions. A capital sigma encloses its entire body in parentheses. Arithmetic in the derivation is real unless labeled f32.

```text
J = [0,N)
a(j) = Σ_d ((q[i,d] * k[j,d]) / sqrt(D))
M    = max_j a(j)
w(j) = exp(a(j) - M)
L    = Σ_j (w(j))
o(x) = Σ_j ((w(j) * v[j,x]) / L)
```

Both divisions in the source occur **inside** reductions. Keep the multiply, divide and increasing-`d` sum for `a(j)` exactly as parsed. Moving the score scaling to the end of a dot product would be a separate numerical change. The derivation moves only the output division.

**Supported research domain.** One dense head, common integer extents `1 ≤ N ≤ 4096` and `1 ≤ D ≤ 128`, inputs of the declared shapes, every entry a finite f32 in `[-4,4]`. These are proposed experiment bounds. They allow ties, signed zeros, cancellation, subnormals and exponential underflow. They keep the dot products and weighted sums far from overflow. At either a row or a nonempty block maximum, one exponential is 1. The exact normalizer is at least 1 and each f32 block or merged state also retains a contribution of at least 1 from the side attaining its maximum. This supplies the nonzero-divisor guard. Larger finite inputs can overflow an f32 product.

## One IR addition

Use an internal, typed **ordered fold**. In the notation below a range is a half-open index domain, `map` is a pure value expression under its index binder, and `combine` is a closed, pure expression with two bound state operands. Both produce the same state type as `init`. A state can be a scalar, a fixed-shape row vector (extent bound by the call), or a product of these with field projections. An optional state has a distinct `Empty` tag. The match on tags evaluates only the selected branch. Shapes, indices and tags are exact control data.

```text
fold(range, init, map, combine)
    acc = init
    for index in range, in the specified order
        acc = combine(acc, map(index))
    yield acc
```

The range may enumerate consecutive blocks in increasing start order, or the valid indices within one block in increasing index order. Tuple construction and projection copy values. Vector arithmetic abbreviates the same scalar operation on each component. In f32 mode round every numeric literal, numeric shape value, arithmetic operation, elementary function and reduction step as in core Tix. Preserve the written expression tree, including separate multiplies and adds. Starting from `Empty` returns the first mapped state by selection. Folding an empty range yields the initializer. The real interpretation uses the identical control flow with real arithmetic. No user-supplied associativity assertion changes execution order. Selecting a different tree or tile size changes the candidate, with its own checks.

An ordered product fold is enough for this experiment. Separate built-in scalar reductions express the source but cannot feed a newly computed maximum into the next step's two accumulators. A dedicated attention instruction could hide this dependence and would leave no reusable rewrite to test on log-sum-exp. A general parallel reducer with an unspecified tree would leave the f32 reference for a given candidate ambiguous.

## Six checked rules, applied in order

For each application the exact check instantiates the stated real lemma and verifies its syntactic and domain guards. **Exact f32** below adds a bitwise check against the immediate predecessor on the test inputs. **Tolerance** tests the entire new candidate against the original f64 program, as specified below. Every candidate, including exact-f32 steps, takes the origin check.

### R1. Inline a pure indexed producer

Rewrite a read `T[u] where T[t] = E(t)` to capture-avoiding `E(t := u)`. Substitute matching indices with proven equal extents and in-bounds reads, alpha-rename nested reduction binders, retain their ranges, order and rounding points, and delete a definition only after its last use is gone. Apply at the uses of `s,m,e,l`, retaining repeated expressions as shared let-bindings. This gives the five row expressions above. A let here denotes sharing within its scope, without requiring a tensor allocation.

**Argument and check.** Single assignment and purity make the substituted element the same value at each read. Sharing or recomputation evaluates identical operand trees. Verify the binder map, use edges and complete replacement tree. Exact f32 and tolerance.

### R2. Move a common divisor past a sum

Rewrite `Σ_j (t(j)/h)` to `(Σ_j t(j))/h`. Also admit `Σ_j ((p(j)/h)*z(j))` with `t(j)=p(j)*z(j)`, using the real product law. The extent must be unchanged, `h` independent of `j`, finite and nonzero on the domain. For this row, `h=L`. Its internal, separately bound summation index is not a free occurrence of the outer `j`.

```text
U(x) = Σ_j (w(j) * v[j,x])
o(x) = U(x) / L
```

**Argument and check.** Multiply each summand by the common scalar `1/h` and use distributivity over the finite sum. Check free variables by binder identity and discharge the divisor guard with the positive-normalizer lemma. Tolerance. The source rounds one division per term and adds the rounded quotients. The candidate rounds the numerator sum and divides once. For three equal scores and values [1,1,3], Node 24 gives 1.6666667461395264 before this rule and 1.6666666269302368 after it.

### R3. Zip sums over the same range

Rewrite `(Σ_j f(j), Σ_j g(j))` to one ordered sum of `(f(j),g(j))` with zero in each lane and componentwise addition. A family `g(j,x)` supplies one lane per free `x`. Require identical reduction ranges and order, compatible lane shapes, and bodies independent of the other accumulators. Retain a common subexpression only when its bound operands agree.

Write `p(j)=(1,v[j,:])`, and define the following abbreviation for a shifted tuple sum.

```text
F(R,t) = Σ_{j in R} (exp(a(j)-t) * p(j))
(L,U)  = F(J,M)
o(:)   = U / L
```

The weight lane is just the exponential. Multiplication by 1 is exact here. More generally the payload may have any fixed set of lanes independent of the shift `t`.

**Argument and check.** After each prefix, projecting lane `k` gives the old sum through that prefix, by the zero initializer and componentwise step. Verify the projections, lane expressions, initializers and traversal. Exact f32 and tolerance. The induction preserves each lane's rounded addition sequence even though instructions from distinct lanes may interleave.

### R4. Partition a reduction into consecutive blocks

For a positive integer block width `B`, take blocks `b=[h,min(h+B,N))` for starts `h=0,B,2B,… < N`. Rewrite `reduce_J f` to the same reduction over `reduce_b f` for each block. Admit only max with its max identity (−∞), or componentwise sum with zero. Require a disjoint, order-preserving cover with the original index map, including the short last block. The same block partition is chosen for both occurrences below.

```text
m_b   = max_{j in b} a(j)
M     = max_b m_b
(L,U) = Σ_b F(b,M)
```

**Argument and check.** Concatenating blocks recovers the input sequence. Associativity of real max or addition with its identity gives the nested reduction. Check that both loops visit precisely the indices in the original range and initialize each partial reduction with its operator's identity. Finite max introduces no new numerical error. Grouped f32 addition restarts at zero per block and rounds partial sums in a new order. Tolerance. At this point every weighted block still requires the maximum of the *whole* row.

### R5. Rebase an exponential sum at a block maximum

Rewrite `F(b,M)` to `exp(m_b-M) * F(b,m_b)`. Match the actual subtraction under the exponential and the score producer captured by the block max. Require a nonempty block, finite anchors, and payload independent of the anchor. Both anchors are constant within this sum. The row-max construction proves `m_b ≤ M`, so the new rescaling exponent is nonpositive.

```text
H_b   = (m_b, F(b,m_b))
M     = max_b H_b.m
(L,U) = Σ_b (exp(H_b.m-M) * H_b.F)
```

**Argument and check.** For each term, `a(j)-M = (a(j)-m_b)+(m_b-M)`. The exponential addition law and distributivity pull the second exponential out of every lane. Verify exact matches of the score, block, anchors, and independent payload. Tolerance. Two rounded exponential evaluations, subtractions and an outer multiply replace a single shifted exponential per term. A tiny weight can underflow before or after scaling. The successor graph now uses only a local summary from each block, but still visits summaries twice.

### R6. Fold summaries at a common maximum

Match the pair `(max_b m_b, Σ_b (exp(m_b-M)*z_b))` where `M` is exactly that max and each `(m_b,z_b)` is available from block `b` independently of any other block. Replace it with the ordered fold of these pairs using the merge below. Redirect projections of the matched results. Fuse a block producer into the fold's map only when its uses are accounted for. For a one-pass result require that no other live consumer needs individual scores, weights or block summaries. R1 supplies producer substitution and dead-definition removal at this boundary.

```text
merge(Empty, H) = H
merge(H, Empty) = H
merge((m,z), (n,y)) =
    c = max(m,n)
    α = exp(m-c)
    β = exp(n-c)
    yield (c, α*z + β*y)
```

**Argument and check.** On a nonempty sequence of pairs `P`, let `c_P=max m_b` and `Z_P=Σ_{b in P} exp(m_b-c_P)*z_b`. For adjacent nonempty `P,Q`, the max on their concatenation is `c=max(c_P,c_Q)`. Multiplying `Z_P` by `exp(c_P-c)` converts every term to shift `c` by the exponential addition law. Doing the same for `Q` and adding gives exactly `Z_(P++Q)`. Empty is the identity by selection. A singleton's weight is `exp(0)=1`. Thus each merge returns the summary of the concatenation, proving the prefix invariant and associativity over the reals, including vector lanes. The checker instantiates this one lemma, checks the max and sum bind the same blocks, verifies both rescaling factors and lane maps, and verifies the identity branches. No proof search over a whole attention program is needed.

**f32 check.** Tolerance. R5's candidate scales each `z_b` directly to the final maximum. R6 can rescale an already rounded prefix repeatedly as new maxima arrive. Even with equal maxima, association of sums matters across possible fold trees. Comparing only adjacent revisions could accumulate undetected drift.

For a concrete two-block trace, take scores `[0,0 | 1]` and one value lane `[1,3 | -1]`. The local states `(m,L,U)` are `(0,2,4)` and `(1,1,-1)`. The merge gives `(1, 2*exp(-1)+1, 4*exp(-1)-1)`. Taking the ratio `U/L` gives exactly the weighted average evaluated at the full row maximum. Omitting the prefix scale on either sum changes this example.

## The resulting loop and its traffic

```text
for each query row i
    H = Empty
    for b in consecutive blocks of J
        score[j in b] = Σ_d ((q[i,d] * k[j,d]) / sqrt(D))
        n = max_{j in b} score[j]
        z = ordered tuple sum over j in b of
                let w = exp(score[j]-n) in (w, w*v[j,:])
        H = merge(H, (n,z))
    o[i,:] = H.U / H.L
```

Here `H.z=(H.L,H.U)` in the nonempty branch. A query tile of `R` rows executes this same loop for each of its rows while sharing the current K,V tile. Keep Q and the running `(m,L,U[:])` on chip, compute scores once for the current tile, consume them there, and write O once. A tail block uses valid lanes only. The loop carries an unnormalized output numerator, so a change in maximum rescales the numerator and normalizer together. Rescaling a *normalized* mean by the same formula would be wrong.

The eliminated global intermediates account for Θ(N²) entries. Dense inputs and output occupy Θ(ND) entries. **Total DRAM traffic is a measurement.** With no inter-tile cache reuse, loading K,V afresh for each of `ceil(N/R)` query tiles costs about `8*N*D*ceil(N/R)` bytes, in addition to about `8*N*D` for reading Q and writing O (f32). Local storage is on the order of `RD + BD + RB` words. Actual traffic depends on tiling, cache reuse and spills. Θ(ND) describes compulsory tensor traffic under ideal reuse. Dense score and contraction arithmetic still scale as Θ(N²D).

## What a passing rewrite means

Use a deterministic, directed sequence so that a trace identifies the first failed rule. At each site, record the rule version, before/after revisions, captured definitions, alpha-renaming, range and shape bindings, the lemma and its discharged guards, and the chosen block width/order. The exact verifier reads both revisions to reconstruct the expected right-hand side from the captured left-hand side, compare modulo fresh binders and explicit let sharing, and verify that edits outside the replacement are limited to its use redirections and now-dead producers. A matcher declaring its own replacement valid would miss, for example, a merge that scales `L` correctly but omits the same factor on `U`. A fixed library of the six real identities suffices. Arbitrary user-written combines would require a new law.

| Check | Domain and observation | Acceptance |
| --- | --- | --- |
| Local algebra | Every input in the declared domain. The matched value, including any live projections. | Match a proved real schema, prove its side conditions, and replay the proposed edit. |
| Local f32 for R1 and R3 | Identical concrete cases, predecessor and candidate both evaluated in f32. Returned tensor shape and f32 element bits. | Equal shape and bits, including signed zeros. The structural argument explains why this holds beyond the cases. |
| Origin contract for every revision and each GPU variant | The declared domain. Original source evaluated in f64 on the exact f32 inputs, preserving its parsed operations and lexicographic reductions. Subject evaluated in f32. Observe only the returned tensor, in index order. | Identical shapes, all elements finite, and for **every** element `abs(y-r) ≤ 1e-4 + 2e-4*abs(r)`, with `r` the original f64 element. |

The numerical thresholds are proposed research settings, fixed before runs. First check the unmodified source in f32 against the same origin and relation. A failing source case challenges the baseline contract for this domain. Keep it in the results and distinguish it from the first failing transformed revision. Absolute slack handles cancellation near zero. Relative slack scales with output magnitude. The f64 reference also rounds. A passing corpus supports the numerical claim only for the sampled executions. The exact local proof and sampled numerical check answer different questions.

The worktree already has `rewrite`, `applyOnce` and a transactional per-edit `verify` hook. Use that hook with the immediate predecessor, the proposed revision and a fixed origin captured for the entire sequence. Bind the original artifact as the differential baseline and the candidate as the subject. The existing `differential` API supplies side-specific `run`, custom `compare`, seeded cases and counterexamples. Keep the corpus identical across revisions. Require every planned case to be decided for this experiment. Inspect counts because the generic checker can accept a mixture of agreements and inconclusive cases. Save the first failing row/column, seed or explicit input, source f32, reference f64, candidate value, tolerance and revision. Use the existing conformance example as the model for preparing an edit before publication. The small domain-specific addition is a verifier for these six templates and their binders/guards, alongside the ordered-fold node and its evaluator. A generic symbolic algebra engine is unnecessary. [Directed rewrites](../../../../../../src/framework/ir/rewrites.ts) · [Edit acceptance example](../../../../../../src/conformance/03-strategy-contracts.ts) · [Differential checker](../../../../../../src/framework/contracts/differential.ts)

Use deterministic small cases with `N=1`, `B=1`, `B>N`, and `N=B-1,B,B+1,2B+1` for `B=8`. Vary `D` including 1 and 128. Across these shapes use zeros, equal maxima split across blocks, an early peak, strictly rising block maxima, opposite-signed V that nearly cancels, and subnormal V. With `D=128`, constant query components of 4 and key rows of all +4 or −4 create a score gap large enough to underflow f32 exponentials. Add bounded pseudorandom tensors for seeds 21 through 52 and an independently held-out range 53 through 68. Report the maximum normalized error `abs(y-r)/(1e-4+2e-4*abs(r))` at each revision. Include all timed shapes in the origin check. As negative controls try a divisor using the bound index, a partition that drops the last key, and a merge that omits the prefix scale on the value lanes. The exact verifier must reject all three. A late large score with different early and late values should also expose the last mutation numerically.

## Reach of the rules

| Program | What the derivation does |
| --- | --- |
| Stable softmax followed only by a weighted contraction | R1 inlines the weights. The product variant of R2 exposes the common denominator. R3–R6 carry one numerator lane per contracted feature. Query/key dot products are incidental. A different pure score producer with the same guards also works. |
| Stable log-sum-exp, written `M + log(Σ_j exp(a(j)-M))` | Use the single weight lane of R4–R6, return `H.m + log(H.L)`. There is no numerator or output division. The rule set need not discover stabilization of an initially unshifted expression. |
| Raw layernorm statistics `Σ x` and `Σ (x*x)` | R3 and R4 compute both sums in one pass. The count comes from the extent. Any raw-moment variance already present can be finalized after the fold. Rewriting the centered two-pass variance to raw moments or Welford requires another identity and its own cancellation analysis. Producing normalized elements still needs access to each input after the statistics are known. |
| Returning the softmax matrix itself or also consuming its weights elsewhere | The outputs need individual weights at the final normalizer. A fixed-size summary cannot reconstruct them all. The use check prevents deleting that producer. Materialization or another pass would be needed. |
| Weights `tanh(a-M)`, or a payload that depends on the row maximum | R5 lacks a shift-independent scalar factor, or the proposed `p(j)` changes when rebased. A tuple reduction alone offers no proof for R6. |

## GB10 experiment and decision

**Hypothesis.** The six rules will derive the loop from the submitted source, without a function-name match or a hand-selected attention kernel. On a GB10, for each primary shape `(N,D)=(1024,64),(2048,64),(4096,64)`, the derived kernel will pass the above checks, use no global score/weight matrix, take at most **80% of unfused time** and at most **125% of hand-written streaming time**, and move fewer measured DRAM bytes than the unfused program. All thresholds are fixed before measurement.

1. Compile the **unfused** source with all five named stages materialized as written. Compile the **derived** artifact by lowering only its explicit maps, folds and tile-local values. Run an independently **hand-written** tiled streaming CUDA kernel with the same score grouping, types and output layout. Save the automatic rule trace and lowered buffer shapes. Check that there is no global `[N,N]` scratch, including equivalently sized flattened allocations. An opaque dispatch to the hand-written kernel would not test derivation.
2. Use identical resident dense row-major f32 inputs, compiler/toolchain, GPU and math settings for all three. Preserve separate multiplies and adds, gradual underflow, division and square-root precision. Disable fast math, contraction, TF32 and mixed precision. Check actual GPU outputs against the origin too, since CUDA elementary functions can differ from JavaScript even at the same type. Permit comparable launch/block tuning on separate calibration inputs. Record query/key tile sizes, per-lane reduction trees, register/shared memory use, spills, compiler flags, driver and device. Any arithmetic regrouping chosen for lowering has to be represented and checked as a new candidate. Keep the increasing-`d` score accumulation for this experiment.
3. Measure median **GPU elapsed time** in milliseconds via events spanning the entire sequence from first kernel to last, per variant and shape. Preallocate buffers and exclude compilation, allocation and host transfers. Warm up each variant with 10 calls, then time 50 calls each in interleaved, seeded order on the same stream. Report medians, interquartile ranges and ratios. Use the same input sequence and cache protocol across variants. Measure bytes separately with a GB10-supported profiler's DRAM read and write byte counters, summed over all launches for one invocation under matched cache conditions. Record actual counter names, units and profiler replay/cache policy. Report read and write counts separately, their sum, and peak global temporary bytes. Allocation sizes and modeled loads are not measurements of DRAM traffic.
4. Report one row per shape and variant with time, bytes and maximum normalized error. Add a tail case `(1025,64)` and small correctness shapes without imposing the throughput targets on them. A missing counter leaves the traffic claim undecided. A missing rule application, nonlocal semantic shortcut, accepted bad proof, out-of-tolerance result, global score/weight allocation, or any missed primary time/byte target refutes its corresponding claim. A fast kernel with a failed check does not support the hypothesis. Conversely, a correct derivation with excess K,V reloads establishes the algebraic result while failing the performance test.

## Later

- Integrate the supplied Tix parser, typed IR, f32/f64 evaluators and meaning contract when available. This worktree supplies the check hooks.
- Add the product fold and six template checks to that IR, then run the derivation and negative controls.
- Lower the checked schedule to CUDA and collect the three-way GB10 measurements.
- Consider masks with empty rows, backward passes and mixed precision separately because they change the state domain or numerical contract.
- Consider Welford, other shift laws and universal f32 error bounds separately because each needs additional proof machinery.
