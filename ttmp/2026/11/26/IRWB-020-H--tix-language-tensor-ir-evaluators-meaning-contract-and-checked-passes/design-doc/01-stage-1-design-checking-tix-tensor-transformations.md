---
Title: 'Stage 1 design: checking Tix tensor transformations'
Ticket: IRWB-020-H
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
      Note: Shared invariant with precision-specific outcomes
    - Path: repo://src/framework/ir/adapters.ts
      Note: Validated finite artifact and domain projection
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Proposed extraction from native-result preparation
    - Path: repo://src/typed/project.ts
      Note: Origin-anchored async pipeline for comparison
ExternalSources: []
Summary: One proposed pass-layer extraction. Tensor shapes, evaluation and numerical acceptance stay in the domain.
LastUpdated: 2026-11-26T12:48:07-05:00
WhatFor: Review before implementation
WhenToUse: When deciding how to check a synchronous Tix rewrite on v6
---

# Stage 1 design: checking Tix tensor transformations

**Decision requested:** keep Tix as ordered tensor definitions with scalar expression trees, not a CFG. Reuse v6's artifacts, graph diff, pass write sets and sampled invariants. Extract *candidate preparation*, not a synchronous copy of the analysis manager. The numerical decision remains tensor code. No implementation is included in this revision.

## Framework change ledger (proposed, not yet made)

| Layer | Change / reason | How we will tell if it works |
|---|---|---|
| `passes/define-pass.ts` | Extract/export a synchronous `prepareNativeCandidate` from the native-result arm of `applyPass`. Given pass metadata (adapter, writes), input view, `NativeResult` and optional output id, build and validate the artifact, project and diff it, complete correspondence, enforce the declared writes and return candidate, changes, correspondence and edit count. No semantic verdict, store-head update or promise. Keep the existing async pass API, edit path, store options and no-change semantics. Share the write check between paths. | Framework test a valid native edit and an undeclared write, compare candidate revision/diff/correspondence with async `applyPass`; existing Typed pipelines keep their results. |

**Why this one seam:** Typed's `project.runPipeline` awaits `applyPass`, with `contractInputs.origin` and a transformation postcondition. Tix's *public* `optimizeTix` must return a runnable program synchronously. `applyPass`, `AnalysisManager.verifyTransformation` and the strategy interpreter are async even for a pure native rewrite. Blocking on a promise or running Node in a child process is not a solution. The smallest no-framework-change alternative is duplicating native candidate handling in `tensor/`; that puts write enforcement and correspondence on two implementations. The extraction exposes the already synchronous work. It is **not** `applyPassSync`: it cannot execute a transformation with analysis needs, effects or preservation claims. Never report a prepared artifact as an accepted one. Use detached views for Tix; maintain the accepted pointer only in the driver.

Under `tensor/passes.ts` a descriptor pairs a pure synchronous native kernel with its `definePass` wrapper (`run: ctx => kernel(ctx.before.value)`) and its versioned differential postcondition(s). No needs, effects, transfers or rebuilds. Construct the `defineTransformation` ensures bindings and synchronous gate from the same invariant/port mapping; on this closed set of descriptors run `runDifferential(differentialSpec(inv), boundPorts)` directly. No generic interpreter for arbitrary `TransformationDefinition`s. A parity test will run a changed candidate through the async wrapper and manager as well as the sync driver. If more features are needed, revisit the ledger rather than silently ignoring a clause.

**Unchanged:** `core`'s canonical finite JSON is right for program identity, wrong for numerical observations (it normalizes −0). Store literal *spellings* and unary minus, not IEEE specials in the artifact. Keep typed arrays at runtime and failure evidence JSON-safe. `ir` already supports non-CFG adapters; `contracts/differential.ts` already lets `run` distinguish the two sides and `compare` choose any relation. No need for a framework tensor port, precision flag, new relation API, strategy operator or dataflow analysis. Update this ledger with actual file, reason and regression check for *each* framework edit at implementation time.

## Source → checked program

`src/tensor/index.ts` will export the three specified synchronous functions. `compileTix` returns an opaque `TixProgram` holding `origin` and `current` v6 artifacts (initially identical) and the accepted origin relation. `runTix` runs `current`; `optimizeTix` returns a new handle retaining `origin`, even across separate optimizer calls. One source can define multiple independently callable functions. No inter-function calls in the grammar.

- Lexer: names, decimal numbers (including fractional and exponent forms), punctuation, keywords, `//` to newline. Retain 1-based token line and column through parsing and checking, including EOF. Recursive descent with left folds for the two binary precedence levels and prefix negation. A prefix reduction parses a **whole expression** to the current delimiter (including a call-argument comma), not just the next factor. Test `sum(k) a[i,k] / D` versus `(sum(k) a[i,k]) / D` by tree and result. Distinguish `max(j) body` / `max(j,k) body` binder lists from binary `max(expr,expr)` by lookahead; in an ambiguous two-name list, two scalar shape names in scope are call operands, not fresh indices. Don't tokenize all occurrences of `max` as reductions.
- Dimensions and subscripts have a separate integer grammar: normalize sums, differences, constant multiples and parentheses to `constant + Σ coefficient × name`; reject variable products/non-integral coefficients. Keep a plain-name syntax flag for extent inference. Compare normalized dimensions, not strings or sampled lengths. Shape names come from parameter dimensions, not a capitalization heuristic. They may also occur as scalar values. Index names in subscripts resolve to lexical binder IDs, not shape values.
- Build a function-local tensor symbol table in definition order. Diagnose duplicate function/parameter/definition, use-before-definition (including self reference), wrong subscript count, duplicate axes in one binder list, unbound/out-of-scope index, unknown shape, type or return mismatch at its token. Resolve nested reduction names by nearest binder. The function cannot return an expression or define a rank-zero tensor in this grammar.
- First collect, then solve index extents over the complete RHS: each plain `A[...,i,...]` constrains that **binder's** extent to the corresponding axis of `A`; all such constraints must agree. A statement annotation supplies one constraint per LHS binder (also permits a constant fill); it must agree in rank and normalized dimensions. An affine-only LHS binder needs that annotation. An affine-only reduction binder has **no** slot in that annotation and is a compile error. No guessing a kernel width from `y+dy`. For conv, `y` gets `H-KH+1` from the annotation, `dy` gets `KH` from the weight access. Check every read rank and its range: over the rectangular binder box, extrema of an affine subscript come from endpoints selected by each coefficient's sign. For `y+dy` the upper endpoint simplifies to `H-1`.
- Shape binding is a separate problem from extent inference. The linear map from shape names to parameter dimensions must determine those names uniquely: compile its coefficient equations once, reject underdetermination. Bind from actual lengths at call time by exact integer/rational elimination; check integrality, repeated equations, nonnegative dimensions/names, products safe for row-major buffers, keys/ranks/data lengths. `f32[N+1]` can bind N without a separate `f32[N]`. Use integer arithmetic for shapes/offsets, never `fround`. Calls range over representable buffers with nonnegative concrete extents (zero axes allowed), finite input elements and valid affine read ranges. Reject statically inconsistent extents, negative constants and provably invalid subscripts at compile time (`Error` containing `line:col`); obligations depending on actual parameters, e.g. `H-KH+1 >= 0`, are checked at binding before evaluation. For residual range inequalities, check the extrema once, skipping empty iteration boxes, not once per element. No implicit padding, truncation or broadcast axes. A scalar expression may of course read a lower-rank tensor, e.g. `gamma[j]` in a rank-two output.

## IR and evaluation

`tensor/ir.ts`: `defineIR` kind `tensor.index`, schema `1`, and `defineAdapter` with the same kind/version and validator. `createIRArtifact` snapshots the checked native program. Ordered functions contain parameter definitions, result shape, ordered assignments and a return tensor ID. An assignment contains ordered output binders with shape extents, result shape, scalar root. Scalar variants: literal, shape-value, indexed load with affine maps, unary/binary op, named call, reduction with **ordered** binders and body. IDs assigned deterministically on compile; keep surviving IDs, mint fresh ones for inserted nodes. Preserve source spans for diagnostics. No buffers, maps, closures or BigInts in the payload; store only checked safe-integer coefficients (use exact temporaries when solving). Native validation checks tags/arities, uniqueness, ordered scope of defs/loads, binder extents, access maps, return type and internal block bounds. Validate transformed IR using explicit extents, *not* by rerunning source inference: inline can remove the only plain-name occurrence.

Example: `z[i] = sum(k) x[i,k] * w[k];` becomes an assignment over `i:N` whose root is `reduce(sum,[k:D], mul(load(x,[i,k]),load(w,[k])))`. Nothing in this form prescribes register, buffer or device allocation. Compared with an untyped syntax tree it gives lowering the loop bounds and access maps directly; compared with scalar CFG lowering it retains the reduction to be rewritten.

Project function roots, parameter/assignment definitions, binders and scalar nodes as entities with kind-specific data (including axis maps, extents, operation and literal). Ordered containment edges carry slots; binding edges point from loads to definitions and from index uses to binders; a distinct return edge names the result. Include all semantic fields in the projection so a changed map or order changes the diff. Use adapter `entities`, `resolve`, `relations`, `roots`, `describe`, `validate`; native-result passes don't need a graph-to-native rebuilder. Write sets cover only assignment/binder/scalar edits and their containment/binding edges for inline; split only changes scalar/binder entities and their containment/binding edges. Neither changes a signature or return target.

`tensor/evaluate.ts`: one row-major loop interpreter parameterized by `round = Math.fround | identity` and `Float32Array | Float64Array` storage. A separate traversal per precision would duplicate indexing without yielding an independent oracle for it (see hand-computed tests below). Convert inputs on entry to the selected precision; results own their data even when returning a parameter. Shape arithmetic stays integer until a shape is read as a scalar. Round each literal, shape scalar, unary/binary operation and JS Math result before it is used; a multiply followed by add rounds twice. Store the already-rounded element. In f64 keep the full supplied finite double, including literal precision. `sum` starts at +0, `max` at −∞; nested loops enumerate first binder outermost and increasing indices, rounding every combine (`Math.max` for max). Empty loops yield the initializer. Finite inputs can yield nonfinite outputs: don't coerce those to zero. Distinguish −0 from +0 for the exact observation.

## Pass kernels

**`inline` (exact).** Count syntactic load occurrences per tensor, including in nested calls/reductions; a return is an observable use. Choose a non-returned assignment without any reduction and with exactly one load in a later assignment. Substitute its scalar tree at that occurrence, simultaneously composing each producer index map with the consumer load's affine arguments in axis order. Use resolved IDs and fresh tree IDs, never textual replacement; don't change grouping or loop order. Remove producer, retain consumer bounds; scan in source order and recompute uses after an edit. Pure element computation already returns f32, so removing the intervening f32 store/load loses no rounding. A cheaper name-based substitution fails for permuted axes or under a nested binder. Record old load/producer → replacement correspondence.

**`split-sum` (approximate).** Target source-form `sum` with exactly one bound index, not `max` or multi-axis reductions. Fixed width B=4 suffices to exhibit reassociation. Replace its binder `k:E` with nested reductions using fresh integer block and lane IDs:

```
sum(b in 0 .. ceilDiv(E,4))
  sum(l in 0 .. min(4,E-4*b)) body[k := 4*b+l]     // half-open ranges
```

These two extent forms are checked **internal IR**, not new Tix dimensions; the lane bound sees the enclosing block. Both sums start at +0. Preserve increasing order of terms within each block and of partial sums. Do not pad or evaluate outside E. Mark generated levels structurally so another application doesn't split them. Record one-to-two correspondence for reduction nodes. A hidden change to evaluator scheduling would not change the artifact and could not be verified as a pass.

## What “accepted” means

The claim is sampled, not a proof for every shape or magnitude. For every function of the **origin**, generate reproducible concrete calls from its signature, reused for each side. Pin the generator version and seed (7). Include all-symbol assignments drawn from uniform sizes 1, 3, 4, 5 and 9, plus distinct/non-square assignments cycling 2, 3, 5, 7, 9 by shape-name order. Instantiate affine dimensions and filter impossible shape/range assignments; include fixed literal shapes as written. Bound generated work per case (target ≤100,000 scalar loop-body visits) so huge fixed shapes need not be sampled. For each admitted shape include signed seeded f32 values in [-1,1], positive nonconstant values in [0.25,1], ones, and a structured half-ulp pattern. Use f32-representable data on *both* sides: the f64 reference should not measure input conversion error. Ensure at least one nonempty output case per function; insufficient coverage means **no acceptance**, not agreement. Runs with nonfinite f64 references are outside the tolerance sample: screen by origin only, require finite, nonempty coverage per function; a nonfinite candidate on a finite reference always fails. No dropping candidate-dependent mismatches. Specify sample ordering and counts in fixtures; no corpus-name lookup in the optimizer.

Observation is function, rank, ordered shape and **all returned elements** in row-major order, not intermediates or timing. Signatures must also be unchanged. Two versioned `differential` invariants with `tensor.index` ports:

| Relation | Reference | Candidate | Per-element condition |
|---|---|---|---|
| exact | reference program, f32 | f32 | same `Uint32Array` word of returned Float32Array storage (including zero sign and any nonfinite bits) |
| tolerant | **origin in f64**, unsplit | f32 | finite, `abs(candidate-ref) <= 2e-6 + 2e-5 * abs(ref)` |

An absolute floor matters for near-zero cancellation; relative error alone would reject a small rounding residual at zero. Binary32 unit roundoff is about `6e-8`; small contractions plus several rounded ops per output justify a budget of tens to a few hundred roundoffs at unit scale, well below a missing order-one summand. This is a proposed *test threshold*, not a universal stability theorem. Report the largest absolute and scaled error per corpus test and review any failure before changing it. A severely ill-conditioned but algebraically correct split may rightly be declined. Rechecking against previous f32 only would permit accumulated drift. Do not substitute a norm/mean that can hide one wrong output channel.

Acceptance bindings: initially exact checks `origin.f32` vs `candidate.f32`. For inline **always** check `current.f32` vs `candidate.f32`; after an accepted approximation also enforce the origin tolerance, since exact comparison to a reassociated origin would reject a correct inline. Before any approximation the origin gate is exact. For a changed split use only the tolerant origin gate; tests can bind the exact invariant to the *same candidate* independently. A tolerance acceptance never silently upgrades the handle's origin relation to exact. Process pass names in order; check before replacing `current`, on semantic rejection report `{pass,accepted:false}` and continue with the last accepted revision. An identity proposal returns the unchanged revision (accepted, no relaxation of its relation). Success returns `{pass,accepted:true}`; no public mutant names or required API additions. Internally retain sampled counts, seed, function, shape assignment, input pattern, first failing coordinate and expected/actual bits or decimal strings; do not put typed arrays or NaN numbers into framework evidence.

**Falsifiable fixture:** reduce a `[1,9]` row `[1,0,0,0,h,h,h,h,h]`, `h=2^-24`, in both orders. Node 24 probe: serial f32 = `1`; B=4 f32 = `1.000000238418579`; unsplit f64 = `1.0000002980232239`. Exact must reject (not just “different tree”), tolerance must accept; both checks see the half-ulp case. A valid-IR mutant that omits the tail block loses 1 on nine ones, well outside the budget. A valid-IR inline mutant that substitutes producer axes in definition rather than load order transposes a non-symmetric square input; exact must reject it. Run mutants through the normal gate, assert the rejection is numerical, and that `runTix` still runs the previous revision. Also assert both good passes actually change the expected IR, so a no-op can't pass these tests.

## Implementation and review gates (after design approval)

1. `src/tensor/` front end, native IR and adapter. Tests under `tests/tensor/` import built JS: pin line:col for parse, affine, SSA and scope errors, `max` ambiguity, annotation conflicts, affine-only reduction, shape-equation consistency. Exercise two functions, affine parameter binding and symbolic conv bounds. Open and diff an artifact, inspect binder and definition edges; verify revision immutability.
2. Implement `runTix`; independent small scalar expectations for input conversion, shape scalar, signed zero, operation rounding, unary/calls and multi-index order (non-associative witness), reductions at empty extents, row-major non-square data. Include f64 inputs not exactly f32-representable.
3. Implement pass-layer extraction and parity test, then contract, kernels, two mutants and fixtures above. Assert exact preservation on permuted reads under reductions, multi-use and returned producer not removed, width minus/at/plus one, empty and ragged tails. Test rejection followed by a later step and optimization of an already-optimized handle. Inspect evidence, not just final `accepted` flags.
4. Six `corpus/tensor/<name>/main.tix` programs, no metadata dependency. Test compile, run both precisions, optimize and rerun each against an independent small expected result or explicit host loops:

   | Name | Computation / test that exposes a mistake |
   |---|---|
   | matmul | `[M,K] × [K,N]`, rectangular one-hot and dense inputs |
   | softmax | subtract row max, exp, normalize; large positive logits with finite row probabilities |
   | layernorm | row mean, centered variance divided by D, `sqrt(var+eps)`, per-feature gamma and beta; constant row and nonuniform gamma/beta, positive epsilon |
   | attention | single head QKᵀ / √D, row-max-shifted softmax, then weighted V; unequal query/key lengths |
   | mlp | two dense maps with biases, `0.5*x*(1+tanh(sqrt(2/pi)*(x+0.044715*x*x*x)))` between them (`sqrt(2/pi)` as literal constant); signed activations |
   | conv2d | NCHW input, OIHW weights, stride 1, no padding; annotated `[N,O,H-KH+1,W-KW+1]`, reduce `(c,dy,dx)`; nonsymmetric kernel checks last legal window |

5. Build `npm run build`; run `node --test tests/tensor/`, `node --test tests/framework/` and affected Typed tests (at least `tests/typed/{passes,project-meta,strategies,audit}.test.mjs` for the shared native pass path; expand for actual changes). Request escalation on spawn EPERM. Record results, deviations and final framework-change ledger in the ticket, no edits to Typed/tools/existing corpus. No build or implementation qualification is claimed by this design.

**Review focus:** is the candidate-preparation seam sufficiently narrow? Are the residual call-time bounds, per-function coverage rule and exact-after-approximation bindings the intended interpretation? CUDA execution, fusion, contraction tiling and attention-specific rewrites belong to later stages; no interfaces for them here.
