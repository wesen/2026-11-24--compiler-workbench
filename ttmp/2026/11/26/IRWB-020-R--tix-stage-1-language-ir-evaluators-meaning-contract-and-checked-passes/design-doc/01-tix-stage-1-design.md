---
Title: Tix stage 1 design
Ticket: IRWB-020-R
Status: review
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Existing case runner and comparison evidence
    - Path: repo://src/framework/ir/adapters.ts
      Note: Artifact identity and projection-only adapter support
    - Path: repo://src/framework/ir/transactions.ts
      Note: Logical edit capability requirement
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native candidate path and proposed synchronous entry point
    - Path: repo://src/typed/project.ts
      Note: Typed pipeline and original-revision baseline
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T13:45:51.917767597-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix stage 1 design

Tix adds checked tensor computations to the same v6 artifact and pass framework as Typed. The proposed framework
change is confined to `src/framework/passes/define-pass.ts`. The fixed synchronous API needs a native pass entry
point that can apply a synchronous check and work with an adapter that only projects native IR. The existing
contract, artifact and IR adapter definitions suffice.

## Source and shape checking

The public entry point is `src/tensor/index.ts`, built to `dist/tensor/index.js`. It exports the three functions
and signatures in the brief. A `TixProgram` is a read-only handle to a v6 artifact and its original artifact.
`compileTix` initializes both to the checked source artifact. `runTix` evaluates the current revision of the
named function with row-major inputs. `optimizeTix` returns synchronously and retains the source artifact across
subsequent calls so approximate changes keep checking against the same original.

The source subset supports multiple functions, decimal literals with optional exponents, the specified scalar
operators and calls, and ordered `sum` and `max` reductions with one or more axes. Input axes are positive safe
integer constants or bare shape names. Statement and return dimensions can also be a shape name plus or minus an
integer constant, covering `H - 2` in valid convolution. Access indices support sums and differences of bound
index names and integer constants, including reordered axes and `y + dy`. Concrete tensor sizes and strides
must be safe integers and fit the evaluator's typed arrays. The evaluator accepts finite input elements in
either typed array. The f32 conversion uses the usual rounding and overflow rules.

A token scanner retains 1-based source locations and skips `//` comments. A precedence parser treats a reduction
as a prefix form whose body starts at the lowest precedence and runs to the enclosing delimiter. This gives
`sum(d) x[i,d] / D` and `(sum(d) x[i,d]) / D` different trees. `max` followed by a parenthesized bare-name
list and a following expression is a reduction. In the ambiguous case of two bare names followed by `-`, the
minus starts the reduction body. Use grouping inside a binary call, as in `max((N), D) - x[i]`, to express
subtraction unambiguously. An expression parser with this local lookahead keeps precedence and source
diagnostics in one place. A parser generator would add a dependency and would still need a rule for this
overlap.

The source checker walks each function's statements in order. It checks name uniqueness, use of previously
defined tensors, access rank, and the returned tensor's type. Bare expression names resolve to input-bound
shape names. Left-hand indices and each reduction's indices introduce lexical bindings with unique IDs.
A subscript written as a single index name supplies its axis extent to that binder. Normalize extents before checking that
all such occurrences agree. A left-hand index with no plain use takes its extent from its declared
statement axis. A reduction index needs a plain occurrence since it has no declaration. A statement
annotation must agree with any inferred extents.

For `H - 2` to be positive, record the invocation requirement `H >= 3`. For each affine access, compute its
minimum and maximum using the axis bounds, then compare them to zero and the accessed extent minus one.
Normalize the differences and evaluate their lower bounds using the shape-name minima. Reject an access when
the bounds cannot be proved for the supported shape subset. This suffices for `x[n, c, y + dy, x0 + dx]`
with `y: H - 2` and `dy: 3`, because the largest row index is `(H - 3) + 2 = H - 1`. This local proof
makes extent and access errors visible at compile time. Checking indices only while evaluating would miss
source errors until execution, and solving general affine constraints is unnecessary for these programs.

Token and source-check errors are ordinary `Error` messages with `line:col` at the offending token or
subexpression, for example `4:12: index d has conflicting extents D and K` or
`6:9: cannot infer extent of reduction index d`. An unsupported dimension form is diagnosed at the dimension.
Invocation checks bind bare names from the supplied shapes, check repeated occurrences and literal axes, and
check recorded lower bounds, ranks and buffer lengths before evaluation. A concrete shape disagreement is
reported there because the caller supplies those shapes after compilation.

## Tensor IR and evaluation

Use a versioned native `tensor.tix` value with ordered functions, parameter tensors, assignment tensors
and a returned tensor ID. A statement has explicit shape and index binders plus a scalar expression tree.
The expression variants are literal, shape value, indexed load, unary or binary operation, call, reduction
and internal blocked sum. Ordinary reductions carry the ordered binders and extents. A blocked sum carries
the original binder and extent, body and block length. Its bounds are given below. Tensor and binder
references use resolved IDs. Affine accesses carry normalized coefficients and constants. Store literal
spellings so canonical JSON's normalization of negative zero cannot change the program's meaning, and
keep runtime buffers and observations outside the artifact.

Expose function, parameter and assignment entities with stable IDs, ordered containment edges and dependency
edges from assignments to the tensors they load. A function also has a dependency to its return value.
Assignment entity attributes contain the expression tree, so changing a reduction changes the projected
entity even when its dependency edges stay the same. Use the same checked-IR validator in `defineIR` and
`defineAdapter` to validate IDs, order, extents, bindings, load bounds and return types on new candidates.
Create artifacts through `createIRArtifact`. The adapter supports inspection and diffs. A graph with an
entity for each scalar node would permit editing below a statement, but the two passes operate on native
trees and need stable tensor IDs and dependencies. Explicit loop domains in the trees keep enough
information for loop-level lowering.

Use one evaluator with a precision operation chosen once per call. In f32 mode, convert input loads,
literals and shape values with `Math.fround`, round each scalar operation or call, and round each reduction
update. Preserve signed zero and use one quiet-NaN bit pattern when writing f32 arrays, so exact observation
has a stable encoding of a JavaScript NaN. In f64 mode, use unrounded JS Number operations and Float64Array
tensor storage. Float32Array inputs widen exactly in f64 mode. Every assignment iterates its indices in
row-major order, and every ordinary reduction starts at +0 or `-Infinity` and walks lexicographically with
the first binder outermost. `Math.max` and `Math.min` supply the scalar min/max semantics, including signed
zero. Sharing loop and expression traversal isolates rounding policy and makes the f64 evaluator execute the
same checked program. Independent traversals would duplicate indexing and reduction order.

## Meaning contract

Define versioned exact and tolerant tensor invariants with the framework's `differential` factory. Both
observe the function's output shape and every element in row-major order. The source signature determines
the function names, shapes and inputs. Require unchanged input and output signatures and invocation shape bounds before evaluation.
Use the same case builder and evaluator in both relations.

For every function, build cases at the minimum admissible shape-name bindings, at minima plus three,
at minima plus four, and with the latter two offsets alternating by shape name. Deduplicate identical
shapes. The minimum exercises boundary dimensions, and for an unconstrained axis the offsets give lengths
four and five, the first two full pairs and the first subsequent tail. The mixed binding exposes independent
axis swaps. Constant axes retain their declared lengths. For each shape, use all ones, signed dyadics scaled into the unit interval, and a repeating
`[1, u, u, u]` stencil with `u = 2^-24`, the f32 unit roundoff. Ones expose missing contributions and
exercise constant-input layernorm. Signed dyadics distinguish coordinates and exercise cancellation. The
stencil stresses rounding at the smallest nontrivial reassociation. For the dyadic profile, number
parameters and elements from zero. Use magnitude `k / scale`, where `k` is parameter ordinal plus element
offset plus one and `scale` is the smallest power of two at least as large as the maximum `k` for the
parameter. Alternate the sign by parity of `k`. Each input buffer is Float32Array so both
precisions see identical input numbers. Use these deterministic cases in place of random case counts, and
report the function, shape binding, input profile and first differing output coordinate on a mismatch.

- **Exact** compares f32 output words, including the sign of zero. Its baseline for `inline` is the
  incoming revision. After a tolerated split, this requires inline to preserve that revision bit for
  bit and therefore preserves its accepted relation to the original on the same cases.
- **Tolerance** compares candidate f32 output `C` with the original f64 result `R`. Obtain the original
  f32 result `O` on the same case as well. Require `|C - R| <= max(|O - R|, 2u * max(1, |R|))` per
  element. The first term carries the observed error of the original while capping any worsening at the
  second term. The second term is the spacing of f32 near one and scales with large reference values.
  Around zero it provides a unit-scale absolute allowance for cancellation. A nonfinite candidate fails a
  finite comparison. When the original reference or original f32 result is nonfinite, require the
  candidate f32 word to match the original f32 word for that element.

A pure relative tolerance breaks down when the reference is close to zero. An absolute floor of one
unit-scale spacing is calibrated by the paired-sum probe. For `[-4, -u, 4, -u]` the f64 value is
`-2u`, the original f32 value is `-u`, and the paired f32 value is zero. The absolute floor covers the
paired error of `2u`. For
`[1, u, u, u]` the original returns `1`, the paired order returns `1 + 2u`, and the f64 result is
`1 + 3u`. The second example changes bits and improves the reference error. The allowance is a sampled
output acceptance policy. Its size is calibrated to rounding differences at the sampled scale, and it may
reject a correct regrouping whose downstream computation amplifies the error. An accumulated budget relative
to the preceding artifact could let repeated passes drift further from the source.

## Checked passes and framework change

| Pass | Rewrite | Gate |
| --- | --- | --- |
| `inline` | Select reduction-free assignments with one load occurrence in a later statement and no return use. Replace that load with the producer body, substituting its bound indices with the consumer access expressions, then remove the producer. Preserve scope via binder IDs and normalize composed accesses. | Exact f32 against the incoming revision, with case selection anchored to the source. |
| `split-sum` | Replace each ordinary one-index sum with a blocked sum. Iterate blocks in increasing order. In block `b`, sum `i = 2b` through `min(2b + 2, extent) - 1` from +0, then add the partial to an outer sum from +0. Both levels round after each addition in f32. The body and index binding stay the same. | Tolerance against original f64, with the original f32 error allowance. |

Count use occurrences, including the returned tensor, on the current IR for inline. One occurrence and pure
pointwise evaluation make substitution straightforward, including under a reduction in the consumer. Avoid
substitution across producer reductions at this stage. Two is the smallest useful block size: blocks of one
preserve the original addition order, while two pairs can change it and an odd extent exercises the tail.
An internal blocked-sum node keeps this structure local to the reduction. Introducing a tensor of partials
would add a new statement domain and shape calculation for a rewrite that needs neither.

Typed's `runPipeline` calls the async `applyPass` with a transformation contract against its origin. The
native branch already builds an artifact, diffs the projection, constructs correspondence and checks
declared writes. However, it opens an edit before calling the pass, so even a native result needs the
adapter's `rebuild`. A Node 24 probe confirmed the promise return and the `not Rewritable` rejection with
a projection-only adapter. The probe also confirmed that `runDifferential(differentialSpec(invariant), ports)`
returns the same case evidence synchronously as the manager's invariant query.

Change only `src/framework/passes/define-pass.ts` for this stage:

- Extract shared native candidate preparation and declared-write enforcement from `applyPass`. Keep the
  existing native artifact, diff and correspondence behavior on both entry points.
- Add a synchronous `applyNativePass` entry for a versioned native pass spec. Its kernel receives the
  immutable input and its view, and can return `NativeResult` or an identity. It has no logical edit
  context or managed analyses. Require a synchronous gate returning `CheckResult` before returning any
  changed result. Use the existing `PassError` rejection mechanism and retain the supplied check evidence.
  Reuse the existing result shape. A projection-only adapter can use this entry point.

The tensor optimizer binds the exact or tolerant invariant and its baseline to the gate, using the
existing synchronous differential runner for case execution. It advances the current revision on acceptance.
A failed check reports `accepted: false` and the next pass receives the last accepted revision. An identity
reports `accepted: true`. Unexpected failures propagate. The named pass list is the public sequence.
Using the async manager or Strategy interpreter would require changing the public return type. Running the
entire optimizer in a child process to preserve synchrony would add transport and another execution path.
Placing native validation and write checking in the tensor domain would duplicate framework behavior.
The managed contract lifecycle and the strategy interpreter stay on their existing async path.

## Corpus and verification

| Corpus entry | Computation and test target |
| --- | --- |
| `matmul` | Matrix product with a one-index contraction and a small rectangular hand-checked result. |
| `softmax` | Row max, shifted exponential, sum and division. Test large logits and check row normalization. |
| `layernorm` | Feature mean and population variance, then epsilon, gamma and beta. Check a constant row and nontrivial affine parameters. |
| `attention` | Single-head scaled dot-product attention with max-shifted softmax and a value contraction. Check separate query/key lengths. |
| `mlp` | Two affine layers around tanh-GELU. Check a small fixture with biases and values of both signs. |
| `conv2d` | NCHW input and OIHW weights with fixed 3×3 kernels, stride 1, no padding, and a `sum(c,dy,dx)`. Check a non-square image and output extents `H - 2, W - 2`. |

Each entry lives in `corpus/tensor/<name>/main.tix`. Tests import the built public API and exercise compilation
and evaluation of all six programs in both precisions. Focused tests cover source positions, ambiguous max
forms, reduction scope and lexicographic order, binding and shape errors, affine bounds, precision and signed
zero. Hand-checked fixtures and invariants complement the differential check because baseline and candidate
share the evaluator.

Use a direct returned sum plus the `[1,u,u,u]` witness to assert the exact gate rejects the actual split
candidate and the tolerance gate accepts it. The `[-4,-u,4,-u]` case exercises the absolute floor. Run an odd-length case to check the final partial. Feed a
deliberately wrong split candidate that omits the tail through the tolerant gate, using the five-element
ones case. Feed a wrong inline candidate that transposes a square input access through the exact gate, using
the coordinate-distinct profile. Both candidates must be valid IR so the intended meaning check rejects
them. Check successful inline, continuation after a rejection and retention of the original across chained
optimizations. Keep mutation kernels internal to the tests.

Add focused framework coverage for sync checked application with a projection-only adapter, rejection
with evidence, shared write enforcement, and the existing async native path. After implementation, build
with `npm run build`, run `node --test tests/tensor/` and `node --test tests/framework/`, and run the Typed
pass and strategy tests that exercise native framework pass application. Request escalation for spawned test
commands that hit sandbox EPERM.

## Later

- General affine parameter and dimension binding, and access proofs with coupled shape constraints, can
  wait because the corpus uses independent input shape names and constant convolution offsets.
- Empty tensor axes can wait because the stage-one corpus uses positive extents.
- CUDA lowering, GPU execution, fusion, tiling and attention-specific rewrites belong to later stages.
