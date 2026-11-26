---
Title: From materialized scores to a checked streaming fold
Ticket: IRWB-021-J
Status: review
Topics:
    - research
    - compiler
    - ir
    - verification
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Defines the seeded baseline and subject comparison and its sampled evidence.
    - Path: repo://src/framework/ir/rewrites.ts
      Note: Runs one directed rewrite and binds the host verification hook.
    - Path: repo://src/framework/ir/types.ts
      Note: Defines the provisional result and predecessor passed to the gate.
ExternalSources: []
Summary: Derivation, numerical contract, and GB10 experiment for single-head attention.
LastUpdated: 2026-11-26T13:02:31.553339792-05:00
WhatFor: ""
WhenToUse: ""
---

# From materialized scores to a checked streaming fold

A row of attention can be summarized by its largest score, its sum of weights, and its weighted sum of values. The useful compiler identity is that **changing the center of an exponential multiplies every weight in the same group by one scalar**. It applies to both sums, including every output coordinate. That identity supplies the combine operation for adjacent groups. The compiler need not recognize a function named `attention`.

The derivation below proves equality over the reals. It also specifies which edits preserve the Tix f32 evaluation exactly and how to test the others. The research question for GB10 is whether the resulting checked schedule actually saves traffic and time. No GPU measurement is claimed here.

## Source meaning and supported domain

Consider one row `i`. Let `J = [0,N)`, `x ∈ [0,D)`, and `t_j = sum(d) ((q[i,d] * k[j,d]) / sqrt(D))`. The source computes

```text
M    = max(j) t_j
w_j  = exp(t_j - M)
l    = sum(j) w_j
o[x] = sum(j) ((w_j * v[j,x]) / l)
```

Both divisions are **inside** their respective reductions. Keep the score expression and its increasing `d` order throughout. Moving its scale buys nothing needed for the derivation and would introduce a second numerical hypothesis.

For the attention experiment, the supported inputs are three dense f32 arrays of the same shape `[N,D]`, with integer `1 ≤ N ≤ 4096`, `1 ≤ D ≤ 128`, `|q|, |k| ≤ 4` and `|v| ≤ 1` elementwise. The arrays include signed zero and finite subnormal values. Rowwise shape checks and the bounds are premises of this contract. Over the reals, `|t_j| ≤ 16√D`. These bounds also leave ample f32 exponent range for all products and sums. Every nonempty group contains a maximal score with weight one, so its own-centered normalizer is at least one. We choose a bounded experiment because finite f32 inputs alone can overflow at the very first multiplication.

## The one IR extension

Use an **ordered fold with typed state**. Write `fold(j in I, empty, map(j), combine)` in the IR. The map and combine are pure expressions. State may contain a fixed tuple of f32 scalars and fixed-shape f32 vectors (here the existing shape name `D` sets vector length). A tagged empty state can stand beside a nonempty tuple. Construction, projection, the tag test and lexical `let` perform no arithmetic. A contiguous block is an index range with the same absolute indices as the source. These are internal forms, not new Tix source syntax.

The interpreter visits `I` in increasing order, starting with the specified identity and updating `a = combine(a,map(j))`. Nested folds spell out every grouping. With the empty tag, `combine(Empty,b) = b` and `combine(a,Empty) = a` by branch selection, without evaluating either rescaling expression. This avoids the indeterminate difference of two empty maxima. Standalone scalar `sum` and `max` retain their given initializers and order.

In f32, evaluate each component of `map` and `combine` using Tix's `Math.fround` of each literal, shape value, arithmetic operation and primitive result. Vector operations below are componentwise scalar expressions. In particular `a*u + b*v` has two rounded products and one rounded add. A block plan is part of the candidate IR and fixes the inner and outer fold orders. Associativity **over the reals** authorizes a proposed regrouping under R4. It grants no implicit parallel f32 reduction, atomic-update order, contraction to FMA, or choice of tree. A different tree is a different candidate to check.

A hard-coded attention operator would be simpler to lower, but would hide the argument for fusing the reductions. A general loop language would add mutation and loop invariants beyond the need here. An ordinary left fold suffices with a small table of real identity/associativity witnesses attached only when a rule needs them. No user assertion that an arbitrary combiner is associative is trusted.

## Six rules and their checks

Each rule below has a *local* proof obligation on the subgraph it replaces. Shapes, lexical binder identities, orders and use counts come from the actual IR. Free-index tests traverse definitions, so a different name for a dependent expression cannot satisfy an independence guard. All six also run the whole-return check against the same original program described below. “Exact f32” adds a bitwise predecessor/candidate check on the same cases. “Tolerance” permits f32 rounding differences only under the declared return relation.

**R1 · Substitute a pure producer at its uses.** For `A[p] = F(p)`, replace `A[u]` by capture-avoiding `F[p := u]` with the same shape, in-bounds index map and rounding points. Within a common scope, identical substituted evaluations may share a scalar or bounded tile `let` if all free indices are bound there. Remove a tensor definition only when no live use or return refers to it. Pointwise evaluation gives exactly the value stored at `u`, even when several consumers read it. Check binder substitution, operation-tree identity, type, scope and remaining uses. **Exact f32.** This rule changes where and when a pure value is computed. The tile binding gives the schedule a way to reuse scores without an allocation spanning all rows and columns.

**R2 · Move an invariant divisor outside a sum.** Rewrite `Σ_j (a_j/c)` to `(Σ_j a_j)/c`. Also admit the product spelling `Σ_j ((b_j/c)*v_j)` with `a_j = b_j*v_j`. Require scalar `c` independent of `j`, nonzero, and defined wherever the original is evaluated. Distributivity of multiplication by `1/c` proves both schemas over the reals. Here `c=l` has a syntactic positivity witness, a sum of nonnegative weights including `exp(M-M)=1`. Check that witness and the matched product/division tree. **Tolerance.** Per-term division rounds before accumulation in the original. With ten equal scores and all values one, the original f32 result is `1.0000001192092896` and the hoisted form gives `1`.

**R3 · Zip co-indexed sums.** Replace `(Σ_j f_j, Σ_j g_j[x] for x)` by one fold adding the tuple `(f_j, (g_j[x])_x)` to componentwise zero. Scalar-only or multiple fixed components use the same construction. Require the same ordered range and multiplicity, pure lane expressions, and a fixed set of coordinates independent of `j`. By induction on prefix length, each projection starts at the original zero and performs the same next addition to the same value. Check the domains, the component maps and the final projections. **Exact f32.** Interleaving independent coordinates preserves their individual rounding histories.

**R4 · Partition an ordered reduction.** For a positive integer tile size `B`, partition `J` into consecutive `C_b = [bB, min((b+1)B,N))`, for `0 ≤ b < ceil(N/B)`. Replace `fold_J` by a fold of folds over those ranges, using the same identity and combine and visiting increasing `b`, then increasing `j`. Other parameters of the original body stay fixed through the partition. Check disjoint ordered coverage, including the short last block, and instantiate a known identity and associativity proof. For addition this is `(a+b)+c=a+(b+c)`, componentwise for tuples. For max it is `max(max(a,b),c)=max(a,max(b,c))`. Concatenation and the identity prove the rewrite by induction. **Exact f32 for finite-score max, tolerance for sums.** The latter now round from zero inside each block before adding block totals.

**R5 · Change the center of a block's exponential weights.** Write `H_C(c) = Σ_{j∈C} exp(t_j-c) h_j`, with scalar or tuple-valued payload `h_j`. For a nonempty block with `m_C = max_{j∈C} t_j` and common `c ≥ m_C`, replace `H_C(c)` by `exp(m_C-c) H_C(m_C)`. Match the same scores and index map as the max, and a payload independent of the center (though it may depend on `i,j,x` or the score). A weight without an explicit payload denotes the mass component with payload one. The checker factors each lane using `exp(t-c) = exp(m_C-c) exp(t-m_C)` and distributes the common scalar through its sum. The guard keeps the scale at most one. **Tolerance.** Two rounded exponentials and a rounded rescaling of a block total replace many exponentials at the old center. Small weights or scales can underflow at different points.

**R6 · Carry the maximum and its weighted sums in one fold.** Match a list of pairs `(m_b,h_b)`, a reduction `M=max_b m_b` and `H=Σ_b exp(m_b-M) h_b` over that same list. Require finite `m_b`, fixed shape of `h_b`, both computable from the current block and outer inputs alone, and consumers expressible from the final projections. For a nonempty state use `(m,h)`. Synthesize the following combine by changing the center of *each* operand to their common maximum.

```text
(m,h) ⊗ (n,g) =
    let p = max(m,n)
    let a = exp(m-p), b = exp(n-p)
    (p, a*h + b*g)
```

The identity is the tagged `Empty`. For any nonempty list segment `A`, the asserted state is `S(A) = (m_A, Σ_{b∈A} exp(m_b-m_A) h_b)`. A singleton gives `(m_b,h_b)` since `exp(0)=1`. For adjacent nonempty segments `A,C`, apply the R5 factorization to each subsum at `p=max(m_A,m_C)` and add. The result is exactly `S(A ++ C)`. This proves the prefix invariant and associativity on reachable states: either parenthesization of three neighbors denotes the same concatenation. The two empty cases follow by identity. At the final block the projections equal the matched `M,H`. Check this singleton/concatenation witness against the emitted expression, including both scale factors on every lane. Nothing in the witness refers to dot products, tensor names or final division. **Tolerance.** A prefix can be rescaled and rounded repeatedly as maxima rise. Retaining a global maximum and visiting blocks twice would reuse R5 alone, but would not give the requested single pass.

## Derivation for the given program

Start at the returned reduction and follow its SSA producer references. Match modulo renaming of bound indices. R2 exposes a second sum over the same range as its divisor. R3 collects those sums, R4 introduces a block size from the schedule, and the maximum of the block maxima proves R5's `c ≥ m_C` guard by containment. R6 then has precisely the pair of reductions it accepts. The compiler supplies the six directed schemas and a tile size. The program supplies the score expression, payload and axes, without source annotations.

All rows follow the same trace.

1. **R1** exposes the row expressions above. Bind the score body `t_j` and the weight expression as local names for readability. Preserve both the division by `sqrt(D)` in each score term and the division by `l` in each output term.
2. **R2** on the output only gives `u[x] = Σ_j (w_j v[j,x])`, `o[x]=u[x]/l`. The two reductions for `l` and `u` now have the same additive form.
3. **R3** gives `(l,u) = H_J(M)` with payload `h_j = (1, v[j,:])`. This shorthand expands to `(w_j, (w_j*v[j,x])_x)`. The maximum still precedes the weights.
4. **R4**, first on max, then on the tuple sum, gives `m_b=max_{j∈C_b} t_j`, `M=max_b m_b`, `(l,u)=Σ_b H_{C_b}(M)`. In this revision each block still needs the full row's maximum.
5. **R5** on the block body gives `h_b=H_{C_b}(m_b)` and `(l,u)=Σ_b exp(m_b-M) h_b`. Now `(m_b,h_b)` can be computed without knowing the result for any other block.
6. **R6** replaces the last global max and weighted sum by `fold(b, Empty, (m_b,h_b), ⊗)`. **R1** places the score producer within its block and the weight producer at its consumers. Their last row-wide uses disappear. A bounded tile of scores lets the block compute its maximum and then its moments from the same dot products.

The resulting IR schedule, for each row `i`, is

```text
state = Empty
for C in consecutive blocks of j:
    t[j in C] = sum(d) ((q[i,d] * k[j,d]) / sqrt(D))
    n = max(j in C) t[j]
    g = sum_tuple(j in C) (let w = exp(t[j]-n) in (w, w*v[j,:]))
    state = state ⊗ (n,g)
(m,(l,u)) = state
o[i,:] = u/l
```

The loop is notation for the ordered fold. The running output `u` is an **unnormalized** numerator. Both `l` and `u` use the old-state scale, and both incoming moments use the new-block scale. Only the final projection divides. For a real-arithmetic example, use blocks of lengths two and one, scores `(0,0,log(2))` and scalar values `(0,1,1)`. The first summary is `(0,(2,1))`, the last is `(log(2),(1,1))`. The merge scales the old pair by one half, giving `(log(2),(2,1.5))` and output `0.75`. Direct weights at the global maximum are `(0.5,0.5,1)`.

## What a checked application establishes

Use a directed sequence of `applyOnce` applications. At each candidate, the verifier re-matches the named schema on the predecessor, instantiates its small proof with the captured bindings, reconstructs the expected right side, and checks that the diff consists only of that replacement and the declared use/projection edits. Alpha-renaming and explicit tuple projection are structural comparisons. R4's interval partition and R6's singleton/merge equations are finite templates for arbitrary legal extents. Record the rule/version, before and candidate revisions, index/shape substitution, side-condition witnesses and order/block plan. A matcher finding a subgraph or a pass declaring preservation proves none of these equations by itself.

Use the existing pre-publication `verify` hook. It receives the predecessor and a provisional result. Bind the **original parsed program** separately as the fixed baseline for the whole trace. The framework's `differential` invariant accepts side-specific evaluators and a comparison function and records seed, counts and counterexamples. A local probe on Node 24 passed all 38 existing tests in the two relevant modules, including host rejection and a differential invariant inside a transformation contract. This establishes the framework hooks. Tix supplies the domain-specific evaluator and relation as assumed in the brief. [Rewrite host](../../../../../../src/framework/ir/rewrites.ts) · [Differential checker](../../../../../../src/framework/contracts/differential.ts) · [Rewrite tests](../../../../../../tests/framework/ir-rewriting.test.mjs) · [Contract tests](../../../../../../tests/framework/ext-e5.test.mjs)

Use two numerical observations on the attention domain above.

- **Local exact steps.** Evaluate predecessor and candidate in f32 on the same cases. Compare returned shape and each f32 bit pattern, including signed zero, for R1, R3 and the max instance of R4. The local structural proof establishes exactness for these steps on the domain. The bit test exercises the implementation.
- **Every revision, including the source and the final GPU output.** Evaluate the original expression tree with the same f32 inputs widened to f64, double operations and functions, original parentheses and lexicographic reduction order, with no intermediate f32 rounding. Compare the candidate's returned f32 tensor to this fixed f64 result. Require identical shape, finite observations and, for every coordinate, `|candidate - ref| ≤ 2e-4 + 2e-4 * |ref|`. The absolute term matters near cancellation. These are proposed preregistered experiment settings, not a universal error bound or a claim about defaults in the parallel Tix work. Comparing neighbors alone could accumulate error because this relation is not transitive.

Run the reference and candidate on deterministic uniform samples in the supported ranges, plus directed rows. Include singleton axes, `B=1`, `B>N`, exact multiples, and `N=B±1`. Exercise tied maxima, a late jump, monotonically rising maxima, nearly tied scores, alternating-sign values with a near-zero result, signed zeros and subnormals. For a scale that rounds to zero, take `D=64`, all `q=4`, adjacent blocks with `k=-4` then `+4`. For an implementation control, remove the old scale on just the numerator, or omit the final partial block. Realize the three-score example with `N=3`, `D=1`, all `q=1`, `k=(0,0,f32(log(2)))`, `v=(0,1,1)` and `B=2`. A Node scalar probe gave `0.75` for the merge, `1` for the missing scale and `0.5` for the missing tail, against `0.7500000002380818` in f64. The gate must distinguish these. Reverse the block maxima in a second case to exercise scaling the incoming block. A failed instance should identify the first rule, case/seed, block plan, coordinate, reference, actual value and error. Require every scheduled case to finish and pass. Sampling tests a numerical claim; it supplies no proof that all f32 inputs satisfy the tolerance.

## How far the rules reach

| Program | What follows from the same schemas |
| --- | --- |
| Stable softmax followed by a linear contraction | Substitute the normalized weight. R2 covers `(w/l)*v`, R3 zips mass and weighted features, and R4–R6 stream them. The payload may have any fixed number of lanes independent of the center. |
| Stable log-sum-exp, `M + log(Σ_j exp(t_j-M))` | Use the scalar payload one. R4–R6 yield `(m,l)` and the finalizer is `m + log(l)`. The derivation starts with the displayed centered form. |
| Layernorm statistics written as `Σ_j x_j` and `Σ_j x_j²` | R3 computes both in one traversal. R4 can tile that fold. Means and the raw-moment variance formula can be evaluated after it. The centered formulation `Σ_j (x_j-mean)²` has no R5 exponential factorization; deriving Welford's recurrence needs another proof. Returning normalized elements also requires access to each input after the statistics are known. |
| Standalone softmax returning every probability | A row summary supplies the denominator, but `y[i,j]` still needs its own score after the last maximum is known. A prefix's final probabilities differ for two suffixes with different scores. Emitting the whole tensor needs retention or a second visit. |
| Nonlinear centered payload, e.g. `Σ_j tanh(t_j-M) v_j` | R5 requires a factor depending only on the two centers. At the local maximum `t=m_b`, `tanh(t-m_b)=0`. If a later block raises `M`, then `tanh(t-M)` is nonzero there. No scalar rescaling can recover that term. |

These are statements about real rewrite reach. A new workload needs its own numerical domain and tolerance evaluation. A visible second use of scores or weights also keeps that tensor live until R1 can substitute or eliminate that use.

## Experiment on GB10

**Hypothesis.** For single-head attention on each primary shape `N ∈ {2048,4096}, D ∈ {64,128}`, the six schemas derive the schedule from the given source, every prescribed check passes, and a single derived CUDA kernel uses at most 75% of the unfused pipeline's device-memory bytes and elapsed device time, and at most 120% of the hand-written streaming kernel's time. The primary measurements are paired median device time and off-chip read-plus-write bytes for a complete forward call. Thresholds are proposed decision criteria.

Compare three artifacts on the same GB10 with the same resident row-major inputs, output, f32 precision and math settings. (1) Lower the original statements directly, materializing `s` and `e` and retaining the source division placement. (2) Lower the accepted block fold. (3) Write the same block schedule independently in CUDA, including ordered score arithmetic, tail handling and final division. Use the same tile sizes for (2) and (3), initially 16 query rows by 32 keys, and comparable row/column tiling where applicable in (1). Grouping independent rows inside a tile shares loads without changing the per-row fold. Use strict scalar f32 for all three, disable contraction, fast math and flush-to-zero, and check actual device outputs against the f64 reference. This isolates derivation and fusion; mixed-precision tensor-core code would confound the comparison.

1. Freeze the domain, tolerance, tile and real-proof templates before timing. Use seeds 21, 22 and 23 for uniform cases per small shape, crossing `N ∈ {1,2,7,31,32,33,65}` with `D ∈ {1,7,64,128}`. Run the directed cases above and seed 21 on every primary shape. In addition to values, check the source-to-fold trace and the compiled allocation/launch report for one derived kernel and no global tensor indexed by both a query and a key. A profiler counter alone cannot establish this.
2. Preload and prefault all inputs, allocate scratch before timing, and synchronize after warmup. Record device, compiler, driver, math flags, shapes, tile plan, and cache protocol. Use CUDA events on one stream spanning **all** kernels in a call, including the unfused intermediates. Exclude compilation, transfer and profiling. Use 10 warmup calls per variant, then 50 paired trials per shape, rotating the three variants' order across trials. Before each call evict prior trial data with a disjoint buffer sweep sized by the copy probe, outside the timed and counted region. Allow cache reuse within the call. Report per-shape median paired time ratios and their interquartile ranges.
3. In separate counter runs, repeat the same calls and aggregate device-memory-controller read and write bytes across all constituent kernels. Identify the available GB10 counter(s), units and memory level with a device-to-device copy probe first. Increase the eviction buffer until cold-copy read and write counts stabilize near the copy payload in each direction. Match this cache protocol across variants and across timing and counter runs. Report per-variant read and write totals, median paired byte ratios across 10 repeats, and temporary global allocation sizes. If off-chip counters cannot be validated, report the bytes hypothesis as unmeasured alongside the timing protocol.

**Why measure bytes?** For f32, writing each dense `s` and `e` once represents `8N²` logical store bytes before reads. The derived schedule has `O(ND)` input/output footprint, `O(D)` carried state per row, and bounded local score scratch `O(Bq·B)` per tile of `Bq` queries and `B` keys. It still performs `Θ(N²D)` arithmetic. If each query tile streams all keys and values and cache supplies no inter-tile reuse, logical loads/stores of the main arrays are approximately `4[2ND + 2 ceil(N/Bq) ND]` bytes. Thus eliminating quadratic intermediates does **not** by itself imply `O(ND)` physical traffic for all cache sizes. The counter tests the hardware claim independently of the allocation proof.

Failure to derive from the plain program, any violated proof premise or out-of-tolerance required case, a surviving global score/weight matrix, or any measured ratio above its threshold on any primary shape refutes the stated joint hypothesis. Report which limb failed, including when the hand-written schedule is faster despite the same traffic reduction. Missing hardware or a missing validated counter leaves that measurement open.

## Later

- Connect the given Tix front end, typed IR adapter and f32/f64 evaluators when they land, so the proposed trace can run on Tix.
- Implement the fold, six schema checkers and directed tests, which are the small domain-specific additions needed to run this design.
- Once CUDA lowering and GB10 access are available, lower the accepted schedule and run the three-way comparison.
- Consider alternate reduction trees, mixed precision and tile tuning after the fixed-order f32 experiment has isolated fusion.
- Add centered-variance laws, masking/empty-row semantics or backward attention only under separately specified contracts.
