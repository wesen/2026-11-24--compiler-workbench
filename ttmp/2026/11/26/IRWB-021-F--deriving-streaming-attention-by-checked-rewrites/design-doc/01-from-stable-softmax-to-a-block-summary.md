---
Title: From stable softmax to a block summary
Ticket: IRWB-021-F
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
      Note: Baseline and subject interface for sampled contract evidence
ExternalSources: []
Summary: A local proof of the block recurrence and an experimental test of its numerical and GPU costs.
LastUpdated: 2026-11-26T00:00:00Z
WhatFor: Decide whether to compile stable exponential contractions by checked rewrites.
WhenToUse: Before implementing the Tix optimizer or benchmarking a streaming schedule.
---

# From stable softmax to a block summary

**Claim to test:** the compiler need not recognize attention. It needs to recognize sums that share an exponential weight and whose base (the subtracted maximum) can be changed. The result is an identity over the reals, not permission to reassociate Tix f32. Keep the proof certificate and the numerical acceptance test separate.

## One new internal operation

Use an ordered `fold(range, identity, map, combine; tree)` returning a product of scalars and fixed-shape vectors, with projections. Ranges are finite half-open intervals; the map may read the enclosing row and immutable inputs. State has a fixed type per shape binding, never indexed by the length of the reduced interval. Map and combine are typed, pure expressions. A tagged empty state is allowed, with lazy case selection. No new surface syntax is required. A scalar fold cannot carry both scale and mass, much less the value-weighted mass. An attention intrinsic could do this but would hide exactly the transformation we want to test.

The tree specifies every combine, its left/right order and the position of the identity: default is a left fold from identity in increasing index order; an empty fold returns identity. A nested fold can map consecutive ranges to summaries. Over the reals, a registered identity/associativity lemma permits changing the tree on reachable states. A user's assertion of associativity does not suffice. In f32 **the tree is semantics**: evaluate leaf expressions, selected case bodies and each scalar coordinate with the core's per-operation rounding, including `exp`, with no implicit contraction. Projection and packing do not round again. Never infer f32 associativity from the lemma. Parallel evaluation of independent coordinates is free; changing their internal accumulation order is not.

## Rewrite trace and local certificates

Fix row `i`, let `J=[0,N)`, `u_j[x]=v[j,x]`. The notation below describes expressions in the internal IR, not additions to Tix grammar. Each arrow is an individual candidate program with the same observable return. Keep a witness (rule ID, matched SSA nodes, binder/extent substitution, side-condition evidence, before/after subgraphs, schedule if any). A verifier rematches the template, checks freshness, shapes, free indices, use lists and specified side conditions and reconstructs the replacement under the unchanged context. The only non-structural facts needed are the identities below. No search for a floating-point invariant of the entire loop.

1. **Expose producers (R1).** Replace a reference to a pure SSA definition by its RHS at the referenced indices, renaming bound indices to avoid capture; retain a shared local `let` when needed. Require in-bounds identical domains and identical operator trees/iteration order. Drop a binding only after its last use. Substitution in a deterministic function preserves each element, even in f32. Apply to expose `a_j = sum(d) ((q[i,d]*k[j,d])/sqrt(D))`, `M=max_J a_j`, `w_j=exp(a_j-M)`, `L=sum_J w_j`. The actual final expression is `sum_J ((w_j*u_j[x])/L)`. In particular do **not** move the score division past `sum(d)`. These local names denote shared expressions, not mandated allocations.

2. **Extract invariant divisor (R2).** Rewrite `sum_J (t_j/c)` to `(sum_J t_j)/c`; also allow a single factor in `t_j` to carry the division, e.g. `(w_j/c)*u_j`. Check `c` independent of the bound index, finite and nonzero on domain; use linearity and `(w/c)u=(wu)/c`. Here the maximum is attained on nonempty `J`, so one weight is 1, all others are positive over the reals and `L>=1`. Now `o[x]=P[x]/L` with `P=sum_J w_j*u_j`. This changes the number and position of rounded divisions, including the scale at which small terms can underflow.

3. **Pack common-range moments (R3).** Bundle independent sums with identical bounds into a product sum: `sum (w, w*u)` with coordinatewise addition from zeros. Each projection is the original ordered sum by induction on prefix length; packing is f32-exact with the same term expressions. Include the shared base in the returned tuple. The result is `o[x]=S(J).P[x]/S(J).L`, where, for any nonempty interval `I`, the matched subgraph is

   ```text
   S(I) = let m = max_{j in I} a_j in
          let (l,p) = sum_{j in I} (exp(a_j-m), exp(a_j-m)*u_j) in
          Present(m,l,p)
   ```

   A single vector `u_j` covers arbitrary payload coordinates; no payload may depend on the chosen base or on another moment. Scope `S(J)` outside `x` because it contains all coordinates. Missing `p` is a valid zero-coordinate product. For empty intervals define `S(∅)=Empty`, not a literal tuple whose exponent uses −∞.

4. **Split a base-changing summary (R4).** Replace `S(A ++ B)` by `merge(S(A),S(B))` for an ordered disjoint contiguous cover, same scores and payload, intervals possibly empty. With either operand empty return the other untouched. Otherwise take `h=max(mA,mB)`, `rA=exp(mA-h)`, `rB=exp(mB-h)` and return

   ```text
   Present(h, rA*lA + rB*lB, rA*pA + rB*pB)
   ```

   The union maximum is `h`; for every `j` in `A`, `exp(a_j-h)=exp(a_j-mA)*exp(mA-h)` and likewise for `B`. Distribute the constant through each sum, including each signed payload coordinate. Thus the merge returns *exactly the defining summary of the union*. Both associations of three reachable summaries return `S(A++B++C)`; empty is a two-sided identity without evaluating `−∞−(−∞)`. This is a local template lemma, not a proposed arbitrary monoid prover. In f32 there is a new subtraction/exp at each rescale, separately rounded products/adds and a different sum tree; even a contribution that rounds to zero at one base might not have done so at another.

5. **Tile and fold (R5).** For positive integer `B`, substitute intervals `I_b=[bB,min((b+1)B,N))` for leaves; replace `S(J)` by `fold(b,Empty,S(I_b),merge; left)`. Check consecutive cover, clipped tail, and R4's certified homomorphism. This is repeated R4: after block `b` the accumulator summarizes the prefix ending at its right endpoint, by identity then the split lemma. Compared with the explicitly left-nested splits the loop is exact even in f32; compared with unsplit `S(J)` or a different schedule it needs tolerance checking. Unlike a singleton-only loop, this permits a tile of scores to amortize K/V loads and exponentials. Changing even `B` makes a new checked candidate.

The resulting schedule, for each resident group of query rows, is: load Q; initialize one empty accumulator per row; visit each K,V block once for this group; compute the row/block scores in the original `d` order; compute local `m`, then local `(l,p)` using scratch, merge and discard scratch. Finally write `p/l` once. Singleton blocks give `Present(a_j,1,u_j)` over the reals. The carried `p` is *unnormalized*: merging two already divided outputs by these coefficients alone is wrong. No global score or weight store remains if there are no other live consumers (require this for the storage claim). Local maxima and sums can scan on-chip scratch twice without scanning the global key stream twice. Schedule must fit query tile, K/V tile, accumulator and score scratch in registers/shared memory; spilling is a measurable cost, not part of the proof.

## Acceptance contract

For this research trial bind matching shapes `1<=N<=4096`, `1<=D<=128`, all inputs f32, `|q|,|k|<=4`, `|v|<=1`. These bounds give real scores at most `16 sqrt(D)` in magnitude, shifted exponents nonpositive, masses at most `N` and numerator magnitudes at most `N`; there is ample f32 overflow headroom even with rounding. Finite inputs alone do not ensure finite dot products. Select this optimization only under the stated contract. Observation: returned tensor shape and every output coordinate, not memory allocation or the internal state.

Pre-register as a trial relation: equal shapes and finite results with `|candidate-reference| <= 2e-4 + 2e-4*|reference|` independently at every coordinate. Absolute error matters for cancellation. Reference is the **unchanged source** on exactly the same f32 inputs widened to binary64, evaluated in its written order with f64 operations; it is not a mathematical oracle for all real inputs. First qualify the original f32 evaluator against it. For R1 and R3 require exact adjacent f32 agreement (including zero sign) in addition to the structural proof; for R2, R4, R5 require the local real certificate and the sampled tolerance gate. Every intermediate, including exact rewrites, and the final GPU kernel must pass against the same original f64 output. Tolerance does not compose; comparing adjacent candidates alone could silently spend the budget several times. A strictly exact-f32 contract does not authorize this pipeline.

Use `src/framework/contracts/differential.ts` as the existing baseline/subject invariant interface: plug in the parallel Tix evaluators and tensor comparator when available. Record origin/candidate revisions, rule witness, tree, seed, case index, worst absolute error and first failing coordinate, expected/actual and replay inputs. Require every scheduled case decided; do not count missing GPU runs as successes. Sample fixed seeds 21–25 on uniform bounded inputs, and directed fixtures: `N,D=1`, lengths just below/at/above block size, non-power-of-two D, all scores tied, increasing/decreasing and late block maximum, repeated maxima across a boundary, ±4 scores' input factors producing underflowed weights, and alternating ±1 payloads with nearly zero answer. Include largest shapes. Check the split locally on empty, singleton and unequal-length summaries too. Negative matcher tests: divisor depends on `j`, changed score between max and exp, overlapping tiles. Disable fast math, FMA contraction, TF32 and flush-to-zero for the trial; CUDA transcendental results may still differ from JS, hence test the emitted kernel. Replay a failure with the named schedule; reject rather than loosen tolerance after seeing results. Passing samples is evidence, not a uniform f32 error bound.

## Transfer test

- A stable row softmax used only in a linear contraction matches by R1, the factor form of R2, then R3–R5. Scores can include a pure finite row/key bias. No dot-product matcher is needed.
- Stable log-sum-exp `M + log(sum exp(a-M))` uses R3–R5 with no payload; keep the original finalizer. The unstable spelling `log(sum exp(a))` needs a separate stabilization rule.
- Parallel raw layernorm statistics `sum x, sum x²` admit R3 and ordinary componentwise additive tiling (R5's homomorphism is distributivity over concatenation); not R4's exponential law. Centered variance written using the completed mean does not match. Deriving Welford or guaranteeing small variance error is not a corollary.
- Returning the full softmax vector needs each old score again after the final maximum/mass; a fixed-size summary cannot emit those probabilities in one pass. A nonlinear payload such as `tanh(exp(a-M))` fails R4's change-of-base identity. Decline these matches rather than erasing a live tensor.

## GB10 decision experiment (not run)

Compile the literal source three ways: unfused SSA materialization; the witnessed rewrite chain with tiled schedule; independent hand-written blocked f32 CUDA computing the same function. All three must pass the contract. Use identical resident row-major inputs, math settings and output layout on one GB10; record driver/toolkit, clocks, actual tile sizes, register/shared usage and spills. Give both streaming variants the same tile search budget (query rows 8/16/32, keys 16/32/64, feasible configurations only); select on a separate seed and freeze before measuring. No compilation, allocation or host transfer in the timed region; do include every unfused kernel launch. Time with GPU events, 10 warmups then 50 synchronized trials per shape/variant, interleaved order. Report median and interquartile range. In separate profiler runs collect device DRAM read+write bytes summed across kernels, with identical cache policy (evict before each measured trial using a buffer larger than last-level cache, outside timing). Report peak global scratch from allocation plan as a separate number.

Sweep `N=256,1024,2048,4096`, `D=32,64,128`; include a tail case `N=1025`. Primary endpoint fixed in advance: at `(4096,64)` derived median time <=80% of unfused and <=125% of hand-written, and derived DRAM bytes <=75% of unfused. Require no global `N×N` allocation in derived code. Any unmet threshold, failed checked rewrite, or in-domain counterexample refutes the corresponding claim for this design. Separate failure of matching, numerical acceptance, spilling, and compute-bound timing in reporting. A missing GB10 measurement leaves the performance hypothesis unanswered.

The linear claim is about compulsory input/output volume and absence of quadratic intermediate traffic, **not** an unconditional DRAM bound. With `R` resident query rows, K,V requests alone are about `2*ceil(N/R)*N*D` words before cache reuse; fixed on-chip capacity need not permit O(ND) actual transfers. Arithmetic remains O(N²D). This is why the experiment measures bytes as well as wall time rather than inferring either from tensor lifetimes.

## Later

- Instantiate certificates and the proposed fold in the Tix IR once the parallel front end and evaluators land.
- Run the pre-registered GPU comparison once a Tix CUDA lowering and GB10 are available.
- Broader input ranges, mixed precision, masks/backward attention and additional moment laws need separate contracts.
