---
Title: Stage 1 Tix design
Ticket: IRWB-020-X
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
      Note: Existing synchronous differential runner
    - Path: repo://src/framework/ir/adapters.ts
      Note: Canonical artifact creation and native projection
    - Path: repo://src/framework/ir/transactions.ts
      Note: Logical edit opening requires an adapter rebuilder
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native candidate preparation to share
    - Path: repo://src/typed/evaluate.ts
      Note: Existing sampled meaning invariant
    - Path: repo://src/typed/program.ts
      Note: Existing origin and current revision boundary
ExternalSources: []
Summary: Tix source checking, v6 tensor IR, evaluators, sampled contracts and native passes
LastUpdated: 2026-11-26T14:46:02.082523671-05:00
WhatFor: ""
WhenToUse: ""
---

# Stage 1 Tix design

Tix adds a second domain to the v6 artifact, IR, pass and contract layers. Stage 1 takes source to a checked
tensor artifact, runs it in f32 or f64, and attempts two checked rewrites. The tensor domain owns indexing,
shape instantiation, evaluation, case generation and comparison. The framework finding is a synchronous
API boundary in the pass layer. One extraction shares the existing native-candidate preparation with Tix.

## Language and checked domain

Implement all productions in the brief. Use a tokenizer with one-based line and column, recursive descent
for the declarations and a precedence parser for expressions. Handle comments in the tokenizer. Parse a
reduction body as a full expression up to its enclosing delimiter. For example, the division is inside the
reduction in `sum(d) x[i, d] / D` and outside it in `(sum(d) x[i, d]) / D`.

Disambiguate `max` by looking for a parenthesized list of bare names followed by a body. A two-argument
list followed by `-` is the one overlap with an infix operator. Treat it as binary `max` followed by
subtraction when both names are shape values, and as reduction over a negated body otherwise. A parenthesized
negative body spells the reduction explicitly. Parenthesizing the call also makes subtraction explicit.

Functions have unique names and are independent entry points. Parameters and statement results share a tensor namespace, with
references to parameters and earlier statements. The return may name either. A statement LHS introduces
distinct index binders. Each reduction introduces its own distinct binders, with lexical scope inside the
body. Resolve loads and index uses to IDs before inferring extents, so a shadowed index contributes only to
its own binder. A bare identifier in scalar expression position is an input-bound shape name.

Normalize shape dimensions and index maps to integer affine forms. Store an ordered coefficient list and
constant using decimal integer strings, with `BigInt` arithmetic during normalization and instantiation.
This keeps affine identities exact and canonical JSON portable. Affine syntax admits integer constants,
names, signs, parentheses, sums and differences and multiplication by constants. Division by a constant
is affine here when the normalized coefficients and constant divide exactly. Keep the syntactic bare-index
test separate from affine normalization, so an expression such as `y + 0` remains an affine position for
extent inference.

- A parameter dimension in the normalized form of a single shape name binds that name at a call. Shared
  names agree across inputs and all remaining input dimensions are equations to check against those bindings.
  A source name occurring only inside nontrivial affine input dimensions produces a compile error at that
  dimension, with a message that the shape name needs a direct input dimension. Direct bindings plus
  substitution suffice for this corpus. Solving simultaneous affine shape equations can follow if needed.
- Each plain load subscript contributes the corresponding tensor axis to that binder. All contributed
  extents must agree as normalized forms. A free statement index with no plain use gets its extent from its
  declared result axis. All plain uses present must agree with that axis as well. A reduction index needs
  a plain use. Check declaration ranks, load ranks, binder references, one definition per name,
  statically negative extents and return shape agreement during compilation. Emit ordinary `Error` messages with `line:col` and the relevant
  name or expected shape at the syntax or constraint that is detected.
- Derive the min and max for each affine load over its active index box. For each coefficient the extrema
  use zero or the corresponding extent minus one, chosen by sign. Compare them with zero and the source
  axis extent. Normalization proves common bounds such as `y + dy` in valid convolution. Reject source
  contradictions evident from normalized constant bounds on a nonempty box. Concrete call dimensions
  must satisfy any remaining bounds on nonempty boxes, including when emptiness itself depends on shape.
  This tests bounds over a box with two endpoints per axis. It avoids introducing a constraint solver or
  proving that every possible symbolic shape is a valid call.

The run domain is a compiled program, a declared function and exactly its named, finite row-major inputs.
Axis extents are nonnegative safe integers with addressable tensor sizes. Shapes instantiate every declared
or inferred extent and satisfy the affine access bounds above. At a call, bind the actual shapes and check
ranks, axis equations, data lengths and concrete affine obligations before traversing data. Calls can detect
shape disagreements that depend on the caller's dimensions. An empty loop has no accesses, and an empty
reduction returns its initial accumulator. Apply the supplied finite-input assumption directly.

## Artifact and evaluators

Use an ordered list of tensor definitions per function. Each definition has a result shape, an ordered vector
of output-axis binders and a scalar expression tree. Expression nodes are literal text, shape value, unary
or binary arithmetic, builtin call, load with affine subscripts, or reduction with ordered binders and
explicit extents. A load names a parameter or earlier tensor by stable local ID. A reduction has its own
scalar body and retains the written binder order. Source spans used for diagnostics and binding IDs remain
plain data. Literal text retains decimal and exponent syntax, and unary minus represents signed zero.
Pass-generated blocked sums add a single internal expression node described below.

An ordered tensor IR gives the interpreter loop bounds and affine loads directly. A separate loop IR would
require lowering and reconstruction before either rewrite, and a CFG would encode ordering that is already
available in the expression tree and binder lists.

Define `tensor.tix@1` with framework `defineIR` and a `defineAdapter` using the same validator, kind and schema
version. The adapter projects function roots, parameter and statement entities, ordered containment, tensor
read dependencies and the return binding. Put the scalar tree and checked iteration domains in the
statement entity attributes. Then a change to an operator, load or reduction is visible in the v6 diff
without giving every scalar expression its own entity. The validator checks the checked IR's IDs, shapes,
scopes, loads and reduction domains, using the same affine checks as source elaboration where applicable.
The adapter supports native-valued candidates and inspection. A logical graph rebuilder would duplicate
tree editing for these passes.

`TixProgram` holds the immutable origin and current v6 artifacts, initially the same `createIRArtifact`
result. Keeping both revisions allows subsequent `optimizeTix` calls to check against the original program.
`runTix` evaluates the current artifact.

Use a single traversal with a precision policy. The f32 policy rounds loaded inputs, literal and shape
values, unary and binary arithmetic, and JS builtin results with `Math.fround`. The f64 policy evaluates
the same IR with JS double operations, including input reads and literals, without intermediate f32
rounding. Iterate output coordinates row-major, and visit reduction coordinates in increasing lexicographic
order with the first index outermost. Sum starts at positive zero and max starts at negative infinity.
Round every accumulator update in f32. Materialize each statement and the returned tensor in the requested
typed array.

For f32 stores, use the usual float write for numbers and a fixed quiet NaN word (`0x7fc00000`) when a
computation produces NaN. The numeric meaning is still NaN and the output word is stable for the exact
relation. Preserve signed zero. A Node 24 probe found different NaN words on a naïve store/round-trip
comparison and confirmed that explicitly writing the quiet NaN word also preserves the signed-zero case.
A separate f64 interpreter would duplicate the indexing, evaluation order and empty reductions.

## Passes and contract

### Candidate rewrites

**`inline`.** Find a tensor definition whose expression contains no reduction and has exactly one syntactic
load across the function, counting a return as a use. The sole use must be a load. Substitute the producer
tree with the load's affine subscripts composed into each producer index map, then remove the producer.
Use resolved binder IDs during composition, including if the load is inside a reduction. Visit eligible
definitions in reverse statement order and update use counts after each substitution. The rewrite preserves
every scalar operation and each consumer reduction order. The producer's stored f32 value has already been
rounded, and canonical NaN stores make the removed materialization immaterial to the observed bits. Restricting
the rewrite to identical axis names would miss valid uses such as a transposed or offset load.

**`split-sum`.** Replace each one-index `sum` with an internal blocked-sum node retaining the original
binder, extent and body. For each consecutive block, evaluate its body in increasing index order, accumulate
from zero, then accumulate the block result into the outer sum, also from zero and in order. The last
block ends at the original extent and may be short. Use blocks of two elements, the smallest block that
can change association. Keep the internal node explicit because the source affine loop bounds cannot
spell a ceiling quotient or a short final block. The same evaluator applies the precision policy to both
levels, and repeated applications leave blocked-sum nodes alone. Multi-index sums keep their original
order.

### Sample domain and observation

Use framework `differential` and `runDifferential` with versioned exact and tolerance relations sharing the
same case construction and evaluation. For every original function, instantiate equal shape-name values
from zero through four, plus one asymmetric profile cycling through two, three and four in declaration
order. These sizes cover empty and singleton loops, one full block, a short final block and two full blocks
that can expose reassociation. The asymmetric profile helps expose axis swaps. Fixed and affine axes come
from the signature. Keep the profiles that instantiate valid calls and deduplicate equal shapes. A function
with no valid shape profile leaves the step unaccepted.

For each retained shape, try three deterministic input profiles. All ones exposes omitted contributions.
Signed dyadic values that vary by tensor and row-major position expose wrong reads and cancellation. A
rounding profile begins each input with `[1, u, u, u]` where `u = 2^-24`, the f32 unit roundoff, with a
truncated prefix for shorter inputs and zeros after it. The prefix is chosen to expose serial versus
blocked accumulation with consecutive pairs. The signed pattern starts each tensor at `1/2`, then cycles
through `[3/4, -1/2, 1/4, -3/4]` with a phase determined by parameter order. The first cell also gives a
positive value for a one-cell epsilon input. Cases and the first mismatch identify the function,
concrete shapes, input profile and output row-major coordinate. The contract observes the returned shape
and all row-major result elements, including whether an empty result has the expected shape. This is a
sampled check over explicit probes and supplies no equivalence proof beyond them.

### Exact and tolerance relations

- **Exact** compares equal shapes and the raw 32-bit words of the f32 output arrays. This distinguishes
  signed zeros. `inline` checks against the origin and, when different, the immediate pass input so it
  preserves the current f32 result and satisfies its origin contract. An inline after a split that visibly
  changed the sampled output may therefore be declined. The simpler check against the immediate input alone
  would drop the origin condition for that step.
- **Tolerance** checks equal shapes and finite values, comparing candidate f32 against origin f64 with
  `abs(candidate - reference) <= 2^-20 * max(1, abs(reference))` at each element. Decline the tolerance
  check on a nonfinite output. This is the only production relation selected by `split-sum`. A pure
  relative bound would give zero budget near cancellation, and a pure absolute bound would miss scale.
  For four f32 terms of magnitude at most one, serial or blocked addition has at most three rounded
  nontrivial additions. In normal range the worst absolute error is bounded by
  `4 * 3u / (1 - 3u)`, a little above `12u`, against the real sum. The chosen `16u = 2^-20` is the
  next binary power above this bound, with the f64 summation error negligible for these probes. When all
  terms have the same sign the corresponding bound scales with the sum. This gives a budget for the
  targeted short reduction, while composed programs or large and poorly conditioned reductions can exceed
  it. Their sampled outputs still have to meet the same bound.

The distinguishing probe for a four-element sum gives serial f32 `0x3f800000`, blocked f32
`0x3f800001` and f64 `1.0000001788139343`. The blocked error is `2^-24`, within tolerance. The
production gate will be exercised with this case, with a well-formed inline mutation that omits an addition
in the substituted tree, and a well-formed split mutation that doubles each summand before blocking. The
mutations run through the same checker as the real passes.

### Framework change and synchronous API

| Proposed framework change | Reason |
| --- | --- |
| Extract and export the synchronous native-candidate portion of `src/framework/passes/define-pass.ts` through its existing barrel. Share it with the native branch of `applyPass`. | Tix needs v6 candidate preparation and the fixed API returns synchronously. Native artifact creation, projection diff, correspondence and write authorization are already synchronous. The extracted portion only needs a projection, so native Tix rewrites need no logical graph rebuilder. |

The helper takes the pass's adapter and write declaration with its identity, the opened before view and
the native result. Preserve the existing output-ID, diff, correspondence, no-op and undeclared-write
behavior in the async caller. Both passes declare statement writes and the affected containment and
read relations. Function signatures, parameter entities and return bindings are stable. Tix's two versioned native rewrites use the same pass metadata and call the
helper with a native result. The Tix host then invokes the existing synchronous differential runner and
publishes the candidate to its local head only on agreement. The selected relation also checks a no-op,
which keeps the same revision on agreement. A rejected candidate gives `accepted: false`, and the next named pass receives the current
accepted artifact. An unknown pass name is reported where the host resolves it.

Typed's `Program.apply` shows the origin/current model and `typed/evaluate.ts` shows the differential
contract. `applyPass` and `AnalysisManager.verifyTransformation` both return promises even when their
callbacks are synchronous. Using either directly would require changing the fixed return type.
`applyPass` also opens a logical edit before invoking a native pass, which requires the adapter to
provide a rebuilder even when the pass edits the native representation. Running the
pass in another process would add a second transport and artifact reload to each optimization. The
extraction shares candidate preparation and keeps a single differential comparison implementation.
Tix uses the versioned invariant's differential spec directly, so it has sampled verdicts rather than
transactional analysis records. It needs no analysis or effects context. No changes are proposed to
core, IR, contracts, dataflow or strategy. A strategy plan would add scheduling to a single ordered list.

A built Node 24 probe confirmed that `defineIR` and `defineAdapter` produce compatible artifact identities,
that projection diff and write authorization run synchronously, and that `runDifferential` returns the
verdict for a framework differential invariant directly. A projection-only adapter successfully
produced a native diff and failed at the existing `applyPass` edit opening with `is not Rewritable`.

## Corpus and validation after review

Each row is `corpus/tensor/<name>/main.tix`.

| Name | Coverage |
| --- | --- |
| `matmul` | Rank-two contraction with distinct row, column and reduction dimensions. |
| `softmax` | Row-wise max shift, exponentiation and normalization. |
| `layernorm` | Mean and variance along the feature axis, square root, gamma, beta and one-cell epsilon. |
| `attention` | Single-head scaled scores, max-shifted softmax and weighted value contraction. |
| `mlp` | Two affine layers with biases and tanh-GELU between them. |
| `conv2d` | NCHW input, stride one, no padding. A fixed 3-by-3 kernel and an output annotation with `H - 2` and `W - 2` exercise affine positions and declared extents. |

1. Implement the parser, checker, artifact and evaluator first. Test source locations, precedence,
   greedy reductions, binary and reduction `max`, lexical binders, single assignment and shape errors.
   Test concrete shape instantiation, affine convolution loads, f32 per-operation rounding and reduction
   order, f64 behavior, signed zero, NaN outputs and empty reductions.
2. Extract shared framework preparation, then implement the rewrites and gate. Assert exact inline,
   exact rejection and tolerance acceptance of the distinguishing split, both mutation rejections, short
   blocks, composition of affine indices and preservation of the accepted head across a rejection.
3. Compile and run all six corpus programs via the fixed public API with small independent expected results.
   Exercise both passes through the API. Build with `npm run build` and run `node --test tests/tensor/`,
   `node --test tests/framework/` and
   `node --test tests/typed/{passes,program,inline,strategies}.test.mjs`. If sandboxed tests that spawn
   Node fail with EPERM, rerun the affected command with escalation as specified in the brief.

## Later

- Solve shape names that occur only in nontrivial affine input dimensions if such signatures are needed.
- CUDA lowering and GPU execution, fusion, contraction tiling and attention-specific rewrites belong to later stages.
