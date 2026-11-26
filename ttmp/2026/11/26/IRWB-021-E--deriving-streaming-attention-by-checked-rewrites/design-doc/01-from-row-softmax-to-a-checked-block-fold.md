---
Title: From row softmax to a checked block fold
Ticket: IRWB-021-E
Status: review
Topics:
    - research
    - compiler
    - verification
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Fixed-origin comparisons and sampled evidence
    - Path: repo://src/framework/contracts/types.ts
      Note: Port bindings and transformation conditions for local evidence
ExternalSources: []
Summary: A local derivation using change of exponential origin, with separate real and sampled f32 obligations.
LastUpdated: 2026-11-26T12:47:56-05:00
WhatFor: Review the proposed rewrite experiment before implementing it.
WhenToUse: When specifying Tix reductions or evaluating the streaming-attention hypothesis.
---

# From row softmax to a checked block fold

**Proposal.** Derive a reduction on row summaries, not a call to an attention intrinsic. The useful fact about a block of scores is that changing the origin of *every* exponential multiplies *every* weighted sum by the same scalar. That fact determines the combine operation. Blocking then becomes an ordinary change of reduction tree. This is an exact derivation for real arithmetic; making the tree executable in f32 is a separate, testable claim. This ticket supplies neither a Tix implementation nor GB10 results.

## Contract and notation

First experiment: integer `1 ≤ N ≤ 4096`, `1 ≤ D ≤ 128`, consistent dense shapes as in the question, all inputs finite f32, componentwise `|q|,|k| ≤ 4`, `|v| ≤ 1`. This is a specialization under a domain contract, not a rewrite licensed merely by type `f32`. Finite inputs alone do not preclude overflow of the score or of an unnormalized numerator. Here scores are bounded in real magnitude by `16 sqrt(D)` and real local weights are in `(0,1]`. There is ample f32 overflow headroom for dot products, differences and sums, even allowing rounding; a maximizing element contributes exactly one at its own maximum. Tiny weights may round to zero. One need not prove they are nonzero. Empty *rows* and all-masked rows are not in this experiment; an empty *partial state* is necessary.

Fix a row `i`. Write `J=[0,N)`, `w_j[x]=v[j,x]`. Keep the score producer intact:

```
a_j = sum(d) ((q[i,d] * k[j,d]) / sqrt(D))
```

In particular the `/` is **inside** the `d` sum, and `/ l[i]` in the question is **inside** the `j` sum. No rewrite of the score dot product is needed. Below, sums over tuples/vectors mean independent component sums in increasing index order; slices and comprehensions are IR notation, not new Tix source syntax.

## One IR addition: a fold with product state

Use `fold(I, leaf, unit, combine; tree)` on a finite ordered index interval. `leaf` is a pure bounded expression of its index and immutable captures. The carrier is a fixed shape for the row (scalar fields, vectors of known extent and an optional empty tag). `combine : S × S → S` is a typed pure expression over its two arguments and invariant captures; projections, tuple construction and a lazy case on the tag suffice. No iteration hidden in `combine` except pointwise vector arithmetic. A list fold starts at `unit` and combines on the right with each successive leaf. A tree denotes specific contiguous subfolds and specific ordered binary joins; empty lists yield `unit`. A tile summary can itself be a leaf. Real meaning is evaluation of that expression; changing tree requires a witnessed unit and associativity **on reachable real states**, not an unchecked “associative” flag. The product and loop notation below can be internal to a pass.

Operational f32 meaning is evaluation of the *recorded* tree (default increasing left fold). Tag branches return the other argument unchanged and do not evaluate arithmetic on an absent maximum. All scalar ops, constants, shape values and transcendentals use core `fround` semantics; vector ops do so lane by lane. No hidden FMA, unordered atomic adds, fast exp or implicit reassociation. A different tree is a new candidate. A scalar reduction per output field is the simpler IR alternative, but cannot read the same old maximum and update the coupled state in one traversal. An opaque online-softmax op would instead move the entire question into its lowering.

## Rules and their application, in order

Each before/after below is for a pure SSA region. Type, affine bounds, free indices, use counts and absence of effects are checked at every match. All equalities in the arguments are over the reals unless marked f32-exact. Use a small trusted library of the stated identities with checked substitutions, not a solver asked to discover exponential identities or arbitrary monoids. None of the patterns tests a function name or the syntax of a dot product.

**R1 — Substitute a producer at its reads.** `t[p]=E(p); …t[f(j)]…` becomes `…E(f(j))…`, with capture-avoiding substitution of the full index tuple, bounds checked, the same typed operations and reduction binders in the same order. Drop a definition only when dead. Conversely a pure common expression at equal indices may be let-bound at the same value. Lookup of an immutable definition denotes its RHS; deterministic rounding at identical nodes makes this f32-exact as well. Apply to expose `a_j`, `c=max(j) a_j`, `b_j=exp(a_j-c)` and `L=sum(j) b_j`; these row-local names denote shared expressions, not a commitment to tensor storage. For this elimination require no escaping score/weight use. Result: `o[x]=Σ_j ((b_j*w_j[x])/L)`.

**R2 — Take an invariant denominator out of a linear sum.** `Σ_j ((b_j*w_j[x])/L) → (Σ_j b_j*w_j[x])/L`. Also recognize `(b_j/L)*w_j[x]` by the same scalar identity. Require `j` not free in `L` and `L ≠ 0`: here `N>0` and the maximum contributes `exp(0)=1`. Distribution of the constant `1/L` through addition proves equality componentwise. The rewrite eliminates per-term divisions but rounds an unnormalized sum before the final divide; not f32-exact. We now need exactly `c,L,U[x]=Σ_j b_j*w_j[x]` and finish with `U/L`.

**R3 — Pack co-indexed statistics.** Abstract `c,L,U` as the projections of a summary `S(J)`. This is definitional notation with an expansion, not a primitive with an assumed merge law. For any nonempty interval `I` and any fixed origin `t` define

```
P(I,t) = sum_{j in I} (exp(a_j-t), exp(a_j-t)*w_j[:])
c_I    = max_{j in I} a_j
S(I)   = Present(c_I, P(I,c_I).first, P(I,c_I).second)
S(∅)   = Empty
```

`P` is a product of scalar additive folds. Require identical `j` domains and order, identical score and shift expressions, payload independent of the summary/shift, row and output-lane extents invariant in `j`. A tuple of sums equals the sum of tuples: projecting zero gives zero; projecting each componentwise add is exactly the old accumulator update. Pairing that result with the existing max changes no operations. This is also f32-exact with the specified left folds; `c_I` is computed *before* `P`. Apply at `I=J`, giving `finish(S(J))` with `finish(c,L,U)=U/L`. Packing alone still requires the row maximum before the weights.

**R4 — Change origin and lift to a fold.** Match `S(I)` by the R3 expansion. Replace it by a left fold of `Present(a_j,1,w_j[:])` with `Empty` and the following combine. To derive, concatenate adjacent disjoint index intervals `A,B`. For two nonempty intervals the maximum is `h=max(c_A,c_B)`. In each interval `T` the identity

```
exp(a_j-h) = exp(c_T-h) * exp(a_j-c_T)
P(T,h)     = exp(c_T-h) * P(T,c_T)
```

follows by adding exponents and distributing a scalar over the same linear payload sums. Since summing over a concatenation adds the two sums, the only needed fields are the two existing `P`s and their origins. With `p=exp(c_A-h)`, `r=exp(c_B-h)`, emit

```
merge(A,B) = Present(h, p*L_A + r*L_B, p*U_A + r*U_B)
merge(Empty,B)=B; merge(A,Empty)=A
```

Here names `A,B` in `merge` denote the summaries. No subtraction of two negative infinities. For a singleton, `exp(a_j-a_j)=1`, so its fields are exactly the leaf above in real arithmetic. By the concatenation identity, either bracketing of three summaries gives `S(ABC)`. This proves closure, associativity on summaries and the two unit laws; induction on length proves the fold replacement. Check finite scores, the exact shift and linear weights from R3, and the unit/singleton/concatenation instances. Use of an unshifted `exp(a_j)` would permit a simpler additive state over reals but can overflow even on this domain. In f32, differences, exponentials, multiplies and additions at each new origin round separately; repeated rescalings, underflow and cancellation with signed payloads distinguish this fold from R3. Do not label the f32 combine associative.

**R5 — Partition a certified fold and summarize the leaves by block.** For positive tile width `B`, replace `fold(J)` by the left fold of the folds on `[bB,min((b+1)B,N))` in increasing `b`. Check the cover (including last partial tile), no overlap/reordering, identical captures, and an identity/associativity certificate for the carrier (here R4). By unit and associativity, inserting units at boundaries and reparenthesizing the concatenated leaves preserves the real result. Use **R4 in reverse** inside each block to compute `S(tile)` by its R3 expansion rather than a serial merge per score. This is another checked application: the reverse direction still needs the finite-domain and tolerance checks. Blocking changes f32 grouping; the reverse step trades repeated rescaling for tile-local maxima and direct tile-local exponentials. Keeping a singleton fold would avoid block scratch but serialize more exponentials on the critical path.

The resulting schedule (R1 to share and localize tile expressions, no change of arithmetic):

```
for a tile of query rows, independently for each valid row i:
    acc = Empty
    for tile T in increasing j-block order:
        compute a[j] for j in T once, keep on chip
        h = max_T a[j]
        compute b[j] = exp(a[j]-h) locally
        tile = Present(h, sum_T b[j], sum_T b[j]*v[j,:])
        acc = merge(acc,tile)                // both factors use OLD maxima
    write acc.U[:] / acc.L
```

Thus each row visits a key block once, although its temporary scores are read twice on chip. Keep the row state across all blocks; drop the tile when consumed. Check the storage plan by def-use/lifetime: only `q,k,v,o` need global tensor storage, no `N×N` allocation, no global array of tile states. A fixed tile of `R` query rows with `B` keys needs scratch on the order of `RB+(R+B)D` floats including state and staged inputs; check actual registers, shared memory and spills, not just shapes. Arithmetic is still `Θ(N²D)`. **Linear footprint is not linear DRAM traffic.** Compulsory input/output bytes are `Θ(ND)`; without inter-query-tile cache reuse a query-major schedule issues `Θ(ceil(N/R)·ND)` K/V reads. The unfused stable softmax additionally writes and rereads quadratic intermediates. Avoiding those streams is the derivation's I/O claim; total GB10 off-chip bytes are a measurement, not an unconditional asymptotic promise.

## Accepting a rewrite

Use the framework's distinct `requires` and `ensures` conditions (`src/framework/contracts/types.ts`). Use a directed matcher: walk backward from a returned contraction along SSA definitions, apply R1–R3 where their index patterns unify, try R4 only on a matching summary expansion, then R5. Permit reverse R4 only under a scheduled tile; this prevents an expand/fold cycle. Freeze the original program as the `origin` port; bind also the local before/after regions. An application receipt contains rule/version, substituted binders, extents, typed expressions, uses, certificate instance and, for R5, the exact tree and tile size. A small verifier reconstructs the RHS from the LHS and checks the side conditions above plus an unchanged surrounding context modulo renaming. For reverse R4 reconstruct the fold from the proposed expansion. The trusted real lemmas are substitution, distribution, coordinate projection, change of exponential origin and fold partition as proved above. A failed match supplies no license to rewrite. This is local proof by template instantiation, not empirical discovery of an identity.

Observation is **the entire returned tensor** (shape and elements), not the score matrix or an internal running state. At every step, including blocking, reverse expansion and final kernel, use `differential()` (`src/framework/contracts/differential.ts`) with seeded cases. Baseline: evaluate *original parsed source* on the same f32 inputs in binary64, with the original scopes, increasing index order and binary64 operations (no intermediate fround). Subject: current program under its recorded f32 semantics. Proposed fixed research relation: identical shape, both outputs finite and for every element `|subject-ref| ≤ 2e-4 + 2e-4*|ref|`. Freeze/version this domain and threshold with the Tix contract before the run. The absolute term matters for cancellations near zero. Run the unoptimized f32 origin through the same gate first; a baseline failure is a failed contract experiment, not evidence against a specific merge. No post-hoc tolerance widening. Sampled agreement with f64 is neither a proof for all f32 inputs nor bitwise preservation of the source.

| Application | Local check in addition to the origin gate | Main f32 risk |
|---|---|---|
| R1 | definitional substitution and identical typed expression/order; exact before/after f32 observation on cases | capture, changed rounding node |
| R2 | invariant nonzero divisor and distribution instance | division moves across rounding of the sum |
| R3 | replay component updates and max dependency; exact before/after f32 on cases | accidentally changing component order |
| R4, either direction | check singleton, tag and shift/concatenation certificate | rescale products round; small contributions can vanish |
| R5 | verify contiguous partition and real merge law | order of rounded additions/merges changes |

Never chain tolerance comparisons: closeness is not transitive. Record seed, shapes, input recipe, before/after and origin revisions, tree, max absolute and tolerance-scaled error, worst coordinate and first failing case. Require all prescribed cases decided and passing (inspect differential evidence; ordinary sampled success can include inconclusives). Test one key, one feature, ties across tiles, strictly rising/falling block maxima, a distant dominant score, alternating-sign payloads, uniform scores and near cancellation, shapes `B−1,B,B+1`, and seeded uniform and spiky inputs. For a reproducible small-case sweep use seeds 1–32, extents sampled uniformly in `[1,2B+1]` and `[1,128]`, and uniform draws over the input box rounded to f32; add a spiky companion with one key aligned with the first query and all other keys anti-aligned. Use the same inputs at every stage. Include the f32 underflow regime with sign-aligned `±4` keys against an all-4 query at `D=128`. Check partial summaries against direct R3 expansion as a diagnostic when the first failure is inside a tile. Negative controls: drop `p` on `U_A` for a rising-maximum row, or skip the tail; certificate/cover checker must reject each, and a differential-only replay should expose each on a nonconstant payload. These checks precede speed measurements.

GPU math is not defined by `Math.fround(Math.exp(...))` merely by choosing float operands. For the experiment pin compiler/math flags (no fast math, TF32, contraction or flush-to-zero), instruction order and tile tree; compare GPU observations to the f64 origin and report GPU versus modeled-f32 deviations separately. Do not count a lowering with unexplained order or math changes as f32-exact. Any intentional GPU arithmetic approximation needs a separately identified candidate and check; it is not a free consequence of a real lemma.

## Reach of this rule set

- A stable softmax consumed **only** by a linear contraction: inline the weights, use R2 on `(b/L)*w` and repeat. The score may contain a finite additive bias, and the value width need not be the score feature width. Scores and payload must be computable for the current tile. Multiple linear outputs just widen `U`.
- Stable log-sum-exp `c + log(Σ exp(a-c))`: same `S` with no payload lanes, `finish=c+log(L)`. No R2 needed. This does not match an arbitrary nonlinear consumer of weights.
- One-pass raw moments for layernorm (`Σ x`, `Σ x²`) fit the tuple-sum part of R3 and R5 with componentwise `+` (unit zero and associativity per field). This computes statistics, not all normalized values before the mean is known. A centered second pass `Σ (x−mean)²` needs a different change-of-origin lemma; these rules do not synthesize Welford or license unstable variance subtraction.
- Returning the softmax matrix itself needs all `N²` observed values; a compact intermediate cannot eliminate the output or emit final probabilities before `L` is known. A contraction with `tanh(b/L)` also fails: changing the maximum/denominator no longer rescales the payload sum by a common factor. Equal shapes alone must never trigger the rewrite.

## GB10 decision experiment (proposed, not run)

**Hypothesis.** Starting only with the given source and the rules above yields a kernel that passes all gates, avoids global quadratic temporaries, and at `(N,D)=(2048,64),(4096,64)` on one GB10 beats unfused time and DRAM traffic while approaching an independently coded block fold. The comparison is against hand-written **f32 streaming**, not a vendor low-precision tensor-core path.

1. Keep three artifacts: unfused materialization of all Tix statements (reasonable tiled contractions); rule-derived block fold with the full trace; independent hand-written streaming CUDA. Same row layout, precision/score scope, resident buffers, inputs and compiler/math policy. Match timing boundaries (all kernels from q,k,v ready to o ready); exclude allocations, compilation and host copies. Give both streaming variants the same candidate tile set, e.g. `R∈{8,16,32}`, `B∈{16,32,64}`, discard resource-infeasible choices, select by median time on separate tuning inputs, freeze and check the selected trees. Record unfused tuning and resource limits too.
2. Use primary shapes above, plus `N=1,63,65,256,1024`, `D=32,64,128` to diagnose crossover and tails. Record GPU, clocks/power policy, software versions, launch/scratch configuration, seed and build flags. Warm resident inputs with 10 runs; collect 50 synchronized CUDA-event total times per shape/variant in interleaved order. Report median and interquartile range. Separately profile the same workload with a consistent documented cache condition, summing measured device DRAM read **and** write bytes across launches (also report L2 traffic, spills and peak allocated temporaries to distinguish causes). Probe profiler support on the GB10 before running; allocation counts or inferred source bytes cannot substitute for DRAM counters.
3. Predeclare success on **each** primary shape: median derived time ≤ `0.8 ×` unfused and ≤ `1.25 ×` hand-streaming; DRAM bytes derived ≤ `0.8 ×` unfused and ≤ `1.25 ×` hand-streaming. Report absolute times/bytes as well as ratios. Missing counters make the traffic claim untested. A legal witness outside tolerance, a missing local certificate, a surviving quadratic temporary, or a missed threshold refutes the corresponding claim even if another metric improves. Separate those failures: slow scheduling would not disprove the real identity. No modelled bandwidth or benchmark result is claimed here.

## Later

- Instantiate the certificates and evaluators when Tix IR and its reference contract land; no alternate frontend here.
- Lower and measure on GB10 when CUDA code generation and counters are available; no simulator performance proxy.
- Masks, dropout, backwards attention and mixed precision need separate domains and proof obligations.
- General reducer synthesis, arbitrary GPU scheduling and universal f32 error bounds are outside this experiment.
