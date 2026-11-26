---
Title: Tix stage 1 design
Ticket: IRWB-020-K
Status: active
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
    - Path: repo://src/tensor/index.ts
      Note: Fixed Tix API and checked pass dispatch
    - Path: repo://src/tensor/meaning.ts
      Note: Deterministic meaning cases and comparison relations
    - Path: repo://src/typed/project.ts
      Note: Typed checks changed revisions against the origin
ExternalSources: []
Summary: Tix source checking, IR, evaluators, meaning relations, passes, and framework fit
LastUpdated: 2026-11-26T12:55:57.401434168-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix stage 1 design

**Revised stage 1 design.** Compile Tix to a v6 artifact of ordered, single-assignment tensor definitions. Interpret it in f32 and f64. Use the same framework differential checker for exact and tolerant transformations. The original pass boundary forced native passes to open an edit draft they never used, and it was asynchronous while `optimizeTix` had to return synchronously. The two changes in §5 close those gaps.

## 1. Source and supported calls

- Use the ticket's grammar: one or more independent functions, rank ≥ 1, no calls between Tix functions or rebinding tensors. Parameters are already defined; a statement's RHS can read only parameters and preceding statements. Return names must resolve and match the declared return shape. Every source error carries a 1-based `line:col` from the relevant token or expression.
- Use a lexer with spans and `//` comments, recursive descent for declarations, and a precedence parser for scalar expressions. Scalar calls and reductions share `max`: a list of names followed by a body denotes a reduction; a terminated two-expression argument list denotes the call. The ambiguous `max(N,D) - e` is subtraction from a call when both names are in scope as shape values; otherwise it can be a reduction with a negated body. Parenthesize `(-e)` for the reduction meaning in the ambiguous case. Reduction bodies consume a full expression up to the enclosing delimiter (including a comma separating call arguments). Test `sum(d) x[i,d] / D` versus `(sum(d) x[i,d]) / D` explicitly.
- Normalize dimension and subscript expressions to integer affine forms (addition, subtraction, integer scaling, parentheses). Use exact integer arithmetic for normalization and shape binding; represent forms as finite JSON, not BigInt values, in artifacts. Plain means a bare bound index, not an expression such as `i+0`. Collect extent candidates from every plain use of a binder, including uses inside nested reductions. Candidates and applicable declared dimensions must agree as normalized affine forms. An output binder without a plain use needs its statement's declared axis (also allowing explicit broadcast); reduction binders need a plain use. Reduction scopes are lexical, duplicate names in one binder list are errors, and distinct scopes use distinct binder IDs.
- At compile time, check names, ranks, extents and declaration/return compatibility. Bind a shape name using a parameter axis that mentions only that name (e.g. `N` or `2*N+1`); any other axes can use those names in affine forms. No simultaneous equation solver. For accesses, compute the affine extremes over the bound index rectangle and require a static proof that they fall within the target axis. Prove ordinary inequalities by affine cancellation and by using nonnegative shape names, declared input dimensions and the positivity of the enclosing loop extents at a reachable access. Reject unresolved bounds at compile time rather than inserting runtime access obligations. A statically empty iteration space needs no proof. For conv2d the worst height subscript is `(H-KH+1-1)+(KH-1) = H-1`.
- `runTix` takes finite row-major float typed arrays with the named inputs and matching ranks/lengths. Concrete axes bind the shape names and must agree with the signature. A valid call has nonnegative safe-integer extents for the computed tensors and representable array sizes. Checking concrete shapes when binding them is unavoidable; there are no persisted access guards or deferred access proofs. Zero extents are legal. The public shape domain is not the bounded sample set below.

A direct source interpreter would be smaller for evaluation alone but would leave passes manipulating unresolved names, extents and types. A checked IR gives both evaluators and both passes one explicit representation of those facts. Static access proofs prevent accidental reliance on particular call shapes.

## 2. IR and evaluation

`TixProgram` carries the current `Artifact<TensorIR>`, the compile-time origin artifact. `compileTix` initially points both artifact slots to the same revision. Suggested modules in `src/tensor/`: `parser`, `check`, `ir`, `evaluate`, `meaning`, `passes`, and the fixed API in `index.ts`. `runTix` runs the current artifact, not the origin.

- Native kind `tensor.indexed@1`: ordered functions, parameter tensors, statement tensors, output tensor IDs, and source signature. Each statement has a shape, ordered output binders and one scalar expression tree. `load(tensorId, subscripts)` references a prior tensor. `fold(op, axes, body)` has ordered loop binders and explicit ranges. Source axes are `[0,E)`. Internal range forms for `split-sum` are `[0,ceilDiv(E,B))` and `[B*b,min(E,B*(b+1)))`; the latter names a dominating matching block binder. The inner binder is the original logical index, so loads need no remainder operation or padding.
- Share a native validator between `defineIR` and `defineAdapter`; use `createIRArtifact` and the framework's revision identity. Validate expression structure, scoped binders, ordered references, shapes and static access bounds on rewritten values as well as source. Spans and literal spellings are JSON data; arrays of sample or runtime tensor values and nonfinite scalar values are not stored in artifacts. Literal spelling plus an explicit unary-op node avoids losing signed zero through the framework's canonical JSON.
- Project function, parameter and statement entities with stable IDs, ordered containment, tensor-read dependencies and a return binding. Shapes, scalar bodies (including fold ranges) and signature data are entity attributes, so a native rewrite changes a visible projection. The adapter is read-only; the two passes return new native values with correspondence for removed/retained definitions. Projecting every scalar AST node and implementing a graph rebuild would add editing machinery these passes do not exercise. Conversely, projecting only an opaque program record would hide tensor dependencies and write boundaries.
- Evaluate row-major output elements; evaluate each fold lexicographically, first axis outermost, with sum initialized to `+0` and max to `-Infinity`. Use one interpreter with precision-specific scalar operations: f32 rounds loads from public inputs, literals, numeric shape values, unary/binary and Math function results, and every accumulator step with `Math.fround`; f64 takes the supplied values and uses JS double operations at the same sites without f32 rounding. No fused operations or flat reordering of nested folds. Integer extents/offsets are not f32 values. Return `Float32Array` by default or `Float64Array` in reference mode. Materialize f32 NaNs as a fixed quiet-NaN word `0x7fc00000` (NaN payloads are unspecified by the scalar semantics); preserve signs of zero and infinity. A single interpreter avoids duplicating loop/binding semantics; independent small expected-value tests guard against shared bugs.

## 3. Meaning contract

The sync native runner calls a tensor gate returning a framework `CheckResult`. The gate first compares origin and candidate signatures (ordered function names, ordered parameter names and affine shapes, and declared output shapes), ignoring spans and the internal return tensor ID. It then uses versioned framework `differential()` specs through `runDifferential(differentialSpec(inv), ports)`. No second evaluator for general transformation contracts. Always generate cases from the compile-time origin; check every function and all returned shapes and cells. Unsampled valid calls are not certified, even under the exact relation.

**Case schedule.** For each function, try nine uniform bindings in order from `[0,1,2,3,4,5,7,8,9]`, then 24 independent seeded mixed trials picking uniformly from that list for each shape name in sorted order (seed 7, one stream for the program). Deduplicate by the binding tuple; at most 33 bindings per function (one for a concrete signature). These choices exercise 0/1 and both sides of the block-size boundary where the signature permits it. Drop inadmissible origin shapes and those over 65,536 cells per tensor or 100,000 estimated loop/expression visits. A function must have a sampled shape; for tolerance it must have a sampled nonempty output shape as well.

For each kept shape use ones, alternating signed zeros, seeded signed values in `[-1,1]`, and a precision/tail pattern along each axis (the nine-element witness below, cycled; for lower-rank inputs reuse axis 0 when the requested axis is absent). The corpus convention is a parameter named `eps` gets positive f32 `1e-5` in every pattern; this prevents sampling undefined layernorm outputs without changing what `runTix` accepts. All values are f32-representable and shared by the two sides. Reject nonfinite observations under tolerance, even if both sides produce them.

Both sides are evaluated with a cap of 800,000 loop/expression visits and 65,536 cells per tensor. The origin's much lower admission limit gives `split-sum` room for extra loop/accumulator work, not just the remainder of the original budget. A candidate that still exceeds the cap is declined rather than counted as agreement (in particular, inline may duplicate dynamic work under a loop). Evidence includes function, binding, pattern and the first differing cell or budget diagnostic; encode exceptional values and exact bits as strings.

| Relation | Baseline and check |
| --- | --- |
| Exact | The immediate input and candidate, both evaluated in f32, have the same shape and identical 32-bit words at each offset. This distinguishes `+0` and `-0`; compare actual output words, not JS numeric equality. |
| Tolerant | Reference `r` is the **origin in f64**; candidate cell `c` is f32. Require both finite and `abs(c-r) ≤ 2e-6 + 2e-5 * abs(r)` for every cell. Empty return shapes can match, but require at least one nonempty result per function across the sample set. Nonfinite observations reject the tolerant check. |

With f32 unit roundoff `2^-24`, nine well-scaled additions have a first-order error of roughly `5.4e-7` times the sum of term magnitudes. The relative term leaves room for surrounding scalar operations on these small samples; the absolute term covers modest cancellation near zero. This is an experimental budget, not an error theorem for deep graphs, large reductions or ill-conditioned inputs. A mathematically sound reassociation can still fail it. A relative-only bound would break near zero, and a candidate-versus-before tolerance could hide accumulated drift.

`inline` uses the exact relation to its immediate input on origin-derived cases. `split-sum` uses the tolerant relation to the compile-time origin; tests apply the exact gate to the same candidate too. Carry origin across `optimizeTix` calls. Run named passes in order; `accepted: true` includes identity/no-match. A declined pass reports `accepted: false` and leaves the current artifact unchanged. Unexpected implementation errors are not ordinary rejections.

## 4. Passes and discriminating examples

- **`inline`**: find a statement with no folds and exactly one load of its tensor in the function (a return counts as a use and is not a substitution site). Substitute its expression at the sole load, composing the actual subscript affine forms for the producer's binder IDs. Remove the producer, retain the consumer ID and rebuild its dependencies. Unique IDs prevent capture under consumer folds. Skip a substitution if the composed affine access cannot be represented or re-proved by the static checker; for example, the checker cannot combine two independent dimension inequalities to prove a composed access. Preserve the source expression tree's operation order; loading a stored f32 adds no rounding to an already-rounded value. Test a pointwise producer on reordered non-square axes and a use inside a fold; a test-only mutant substitutes the wrong expression (e.g. subtraction for addition), leaving well-formed IR that the exact gate rejects.
- **`split-sum`**: replace eligible single-axis `sum` folds, including ones in larger expressions, with nested sums of block size `B=4`. Skip multi-axis folds, `max` and already-blocked folds. The inner sum starts from `+0` per block; the outer sum adds block results starting at `+0`. Cover every original index once, including the last short block. An empty axis still returns `+0`. Materializing a partial-sums tensor would need another intermediate shape and lifetime; nested explicit ranges suffice to expose the altered association.
- **Required real gate test**: for `y[i] = sum(k) x[i,k]` at shape `[1,9]`, use `[1,0,0,0,h,h,h,h,0.125]`, `h=2^-24`. Sequential f32 is `0x3f900000` (`1.125`), split f32 is `0x3f900002` (`1.125000238418579`), and origin f64 is `1.125000238418579`. Exact rejects and tolerance accepts the same candidate. A test-only variant takes the maximum of the block sums instead of summing them; it produces `1.0` on this case and fails tolerance. The same witness tests that the correct pass includes the `0.125` tail. Mutants must reach the actual contract on valid artifacts; schema rejection alone is not evidence. Keep mutants out of the public registry. These numbers have been checked with a standalone Node 24 arithmetic probe, not a compiler test.

## 5. Framework change ledger

| Location | Finding and proposed change |
| --- | --- |
| `src/framework/passes/define-pass.ts` | `applyPass` calls `beginEdit()` before it knows whether the pass returns native data. That requires `adapter.rebuild` even for native-only passes. Add an explicit native-only `definePass` mode with no `IREdit` in its callback; `undefined` means identity. Share candidate construction, projection diff, correspondence and declared-write enforcement with the existing runner. Keep the existing edit-backed mode and async callers unchanged. A dummy rebuild for Tix would advertise a false capability. |
| `src/framework/passes/define-pass.ts` (also exported by the existing barrel) | Add `applyNativePassSync` for synchronous native kernels with no analysis needs, preservation claims or manager contract. It requires a synchronous gate returning `CheckResult` for a changed candidate. Share native preparation, diff, correspondence and declared-write checks with `applyPass`. Reject false verdicts as `contractRejected`; do not reinterpret arbitrary exceptions as rejections. No synchronous store, resource, or strategy runner. |


Typed already supplies an adapter and native edits and compares each accepted revision to its origin (`passes.ts`, `evaluate.ts`, `project.ts`). Tix reuses that division of responsibilities. No changes to contracts, core identity/canonical data, IR projection/revision APIs, dataflow or strategy. There is no CFG analysis or strategy search in this stage: a two-pass list suffices. Document and justify any additional framework change before landing it.

## 6. Corpus, implementation order and validation

Add `corpus/tensor/<name>/main.tix` for rectangular `matmul`; max-shifted `softmax`; `layernorm` with gamma, beta and `eps[0]`; single-head Q/K/V `attention` with scaled scores and max-shifted softmax; two-linear-layer `mlp` with biases and tanh-GELU; and `conv2d` (NCHW input, N/O/Hout/Wout output axes, `y+dy` and `x+dx`, stride 1, no padding). Test each against independent JS formulas on small nonsymmetric data, including non-square spatial dimensions and a nontrivial kernel in conv2d, large nearly equal softmax logits, and non-unit gamma/nonzero beta in layernorm.

`src/tensor/index.ts` is the API entry point. `tests/tensor/language.test.mjs` covers parsing, checked shapes and precision; `tests/tensor/passes.test.mjs` exercises the gates and mutants; `tests/tensor/corpus.test.mjs` compares all six programs with independent formulas. `tests/framework/native-pass-sync.test.mjs` checks native paths through both runners, declared writes and the synchronous gate boundary. Run `npm run build`, `node --test tests/tensor/*.test.mjs`, `node --test tests/framework/*.test.mjs`, and the Typed tests covering pass/contract integration (at least `tests/typed/passes.test.mjs` and `tests/typed/evaluate-analyses.test.mjs`). Request escalation for a test command if spawning `node` hits sandbox EPERM. Do not run the full suite.

## Later (outside this ticket)

- CUDA lowering and GPU runs
- Fusion
- Contraction tiling
- Attention-specific rewrites
