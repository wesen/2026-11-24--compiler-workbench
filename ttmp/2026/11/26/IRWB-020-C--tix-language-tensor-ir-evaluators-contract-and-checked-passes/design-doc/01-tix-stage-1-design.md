---
Title: Tix stage 1 design
Ticket: IRWB-020-C
Status: review
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: design-doc
Intent: short-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: Synchronous differential runner and sampled evidence
    - Path: repo://src/framework/ir/adapters.ts
      Note: Artifact validation and projection adapter
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Native pass path and synchronous extension point
    - Path: repo://src/typed/project.ts
      Note: Existing optimization baseline and rejection loop
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:39:58.406533595-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix stage 1 design

Tix compiles checked index notation to a v6 artifact. The evaluator executes that artifact directly.
The two passes operate on the same artifact and check the returned tensors before the public API
advances to a new revision. The only proposed framework code change is a synchronous entry point
for native-value passes with a mandatory check.

## Source and call domain

Use the fixed grammar with one or more nonrecursive functions, each with at least one tensor
parameter and one returned parameter or statement tensor. Identifiers and shape names resolve by
scope. Numeric expressions accept finite JS numeric literals. Affine expressions use integer
constants and coefficients, grouping, addition, subtraction and multiplication by integer
constants. At call time, shape names and extents are nonnegative safe integers. Support empty axes
and row-major tensors whose sizes can be represented and allocated in the requested typed array.
Inputs have the named parameter shapes, exactly the number of elements their shapes specify, and
finite values in either API carrier. A finite f64 carrier value can round to infinity in f32.

A lexer retains 1-based line and column. Use recursive descent with infix precedence levels and
parse a reduction body with the full expression parser through the current delimiter. Parentheses
can bound that body. Classify two-argument `max` using its argument forms and their shape-name
bindings. Where both readings are possible, two in-scope scalar shape names select the call.
Otherwise a bare identifier list followed by a body selects the reduction. Test the ambiguous
prefix alongside ordinary calls, reductions and subtraction. A separate parser-generator
dependency would add build plumbing for this small grammar.

Normalize shape and index expressions to an integer constant plus ordered coefficients. Bind shape
names from parameter dimensions by solving the affine signature equations. Compile the equation
structure once and require full column rank so that a consistent call has a unique binding. This
allows signatures such as `f32[H - 2]` without requiring a bare `H` elsewhere. Exact integer
arithmetic in checking and rational elimination avoid silently accepting a rounded dimension or a
fractional binding. Require output annotations and shape-valued scalar expressions to refer to
names bound by the signature.

Check statements in order. Keep one tensor namespace for parameters and new definitions, and a
lexical namespace for index binders. Assign each LHS or reduction index a distinct ID. Only an axis
whose normalized access is the index itself supplies a plain-use extent. All such uses must agree
as normalized shape expressions. A statement annotation supplies the axes with no plain use and
must agree with the axes that have one. A reduction index has no annotation, so it needs a plain
use within its lexical scope. Reject duplicate binders in a list, undefined tensors or indices,
wrong ranks, unresolved extents and a return type that differs from the returned tensor type.

For each affine access, derive the minimum and maximum from its active index ranges using
coefficient signs. Check them against the referenced dimension. An access inside an empty
iteration space requires no bounds check. Reject statically inconsistent shapes and access bounds
with the relevant source location. Record constraints that depend on concrete sizes and check them
when the call binds its input shapes, before evaluation. For example, a convolution with output
`H - 2` needs a nonnegative output extent and its input accesses must be valid for that extent.
`compileTix(source)` has no concrete input shapes, so a conflict between two supplied tensor
shapes can only be diagnosed by `runTix`. Use the same shape and bounds preflight to select
contract cases. The simpler bare-name binder would exclude affine-only parameter signatures.
Requiring symbolic extent agreement keeps this stage from introducing a general constraint solver
for state such as conditional equality between independently bound dimensions.

## Artifact and evaluators

Use `defineIR` and `createIRArtifact` for `tensor.tix@1`, a finite JSON value containing
functions in source order. Each function has typed parameter tensors, an ordered list of typed
statement tensors and a return ID. A statement stores its output binders and an expression tree
with resolved tensor references, affine offsets, primitive operations and reductions with ordered
binders and resolved extents. The split form adds an internal blocked-sum node with the original
binder, body and extent and a fixed block size. The IR validator checks shape and binding
consistency and the internal blocked-sum form. Passes carry checked extents explicitly so an
edit may remove the plain access from which the source checker inferred a binder. Keep unary negation explicit so `-0` is represented
without storing negative zero in the artifact. Keep tensor data and evaluated intermediates in
runtime arrays. The framework's JSON canonicalization collapses signed zero and excludes
nonfinite values.

Project functions, parameters and statements as entities with stable IDs and expose ordered
containment and tensor use edges. Use one dependency edge per distinct producer/consumer pair.
Include the statement expression tree in its entity attributes so body-only rewrites appear in
the v6 diff. Domain rewrites return a native program and use the existing correspondence rules
for retained and removed entities. A flat entity per scalar expression would allow generic local
editing but would add graph rebuilding and binder management for two scoped tree rewrites. A
statement tree preserves the extent and order needed to enumerate loops.

`src/tensor/index.ts` exports the fixed synchronous API. `TixProgram` keeps the current v6
artifact and its original artifact. The clean compile shares one artifact for both. Evaluators
visit statements in order, enumerate output coordinates in row-major order, and evaluate the
scalar expression at each coordinate. A reduction visits increasing lexicographic coordinates
with its first binder outermost. Use a shared traversal with a rounding operation of
`Math.fround` for f32 or the identity for f64. Round inputs upon conversion for f32, and round
literals, shape values, unary and binary operations, intrinsics and each reduction accumulation.
Use JS `Math` intrinsics and initial values of +0 for sum and −∞ for max. A blocked sum starts a
new +0 accumulator per block and combines the block results with an outer +0 accumulator. For
f32 output storage, choose one quiet NaN bit pattern for JS NaN, whose payload is unspecified,
and preserve all other bits including signed zero. f64 uses JS double arithmetic throughout.
A separate f64 interpreter would duplicate indexing and binding code; direct small tensor
oracles in the tests will check the shared traversal.

## Meaning contract and pass policy

Use versioned `differential()` definitions, and run their specs with `runDifferential()` on
the synchronous path. The baseline always determines the case suite. Cases are deterministic,
small, valid calls for each entry function, driven by the origin signature and checked extents.
Try shape-name bindings of 0, 1, 2, 3, 4, 5, 7 and 9, plus seeded mixed assignments from those
sizes and targeted shapes with a full block and a tail. Fixed-size signatures use their declared
dimensions. Keep cases with at most 4,096 elements in any parameter or statement tensor and
at most 100,000 scalar evaluation visits per origin case. Fail the check if a candidate
exhausts that budget on a selected case. Include zero and signed zero, ones, a
nonuniform signed or positive bounded pattern, and seeded values. Case values are finite
and f32-representable so both precisions read the same numbers. Include the rounding witness
below in the fixture domain. The checker requires cases for every entry being checked. A pass
cannot acquire acceptance from an empty suite or a suite with zero comparable cases for an entry.
The seed, entry name, shapes, input pattern and first differing element make failures
reproducible. Report the decision as sampled evidence. These bounds limit contract work
independently of which call shapes the evaluator supports.

The observation is the returned tensor shape and all its row-major elements. Protect parameter
names and shapes, return type and function set by a structural signature comparison as part of the
gate.

- **Exact** compares the raw f32 words using a `Uint32Array` view. This distinguishes +0 and −0
  and handles nonfinite results. Comparing ordinary JS numbers would lose a distinction or
  mishandle NaNs.
- **Tolerance** compares candidate f32 against the original unoptimized f64 program on the same
  inputs. For every element with reference value `r`, require
  `abs(candidate - r) <= 2e-6 + 2e-5 * abs(r)`. The absolute term gives a fixed noise floor near
  zero, including cancellation residuals. The relative term allows about 168 f32 spacings near
  1 and leaves headroom for rounding through short corpus reductions and downstream operations.
  The constants are a policy for these finite sampled cases, with no general numerical stability
  guarantee. Select tolerance cases with entirely finite reference outputs independently of the
  candidate. A nonfinite candidate on a selected case fails. A relative-only bound is unusable
  at zero and a bound scaled by input magnitude could hide substantial errors after cancellation.

Run requested passes in order. A changed `inline` must agree exactly with its immediate input.
Check the result against the original as well, with exact comparison for functions still in
exact mode and tolerance for functions where an earlier split was accepted. For `split-sum`,
use the tolerance comparison against the original on functions whose bodies were changed by the
pass, and keep the prior relation for the others. Store the set of functions that entered
tolerance mode along with the original artifact so subsequent calls to `optimizeTix` keep the
same baseline. Exact checks on the current input prevent a later inline from spending the split's
error budget. Comparing tolerant revisions pairwise would allow error to accumulate across runs.
A rejected meaning check yields `accepted: false` and the next named pass sees the current
accepted artifact. A pass with no edit records an accepted identity.

## Rewrites and evidence

- **inline** finds a reduction-free producer whose tensor has exactly one reference occurrence
  across all statements and the return. Inline a statement use, substitute the consumer's affine
  indices for the producer's output IDs, normalize the resulting accesses, and remove the
  producer. Preserve all scalar operation boundaries and the consumer's reduction ordering.
  Restrict the rule to pointwise producers and use unique binders throughout to avoid capture.
  Materializing the producer is the fallback for a returned tensor, multiply used tensor or
  producer with a reduction. Tests include a use under a reduction and a substitution of a
  nontrivial affine index. Mutate a valid rank-two substitution by swapping axes on a square,
  asymmetric fixture. Both versions validate as IR. The meaning check must reject the mutation.
- **split-sum** replaces a one-binder sum by the internal blocked sum, with block size four.
  For block `b`, visit original indices `4*b` through
  `min(4*b + 4, extent) - 1`, then add the subtotal to the outer accumulator. Preserve the
  body and its original index ID. Leave max, multi-index sums and already blocked nodes alone.
  Using source reductions to express the rewrite would require adding division and a truncated
  tail to affine bounds; the internal node expresses those bounds directly. Mutate the block
  result to drop the final partial block in the test candidate. In the fixed-shape fixture,
  make a valid eight-column prefix with `prefix[i,d]: f32[1,8] = x[i,d+i];` and block the
  sum over that prefix.

Use `x: f32[1,9]` and `y[i] = sum(d) x[i,d];` to return a tensor of length one. The input row is `[1, 0, 0, 0, 2^-24, 2^-24, 2^-24, 2^-24, 0.25]`. Linear f32 returns
`1.25` (word `0x3fa00000`). Blocked f32 and the original f64 reference return
`1.250000238418579` (f32 word `0x3fa00002`). The exact gate must reject the real rewrite
and the tolerance gate must accept it. The tail-dropping candidate returns
`1.000000238418579`, so the tolerance gate must reject it. Node 24 reproduced these
values in a probe using the built framework's differential runner. These probes are policy and
numeric checks. The implementation tests will exercise the artifacts and gates end to end.

## Framework change

| File | Proposed change and reason |
| --- | --- |
| `src/framework/passes/define-pass.ts` | Add `applyNativePassSync` for a native kernel that returns a candidate or an identity and a required synchronous semantic check. Share native artifact construction, projection diff, correspondence and declared-write checks with `applyPass`. Return the existing pass result shape and use `PassError('contractRejected', …)` for a negative verdict. |
| `src/framework/passes/index.ts` | The existing wildcard export already exposes the new function. |

The native synchronous entry point receives a pass ID, version, IR definition, adapter, write
declarations, kernel and mandatory check. The kernel takes the input artifact and parameters.
The framework checks the matching IR definition and adapter, validates the produced artifact,
checks writes, and invokes the gate with immutable before and candidate artifacts. It requires
a synchronous `CheckResult`. The caller gets the candidate only once the check accepts. Use
private views for diffing and keep this entry point limited to native revisions and pure sampled
checks without analysis dependencies, edit transactions, effects or a caller-supplied store.

The built `applyPass` probe returned a promise even for a synchronous kernel. It also attempted
to open a graph edit and failed with `ir.capability` when the adapter had no `rebuild`. The
synchronous native path can use a projection-only adapter. Reusing `applyPass` would be the
simplest option for an async host; it conflicts with the fixed API here. Calling domain kernels
and their invariant directly in Tix would work synchronously but duplicate the framework's
native validation, write enforcement and revision bookkeeping. A synchronous `AnalysisManager`
transaction would be broader than the missing feature. The existing `runDifferential` already
takes a comparator and produces the evidence needed here. No contracts, core, IR, dataflow or
strategy changes are proposed. Signed zero needs a domain encoding, not a framework identity change.

## Corpus and implementation checks

| File under `corpus/tensor/` | Workload and independent check |
| --- | --- |
| `matmul/main.tix` | Rectangular matrix product with a hand-computed result. |
| `softmax/main.tix` | Max-shifted exponentials. Check normalization and the order of probabilities on large logits. |
| `layernorm/main.tix` | Last-axis mean and variance, epsilon before sqrt, gamma scale and beta offset. Check a constant row and a nonconstant row. |
| `attention/main.tix` | Single-head scaled QK scores, max-shifted row softmax and weighted V. Check unequal query/key lengths and a small worked case. |
| `mlp/main.tix` | Two projections with bias and tanh-GELU between them. Check against the formula and use asymmetric weights. |
| `conv2d/main.tix` | NCHW, stride 1, valid 3×3 convolution, with affine `H - 2` and `W - 2` outputs. Check a small nonuniform multi-channel tensor against direct loops. |

Use `tests/tensor/*.test.mjs` importing the built API. Check diagnostics with source locations,
binding and rectangular shapes, reduction reach and lexicographic order, empty reductions,
affine bounds, row-major observations, f32 primitive rounding and f64 reference behavior.
Assert the pass witnesses, both semantically wrong candidates, continued optimization after
rejection, and origin preservation across calls. Add focused framework tests for the synchronous
path's native validation, write enforcement and mandatory gate, including a projection-only
adapter. After implementation, build and run the tensor suite, `node --test tests/framework/`,
and Typed pass, inline, and meaning tests that cover the shared path. Tests that spawn Node may
need sandbox escalation.

## Later

- CUDA lowering and execution on the GPU machine are outside stage 1.
- Fusion, contraction tiling and attention-specific rewrites belong to later stages.
