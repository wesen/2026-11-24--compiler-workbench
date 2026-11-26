---
Title: Stage 1 design for the Tix tensor domain
Ticket: IRWB-020-D
Status: review
Topics:
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Existing synchronous sampling and per-side evaluation
    - Path: repo://src/framework/ir/transactions.ts
      Note: Edit constructor requires a rebuild capability
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native pass preparation and the proposed synchronous checked entry point
    - Path: repo://src/typed/passes.ts
      Note: Original-revision contract binding in the first domain
ExternalSources: []
Summary: Stage-1 language, artifact, evaluation and pass acceptance design with one proposed framework change.
LastUpdated: 2026-11-26T12:39:29.662260732-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 1 design for the Tix tensor domain

**Revised after review.** A Tix statement defines a whole tensor. Its ordered output axes and reduction axes give us the loop nest directly. Store that information in a checked, immutable artifact and interpret it twice, once with f32 rounding and once with JavaScript double arithmetic. Verify each proposed revision before making it the program returned by the synchronous API.

## Framework finding and proposed change

Typed already supplies most of the pattern. `src/typed/ir.ts` pairs an IR type with an adapter. `src/typed/passes.ts` supplies native results and binds the original revision to a transformation invariant. `src/typed/evaluate.ts` supplies the cases, interpreter and comparator to `differential`. Its `run(side, ...)` hook already lets Tix evaluate the two sides at different precisions. Neither tensor buffers nor a floating-point relation needs to become a framework type.

There is one proposed change, in **`src/framework/passes/define-pass.ts`**. Today `applyPass` awaits the analysis manager and kernel, and calls `view.beginEdit()` before learning whether the kernel needs a graph edit. In a probe against the current build, a validating, projectable adapter created an artifact successfully. A native identity pass returned a Promise which rejected with `Adapter probe is not Rewritable` before its kernel ran. The public Tix API needs an immediate result, and both kernels produce whole native revisions.

- Add **`applyNativePassSync(pass, before, options)`** for pure, synchronous native kernels. Use the existing `Pass` from `definePass`. Refuse nonempty needs or preserves and a managed transformation contract, since these require the async manager. The native kernel receives the ordinary pass context and returns a native result or no edit. A required synchronous gate takes the input and candidate artifacts and returns a framework `CheckResult`. The caller can bind the origin in that gate. There are no analysis requests, transfer claims, resource effects or managed transformation transactions in this API.
- Extract the native result preparation from `applyPass`. Both paths create and validate the candidate with the adapter, diff the views, construct total correspondence, and enforce the declared writes using the existing logic. Keep evidence and return the usual `PassResult` on acceptance. In the synchronous path require an actual successful check before returning a candidate, only when the revision changes. A false verdict carries its evidence in `PassError('contractRejected', …)`. Keep the candidate private while checking. Using the existing barrel export is sufficient.
- A tensor-local loop that calls kernels directly is shorter but would duplicate or bypass the v6 write and correspondence checks. Changing `optimizeTix` to return a Promise breaks its fixed API. Adding a synchronous analysis manager or strategy interpreter is substantially more machinery than these two passes use. The focused primitive also avoids implementing an unneeded graph-to-Tix rebuilder.

That is the complete proposed framework diff. Record the actual changed symbols, motivating tensor case and regression test here and in the diary when implementing. Core identity, IR projection and the differential checker already fit. A straight ordered list of pass names needs neither dataflow facts nor strategy search.

## Tix input and static checks

The source domain is the given `fn+` grammar. Each named function has one or more rank-one-or-higher f32 tensor parameters, source-order single-assignment statements and one named tensor return. Identifiers resolve in the appropriate function, tensor, shape or lexical index scope. Shape symbols are established by input types. Affine dimensions and subscripts are an integer constant plus integer coefficients times names, including subtraction and constant scaling. Shape arithmetic and address arithmetic are integer operations. A bare shape name in a scalar expression is a numeric operand.

Use a location-tracking lexer and recursive descent with precedence climbing. Retain the operator, declaration and use token locations through checking. Skip `//` comments. Parse unary minus before multiplicative and additive operators, left-associating binary operators at each level. In a reduction, parse the body afresh at lowest precedence up to the enclosing expression delimiter (including a call argument comma). Thus `sum(d) x[i,d] / D` has a division inside the sum. For overloaded `max`, recognize a binder list followed by a body in context, and resolve bare scalar shape arguments as values in a binary call. Test `max(a,b) x[a,b]`, `max(x[i], -1)` and `max(N,D) - x[i]`. Splitting source on lines or treating reductions as ordinary calls loses these distinctions.

1. Collect input shapes and check unique declarations, prior definition of every tensor read, reference rank, one distinct LHS binder per axis, lexical reduction scope and return type. Allocate binder identities by lexical declaration so identical spellings in different scopes do not interfere. A returned parameter is legal.
2. Represent a dimension by its normalized coefficient map and constant, so `H - 2` and `H + 1 - 3` compare equal. For each binder collect **all** plain RHS subscript uses in its scope. Their tensor axes must agree symbolically. An output annotation also supplies one extent per LHS position and must agree with each inferred extent. A LHS index with only affine uses (or a broadcast constant body) needs this annotation. A reduction binder needs a plain extent witness of its own. There is no reduction axis slot in the statement annotation. In conv2d, `w[o,c,dy,dx]` supplies `dy,dx`, while the declared output supplies `y,x` for `input[n,c,y+dy,x+dx]`.
3. Bind each shape symbol from a plain parameter axis. Affine dimensions elsewhere may refer to those symbols. Reject conflicting symbolic index extents, unknown names, inconsistent annotations or return shapes, and missing inference at compile time with one-based `line:col` on the offending token.
4. Calls in the supported execution domain have consistent concrete row-major shapes and buffer lengths, finite input elements, uniquely determined nonnegative integer shape sizes and extents, representable offsets and in-bounds affine accesses. For a nonempty iteration box, compute the minimum and maximum affine subscript by choosing the low or high endpoint for each coefficient. Diagnose a statically impossible access at its subscript. An empty axis visits no cells. Static shape inference and consistency do not depend on running generated test inputs.

## Artifact and evaluation

Use `defineIR` for kind `tensor.tix`, schema `1`, and `createIRArtifact` with a `defineAdapter` using the same validator. Store ordered functions, parameters (shape vectors), statements (stable ID, output axes with extents, scalar RHS tree) and return tensor ID. Scalar nodes distinguish literals, shape values, tensor loads with affine subscripts, unary/binary operations, intrinsics and ordered reductions. A reduction carries its bound IDs and extents. The internal blocked-sum form carries its single axis, block size and body. Keeping a checked expression tree avoids inferring loops again after a rewrite. Lowering to a scalar CFG now would obscure the pointwise and reduction patterns.

For example, the matmul RHS `sum(k) a[i,k] * b[k,j]` is a sum over `k:K` of a multiply of two loads, inside output axes `i:M,j:N`. Present functions as projection roots, with ordered containment edges to parameters and statements, and read and return edges to tensor definitions. Keep ordered axes, shape and the full expression in the statement attributes. Stable qualified definition IDs let v6 identify a changed consumer and a removed producer. The native validator checks the transformed tree, binders, shapes, reference order and blocked-sum parameters as well as the schema. Passes declare the statement and incident edge kinds they change. This granularity exposes every semantic edit without a v6 entity for each scalar operator.

The payload is finite plain data. Encode numeric tokens so unary minus of zero survives canonicalization (`core/data.ts` normalizes a stored numeric `-0` to zero). IEEE buffers, reduction identities such as −∞ and interpreter scratch live outside the artifact. A `TixProgram` handle carries the compile-time origin artifact and the current artifact. `compileTix` initializes these to the same revision. `runTix` uses current. `optimizeTix` retains origin across successive calls. The three exports from `src/tensor/index.ts` use the exact synchronous signatures in the request.

One row-major evaluator takes a precision policy, defaulting to f32. It returns a Float32Array in f32 mode and a Float64Array in f64 mode. Instantiate shapes and strides once, iterate statements in order, materialize each output tensor, then return the named tensor in the requested precision. f32 converts incoming elements, literals and scalar shape values with `Math.fround`. Apply it after each unary, binary and intrinsic result, and after **every** accumulator update. f64 reads the caller's actual elements and uses JavaScript double arithmetic throughout. Both traverse indices in increasing lexicographic order, first axis outermost. Start sums at +0 and maxima at −∞. Use `Math.max/min` for the specified numeric operations. A single traversal keeps order identical in the two modes. Independent hand-computed fixtures below catch common-mode evaluator mistakes.

## Meaning contract

**Domain.** Test every original function on a reproducible finite sample. Generate shapes from the origin, never from a candidate. Try assignments of 1, 3 and 5 to all shape symbols together and vary one symbol at a time between 3 and 5 with the rest at 3. Include the fixed shape for signatures without symbols. Retain distinct legal, in-bounds shapes using the inferred affine constraints. For each use (a) the f32-exact ramp `(1 + ((i + 3*p) % 16)) / 16` for zero-based flat offset i and parameter ordinal p (1/16 through 1 in steps of 1/16), (b) mixed signs drawn with framework seed 7 in [−1,1], and (c) a repeating exact-f32 pattern `[1,0,2^-24,2^-24,0.25]` along the innermost axis. The ordinal shifts phase without increasing amplitude. The layernorm probe covered all 65 ramp outputs across the five generated (N,D) pairs. The largest error divided by its tolerance was 0.00636 rounded upward. Test the original f32 against f64 on all corpus ramps. Cap generated cases at 4096 elements per materialized tensor and 65536 scalar body visits per function invocation to keep checks bounded. Record uncovered functions and reject a change if any function has no usable witness. These are limits on sampled evidence, not language extents. Finite enumeration is cheaper than exhaustive tensor input search and establishes only sampled agreement.

**Observation.** Compare each function's declared interface and actual returned shape, then every row-major output element. Only outputs are externally observable. Removing an intermediate is the purpose of inline. The exact check compares words through a `Uint32Array` view of the output's actual byte range, including signed zero. It can compare nonfinite result words. The tolerance check uses cases with finite origin f64 outputs. Candidate nonfinite values on those cases disagree. Each function needs finite reference coverage for tolerance. Skip a reference-ineligible case based on the origin alone, report the count, and never discard a candidate mismatch as inconclusive.

**Relations and evidence.** Use versioned `differential` invariants and their synchronous `runDifferential(differentialSpec(inv), ports)` result inside the pass gate. Exact compares f32 against f32. For tolerance the baseline runs original f64, the candidate runs f32 on the same f32-representable inputs. Require elementwise

```text
abs(candidate32 - origin64) <= 1e-6 + 1e-5 * abs(origin64)
```

Near one, a short reduction incurs errors on the scale of f32 unit roundoff (2^-24) per rounded operation. The relative allowance accommodates a few such reductions and pointwise operations in the small corpus. The absolute term covers small cancellation residuals near zero. These are acceptance thresholds for the selected cases, not forward-error bounds for arbitrary condition numbers. A single relative error fails at zero. A global norm can hide one wrong output cell. Report relation version, seed, fn, shape assignment, input pattern, first unequal output coordinate and expected/actual words or numbers and bound. Encode exceptional numbers as text in evidence.

| Proposed pass | Required checks before acceptance |
| --- | --- |
| `inline` | Exact f32 against its immediate input. Use the same cases generated from the origin. |
| `split-sum` | For a changed candidate, tolerance against the original f64 program. |

An exact step after a tolerated step must introduce zero further bit changes. Requiring it to undo a previous one-ULP difference would reject a correct inline. Comparing only adjacent approximate revisions could admit cumulative drift. Process names in order, record one `{pass, accepted}` per application, and use the last accepted revision for the next step. An identity is accepted without running the gate. Expose relation overrides and faulty kernels only to internal tests.

## Rewrites and decisive fixtures

**Inline.** Count reference occurrences, including returns. Choose a reduction-free producer with exactly one load in a later statement and no other use. Replace that load by the producer RHS, simultaneously substituting the load's affine subscripts for the producer's output binders. Use binder IDs to avoid capture. Preserve the expression tree and all scalar rounding boundaries, then remove the producer. Recomputing the value at several loop coordinates is safe for a pure expression. Counting consuming statements alone would also inline producers loaded twice. A square, nonsymmetric matrix tests the otherwise shape-valid mutant that substitutes positional indices in the wrong order in a transposed load. With a copy producer and input rows `[1,2]`, `[4,8]`, the correct flattened result is `[1,4,2,8]`. The incorrect substitution returns `[1,2,4,8]`.

**Split-sum.** Rewrite a one-index ordinary sum to block size 2. For each increasing start `0,2,… < extent`, sum the body from start through `min(start+2,extent)-1` from +0, then add that rounded partial to the outer +0 accumulator. Do not visit padded cells. The blocked node makes order and the tail inspectable without adding division, modulo or padded dimensions to Tix affine syntax. Leave maxima, multi-index reductions and already blocked nodes as they are. Apply eligible rewrites deterministically in source/tree order.

For `y[i] = sum(k) x[i,k]` with one row `[1,0,2^-24,2^-24,0.25]`, flat f32 is `0x3fa00000`, blocked f32 is `0x3fa00001`, and original f64 is `1.2500001192092896`. Exact must reject the legal rewrite and tolerance must accept it. Dropping the final partial block yields `1.0000001192092896` and must fail tolerance. These exact verdicts were probed in Node with the repository differential runner. The implementation tests must reproduce them through actual IR rewrites, alongside the wrong-inline rejection. Assert that candidates really changed, inspect the evidence, and run the returned program so an identity pass or an ignored verdict cannot pass the tests.

## Corpus and verification after review

Each row is one `corpus/tensor/<name>/main.tix`. Check against an independent small expected output in both precisions before using the larger generated cases. Import all public entry points from `../../dist/tensor/index.js`.

| Name | Computation and distinguishing fixture |
| --- | --- |
| `matmul` | Rectangular [M,K] × [K,N]. Unequal axes and hand-computed entries expose swapped subscripts. |
| `softmax` | Row max, shifted exponential, row sum, normalize. Large equal logits give equal finite probabilities. |
| `layernorm` | Per-row mean and centered variance, then `gamma[j] * normalized + beta[j]` with positive literal eps inside sqrt. Constant rows give beta. Use a varying row and nonuniform gamma as well. |
| `attention` | Single-head scaled QKᵀ, max-shifted softmax by key, weighted sum of V. Zero queries give the mean of distinct value rows. |
| `mlp` | Two biased dense projections surrounding tanh-GELU, using `0.5*x*(1+tanh(0.7978845608*(x+0.044715*x*x*x)))`. Test both signs and distinct biases. |
| `conv2d` | NCHW input, OIHW 3×3 filter, unit stride, no padding. Declare output [N,O,H-2,W-2]. An off-center filter tap on a rectangular input distinguishes addressing and filter orientation. |

1. Build the parser/checker and artifact. Test multi-function input, token locations, `max` ambiguity, both sum parses, equivalent affine forms, conflicting extents, lexical binders and illegal reassignment. Inspect a projected matmul and structurally reject an invalid transformed tree.
2. Run tiny row-major fixtures, f64 inputs between f32 values, per-op rounding, signed zero, multi-index fold order, empty reductions, and shape symbols in expressions. Check all six corpus outputs.
3. Add a framework regression in `tests/framework/` with a native-only adapter, a successful synchronous check, a rejected semantic edit and an undeclared write. Exercise the two pass mutants, the forced exact split, a nondivisible extent, no-ops, and both pass orders, including separate optimizer calls that reuse the original baseline.
4. Run `npm run build`, `node --test tests/tensor/*.test.mjs`, `node --test tests/framework/*.test.mjs`, then `node --test tests/typed/passes.test.mjs tests/typed/strategies.test.mjs` for the shared native path. Run further affected Typed tests if the reviewed diff grows. Record results and each actual framework change in the diary.

## Later

- CUDA lowering and GPU execution belong to the backend stage.
- Fusion, contraction tiling and attention-specific rewrites belong to later optimization stages.
