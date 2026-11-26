---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-I
Status: review
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
    - Path: repo://src/framework/contracts/definitions.ts
      Note: Local structural invariant and transformation definitions
    - Path: repo://src/framework/contracts/differential.ts
      Note: Sampled invariant and caller-supplied evaluator and comparator
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Per-application contract ports and publication gate
    - Path: repo://src/typed/evaluate.ts
      Note: Existing exact-origin comparison pattern
ExternalSources: []
Summary: An ordered state fold, four local identities, f32 acceptance checks and a falsifiable GB10 trial
LastUpdated: 2026-11-26T13:00:34.142802383-05:00
WhatFor: ""
WhenToUse: ""
---

# Deriving streaming attention by checked rewrites

Four rewrites turn the given Tix program into a fold over key tiles. Each rewrite has a real-arithmetic identity and a mechanical check of the matched graph. Three also change f32 evaluation. Every resulting revision is compared with the same f64 evaluation of the original Tix program so that the checks do not spend the error budget again at each step.

## Domain and observation

The attention experiment supports one dense head, 1 ≤ N ≤ 8192 and 1 ≤ D ≤ 128, with all three inputs of shape [N,D]. Inputs are finite f32, with |q| and |k| ≤ 2 and |v| ≤ 1, inclusive. The caller supplies inputs in this domain. Rows and keys are indexed from zero. Even at the largest D, the real scores have magnitude at most 4√D. The f32 scores are finite, and a nonempty max-relative summary contains a key at its own maximum, so its normalizer is positive. The observable is the returned tensor's shape and all elements in index order. Intermediate tensor contents and representations are private to this function.

The f64 reference interprets the *original* program with the same scope, inputs, expression trees, and lexicographic reduction order, using double operations without f32 roundings. The trial tolerance requires the candidate to return the same shape and finite values, with |got − ref| ≤ 5×10⁻⁴ + 10⁻³·|ref| at every element. The absolute term covers near-zero outputs. These fixed thresholds are an experimental acceptance target, and passing sampled cases gives evidence only for those cases. The restriction on inputs and the stable exponentiation make this a bounded first trial. The full finite-f32 input domain would also require a policy for intermediate overflow and exceptional scores.

Two scope details matter in the starting graph. For a row, write **a_j** for the original score, which sums the terms **(q[i,d] × k[j,d]) / sqrt(D)**. Keep that f32 expression tree intact throughout. Write **V_j** for the vector v[j,:]. The source output sums **(e_j × V_j) / l** over j, with the division inside the sum. Vector expressions below are componentwise, and shape/index compatibility is checked even when the notation elides i and x.

## One IR extension

Add a typed state reduction to the tensor IR. In the notation below, **fold(j, init, emit, step)** evaluates **init** once, visits j in ascending order, and replaces its state by **step(state, emit(j))** at each visit. It returns the final state. Emit and step are pure, first-order IR regions with typed captures and a fixed state schema. The schema can hold scalar fields and a vector whose width is fixed by the shape environment, D in attention. Products, field projections and an explicit empty/nonempty state tag suffice. The tag and index arithmetic are discrete. In f32 evaluation, each scalar operation inside a region rounds as in Tix, including each vector component. Building, selecting or passing fields adds no rounding. An empty iteration returns exactly **init**.

A fold in the IR carries its evaluation order. The online-summary combine below is associative over reals on the specified summaries. It has a prescribed f32 operation tree and no f32 associativity promise. A schedule change must therefore be a checked rewrite. Scalar reductions alone cannot carry the dependent maximum, normalizer and numerator together. A generic unordered reduction over declared associative user functions would need an algebraic verifier and still leave floating-point order unspecified. An ordered state fold with the two concrete combiners below suffices.

## Rules and derivation

Apply the rules in this order. The matcher uses normalized index bindings and def-use edges, so renaming indices or tensors leaves the match unchanged.

### R1. Hoist invariant division

Rewrite **sum(j) (F(j,x) / L)** to **(sum(j) F(j,x)) / L**. Require L to be independent of j, finite and nonzero on the domain, and shape-compatible with the result. In this graph L is the sum of exponentials shifted by a finite maximum of a nonempty row. At least one summand equals one. Use one common L for every component.

Over reals, distributing multiplication by the constant 1/L gives Σⱼ Fⱼ/L = (Σⱼ Fⱼ)/L. In attention, take Fⱼ = eⱼ·Vⱼ and L = l. This leaves **o = p/l**, with **p = sum(j) e_j·V_j**. In f32 the source rounds each quotient and accumulates it. The replacement accumulates the rounded products, then rounds one quotient per output element. Check the scope, denominator witness and replacement exactly, and check the resulting f32 output against the original f64 reference.

The same rule also accepts **sum(j) ((E(j)/L)·V(j,x))**, including a capture-safe lookup of **E(j)/L** from a private softmax tensor used only by the contraction. Over reals **(E/L)·V = (E·V)/L** gives the same replacement, so the exact check also verifies the producer and its use boundary. In f32 this source first rounds a division and then a product, so apply the same f64 gate to the replacement.

### R2. Zip the weighted sums

Replace **l = sum(j) E(j)** and **p = sum(j) E(j)·V(j)** with a single fold initialized to **(0, 0-vector)**. Its emitter gives **(E(j), E(j)·V(j))**, and its step adds the corresponding fields. The sums must bind the same range in the same increasing order and use the same pure weight and index mapping. The weight is independent of the payload component index. Neither accumulator is visible to the emitter, and the replacement retains the two result projections and their uses. The zero-width payload variant computes the denominator alone.

Over reals, projection of a componentwise sum gives the original sum in that component. Here the result is **(l,p)**, still relative to the global maximum m, and the finalizer stays **p/l**. Each f32 accumulator starts at the same +0 and gets the same rounded summand and rounded addition in the same order as before. Sharing a pure weight evaluation cannot change its value. Check the iteration, initial state, emitter and projections exactly. This also gives bitwise equality with the previous revision, including signed zero. Keep the origin-based f64 tolerance gate on this revision too.

### R3. Use maximum-relative summaries

Match the zipped fold whose weight is **exp(a_j − m)**, with **m = max(j) a_j** over precisely the same key range. Require finite pure scores, a nonempty range, and a finite pure payload independent of the maximum, the weights and the fold results. For attention the private weight has no uses outside the matched sums, the private maximum has no uses outside the weights, and the score producer has no uses outside the maximum and weights. The score definition at [i,j] must be capture-safe to evaluate at a key inside the emitter, preserving its entire operation tree and its d reduction. Already supplied logits can instead be read by index. The log-sum-exp variant also allows a projection of the maximum in its finalizer.

For a nonempty set of keys A used by the fold, its real summary is

$$
m_A=\max_{j\in A}a_j,\qquad
z_A=\sum_{j\in A}\exp(a_j-m_A),\qquad
u_A=\sum_{j\in A}\exp(a_j-m_A)V_j .
$$

The empty tag is a two-sided identity. Combining two nonempty summaries uses the following expression tree, evaluating each scale once.

$$
m=\max(m_A,m_B),\qquad
\alpha=\exp(m_A-m),\qquad \beta=\exp(m_B-m),
$$
$$
\operatorname{merge}(A,B)=(m,\ \alpha z_A+\beta z_B,\ \alpha u_A+\beta u_B).
$$

For adjacent disjoint segments A and B, the new maximum is their union's maximum. For each j in A, exp(a_j − m) = exp(m_A − m)·exp(a_j − m_A). Factoring the first term from A's sums and doing the same for B gives both fields of the merged summary. Consequently any parenthesization of a sequence of genuine summaries represents the same union over reals. The empty branch returns the other state directly and performs no arithmetic.

Replace global **m**, the weights and the zipped sums by **fold(j, empty, (a_j, 1, V_j), merge)**. For a single key the exponent is zero, so the emitter gives exactly its real summary. By induction the final state summarizes the whole row, with **z=l** and **u=p** over reals. Keep the same final division, now **u/z**. The old **s**, **m**, **e**, **l** and **p** definitions are removed as their uses are replaced, and the emitter computes each needed score on demand. The bit pattern of the score calculation itself is preserved. The f32 weights and sums can change because subtracting maxima, exponentiating scales, multiplying partial sums and accumulating are now done at different rounding points. Small terms can become subnormal or round to zero, especially in the weighted payload. Check the graph, exact summary schema, emitter, merge and finalizer, and apply the f64 tolerance gate.

### R4. Tile the summary fold

Partition the ordered key range [0,N) into consecutive blocks **[bT,min((b+1)T,N))** for **0 ≤ b < ceil(N/T)** and a positive integer tile width T. Replace the singleton fold by **fold(b, empty, blockSummary(b), merge)** in increasing b. Require this specific singleton emitter and merge from R3, exact coverage of keys in order, and an unchanged finalizer. Compute each block's scores once into local scratch. The emitter finds its max and computes its z and u by the defining maximum-relative sums above. In the f32 schedule it visits valid keys in increasing order for the max and for both sums, with the Tix identities. Each weight is evaluated once from that block's max. The outer fold uses the R3 f32 operation tree. A short last block visits only its valid keys.

Over reals, a block emitter produces the same summary as a fold over its singleton summaries by the R3 union law. Folding over the blocks therefore gives the whole-row summary, and the final division is unchanged. In f32, weights are computed relative to a tile maximum, partial sums group additions differently, and scales apply once per tile rather than once per key. Check the partition and block emitter against the summary definition exactly, then check the f32 result against the f64 origin. A singleton fold would already stream, but a tile makes it possible to reuse K and V across queries and to process independent score and payload components in parallel.

The end result is one increasing loop over key blocks for each query tile. Each row carries the running maximum, scalar normalizer and D-component numerator. A block's scores and weights live only as long as the block emitter needs them.

```text
for each row i in the query tile
  state[i] = empty
for each key block b in increasing order
  for each row i in the query tile
    state[i] = merge(state[i], blockSummary(i, b))
for each row i in the query tile
  o[i, :] = state[i].u / state[i].z
```

## Mechanical checks in the workbench

Use one **definePass** application per rule with the incoming revision on the **input** port and the immutable source revision on **origin**. A **defineInvariant** over input and output validates the application against a rule-specific template. Re-match the old graph, check the side conditions and compare the rebuilt replacement modulo bound-index renaming. Check the surrounding def-use boundary and exact retained expression trees so an unrelated edit cannot pass as part of the same application. The four identities above are the argument for trusting those templates. The checker inspects each application and requires no search for identities about arbitrary user code.

Use **differential()** as a second invariant, with **origin** as baseline and **output** as subject. Provide the original f64 evaluator, the candidate f32 evaluator and the tolerance comparison above through the existing callbacks. A recorded case succeeds only when its observation was evaluated and met the relation. Use a fixed versioned case suite and report the rule and revisions, matched indices, shape, seed and first failing element with expected, actual and error. Compare every candidate with the original because adjacent tolerance comparisons can accumulate error. The **applyPass** publication gate already supports these contract ports. A single contract on the final fusion would lose the step that introduced a bad match or excess error. No generic framework change is needed for the two invariants. The smallest Tix-specific additions are the ordered fold and an evaluator for its region expressions and state. [Pass integration](../../../../../../src/framework/passes/define-pass.ts), [sampled invariant](../../../../../../src/framework/contracts/differential.ts), [Typed origin example](../../../../../../src/typed/evaluate.ts).

On Node 24.18.0, a scalar probe with e = [1,1,1], l = 3 and v = [1,1,−0.25] produced 0.5833333730697632 before R1 and 0.5833333134651184 after it. A second probe added two tiny f32 weights to 1 individually and as a group. The results were 1 and 1.0000001192092896. These witness rounding effects from hoisting and regrouping.

## Reach of the rules

These are algebraic matches. The numerical trial below is scoped to the attention domain above.

| Source pattern | Result and boundary |
| --- | --- |
| Stable softmax followed by a contraction over its key axis | R1 hoists the private softmax producer's divisor. R2–R4 then work for pure finite logits and a fixed-width payload with the same indexing and private uses. Packed inputs or finite bias inside the score expression fit the same algebra. Each specialization needs its own numerical domain and trial. |
| Stable log-sum-exp **m + log(sum(j) exp(a_j−m))** | Start at R2 with zero payload width, then use R3–R4 and return **m + log z**. The global maximum is replaced by the maximum from the same summary. The finalizer and its f32 rounding are unchanged in shape. |
| Layernorm statistics expressed as **sum x** and **sum x²** | R2 uses **E=x, V=x** and computes both raw moments in one traversal. Variance from raw moments can lose accuracy by cancellation. The centered-variance form needs a different rewrite to eliminate its dependency on the mean, and writing the normalized row still needs the input values. |
| Softmax returned as a full tensor | Each key needs a separate observable output using the final normalizer. The fixed-width contraction state cannot emit these elements in one pass. A second read or recomputation of logits is possible. |
| Materialized attention weights consumed elsewhere, or weights used by a nonlinear or key-coupled consumer | The use boundary fails or the consumer lacks the weighted-sum factorization. This rule set cannot erase those weights. |
| Mask encoded by −∞ or a row with no valid key | The finite-score and nonempty-row premises fail. A mask-aware key domain and observation for empty rows need a separate specification. |

## GB10 experiment

**Hypothesis.** From the given Tix source, the four rules will derive and accept a CUDA-streamable form whose generated kernel meets the fixed numerical gate on the trial suite. For **(N,D) = (4096,64)** and **(8192,64)** on the GB10, its median GPU time will be at most **0.75×** that of the unfused lowering and at most **1.25×** that of an independently written streaming kernel. Its measured DRAM bytes per invocation will be below the unfused lowering's at each primary shape. Predeclare these criteria, the input seeds and the timing protocol.

- Compare the original unfused lowering with separate materialized score and exponential tensors, the derived lowering from the accepted R4 revision, and independently written streaming CUDA. Use row-major inputs, f32 throughout, and the score expression as parsed. For the derived kernel, start with one thread block per eight query rows and 32 keys per tile. Keep q and the running state local to the thread block, share each K/V tile across its rows, and reuse scratch across tiles. Preserve each ordered reduction in the derived IR. Match the baseline and hand kernel on input layout, precision policy and tolerance. The hand kernel can choose its own thread layout and tiling. Require separate multiply and add, gradual underflow and no fast-math modes for the trial. Device exponentiation may differ from rounding the JS double result, so run the same f64 observation check on device outputs. Record the compiler configuration and check the generated artifact for the declared operation and memory policy.
- Exercise all four revisions on a deterministic suite crossing N = 1, 2, 31, 32, 33, 63, 64, 65, 257 with D = 1, 7, 64, 128. Include zero scores, ties, maxima in the first and last blocks, successive increases, bounded random inputs, large score gaps, subnormals and mixed-sign or cancelling payloads. Verify that a mismatched key extent, a dropped tail, an extra weight consumer and an omitted rescale fail the structural checks using mutated applications. At the GPU timing shapes, use one fixed seeded input per shape and check every returned element from each of the three kernels against the common f64 reference outside the timing window. Report maximum normalized error and counterexamples.
- Measure device elapsed time for the complete invocation, including all launches of the unfused lowering. Preallocate memory and keep inputs resident. Warm up each implementation for 20 invocations, then interleave 30 batches per implementation of 10 invocations each. Report the median per-invocation device time and dispersion across batches. Measure DRAM read plus write bytes in separate profiler runs, summing all launches per invocation. Record software versions, launch configuration, hardware and clock conditions. Report L2 traffic if supported and report actual S/E buffer sizes separately. Include N = 1024 and 2048 at D = 64 as secondary points to show the scaling trend.

Eliminating the N×N buffers removes their writes and reads and leaves O(ND) global tensor storage and O(ND) compulsory input/output traffic. It still does O(N²D) arithmetic. With Bq query rows per thread block, separate blocks can request O(N²D/Bq) K/V data across the grid before cache reuse. The design makes no linear DRAM-traffic claim for fixed on-chip capacity. The measured-byte comparison tests the benefit of the eliminated intermediates on this device.

Failure to derive the tiled fold from the given source or an alpha-renamed copy refutes the derivation claim. A failed numerical application check or an out-of-tolerance device result refutes the corresponding numerical claim. Either timing ratio outside its bound or DRAM bytes at or above the unfused measurement on a primary shape refutes the corresponding performance claim. If the profiler cannot expose DRAM bytes on the target, that part of the hypothesis remains untested. A direct compiler special case for attention could target the same kernel, but it would not test whether these reusable identities suffice.

## Later

- Integrate the parallel Tix front end, f32/f64 evaluators and meaning contract, then add the state fold and its four checked passes.
- Add the Tix CUDA lowerings and the independent hand kernel, probe target compiler controls and profiler counters on GB10, then run the trial.
- Add masked, causal and multihead variants after defining their key domains and observables.
- Compare a two-pass recomputing control and tune tiles or precision after measuring the first trial.
- Study centered layernorm with a stable variance combine and certify error bounds beyond sampled evidence.
