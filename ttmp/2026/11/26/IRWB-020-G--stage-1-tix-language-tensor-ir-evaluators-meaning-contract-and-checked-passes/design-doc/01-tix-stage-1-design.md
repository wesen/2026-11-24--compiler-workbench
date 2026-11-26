---
Title: Tix Stage 1 Design
Ticket: IRWB-020-G
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
      Note: Managed async contract path and port validation
    - Path: repo://src/framework/contracts/differential.ts
      Note: Synchronous sampled comparison with caller-defined relation
    - Path: repo://src/framework/ir/adapters.ts
      Note: v6 artifact validation and logical projection
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Existing async pass runner and shared candidate checks
    - Path: repo://src/tensor/index.ts
      Note: Tix public API
    - Path: repo://src/tensor/meaning.ts
      Note: Sample domain and exact or f64-reference relation
    - Path: repo://src/typed/project.ts
      Note: Typed pipeline and original-baseline precedent
    - Path: repo://tests/tensor/optimize.test.mjs
      Note: Meaning gate witness and wrong rewrite controls
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:48:01.20987567-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix Stage 1 Design

## Goal and scope

Implement the fixed Tix grammar and the three synchronous exports in `dist/tensor/index.js`. A Tix program is
an immutable v6 artifact. A pass produces a candidate revision; the framework checks the candidate before it
can become the next program. The experiment is whether the same artifact, projection, pass, and contract
machinery that serves Typed can serve tensor expressions with symbolic extents and two notions of equality.
This design proposes no changes to Typed and no backend work.

## Front end and supported input domain

The source domain is the fixed Tix grammar with the shape and binding checks below. Calls take a function from
that program and its named, row-major `Float32Array` or `Float64Array` inputs. The pass list contains the built-in
names `inline` and `split-sum`. The contract checks a bounded subset of valid calls, described separately.

- Tokenize the fixed grammar, including `//` comments, decimal/scientific literals, and one-based `line:col`
  spans. Use a precedence parser for scalar expressions, with separate affine parsing for types and subscripts.
  The latter allows integer constants and multiplication by a constant, never products of variables. A
  reduction parses a fresh, lowest-precedence body up to the current delimiter (`)`, `,`, or `;`), with
  parentheses overriding the right-greedy rule. `max` is a reduction for a names-only argument list followed
  by a body; otherwise it is a two-argument call. For the ambiguous `max(D,E) - x` when both names are input
  shape names, prefer the call followed by subtraction; `max(D,E) (-x)` spells a reduction unambiguously.
- Resolve ordered, independent function definitions. Within a function, parameters and prior statements are
  the only tensors in scope; a statement cannot redefine one. `return` names a tensor of the declared shape.
  Check function/parameter uniqueness, reference rank, name resolution, and duplicate indices within each
  binder list. Use fresh IDs for statement and reduction indices; nested reductions can shadow outer indices.
  Standalone scalar names must be shape names, and subscript names must be bound indices.
- Normalize affine forms to integer coefficients and a constant. A plain index occurrence (a name, optionally
  parenthesized) in a subscript proposes that tensor axis as its extent. All proposals for a binder must agree
  as normalized forms. A statement annotation also has to agree and supplies the corresponding left-hand
  extent when no plain occurrence does. It cannot supply an extent for a reduction binder, which has no
  declared axis of its own. Reject missing extents, mismatching proposals, annotated/return shape mismatches,
  and statically invalid dimensions/subscripts in `compileTix`, at the relevant token. Different, unproven
  symbolic extents are not unified on the assumption that a caller will make them equal.
- Bind each shape name from an input axis that isolates it (`N`, `N - 2`, or `2 * N`, for example).
  Mixed input axes are consistency checks; signatures with no isolating axis for a name are outside this
  stage's supported source domain. Use safe integers, not a general equation solver. Valid calls supply
  nonnegative concrete extents and matching finite row-major buffers. Compile-time checks diagnose source
  errors; mismatches in actual input buffers necessarily belong to call validation.
- Prove affine loads in bounds at compile time from their extrema on the enclosing rectangular ranges.
  Normalize and use nonnegative inputs and nonempty loop extents; reject accesses the simple proof cannot
  establish. A statically empty loop cannot load anything. For NCHW conv, `y + dy` reaches `H - 1` with
  extents `H - KH + 1` and `KH`. Do not retain call-entry range predicates or implement a general solver.

Keep the parsed source spans for diagnostics and rewrite provenance. No implicit broadcasting, reordering of
scalar arithmetic, or function calls between Tix definitions. Explicit reuse of fewer indices, as in `m[i]` in
softmax, is how the source expresses broadcasting.

## Artifact and evaluators

`TixProgram = Artifact<TensorModule>`; define `tensor.tix@1` with `defineIR` and a matching `defineAdapter`.
`compileTix` uses `createIRArtifact`. A domain-owned `WeakMap<TixProgram, TixProgram>` links optimized
artifacts returned by this API to their compiled origin. Another `optimizeTix` call on the returned object
recovers that same origin. Initial artifacts are their own origin. This avoids duplicating semantic payloads;
the API works with its in-process artifacts, not detached serialized copies.

The native JSON value has ordered functions, each with shape parameters and
ordered tensor parameters/definitions, a result tensor ID, and a normalized signature. A definition has ordered
output binders with extents, a scalar expression tree, and an inferred or declared shape. Expressions are
literal text, shape value, affine tensor load, unary/binary operation, intrinsic, ordered reduction, or the
internal `blockedSum` described below. Scope is resolved, not recovered by parsing strings in the evaluator.
Storing literal spellings keeps the evaluator's number conversion and signed-zero behavior outside artifact
canonicalization; neither typed arrays nor nonfinite JS numbers belong in an artifact.

Project functions, tensor definitions/parameters, binders and expression nodes as entities, with ordered
`contains`, `reads` (load to tensor), `binds` (index use to binder), and result-to-tensor edges. Semantic scalar
fields and axis order participate in the projection/diff. Keep entity IDs stable across unaffected edits, mint
fresh IDs for copied nodes, and link replacements to originals with native pass correspondence entries. One
native validator shared by the adapter and IR port checks the schema, resolved bindings, order, and shape/range
invariants on candidates as well as source artifacts. Passes return native values: two tree-to-tree rewrites do
not justify implementing a logical-graph rebuild. A flat scalar instruction stream would work, but trees keep
ordered reductions, lexical scopes and their bounds explicit without reconstructing them from control flow.

Use one row-major interpreter with two arithmetic policies:

| | f32, default | f64 reference |
|---|---|---|
| Inputs | Convert supplied elements with `Math.fround` | Use the supplied number (promote f32 exactly) |
| Literals, numeric shape values, operators, intrinsics | `Math.fround` of each JS result | JS double; no f32 narrowing |
| Reduction | Lexicographic, first index outermost; `0` or `-Infinity` identity; round each accumulation | Same loops and identities in double |
| Materialize/return | `Float32Array`; preserve signed zero; use a fixed quiet NaN representation for stored NaN | `Float64Array` |

The selector controls arithmetic, not index math. `max` and `min` use `Math.max`/`Math.min`. Evaluate statements
in definition order, including affine loads using instantiated extents; make no fused operations or algebraic
simplifications. Evaluate empty reductions to their identity. The f64 reference always means the **original**
program in original reduction order for the contract; public `runTix(..., { precision: 'f64' })` evaluates the
artifact passed to it. Independent evaluators could reduce shared bugs, but would duplicate shape/index logic;
independent fixtures will check that logic and both arithmetic policies.

## Checked passes

| Pass | Rewrite and legality | Required relation |
|---|---|---|
| `inline` | A producer with no reductions, exactly one syntactic load across the function, and no return use. Substitute producer index IDs with the corresponding affine subscripts, composing normalized forms. This includes `t[i+1]`, constants, repeated indices and permutations. Clone with fresh expression IDs, then remove the definition. Preserve the producer tree and rounding points. | Bit-identical f32 to the input revision on every case. |
| `split-sum` | Replace each ordinary single-index `sum` in the input snapshot with `blockedSum(index, extent, blockSize: 4, body)`. In order, add partial sums over slices `[b, min(b + 4, extent))`, for `b = 0, 4, …`. Each partial and the outer sum starts at `+0` and rounds every add. The body sees the original absolute index. No padding, no rewriting `max`, multi-index `sum`, or already blocked nodes. | Candidate f32 versus original f64, within tolerance. |

Composing subscripts instead of renaming indices covers slices and diagonals without moving any scalar
arithmetic. Resolved IDs prevent capture under reductions. Implementation finding: combining two individually
valid affine accesses can require a stronger bounds proof than the compile-time checker has. If the composed
form exceeds safe-integer arithmetic or cannot be revalidated, leave that producer in place and consider the
other producers. This is narrower than the reviewed general substitution rule, but avoids a general solver,
new runtime bounds checks, or failing the entire pass. A separate `blockedSum` is smaller than adding
non-affine bounds and index remapping to the general reduction IR; its two ordered loops and tail are explicit
and executable. Both passes use `definePass`, declare actual entity/relation writes, and use the sampled gate as a
postcondition. Neither claims framework analysis preservation. No-match is an accepted identity. A rejected
candidate leaves the preceding accepted revision as the next step's input.

## Meaning contract

Use versioned `differential()` invariants via `runDifferential(differentialSpec(inv), ports)` in the sync gate. The domain and relation live in
`src/tensor`, not in framework policy. Check the public function set and parameter/return signatures, then use
identical concrete shapes and finite f32-representable input values for both sides. Observe the returned shape
and **every** row-major output element; no statistics or unobserved suffix. A candidate call that cannot run a
valid case from the original does not agree. Report the relation and seed, case counts, and a compact first
counterexample with function, concrete shapes, input pattern/seed, output index, and actual/expected bits or
values. At least one decided case is required **per function** for a changed candidate: if the generator
cannot provide one, include a case that explicitly records the missing coverage as a disagreement.

- **Sampled domain:** per function, try uniform bindings in order `1, 2, 3, 4, 5, 8, 9`, then one-axis
  variations of the all-4 binding (shape names in source order, same size order), then 32 seeded mixed
  attempts from those sizes. Derive input shapes, skip duplicates and invalid or over-budget tuples, and
  stop at the first eight admitted tuples. Cap tensors at 8,192 elements and work at 200,000 expression/loop
  steps per call. Test ones, signed asymmetric dyadics in `[-1, 1]`, and the witness repeated in groups of
  eight cells, truncated at the buffer end. Every length-one input named `eps` uses exactly `2^-10` instead;
  layernorm can exercise tolerance with positive epsilon without changing the language. Use origin-derived
  cases and seed `20`. An over-budget candidate disagrees on a completed origin case. Check zero extents
  separately in evaluator fixtures.
- **Exact:** use the raw f32 words of returned arrays, including signed zero, not JS numeric equality or JSON
  array equality. Compare `inline` with its immediate input, using origin-derived cases. Before any accepted
  reassociation this is also exact to the original by induction; after one, an exact inline preserves the
  already checked tolerance to the original on the same cases.
- **Tolerance:** for finite original f64 value `r` and finite candidate f32 value `c`, require
  `abs(c - r) <= 8e-6 + 2e-5 * abs(r)` at every element. Reject nonfinite results for this relation. Every
  reassociating step checks the same original f64, not the previous candidate, so the allowance cannot drift
  across passes. Absolute slack handles cancellation near zero; for a sum of at most 9 unit-scale terms,
  binary32 unit roundoff `u = 2^-24` gives a bound of roughly `9 * 9 * u < 5e-6` for additions alone. The
  relative term is about 336 unit roundoffs, giving room for small, well-scaled compositions. Neither term
  guarantees accuracy for ill-conditioned expressions, long fixed reductions, or arbitrary inputs; legitimate
  rewrites can therefore be refused. Exact f32 equality would prohibit the intended reassociation; f32-to-f32
  tolerance alone could hide a candidate drifting away from the higher-precision reference.

This is differential testing, not a proof. One uniform shape and random values would be simpler but would miss
short final blocks and can miss a reassociation difference even when one is possible. The fixed thresholds are
acceptance policy for small tests; do not loosen them to make a positive test pass. The exact and tolerance configurations are exposed internally to the
same pass gate for test cross-checks; they are not additional public pipeline names.

### Required witness and negative controls

1. For a single row of length 8, reduce `[1, 0, 0, 0, 2^-24, 2^-24, 2^-24, 2^-24]`. Sequential f32 is `1`
   (`0x3f800000`); blocked is `1 + 2^-22` (`0x3f800002`), also the original f64 result. Put this shape and
   pattern in the contract fixtures as well as the evaluator test. Assert the actual changed candidate is
   rejected by exact, accepted by tolerance, and runnable through `optimizeTix`.
2. For `t[i] = x[i] + 1; y[i] = t[i] * 2;`, inline genuinely removes `t`. A mutant using `x[i] - 1` in the
   substituted tree is well-formed but fails exact through the same pass runner.
3. A well-formed `split-sum` mutant adds two copies of the blocked reduction, counting each block twice. An
   all-ones row of length 5 exercises the correct tail and exposes the mutant (10 versus 5). It must fail
   tolerance through the pass runner. In both negative controls assert the meaning gate, not a validator or
   write declaration, caused rejection, and that the next pass sees the last accepted revision.

## Framework changes implemented (complete inventory)

The existing `applyPass` always awaits, even for a native result. `AnalysisManager` also awaits every contract
condition. Typed's async `runPipeline` can use these interfaces; the fixed Tix `optimizeTix` cannot. `differential`
can already run synchronously without a delegated `decide` hook, and it already delegates comparison to the
caller. Finite JSON already suffices for symbolic IR and bit evidence. Neither needs a new numerical API.

| Framework location | Change and reason |
|---|---|
| `src/framework/passes/define-pass.ts` (already re-exported by `passes/index.ts`) | Add `applyPassSync` for a synchronous native-result pass or identity. Share artifact construction, projection/diff, correspondence, write validation and no-op detection with `applyPass`. Require a host callback returning synchronous `CheckResult` on a changed candidate. Return immutable check evidence or reject under `contractRejected`. Refuse managed `contract`, `needs`, `preserves`, graph edits and async results rather than silently skipping them. |

The synchronous entry does not open a logical edit, so a native-only adapter needs no `rebuild` callback.
The existing async entry still opens an edit and was not broadened. The tensor domain runs the existing
differential checker and supplies its verdict; no new manager or helper in
`contracts/`. A tensor-only runner would bypass framework write checks; a synchronous port of the manager
would add transaction machinery this task does not need. No changes to `core`, `ir`, `contracts`, `dataflow`,
`strategy`, or differential sampling. The strategy scheduler is not needed for a synchronous pass list.

## Implementation and validation

1. Add `src/tensor` front end, native IR/adapter, and evaluator. Test greedy reduction placement, `max` forms,
   multi-index/nested lexical order, source locations for invalid programs, affine shapes/bounds, mismatched call
   shapes, f32 rounding and signed zero, f64 reference, and empty/rank/row-major cases.
2. Add the checked sync framework entry and tensor invariants and passes. Add framework tests for native shared
   validation and correspondence, rejection by contract and write set, unsupported clauses and thenables; retain
   async behavior. Add the witness and both negative controls, including an exact pass after reassociation.
3. Add `corpus/tensor/<name>/main.tix`: `matmul`, max-shifted `softmax`, `layernorm` with gamma, beta and a
   positive `eps` fixture (a length-one input), scaled dot-product single-head `attention` with max shift,
   two-layer `mlp` with biases and tanh-GELU, and stride-1 valid NCHW `conv2d`. Test each against a hand-computed
   fixture or independent JS loop reference using nontrivial shapes. Check layernorm tolerance acceptance.
4. Build with `npm run build`, then run `node --test tests/tensor/*.test.mjs` and `node --test tests/framework/*.test.mjs`, plus
   `tests/typed/passes.test.mjs`, `evaluate-analyses.test.mjs`, `meaning-memo.test.mjs` and `strategies.test.mjs`
   for shared pass/contract behavior. Request escalation if the sandbox blocks a test's `node` spawn. Record
   every actual framework change and any deviation from this inventory in the design and diary.

## Later (out of scope)

CUDA lowering and GPU execution; fusion; contraction tiling; attention-specific rewrites.
