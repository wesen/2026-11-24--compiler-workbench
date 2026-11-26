---
Title: Stage 1 design for Tix tensor programs
Ticket: IRWB-020-L
Status: review
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Standalone differential acceptance and evidence
    - Path: repo://src/framework/ir/adapters.ts
      Note: Versioned artifact capture and projection validation
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native pass runner and eager edit
    - Path: repo://src/typed/evaluate.ts
      Note: Typed differential gate
    - Path: repo://src/typed/passes.ts
      Note: Native pass and transformation definitions
    - Path: repo://src/typed/project.ts
      Note: Origin-based checked pipeline
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T13:01:11.309826639-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 1 design for Tix tensor programs

Tix compiles to an immutable tensor artifact. A single interpreter runs the artifact in f32 or f64. Two native passes exercise the v6 pass machinery and a sampled meaning contract. The fixed synchronous optimization API exposes a framework gap. The existing native pass route also requires an edit adapter even when the pass never edits the logical projection.

## Source and call domain

The source domain is the fixed Tix grammar in [the ticket request](../reference/01-diary.md#prompt-context). Functions are independent entry points. Tensors are single-assignment in statement order, so reads and returns resolve to parameters or earlier definitions. Tensor names and shape names have separate namespaces. Index binders have lexical scope and unique IDs. A reduction may shadow an enclosing binder. Duplicate names in the same index list are errors.

A small token lexer and precedence parser handle comments, source locations, scalar expressions and affine expressions. Affine arithmetic supports integer coefficients, addition, subtraction and grouping. Reduction bodies parse at the lowest precedence up to an enclosing delimiter. For `max`, a name list followed by a body is a reduction and two scalar arguments are a call. The overlapping spelling `max(A,B) - x` is subtraction from the call when both bare arguments resolve to shape names. Grouping the unary body as `max(A,B) (-x)` spells the reduction in that case. The local parser keeps this rule and the error spans in one place. A parser generator would add a dependency for the same lookahead and precedence decisions.

Normalize each dimension and coordinate to a constant plus a sorted map of integer coefficients. Infer a binder's extent from bare index references and require agreement on the normalized shape expression across all such uses. Check statement annotations and the return type the same way. A result binder without a bare use needs its statement's declared dimension. A reduction binder has no annotation fallback. A single extent per symbol is insufficient for expressions such as `2*N+1` in an input axis. Instead, check that the affine input axes determine every shape name uniquely by rank over the rationals. Use exact integer arithmetic for rank and for solving the concrete axis equations. Emit source errors with one-based `line:col` at the conflicting or unresolved use, declaration or return.

A call uses finite values in row-major `Float32Array` or `Float64Array` storage with matching element counts. Shapes have nonnegative safe integer extents, including zero, and the input equations have a consistent, nonnegative integral solution for the shape names. Concrete tensor extents must fit the same range. Check each affine access using the minimum and maximum over its rectangular binder ranges, taking the coefficient's sign into account. For example, `y+dy` with extents `H-2` and `3` ranges from zero to `H-1` when the region runs. Use the full enclosing region to identify empty iteration domains. Reject source contradictions visible from the normalized extents and bounds during compilation. Discharge remaining shape-dependent access and extent conditions when actual shapes are bound, before indexing. A general symbolic integer inequality solver would move more of these checks to compile time. The proposed split keeps exact checks on concrete calls with a smaller checker.

## Tensor IR and evaluation

`TixProgram` is a v6 `Artifact<TensorIR>`. The versioned `tensor.tix` payload is ordered functions, parameters, statement definitions and result bindings. Each statement carries its ordered result binders with resolved extents and a scalar expression tree. Expressions represent numerical literals, shape values, affine reads, scalar operations and scoped reductions. A flat reduction records the operator and an ordered list of binders with extents. A blocked sum retains the original binder and body and adds the block size. This representation exposes loops and their numeric evaluation order without representing a reduction as a mutable accumulator program. Keeping the unchecked syntax tree would force each rewrite and evaluation to recover lexical bindings and extents.

Use `defineIR`, `defineAdapter` and `createIRArtifact` with the same native validator. The validator checks resolved definitions, binder scope, extents, read ranks and return signatures. It checks the supplied iteration domains of transformed expressions without re-inferring them from surviving reads. Project functions, parameters and statements with stable IDs, containment edges and tensor-read dependencies. Include the body as statement attributes so any rewrite of an expression appears in the v6 diff. Source spans serve compile diagnostics. Literal tokens and affine coefficients stored as decimal strings keep the payload canonical finite JSON. Typed arrays, exceptional values and signed zero stay in evaluation data. A projection with an entity per scalar node would make local edits possible, but the two passes already work on native trees and can declare their writes at statement granularity.

Bind concrete shapes once and evaluate statements in order into row-major typed arrays. The f32 evaluator rounds input elements on ingress, every literal and shape value, each scalar operation and built-in result, and each reduction update with `Math.fround`. A flat reduction has a single accumulator across the entire lexicographic traversal, with the first binder outermost. Start sums at positive zero and maxima at negative infinity. Use the JavaScript `Math` operations, including `Math.max` and `Math.min` for signed zero and NaN. Canonicalize NaN when writing f32 storage to the quiet NaN word `0x7fc00000`, giving exceptional outputs stable bits across storage and inlining. The default precision is f32. The f64 mode uses the same evaluator, loop order and operations with JavaScript doubles and `Float64Array` storage. Two independently written interpreters would create two implementations of domain binding and iteration. Use hand-computed and independent loop references in tests to check those shared paths.

## Meaning contract

The contract is a versioned v6 `DifferentialSpec`, executed by `runDifferential`. Check every public function. Generate one deterministic suite from the pipeline's starting artifact and reuse it for every pass in that call.

- Try uniform shape-name assignments from `0, 1, 3, 4, 5, 7, 8, 9` and an asymmetric assignment cycling through `2, 3, 5` in source order. Constant signatures contribute their concrete shape once. Filter and deduplicate concrete calls using the origin's shape checks. The sample budget caps each tensor at 4,096 elements and origin scalar work at 100,000 expression visits per call, counted from the concrete loop extents. A function without a usable case prevents acceptance of a changed revision.
- For each shape, use all ones, mixed-sign multiples of `1/16` in `[-1, 1]` from the framework generator with seed 7, and sparse values including signed zero and small positive terms. For the sparse rounding case, cycle the flat sequence `[1, 0, 0, 0, 2^-25, 2^-25, 2^-25, 2^-25]`. These inputs are exactly representable in f32, isolating evaluation error from input conversion. A seed and function, shape and pattern identify a case.
- Observe the returned shape and each row-major result element. Exact comparison uses the f32 words, including the sign bit of zero. Tolerance compares candidate f32 to the origin's f64 on each element. For finite reference `r` and finite candidate `c`, accept when `abs(c-r) <= 1e-5 + 2e-5 * abs(r)`. Match nonfinite references by NaN or signed infinity. A case the origin can run and the candidate cannot run disagrees. Record the first failing coordinate and words or values, with exceptional numbers formatted as strings.

An exact comparison would prohibit reassociation. A relative-only tolerance is too strict for cancellation near zero, while a single absolute bound scales poorly for contractions. At f32 unit roundoff `2^-24`, a sum of nine already-rounded terms of absolute value at most one has a standard rounding bound below `5e-6`. For four-element blocks the longest addition path for nine terms is at most seven updates. The absolute term leaves headroom near zero and the relative term allows scaling through the corpus. This is a sampled acceptance envelope for whole outputs, with no error theorem for arbitrary composition or conditioning. A valid reassociation can still miss the envelope.

The pipeline retains the previous accepted artifact on rejection and continues in the requested order. A no-op is an accepted identity. `inline` compares candidate f32 against the preceding artifact, using the same origin-derived cases. If a tolerant pass already changed the answer, bit identity preserves its accepted observation against origin f64. `split-sum` always compares to the pipeline origin's flat f64 evaluation, even after a previous tolerant step. This avoids accumulating a fresh tolerance at each step. Comparing every step to the origin in f32 would reject an exact inline after a successful reassociation. The public result projects each attempt to `{pass, accepted}`. The pass runner retains differential evidence for targeted tests.

## Passes

- **inline** finds a reduction-free statement with exactly one static read occurrence in a later statement. A return is a use, and a returned producer stays materialized. Substitute the producer's result binders with the consumer read's affine coordinates and compose affine reads in the body. Preserve expression order and the consumer's resolved extents. Remove the producer and update dependencies. Use stable binder IDs to preserve scope if the consumer read is inside a reduction. Repeat for newly exposed single uses so a chain can collapse in one invocation. Text substitution looks simpler but cannot reliably preserve binder identity or affine coordinates. Use the exact gate.
- **split-sum** rewrites each flat single-binder sum that can span several blocks into a blocked sum with block size four. Start an inner f32 accumulator at zero for each consecutive block, reduce its elements in order, then add that partial to a zero-initialized outer accumulator. The final block ends at the original extent. Empty domains produce zero. Maxima and sums with multiple binders keep their existing order. A materialized partial tensor would add temporary storage and require a new shape operation for ceiling division. The explicit reduction node needs only the original bound. Use the tolerance gate.

## Framework changes proposed

| Location | Change and reason |
| --- | --- |
| `src/framework/passes/define-pass.ts` | Add `applyNativePassSync` for synchronous native kernels with a required synchronous check. The kernel receives the input artifact, view and parameters, without opening an edit. Reuse candidate creation, diff, correspondence and write-set validation with the existing native-result branch. Return the candidate only after its check succeeds, carrying the evidence in the pass result or rejection. The supported profile has no managed analyses, preservation claims, transformation contracts or shared IR store. |
| `tests/framework/ext-e3-e6.test.mjs` | Check that a read-only projection supports the new native path, writes are checked before the gate, and a false gate rejects with evidence. Exercise the existing async path in the same suite. |

Typed's `runPipeline` uses `definePass` and the async `applyPass` with an `AnalysisManager`; its gate wraps a differential invariant in `defineTransformation`. The manager and strategy interpreter return promises even when the evaluator is synchronous. Changing the return of `optimizeTix` would violate the fixed API. A parallel synchronous manager would duplicate lifecycle support for facts, effects and correspondence guarantees. The small native entry instead requires a pure synchronous gate, backed in Tix by the existing standalone differential runner. The existing pass barrel exposes the runner. The contracts, core, IR, dataflow and strategy modules need no edits. The read-only projection also avoids a dummy `rebuild` implementation just to satisfy the existing native path's eager `beginEdit`. [Typed pipeline](../../../../../../src/typed/project.ts) · [Pass runner](../../../../../../src/framework/passes/define-pass.ts) · [Differential runner](../../../../../../src/framework/contracts/differential.ts)

A Node 24.18.0 probe on the built worktree exercised an artifact, a native pass and a managed differential postcondition. `applyPass` and `verifyTransformation` returned promises. A read-only adapter failed at `beginEdit` with `ir.capability`; a Rewritable adapter reached acceptance and its rebuild callback was never invoked. Direct `runDifferential` ran synchronously and produced both verdicts for the rounding witness below. The probe also checked the f32 word view on signed zero and exact integer arithmetic with `BigInt`.

## Corpus and verification

| `corpus/tensor/<name>/main.tix` | Test focus |
| --- | --- |
| `matmul` | Rectangular `[M,K] × [K,N]` and a contraction checked by an independent loop. |
| `softmax` | Row max subtraction, exponentiation and division. Exercise large logits and row sums. |
| `layernorm` | Centered variance, epsilon inside the square root, gamma and beta. Check a constant row and a nonconstant row. |
| `attention` | Single-head query-key scores scaled by `sqrt(D)`, row softmax and the value contraction. Use distinct query, key and value extents where appropriate. |
| `mlp` | Two affine layers with tanh-GELU between them. Use asymmetric dimensions and nonzero biases. |
| `conv2d` | NCHW cross-correlation with a `3×3` kernel, stride one, no padding and declared output extents `H-2,W-2`. Compare against a direct convolution loop with asymmetric spatial dimensions. |

Test the public API from `dist/tensor/index.js`. Cover location errors, greedy reduction bodies, call versus reduction, repeated and conflicting index extents, affine shape binding and bounds, nested binders, lexicographic multi-index order, and independent f32/f64 examples. Run all six corpus programs and check the public optimization sequence. Include passes in both orders, retained revisions on rejection and a no-op.

| Gate test | Expected decision |
| --- | --- |
| Inline a single-use producer read inside a reduction with permuted or shifted coordinates. | Accept under exact. Check the producer was removed and the returned words match, including a signed-zero case. |
| Change an inlined addition to subtraction while keeping the artifact valid. | Reject under exact, with the first mismatching result. |
| Split `sum` on `[1,0,0,0,2^-25,2^-25,2^-25,2^-25]`. | Exact rejects flat `0x3f800000` versus blocked `0x3f800001`. Tolerance accepts `1.0000001192092896`, which equals the flat f64 reference. |
| Mutate a blocked sum with a fixed extent of seven to stop at four. | The tail-drop candidate is structurally valid. With ones it returns four against the f64 reference of seven, so tolerance rejects. |

Run `npm run build`, `node --test tests/tensor/`, `node --test tests/framework/` and the Typed pass and strategy regressions in `tests/typed/passes.test.mjs` and `tests/typed/strategies.test.mjs` after implementation.

## Later

- CUDA lowering and GPU execution.
- Fusion, contraction tiling and attention-specific rewrites.
- Proofs, worker execution, caching and strategy plans are outside the Stage 1 checks. The bounded direct runner is enough for the two pass experiments.
