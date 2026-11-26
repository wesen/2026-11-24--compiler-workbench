---
Title: Stage 1 design
Ticket: IRWB-020-Q
Status: review
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Existing asynchronous contract verification and port validation
    - Path: repo://src/framework/contracts/differential.ts
      Note: Existing sampled relations and synchronous case runner
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Async pass application and reusable native staging
    - Path: repo://src/typed/project.ts
      Note: Existing pipeline reference for original revisions
ExternalSources: []
Summary: Tix evaluation and checked tensor rewrites on the v6 framework.
LastUpdated: 2026-11-26T13:44:32.699919879-05:00
WhatFor: Review the second domain and proposed framework changes before implementation.
WhenToUse: Before implementing or testing IRWB-020-Q.
---

# Stage 1 design

## Goal

Deliver the fixed synchronous API at `dist/tensor/index.js`, six runnable Tix corpus entries, and evidence that the pass contract distinguishes exact, approximate, and wrong rewrites. The result to review first is the framework change inventory below. No implementation in this checkpoint.

## Language and supported domain

- Tokenize with 1-based line and column, including through `//` comments. Parse by precedence; parse a reduction body as a full expression up to its enclosing delimiter. `max` is a binary call when there are two expression arguments with no following body; a bare name list followed by a body is a reduction. At the ambiguous two-name `max` followed by `-`, use subtraction if both names are scalar shape values, otherwise read the minus as the start of a reduction body. Parenthesizing the desired reduction body or call makes this case explicit.
- Input axes are positive integer literals or bare shape names. A shape name binds where it first occurs in a parameter and must agree at every repeat. Results and optional statement types admit integer affine expressions of input-bound symbols; normalize to coefficient maps plus a constant. Reject unsupported affine parameter declarations at the declaration. A concrete call supplies a finite, dense row-major tensor per parameter with matching rank, dimensions, and storage length. Require positive safe-integer dimensions, including evaluated derived extents, and safely representable sizes fitting memory. In f32 mode require inputs finite after conversion. Reject inconsistent *symbolic* shapes at compile time; a valid symbolic program can separately receive an invalid concrete call (e.g. convolution with `H < R`).
- Check function and tensor definition uniqueness, use-before-definition, rank, return name and shape. Give each LHS and reduction index a lexical identity. Collect plain subscript extent constraints by binder (normalize `i + 0` to `i`); all constraints and any declared axis must match symbolically. An LHS binder constrained only by affine subscripts needs a declared axis. A reduction binder needs a plain occurrence because it has no declaration. Reject free or duplicate binders and unknown shape values. For an affine subscript, derive a symbolic minimum and maximum over its binder ranges, and prove `0 <= subscript < axisExtent` by cancellation and the lower bound of one on shape names. This admits `y + dy` with extents `H - R + 1` and `R`: the maximum simplifies to `H - 1`. It is a sufficient check, not a general solver. Reject unproved bounds as well as missing or inconsistent extents. Lexing, parsing and symbolic checks report the relevant source span as `line:col` plus the issue; concrete input mismatches are detected at the call boundary.

A small recursive parser and symbolic normalization suffice for this subset. A parser generator or general affine solver would add machinery without covering a needed corpus case.

## Native IR and evaluator

Use a native `tensor.tix` v1 schema in the v6 artifact envelope. A program stores ordered functions; each function stores parameters, ordered single-assignment tensor computations and a return reference. Each computation owns ordered output binders with resolved symbolic extents, and a scalar expression tree. Nodes store literals, shape values, calls/arithmetic, loads (`tensor ID` plus affine subscripts over binder IDs), reductions (operator, ordered binders/extents and body), or internal blocked sums (same binder/body, plus block size). Include source spans. Preserve IDs of surviving entities. Compared with a source AST, this represents resolved shapes and scopes once; compared with Typed's CFG, it keeps a reduction and its evaluation order visible.

Use `defineIR`, `defineAdapter` and `createIRArtifact`, with one native validator for checked source and rewrites. Project functions, tensors, binders and expression nodes, with ordered containment, load/return dependencies and subscript binding edges. Project extents, opcodes and subscript/literal data so diff-based write checks see semantic changes. Use the native-result path of `definePass` with explicit correspondence for replacements and removals. Native tree edits are smaller here than adding adapter rebuild and generic matching; no IR framework change is needed for the chosen representation.

One evaluator walks the tree and materializes row-major tensors in statement order. The precision switch selects `Math.fround` and `Float32Array`, or identity and `Float64Array`. Round input elements, literals, shape values and each f32 arithmetic and function result; evaluate JS operators and `Math` functions on the rounded operands, without FMA. Reductions start at `+0`/`-Infinity` and round after each accumulation step using increasing lexicographic order (first binder outermost). f64 follows the same order without f32 rounding. Nonfinite intermediate/results follow JS arithmetic. Store literal text, not a negative-zero JSON number (`core/data.ts` normalizes `-0`); preserve `-0` at evaluation. Runtime typed arrays stay out of artifacts and evidence. A separate f64 evaluator would risk drifting in indexing; instead use independent hand or loop oracles in tests.

## Sampled meaning contract

Check every function and require unchanged entry signatures before numerical comparison. In declaration order try uniform shape assignments of 1, 2, 3, 4, and 5 (singleton through two blocks with an odd tail), plus alternating 2 and 3 in both phases to break accidental axis equality. Generate the same suite from the original program for both relations; deduplicate and keep only shapes legal for that program. At each shape use ones (detect omitted or duplicated terms), a fixed-seed signed pattern of binary multiples in `[-1, 1]` (expose axis errors), and the repeated flat pattern `[1, 0, 2^-24, 2^-24, 2^-24]` (rounding witness). Both sides receive the identical f32-representable samples, including when the baseline is evaluated in f64. Require coverage of every function; without a legal sample for a function, do not accept. Evidence identifies the version/seed, decided counts and a bounded set of counterexamples (function, shapes, pattern, first differing cell, values/bits rendered as JSON-safe strings). This is a reproducible finite suite, not a claim about unsampled shapes or values.

- **Exact:** require equal return shapes and equal raw f32 words for the immediate input and candidate. Numeric `===` would miss signed zero and cannot report NaN bits. There are no other externally visible effects.
- **Tolerance:** require equal return shapes and finite elements, and require `abs(candidateF32 - originalF64) <= 2^-19 * (1 + abs(originalF64))` elementwise. The absolute term covers near-zero sums; the relative term scales with output magnitude. For the five-term unit-magnitude probes, binary32 unit roundoff `u = 2^-24` and at most five additions on a path give an absolute bound of `5 * 5u/(1-5u) < 2^-19` in the ordinary rounding model. This motivates the envelope for small sums, not a forward-error bound for arbitrary expression graphs. Ill-conditioned or nonfinite outputs may reject even a mathematically valid rewrite. Exact comparison never falls back to tolerance.

`inline`: select a reduction-free producer with exactly one use (count a return as a use); initially handle a later load using plain indices, including permutations. Substitute the expression using the load's resolved binder IDs, remove the producer, and revalidate. Preserve operation order and f32 rounding; reloading a materialized finite f32 value introduces no extra change. Compare actual output words for all cases, including nonfinite results. Text substitution is smaller but can capture variables or mishandle axis mappings.

`split-sum`: replace a one-binder sum with blocks of two, the smallest block that can reassociate the sum. In ascending `b`, start an independent subtotal at `+0` and evaluate the original body for `i = 2*b .. min(2*b + 2, extent) - 1`; add each subtotal to the outer accumulator. Both levels round at each f32 accumulation. No padded access. Do not split multi-binder or already-blocked reductions, but visit their bodies. An explicit blocked-sum node captures this loop structure without extending source index arithmetic with division or `min`.

`optimizeTix` feeds accepted revisions to the next named pass and leaves the current revision unchanged after a rejected candidate. Each immutable `TixProgram` handle retains its original artifact even across optimize calls. `split-sum` always compares to original f64; comparing each step to the previous result would allow tolerance drift. `inline` checks exact equality to the immediate revision, thereby preserving its established relation to the original, including after a split. A no-op is accepted if its selected contract holds. Public results expose only `{pass, accepted}` per step; tests can inspect revision and internal evidence. Wrong variants are test-only.

## Framework changes proposed for review

| Area | Proposed change and reason |
| --- | --- |
| `passes/define-pass.ts` | Add a synchronous native-result application path with a mandatory differential transformation gate. Share native staging with existing `applyPass`: open/validate, create candidate, diff projections, derive correspondence, enforce declared writes. Check before returning a candidate. Do not allow analysis needs, preservation, async or logical edit bodies, or shared store/manager state in this path. `applyPass` awaits even synchronous kernels; returning a Promise would violate the fixed API, and calling kernels directly would bypass the framework pass and write checks. |
| `contracts/differential.ts` and shared port validation | Add synchronous verification of the pure differential subset of `defineTransformation`: validate exact typed ports, resolve `ensures` bindings and run the existing synchronous differential evaluator with the same result/evidence builder. Require nonempty differential `ensures` without delegated `decide`; do not accept other clauses, effects, declared body or correspondence requirements on this path. Share port validation with `AnalysisManager`. Only a false semantic verdict is a normal pass rejection. `runDifferential` already supports a custom comparison, so no separate comparator framework, new assurance class or second implementation of differential checking is needed. The framework gap is enforcing declared guarantees synchronously. |

The synchronous verifier and the existing manager use the same differential runner, not separate numerical checkers. The simpler alternative of calling `runDifferential` directly in Tix would leave application of the declared contract, including typed port bindings, outside the framework experiment. No changes proposed to `core`, `ir`, `dataflow` or `strategy`. Strategy already composes transformations; it would add an async layer to a fixed ordered pass list. Do not alter Typed's async path or its exact relation. Record any additional framework changes and why in this section during implementation.

## Delivery and tests

1. Build frontend, validator and adapter, then evaluator and corpus. Under `corpus/tensor/<name>/main.tix`: `matmul` (rectangular); `softmax` (max shift); `layernorm` (mean, variance, gamma, beta, epsilon); `attention` (one scaled `QK^T` head, stable softmax and weighted `V`); `mlp` (two affine stages with biases and tanh-GELU); `conv2d` (NCHW, stride one, no padding, affine windows).
2. Test precedence, reduction scope and order, call vs reduction, source locations on invalid shapes/indices/SSA, and concrete shape errors. Check both precisions and signed zero. Check all six corpus entries against small independent loop or hand results; include asymmetric shapes, large softmax logits, and a constant layernorm row.
3. Demonstrate actual candidate changes. For `sum(i) x[k,i]` with shape `[1,5]` and `[1,0,2^-24,2^-24,2^-24]`, a Node 24 probe measured original f32 `0x3f800000`, blocked f32 `0x3f800002`, and original f64 `1.0000001788139343`. The blocked error `5.960464477539063e-8` is below the threshold. Test exact rejection and tolerance acceptance of the same blocked candidate. Drop the final term in the wrong split variant: an odd-length ones case must reject. For inline assert exact acceptance and producer removal, then on a square nonuniform case mis-map two legal axes and require exact rejection. Mutants must be well-formed IR within declared write sets, so rejection comes from the contract. Test pass ordering and repeated optimize calls.
4. Framework tests: undeclared write, false guarantee, an unsupported capability, and evidence parity with the existing async path using the same differential spec. After implementation run `npm run build`, `node --test tests/tensor/`, `node --test tests/framework/`, and affected `tests/typed/` suites (at least `passes`, `evaluate-analyses`, `meaning-memo`, `parallel`). Request escalation if spawning `node` fails with `EPERM`.

## Later

- General affine parameter binding and stronger affine bounds proofs: not needed by this corpus.
- CUDA lowering and GPU execution, fusion, contraction tiling, and attention-specific rewrites: outside Stage 1.
