---
Title: From three row reductions to streaming attention
Ticket: IRWB-021-C
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Seeded comparison and inconclusive case accounting
    - Path: repo://src/framework/contracts/types.ts
      Note: Invariant and transformation interfaces
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Pass contract and origin input
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:40:12.196946464-05:00
WhatFor: ""
WhenToUse: ""
---

# From three row reductions to streaming attention

The decisive rewrite is to change the reference maximum of a **partial weighted sum**. Once its reference travels with the sum, two disjoint sets of keys can be merged using only their summaries. The score can be any pure scalar expression. The compiler need never match the function name, a dot product, or a CUDA kernel. The claim to test is whether this local derivation preserves the chosen numerical observation and produces competitive code on GB10.

## Domain and observation

Use one head, dense f32 inputs of the declared shapes, integer 1 ≤ N ≤ 4096, 1 ≤ D ≤ 128, |q|, |k| ≤ 8 and |v| ≤ 1 componentwise. These are proposed research bounds. They keep dot products, partial numerators and positive normalizers finite in both evaluators, yet permit exponential underflow and cancellation. At a row maximum the weight is one, so the denominator is at least one. The empty state below is internal. General real identities apply to finite scores and payloads on nonempty finite rows. For other consumers below, check their own input domain and observation.

Observe the shape and every returned element of o. Fix the numerical acceptance test in advance: same shape, finite values, and for every element |candidate − reference| ≤ 0.0002 + 0.0002 |reference|. Absolute error matters when positive and negative values cancel. Reference means the original program on the same f32 inputs interpreted in binary64, in source operation and reduction order. The original f32 program must also pass. These thresholds are experimental choices, not proved forward-error bounds.

## The one IR addition

Use an internal typed reduce-state expression F(J, lift, id, combine, plan). For each fixed set of outer indices, lift maps one index to a fixed-shape record of scalars or vectors. The identity and the two operands and result of combine have that same type. Lift and combine are pure, lexically scoped expressions. Record construction, projection, componentwise vector expressions and an optional empty tag are expression forms inside this node. Field shapes are fixed before the row runs. Results may be projected by any consumer. This suffices without surface syntax for loops, mutation or arbitrary user code.

A plan is an ordered binary tree over the increasing indices of J, each present once. A sequential fold starts at id, combines the accumulator with each lifted element, and returns id on an empty range. A block plan folds contiguous nonempty intervals and folds their results in block order, with a short final interval. In reals a registered proof of identity and associativity on reachable summaries licenses the regrouping. Merely supplying a binary expression does not license it. In f32 the tree is part of the program. Evaluate children, then the stated combine expression, rounding literals, shape values, scalar operations and function results exactly as in core Tix, component by component. Tag tests perform no numeric operations. Carry a nonempty child through an empty merge unchanged. No implicit fused multiply-add, reassociation or approximate exponential. A different tree is another checked revision. A scalar-only reduction would require disconnected passes for a maximum and quantities depending on it. An order-only scan would express the sequential recurrence but give no law for combining block results.

## Five rule schemas and their application

Fix row i and write J = [0,N). Write S(j) for precisely the source score, with the division by sqrt(D) **inside** the increasing-d sum. Treat vector equations as one equation per x. The following five numbered substitutions give intermediate programs for this row. Identical row expressions can share a let binding. Each substitution is checked on its annotated before/after expression as well as under the whole-program contract below.

**1. Inline a pure definition.** Replace a read A[t] of A[p] = E by E[p := t] using simultaneous capture-avoiding substitution. Require identical typed extents, valid indices, unique dominating definition and pure operands. Retain shared row lets and drop a definition only after its last use. Pointwise definition of A proves the equation, including in f32 since stored values already have f32 precision. Apply to s and e (fresh d at each expansion), retaining the row bindings M and L. The resulting scalar program is

    M = max(j) S(j)
    w(j) = exp(S(j) - M)                 // lexical abbreviation
    L = sum(j) w(j)
    o[x] = sum(j) ((w(j) * v[j,x]) / L)

Inlining alone can recompute scores at every use. It exposes equal subexpressions for the next rules, without yet claiming a traffic improvement.

**2. Factor a common divisor.** Rewrite sum(j)(a(j)/c) to (sum(j) a(j))/c when c is finite, independent of j and provably nonzero. Also admit the term form (u(j)/c)*v(j) with a(j)=u(j)*v(j), since (u/c)*v=(u*v)/c over the reals. Distributivity of multiplication by 1/c over finite addition gives the real equality. Here L ≥ 1, so the new row returns U[x]/L with U[x] = sum(j)(w(j)*v[j,x]). This changes f32 because the division now rounds once after accumulation. For q=k=0, v=1, N=10, each source term is f32(1/10). An increasing f32 sum gives 1.0000001192092896, while 10/10 gives 1. Leave the d reduction untouched.

**3. Zip sums over a shared range.** Pack independent sums of a(j) and b(j) with the same binders, extents and order into a record sum with componentwise zero and addition. Projection commutes with each addition, so induction from zero gives the original sums, even in f32 with the same tree. A vector of D independent sums uses the same argument. Here use payload P(j)=(1,v[j,:]) and obtain

    M = max(j) S(j)
    (L,U) = sum_record(j) exp(S(j)-M) * P(j)
    o = U/L

sum_record abbreviates sequential F with componentwise addition. Multiplication by one leaves the finite weight unchanged. M is still a separate reduction. Packing maxima and dependent sums as if they were independent would leave their weights referring to an unavailable maximum.

**4. Lift a max-shifted sum to a mergeable summary.** Match the pair max(j) S(j) and sum_record(j) exp(S(j)−M) P(j), where M denotes that very max, the score and payload are pure, and neither depends on M or on the reduced result. Require identical row and key domains. P may contain signed components. For each nonempty subset A define

    mA = max over A of S
    hA = Σ over A of exp(S(j)−mA) P(j)
    H(A) = (mA,hA)

Replace the pair by F(J, j ↦ (S(j),P(j)), Empty, merge, sequential). For two nonempty operands use the following expression tree; either empty operand instead selects the other child.

    m = max(mA,mB)
    a = exp(mA−m)
    b = exp(mB−m)
    merge(A,B) = (m, a*hA + b*hB)

For a singleton, exp(S−S)=1 gives the lift. For disjoint A,B, m is the union maximum. For each j in A, exp(S(j)−m) = exp(S(j)−mA) exp(mA−m); distribute the common factor and repeat for B. Thus merge returns exactly H(A∪B). Both parenthesizations of three disjoint segments summarize the same union. Empty represents the empty set and its branch proves the two identity laws without evaluating −∞−(−∞). Induction now gives the previous pair over J. This is a lemma about max, exp and linear payloads, rather than an attention intrinsic. An unshifted pair of sums using exp(S) would be simpler over reals but can overflow for valid scores here.

The new IR returns h[1:]/h[0], where h[0] is the weight sum. Floating-point exp of a difference need not equal a product of rounded exponentials. Rescaling also rounds a subtraction, an exponential, products and additions at every merge. Small terms may underflow or disappear beside a larger term. The singleton lift skips the explicit weighted multiply and zero addition. The real proof licenses the expression, not bitwise f32 equality.

**5. Partition an associative reduction.** Replace sequential F on J by sequential F on each [tB,min((t+1)B,N)) followed by sequential combines of block summaries. Require integer B ≥ 1, exact ordered coverage, identical lift/combine/id, a real identity and associativity certificate. Induction on the number of intervals, using the union lemma above, proves equality. No divisibility assumption is needed. In f32, maxima select the same finite values up to signed zero, but the tree changes the additions and the sequence of rescalings. Specify the tree even when a backend prefers a parallel reduction. A single sequential fold is a useful comparison but cannot express independent block work.

Reading the resulting expression as a schedule gives the following kernel body. The block-local sequential fold is deliberately explicit so that the first target has a reproducible f32 meaning. Constant-size scratch can hold K,V tiles. Share each lifted score across the normalizer and all x components.

    for each query row i in a resident query tile:
        row = Empty
        for each key block in order:
            block = Empty
            for j in this block in order:
                score = original increasing-d sum for (i,j)
                block = merge(block, (score, (1,v[j,:])))
            row = merge(row, block)
        write row.h[1:] / row.h[0]

Rows within the tile can run together and reuse the same loaded keys and values. Only the row and current block states survive a key iteration. Check liveness and allocations after lowering: no score or weight tensor with N² elements, one score evaluation per (i,j), and one write of each output. Replacing block folds by optimized tile math would require checking that arithmetic schedule too.

## How an application earns its evidence

Use two independent checks. First a small rule verifier reconstructs the replacement from the source subterm, binder/extent map and the rule's stated side conditions. Compare the proposed target structurally modulo fresh names, checking all other uses and unchanged context. For rule 2 the nonzero witness is the max element's unit weight. For rule 4 instantiate the singleton/union lemma with the extracted S and P. For rule 5 verify the interval endpoints and the identity/associativity lemma attached to the actual combine. Keep these finite schemas as the trusted algebra; no general solver for exp or arbitrary combines. Record rule, matched definitions, substitutions, discharged conditions and tree with each revision. A whole-kernel pattern replacement alone would give no evidence for the individual changes.

Second, run the source f64 versus candidate f32 observation after **every** application, always pinning the same original revision. Tolerance is nontransitive. For rules 1 and 3 also require immediate predecessor and successor to agree bitwise in the core f32 evaluator, preserving zero signs. For 2, 4 and 5 require the exact real certificate plus the original-reference tolerance gate. Sampling can refute the f32 claim; passing cases cannot prove it for the full domain.

The existing pass API accepts a versioned pass, correspondence, declared writes, a transformation contract and extra contract inputs (supply origin = r0). Use an invariant over input and candidate for certificate replay, and differential() with origin and candidate ports, side-specific evaluators, seeded cases and elementwise compare for numerical evidence. Each failing case should identify rule, seed, shape, tree, row/component, expected and actual value. Require every prescribed case to finish; differential() ordinarily allows some inconclusive cases, so count these as suite failures. The framework supplies these hooks. Tix evaluators and a Tix adapter for the extended IR are prerequisites for executing the design.

Use fixed seeds 21, 22, 23 for bounded random inputs at small shapes, plus named cases N=1, D=1, equal scores, tied maxima across blocks, a new maximum in each block, an early dominant score, large negative shifts and alternating signed values. Exercise N=B−1, B, B+1 for B=16,32, and B=1. For example, D=2, q=(8,8) and alternating keys (8,8), (−8,−8) give a shift below −104. Mutate one merge to omit a rescale and one partition to drop the last partial block. The certificate must reject both; require numerical counterexamples on rows with distinct v. Replay numerical checks on actual device output before timing. Compare CUDA with the evaluated plan as well as r0 to distinguish lowering drift from rewrite drift; retain compiler math settings with the result.

## Reach of the rules

| Consumer | Reach and limiting condition |
|---|---|
| Softmax followed by a linear contraction | Inline probabilities, apply the (u/c)*v form of rule 2, zip the weight with any bounded vector payload, then lift and partition. Parenthesizations requiring additional scalar normalization need their own checked identity. |
| Stable log-sum-exp | Use P=1. Keep the maximum projection and return m + log(h[0]); the union lemma is unchanged. |
| One-pass layernorm statistics | Already expressed as sum(x) and sum(x*x), the raw moments zip and partition with componentwise addition. Centered two-pass variance needs a different shift/merge lemma. Computing normalized elements also needs x after the statistics are known. |
| A returned softmax matrix | The normalizer streams, but every returned probability depends on the final maximum and normalizer. Fixed-size row state cannot emit all final values in one pass without buffering or revisiting scores. |
| Nonlinear payload such as tanh(exp(S−M)) | The outer tanh prevents extraction of a common exp(mA−m). The local union lemma does not match. |

## GB10 experiment and decision

The performance hypothesis is that the derived kernel passes the contract, eliminates quadratic intermediates, and approaches a handwritten streaming kernel on long rows. Freeze three implementations with identical f32 inputs, layouts, score division placement and precision settings: the unfused statement-by-statement lowering that materializes s and e, the five-rule lowering above, and an independently handwritten tiled online-softmax kernel. Require all three to pass the same output check. Disable fast math and FMA contraction for the primary comparison. Verify device arithmetic against the plan using the same cases; any native math discrepancy is a lowering result to report. Give both streaming kernels the same tile search budget (query tile sizes 8,16,32 and key block sizes 16,32), selecting the fastest feasible configuration on separate tuning runs. Record any infeasible tiles and actual resource usage.

On one GB10 use N=256,1024,2048,4096 crossed with D=32,64,128. Preallocate device buffers, warm each configuration for ten calls and collect 50 interleaved, synchronized device-event samples per shape for full forward execution including all unfused kernel launches. Exclude compilation, transfers and allocation from timing. Record software versions, math flags, tile sizes, timing median and interquartile range. Collect device DRAM read plus write bytes across the same kernels in separate counter runs under a documented repeatable cache policy, and record peak live temporary global bytes from allocations. Time is the primary metric; bytes explain whether the intended reduction in traffic occurred.

Predeclare the six shapes with N ≥ 2048 as primary. Using geometric means of per-shape median ratios, require derived/unfused time ≤ 0.80, derived/handwritten time ≤ 1.25 and derived/unfused measured DRAM bytes < 1. Any missed threshold, failed prescribed correctness check, or full score/weight allocation refutes the corresponding claim. Report individual shapes so cache effects and spills are visible. Missing hardware or unavailable counters leave the relevant claim untested.

Distinguish storage from traffic. Streaming removes the N² score/weight writes and rereads, has O(ND) input/output footprint and Θ(N²D) arithmetic. With R resident query rows per tile and no inter-tile cache reuse, K,V alone can cost Θ(ceil(N/R)·ND) elements read. O(ND) total off-chip traffic requires sufficient residency or reuse. It does not follow from the rewrite. This is why the experiment measures bytes instead of inferring them from tensor shapes.

## Later

- Integrate the parallel Tix front end, f32/f64 evaluators and tolerance contract when available.
- Add the reduce-state IR node, its plan evaluator and the five checked schemas to exercise this derivation.
- Lower the explicit plan to CUDA and run the three-way GB10 experiment when a backend is available.
- Defer new summary laws, general associative-function inference and additional precision modes until these rules are tested.
