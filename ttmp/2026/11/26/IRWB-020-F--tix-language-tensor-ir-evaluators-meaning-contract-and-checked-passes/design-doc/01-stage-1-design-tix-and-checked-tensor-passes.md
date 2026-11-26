---
Title: 'Stage 1 design: Tix and checked tensor passes'
Ticket: IRWB-020-F
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
      Note: Existing asynchronous transformation lifecycle
    - Path: repo://src/framework/contracts/differential.ts
      Note: Reusable sampled comparison and evidence
    - Path: repo://src/framework/ir/adapters.ts
      Note: Artifact and projection support
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Current async pass and native preparation
    - Path: repo://src/typed/project.ts
      Note: Original-baseline pipeline and rejection precedent
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:52:17.495868197-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 1 design: Tix and checked tensor passes

## Decision in brief

Tix compiles to an immutable v6 artifact of ordered tensor definitions with scalar expression trees and
explicit index binders. A single interpreter defines both f32 semantics and a JavaScript-double reference.
Each changed pass candidate is checked before it can become the result of `optimizeTix`. `inline` must preserve
f32 bits; `split-sum` may change them within a sampled tolerance against the original f64 program.

The framework's representation and differential checker already fit. The mismatch is execution: the fixed Tix
API is synchronous, while even a synchronous body and evaluator go through asynchronous `applyPass` and
`AnalysisManager` entry points. The proposal is a small synchronous native-pass path and a context-free
postcondition runner, not a second analysis manager. This document is the proposed framework change ledger;
no implementation has landed.

## Source and shape checking

- A token scanner tracks 1-based line and column (including an EOF token) and skips `//` comments. Use a
  precedence parser with delimiter-aware reduction bodies: `sum(d) x[i,d] / D` and `(sum(d) x[i,d]) / D`
  produce different trees. A reduction consumes its body up to the enclosing `)`, call argument comma, or
  statement delimiter. Resolve the two `max` forms using a name-list lookahead and a following expression;
  where a binary call on two known shape names also parses (e.g. `max(N,D) - ...`), prefer the call. Use
  separate name resolution for tensor references, scalar shape names and lexically scoped index binders.
- Check each function independently, in statement order: unique function and parameter names, no tensor
  reassignments, no forward reads, correct reference rank, distinct names in each binder list, no free indices,
  and a return referencing an already defined tensor of the declared type. Every source check error cites
  the offending token. A returned parameter is allowed.
- Normalize shape/index expressions to affine integer forms (constant plus coefficients keyed by resolved
  symbols). Plain means a syntactically bare index, not a dimension equation extracted from `i + 1` or
  `i + 0`. Gather plain-use extents per binder throughout its lexical scope; they must agree by normalized
  affine equality. Check LHS extents against a declaration if present; an LHS binder without a plain use
  needs its corresponding declared extent. Reductions have no annotation site, so a reduction binder
  without a plain use has no extent and is rejected. This permits permutation, broadcasting via an unused
  declared axis, and affine reads without treating `y + dy` as an extent for either binder.
- Input dimensions form affine equations in the function's shape names. At compile time check that all
  shape names are introduced by parameter types and uniquely determined over the rationals (full column
  rank). At invocation, solve the fixed system exactly against the supplied dimensions; require a
  consistent nonnegative integer binding, and validate concrete ranks, extents and row-major lengths.
  A direct-name-only binder would be simpler but would exclude unambiguous affine signatures such as
  `f32[2 * N + 1]`. Do not infer a shape name from the return or from tensor data.
- Compile each access into a rectangular range obligation. For `c + Σ aᵢ iᵢ`, use `iᵢ ∈ [0,Eᵢ-1]` and
  coefficient signs to derive affine min/max bounds. Check static contradictions at compile time and
  discharge provable bounds; carry residual obligations on symbolic dimensions into shape binding. A body
  reached only through an empty loop does not dereference anything. The same binding step checks any
  residual nonnegativity constraints on evaluated dimensions. For example, conv2d's `OH = H - KH + 1`,
  `y + dy` and domains `[0,OH)` and `[0,KH)` imply `y + dy <= H - 1` for nonempty loops, with a remaining
  obligation on the concrete output extent. No general integer constraint solver: source extent
  inconsistencies are compile errors; mismatched concrete shapes or violations of residual constraints
  cannot be diagnosed until `runTix` gets the shapes and are checked before evaluation. Inferred extents
  that disagree are not turned into runtime equality guards.

The evaluator domain is well-formed Tix with dimensions and row-major allocations representable on the
host and finite input values in the selected precision (in f32 mode, after conversion). Zero extents are
supported. Use exact integer arithmetic for affine normalization, binding and bounds; convert validated
loop extents and offsets to host integers. `runTix` can evaluate more shapes than the optimizer samples.

## Native IR and evaluators

Use `Artifact<TensorModule>` (`TixProgram`) with `defineIR` and `defineAdapter` sharing a native validator.
Each function has a signature, an ordered list of tensor definitions and a result tensor ID. Each definition
has a shape, ordered LHS binders and a scalar tree: literal, shape value, affine load, unary/binary
operation, call, reduction, or the internal blocked sum. A binder has a stable ID and an extent. Loads
refer to a tensor ID and affine maps of binder IDs; reductions own ordered lexical binders and a body.
Keep source locations for diagnostics and use stable IDs for retained entities. The validator rechecks
structure, binding, definitions, extents and access obligations independently of the parser and pass code.
Represent literal spellings and any wide integer coefficients as strings in the finite JSON payload; runtime
values, including signed zeros and nonfinite results, are not artifact data.

Project functions, tensors, binders and scalar nodes as entities. Use containment with ordered slots,
load-to-tensor and return dependencies, and access-to-binder edges. Include operator, affine maps, extents,
block size and all other semantic fields in the projection so v6's write checks see the actual edits.
Use native rewrites with correspondence entries for moved, replaced or split nodes. No adapter rebuild is
needed for these passes. A flat graph alone would obscure lexical scope and order; lower-level CFG/SSA would
lose the explicit reduction and iteration structure before it is needed. Ordered binders and affine loads
already describe the loops an interpreter needs.

Both precisions execute tensor definitions in order, materializing row-major buffers and evaluating a cell
with its bound indices. f32 loads use f32-converted inputs; apply `Math.fround` at every literal, shape value,
unary/binary primitive, builtin result and reduction step. Do not fold, fuse, reorder or move rounding
across expression boundaries. Use the JavaScript `Math` builtins (including `Math.min`/`Math.max` signed-zero
semantics). Both reductions start with the specified identities (`+0`, `-Infinity`) and traverse increasing
lexicographic order, first index outermost; an empty reduction returns its identity. Finite inputs can
produce nonfinite outputs. Use a fixed quiet NaN encoding at f32 buffer stores so payloads are not an
accidental host-dependent part of the bit contract. f64 reads supplied values as doubles and uses the same
tree/traversal without `fround`, with `Float64Array` storage. During checks feed both precisions the same
f32-representable inputs. One evaluator with two rounding policies avoids duplicating index/shape semantics;
independent tiny expected-value tests are needed because differential checks cannot catch a shared bug.

## Meaning contract

Define versioned framework `differential` invariants; put the case policy and tolerance in the definition
version. Use three revisions as needed: the artifact from `compileTix` (r0, retained across optimization
calls), the last accepted artifact, and the candidate. The host wrapper retains r0 separately from the
candidate payload; r0 is not part of any tensor entity. Before the sampled checks, require the same function
names, parameters and normalized signatures and keep the original invocation-domain obligations. Do not
silently discard constraints when an intermediate tensor is removed.

**Sample domain.** Generate cases from r0, for every entry function, never from the candidate. Try uniform
shape-name assignments, single-name perturbations and bounded mixed assignments from
`{1,2,3,4,5,6,8,9}`, in a fixed order, deduplicated after binding. Keep up to eight valid, affordable shapes
per function; reserve half for nonuniform assignments if there are multiple names and feasible choices.
Include an empty assignment for concrete signatures. Prioritize block-boundary values `1,3,4,5,6,8,9`
for a single shape name. Skip shapes violating r0's checked shape constraints. Use a
fixed search budget (256 proposals per function), 16K elements per tensor and a deterministic budget of
250K evaluator steps per run. For each retained shape use zeros (including signed-zero patterns), ones,
axis-dependent ramps, alternating signs, and seed-7 f32-rounded draws in `[-1,1]`; also use a sparse
leading-1 / half-ulp pattern along input axes of length six (the witness below). Short deterministic
patterns and seeded variation serve different purposes: they expose sign, access and tail bugs that random
values alone may miss. If any function has no cases, or an evaluated case exhausts its budget, the changed
candidate cannot be accepted. This is a bounded test domain, not a proof of exactness or stability for all
shapes and finite values. No user API is needed to configure it.

**Observation and relation.** Compare the returned shape and every row-major element. A candidate unable to
run an r0 case does not agree. Exact compares the f32 buffer's `Uint32Array` words (including zero sign and
canonical NaNs). Tolerance requires finite candidate and reference outputs and, elementwise,
`abs(candidate - r0_f64) <= 2e-5 + 2e-5 * abs(r0_f64)`. The absolute term handles near-zero results where a
pure relative error test breaks down; the relative term accommodates nonzero magnitudes. For short, bounded
sums (e.g. nine additions of terms of order one), nine unit roundoffs at f32 `u = 2^-24` times the sum of
magnitudes is on the order of `5e-6` or less, before propagation. The threshold allows headroom for normal
rounding and some propagation in the small corpus, without admitting missing order-one terms. There is no
forward-error guarantee on ill-conditioned programs; a large reference error or nonfinite result can veto a
valid reassociation. Do not tune the policy to pass every transformation. Record sampled evidence and
replayable case information (function, shape, pattern/seed, first differing element, and bits or error bound).

For `inline`, check exact against the immediate predecessor and against r0 if still in exact mode. After an
accepted tolerant edit, additionally require the r0 tolerance check instead of exact against r0. For
`split-sum`, check tolerance against r0, not the previous candidate, to prevent drift. These are separate
checks: an exact rewrite after a tolerant one cannot exploit the remaining error budget. Test the split
kernel under an exact gate too; that override is an internal test seam, not a public option. A no-op leaves
meaning unchanged and counts as accepted. A failed semantic check reports `accepted: false`, keeps the last
accepted revision and continues with the next named pass. Only supported pass names (`inline`, `split-sum`)
are part of the fixed API; test mutants use the same framework runner without registering public names.

## Rewrites and decisive tests

- **`inline`:** Find a reduction-free producer with one syntactic read, counting the return as a use and
  never deleting a returned tensor. Replace the read with the producer expression at the read's coordinates,
  composing each affine load with the mapping from producer LHS binders to consumer access expressions.
  Preserve operand order, all existing rounding points and lexical bindings. Remove the producer and emit
  correspondence to the cloned nodes. Materialization itself is not an additional numerical operation when
  a producer cell already has the evaluation precision. Start with single-use producers, not general fusion
  or duplication. Mutation test: for `t[i] = x[i] + 1; y[i]: f32[N-1] = t[i+1] * 2;` replace `i+1` with `i`
  during substitution. The mutation is well-formed and differs on a ramp; the contract must reject it.
- **`split-sum`:** For a sum with one binder, use an internal `blockedSum(extent, binder, body, blockSize=4)`.
  Compute a partial from `+0` for each contiguous block in increasing index order, then sum partials from
  `+0` in increasing block order. Bind the original index to `4*b + lane` over the clipped tail range;
  zero extent means no blocks. A dedicated internal node is smaller than adding non-affine dimensions or
  predication to the source or IR just to express a tail. Do not rewrite `max` or a multi-index sum at this
  site. A block sum is not eligible for splitting again. Test a deliberately wrong candidate whose effective
  sum extent omits the final index (e.g. `max(0,E-1)` as the mutant's loop bound, not a new shape operator).
  For five ones the last partial is lost and the order-one error must fail tolerance. Use a shape-valid
  mutant and assert semantic rejection rather than structural failure.
- **Reassociation witness:** `fn reduce(x: f32[1,N]): f32[1] { y[i] = sum(d) x[i,d]; return y; }`, with
  `N=6` and `[1,0,0,0,2^-24,2^-24]`. Each half-ulp term ties back to 1 in the sequential sum. In the split
  sum the two terms first form `2^-23`, giving output bits `0x3f800001` vs `0x3f800000` at r0. The split
  equals the f64 reference on this witness. Assert rejection under exact, acceptance under tolerance and
  retention of the last accepted revision on rejection. A Node 24 arithmetic probe confirmed these bits;
  the integration and mutant tests are implementation work.

## Framework change ledger (proposed)

| Area | Proposed change and reason | What stays unchanged |
| --- | --- | --- |
| `framework/passes/` | Add `applyNativePassSync` for synchronous native results. Share native candidate preparation with `applyPass`: v6 artifact creation, projection/diff, correspondence and declared-write checks. The tensor adapter need not implement `rebuild` just to satisfy `applyPass`'s eager edit creation. Accept after the sync postcondition gate; return evidence with the result. | No synchronous `IREdit`, store publication, analysis needs or preservation claims. Reject unsupported declarations, missing gates or thenable results in the new path. Existing async pass API and behavior stay intact. |
| `framework/contracts/` | Add an explicit context-free, synchronous invariant definition and a `verifyPostconditionsSync` runner for already-computed artifact pairs. Reuse definition/port binding, immutable snapshots, artifact validation and check/evidence validation; let local-only `differential` invariants opt into the same callback used on the async path. This preserves the contract vocabulary and sampled evidence without blocking on a Promise. | Only pure invariant `ensures`; no requirements, effects, body runner, transfer, correspondence requirements, async checks or analysis lifecycle in this path. Unsupported clauses fail explicitly; no silent skip and no fake `ContractContext`. No cache or `AnalysisManager` journal; the pass caller gets the checked evidence directly. |
| `framework/core`, `ir`, `dataflow`, `strategy` | No changes proposed. Use finite JSON artifacts and v6 views as-is; sequence the two named passes directly. | No new IR substrate, dataflow lattice or strategy operator. |

A tensor-local driver calling `runDifferential` directly would be shorter at first but would make tensor own
contract port validation, gating and write checks. Making `optimizeTix` async would reuse the existing manager
but break the fixed API. General synchronous analysis transactions would grow the framework for capabilities
this domain does not exercise. Review the narrow sync split first; record any different framework need with
its reason in this ledger before expanding scope.

## Corpus and validation plan

Add six `corpus/tensor/<name>/main.tix` fixtures and test all through the built public API:

| Fixture | Tix contents / independent test |
| --- | --- |
| `matmul` | `sum(k)` of row/column products; nonsquare matrix with hand-computed products. |
| `softmax` | Per-row max shift, exp, sum and divide; large equal logits give a uniform row. |
| `layernorm` | Per-row mean and centered variance, literal positive epsilon, per-channel gamma/beta; constant row returns beta. |
| `attention` | Single-head scaled QKᵀ, stable softmax across keys, weighted V; identical scores give the mean of the value rows. |
| `mlp` | Two affine projections with biases and tanh-GELU between them; small nonzero golden case. |
| `conv2d` | NCHW with OIHW filters, no padding, stride one, `sum(c,dy,dx)` with `y+dy`, `x+dx`; nonsquare output and nontrivial kernel with hand-computed cells. |

Implement frontend/validator and evaluators first; cover diagnostic locations, shape unification and affine
bounds, reduction precedence, shadowing, lexicographic order, signed zero, zero extents and f32 vs f64
rounding. Then add the sync framework path with tests for exact port/shape validation, undeclared writes,
refusal of unsupported async/semantic declarations and evidence on rejected candidates. Implement passes
and case generation, exercise the witness and both mutants, and test a pass sequence with a rejected step
and an exact step after a tolerant one. The corpus fixtures also exercise optimized output, but the witness
and mutant tests are the required pass acceptance evidence, independent of corpus-wide sampling.

Post-implementation gate: `npm run build`, `node --test tests/tensor/`, `node --test tests/framework/`, and
at least `node --test tests/typed/{passes,inline,meaning-memo}.test.mjs` for the shared pass preparation and
differential changes. Request escalation if a test's Node spawn hits sandbox EPERM. No Typed code, tools or
existing Typed fixtures/tests change.

## Review focus and scope boundary

Review the sync framework seam, especially that it cannot silently drop a contract clause, and the split
between compile-time shape checks and concrete invocation checks for symbolic bounds. Also review the mixed
exact/tolerant chain and the stated sampling limits.

## Later (out of scope)

- Lowering to CUDA and execution on the GPU machine.
- Fusion, contraction tiling and attention-specific rewrites.
