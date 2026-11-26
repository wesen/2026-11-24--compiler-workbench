---
Title: Tix semantics and checked tensor rewrites
Ticket: IRWB-020-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Synchronous differential evidence
    - Path: repo://src/framework/ir/transactions.ts
      Note: Rebuild capability requirement
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native preparation and async application
    - Path: repo://src/typed/passes.ts
      Note: Origin contract precedent
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:39:35.667878779-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix semantics and checked tensor rewrites

## Reviewed design

Compile each function to ordered tensor definitions with scalar expression trees, explicit iteration domains and affine reads. One interpreter runs those trees at either precision. A checked rewrite proposes a new immutable program, then evaluates every function against the source on reproducible inputs. The public API is synchronous. The implementation adds one entry point to the framework pass layer to enforce this boundary.

### Framework change ledger

| Location | Finding in the current code | Change and acceptance test |
| --- | --- | --- |
| `src/framework/passes/define-pass.ts` (export through the passes barrel) | `applyPass` awaits the kernel and manager. It calls `view.beginEdit()` before the kernel chooses native output, so even a native-only rewrite needs an adapter with `rebuild`. | Add a synchronous native-pass entry point taking an existing Pass with no analysis needs or preservation claims. Share native result preparation and write enforcement with the existing runner. Open views, build the validated candidate, diff it, construct correspondence, check declared writes, then call a synchronous (before, candidate) gate that closes over any domain baseline. Return its checked result/evidence before the caller advances. Test a native-only adapter, an illicit write and a failed gate. |

Use the existing `NativeResult`, `createIRArtifact`, `diff`, `makeCorrespondence` and `undeclaredWrites`. The narrow entry point has no manager-dependent analysis, preservation, edit or async callback. Type its gate to return a synchronous check result and require explicit success. Return identity candidates immediately. A synchronous general-purpose AnalysisManager would duplicate transaction semantics. A tensor-local runner could compose the same primitives, but would make the second domain own framework write and publication checks. Returning a Promise would change the stipulated API.

Typed already supplies `origin` to a versioned differential invariant through `optimizationContract`. Use `differential`, `differentialSpec` and `runDifferential` for the tensor gate. The spec can already choose precision by side and compare application-defined observations. The tensor implementation uses the existing contracts, core and IR APIs. A strategy plan adds no decision to an ordered list of two pass names.

**As built.** The sole framework source edit is in `src/framework/passes/define-pass.ts` (commit `1a99a16`). Both runners call `prepareNative` and `enforceWrites`. The existing wildcard barrel exports `applyNativePassSync`. Its gate takes exactly two artifacts. An existing pass with a manager-dependent transformation contract also requires the asynchronous runner, since bypassing that contract would discard its guarantees. The read-only adapter, validation, writes, gate rejection, unsupported analysis declarations and identity behavior are exercised in `tests/framework/native-pass-sync.test.mjs`.

**Probe on the current worktree.** The baseline build succeeded. On Node 24.18.0 a minimal adapter and artifact passed a synchronous one-case differential check (`agree`). Applying a native identity pass returned a Promise and rejected with `Adapter t.probe is not Rewritable`. The diary gives the setup and numeric witness.

## Source and call domain

Accept one or more functions in the supplied Tix grammar, including functions returning a parameter, multiple reduction binders, optional statement types, decimal/exponent numbers and line comments. Shapes and addresses use integer affine forms (constant plus integer coefficients times names). Only shapes appear in dimension expressions and only in-scope indices in addresses. Keep symbolic integer arithmetic separate from scalar floating-point arithmetic. Calls supply exactly the function's row-major inputs with finite elements and consistent, nonnegative integer dimensions, integral uniquely determined shape bindings, in-bounds accesses and arrays/index arithmetic representable on the host. Shapes have positive rank. Zero extents give empty loops. The checker's input is source, so inconsistencies visible in source are compile errors. Concrete dimensions supplied through the API are available only at call time.

1. Tokenize with 1-based line and column. Use a precedence parser with prefix minus and left-associative binary operators. Parse a reduction body as a full expression up to its enclosing delimiter (including a call argument comma). Thus moving the closing parenthesis in `(sum(d) x[i,d]) / D` changes the tree. For overloaded `max`, recognize a binder list followed by an expression body versus two scalar arguments. Resolve the overlap using scoped shape names for bare scalar arguments, e.g. `max(N,D)-1` is a call on bound shapes. Test both forms, including a reduction beginning with unary minus.
2. Normalize affine forms to sorted coefficients and a constant, keeping the original occurrence for diagnostics and for identifying *plain* name occurrences. Index/scalar-name resolution is lexical. Allocate fresh binder identities for each reduction, including nested shadowing. Require distinct LHS axes and distinct binders within a list. Resolve reads and returns against parameters and preceding definitions. Detect duplicate function/tensor definitions, rank mismatch, unknown names, incompatible dimensions and invalid return shape at the relevant token.
3. Match a plain RHS index to the corresponding axis of the tensor it reads. Unify all such extents symbolically, independent of term order. Match each LHS binder to its declared axis if present. Check inferred and declared extents agree. An affine-only LHS binder needs the annotation. A reduction binder has no annotation slot and needs a plain witness within scope. In a convolution, `dy` gets its extent from the kernel's `dy` axis and `y` from the result annotation. A product of two variable indices is non-affine.
4. Bind shape names directly from bare input axes. Affine dimensions may use those names elsewhere; a symbol without a binding axis is a compile error. Check statically impossible constant dimensions and addresses at the source token. Calls and sampled shapes are within the shape and address domain above. No rational solver or deferred source-error contract is needed.

## Artifact and evaluation

`compileTix(source)` creates the v6 artifact for the complete checked module. The opaque `TixProgram` carries its original artifact and executable revision, initially the same. `optimizeTix(program, passes)` keeps that origin across calls. `runTix(program, fn, inputs, options?)` executes the selected function in the executable revision. Export all three from `src/tensor/index.ts` for `dist/tensor/index.js`.

| Native record | Information needed to execute it |
| --- | --- |
| Function | Ordered input tensor IDs with symbolic shapes, direct binding axes, ordered definition IDs, return ID and type |
| Tensor definition | Result shape, ordered free binder IDs/extents and scalar RHS |
| Scalar node | Literal spelling, shape value, affine tensor load, unary/binary arithmetic, intrinsic or ordered reduction. A reduction owns binder IDs, extent expressions, operator and body. |
| Generated reduction bounds | Block count by ceiling division and tail length by minimum. Only generated loop bounds need these operations. Tensor addresses stay affine. |

For example, a matmul definition loops over free `i:M,j:N` and stores the value of `sum(k:K, mul(load(A,i,k),load(B,k,j)))`. Each load retains its target tensor ID and coefficients keyed by binder ID. The same representation expresses different source spellings of a shape. Compared with keeping a parse tree, resolved IDs and extents survive substitution. Compared with a scalar control-flow graph, the tree preserves the defined grouping and makes a reduction visible to a pass.

Use matching `defineIR` and `defineAdapter` definitions (kind `tensor.tix`, schema version `1`). Project function and tensor entities with ordered containment and read dependencies. Include full semantic fields, including RHS and result ID, in entity attributes so diff sees an operation-only change. The native validator checks binding scope, shapes, use order and generated bounds on both parsed and rewritten modules. Keep runtime buffers and accumulators outside finite canonical artifact data. A literal token plus an explicit unary minus preserves negative zero through hashing. A graph editor/rebuilder would duplicate the native constructor for these two whole-value rewrites.

Materialize each definition in source order. Iterate axes row-major, bind integer indices and compute row-major offsets. Fold reductions in increasing lexicographic order, first binder outermost. In f32 mode convert input elements on entry, literals and scalar shape values with `Math.fround`. Apply it at *every* arithmetic operator, unary minus, intrinsic result and fold step. Sum starts at +0 and max at negative infinity. Use JavaScript exp/log/sqrt/tanh/min/max. Storing only at statement boundaries would silently fuse rounding sites. In f64 mode use the same loops and unrounded JS numbers, including the supplied Float64Array values. Return the concrete shape and a Float32Array by default or Float64Array for f64. Sharing traversal prevents the reference from acquiring a different reduction order. Independent expected-output tests guard against common interpreter bugs.

## What a pass must preserve

**Sample domain.** Generate cases from the origin for *every function*. Start with all symbolic names assigned 1, 3, 4, 7 in turn, then a mixed assignment cycling 3, 5, 7 in name order to expose transposes. Honor fixed extents. Keep assignments satisfying the checked shape/bounds conditions and with small concrete buffers (at most 4096 elements per tensor) and bounded evaluation work (at most one million combined scalar-node visits and loop iterations per function/case). Deduplicate concrete shapes. For each shape run deterministic streams of asymmetric values in [-1,1] (framework seededRandom, seed 20, f32-rounded), positive nonuniform values in [0.25,1], and a repeating sequence `[1,0,0,0,2^-24,2^-24,2^-24]` in storage order. Include an all-zero/signed-zero case for exact checks. Record function, shape assignment, stream and seed so a failure can be replayed without storing buffers. The implementation meters actual visits during origin evaluation instead of estimating them in advance. This also bounds empty inner loops. Sampling bounds limit optimization evidence only. If any function has no eligible shape or no comparable reference case for its intended relation, decline the candidate. Never reward the candidate for changing the case domain.

**Observation.** Compare the same named function's returned shape and every row-major element. Check names and signatures of all functions first. Exact means equal 32-bit output words, including zero sign, using Uint32Array views of f32 storage. Tolerance compares candidate f32 with origin f64 on the *same f32 input bits*. Use finite reference outputs for the tolerance sample domain, chosen from the origin alone. Candidate NaN or infinity for a finite reference fails. Report the first mismatch with coordinate, values/bit words and permitted error. Keep nonfinite evidence JSON-safe by using strings. The exact comparator can examine any f32 bits, including nonfinite results.

For every finite reference element r, require `abs(candidate - r) <= 2e-6 + 2e-5 * abs(r)`. The absolute term covers cancellation around zero. The relative term allows roughly a few hundred f32 unit roundoffs for short reductions and several chained stages. This is a chosen output-error budget on the sampled inputs, not a universal forward-error estimate. Pure relative error would reject small residuals after cancellation. Comparing only old and new f32 outputs could accept a candidate already far from the specified reference.

**Composition.** Inline must pass an exact current-to-candidate check on every step. Cases come from the origin. Each changed split compares its candidate to the origin in f64; each changed inline compares once to its immediate input in f32. For testing, apply the same changed split candidate under the exact gate alone. Use the same deterministic cases for each comparison with a given relation. Record one ordered `{pass, accepted}` per requested pass, retain the last accepted candidate on rejection and continue. Report a no-op as accepted without running the gate. Require all applicable cases per function to agree.

## The two rewrites and their falsifiers

| Pass | Rewrite and restrictions | Witness and deliberately wrong variant |
| --- | --- | --- |
| `inline` | Count reference occurrences including the return. Choose a non-returned pointwise definition (no reductions anywhere in its RHS) with exactly one reference site. At that site simultaneously substitute the consumer's affine index tuple for the producer's free IDs, compose affine addresses, copy the scalar tree and remove the producer. Process eligible definitions in source order, recomputing uses after each edit. Inputs and every child already yield precision-rounded scalars, so removing the store/load adds no arithmetic change. | Inline `p[i,j]=x[i,j]+1` into a consumer of `p[j,i]`, using a square input with distinct off-diagonal entries. A test-only mutant substitutes in identity order. Assert it produces a valid changed artifact, fails exact comparison and is skipped. |
| `split-sum` | For each original single-binder sum, use fresh block and lane IDs, width 4. Outer sum has extent ceil(K/4), inner sum has extent min(4,K-4*block). Replace the bound index in the body by 4*block+lane. Each fold starts at +0 and has its own rounding sites. Mark generated folds so another invocation does not recursively split them. Leave multi-index sums and max reductions intact. | With K=7 and the seven-element sequence above, sequential f32 gives 1, blocked f32 gives 1.000000238418579 and source f64 gives 1.0000001788139343. Thus exact rejects this rewrite, tolerance accepts it. A test-only mutant uses floor(K/4) and drops the tail. Check on a positive stream whose tail contributes far more than tolerance. |

Use a rank-one result for the split witness, e.g. `y[i]=sum(k) x[i,k]` for input shape [1,7]. Small K, exact multiples, empty sums and partial last blocks need separate execution tests. A two-level loop with one running accumulator would preserve order and would fail to exercise the tolerance contract.

## Corpus and verification after review

All six fixtures live at `corpus/tensor/<name>/main.tix`. Each will have at least one independent small numerical oracle as well as a before/after check.

| Name | Computation | Distinguishing check |
| --- | --- | --- |
| matmul | A[M,K] times B[K,N] | Hand-computed rectangular result |
| softmax | Row max, shifted exp, row sum, divide | Large logits, nonuniform probabilities, row sums near one |
| layernorm | Per-row mean and variance, divide by sqrt(var+eps), scale by gamma and shift by beta | Constant and nonconstant rows, distinct per-feature gamma/beta, positive eps (literal or length-one input) |
| attention | QK transpose divided by sqrt(D), rowwise shifted softmax, weighted V | Distinct key/query lengths and unequal values, reference weighted output |
| mlp | Two affine layers with biases around tanh-GELU, using 0.5*x*(1+tanh(0.79788456*(x+0.044715*x*x*x))) | Mixed-sign hidden activations and unequal layer widths |
| conv2d | NCHW input and OIHW weights, unit stride, valid spatial window, ordered reduction over channel and offsets | Nonsymmetric 3x3 kernel, annotation with H-2 and W-2, explicit sliding-window result |

Build and test through the fixed public exports. Put focused tests in `tests/tensor/` for parsing and location errors, symbolic binding, affine-only axes, bad extents and duplicate assignments, max/call ambiguity, nested scope, signed zero, lexicographic multi-index folds, and per-operation rounding. Include a Float64Array input distinguishable from its f32 rounding. Verify unchanged source revision, multiple functions, pass order, repeat optimization, and acceptance and rejection using real changed artifacts, including both mutants through the actual gate. Run `npm run build`, `node --test tests/tensor/*.test.mjs`, `node --test tests/framework/*.test.mjs` and Typed pass/contract consumers (`passes`, `program`, `mutate`, `strategies` tests at minimum). Request escalation if a Node child-process test encounters sandbox EPERM.

Implementation order is checker and artifact, evaluator plus corpus oracles, shared native pass path and gates, then rewrites and regression tests. Source spans can stay with the front end once checks finish. Omit scheduling, a CLI and a project manifest because the API takes source and a pass list directly.

## Later

- CUDA lowering and GPU execution belong to the backend stage.
- Fusion, contraction tiling and attention-specific rewrites belong to later optimization stages.
