---
Title: Tix Stage 1 Design
Ticket: IRWB-020-T
Status: review
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Synchronous sampled invariant evaluation
    - Path: repo://src/framework/ir/README.md
      Note: Artifact creation and native adapter capabilities
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native candidate preparation and declared write checks
    - Path: repo://src/typed/project.ts
      Note: Existing managed pipeline and origin contract binding
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T13:44:50.505436649-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix stage 1 design

Tix compiles to a checked, symbolic tensor artifact. A single interpreter executes it in f32 or f64. The two
passes produce native candidates and share the framework's artifact, IR comparison, declared-write checking,
and sampled differential machinery. The sole proposed framework change is to extract the native candidate
preparation already used by `applyPass`, so a synchronous host can use it before running a pure invariant.

## Source and call domain

- A module has one or more named functions with at least one parameter each. Parameters and assignments are
  rank-one or higher f32 tensors, assignments are ordered and single-assignment, and a return names a parameter
  or a preceding assignment. Functions are independent entry points. Names are function-local except entry
  names. References address tensors, with no calls to other Tix functions.
- Parameter axes are positive integer literals or bare shape names. Repeated shape names bind the same
  extent. Statement annotations and result axes use normalized integer affine expressions in those bound names.
  Subscripts use integer affine forms of active index binders. Normalize to a constant and sorted
  coefficients with exact integer arithmetic during checking. Coefficients and constants must fit safe
  integers for storage. A product of two symbolic terms is outside this subset.
- Calls supply row-major Float32Array or Float64Array data under the declared parameter names. Extents are
  positive safe integers, all instantiated axes and their element counts are representable, and tensors fit
  host allocation. Shape assignments must make all declared and inferred extents positive. Elements are
  finite, including after f32 conversion when running in f32 mode. Arithmetic can still produce infinities,
  NaNs and signed zeros.
- `compileTix(source)` returns a `TixProgram`. `runTix(program, fn, inputs, options?)` returns
  `{shape, data}`, with f32 as default and the matching typed array for the chosen precision.
  `optimizeTix(program, passes)` takes `inline` and `split-sum` in caller order and returns
  `{program, steps: [{pass, accepted}]}` synchronously. A rejected candidate is discarded and the next pass
  uses the last accepted artifact. A pass with no applicable rewrite is an accepted identity.

### Parse, resolve and check

Use a tokenizer with one-based line and column and a recursive-descent precedence parser. Keep token spans
through checking. Binary levels parse left-associatively, unary minus binds tighter, and a reduction recursively
parses a full expression bounded by the enclosing delimiter (statement semicolon, closing parenthesis or scalar
call argument delimiter). Thus `sum(d) x[i,d] / D` places division in the body, and wrapping the reduction in
parentheses puts division outside. Skip `//` comments. Parse numeric literals as finite JavaScript doubles;
negative numbers are a unary node over the literal.

For `max`, a parenthesized list of bare binder names followed by a body is the reduction form. Otherwise
parse the two-argument scalar call. In the ambiguous `max(D,E) - x[i]` form, prefer subtraction from a scalar
call when both bare arguments are bound shape names. Parenthesizing the reduction body after the binder list
makes a negative body explicit. A parser generator is unnecessary for these few precedence levels and would
add a dependency just to handle the greedy reduction body and this distinction.

Resolve tensors and indices to stable IDs. Reduction binders have lexical scope, may shadow an outer binder,
and must be distinct within one binder list. Bind extents from bare subscript occurrences, including
occurrences inside nested reductions when they refer to the outer binder. Every bare occurrence of a binder
must infer the same normalized extent. An output index with no bare occurrence gets its extent from its
annotation. A reduction binder with no bare occurrence has no annotation slot and fails inference. A bare
binder followed by arithmetic such as `i + 0` is an affine occurrence for inference, even when it normalizes
to `i`. Check annotation and declared return axes by normalized equality.

For each subscript, derive its minimum and maximum from the box `0 <= i < extent(i)`. For a negative
coefficient, use the binder's upper endpoint in the minimum, and for a positive coefficient use it in the
maximum. Require both the minimum and `axisExtent - 1 - maximum` to be provably nonnegative. Use constant
folding, the fact that shape names are at least one, and lower bounds `extent - 1 >= 0` from checked tensor
axes. Recognize a whole bound or one such axis bound plus an affine expression nonnegative using shape
lower bounds alone. This covers `H - 2` with a three-element kernel and the symbolic convolution case
`(H - KH + 1 - 1) + (KH - 1) == H - 1`. A general integer solver would admit more equivalent range proofs.
This subset needs only normalization and the small sufficient test above.

The lexer or parser reports an unexpected token or number at its span. The checker reports the offending
name, axis or subscript for duplicate or unknown names, rank or shape mismatch, unsupported affine form,
missing or conflicting extent, or an unproved access bound. Each source diagnostic is an ordinary
`Error` with `line:col`. The compiler rejects contradictions it can see in source, including constant
nonpositive axes. Call-time shape binding checks actual array ranks, lengths, shape-name agreements and
instantiated extents before evaluation. Concrete binding is necessary for facts such as `H > 2`.

## Native artifact and interpreter

Use `Artifact<TixModule>` as `TixProgram`. `TixModule` is finite plain data containing ordered functions.
A function has parameters and a return signature, ordered statements, and a return tensor ID. A statement
has a tensor ID, output-axis binders and extents, and a scalar expression tree. The tree contains literal,
shape value, tensor read with affine subscripts, unary, binary, built-in call, and reduction nodes.
Reduction nodes carry ordered binders and extents. The internal split reduction additionally holds its
original one-index binder, a block width and a tail policy for the clipped last block. The source parser
constructs ordinary reductions only. Store literals as decimal text so that the framework's canonical
number encoding cannot change a signed zero. Keep source spans for diagnostics outside the artifact.

Use a matching `defineIR` and `defineAdapter` with kind `tensor.tix` and initial schema `1`. Share a native
validator which checks structure, IDs, order, scope, types, extents and access bounds, including the internal
reduction form. The validator checks explicit loop domains and accesses. Bare-use inference belongs
to source checking, since rewrites can change which reads supply bare uses. Use `createIRArtifact` for compilation and pass candidates. The projection has function,
parameter and statement entities, function containment, one edge per producer/consumer dependency, and a
return edge. Use stable IDs and put the checked statement, including its expression, in its entity's
attributes. An editable expression graph would make individual expression edits inspectable. The initial
passes rewrite whole statements and need only statement-level diffs. The explicit domains, indexing and
reduction order are available for later loop lowering. [IR adapter API](../../../../../../src/framework/ir/README.md)

One interpreter traverses statement output axes and reduction axes in increasing lexicographic order with the
first axis outermost. It materializes one row-major array per statement and uses affine subscripts and
row-major strides for reads. Use exact integer arithmetic for affine evaluation, converting checked coordinates and extents to
safe numbers for row-major offsets. Keep those calculations separate from scalar floating point. Mode selects the output storage and a scalar rounding operation. The f32 path uses `Math.fround`
on inputs, literals, shape values, unary and binary results, built-ins and each reduction update.
Use JavaScript `Math.max`/`Math.min` semantics, including signed zero. A sum starts at +0; a max starts
at −∞. Split sums use the same addition and rounding at both levels. The f64 path uses the same expression
and loop order with JavaScript double arithmetic and f64 storage. This keeps the reference's evaluation
order explicit while removing f32 rounding. Separate interpreters would duplicate indexing and traversal.
Independent expected outputs will test the shared logic.

## Meaning contract

Build two relations with `differential` and run their specs with the existing synchronous `runDifferential`.
Cases are a deterministic finite sample of every function in the invocation's original artifact. Generate
them once per optimization call and use them for all steps. Passes keep the complete public signature.
Inputs are sampled as f32 arrays so both evaluators start from the same represented values.

- For symbolic names, try uniform bindings from `1` through `5`, followed by the uniform binding `4`
  with each name individually set to `5`. Use a single binding for a fully literal signature. Deduplicate
  instantiated shapes and drop bindings with inadmissible axes. Sizes cover a singleton, a full two-element
  block, a partial block, the two-full-block reassociation witness, and two full blocks plus a tail. Perturbing
  one name at a time helps detect axis mix-ups masked by square shapes.
- For each retained binding use all ones, alternating signed zeros, signed binary fractions that vary
  by parameter and coordinate, and a row-major repeating `[1, 0, 2^-24, 2^-24, 0]` pattern. These exercise
  lost terms, signed-zero differences, index permutations and the rounding witness, respectively.
  Use the case list length as the differential count, with case evidence carrying function, shapes and
  value pattern. Require at least one case per function for a changed candidate. Functions that compile
  but have no binding in this grid can still run with concrete inputs.
- Observe the returned shape and all output elements in row-major order. Exact compares the raw f32
  words, including zero sign. Tolerance requires finite outputs on both sides and compares each candidate
  f32 element to the original artifact's f64 element `r`. Accept if
  `abs(candidate - r) <= 4 * 2^-24 * max(1, abs(r))` at every element. A shape mismatch, missing
  case coverage, or failed comparison rejects a changed candidate. Evidence identifies the first
  differing output coordinate for a failing case, with its words or its numerical error and bound.
- Exact compares to the step input's f32 output. Before any accepted split, that output is bit-identical
  to the invocation origin on the same sample. After an accepted split, exact preserves the already
  checked output. Tolerance always compares to the invocation origin's f64 output, so repeated split
  steps cannot accumulate a fresh tolerance allowance at each step.

For binary32 round-to-nearest the unit roundoff is `u = 2^-24`. For the two-element blocking of up to
five nonnegative terms with no underflow or overflow, a contribution crosses at most one nontrivial
inner addition and two nontrivial outer additions. The relative rounding factor is bounded by
`(1 + u)^3 - 1`. The `4u` allowance is the smallest power-of-two multiple of `u` above this bound plus the f64
summation error on those samples. The unit scale provides an absolute allowance near zero. For composed functions and signed cancellation
the formula is a fixed acceptance policy, with no general numerical error guarantee. An absolute-only
tolerance would scale poorly across output magnitudes; a relative-only tolerance would demand exact
zero at a zero reference. Report rejected cases without loosening the formula to fit them. A sampled
acceptance establishes the stated relation on the sample, including when that relation is bit-exact.
[Differential implementation](../../../../../../src/framework/contracts/differential.ts)

## Passes

- **inline.** Count all read occurrences of each tensor, including return use. Pick pointwise producers
  with exactly one use as a read in a later statement, initially excluding producer expressions containing
  reductions. Substitute consumer affine subscripts for producer output binders by ID, compose affine
  subscripts, and remove the producer. Skip the substitution if the composed access bounds cannot
  be established by the native validator. The operation tree and its rounding points stay in order. Check
  the result with exact. A single-use restriction avoids introducing multiple copies of the producer's
  work. For stage 1 there is no need for a general fusion or cost model.
- **split-sum.** Replace ordinary one-binder sums by nested folds over consecutive blocks of width two,
  outer blocks and inner elements both increasing. The last block ends at the original extent.
  Reuse the body binding for the original index and keep all other lexical scopes. Skip the split
  node itself on subsequent passes. A width of one leaves the left fold unchanged. Two is the smallest
  width permitting reassociation and needs only a single possible tail element. Apply the tolerance
  relation. Multiple-index and max reductions keep their original form.

For both passes, return a fresh native value only when changed. After native candidate preparation the
host runs the meaning gate and retains the candidate only on acceptance. The pass write declarations
name statement entities and the relevant containment and dependency edges; signature and return
entities/edges cannot change. Stable statement IDs use identity correspondence; removed statements are
removed in the correspondence. The first implementation needs neither custom fact transfer nor edit scripts.

## Framework change proposed

| Path | Change and reason |
| --- | --- |
| `src/framework/passes/define-pass.ts` | Extract and export the existing native-result preparation from `applyPass`. Given the existing pass metadata (ID, adapter, writes), before view and `NativeResult`, it creates and validates the candidate artifact, diffs the two projections, checks declared writes and derives correspondence and edit counts. Reuse the checks from the async entry and keep that entry's requirements, contract, preservation and edit-transaction behavior and ordering. Tix supplies the native result from a synchronous kernel and uses a local view without a shared store. |

Typed uses `definePass` → `applyPass` → `AnalysisManager.verifyTransformation` with an origin port.
Even with a pure kernel, `applyPass` returns a Promise and starts a logical edit before learning
that the kernel produced a native value. The edit requires a rewritable adapter, which is extra work for
Tix's inspection-only projection. The extraction shares the existing native phase without imposing rebuild
on native-only hosts. Tix uses the existing `NativeResult` and pass write metadata with pure domain
kernels. It uses the invariant definition and its sampled evidence directly; there is no second
transformation verifier. Changing the fixed API to async would allow the full managed lifecycle.
A synchronous clone of the manager would duplicate port binding, effects and verification machinery
that a pure tensor check does not need. No other framework source changes are proposed.
[Typed pass definitions](../../../../../../src/typed/passes.ts) ·
[Typed pipeline](../../../../../../src/typed/project.ts) ·
[Native pass application](../../../../../../src/framework/passes/define-pass.ts)

## Corpus and verification

Add the following entry points at `corpus/tensor/<name>/main.tix`. Arrange reductions and broadcasts
explicitly so each required binder extent has a plain use or a declared output extent.

| Name | Kernel and test oracle |
| --- | --- |
| `matmul` | `sum(k) a[i,k] * b[k,j]`; hand-computed rectangular product with unequal axes. |
| `softmax` | Row max, shifted exponent, row sum and normalization; equal logits and a large common offset. |
| `layernorm` | Row mean, centered variance, positive eps under the square root, gamma and beta; constant row returns beta. |
| `attention` | Single-head scaled dot products, max-shifted row softmax, weighted value sum; equal scores give the mean of the value rows. |
| `mlp` | Two affine layers using two weights and biases, with the tanh-GELU formula between them; zero hidden input and nonzero output bias. |
| `conv2d` | NCHW valid cross-correlation over input channel and kernel height/width, stride one and no padding; a nonsquare image and rectangular kernel with distinct weights. |

Use `tests/tensor/` through the fixed built API. Check source locations, greedy reduction parsing,
multi-axis visitation order, signed zero, f32 vs f64 divergence, repeated shape bindings, annotation and
affine ranges. Run all six corpus entries against independent small oracles, including f64 inputs and
selected shape perturbations. Check capture-free inline substitution within a consumer reduction,
repeated reads blocking inline, and return use.

For the pass tests, use `x: f32[N]` and a singleton output with `sum(k) x[k]`. The output's unused
index gets its extent from `f32[1]`. At `N=5` use `[1, 0, 2^-24, 2^-24, 0]`. The original f32
output is `1` and the split output and original f64 reference are `1 + 2^-23`. Run the same split
candidate through both gates and assert rejection by exact and acceptance by tolerance. For the
tail mutant, use the same function with a literal input length of five, and mutate the candidate
split's explicit loop extent to four. This models a dropped partial block with well-formed IR.
For five ones it returns `4` instead of `5` and fails tolerance.
For the inline mutant use `p[i] = -x[i]; y[i] = p[i] + x[i];` and drop the unary minus
during substitution. The correct result for ones is zero and the mutant gives two. Inject both
mutants through the normal native preparation and meaning gate using test-only setup, and verify the
prior revision is retained. Test split followed by inline to cover the changed exact baseline.

Land the framework extraction and its native write-check regression test first, then the front end,
interpreter and corpus, then the pass pipeline and mutant tests. Use `npm run build`,
`node --test tests/tensor/`, `node --test tests/framework/` and targeted Typed tests for pass,
contract and identity behavior, including `passes.test.mjs`, `program.test.mjs` and
`meaning-memo.test.mjs`. Use command escalation for tests whose Node child processes are denied by
the sandbox.

## Later

- General affine parameter binding and stronger symbolic range proofs, outside the corpus subset.
- Managed asynchronous tensor orchestration, if an API that needs effects or analysis transfer is introduced.
- CUDA lowering and GPU execution, fusion, contraction tiling and attention-specific rewrites, assigned to later stages.
