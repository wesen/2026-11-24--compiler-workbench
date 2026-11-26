---
Title: Research design for deriving streaming attention
Ticket: IRWB-021-B
Status: complete
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
      Note: Deterministic cases and a domain-specific comparator
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Per-application pass verification and extra origin input
    - Path: repo://src/typed/passes.ts
      Note: Existing pipeline binding the original artifact in an ensures invariant
ExternalSources: []
Summary: Check a local rewrite derivation from Tix attention to a streaming tuple reduction and measure it on GB10.
LastUpdated: 2026-11-26T12:44:58.260331896-05:00
WhatFor: ""
WhenToUse: ""
---

# Research design for deriving streaming attention

Derive attention as a fold over key blocks. Each block contributes its maximum score and two sums measured relative to that maximum. A checked combine rescales those sums when the running maximum increases. The experiment asks whether a compiler can produce this schedule from the original index expressions, with a checkable derivation and performance close to a hand-written kernel.

## Supported input and observation

The experiment supports unmasked, single-head forward attention with f32 inputs `q[N,D]`, `k[N,D]`, `v[N,D]` and output `o[N,D]`. The domain is integer `1 ≤ N ≤ 4096`, `1 ≤ D ≤ 128`, with finite f32 input elements in `[-1,1]`, including signed zeros and subnormals. The bound keeps scores, accumulators and results finite. In particular, a score term has magnitude at most 1, every centered exponential is at most 1, and a nonempty segment contributes a weight of 1 at a maximum. Its normalizer is therefore at least 1, including under the specified f32 fold. Intermediate tensors are pure bindings. The observation is the returned shape and all its elements.

The generalization examples below describe real-algebra matches on nonempty finite rows. The numerical domain and tolerance here qualify only the attention experiment.

## Tuple reduction in the IR

Add one internal construct, `fold(i in I, identity, combine, body)`, over a finite ordered integer range. The body produces a fixed-shape product of f32 scalars, vectors of statically known extent after shape binding, or a tagged empty value for the centered summary. The pure binary combine receives two values of that type and returns one of the same type. The body may capture enclosing indices and tensors, and the combine uses only its operands and shape constants. Ordinary tuple construction and projections let downstream expressions consume its fields. The source grammar stays unchanged.

For f32 evaluation, visit indices in increasing order, evaluate each body, and apply `acc = combine(acc, body(i))` starting from the identity. Round every floating operation and function result using the Tix rule. Tuples, tags and projections introduce no floating operations. Nesting folds explicitly describes blocking, and every fold retains its declared order. Over the reals the same IR uses exact arithmetic. A combine need not be associative in f32. A regrouping rule requires an approved real associativity and identity argument on reachable states, plus the tolerance gate. Initially there are two domain templates, componentwise addition and the centered combine below. A general user-defined combine would require a way to validate its algebra before regrouping. A stream operator specific to attention would be simpler to lower, but it would hide the distinction between packing, changing the centering and blocking that the experiment tests.

For a fixed query row, abbreviate the score and payload as `a(j) = s[i,j]` and `w(j) = v[j,:]`. For any nonempty segment `A` of keys, define its canonical summary
```text
M_A = max over j in A of a(j)
L_A = sum over j in A of exp(a(j) - M_A)
U_A = sum over j in A of exp(a(j) - M_A) * w(j)   # componentwise
S(A) = (M_A, L_A, U_A)
S(empty) = Empty
```
The combine `⊕` returns the other operand if one operand is `Empty` and returns `Empty` if both are empty. For two nonempty summaries `(m,l,u)` and `(n,h,z)`, use
```text
p = max(m, n)
r = exp(m - p)
t = exp(n - p)
combine = (p, (r*l) + (t*h), (r*u) + (t*z))
singleton(j) = (a(j), 1, w(j))
```
Each product and addition is distinct in the f32 IR. Handling `Empty` by a tag avoids an infinite sentinel entering a subtraction. For disjoint segments `A` and `B`, the identity `exp(a(j) - p) = exp(a(j) - M_A) * exp(M_A - p)` holds for each `j ∈ A`, and likewise for `B`. Sum it with payload 1 or `w(j)` to obtain `S(A) ⊕ S(B) = S(A ∪ B)`. This proves the combine preserves canonical summaries and is associative on summaries of disjoint segments, with `Empty` as identity. A checker uses this one lemma for any width of `U`.

## Rewrite rules

Each rule matches a typed def-use slice. The checker independently reconstructs the replacement from the captured expressions and checks the inserted expressions, bindings, and edits outside the slice. It checks shapes, index scope and dependence, use counts where producers are removed, and the stated algebraic preconditions. Exact f32 rules preserve the expression tree and the sequence of rounding operations for each observed value. The common check against the original f64 program runs after all six rules.

| Rule | Match, side conditions and local real argument | Additional f32 check and source of differences |
| --- | --- | --- |
| **R1 Pull out the divisor** | Replace `sum(j) ((e(j)*w(j))/l)` by `(sum(j) e(j)*w(j))/l`. Also match `sum(j) ((e(j)/l)*w(j))` through a pure weight binding. Remove the optional weight binding only if it becomes dead. The divisor is independent of `j` and positive. Discharge positivity by recognizing the nonempty max-shifted exponential sum above. Multiplication by the constant `1/l` distributes over the sum, and commutes with `w(j)` in the weight form. | Tolerance. Per-term division becomes one division after accumulation. Rounding and underflow occur at different points, even for a row of tied scores. |
| **R2 Pack aligned sums** | Pack sums with the same ordered `j` range into one product-valued fold with componentwise addition and a zero of each component's shape. Each summand may depend on `j` and free output axes of its own component, but never on the other fold accumulators. Project the fields at the original uses. By induction on the ordered range, each projection equals its original partial sum. | Exact. Every lane begins at f32 +0 and adds the same rounded operands in the same order. |
| **R3 Localize the exponential center** | Match `m = max(j) a(j)` and a packed sum on the same nonempty range with bodies `exp(a(j)-m)` and `exp(a(j)-m)*w(j)`. The payload component may be omitted. All occurrences of `a` must have the same binding and indices. The payload is pure and independent of the maximum, exponential weights and fold state. Replace the max and packed sum by the projections of `fold(j in J, Empty, ⊕, singleton(j))`. The combine lemma gives `S(J)` by induction, with the same global maximum and sums. For the complete elimination of weights, require every use of the matched exponential binding to be accounted for inside this slice. | Tolerance. Whole-row exponentiation gives way to rescaling partial sums as the maximum changes. Exponentiation, multiplication and repeated rescaling round, and small weights can underflow at different points. Seeding the first payload directly can also change the sign of a zero. |
| **R4 Partition the key fold** | Replace the singleton fold by an outer fold of inner singleton folds over consecutive blocks. With block width `B > 0`, block `b` is `[bB, min(N,(b+1)B))` for `0 ≤ b < ceil(N/B)`. Verify ordered, disjoint, exhaustive coverage and attach the real associativity and identity lemma for the combine. The partition changes only parentheses in a fold of the same elements. | Tolerance. New block boundaries change addition grouping and the sequence of rescalings. The f32 fold is not associative even with tied scores. |
| **R5 Compute one summary per block** | Replace the inner singleton fold of R4 with `blockSummary`, the canonical fields `M,L,U` on that same block. Match the inner fold's exact map and combine. Use the same block-local score expression for the maximum and weights. The combine lemma gives the canonical fields for the inner fold by induction, and the expanded block expressions implement their definitions directly. | Tolerance. Local weights now use the block maximum from the start. The block sums are still left folds, but the inner fold no longer rounds rescalings of previously accumulated terms. |
| **R6 Inline the tile producers** | Substitute the pure tensor element definitions needed by a block in its local scope, then delete dead tensor bindings. Redo the binding and shape checks after substitution. For attention the score producer is indexed by exactly the enclosing row and block key, and no use of the square tensors may escape the rewrites. Substitution of a pure definition at a use preserves its value. | Exact. Stage each score once in a block-local binding and reuse it with the same f32 expression tree. The scoped evaluation keeps every score's `d` fold and its division unchanged. |

## Derivation of the supplied attention

1. Start at the parsed source. The score is `sum(d) ((q[i,d] * k[j,d]) / sqrt(D))`. The output is `sum(j) ((e[i,j] * v[j,x]) / l[i])`. Both divisions start inside their reductions because a Tix reduction body extends to the statement terminator.
2. Apply R1 to the output only. Set `u[i,x] = sum(j) e[i,j]*v[j,x]` and `o[i,x] = u[i,x]/l[i]`.
3. Apply R2 to `l,u`. For each row, fold `(e[i,j], e[i,j]*v[j,:])` by componentwise addition. Project `l,u` and keep the final division.
4. Apply R3. Replace `m` and the packed fold by the centered singleton fold, and remove the now-dead weight definition. The result has fields `(m,l,u)`. The output uses `u/l`.
5. Apply R4 with `B = 32`, including a short final block. Apply R5 to the inner fold. The outer fold keeps one running summary and merges one canonical summary per block.
6. Apply R6. Compute the score expression into block-local storage, use it to construct the block weights and summary, then discard the block storage after the merge. Remove the dead standalone score binding.

For each row the final schedule is
```text
running = Empty
for J in contiguous key blocks in increasing order:
    a[j] = sum(d) ((q[i,d] * k[j,d]) / sqrt(D))  for j in J
    b = max over J of a[j]
    e[j] = exp(a[j] - b)                       for j in J
    h = sum over J of e[j]
    z = sum over J of e[j] * v[j,:]
    running = running ⊕ (b, h, z)
return running.U / running.L
```
The max and sums may traverse tile scratch separately. Each query row advances through the key blocks once. A CUDA lowering can assign a tile of query rows to each thread block, reuse the current key/value tile across those rows, and keep their running summaries and score scratch on chip. It needs no global score or weight tensor. Working tile sizes, the live state and the storage plan belong to lowering. The expressions and dependencies come from the rewritten IR. A recognition pass that emits a hand-written attention kernel would be shorter, but it would not establish the individual rewrite claims.

Removing the score and weight tensors changes auxiliary global allocation by eliminating `Θ(N²)` storage. The two streaming kernels have `Θ(ND)` input and output footprint and compulsory traffic. With a query tile of `B_q` rows, independent thread blocks can request `Θ(ceil(N/B_q) · ND)` key/value bytes before cache reuse. Device-memory traffic must be measured and can exceed the compulsory traffic.

## Acceptance against the original program

Use the immutable original core program as the f64 reference for every candidate. Evaluate it with the original expression tree and lexicographic reduction order on the same f32 input values, using double arithmetic without f32 rounding or output conversion. Compare the candidate's f32 return to that f64 result. For each element with reference `r` and candidate `c`, require both to be finite and
```text
abs(c - r) ≤ 5e-5 + 5e-4 * abs(r)
```
Require identical output shapes. The absolute term allows cancellation near zero, and the relative term scales with the reference. This proposed budget is fixed before running the experiment. The tolerance relation treats both signs of zero as equal. For R2 and R6 also compare predecessor and candidate on the same cases with f32 element identity, including signed zero. This supplements the exact structural argument with an evaluator cross-check. Test the source's own f32 output against its f64 reference on this corpus before checking candidates, so a failure of the proposed budget on the source is visible.

Compare with the original at every step because tolerance is not transitive. A comparison against just the preceding revision could accept drift. Both the local real argument and all prescribed comparisons must pass before accepting a changed revision. The local checks establish the rule's real equality on the supported domain. Finite differential cases give evidence for the f32 budget, not a uniform bound over that domain.

Use deterministic, versioned cases shared by all steps. Cross `N ∈ {1, 2, 3, 31, 32, 33, 63, 64, 65, 127, 128, 129}` with `D ∈ {1, 3, 64, 128}`. Include fixed-seed uniform f32 inputs in the domain, tied scores, maxima that rise across blocks, equal maxima in different blocks, and mixed-sign payloads that nearly cancel. Include extrema and subnormal inputs and larger rows in the GPU matrix below. Record the version, shape, seed or named fixture, original and candidate revisions, worst normalized error and first failing coordinate and values. Encode candidate nonfinite outputs as disagreements. An incomplete required case leaves the revision unqualified. As a negative control, change a candidate merge to omit the old summary’s rescale. The local checker must reject the changed expression. For a numerical negative control use `N = 33, D = 1`, all queries 1, the first 32 keys and values `(-1, 1)` and the final key and value `(1, 0)`. The reference output is `32*exp(-2)/(32*exp(-2)+1)`, about 0.8124. Omitting the old summary’s scale gives `32/33`, about 0.9697, which must fail the gate.

The worktree already has the required pass contract mechanism. Use one `definePass` / `applyPass` application per rule with the predecessor bound as `input` and the original supplied in `contractInputs.origin`. A relational `ensures` invariant can check the replacement and its guards using the input and output revisions. A second `ensures` uses `differential()`, with `run` selecting f64 for the origin and f32 for the candidate and `compare` implementing the tolerance above. The exact f32 supplementary check binds the predecessor as its baseline. A domain invariant can require complete case coverage, since the generic differential helper can accept an agreeing run with some inconclusive cases. This route reuses native validation, write declarations, correspondence and rejection before a candidate is passed onward. A single compound pass would provide fewer revision boundaries and would hide which algebraic step or rounding change caused a failure.

## Generality and limits

| Program | Result of the same rules |
| --- | --- |
| Stable softmax followed by a weighted contraction over the softmax axis | R1 also handles a normalized-weight binding used inside the contraction. R2–R6 then stream the contraction for any pure, independent payload of fixed width, if scores and weights have no escaping uses. |
| Stable log-sum-exp | Pack only the normalizer and specialize the summary to `(m,l)`. R3–R6 yield `m + log(l)` after the final block. For core Tix the source has to expose the stable max-shifted form. |
| Layernorm with sum and sum of squares already expressed on the same row axis | R2 alone packs the two moments into one traversal. Producing the normalized row still reads the row after the statistics are known. A two-pass centered variance depends on the completed mean and needs a different rewrite and error argument. |
| Softmax returned as a whole row, or attention also returning its weights | Each output weight needs the final normalizer and its own score. The small summary loses per-key information, so these rules cannot eliminate storage or avoid a second score traversal. |
| Contraction with different reduction axes, or value terms depending on the final normalizer beyond the common divisor | R2 requires identical aligned ranges and R3 requires a payload independent of the global softmax statistics. Their proof templates do not apply. Unshifted `log(sum(j) exp(a(j)))` likewise has no matched center. |

## GB10 experiment

**Hypothesis.** The six-rule trace will derive an attention kernel with no square global intermediates. Each required case will pass the checking gates. At both primary shapes, median GPU elapsed time for the derived kernel will be at most 0.50× the unfused lowering and 1.25× the hand-written streaming kernel, and total device-memory bytes read plus written will be at most 0.70× the unfused lowering.

Measure `N ∈ {512, 2048, 4096}` and `D ∈ {64,128}` on the GB10, with `N = 4096` at both widths as the primary comparison. Start with a query tile of 16 rows and key blocks of 32. Give the derived and hand-written streaming variants the same tile dimensions, layout, input and output types, and f32 arithmetic policy. The unfused variant implements the source and materializes both square intermediates. Check the device output of all three against the f64 origin on one fixed-seed tensor triple per benchmark shape, plus the smaller correctness corpus. Preserve the per-term score division and the IR fold order in the CUDA lowering and disable arithmetic contraction and fast math for the initial comparison. CUDA implementations of transcendental functions and subnormal handling can still differ from the host. The device output gate tests those differences directly. This controlled baseline measures derivation and lowering overhead. A peak-speed vendor kernel could use a different precision or math policy and would not isolate that overhead.

Keep buffers device-resident, preallocate scratch, and time the entire sequence of kernels that produces the output using GPU elapsed time. Use 20 warmups and 100 timed repetitions per variant and shape, interleave variants, and report medians and 10th–90th percentiles. Time without profiling instrumentation. In separate runs, count bytes at the device-memory interface over the same kernel sequence, recording the actual counter definition, alongside global temporary allocation and any detected spill traffic. Record GPU and toolchain versions, launch configuration, math flags, inputs, and timing conditions with the results. Allocation size alone cannot measure bytes moved. If device-memory counters cannot be collected, the elapsed-time claim can still be tested and the traffic claim remains untested.

A required rule failing to match or qualify, a generated square intermediate, a required numerical failure on source or device, or any primary measured ratio exceeding its stated threshold refutes the corresponding claim and rules out a positive result for the joint hypothesis. The experiment reports the first failed gate or threshold along with the remaining measurements that could be completed.

## Later

- Add the tuple-fold node, validation and local proof templates to the Tix adapter when the parallel front end and evaluators are available.
- Bind the proposed domain and tolerance to the Tix contract when that work lands.
- Add CUDA lowering for the explicit block schedule and run the GB10 experiment once the backend is available.
- Qualify other numerical domains, operator families, and Welford-style variance as separate experiments.
- Explore masks, batching, mixed precision, tensor cores, and schedule tuning after the fixed-schedule comparison.
