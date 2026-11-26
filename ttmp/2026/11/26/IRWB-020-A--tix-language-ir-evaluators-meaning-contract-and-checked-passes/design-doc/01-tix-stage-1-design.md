---
Title: Tix Stage 1 Design
Ticket: IRWB-020-A
Status: active
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Synchronous sampled comparison and counterexample evidence
    - Path: repo://src/framework/ir/adapters.ts
      Note: Native artifact validation, hashing and logical projection
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native candidate validation, write enforcement and the asynchronous edit-backed pass runner
    - Path: repo://src/typed/project.ts
      Note: Typed checks successive revisions against the original program
    - Path: repo://tests/framework/ext-e3-e6.test.mjs
      Note: Existing native pass and strategy regression tests
ExternalSources: []
Summary: Indexed tensor IR, f32 and f64 evaluation, sampled pass acceptance, and the synchronous native pass proposal.
LastUpdated: 2026-11-26T13:50:07.010969984-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix Stage 1 Design

Tix compiles index notation into a v6 artifact with explicit iteration domains and ordered scalar expressions. The f32 interpreter defines source meaning. The same loop traversal with f64 arithmetic supplies the reference for `split-sum`. The fixed synchronous API needs one framework addition. The pass layer will share its existing native-candidate preparation and add a synchronous entry point that can require a sampled contract before returning a revision.

## Source and input domain

- A program is one or more distinct functions in the supplied grammar, with `//` line comments. Each takes one or more named, rank-one or higher f32 tensors. A function contains an ordered list of single assignments. References resolve to parameters or earlier assignments, and the return names a tensor whose dimensions match the function's declared result. Unique tensor names, scoped reduction binders and distinct indices per binder list make references unambiguous.
- Shape expressions and subscripts are integer affine expressions. Normalize them to a constant plus integer coefficients on shape names or scoped index IDs. Tensor axes and iteration extents are nonnegative safe integers. An affine parameter signature must jointly determine all its shape names. At each call, each input has its declared rank and shape under that binding, and its finite `Float32Array` or `Float64Array` has exactly the row-major element count. The supported sizes fit the host typed arrays. Empty axes are allowed.
- General syntax and source-shape errors are diagnosed by `compileTix` at 1-based line and column. Concrete consistency can be checked only once `runTix` receives shapes. For example, `x: f32[N], y: f32[N]` is a valid signature, and the concrete axes must agree. By comparison, a pointwise statement using the same plain index on `x: f32[N]` and `y: f32[M]` has conflicting symbolic extents at compile time.
- Parse with a location-aware lexer and recursive descent for precedence. A reduction recursively parses a full expression up to its enclosing delimiter. In particular, the divisor in `sum(d) x[i,d] / D` is inside the fold. For `max`, a parenthesized list of bare names followed by an expression starter introduces a reduction. In the ambiguous `max(N, M) - x[i]` spelling where both names are in scope as scalar shape values, prefer the binary call. Parenthesize a negative reduction body to select the reduction in that case. This resolves the overlap using function signature names without adding tokens.
- Infer each index extent from plain subscript uses that resolve to that binder, including occurrences inside nested reductions. Every plain witness for a binder must yield the same normalized affine extent. A statement annotation supplies the extent of any unwitnessed left-hand index and must match any witnessed extent. A reduction binder requires a plain witness since the annotation contains only left-hand axes. This allows `x[n,c,y+dy,x+dx]` when the output annotation supplies the spatial extents and the kernel supplies plain witnesses for `dy` and `dx`.
- Check rank and affine access bounds with the full index scope at each read. For a subscript `k + Σ aᵢ iᵢ`, its minimum uses `Eᵢ-1` for negative coefficients and its maximum uses `Eᵢ-1` for positive coefficients, where `Eᵢ` is the binder extent. Prove both bounds under the declared nonnegative extents and the positive enclosing extents needed to reach that read. An empty enclosing loop makes the access unreachable. For example, with output extent `H-KH+1`, the maximum of `y+dy` is `H-1`.
- Bind shape names from parameter axes. Repeatedly take an axis with one unresolved name, substitute the known names, and record that axis as the name's binding witness. This supports bare names and affine offsets or coefficients, including chains where one binding exposes the next. Compile-time diagnostics identify names that require a coupled solve. At runtime, read each witness axis, solve its one-variable equation with integer arithmetic and check the other parameter axes. Shape names take nonnegative safe integer values. Reject statically negative constant dimensions and names in result or statement types absent from the input signature.
- Check affine bounds by simplifying the differences between the access interval and the tensor bounds. An inequality holds when its normalized coefficients and constant are nonnegative, directly or after subtracting one known nonnegative extent or an enclosing extent minus one. A statically empty enclosing loop makes the read unreachable. This covers the convolution and constant-width crops without a general constraint solver. Stage 1 gives a diagnostic when this rule cannot establish an access, including some access patterns that a stronger proof could accept. The IR retains the dimensions of tensors and loops it executes. Removed temporary declarations require no retained shape constraints.

## Artifact and evaluators

`src/tensor/` will contain the front end, IR and adapter, evaluator, contract and passes. `compileTix` produces a `TixProgram` with the original and current `Artifact<TensorModule>` (initially the same). `runTix` evaluates the current artifact. `optimizeTix` carries the same original artifact across calls and returns the last accepted current artifact plus one acceptance boolean per requested pass. The entry point emits the specified API from `dist/tensor/index.js`.

Use `defineIR` and `defineAdapter` for `tensor.module@1` and create revisions using `createIRArtifact`. The native value is ordered single-assignment tensor definitions with expression trees. A function stores its signature, shape binding witnesses, parameter IDs, ordered definitions and return ID. Each definition holds a result shape, ordered output binders and scalar body. A read names a tensor ID with affine subscripts using resolved binder IDs. A reduction stores its operator, ordered binders with explicit extents and its body. The optimized IR has a blocked-sum node with a binder, extent, body and block size. Store literal spellings as strings so artifact hashing never normalizes a semantically relevant floating-point bit pattern. Native validation verifies references, index scopes and dimension forms. The compiler proves source access bounds. The evaluator checks each actual axis before reading, so a malformed pass candidate cannot silently read an adjacent row. Source checking separately infers the extents demanded by the surface syntax.

The v6 projection exposes function, parameter, statement and return entities with stable IDs. Statement attributes carry the indexed expression and extents. Containment, tensor reads and the return value are relations. A statement retains its identity and source order key when a neighboring statement is deleted. The same validator serves the IR type and adapter. An AST alone would require recovering binders and extents in both passes. A CFG or per-expression graph would add reconstruction work. Expression trees inside ordered tensor definitions give both passes the information they need and make the loop order explicit.

Evaluate each statement into a fresh, row-major typed array. Iterate output coordinates and reduction indices in the stored order, with the first index outermost. In f32 mode round input loads, literals, shape values and every scalar result with `Math.fround`. Use JavaScript arithmetic and `Math` functions as specified, and round each accumulator update. Each sum starts at `+0`, and each max starts at `-Infinity`. Keep signed zero, infinities and NaNs produced by arithmetic. Return a `Float32Array`. In f64 mode use the same iteration order and scalar operations with JavaScript numbers and `Float64Array` storage. Load f64 inputs as given and widen f32 inputs. A source artifact produces the sequential f64 reference. An optimized artifact in f64 mode evaluates its current grouping. Sharing loop traversal and selecting the rounding operation is simpler than maintaining two walkers with independent indexing behavior.

## Meaning contract

Reuse the synchronous `runDifferential` per function with two versioned tensor `DifferentialSpec`s and their comparison callbacks. The exact baseline is the pass's input revision in f32. The tolerance baseline is always the original artifact in f64, even after several accepted passes or separate `optimizeTix` calls. Every invocation generates the same cases from the original signature. An exact step following a tolerant step must preserve every sampled bit of its input on those cases, so it inherits the prior comparison to the original. Checking tolerance against the latest f32 revision would allow error to accumulate across accepted steps.

**Cases.** Check every callable function. Enumerate uniform assignments from `0,1,4,5,6,2,3,8,9` in that order, then up to 512 mixed assignments over the same values from the framework's seeded generator with seed 7. Derive concrete shapes from the parameter signature and skip bindings that make any original tensor or loop extent invalid. A signature with no shape names has one fixed binding. Take the first six eligible distinct uniform bindings and then the first distinct mixed bindings until there are eight. Fill any remaining slots with unused uniform bindings in order. If the selection has only empty outputs, replace its last binding with the first eligible nonempty binding found during the search. Every selected binding gets all-positive-zero, all-negative-zero, all-one, row-major alternating-sign, seeded f32 values in `[-1,1]`, and the repeated half-ULP pattern `[1,0,0,0,2^-24,2^-24,0,…]` along each input's last axis of length at least six. A changed artifact needs at least one selected binding per function.

Each sampled tensor is limited to 4,096 elements. Screen original evaluations for at most 100,000 scalar expression, output and logical reduction iterations per case. Give the current and candidate evaluators the same logical counter, plus an allowance for one outer block visit per logical inner term. The executor structurally enforces that allowance by only iterating nonempty blocks. A split changes physical loop overhead while preserving the charged term count, even at the original cap. Candidates that exceed the logical budget fail the check. The same shape and value selection applies to both relations and to every step and call on the program. A corpus-only input list would leave independent Tix sources unchecked.

**Observation.** Compare the returned shape and every row-major output element. Include the function, shape binding, input pattern or seed, and first differing coordinate with bits or numerical error in counterexample evidence. Store evidence in canonical data using strings for nonfinite values and bits. An aggregate norm could hide a single wrong output element.

| Relation | Requirement |
| --- | --- |
| Exact | Shapes match and each element has the same uint32 bit pattern in the f32 output buffers. In particular, `+0` and `-0` differ. Used by `inline`. |
| Tolerance | Shapes match. For a finite f64 reference the f32 candidate is finite and `abs(candidate - reference) <= 1e-5 + 1e-5 * abs(reference)`. A NaN reference requires NaN, and an infinite reference requires infinity of the same sign. Used by `split-sum`. |

The absolute term allows small reduction-order errors when the sum nearly cancels. The relative term scales with a larger reference value. For a direct sum of up to nine terms bounded by one, eight f32 additions have a first-order absolute error bound of about `9 * 8 * 2^-24 ≈ 4.3e-6`. The threshold leaves room at that scale and remains far below a unit term lost in the tail witness. Compound expressions may amplify error and the checker can reject a valid reassociation for those samples. A pure relative bound would give no allowance at zero. The tolerance is an acceptance policy for the sampled domain, with no claim of an error bound for arbitrary programs or shapes.

## Passes and discriminating tests

Both passes use `definePass`, with declared v6 writes and native tree results. Each requested pass proposes one module revision containing its eligible rewrites. A no-op is an accepted step. A contract rejection leaves the current revision in use for the next step.

- **`inline`.** In source order, find a non-returned pointwise producer (no reduction) referenced at exactly one syntactic read. Recompute read counts after each removal and continue until there are no more eligible producers. Substitute its expression at the read, composing its output binders with the consumer's affine subscripts. Resolved IDs avoid capture even under nested reductions. Remove the producer. Keep the original expression tree and the f32 operations at its nodes. A materialized f32 value is already rounded and loading it adds no new arithmetic. Projected writes are statements, containment and reads. Replacing only same-name, identity-index reads is simpler but would miss a permuted read. Test permutation under a reduction and a signed-zero result. A wrong inline variant ignores a square tensor's index permutation. The generated row-major alternating-sign tensor at fixed shape 2×2 exposes the changed off-diagonal bits.
- **`split-sum`.** Replace a one-index sum of extent `E` with ordered blocks of four. Each block folds indices `4*b` through `min(4*b+4,E)-1` from `+0`. The outer loop folds the block results from `+0` in block order. Empty domains return `+0`. Leave max, multi-index sums and existing blocked sums alone. Only the statement body's projected attributes change. A single dedicated IR node expresses the two levels and clipped tail without introducing storage for partial sums. Test lengths 0, 1, 4, 5 and 6, and check that a second application is a no-op. For a fixed length-six sum, `[1,0,0,0,2^-24,2^-24]` gives sequential f32 bits `3f800000`, blocked bits `3f800001`, and an f64 reference exactly equal to the blocked result. Check the same candidate through both relations. The exact one rejects and the tolerance one accepts. A wrong variant omits the final partial block. On six ones its f32 result is 4 and the reference is 6, so the tolerance check rejects.

Exercise the deliberately wrong native rewrites through the same framework pass gate using test-local definitions and the production-generated cases. The tests assert the pattern named in the rejection evidence. Check the rejected candidate was structurally valid and that the public pipeline returns a runnable accepted artifact. Also check repeated optimization calls and an exact inline after a split to exercise the two reference anchors.

## Framework finding and proposed change

| Framework location | Fits today | Proposed change and reason |
| --- | --- | --- |
| `src/framework/core/`, `src/framework/ir/` | Artifact identity, canonical data, adapter validation and projection fit indexed tensor definitions. | None. Keep input and output buffers in the evaluator and contract cases. |
| `src/framework/contracts/` | `runDifferential` accepts domain-provided cases, distinct per-side evaluation and a comparison callback. Its sampled evidence can represent exact or tolerant comparisons. | None. The contract lives in the tensor domain. The framework's asynchronous transformation manager is unnecessary for these effect-free checks. |
| `src/framework/passes/define-pass.ts` | `applyPass` already creates and validates native candidate artifacts, diffs their projections, checks declared writes and builds correspondence. The public entry point and its manager verification return promises. It also opens an edit before calling the kernel, requiring a graph `rebuild` even for native results. | Extract the synchronous native-candidate preparation and write-checking steps for reuse by `applyPass` and a new `applyNativePassSync`. Take a `Pass` defined by `definePass` and require a synchronous `(before, after) => CheckResult` gate. This path rejects declared analysis needs, preservation claims and manager-backed contracts. The existing pass context supplies the input, view and parameters. Accessing its edit property fails immediately, so the runner never opens a graph edit and a validated adapter with a read-only projection can participate. Validate the gate result with the existing contracts `Check` type. Use the normal `PassResult` and preserve failed-check evidence on `PassError`. |
| `src/framework/dataflow/`, `src/framework/strategy/` | Neither pass has a CFG analysis requirement or a scheduling decision beyond the requested order. The strategy interpreter is itself asynchronous. | None. |

A direct tensor-local loop calling the rewrite functions and `runDifferential` would satisfy the timing of the API, but would either bypass v6 candidate enforcement or duplicate it in a domain. Making the whole transformation manager synchronous would expand the change to analysis, effects, and transactions. The native path shares the portion Tix exercises. Add focused framework coverage to `tests/framework/native-pass-sync.test.mjs` for a native adapter without `rebuild`, diff/correspondence, undeclared writes and rejection before a changed artifact is returned. The existing asynchronous tests cover its shared preparation.

A repository build with Node `v24.18.0` succeeded. A probe against `dist/framework` found the edit capability requirement. With a rebuilding adapter, `applyPass` returned a Promise and produced a native entity diff. On that candidate `runDifferential` immediately returned disagreement under exact comparison and agreement under tolerance. A separate arithmetic probe confirmed the f32 witness bits, the distinct signed-zero bits and the dropped-tail failure. The tensor pipeline and synchronous pass entry point are proposed.

## Corpus and implementation checks

| `corpus/tensor/<name>/main.tix` | Computation and focused check |
| --- | --- |
| `matmul` | `A[M,K] · B[K,N]`. A nonsquare hand-computed product checks axis order and contraction extent. |
| `softmax` | Row max, shifted exponential, row sum, normalization. Include large common offsets and check row totals. |
| `layernorm` | Per-row mean and population variance, a positive `1e-5` literal inside the square root, then per-feature gamma and beta. A constant row must yield beta. |
| `attention` | Single head. Scaled query/key dot products, max-shifted softmax per query row and contraction with values. Use different query and key lengths. |
| `mlp` | Two affine layers with biases and tanh-GELU between them, using `0.5*x*(1+tanh(sqrt(2/pi)*(x+0.044715*x*x*x)))` with a literal square-root coefficient. |
| `conv2d` | NCHW input, OIHW weights, stride 1 and no padding. Declare output spatial axes `H-KH+1`, `W-KW+1`. Use an asymmetric kernel and multiple channels to check subscript order and bounds. |

Build the checker and artifact, add both evaluator modes, then implement the common pass path and the negative witnesses. Add corpus checks with independent expected values. Front-end tests cover the two reduction-body parses, `max` disambiguation, conflicts, missing extents, affine bounds and diagnostics. Evaluator tests cover precision, lexicographic order, empty reductions and row-major shape. After implementation run `npm run build`, `node --test tests/tensor/*.test.mjs`, `node --test tests/framework/*.test.mjs`, and the Typed suites covering the changed native path, starting with `passes.test.mjs`, `meaning-memo.test.mjs` and `strategies.test.mjs`.

## Later

- Lower to CUDA and run on the GPU machine.
- Add fusion.
- Add contraction tiling.
- Add attention-specific rewrites.
