---
Title: From dense softmax to a checked block fold
Ticket: IRWB-021-L
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
      Note: Seeded baseline and subject comparison with sampled evidence
    - Path: repo://src/framework/ir/PATTERNS-AND-REWRITES.md
      Note: Directed local edits and the verification gate before publication
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Additional origin input on a checked pass application
ExternalSources: []
Summary: A derivation, numerical contract and GB10 falsification experiment for single-head attention.
LastUpdated: 2026-11-26T12:55:21-05:00
WhatFor: Decide which algebra to trust, what to check at each edit and what GPU result counts as success.
WhenToUse: Designing or reviewing the Tix attention experiment.
---

# From dense softmax to a checked block fold

**Claim to test.** A compiler need not recognize “attention”. It can recognize a sum of weighted values expressed relative to a maximum. Change the reference maximum of one block, and *one scalar* converts the whole block's sum back to the old scale. That fact makes a block replaceable by a fixed-size summary. The dot product is just a producer of scores; the value vector is just one choice of payload.

This is a design, not a kernel or a benchmark result. There are three distinct claims: each edit is an identity over the reals; each emitted f32 program meets a sampled accuracy contract; the final schedule actually saves time and memory traffic. Only the first follows from the algebra below. A direct call to a hand-written kernel might win the benchmark but would not test derivation.

## Starting point: what the source actually reduces

Fix a row `i`. Write `J=[0,N)`, `V_j=v[j,:]`. Slice notation here means a family of scalar components, not a new Tix surface feature. Let

```
t_j = sum(d) ((q[i,d] * k[j,d]) / sqrt(D))
M   = max(j) t_j
w_j = exp(t_j - M)
L   = sum(j) w_j
O_x = sum(j) ((w_j * V_j[x]) / L)
```

Both divisions are **inside** their reduction bodies. In particular the score is not a dot product followed by one scale; this design never moves its division, changes its `d` order or contracts its arithmetic. The final division *will* move, by an explicit rule. For finite real scores and nonempty `J`, a maximum is attained, one weight is 1, and `1 ≤ L ≤ N`. Thus the final division is defined. A simpler real rewrite would cancel the common `exp(-M)` and sum unshifted exponentials. Reject it: even within the study domain a score near 181 is possible, so `exp(t_j)` can overflow f32. We need a movable maximum, not the absence of one.

## Just enough IR: a typed fold with a specified tree

Use an internal `fold(I; lift, combine, id; tree)` with an explicit finite index interval `I`. `lift(j): S`, `combine(S,S): S` and `id: S` are closed over immutable row parameters and have no effects. `S` can contain f32 scalars, fixed-shape f32 vectors, products and a tagged empty alternative. Shapes are known for a shape binding and do not grow with the length folded. Destructuring, projection, vector scaling and addition denote componentwise scalar operations. No changes to the source grammar are needed. A scalar `sum` or `max` enters as its Tix fold with the original seed and increasing left fold.

- **Operational meaning:** `left` executes `a=id; for j in I increasing: a=combine(a,lift(j))`. A tree annotation can instead prescribe a binary tree on the ordered leaves (for example, recursively split a nonempty interval at its midpoint; single leaf = `lift(j)`, empty = `id`). A blocked tree records the subintervals, inner tree and outer tree. It specifies all seeds, operand orders and parentheses; it is part of the revision, not a backend hint. Indices, tags and control are exact. For a user-supplied combine without laws the given tree is still executable; the compiler has no license to change it.
- **f32 meaning:** evaluate the chosen tree literally. Every numeric primitive, including subtraction, `exp`, multiplication and addition in the combine, and every component of `lift`, has the core `fround` meaning. Copies/branches do not do arithmetic; a tag test evaluates only the selected arm. No implicit FMA, reassociation, fast exponential, flush-to-zero or parallel atomic sum. GPU lowering must be checked separately; choosing CUDA `expf` does not prove agreement with `fround(Math.exp(...))`.
- **Law for regrouping:** require a registered real identity and associativity derivation on the reachable, shape-correct states, and closure there. Ordered trees suffice; no commutativity required. This is not an `associative=true` flag about machine floats. Three scalar reductions would be simpler syntax but could not update the two sums from *both* child maxima at a merge. Storing the unnormalized output rather than the running quotient avoids a division at every merge.

## Rewrite catalogue

The checks below are local to the edited expression and its bindings. For every application also run the origin gate in **Acceptance**. “Bit-exact” below describes the step *from its immediate predecessor* under the specified evaluator; it is not a claim that the whole chain is bit-exact to the source.

**R1 — Substitute a pure tensor definition.** In `A[u]=E; … A[f(j)] …`, substitute `E[u:=f(j)]` at the use. Conversely share identical subexpressions with a scoped `let`. Freshen bound indices, preserve inferred extents as explicit bounds before inlining, check dominance, in-bounds affine substitution, same bindings and exact expression trees. Drop the old definition only with no remaining uses, including the return. SSA lookup and evaluation of the same expression at the same indices give the same value over the reals and bit-for-bit in f32. Check use-def edges, substitution and absence of dangling uses; do not duplicate effects or unroll an unrelated reduction. This rule exposes `t` and `w`, not a promise to recompute a score at each use.

**R2 — Extract a reduction-invariant divisor.** `sum_J (a_j / h) → (sum_J a_j) / h`. Also match a per-term product `(p_j / h) * v_j` as `(p_j * v_j) / h` as part of the same rule. `h` must not depend on `j`; check free indices, type/broadcast and a nonzero finite `h` (here the attained-maximum argument). The real proof is distributivity with constant `1/h`. For an exact-f32-only contract this is not a legal general rewrite: previously each term divided and rounded; now one larger sum rounds before a single divide. With equal logits and values `[1,1,-0.25]`, the two f32 results are `0.5833333730697632` and `0.5833333134651184`. Check the real template **and** tolerance; do not apply to the score just because that divisor is invariant too.

**R3 — Zip independent sums into a product fold.** `(sum_J a_j, sum_J b_j) → fold_J((a_j,b_j), componentwise +, zeros; left)`, including a statically shaped family of sums over `x`. Match identical ordered `J`, independent bodies (neither reads the other's accumulator), compatible row and lane bindings, and exactly the old component seeds and arithmetic. Projection commutes with initialization and every update; induction on the prefix proves equality, bit-exact also in f32. In particular `(w_j,w_j*V_j)` is `w_j P_j` for `P_j=(1,V_j)`; multiplying a finite weight by 1 is exact. A missing unit lane would lose the normalizer. Check by projecting each component back to the old fold.

**R4 — Partition a fold.** For a real monoid `(⊕,id)`, replace a fold on `J` by an outer fold of inner folds with the same operator on `J_b = [bB,min((b+1)B,N))`, `0 ≤ b < ceil(N/B)`, `B` a positive integer. Choose and record the trees; here use increasing left fold across blocks, and ordered midpoint trees for tile max and tile sum. Check integer disjoint, exhaustive, order-preserving coverage (the last block ends at `N`), lift unchanged, units and associativity. Removing units and flattening parentheses gives exactly the original leaf word. For `max` adjoin the core `−∞` empty seed to the finite reals (no subtraction from that seed); for sums use componentwise real addition. A partial block has *no* padding scores. Max alone is exact on these inputs with core max semantics; tiled sums change f32 grouping and need tolerance. Changing a tile width or reduction tree is another checked choice, not permission to reorder silently.

**R5 — Rebase a weighted block sum.** For nonempty `I`, `c=max_I t_j` and invariant finite anchor `a`, rewrite

```
sum_I exp(t_j-a) P_j  →  exp(c-a) * (sum_I exp(t_j-c) P_j).
```

Match the *same* score expression and interval in the maximum and sum. `P_j` is an additive scalar/vector payload independent of the anchor being replaced; scaling must be componentwise and linear. Take `a` here to be the enclosing maximum, so `t_j ≤ c ≤ a`; no positive exponent is introduced. Instantiate `t_j-a=(t_j-c)+(c-a)` and `exp(u+v)=exp(u)exp(v)`, then distribute the constant through the finite sum. This check is one exponential identity and linearity per lane, not a softmax identity assumed on trust. f32 now subtracts different numbers, rounds different exponentials, and scales a rounded sum; small terms or factors may underflow. Check both the template and tolerance. Do not apply the formula on an empty interval.

**R6 — Fold summaries at a common anchor.** Recognize a maximum `A=max_b c_b` and an additive payload `Y=sum_b r(c_b,A) C_b`, with `r(u,v)=exp(u-v)`. Rewrite the pair `(A,Y)` to the following fold of block leaves `Some(c_b,C_b)`:

```
Empty ⊗ z = z;   z ⊗ Empty = z              // branch before subtraction
Some(a,P) ⊗ Some(b,Q) =
    let h = max(a,b) in Some(h, r(a,h)*P + r(b,h)*Q)
```

To construct the combine, reuse the matched `max` on the two child anchors, instantiate the matched scale expression twice with that new target, then reuse the payload's scale and add operations. Only the law check for the scale function is specialized to `exp(u-v)` here. The state type fixes the payload shape. Blocks need the same index set and finite anchors; each leaf must be computable from that block and row parameters alone, **without** `A` or any other block's payload. Preserve any external uses of the pair by projection. The identity is a tag, not a calculation of `exp(-∞ - -∞)`. On a nonempty output the folded state is unpacked.

The mechanical law is transport of scale: `r(u,u)=1`, `r(u,v)r(v,h)=r(u,h)`. Define the specification on any nonempty block range `S` as `(h_S, sum_{b∈S} r(c_b,h_S) C_b)`, with `h_S=max_{b∈S} c_b`. A singleton satisfies it. For adjacent `S,T` the new maximum is `h=max(h_S,h_T)`; multiply each child sum by its factor to `h` and distribute. Each term becomes `r(c_b,h) C_b`, appearing once. This proves the combine yields the specification on the concatenation. Both parenthesizations of three states have maximum `h` and the same three transported terms, establishing real associativity; the tag laws give the two-sided unit, including empty/empty. It works for signed payloads too. The verifier matches a maximum, the two transport identities and linear addition; it never inspects a dot product or the name of a function. In f32 successive rescalings need not compose exactly, and cancellation in a payload can expose errors even if the maximum never rounds differently. Check lemma instantiation **and** tolerance for the selected tree.

**R7 — Realize a fold at its consumer.** Replace `fold_left_b(map(summary,b))` by a loop with a private accumulator initialized to `id`; form one block leaf and combine it immediately. Place a shared pure producer in tile-local storage if all its uses there have the same index/value and it is dead at tile exit. Map disjoint rows to a query tile; no new reduction across rows. Check a bijection of block/lane indices, exact inner trees, one writer per output, initialized state, tile capacity and last use before scratch reuse (including required synchronization). After `k` iterations the state *is* the fold of the first `k` leaves by the defining recurrence. Storage placement only changes lifetime. This is an exact real and bit-exact f32 scheduling rule in the IR if the backend realizes those primitives and trees. A loop that computes the right answer but writes every leaf to global memory does not meet the schedule requirement.

## Derivation on the given program

Here `Σ` denotes a reduction on the stated interval, **not** permission to reassociate f32. Each line is an intermediate program for a row; earlier definitions still in use remain in scope.

| Edit | Program after the edit |
| --- | --- |
| R1: expose producers | Use the row expressions `t_j`, `w_j`, `L`, `O_x` above; shared names are scoped lets. Only `O` escapes. |
| R2 on `O` | `U_x=Σ_J (w_j V_j[x]); O_x=U_x/L`. `L=Σ_J w_j` still needs the row maximum. |
| R3 on `L` and `U` | `Y=(L,U)=Σ_J exp(t_j-M) P_j; O=Y.U/Y.L`. All lanes now reduce along the same `j`. |
| R4 on `M` and `Y` | `c_b=max_{J_b} t_j; M=max_b c_b; Y=Σ_b (Σ_{J_b} exp(t_j-M) P_j)`. Tiling alone still requires a global max pass. |
| R5 on the inner payload, R1 to share `c_b` | `C_b=Σ_{J_b} exp(t_j-c_b) P_j; Y=Σ_b exp(c_b-M) C_b`. The leaves `(c_b,C_b)` no longer depend on `M`. |
| R6 on `(M,Y)` | `Some(M,(L,U))=fold_b(Some(c_b,C_b), ⊗, Empty; left); O=U/L`. No use of the old row-wide max or weight arrays remains. |
| R7 on the block fold | Execute the tiled loop below. No tensor indexed by all `(i,j)` is live. |

```
for a tile of R query rows:                       // rows independent
    keep q_tile and state[i] = Empty on chip
    for J_b in increasing b:                      // one visit per query tile
        load k[J_b,:], v[J_b,:] for this tile
        for each valid row i in tile:
            t[j] = source score(i,j) for j in J_b // bounded tile scratch
            c = tile_max(t)
            (z,u) = tile_sum(exp(t[j]-c) * (1,v[j,:]))
            state[i] = state[i] ⊗ Some(c,(z,u))
        discard tile scratch
    for each valid row i: unpack Some(m,(l,u)); write o[i,:] = u/l
```

After any nonempty prefix `K` of keys (whole blocks), the real state is `m=max_K t`, `l=Σ_K exp(t_j-m)`, `u=Σ_K exp(t_j-m) V_j`. This follows by substituting R5's leaf definition in R6's range specification. At `K=J` this is exactly the maximum, denominator and numerator in the R2 program. For a single key the real leaf is `(t,1,V)`. For two nonempty blocks, write `α=exp(m_old-h)` and `β=exp(c-h)`. The updates are `l'=α l_old+β z`, `u'=α u_old+β u`; dividing the new numerator by the new count is only needed at the end. For a small check, two singletons with scores `0, log(2)` and values `1,0` give `(h,l,u)=(log(2),1.5,0.5)`, hence `O=1/3`. Forgetting to rescale the old numerator gives `2/3`; reversing the two blocks exercises the new leaf's factor instead. These are useful mutant tests, not the proof.

A fixed directed schedule suffices: start at a reduction consuming a normalized product, follow SSA operands, apply R1–R3, tile matching `j` intervals, then attempt R5–R7. Rebind identifiers in the current revision after each edit. R1 is directed by demand (expose a use or share tile-local equals); no unrestricted inline/outline search. If the denominator, anchor or payload guard does not match, there is no derived one-pass schedule from this path. More generally, the same schedule can start at an already unnormalized shifted sum (skip R2), or zip independent sums and stop after ordinary tiling if there is no anchor.

## Acceptance: what counts as a checked step

**Study domain.** Single head, dense, integer `1 ≤ N ≤ 4096`, `1 ≤ D ≤ 128`, matched shapes as in the source. Finite f32 `|q|,|k| ≤ 4`, `|v| ≤ 1` componentwise, including signed zeros and subnormals. These are explicit specialization preconditions to be supplied and checked by the study harness, not properties inferred from tensor types. Finite inputs alone do not prevent an overflowing product or division by zero. Products have magnitude at most 16; even the loose bound `16D` on unscaled partial sums leaves a large overflow margin. Stable exponents have nonpositive arguments, local normalizers include a 1, and payloads are bounded sums on at most 4096 leaves. Underflow of negligible terms is allowed; overflow and NaN are not expected. The empty *state* is needed for the fold seed, not an invitation to normalize an empty row.

**Observation and relation.** Observe only the returned tensor (shape, f32 type, all elements), not temporary weights or a norm averaged over rows. Exact local steps require bit equality to their predecessor including signed zero. For numerical acceptance evaluate the **unchanged Tix source** in f64, preserving scopes, seeds, index order and operator placement, widening the exact same f32 inputs and omitting f32 roundings. Keep its output in f64. This is a numerical oracle, not the reals. Proposed frozen study budget, per element: `abs(got-ref) ≤ 2e-4 + 4e-4 * abs(ref)`; compare in f64, require shape/type as specified and finite observations, treat the two zero signs equally for tolerance. The absolute term matters for signed, nearly cancelling values. These numbers are a hypothesis for this domain, not a bound inferred from testing. Test the original f32 evaluator against this same budget first, and log direct deviations from original f32 at each step too. No tuning the budget after seeing failures.

**Two gates per candidate revision:**

1. Replay the rule's real lemma with the actual captured subtrees, index binders, shapes, uses, nonzero/range facts, tree and partition. Check both sides against the template and require that the enclosing program is unchanged except for the mapped defs/uses. The trusted base is Tix purity/index semantics, finite real arithmetic identities and `exp`/`max` laws listed above; no solver for arbitrary real functions or user-supplied monoids. A correspondence or a rule author's preservation declaration alone is not a certificate. For R1, R3 and R7 also compare predecessor/candidate f32 bits on the cases; for R4 distinguish the max-only edit from regrouping a sum. Do not demand local bit equality of R2, R5 or R6.
2. For **every** tentative intermediate (including new schedules and the final CUDA observation), compare candidate f32 to the same origin f64 under the frozen relation. Use the future Tix evaluators/contract on these ports; do not use the previous approximate result as the oracle. Tolerance is not transitive. Exact local proof does not exempt the whole output from the origin check. A strict/bitwise compilation mode cannot authorize the full chain by these arguments.

The current framework already has the needed *host* interfaces: [directed rewrites and `verify`](../../../../../../src/framework/ir/PATTERNS-AND-REWRITES.md), [`applyPass` with `contractInputs.origin`](../../../../../../src/framework/passes/define-pass.ts), and [`differential`](../../../../../../src/framework/contracts/differential.ts) with baseline/subject execution and a custom comparator. Bind `before`, tentative `after` and immutable `origin` to a versioned transformation contract; verify before publication. Keep rule id/version, substitutions/guard evidence, revisions, chosen tile/tree, contract/evaluator/math-mode versions, case seed/shape, max absolute and budget-normalized error, and first failing `(i,x)` with inputs or regeneration key. Require the entire prescribed case list decided and passed (the generic sampled tally alone can allow some inconclusives). If device math differs from the scheduled f32 evaluator, record the device discrepancy as a lowering difference and check the device output against the origin too; do not classify it as a bit-exact R7 edit. A failed numerical check rejects the candidate, not the real identity. Passing samples is not a universal f32 proof.

**Challenge set.** Fix seeds `21,22,23` before running. For each seed exercise small full outputs on `N=1,2,3,31,32,33,63,64,65,127` and `D=1,7,64,128` with bounded uniform inputs, and on every timed shape. Include hand-constructed equal/near-tied scores, strictly increasing maxima across tiles, the largest score first vs last, alternating-sign values with nearly zero output, tiny/subnormal inputs, and opposite high scores (e.g. all `q=4`, `k=±4`, `D=128`, where a shifted exponential can round to zero). Try `B=1`, a full row on small cases, and tails. Known negatives: overlapping tiles, dropped tail, using `l` in place of a vector lane, missing `α` in either update, accidental reassociation of the score, or a dependent denominator. Require guard/certificate rejection for invalid edits; run arithmetic mutants in the harness to verify the differential suite detects output-changing mistakes. Persist counterexamples; do not report only aggregate agreement.

## Where the same rules stop

| Program | Consequence of the rules |
| --- | --- |
| Softmax of arbitrary finite scores followed by a linear contraction | Inline the probabilities (R1); R2 handles `(w/L)*v`; R3–R7 apply with one unit lane and any fixed number of payload lanes. The score need not be a dot product. The no-matrix claim requires that the probabilities do not also escape. |
| Stable log-sum-exp `M + log(Σ exp(t-M))` | R4–R7 with just the unit payload yield `(M,L)`; leave `M+log(L)` as finalizer. No quotient or vector is required. This does not match arbitrary unstable `log(Σ exp(t))` by magic. |
| Layernorm **raw statistics** `Σ x`, `Σ x²` already in the graph | R3, R4 and R7 compute the pair in one scan, then a finalizer can compute mean and variance. No exponential transport applies. A centered second pass `Σ(x-mean)²` needs a new moment identity; these rules neither synthesize Welford nor promise stability of subtracting raw moments. Normalizing every original `x` also needs access to it after the stats. |
| Return softmax probabilities themselves, or return the score matrix | Every element is observable; a fixed-size row summary cannot emit all normalized values before the last maximum is known. Need retention/recomputation, and for attention scores the output alone is quadratic. |
| `Σ tanh(t-M) V` or `Σ exp(t-M) p(j,M)` with nonlinear dependence on `M` in `p` | R5 cannot factor out a common scalar transport for the whole payload. Packing independent sums or tiling does not fix the dependence. |

As controls, try the same rule versions on stable log-sum-exp and on the `tanh` example. The former should yield a scalar-payload fold without a dot product; the latter must not emit R5. These are structural reach claims, not numerical certification of other functions under the attention budget. Each needs its own domain, observation and reference check.

## Experiment on NVIDIA GB10

**Hypothesis (pre-register before lowering).** From the literal source, without an attention-named matcher, library dispatch or user annotation, the rule trace produces a checked kernel with no global score/weight buffer. On the six primary shapes `{1024,2048,4096} × {64,128}` (`N,D`), the geometric mean of per-shape derived/unfused **time** ratios will be ≤0.80, derived/hand time ratios ≤1.25, and derived/unfused **DRAM byte** ratios ≤0.75. Report all individual ratios including derived/hand bytes. This tests a performance claim as well as expressibility: a correct but slow fold answers only the latter.

- **Three arms.** Unfused CUDA lowers each original tensor definition separately; materialize `s,e` once, use a competent tiled score producer and parallel independent rows/components, no deliberately repeated dot products. Derived arm takes only the rules above. Independent hand-written, block-streaming CUDA is the positive control. All arms use the same f32 data/layout, precision and math flags (no TF32, half, FMA contraction or fast math), same residency and output, and must pass the origin check. Use the literal score order in all arms; the unfused semantics must retain its source reductions. No precomputed weights. For tiled arms choose legal `R,B` from `{8,16,32} × {16,32,64}` by the same bounded timing budget on separate tuning runs, discard resource-infeasible shapes, then freeze configurations; record launch and resource limits. Give unfused kernels the same tuning opportunity. Every derived tree considered for reporting goes through the gate.
- **Timed quantity.** Measure the whole forward pass on one stream by CUDA events, first launch through final output write, including all unfused kernels. Exclude compile, allocation, migration, host copies and validation. On a dedicated GB10 pre-touch resident buffers, warm each arm 20 times, interleave arms in seeded randomized order over 50 measurement rounds per shape. Use identical cache preparation for all arms (cycle distinct resident input sets totaling more than L2); report median time, dispersion and paired bootstrap 95% intervals for ratios. Record clocks/power mode, driver/toolkit, compiler flags, tile sizes, register/shared usage and spills. Include untimed small/tail cases so a fast full-tile-only kernel cannot pass.
- **Byte quantity.** In separate profiling runs with the same workload/cache policy, query GB10-supported device DRAM read/write byte counters, record their actual names/units, sum both across *all* forward kernels per invocation, repeat five times and take the median. Do not substitute requested load bytes, allocated bytes or theoretical tensor sizes for this metric. Record peak global workspace and inspect allocations/launch trace separately for any `N×N` intermediates. If counters are unavailable, the traffic claim is unmeasured.
- **Interpretation.** Arithmetic remains `Θ(N²D)`. The compulsory input/output footprint is `Θ(ND)` and the derived schedule eliminates the `Θ(N²)` global score/weight writes and their reads. On-chip footprint per query tile is `O((R+B)D + RB)` words including local scores and state. There is **not** a general `O(ND)` bound on measured DRAM traffic on a fixed GB10: absent cache reuse, `ceil(N/R)` query tiles can each reread `Θ(ND)` key/value words. Cache hits, spills and math throughput decide how much of the potential gain appears as bytes or time. Keeping all scores in a single on-chip row is a simpler two-pass scheme for small `N`, but its scratch grows with `N`; it is not this fixed-tile hypothesis.
- **Decision.** Refute the derivation claim on this study if the source needs a special attention rewrite, any required check fails, or global score/weight storage survives. Refute the stated performance target if any measured geometric-mean ratio exceeds its threshold; publish intervals and flag a threshold crossing within the interval as statistically uncertain. Missing GB10 evidence is inconclusive, not a speedup. As an ablation, disable R5 or R6: the remaining dependence on `M` should prevent this one-pass trace. A surviving one-pass result needs its own explanation.

## Later

- Implement the Tix adapter, evaluators and contract binding when the parallel front end is available; this ticket specifies their required observations only.
- Implement the fold/rule verifiers and CUDA realization, then collect the pre-registered GB10 evidence; no kernel or measurement is delivered here.
- Extend beyond finite dense forward attention (masks with empty rows, backward pass, mixed precision) only with new domain and numerical arguments.
- Add centered-moment transport or tighter analytic f32 error bounds only if those become separate research questions.
