---
Title: Stage 1 design
Ticket: IRWB-020-E
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
      Note: Synchronous sampled comparison already supports asymmetric evaluators
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Async boundary and proposed shared native candidate preparation
    - Path: repo://src/tensor/contract.ts
      Note: Concrete domain and relators
    - Path: repo://src/typed/project.ts
      Note: Existing origin and pass application pattern
    - Path: repo://tests/tensor/passes.test.mjs
      Note: Nine-element witness and negative controls
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:48:04.009330926-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 1: from index notation to checked tensor revisions

**Reviewed decision:** keep tensors as immutable definitions over explicit index domains, not a CFG. Borrow the artifact, projection, pass and differential machinery, not Typed's evaluator or project format. There is one proposed framework change: a synchronous entry point for a native pass checked by a sampled invariant. Stage 1 implements that entry point and checks the six-program corpus.

## Framework change ledger

| Area | Fit / proposed delta | Reason |
|---|---|---|
| `framework/core`, `ir` | No change. Use `defineAdapter`, `createIRArtifact`, `openIR`, `diff`; pair the adapter kind/schema with `defineIR`. | A tensor *program* is finite plain data. Input buffers, outputs and scratch arrays are execution data, not artifacts. |
| `framework/contracts` | No change. Use `differential` with side-dependent evaluation and case comparator, and its existing synchronous `runDifferential` path. | Unlike Typed, the two sides can use different precisions. Nothing in the case runner requires scalar equality. |
| `framework/passes` (`define-pass.ts`, export via `index.ts` as needed) | Factor shared native candidate preparation (validation, diff, correspondence and write policing) out of `applyPass`. Add a narrow synchronous checked-native application path, using the same pass metadata, requiring a synchronous native kernel and an explicit differential invariant. | `applyPass`, manager transactions and edit commit are async; the fixed `optimizeTix` is not. Calling the kernel directly in tensor code loses the framework's write check. Spawning a process or duplicating validation is disproportionate. |
| `framework/dataflow`, `strategy` | No change or use in this stage. | Ordered definitions and a caller-provided sequence need neither CFG analysis nor async strategy search. |

The new path has **no store, manager effects, fact dependencies, preservation claims, edit API or async guarantees**. Take a `definePass` Pass; refuse declared needs, preserves or manager contract. Supply the view but not edit authority; do not silently skip clauses of an ordinary transformation. Prepare without publication, run required relation(s) on validated artifacts, return the candidate only on success. Record differential evidence on rejection. Keep the existing async API and defaults intact. Test shared preparation on a non-tensor fixture, including an undeclared write and a semantic rejection. Do not implement a synchronous AnalysisManager. Record actual changed framework files/reasons and any deviations here before implementation signoff.

### Actual framework delta

Only `src/framework/passes/define-pass.ts` changed. `prepareNative` and `enforceWrites` are shared between the existing async path and `applyNativePassSync`. The latter checks the input view and candidate through the adapter, requires a native result, rejects thenables, and returns only after write and semantic checks pass. The existing wildcard export sufficed. Implementation detail vs plan: the gate takes a synchronous check callback rather than depending directly on a differential invariant. `src/tensor/contract.ts` supplies that callback using the framework's two versioned differential invariants. This keeps case generation and precision policy out of the pass layer. No other framework source or Typed source changed.

## Source and checked IR (`src/tensor`)

`compileTix` scans `//` comments, names, decimal/exponent numbers, punctuation and keywords with 1-based token locations. Recursive descent for functions/statements and precedence climbing for scalar expressions. Reduction header followed by a body parses at lowest binding power up to the current delimiter (including an enclosing call argument comma); `(sum(d) x[i,d]) / D` has a different tree from `sum(d) x[i,d] / D`. Recognize binary `max(a,b)` versus `max(i,j) body` by identifier-list header and body lookahead; ambiguous `max(I,J) -x` with two bound shape values should resolve by namespace (binary call if the arguments are shape expressions; test this corner with reviewer). No implicit multiplication, scalar tensors or broadcasting rules: a scalar operand here is a lane expression.

Each function has ordered params, ordered tensor defs and a returned tensor id. Reject duplicate definitions (including params), unknown/forward reads, rank/shape disagreement, unbound names and missing extents with `line:col`. Check return against declared result. Canonical affine forms are integer constant + sorted `(symbol, integer coefficient)` pairs; addition, subtraction and constant scaling, not products of variables. Preserve syntax information for *plain* index occurrences. For each binder collect all plain-read axis extents, require symbolic equality; a free axis can also take its extent from the corresponding annotated LHS axis, and annotation must agree with any inferred extent. A reduction axis has no such annotation slot: require a plain read somewhere in its scope. Resolve nested binders lexically by identity, not textual replacement.

Bind each shape name from a plain input axis, then evaluate affine dimensions. Reject a symbol lacking a plain binding at compile time. No linear solver. Support nonnegative integer extents and safe integer row-major offsets within allocatable buffers. Known impossible dimensions/accesses are source errors. For affine reads compute min/max from signed coefficients and loop intervals; compare with `[0,dim)` symbolically for the valid shape domain, accounting for empty loops. Example: `y < H-2`, `dy < 3` implies `y+dy <= H-1`. Require a static bounds proof from nonnegative shapes and positive visited extents; reject an unproved access rather than carrying deferred constraints. These are distinct from conflicting plain extents (`N` and `M`), a compile-time error even if some calls would have N=M.

`tix.indexed@1`: scalar expression tree (literal, shape, read with affine subscripts, unary/binary, intrinsic, ordered reduce); explicit loop extents on LHS and reduce binders. One internal `blockedSum(axis,extent,width,body)` denotes the nested loops specified below; no new surface syntax. Keep source locations for diagnostics, stable function-qualified declaration IDs and local binder IDs. The immutable program handle carries the initial artifact and current artifact, identical after compilation. Adapter projects function/param/definition entities; definition attributes include the whole indexed RHS and domains, containment edges carry order and dependency edges connect statements to the tensors they read. Return target lives on function. This coarser projection detects a changed subscript without requiring expression nodes to have cross-revision identities. Native validator checks well-formed scopes, extents, references and types also on rewritten trees. A source AST without resolved binders would require re-inferring extents after inline; generic scalar SSA would discard the loop domains needed here.

## Meaning and API

`runTix(program, fn, inputs, {precision})` interprets the current artifact. Allocate typed row-major outputs per statement, bind LHS indices first-listed outermost, compute each RHS, return the named tensor. A load computes integer offsets, not f32 arithmetic. For default f32, round input on entry including Float64Array data; round literals, shape-as-number, every unary/binary result and `Math` intrinsic with `Math.fround`. No fused multiply-add. `sum` starts at +0; reduction `max` starts at −∞ and uses `Math.max`. Visit reduction tuples lexicographically and round **each update**. f64 uses the same tree/order with JS doubles and Float64Array, without f32 rounding. Sharing traversal avoids accidentally defining two languages; independent small hand-computed oracles must test shared indexing/ordering. Typed arrays may contain nonfinite *results*; never put these buffers into hashed program data.

## Sampled meaning contract

- Domain constructed from **origin only**, every function, reproducibly (mulberry32 seed 20). Sort shape names lexically. Let L=[1,3,4,5,9]. Enumerate five uniform assignments in L order, then for t=0..4 assign symbol j the value L[(t+j)%5]. Deduplicate in order (static shapes: one assignment); keep every distinct assignment with positive tensor and binder extents, at most 65536 lanes/tensor and one million estimated lane visits per function. No eligible assignment for a function rejects the check. For each assignment generate two patterns in order: coordinate-coded, then seeded random. Use positive data for every parameter (not a guessed sqrt/log dataflow slice); layernorm takes eps:f32[1], generated as 0.001. Additionally for single-parameter signatures of last extent nine repeat the nine-element witness across rows. Nonfinite origin outputs still fail the tolerance check. Feed identical f32 input bits to both sides. This is a bounded test, not a theorem for arbitrary shapes or ill-conditioned programs.
- Observe returned rank, extents, length and every lane. Exact compares raw f32 words, including signed zero. Tolerance uses untransformed origin in f64, candidate in f32, finite lanes only, `abs(c-r) <= 2e-6 + 2e-5 * abs(r)` per lane, not a global norm. Fail closed if a required reference/candidate is nonfinite under this relation. Absolute floor covers cancellation near zero; relative term is larger than accumulated roundoff of a few dozen well-scaled adds (unit roundoff ~6e-8), yet far below a missing ordinary term. Not an a priori bound on arbitrary compositions. Evidence: relation/version, seed, fn, shape assignment, pattern, first lane mismatch with words or error and bound.
- `optimizeTix` attempts named passes in order; append `{pass,accepted}`, retaining previous current on semantic rejection. For inline check exact against immediate input. Use identical origin-derived cases across the pipeline: a local exact check preserves the preceding guarantee without another origin check or state flag. Split always checks tolerance against original, never resets its error budget at the previous revision. This keeps an inline after split exact *as an edit* without requiring it to undo split's approved rounding. Unknown pass names are not in the API's supported sequence. Tests can apply a different relation to the same kernel and use private mutant kernels; production names remain `inline` and `split-sum`.

## Rewrites and discriminating tests

**Inline.** Count syntactic tensor read sites plus return uses. Take a non-returned definition with no reduction and exactly one consumer read. Simultaneously compose its free-axis affine substitutions with the read subscripts, by binder id, copy its scalar tree and remove its statement. Retain all rounding nodes/operations and their grouping: a stored lane was already f32. Run in definition order; no duplicated side effects or reassociation. Test permuted indices and reads inside reductions. Mutant: swap two same-extent substitutions on a nonsymmetric matrix; remains well typed, exact checker must reject.

**Split-sum.** For each ordinary single-axis sum, width 4, walk starts `0,4,... < extent`. Inner accumulator starts +0 for each block, visits `start..min(start+4,extent)-1` in order; add each rounded subtotal to an outer +0 accumulator in block order. Leave multi-axis reductions and max untouched. A special node expresses the final short block without introducing floor/mod into affine source expressions. Test empty, short, divisible and tail extents. For one returned lane summing `[1,0,0,0,2^-24,2^-24,0,0,0.25]`, sequential f32 = 1.25, split f32 = f64 reference = 1.2500001192092896. Thus exact must reject a *changed candidate*, tolerance must accept it, and a mutant dropping the partial last block must fail tolerance. Assert evidence and resulting revision, not just the step names.

## Delivery and validation after review

1. Front end, adapter and evaluator tests in `tests/tensor/` importing `../../dist/tensor/index.js`: multi-function parsing, reduction extent/precedence, max call vs binder, affine constraints, duplicate names, located failures, zero extents, row-major strides, input rounding, signed zero and lexicographic cancellation. Exercise v6 artifact validation and diff.
2. Build the six `corpus/tensor/<name>/main.tix` fixtures: rectangular matmul; max-shifted softmax; layernorm (mean, centered variance, eps, gamma/beta); single-head attention (scaled QK, stable softmax, times V); two dense layers around tanh-GELU; NCHW conv2d with 3×3 kernel, stride 1, output H−2 by W−2. Run each against independent tiny JS loop/reference calculations, with distinct axes where possible. Compile/run both precisions, optimize, rerun; include true edits and counterexamples outside corpus happy paths.
3. Implement native pass gate, checked kernels and mutants; verify mixed and repeated pipelines, rejection retention, determinism and no mutation of original. Run `npm run build`, `node --test tests/tensor/*.test.mjs`, `node --test tests/framework/*.test.mjs` and affected Typed regressions (at least `passes`, `inline`, `meaning-memo`, `strategies`). Request escalation for a spawning test if EPERM. Update ledger and diary with actual commands/results.

**Later (not designed here):** CUDA lowering/execution, fusion, contraction tiling, attention-specific rewrites. No scheduler, GPU runtime, parser generator or new numerical framework type is needed for this experiment.
