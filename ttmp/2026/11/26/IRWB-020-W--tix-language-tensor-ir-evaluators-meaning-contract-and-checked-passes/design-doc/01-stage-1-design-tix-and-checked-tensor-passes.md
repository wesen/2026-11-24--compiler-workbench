---
Title: 'Stage 1 design: Tix and checked tensor passes'
Ticket: IRWB-020-W
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
      Note: Existing synchronous case runner and evidence for both relations
    - Path: repo://src/framework/ir/adapters.ts
      Note: Native artifact creation and projection validation shared with Typed
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native candidate preparation to extract without changing async applyPass
    - Path: repo://src/typed/project.ts
      Note: Precedent for gating each candidate against its original revision
    - Path: repo://tests/framework/ext-e3-e6.test.mjs
      Note: Native pass and async host regressions for the proposed extraction
ExternalSources: []
Summary: Checked affine tensor IR, scalar evaluation, and the synchronous pass preparation seam.
LastUpdated: 2026-11-26T14:45:43.894075259-05:00
WhatFor: Review the Stage 1 design before implementing Tix.
WhenToUse: Before starting or reviewing the IRWB-020-W implementation.
---

# Stage 1 design: Tix and checked tensor passes

## Result to review

Tix will compile to an immutable v6 artifact of tensor definitions and indexed scalar expressions. The f32
interpreter supplies the language meaning; the same loop traversal with double operations supplies an f64
reference. `inline` must preserve the bits it receives. `split-sum` changes the order of additions and is gated
against the original program in f64. These are sampled checks, not a proof over every possible call.

The framework already fits the representation and both relations. The one change proposed is in
`src/framework/passes/define-pass.ts`: expose the existing **native candidate preparation** as a synchronous
operation. This is needed because `optimizeTix` is synchronous and the v6 `applyPass` lifecycle awaits an
`AnalysisManager`. There is no proposal to make that lifecycle synchronous.

## Source checking and call domain

The fixed grammar and API are the contract. The lexer records 1-based line and column, including across `//`
comments. Use recursive descent for functions, types and statements, and precedence parsing for scalar
expressions. A reduction parses a full expression up to the current comma, closing parenthesis or semicolon;
those delimiters belong to the surrounding syntax. In particular, a binary `max` with expression arguments
and `max` with a binder list are distinguished by the contents of the parentheses and the presence of a
following body. For the ambiguity `max(N,D) - e` when both names are shape values, prefer binary subtraction
from the call; `max(N,D) (-e)` makes a reduction with a negated body explicit. A non-ambiguous reduction can
start with unary minus. Shape names in numeric positions come from the input types, not a capitalization rule.

The checker runs in source order per function, with separate tensor, shape and index namespaces. Inputs and
statements each introduce one tensor binding. A read refers to an input or earlier definition; returns refer to
a defined tensor. Reject duplicate functions, tensor bindings, or names in a single index binder list, as well
as undeclared names, read/annotation rank mismatches and return shape mismatches. Each RHS read resolves its
index names lexically, including under nested reductions, before extents are inferred. A bare index in an axis
position contributes that axis's symbolic extent to its binder. All contributions must agree after affine
normalization. An LHS binder with no plain use needs a declared axis (also supports constant/broadcast writes);
a declared type must agree with any inferred axes. A reduction binder with no plain-use witness is a source
error: the statement's type sizes its free axes, not its reduction axes. An affine expression such as `i+0`
is still an affine use for inference. These errors name the conflicting or missing extent at the use or binder
with `line:col`.

Normalize affine expressions into an integer constant and coefficient map. Parse `+`, `-`, parentheses and
multiplication by an integer constant, rejecting nonlinear terms. Compare type axes symbolically (distinct
symbols are not silently unified by a tensor expression). Every shape name must have a bare input axis from
which to bind its value. Other input axes can be affine expressions of those same names. This covers e.g.
`x: f32[N], y: f32[N-2]` and an affine input appearing before its bare witness. Solving simultaneous equations
for names that occur only in affine input axes needs additional machinery and is deferred; diagnose the lack of
a binding axis at compile time. Compare normalized forms, not textual spelling or equality on example sizes.

For a read `c + Σ aᵢi`, form lower and upper bounds by selecting `0` or `extent(i)-1` according to coefficient
sign. Carry the conditions `lower >= 0`, `upper < axisExtent` over the nonempty iteration domain. Cancel affine
terms to discharge identities or report statically impossible accesses; e.g. the upper bound for `y + dy`
with extents `H-2` and `3` is `H-1`, whereas `i+1` over all of `N` cannot index `N` elements. Reads in a known
empty loop do not impose a bound. Remaining shape-dependent inequalities are call preconditions. Keep their
source locations so shape failures can identify the relevant axis or read. Use exact integer arithmetic for
shape/index algebra (integer strings in JSON if needed, decoded for checking/evaluation); this algebra does
not round like scalar arithmetic.

`runTix` supports calls to a compiled function with the named row-major arrays and finite input values in the
brief, extents that are nonnegative integers, and tensor sizes that fit the host's typed arrays. Bind names
from the bare axes first, then check actual input ranks, dimensions and data lengths and instantiate the
extents and residual bounds before evaluating. An inconsistent declaration or use in source is a compile
error; inconsistent concrete arrays are only known at invocation. Zero extents are allowed; empty reductions
return the specified identities. This split needs no shape solver and lets the conformance examples remain
parametric. Concrete-only typing would miss source errors until evaluation and would lose the shape information
needed to describe the pass domain.

## Native representation and evaluator

Use `tensor.indexed` schema `1`, declared with `defineIR` and `defineAdapter`. The native payload is an ordered
list of functions, parameter shapes, and statements. Each statement has a stable tensor ID, ordered free-index
IDs and extents, and a scalar expression tree. Loads name a prior tensor ID with one affine index per axis.
Expression tags cover literals (spelling), shape values, operators, calls, and reductions with ordered lexical
binder IDs and symbolic extents. Return names resolve to tensor IDs. Retain source spans for diagnostics.
An internal `blockedSum(binder, extent, blockSize, body)` explicitly carries the two-level grouping; it has no
Tix surface syntax. A flat instruction/CFG IR would force loop formation before the two passes. Indexed trees
give both passes local structure and preserve the loop bounds and indices needed for future lowering.

Use `createIRArtifact` and one shared native validator for the adapter and IR type. The validator checks the
payload's structure, definition order, lexical bindings, extents and access legality; it does not re-infer extents
from transformed expressions. An inlined expression no longer needs a plain-use witness for a previously typed
binder. Project functions, input/statement tensors, ordered binders and expression nodes as entities, with
ordered containment, load-to-tensor dependencies and index binding edges. Include operator tags, shapes,
affine subscripts and reduction bounds in the projection so `diff` sees semantic edits. Retain IDs on unchanged
subtrees, give fresh IDs to copied/new nodes, and supply correspondence for the removed producer and replaced
reduction. No graph rebuild is needed for these native-value edits.

The evaluator enumerates free axes row-major, materializing statements in source order. Walk each reduction's
axes in listed order, first outermost; start at `+0` or `-Infinity` and round each accumulator step in f32.
Use `Math.fround` for inputs to the f32 program (including when supplied as f64 arrays), decimal literals,
numeric shape values, unary and binary operators and builtins, and store statements in `Float32Array`.
`Math.max`/`Math.min` implement max/min, including their signed-zero rules. In f64 use JS double arithmetic and
`Float64Array` throughout, with the given input values and the same expression and traversal order. Do not use
fused arithmetic. The f64 reference for a check always runs the **original** unblocked artifact. A templated
precision policy on a single evaluator is simpler than maintaining two loop implementations. Literal spelling
and unary negation preserve `-0` without changing the framework's canonicalization; actual tensor values and
nonfinite results never enter the JSON artifact.

## Meaning contract

**Domain.** Check every function on a deterministically generated suite from the original signature. For block
size `B = 4`, try uniform assignments from `{0, 1, B-1, B, B+1, 2B+1}`: empty, singleton, short block, exact
block, block plus tail, and two blocks plus tail. Also try the cyclic rotations of `(1, B-1, B, B+1, 2B+1)`
assigned across successive shape names, to expose transpositions with unequal dimensions. Deduplicate, and
use only assignments satisfying the call preconditions; constants stay fixed. At each shape use three profiles:
seeded signed dyadics in `[-1,1]` (bounded nonuniform, with exactly representable f32 inputs), a repeating
`[1, 0, 0, 0, 2^-24, 2^-24, 2^-24, 2^-24, 2^-24]` pattern (rounding-sensitive), and an isolated unit at the
last position of each nine-element group (tail-sensitive). Seed `1` is a reproducibility label, not a statistical
parameter. Record shape bindings and profile/seed in evidence. No random search or minimum percentage of case
agreement. If the suite cannot exercise a function at any valid shape, it cannot authorize a changed artifact.
This small suite targets branch and numeric failure modes rather than making a claim about large tensors.

**Observation.** Preserve the function interface (names, input names/order and normalized dimensions). Check
returned shape and every row-major element. Capture f32 observations as stored 32-bit words for exact checks;
ordinary JS equality loses the sign of zero and cannot express bit equality for NaNs. Do not make exceptions
for unsuccessful evaluations on the sampled inputs. A tolerance sample whose output or reference has a
nonfinite element fails the gate; no silent skip or tolerance for a different shape. Such values remain legal
results of `runTix` for finite inputs.

**Relations.** Exact compares f32 output words. Tolerance compares candidate f32 `c` to original f64 `r`,
componentwise, using `|c-r| <= 2^-20 + 2^-17 * |r|`. With f32 unit roundoff `u = 2^-24`, these are `16u`
absolute and `128u` relative. On a width-nine direct sum, the split path has at most four inner and three
outer adds, giving a `γ₇ ≈ 7u` scale relative to the sum of magnitudes. For exactly representable terms of
magnitude at most one and `|r| <= 1`, each full inner block incurs at most `u + 2u + 2u` absolute error (its
first term is exact). The singleton tail is exact and has magnitude at most one, so the two accumulated
blocks have magnitude at most `2` plus rounding error; the last two adds cost at most `2u + u` in this case.
The absolute budget rounds that `13u` up to `16u`. At `|r| >= 1`, the direct-sum `9·γ₇` bound fits within
half the relative budget; the rest is headroom for products and downstream operations. This is a budget for
the sampled outputs, not a bound for arbitrary cancellation or conditioning. There is no tolerance relative
to a previous optimized result and no added allowance for an already-inaccurate original f32 result. Verify this budget against measured corpus errors after review;
document any revision rather than silently widening it for a failing pass.

Use the existing `differential()` invariant and its synchronous `runDifferential(differentialSpec(...), ports)`
entry point. A single spec factory supplies the relation and evaluator precision; failure evidence includes the
first disagreeing shape or element, with expected/actual words or numerical error and bound. Use origin-derived
cases for both relations; do not ask the candidate which shapes to test. A bespoke comparison loop or a second
async checker would duplicate the framework's case runner and evidence accounting. No effects, delegation,
cache keys or proof claims are needed.

## Two passes and publication

- **`inline`:** Count read occurrences plus return uses. For a reduction-free statement with exactly one
  read and no return use, clone its RHS into that consumer, composing producer free-index IDs with the load's
  affine subscript expressions (not replacing names in text). Remove the producer. Process in definition order
  and recompute uses as needed. Preserve expression order and all existing roundings; a materialized f32 value
  is already rounded, including a producer that is just a load. Pure scalar expressions can move under a
  reduction without introducing a new binder. Revalidate the candidate after substitution.
- **`split-sum`:** Rewrite a `sum` over exactly one binder. For a constant extent at most `B`, leave it alone;
  for symbolic extents or larger constants, loop over `ceilDiv(extent, B)` blocks and then over increasing
  offsets within each block, using `min(B, extent - block * B)` for the last block. Each block starts a fresh
  rounded sum at `+0`, and the outer loop adds block totals to `+0`, rounding each step. Four groups the four
  half-ULP terms in the witness below into a single contribution of two ULPs, with a separate unpadded tail
  in that nine-element case. A block size of one would not change addition order. Do not split `max`,
  multiple-index sums, or an already blocked node. An order-preserving loop cut with one accumulator would not exercise the
  tolerance relation.

Define both kernels with `definePass`, declaring the tensor/expression/binder writes and touched containment,
load and binding edges. The pass layer structurally prepares each native candidate before the contract sees it.
`TixProgram` wraps an artifact, its immutable origin artifact, and whether an accepted changed step has invoked
the tolerance policy. The wrapper puts neither the origin nor policy in the hashed IR payload. `compileTix`
starts at the origin, `runTix` executes the current artifact, and `optimizeTix` processes names synchronously
in order. Keep the anchor even across `optimizeTix` calls:

| Step | Required for a changed candidate |
| --- | --- |
| `inline`, before any approximate edit | Exact against the input to the step; this is also exact against the origin by transitivity on the same cases. |
| `inline`, after an approximate edit | Exact against the step input and within tolerance against the original f64 outputs. |
| `split-sum` | Within tolerance against the original f64 outputs. |

Requiring exact agreement against r0 after an accepted `split-sum` would reject even a correct inlining of that
revision. Checking tolerance only against the last revision would permit drift. A failed meaning check reports
`accepted: false` and leaves the current program and policy unchanged for the next name. An identity step is
accepted and retains the same revision and policy. Internal tests can change a pass's relation or kernel
through the same runner; no extra public API option is required.

## Framework changes proposed (complete inventory)

| Path | Proposed change and reason |
| --- | --- |
| `src/framework/passes/define-pass.ts` | Extract and export `prepareNativePass`: given a pass, the opened before view and its `NativeResult`, construct and validate the artifact, diff the projections, make correspondence and enforce declared writes using the existing checks. Return a detached candidate (or identity) with its change metadata. Reuse it in `applyPass`'s native branch, leaving the edit branch, semantic manager, preservation checks and optional store behavior intact. Tix supplies its pure native result and checks it with the synchronous differential runner before exposing the result. |

`prepareNativePass` is explicitly preparation, not a checked application, and requires no new transaction or
scheduler. Tix has no persistent `IRStore`, effects, needs, or preservation claims. Using `applyPass` as-is
would require a Promise in the fixed API; making `AnalysisManager` support synchronous callbacks would add a
second lifecycle for a task that needs only synchronous sampled evidence. Duplicating diff/correspondence and
write enforcement in `src/tensor` would defeat the framework test. No changes proposed to `core`, `ir`,
`contracts`, `dataflow` or `strategy`. The strategy bridge is usable for async hosts but adds nothing to this
fixed, linear API. No forced use of Typed's CFG analyses.

## Implementation and validation (after review)

1. Add `src/tensor/` lexer/parser/checker, shared native validation, adapter and evaluator. Test precedence and
   greedy reductions, both `max` forms, shadowed scopes, conflicting or missing extents, rank/single assignment,
   affine bounds and invocation binding, zero extents, f32 rounding and signed zero, and f64 evaluation. Test
   identical compilation hashing and a real structural diff. Assert `line:col` for specific malformed fixtures.
2. Extract the framework preparation seam and add the passed/rejected native-path regression to the E3 pass
   tests: identity, correspondence/write gating, and existing async contract rejection. Add Tix passes and tests
   that inspect the revision and contract evidence, not just the `accepted` flag. In particular:
   - Use `y[i] = sum(d) x[i,d]` at `D=9` with the rounding profile above. Sequential f32 is `0x3f800000`,
     blocked f32 `0x3f800002`, and sequential f64 `1 + 5*2^-24`. Exact rejects the valid rewrite and keeps r0;
     tolerance accepts that same rewrite. The last-element-only fixture must return `1`, to independently
     detect tail loss (the rounding witness alone cannot distinguish omitting its last half-ULP).
   - Mutate the inlined producer `x[i]+1` to `x[i]-1` at the use; exact rejects the resulting valid artifact.
     Double the terms of the blocked sum in the bad `split-sum` variant; tolerance rejects it on the witness.
     Assert both candidates pass structural validation and fail the numerical gate, and a later valid pass runs
     from the last accepted revision. Include a legal affine inline at a reduction use site and a multi-step
     pipeline with the original reference retained across calls.
3. Add and test `corpus/tensor/<name>/main.tix` for:

   | Name | Main computation and independent test |
   | --- | --- |
   | `matmul` | Contract over `K`; hand-computed rectangular product. |
   | `softmax` | Row max-shift, exp, sum, divide; known two-logit probabilities and stability on large logits. |
   | `layernorm` | Last-axis mean and variance, positive epsilon literal, per-channel gamma and beta; constant-row beta and a nonconstant hand-checked row. |
   | `attention` | `Q·Kᵀ / sqrt(D)`, max-shifted row softmax, multiply by `V`; equal logits yield a value mean. |
   | `mlp` | Affine input projection, tanh-GELU, affine output projection; distinct weights and biases against scalar formulas. |
   | `conv2d` | NCHW input, 3×3 kernels, stride one, no padding; `y+dy,x+dx` and declared `H-2,W-2`; asymmetric image and kernel against direct sums. |

   Exercise public compile/run/optimize on each and record which steps actually changed the IR. Normalize by
   `(sum(... ) expr) / extent` or deliberately express a divided term inside the reduction; test the intended
   order. Corpus tests import `dist/tensor/index.js` and live solely under `tests/tensor/`.
4. Run `npm run build`, the tensor tests, `node --test tests/framework/`, and the affected Typed pipeline tests
   (at least `passes`, `inline`, `strategies` and `meaning-memo`). If Node spawning hits sandbox EPERM, request
   escalation for that command. Review and record each actual framework edit and why it was needed.

## Later (out of this stage)

- General solving for shape names that have no bare input binding axis.
- CUDA lowering and GPU execution; fusion, contraction tiling and attention-specific rewrites are separate tickets.
