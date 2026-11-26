---
Title: Tix stage 1 design
Ticket: IRWB-020-K
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
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Current transaction lifecycle and shared validation
    - Path: repo://src/framework/contracts/differential.ts
      Note: Both meaning relations fit the sampled comparison hook
    - Path: repo://src/framework/ir/transactions.ts
      Note: Edit requires a rebuilding adapter
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Current pass entry point requires an edit draft and awaits verification
    - Path: repo://src/typed/project.ts
      Note: Typed checks changed revisions against the origin
ExternalSources: []
Summary: Tix source checking, IR, evaluators, meaning relations, passes, and framework fit
LastUpdated: 2026-11-26T12:55:57.401434168-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix stage 1 design

**Review checkpoint.** Compile Tix to a v6 artifact of ordered, single-assignment tensor definitions. Interpret it in f32 and f64. Use the same framework differential checker for exact and tolerant transformations. The expected framework findings are at the pass boundary: native passes need an edit draft even when they never use it, and the checked pass runner is asynchronous while `optimizeTix` must return synchronously.

## 1. Source and supported calls

- Use the ticket's grammar: one or more independent functions, rank ≥ 1, no calls between Tix functions or rebinding tensors. Parameters are already defined; a statement's RHS can read only parameters and preceding statements. Return names must resolve and match the declared return shape. Every source error carries a 1-based `line:col` from the relevant token or expression.
- Use a lexer with spans and `//` comments, recursive descent for declarations, and a precedence parser for scalar expressions. Scalar calls and reductions share `max`: a list of names followed by a body denotes a reduction; a terminated two-expression argument list denotes the call. The ambiguous `max(N,D) - e` is subtraction from a call when both names are in scope as shape values; otherwise it can be a reduction with a negated body. Parenthesize `(-e)` for the reduction meaning in the ambiguous case. Reduction bodies consume a full expression up to the enclosing delimiter (including a comma separating call arguments). Test `sum(d) x[i,d] / D` versus `(sum(d) x[i,d]) / D` explicitly.
- Normalize dimension and subscript expressions to integer affine forms (addition, subtraction, integer scaling, parentheses). Use exact integer arithmetic for normalization and shape binding; represent forms as finite JSON, not BigInt values, in artifacts. Plain means a bare bound index, not an expression such as `i+0`. Collect extent candidates from every plain use of a binder, including uses inside nested reductions. Candidates and applicable declared dimensions must agree as normalized affine forms. An output binder without a plain use needs its statement's declared axis (also allowing explicit broadcast); reduction binders need a plain use. Reduction scopes are lexical, duplicate names in one binder list are errors, and distinct scopes use distinct binder IDs.
- At compile time, check names, ranks, extents, declaration/return compatibility, and shape-independent contradictions. The affine parameter equations must determine all shape names uniquely: a full-column-rank system handles `N`, `2*N+1`, and coupled equations, rather than requiring a dedicated parameter axis for each bare name. Reject underdetermination and inconsistent static shapes. Check access ranges with the affine min/max over bound index rectangles; reject provably invalid nonempty ranges (e.g. `x[i+1] + x[i]` over `x: f32[N]`), and retain any remaining shape-dependent conditions for call preflight. A zero-iteration access site is vacuous. This is a small shape checker, not a general integer constraint solver.
- A valid `runTix` call has exactly the named inputs as finite `Float32Array` or `Float64Array` values, with row-major length matching shape. Shapes bind nonnegative safe integers and yield nonnegative safe-integer extents and representable array sizes. Solve the parameter equations exactly and check all axes, tensor sizes and deferred range conditions before evaluation. For instance, `H-2` needs `H≥2`; inconsistent *actual* shapes can only be checked once supplied. Zero extents are legal. The public shape domain is not the bounded contract sample set below.

A direct source interpreter would be smaller for evaluation alone but would leave passes manipulating unresolved names, extents and types. A checked IR gives both evaluators and both passes one explicit representation of those facts. The compile-time/runtime split avoids both assuming that unrelated shape names coincide and banning useful expressions like `H-2`.

## 2. IR and evaluation

`TixProgram` carries the current `Artifact<TensorIR>`, the compile-time origin artifact, and whether an approximate change has been accepted. `compileTix` initially points both artifact slots to the same revision. Suggested modules in `src/tensor/`: `parser`, `check`, `ir`, `evaluate`, `meaning`, `passes`, and the fixed API in `index.ts`. `runTix` runs the current artifact, not the origin.

- Native kind `tensor.indexed@1`: ordered functions, parameter tensors, statement tensors, output tensor IDs, and source signature and shape obligations. Each statement has a shape, ordered output binders and one scalar expression tree. `load(tensorId, subscripts)` references a prior tensor. `fold(op, axes, body)` has ordered loop binders and explicit ranges. Source axes are `[0,E)`. Internal range forms for `split-sum` are `[0,ceilDiv(E,B))` and `[B*b,min(E,B*(b+1)))`; the latter names a dominating matching block binder. The inner binder is the original logical index, so loads need no remainder operation or padding.
- Share a native validator between `defineIR` and `defineAdapter`; use `createIRArtifact` and the framework's revision identity. Validate expression structure, scoped binders, ordered references, shapes and access obligations on rewritten values as well as source. Keep source shape obligations across rewrites so deleting a producer does not widen the preflight domain. Spans and literal spellings are JSON data; arrays of sample or runtime tensor values and nonfinite scalar values are not stored in artifacts. Literal spelling plus an explicit unary-op node avoids losing signed zero through the framework's canonical JSON.
- Project function, parameter and statement entities with stable IDs, ordered containment, tensor-read dependencies and a return binding. Shapes, scalar bodies (including fold ranges) and signature data are entity attributes, so a native rewrite changes a visible projection. The adapter is read-only; the two passes return new native values with correspondence for removed/retained definitions. Projecting every scalar AST node and implementing a graph rebuild would add editing machinery these passes do not exercise. Conversely, projecting only an opaque program record would hide tensor dependencies and write boundaries.
- Evaluate row-major output elements; evaluate each fold lexicographically, first axis outermost, with sum initialized to `+0` and max to `-Infinity`. Use one interpreter with precision-specific scalar operations: f32 rounds loads from public inputs, literals, numeric shape values, unary/binary and Math function results, and every accumulator step with `Math.fround`; f64 takes the supplied values and uses JS double operations at the same sites without f32 rounding. No fused operations or flat reordering of nested folds. Integer extents/offsets are not f32 values. Return `Float32Array` by default or `Float64Array` in reference mode. Materialize f32 NaNs as a fixed quiet-NaN word `0x7fc00000` (NaN payloads are unspecified by the scalar semantics); preserve signs of zero and infinity. A single interpreter avoids duplicating loop/binding semantics; independent small expected-value tests guard against shared bugs.

## 3. Meaning contract

Use versioned `defineTransformation` contracts (`input`, `origin`, `output`) with an interface/shape-obligation invariant and a `differential()` invariant. Generate cases from the original program, never from the candidate. Check every function and all returned shapes and cells. Unsampled valid calls are not certified, even under the exact relation.

**Domain of the check.** Select deterministic small shape environments per function: uniform values from `{0,1,2,3,4,5,7,8,9}` plus seeded mixed choices from the same set (seed 7). Derive parameter shapes, then keep environments admissible under the original shape preflight. Include unequal axes, zero/one extents and lengths around block boundaries where legal. For each kept shape use finite f32 inputs: uniform ones, signed zeros, seeded signed values in `[-1,1]`, and an axis-varying precision/tail pattern (the nine-element witness below, truncated or repeated). Use those same f32-representable values on both sides, including the f64 reference. Bound the schedule (24 mixed shape attempts per function, at most 65,536 cells per tensor and a million scalar/fold steps per evaluation). Reject a changed candidate if a function has no usable origin shape case or an evaluation exceeds the check budget; do not let skipped cases create a vacuous pass. Include function, shape binding, seed/pattern and first differing cell or preflight failure in counterexample evidence. Encode exceptional values and exact bits as strings, not nonfinite JSON numbers.

| Relation | Baseline and check |
| --- | --- |
| Exact | f32 baseline and candidate have the same shape and identical 32-bit words at each offset. This distinguishes `+0` and `-0`; compare actual output words, not JS numeric equality. |
| Tolerant | Reference `r` is the **origin in f64**; candidate cell `c` is f32. Require both finite and `abs(c-r) ≤ 2e-6 + 2e-5 * abs(r)` for every cell. Empty return shapes can match, but require at least one nonempty result per function across the sample set. Nonfinite observations reject the tolerant check. |

With f32 unit roundoff `2^-24`, nine well-scaled additions have a first-order error of roughly `5.4e-7` times the sum of term magnitudes. The relative term leaves room for surrounding scalar operations on these small samples; the absolute term covers modest cancellation near zero. This is an experimental budget, not an error theorem for deep graphs, large reductions or ill-conditioned inputs. A mathematically sound reassociation can still fail it. A relative-only bound would break near zero, and a candidate-versus-before tolerance could hide accumulated drift.

`inline` always checks exact equality to its immediate input. While no approximate change has been accepted it also uses the origin as the exact baseline (same cases); after `split-sum` it additionally checks the origin in f64, without permitting `inline` itself to change any bits. `split-sum` uses the tolerant origin check; tests apply the exact contract to the same candidate too. Carry origin across `optimizeTix` calls. Run the named passes in order; `accepted: true` includes identity/no-match, and a semantic rejection returns `accepted: false` and continues with the previous artifact. Only check rejection is a declined optimization; don't swallow unexpected validator or evaluator bugs.

## 4. Passes and discriminating examples

- **`inline`**: find a statement with no folds and exactly one load of its tensor in the function (a return counts as a use and is not a substitution site). Substitute its expression at the sole load, composing the actual subscript affine forms for the producer's binder IDs. Remove the producer, retain the consumer ID and rebuild its dependencies. Unique IDs prevent capture under consumer folds. Preserve the source expression tree's operation order; loading a stored f32 adds no rounding to an already-rounded value. Test a pointwise producer on reordered non-square axes and a use inside a fold; a test-only mutant substitutes the wrong expression (e.g. subtraction for addition), leaving well-formed IR that the exact gate rejects.
- **`split-sum`**: replace eligible single-axis `sum` folds, including ones in larger expressions, with nested sums of block size `B=4`. Skip multi-axis folds, `max` and already-blocked folds. The inner sum starts from `+0` per block; the outer sum adds block results starting at `+0`. Cover every original index once, including the last short block. An empty axis still returns `+0`. Materializing a partial-sums tensor would need another intermediate shape and lifetime; nested explicit ranges suffice to expose the altered association.
- **Required real gate test**: for `y[i] = sum(k) x[i,k]` at shape `[1,9]`, use `[1,0,0,0,h,h,h,h,0.125]`, `h=2^-24`. Sequential f32 is `0x3f900000` (`1.125`), split f32 is `0x3f900002` (`1.125000238418579`), and origin f64 is `1.125000238418579`. Exact rejects and tolerance accepts the same candidate. A test-only variant takes the maximum of the block sums instead of summing them; it produces `1.0` on this case and fails tolerance. The same witness tests that the correct pass includes the `0.125` tail. Mutants must reach the actual contract on valid artifacts; schema rejection alone is not evidence. Keep mutants out of the public registry. These numbers have been checked with a standalone Node 24 arithmetic probe, not a compiler test.

## 5. Framework change ledger (proposed)

| Location | Finding and proposed change |
| --- | --- |
| `src/framework/passes/define-pass.ts` | `applyPass` calls `beginEdit()` before it knows whether the pass returns native data. That requires `adapter.rebuild` even for native-only passes. Add an explicit native-only `definePass` mode with no `IREdit` in its callback; `undefined` means identity. Share candidate construction, projection diff, correspondence and declared-write enforcement with the existing runner. Keep the existing edit-backed mode and async callers unchanged. A dummy rebuild for Tix would advertise a false capability. |
| `src/framework/passes/define-pass.ts`, exported from `passes/index.ts` | Add `applyNativePassSync` for synchronous native kernels with no analysis needs or preservation claims and a supported pure gate. It shares native candidate preparation with `applyPass`, and only returns a changed result after verification. No sync store, resource or strategy runner. Changing the fixed API to return a Promise is not an option; blocking a worker or writing a tensor-local pass runner would avoid exercising the framework. |
| `src/framework/contracts/` (pure verifier plus shared validation helpers and docs) | Provide `verifyPureTransformationSync` for the existing `TransformationDefinition` subset with no effects/body, only context-free invariant postconditions, and no property, transfer, or correspondence requirements. Reuse registry/port validation and result/evidence checks from the async path. Check supported clauses before evaluating the kernel; forbid use of the context and reject thenables (observe rejections). Return immutable check evidence with the exact input/output revisions; the pass maps a false invariant to `contractRejected`. No async transaction emulation, history/cache or fact authorization on this path. `differential()` without `decide` already produces a synchronous `CheckResult`; its `compare` hook expresses both relations with no change. |

Typed already supplies an adapter and native edits and compares each accepted revision to its origin (`passes.ts`, `evaluate.ts`, `project.ts`). Tix reuses that division of responsibilities. No changes are proposed to core identity/canonical data, IR projection/revision APIs, dataflow or strategy. There is no CFG analysis or strategy search in this stage: a two-pass list suffices. Document and justify any additional framework change before landing it.

## 6. Corpus, implementation order and validation

Add `corpus/tensor/<name>/main.tix` for rectangular `matmul`; max-shifted `softmax`; `layernorm` with gamma, beta and `eps[0]`; single-head Q/K/V `attention` with scaled scores and max-shifted softmax; two-linear-layer `mlp` with biases and tanh-GELU; and `conv2d` (NCHW input, N/O/Hout/Wout output axes, `y+dy` and `x+dx`, stride 1, no padding). Test each against independent JS formulas on small nonsymmetric data, including non-square spatial dimensions and a nontrivial kernel in conv2d, large nearly equal softmax logits, and non-unit gamma/nonzero beta in layernorm.

After review: (1) implement parser, checked IR and the two precision modes; test diagnostics, affine parameter binding and bounds, scope, zero extents, rank, reduction precedence/order, signed zero and nonfinite intermediate results; (2) add the two framework capabilities and test read-only native passes, write restrictions, sync/async parity and unsupported contracts; (3) add meaning, both passes and the corpus. Test correct acceptance, exact-vs-tolerant rejection, mutants, no-match, second-pass continuation and no origin drift across calls. Run `npm run build`, `node --test tests/tensor/`, `node --test tests/framework/`, and the Typed tests covering pass/contract integration (at least `tests/typed/passes.test.mjs` and `tests/typed/evaluate-analyses.test.mjs`). Request escalation for a test command if spawning `node` hits sandbox EPERM. No implementation validation was run for this design commit.

**Review focus:** the thin synchronous contract subset, source errors versus concrete shape guards, and whether the fixed sample budget/policy is appropriately conservative for the experiment.

## Later (outside this ticket)

- CUDA lowering and GPU runs
- Fusion
- Contraction tiling
- Attention-specific rewrites
