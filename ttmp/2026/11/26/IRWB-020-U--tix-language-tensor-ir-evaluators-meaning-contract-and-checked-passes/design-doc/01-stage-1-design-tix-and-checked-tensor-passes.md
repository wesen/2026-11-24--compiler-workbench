---
Title: 'Stage 1 design: Tix and checked tensor passes'
Ticket: IRWB-020-U
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
      Note: Existing synchronous sampled contract engine
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Proposed native-only synchronous pass path and shared preparation
    - Path: repo://src/typed/project.ts
      Note: Existing async pipeline and original baseline pattern
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T14:45:56.922859616-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 1 design: Tix and checked tensor passes

## Goal and framework finding

Use the same v6 revision, projection, pass and differential-check machinery as Typed, with a different native IR and two numerical relations. The fixed public API is synchronous. Typed can await `applyPass` and its `AnalysisManager`; Tix cannot. The differential checker already has a synchronous entry point. The gap is a synchronous native pass acceptance path, not a tensor-specific feature or a numerical limitation of contracts.

| Proposed framework change | Why |
| --- | --- |
| `src/framework/passes/define-pass.ts`: factor out native candidate preparation and add `applyNativePassSync` | Share artifact construction/validation, projection diff, correspondence, edit accounting and declared-write enforcement with `applyPass`. Run a synchronous native body and a mandatory synchronous acceptance callback before returning a changed result. |
| Framework regression tests for the new path and shared preparation | Establish async/sync structural parity on a native pass, plus write and semantic rejection and identity behavior. |

Use `definePass` for versioned pass definitions. The sync entry point accepts native results only (`undefined` with no edit operations means no change); it rejects unsupported needs, preservation claims, manager contracts, logical edits and thenables instead of bypassing them. No caller-supplied store, resource effects or analysis-manager transaction. The callback returns an existing `CheckResult`; negative evidence is attached to the existing pass rejection. Nothing installs or returns a rejected candidate as current. Async `applyPass` keeps its existing semantics. A tensor-local second pass runner would duplicate v6 checks; a synchronous `AnalysisManager` would be a much larger change. No changes proposed to core, IR, contracts, dataflow or strategy. In particular, `DifferentialSpec` and `runDifferential` already let the domain choose a comparator and run it synchronously; no new contract engine or orchestration layer.

## Source and shape checking

`compileTix` lexes comments and tokens with one-based `line:col`, then uses recursive descent for declarations/affines and precedence parsing for scalar expressions. A reduction in operand position parses its body at the lowest precedence up to the enclosing delimiter (also a comma separating call arguments). `max` with one or more bare binders followed by a body is a reduction; a two-argument scalar call remains a call. In the overlapping `max(a,b) - x` spelling, use the scalar-call reading when the arguments resolve as scalar shape values; otherwise use the binder reading. Parentheses can disambiguate. Ordinary unary minus applies to literals rather than being part of the numeric token.

Normalize integer affine expressions to a constant and sorted nonzero coefficients, using separate shape-name and index-binder namespaces. The source checker works in statement order: unique function and tensor names, no forward tensor references or reassignment, correct rank at every load and return, and lexically scoped reduction binders. Every syntactically plain subscript contributes the corresponding tensor dimension to its binder's extent. All such extents and any declared extent must agree after normalization. A declared axis can supply an otherwise missing LHS extent (including broadcasts); reduction binders without a plain use have no such fallback. Unbound names, conflicting symbolic extents and missing extents are compile errors at their source locations.

Supported calls supply named parameters as row-major `Float32Array` or `Float64Array` buffers of finite data, with concrete nonnegative integer dimensions and matching storage lengths. Bind shape names from bare input axes, then evaluate all affine input axes and require a consistent binding; an unbound shape name is diagnosed at compile time. Reject source errors and shape contradictions decidable without concrete inputs in `compileTix`. Symbolic constraints depending on caller shapes are checked on binding them in `runTix`, before evaluating a scalar. A source-only API cannot report a concrete mismatch before those shapes are supplied. Include the relevant source location in these diagnostics too.

For affine loads, analyze the minimum and maximum subscript over the rectangular binder ranges (`0..extent-1`), using the sign of each coefficient, and compare with the referenced dimension. Reject provably invalid nonempty accesses at compile time; simplify symbolic differences (e.g. `(H-2)-1 + (3-1) = H-1` in conv2d), and check any remaining shape-only bounds when instantiating the function. An empty enclosing loop does not access its body. This uses one rectangular bounds calculation for both static and concrete checking, not a general constraint solver. No implicit broadcasting by dimension size and no bounds clamping.

## Native IR and evaluation

Use `tensor.indexed`, schema `1`, with `defineIR`, `defineAdapter` and `createIRArtifact`. `TixProgram` holds the immutable current artifact and its original artifact (`r0`); no evaluator state in the artifact. Each function contains ordered parameters and ordered single-assignment tensor definitions, a result tensor ID and source spans. Each definition holds its ordered axis binders, extents and scalar expression tree. Expressions have explicit operations, loads with affine subscripts, shape values, literals, and reductions with ordered binder IDs and extents. The internal split reduction records a block size and its original binder/extent; it denotes two real accumulator loops, not a new source construct. These are loop-level semantics without choosing a machine schedule. A source AST alone would require rediscovering bindings and extents on every rewrite; scalarizing into a CFG would obscure the index domains this stage needs to check.

Project functions, tensors, binder declarations and scalar expression nodes as entities, with ordered containment, dependency edges for loads/returns, and binding edges for index terms. Keep stable IDs for unchanged entities, put the semantic payload (including ordering, extents and split size) in attributes or relations so the diff sees a meaning-bearing edit, and emit correspondence for moved/substituted expression nodes and split reductions. The two passes return native values; no generic projection-to-native rebuild needed. The shared native validator checks schema and well-formedness (references, scopes, extents and bounds) for both source and pass results. Store literal tokens as decimal text and preserve syntactic negation; runtime `-0` and infinities are evaluator values, not artifact JSON. `core` canonicalizes `-0` to `0`, so keep output bit patterns out of artifact values.

One interpreter drives both evaluators: identical row-major loops and expression order, precision-specific rounding/storage. In f32, round Float64Array inputs on load, round each literal, shape value, unary/binary operation and intrinsic with `Math.fround`, and round at every accumulator update. `sum` starts at `+0`, `max` at `-Infinity`; nested loops run in source lexicographic order. Use the corresponding JavaScript `Math` intrinsics, including `Math.max`/`Math.min`; don't replace them with comparisons that lose signed zero. f64 executes the same IR with JavaScript double arithmetic and Float64Array buffers, without intermediate f32 rounding. In tolerance checks both interpreters get identical input values represented exactly in f32; the reference evaluates `r0`, not the transformed IR. `runTix` executes the current artifact in requested precision (default f32).

## Meaning contract and pipeline

**Domain.** This is a deterministic sampled check, not a claim about all finite inputs. Plan cases from the original functions' shapes using small valid concrete bindings. Try extents `0, 1, 2, 3, 5`: empty, singleton, exactly one block, a partial second block, and two full blocks plus a tail. Try uniform and one-axis variations; include the first feasible shape for each corpus signature with literal offsets, e.g. spatial extents at least the 3×3 kernel size. Check constraints before allocating and use a work cap based on estimated scalar iterations to avoid enumerating a large program just for a check. On feasible shapes use zeros (including `-0`), small positive and mixed-sign dyadic values, and a directed cancellation/rounding case. Use seeded generation for mixed-sign values, with fixed order and seed in evidence. This covers block boundaries and inputs that all-positive random draws would miss without trying all combinations. The supplied split-sum test injects its exact witness into this same differential contract; also include a length-five rounding pattern in stock cases where the input axes permit it. Require evidence for every function: if no feasible cases fit the budget for any function, the check cannot accept a change. Never count skipped shape candidates as agreement.

**Observation.** Require unchanged exported function signatures (including normalized shapes and parameter names), and compare the returned shape and all row-major elements. Case labels, shape bindings and first differing index with bits or numerical error make counterexamples reproducible. Do not compare intermediate tensors; removing one is `inline`'s purpose.

**Relations.**

- **Exact:** compare the two f32 output buffers element by element as 32-bit words, not as JS numbers (`+0` and `-0` must differ). Reading words from the produced buffer also avoids a second conversion of any NaN results.
- **Tolerance:** for every element require finite results and `abs(candidate32 - origin64) <= 8u * max(1, abs(origin64))`, where `u = 2^-24`. Require the original f32 result to fit the same envelope on those cases so this gate assesses reassociation of a numerically comparable baseline. The absolute floor covers cancellation near zero; the relative part scales with larger results. For a five-term sum of unit-scale magnitude (`sum(abs(terms))` near one), the standard sequential bound is about `5u * sum(abs(terms))`; `8u` leaves room over that for the witness and the blocked order. It is an intentionally tight sampled budget, not a forward-error claim for longer reductions, arbitrary cancellation or nonlinear programs. Reject rather than widening it automatically. Do not silently accept nonfinite tolerance observations or inconclusive cases. Exact-only checks would prohibit reassociation; measuring only the distance to original f32 could penalize a result for getting closer to the reference.

`optimizeTix` applies passes in user order. Keep `r0` across calls. Until a changed tolerant step is accepted, `inline` must be exact against `r0`. After a tolerant change, `inline` must be exact against its immediate input **and** within tolerance against `r0`; otherwise it would have to undo an accepted reassociation. A `split-sum` candidate is always checked against `r0` in tolerance mode so small errors cannot accumulate step by step. A test can select exact mode for `split-sum` internally without adding a public option. Acceptance keeps the candidate; semantic rejection records `accepted: false` and keeps the previous program. A no-op records `accepted: true` without claiming that a change was checked. The domain gate builds its check result from the existing framework differential evidence. No async/sync duplicate checker.

## Passes and discriminating tests

- **`inline`:** select a pointwise definition with no reductions and exactly one load occurrence, not an exported result. Substitute its expression at that load by mapping producer binder IDs to consumer affine subscripts, composing affine expressions at nested loads. Remove the producer. Keep evaluation tree order and rounding; the pointwise result is already rounded before a materialized f32 store. Binder IDs avoid name capture, including a consumer reduction named like a producer axis. For a negative control, transpose the substituted indices on a square asymmetric input so shape and bounds validation still pass. Expect exact rejection and unchanged revision. Test valid affine substitution, reduction scope and signed-zero preservation as well.
- **`split-sum`:** rewrite single-index `sum` nodes, not `max` or multi-index sums, and don't split an already split node again. Use blocks of two, the smallest size that can reassociate; visit blocks in order and elements within each block in order. Round inner and outer accumulation separately, both starting at `+0`, and clamp each block's end to the extent (no invented padding input). For `sum(d) x[i,d]`, try length five with `[1, 0, u, u, 1/8]`. A Node 24 arithmetic probe gave original f32 `0x3f900000`, blocked `0x3f900001`, equal to the f64 reference. Exact rejects this changed candidate; tolerance accepts it. A mutant that drops the tail by reducing over an in-bounds slice of length `D-1` on this fixture gives `0x3f800001`, so tolerance rejects it. Check these with the same gate and pass path, not just standalone comparator tests.

## Corpus and validation after review

Put each fixture at `corpus/tensor/<name>/main.tix`: matmul (`M×K` by `K×N`); softmax (max shift and row normalization); layernorm (mean, centered population variance, eps, gamma and beta); attention (single-head scaled dot products, row softmax and value contraction); MLP (two affine layers with biases and `0.5*x*(1+tanh(sqrt(2/pi)*(x+0.044715*x*x*x)))` with the constant written numerically); conv2d (NCHW, 3×3 kernel, stride 1 and no padding, declared output `H-2, W-2`, affine `y+dy, x+dx`). The fixed 3×3 dimensions exercise affine slices without requiring extra syntax or a shape solver.

1. Build the parser, verifier, IR and interpreter with API tests: precedence/reduction reach, line/column, shape binding and mismatches, affine bounds, empty reductions, nested lexicographic order, f32-vs-f64 rounding and returned storage. Check all six corpus functions on small asymmetric data against independently calculated results or explicit expected values, not solely against the second evaluator.
2. Add the sync pass path, the domain gate and both passes. Run the mutants, exact-vs-tolerance witness, and a multi-pass test that verifies the original remains the reference even across separate API calls. Exercise the region at and past a block boundary.
3. Build with `npm run build`, run `node --test tests/tensor/` and `node --test tests/framework/`, and run affected Typed suites starting with `tests/typed/passes.test.mjs` and `tests/typed/inline.test.mjs` (expand based on shared plumbing touched). Request escalation if a Node-spawning test hits sandbox EPERM. Record actual framework changes and why in this design and the diary. No code has been changed as part of this design checkpoint.

## Review questions and later work

- Is the small native-only sync helper the right boundary, given the fixed API and Typed's existing async contract path?
- Are the distinction between static shape errors and binding-time obligations, and the sampled tolerance policy after a previous tolerant step, appropriate?
- Later: general solving for shape names that appear only inside affine input dimensions.
- Outside this ticket: CUDA lowering and GPU validation, fusion, contraction tiling and attention-specific rewrites.
