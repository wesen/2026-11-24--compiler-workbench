---
Title: 'Stage 1 design: checking Tix tensor transformations'
Ticket: IRWB-020-H
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
      Note: Existing sampled invariant
    - Path: repo://src/framework/ir/transactions.ts
      Note: Eager edit capability check
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Only proposed framework extraction
    - Path: repo://src/tensor/contract.ts
      Note: Deterministic sample protocol and relation bindings
    - Path: repo://tests/tensor/passes.test.mjs
      Note: Exact rejection and tolerant acceptance on one revision; numerical mutants
ExternalSources: []
Summary: 'Reviewed design: extract synchronous candidate preparation; check numerical meaning in the tensor domain.'
LastUpdated: 2026-11-26T13:48:37-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 1: checking Tix tensor transformations

`compileTix` produces a handle containing an immutable origin artifact and its current revision. `runTix` evaluates the current revision. `optimizeTix` prepares and checks each named candidate before updating its local current pointer. A semantic rejection leaves the preceding revision runnable and processing continues. Identity is accepted without publishing a change. All three operations are synchronous.

## Framework change ledger — implemented

The extraction below was the only change in `src/framework/`. `tests/framework/ext-e3-e6.test.mjs` now exercises synchronous preparation: a structurally valid but meaning-changing candidate can be prepared, whereas an undeclared write cannot. Tix calls the helper on detached views; the unchanged async caller retains its original store semantics.

**`src/framework/passes/define-pass.ts`: extract `prepareNativeCandidate`.** Share the native-result arm of `applyPass`: snapshot and validate the new artifact, project, diff, build correspondence and check declared writes. It returns a candidate, never a semantic verdict. Preserve the existing async runner's edit path and options. Repeating the native arm in tensor code would duplicate the framework's structural checks. Instead Tix supplies pure native kernels via `definePass` descriptors, with a domain driver that binds their versioned differential postconditions and calls `runDifferential` directly. No needs, analysis preservation, effects or external store. Test native preparation and undeclared writes, then run the existing async pass tests. **Drop the proposed async Tix parity test:** `applyPass` opens an edit eagerly; an adapter without `rebuild` cannot supply it. There is no stage-1 client for a lazy edit, so no second framework change.

`core` remains finite JSON: store literal spellings, never runtime Float32Arrays or nonfinite numbers in artifacts. `ir` accepts an ordered non-CFG adapter. `contracts/differential.ts` already distinguishes the two sides and takes a custom comparator. No generic precision, tolerance, shape or loop mechanism is missing there. No strategy or dataflow changes.

## Source, types and IR

Lex names, decimal numbers (including fractions/exponents), punctuation and `//` comments with 1-based positions. Parse left-associated binary precedence levels above primary/prefix parsing. A prefix `sum` or `max` reduction parses a *full expression* up to its delimiter, unlike unary minus. Distinguish binary `max` from a binder list followed by a body; two bare shape-value arguments can form a call. Diagnose parse and check errors at `line:col`.

Normalize integer affine dimensions and access maps to a constant plus sorted name/coefficient terms; no variable products. Resolve shapes from parameter types; every shape name must have a binding input axis (plain name). Affine dimensions can then reference those names anywhere. This avoids solving a linear system at call time. Calls are on consistent row-major input tensors with representable, nonnegative extents, in-bounds access maps and finite elements. Don't specify diagnostics for callers outside that domain. Compile-time checks reject inconsistent dimensions, rank and annotation mismatches, out-of-scope names, use before definition, duplicate definitions, unknown result and uninferable extents. Infer each binder from all *plain* uses in its RHS scope; use an LHS declared dimension when needed. There is no annotation slot for a reduction index. Check affine subscript extrema over the binder box for statically evident out-of-bounds accesses.

Use `tensor.index@1`: ordered functions, parameters, assignments (output binders, explicit extents, scalar tree), return reference and result shape. Scalar nodes are literal, shape value, indexed load, op, call or ordered reduction. Resolve binders to unique IDs so scope survives substitution. Validator checks structure, definition order, shapes, binding and internal loop forms; transformed programs need not be inferable as source. The `defineIR` and `defineAdapter` share validation; use `createIRArtifact`, project functions, definitions, binders and scalar operations with ordered containment and dependency/binding edges. Keep surviving entity IDs stable. Exposing bounds and index maps rather than lowering to a scalar CFG makes the IR directly iterable.

## Evaluation and kernels

Use one row-major interpreter, two precision policies. In f32 convert inputs and round literals, shape values, unary/binary operations and JS Math calls with `Math.fround`. In f64 use JS doubles and Float64 storage throughout. Indices/offsets are integers in both. Reductions accumulate from +0 or −∞ in increasing lexicographic order, first binder outermost; round every combine. Return an owned array even when returning a parameter. Test the common interpreter against independently computed results.

`inline` counts syntactic load occurrences and excludes the returned producer. Inline a pointwise definition with exactly one use, by composing producer index maps simultaneously with that load's affine arguments. Retain grouping and consumer extents, remove producer. Each scalar result was already rounded, so eliminating its store/load introduces no new arithmetic. The exact gate compares **current** f32 to candidate f32 on the same origin-derived cases. This preserves any prior split's origin guarantee without storing an accepted-relation flag or rechecking origin.

`split-sum` rewrites single-index sums only. Represent two levels explicitly: block over `ceilDiv(E,4)` and lane over `min(4,E-4*block)`, partial and outer sums both from +0, substitute `4*block+lane` into the body. Keep generated levels distinct from splittable source sums. No padding, including for E=0. Tolerance checks **unsplit origin f64** vs candidate f32, never candidate f64 or the previous approximate revision.

## Sampled contract v1

Check all functions in source order. Per function generate assignments in this order: all symbols 1, 3, 4, 5, 9, then one asymmetric assignment cycling 2,3,5,7,9 by sorted symbol name. Deduplicate identical assignments keeping the first (a fixed-shape signature has one). Skip illegal shapes or shapes whose origin input/storage sizes or scalar work exceed 100,000. For each retained assignment generate exactly four cases in order: **one** signed uniform draw-array in [-1,1], **one** positive uniform draw-array in [0.25,1], all ones, then the nine-term witness `[1,0,0,0,h,h,h,h,h]` repeated by flat element offset per parameter, `h=2^-24`. Seed 7, framework mulberry32, one stream across the check; consume one draw per element in parameter and row-major order on each random case only. Thus at most 24 cases per function, four for a valid fixed-shape function. Inputs on both sides are the same f32 words. Require nonempty output coverage per function. For tolerance, screen nonfinite references on the origin alone and require finite nonempty coverage per function; a nonfinite candidate on a finite reference always fails. Inadequate coverage is not acceptance.

Compare rank, shape and every returned element. Exact compares f32 storage words (including zero sign). Tolerance requires `abs(candidate-ref) <= 2e-6 + 2e-5*abs(ref)`: the floor permits small cancellation residuals; the relative term permits accumulated f32 rounding in short reductions and compound nonlinear expressions (unit roundoff ≈6e-8). This is a test domain and error budget, not a universal stability claim. Retain replayable seed, function, shape, pattern and first bad coordinate/value in finite JSON evidence.

A one-row reduction of the nine-term witness has serial f32 `1`, blocked f32 `1.000000238418579`, origin f64 `1.0000002980232239`. Check both relations on that *same changed candidate*. Verify numerical rejection of two valid-IR mutants: substitute the wrong axis permutation in inline, omit the tail in split. Check that the accepted pointer doesn't advance.

## Delivery and checks

Implement front end and evaluator first, then the preparation seam, contract and kernels. Test exact locations, affine conv bounds, max call/reduction, greedy sum body, binder capture, precision, order, immutable revisions, skipped multi-use definitions, ragged/empty reductions, mutants and origin retention. `corpus/tensor/<name>/main.tix` covers rectangular matmul, max-shifted softmax, layernorm with gamma/beta/epsilon, scaled single-head attention, two-layer tanh-GELU MLP and stride-one valid NCHW convolution. Compare against independent expected outputs, not just one interpreter against itself.

Build with `npm run build`; run `node --test tests/tensor/*.test.mjs`, `node --test tests/framework/*.test.mjs` and affected Typed pass/pipeline tests. Do not run the full suite. CUDA, fusion and scheduling are outside this ticket.
