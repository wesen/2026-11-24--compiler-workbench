---
Title: 'Design: Tix programs and checked tensor passes'
Ticket: IRWB-020-J
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
      Note: Existing side-aware synchronous checker and evidence
    - Path: repo://src/framework/ir/transactions.ts
      Note: Draft preparation without publishing a revision
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Async pass application, write checking and contract boundary to compare against
    - Path: repo://src/typed/project.ts
      Note: Origin-anchored acceptance precedent
ExternalSources: []
Summary: A scoped index IR, its numerical semantics, and a synchronous sampled gate for two v6 passes.
LastUpdated: 2026-11-26T12:55:15.097053166-05:00
WhatFor: Stage-1 design review before implementation.
WhenToUse: Review the framework delta first; use the witness and acceptance matrix when implementing the gate.
---

# Tix programs and checked tensor passes

**Proposal, not implementation.** Compile the fixed Tix grammar to one immutable v6 artifact per program.
Keep iteration domains and scalar evaluation order explicit. Make the unit of acceptance a *whole program
revision*, not a successful pattern match. The question for review is whether the framework needs anything
beyond a synchronous way to apply a pure pass with a sampled postcondition.

## Framework delta ledger

| Area | Proposed change and reason | Acceptance evidence to collect |
| --- | --- | --- |
| `src/framework/passes/sampled-sync.ts` (new), `passes/index.ts` (export) | Add `applySampledPassSync(pass, before, {contract, contractInputs})` for synchronous, edit-based `definePass` bodies and pure differential guarantees. `applyPass` always awaits the body and `AnalysisManager.verifyTransformation`; `optimizeTix` must return a value, not a promise. | Same ordinary pass, transformation and inputs under both runners: same changed revision, correspondence, writes check and sampled verdict. Rejection does not select the candidate. |
| `core`, `ir` | **None.** `createIRArtifact` + a domain adapter already provide finite immutable storage, revision hashes and a checked, synchronous `IREdit.prepare()`. Numbers in the IR are not tensor buffers. | Hash/port validation, open and inspect the graph, round-trip a prepared edit, keep r0 readable. |
| `contracts` | **None.** `differential()` already provides side-aware `run`, arbitrary cases/outcomes and a comparator. Numerical tolerance is a Tix policy, not a new kind of invariant. `runDifferential` and `differentialSpec` exist today. | Compare sync evidence with `AnalysisManager` on the same invariant. Exact *comparison* does not imply proof over all inputs. |
| `dataflow`, `strategy` | **None.** Lexically scoped reductions aren't control-flow loops in a CFG. Two names in a caller-specified sequence don't require a search strategy. | No CFG surrogate, target flags, new strategy operator or import of Typed code. |

**Boundary of the addition.** Use the existing pass, IR type, adapter, transformation selectors and `PassError`.
For this entry point support no `needs` or preservation claims; one `input` and one `output` artifact plus named
IR inputs (e.g. `origin`); a pure transformation with only nonempty `ensures` of registered synchronous
`differential` invariants. Preflight these restrictions, including absence of a transformation body, other clauses,
resource effects and async `decide`; never treat an unsupported clause as satisfied. Validate exact port sets,
kinds/versions and hashes (`validateArtifact`). Apply the synchronous body to a private `view.beginEdit()`,
reject a thenable or a native return, `prepare()` its edits, check `undeclaredWrites`, then bind *each* invariant's
ports from the transformation and use `runDifferential(differentialSpec(inv), boundPorts)`. Require `agree`.
Retain evidence with the internal pass result or rejection. Check identity candidates too. Dispose of the draft;
only the return of an accepted immutable artifact publishes it to this caller. No shared store head, effects,
manager facts, cache or fake synchronous `commit()`. The ordinary asynchronous path stays as it is.

Typed already uses `defineTransformation({inputs:{input,origin}, outputs:{output}, ensures:…})` in
`src/typed/passes.ts`; `project.ts:runPipeline` advances `cur` only on success. A Tix-local copy of a pass
runner would hide a real framework mismatch. Blocking on a worker/subprocess to call `applyPass` would add
serialization and another failure boundary to a small in-process check. A general synchronous `AnalysisManager`
would promise much more than either tensor pass uses. **No other framework edits planned**; record any change to
this list, with the missing capability and the test that required it, here before landing it.

## Language boundary and checks

`src/tensor/index.ts` will export exactly the requested synchronous call shapes. `compileTix(source)` returns
an opaque `TixProgram` holding `{origin, current, approximate}` (two references to the same artifact at r0).
`runTix(program, fn, inputs, {precision}?)` interprets `current`; default `f32`. `optimizeTix(program, passes)`
returns `{program, steps:[{pass, accepted}, …]}`. The supported pass names are `inline` and `split-sum`.
Multiple independent named functions are allowed; there are no user-function calls. No implicit broadcast,
scalar tensor type, mutable tensors or implicit Einstein summation.

* **Parse** (`parse.ts`). Lexer with 1-based token spans, including EOF, `//` through end of line, decimal and
  scientific notation. Recursive descent for declarations; precedence climbing for scalar arithmetic (unary
  minus tightest, products then sums, binary operators left-associative). A reduction is a prefix form that
  consumes a *full expression* to the current delimiter, not just the next atom. Calls parse delimited argument
  expressions. `max(j) x[i,j]` and `max(a[i],b[i])` need different nodes: recognize a reduction binder list
  followed by a body, not just the keyword. For the two-name ambiguity, two in-scope bare shape values forming
  a complete binary call take call precedence when both parses are possible. Test this as well as nested sums.
* **Shapes and indices** (`check.ts`). Dimensions and subscripts use separate namespaces (shape symbols vs
  lexical index IDs), normalized as integer offset and sorted `(symbol, coefficient)` terms. Permit affine
  combinations, including an integer multiplier, not products of variables. Tensor and function names resolve
  by declaration, not by case convention. Check unique functions/parameters, statement SSA (including no
  overwrite of inputs, no self/forward reads), return name and rank/shape, subscript arity, and distinct binders
  within a list. Each reduction introduces its own scope. A shape value in scalar position must be bound by the
  input signature. Reject source errors at the relevant token with `line:col`.
* **Extent inference is over the whole RHS, before evaluation.** Each plain index at a tensor axis contributes
  that axis's symbolic extent to its resolved binder. All contributions must agree after normalization, even
  across operands/reductions; never silently equate independent `M` and `N`. A declared LHS type checks every
  inferred axis and supplies its own missing axes (e.g. `y+dy` only, or a fill). A reduction binder has no such
  declaration: with no plain witness for it, reject at its binder. Keep syntactic plain-use information through
  inference; algebraically simplifying a subscript is not a reason to invent an extent.
* **Bounds.** Index boxes start at zero. For a nonempty iteration box, substitute the low/high endpoint of each
  binder according to its coefficient to get the affine min/max of each subscript; check `0 <= min` and
  `max < axisExtent`. E.g. `[H-2]` output with `dy` ranging over `[0,3)` gives maximum `(H-3)+2 = H-1`.
  Check these inequalities symbolically under nonnegative shape symbols, legal declared extents, and nonempty
  bounds of the enclosing loops. Constant folding/coefficient comparison first; linear implication (eliminate
  shape variables from constraints plus the negated bound) for dependent dimensions. Be conservative if a
  bound can't be justified: report the access, not an eventual undefined array read. Do not add inequality or
  range syntax. Test the last valid window and a one-too-long annotation.
* **Static vs call-time.** A valid call supplies exactly the parameters, finite entries, nonnegative integer
  extents (zero is meaningful), row-major buffer lengths equal to the products, and one consistent nonnegative
  integral binding of all shape names. Derived dimensions and address products must be representable as safe
  integers and the tensors allocatable. At compile time form the matrix of input dimensions' linear parts;
  it must have sufficient rank to determine the shape names. At call time solve `A·s = actual - constant` and
  recheck *all* axes, integer solutions and derived extents. Exact integer/rational arithmetic in shape checks,
  not floating-point least squares; a direct named axis is the common trivial pivot. This supports e.g. an
  input dimension `N+1` without requiring an extra `f32[N]` parameter. Conflicting symbolic uses, impossible
  constant dimensions and underdetermined signatures are source errors; concrete buffer/shape mismatches
  can't be diagnosed from source and are checked on entry. No general integer programming interface.

## The v6 artifact and execution

`ir.ts`: `TixIR = defineIR<TixGraph>` (`tensor.index` @ `1`) and `defineAdapter` of matching kind/schema share
one native validator. Use the finite **ordered index graph itself** as native storage: entity, relation and
function-root arrays. No parser objects, closures, `Map`s or typed arrays in it. The adapter enumerates,
resolves, describes and rebuilds that graph. Canonicalize entity/edge ordering on construction; operand order
and loop order are explicit, never iteration over sorted IDs. In contrast, a source-string artifact would have
to be reparsed to expose a use, and a flat scalar SSA would have to recover reduction scopes.

| Entity | Stored information / relations |
| --- | --- |
| Function, parameter, definition | Function name, symbolic signature. Ordered membership edges to parameters and tensor definitions; `returns` binds directly to one tensor. Each definition carries its symbolic type, ordered free-axis binders and RHS root. |
| Index binder | Unique scope-qualified ID, printable spelling and iteration domain (ordinarily `0..extent` step 1). Function-local shape symbols live in signatures; they are not tensor loads. |
| Scalar expression | Ordered child edges; literal lexeme, shape value, negate, four arithmetic ops, six builtin calls, or load. Load has a `reads` binding edge and ordered affine subscript forms over binder IDs. |
| Reduction | `sum` or `max`, ordered binder edges and one body. A blocked sum is **two nested reduction nodes**. The outer binder ranges over block starts; the inner binder ranges over a clipped interval in the enclosing block. These are internal bound forms, not new Tix syntax. |

Membership, binder ownership and operand edges are containment; reads/returns and the inner domain's link
to its enclosing block-start binder are bindings. Give source nodes stable function-local IDs and spans,
and generated nodes deterministic fresh IDs; copy origin locations when rewriting. Validate graph structure, ordered slots, shapes, lexical reachability of every index term and
def-before-use, including reconstructed artifacts. Validate elaborated extents, don't try to *re-infer* them
from surviving plain loads after a substitution. The graph is loop-ready: output binders define result loops,
load forms define addresses, reduction nodes define accumulators. No storage scheduling is required.

`evaluate.ts`: build transient lookup tables. For each definition in order, allocate a dense output and evaluate
its RHS for each row-major coordinate (last axis fastest). An access at `i` uses `offset = offset * dim + i`
across axes. Index/shape/address calculations are integral; only shape values used as scalars get rounded.
Two evaluators share traversal, parameterized by `round` and buffer constructor:

* f32: copy/round input scalars (including `Float64Array` input) to `Float32Array`; apply `Math.fround` to
  literal conversion, shape scalar, unary/binary op, each JS `Math` call and **each** reduction update. No
  FMA or algebraic rearrangement. Unary minus stays a node (artifact canonicalization maps numeric `-0` to
  `0`); literal text preserves what the f64 evaluator must parse. Observe the returned typed-array bits.
* f64: use `Float64Array`, JS double operations/functions, same index order and identities, no `fround`,
  including at intermediate tensor stores. It evaluates the *original expression*, not an accumulation in
  doubles of already-rounded candidate intermediates. Neither evaluator mutates caller data.
* `sum`: start `+0`; `max`: start `-Infinity`, update with `Math.max`. First listed index outermost, increasing
  from zero for source indices; an empty reduction returns its identity. In the rewritten graph,
  `sum(base : starts(K,4)) sum(k : inBlock(base)) body` means: for `base=0,4,… <K`, start a
  fresh `+0`, add terms for `k=base..min(base+4,K)-1`, then add that partial once to a second `+0` accumulator.
  Both loops use the selected precision. No discarded tail, padding terms, or floor division in Tix affine syntax.

## What counts as keeping meaning?

`contract.ts`: versioned v6 transformations bind `input` (last accepted), `origin` (compiled r0), `output`
(proposed). **Sample space, not a proof**: check every function, all return elements, on the same ordered
calls for both sides. Generate from the origin signature only. Version the following policy with the invariant:

* Try shape assignments all symbols `1`, `4`, `5`, `7` and rotations of `(3,5,7)` across signature symbols in
  declaration order; literal dimensions remain fixed. Keep distinct legal nonempty test shapes. This covers
  asymmetric dimensions, full blocks, short blocks and tails. Test zero extents separately in evaluator tests.
  Cap samples at 32K elements per tensor and 2M scalar evaluation steps per call; record a failed check if
  there is no admissible sample for a function or a required execution cannot finish. No vacuous successes.
* For each retained shape use all ones; a bounded row-major ramp `((offset + parameterOrdinal) % 17 - 8)/8`; a repeating
  last-axis pattern `[1,0,0,0,2^-24,2^-24,2^-24]`; and seeded mixed-sign f32 samples in `[-1,1)` from
  framework `seededRandom(7)`. For the corpus epsilon parameter `eps: f32[1]`, supply positive `2^-10`.
  These are concrete finite `Float32Array` inputs, identical for f32 and f64 runs. Never reuse a verdict across
  different relations or invent a shape from the candidate. Start without memo keys or parallel workers.
* **Observation:** callable signature, returned rank, exact extents, length, and every row-major output cell;
  not statement count, intermediates, timings or artifact equality. **Exact:** f32 on both sides; compare raw
  32-bit words respecting view offsets, not JS `===` (notably signed zero). **Tolerance:** candidate f32 vs
  origin f64 on those same f32 inputs. For each finite pair `v, r` require
  `abs(v-r) <= 2e-5 + 2e-5 * abs(r)`. Fail a tolerance check on any nonfinite observation rather than allowing
  `Infinity <= Infinity` or filtering a bad candidate's cases. Finite inputs need not give finite arithmetic.
  Exact is still bitwise in those cases. Cases/budgets without usable evidence do not count as agreement.
* Why this threshold: f32 unit roundoff is `2^-24`; for a seven-term sum the absolute forward error scale is
  about `7 * 2^-24` times the sum of term magnitudes. Products, multiple reductions and nonlinear functions
  can amplify this. The absolute floor allows small errors near cancellation where relative-only tests fail;
  the relative term scales with larger outputs. This is a proposed engineering budget for *bounded samples*,
  not an ulp theorem or a license to accept all reassociations. Measure max error on the six programs, record
  any false rejection; don't widen the gate to pass a mutant. A norm/mean could hide one wrong cell.
* `describeCase` emits finite replay metadata (function, shape assignment, profile/seed and case ordinal);
  mismatch reason includes first offset, f32 words or f64 reference, observed value and allowed error. Keep raw
  buffers and nonfinite numbers out of v6 evidence; encode exceptional observations as text. Tests inspect the
  internal evidence/candidate, not a new public optimizer option.

### Policy when passes compose

| Step | Local guarantee | Check rooted at the original program |
| --- | --- | --- |
| `inline` in an exact history | `exact(input, output)` | `exact(origin, output)` (once if `input == origin`) |
| `split-sum` | Restricted structural rewrite below | `tolerance(origin, output)`; mark history approximate on an accepted change |
| `inline` after an accepted split | Still `exact(input, output)` | Also `tolerance(origin, output)` |

Simply comparing adjacent revisions allows tolerance drift. Requiring bit identity to r0 *after* accepting
roundoff would reject a subsequent correct inline. Keep r0 and the accepted-history flag even across separate
`optimizeTix` calls. Apply listed names in order; on a meaning rejection append `{pass,accepted:false}`, keep
the prior program and continue. An identity that passes the check is accepted with no revision change.
Structural/host bugs are not evidence of a numerical mismatch.

## The two edits and their falsifiers

* `inline`: count **occurrences**, including return, across the function. Take a reduction-free definition
  with exactly one load occurrence, not a returned tensor. Replace that load in its consumer with the
  producer tree, composing its affine subscripts with the use site's affine arguments *simultaneously by
  binder ID*. Remove the producer definition/binders and correspond old nodes to their replacements. Never
  flatten arithmetic or remove a scalar rounding point: every substituted value was already produced in the
  selected precision. Consumer may be under a reduction. Take the first eligible producer per function per
  invocation, in source order. No multi-use duplication. Test `p[i,j]=x[j,i]+1; y[i,j]=p[j,i]*2;`: a type-correct mutant using positional identity
  instead of the actual arguments is rejected on a nonsymmetric square matrix under exact.
* `split-sum`: replace ordinary one-index `sum` nodes with the blocked form (width 4), preserving binder,
  extent and body. Leave multi-index sums, max and already-blocked nodes alone. Record correspondence to the
  original reduction. Inline may write definition/binder/expression entities and membership/ownership,
  operand and reads edges; split declares reduction/binder entities and operand/ownership/block-binding edges.
  Neither writes the signature.
  A flag in the evaluator unconnected to an IR edit would yield no distinct, inspectable candidate.

**Acceptance witness:** `fn rows(x:f32[N,K]):f32[N]{ y[i]=sum(k) x[i,k]; return y; }`, `K=7`, one row of
the pattern above. A Node 24 arithmetic probe (not an implementation test) produced:

| Sequential f32 | Blocked f32 | Origin f64 | Blocked absolute error |
| --- | --- | --- | --- |
| `0x3f800000` | `0x3f800002` | `1.0000001788139343` | `5.960464477539063e-8` |

Test the **same changed artifact** with exact (reject) and tolerance (accept); don't infer failure from the
pass name. Some inputs give identical sums. A well-typed wrong split combining partial sums by `max` gives `4`
instead of `7` on an all-ones row; tolerance must reject it. Inject mutants only in tests, through the same
checked application path. Assert a changed good inline is accepted as well as rejection of the changed bad
inline; no tests that merely assert an identity pass succeeded.

## Corpus, tests and delivery after review

All sources at `corpus/tensor/<name>/main.tix`. Independent small loop oracles with known inputs are essential:
a shared traversal bug can make two precisions or two unchanged programs agree.

| Name | Defining calculation | Targeted check |
| --- | --- | --- |
| `matmul` | `sum(k) a[i,k]*b[k,j]` | Rectangular shapes, hand-computed entries |
| `softmax` | Row max, shifted exp, row sum, division | Large common shift; each finite row sums to about 1 |
| `layernorm` | Row mean and centered variance divided by `D`, `gamma[d]*normalized+beta[d]`, positive `eps[0]` inside sqrt | Constant row gives beta; nonconstant row and nonunit gamma |
| `attention` | Single-head `Q Kᵀ / sqrt(D)`, stable row softmax, weights times `V` | Unequal query/key lengths, uniform logits give mean V |
| `mlp` | Dense+bias, `0.5*x*(1+tanh(0.7978845608*(x+0.044715*x*x*x)))`, second dense+bias | Mixed signs, compare scalar reference |
| `conv2d` | NCHW, OIHW `3×3`, output `[N,O,H-2,W-2]`, `sum(c,dy,dx) x[n,c,y+dy,z+dx]*w[o,c,dy,dx]` | Nonsquare image, channel order and asymmetric kernel, last window; stride 1, no padding |

1. Front end and artifact tests: list of functions, `//`, precedence, greedy/parenthesized reduction division,
   both max forms, true affine normalization, mixed/plain extents, bad ranks/SSA/returns, out-of-scope and
   affine-only reduction binders. Assert actual `line:col` on multiline negatives. Inspect loop extents, order,
   revision, adapter and validated edit reconstruction; reject malformed native IR.
2. Evaluator tests: exact words including `-0`, f64 input differing from its f32 rounding, per-op vs final-only
   rounding, ordered multi-index cancellation, empty reductions and row-major indexing. Run both precisions
   on all six sources, compare to independent oracles, not just one another.
3. Add the framework helper and focused framework tests for its supported subset, writes, sync/async parity,
   and inability to skip an unsupported guarantee. Add tensor contract/pass tests for the acceptance matrix,
   replayable counterexamples, tail boundaries 1/4/5/7, multi-use nonmatch, affine/permuted inline under a
   reduction, nonfinite handling, no sample for one function, no-op, refusal to publish and mixed pass order.
4. `npm run build`; `node --test tests/tensor/`; `node --test tests/framework/`;
   `node --test tests/typed/{passes,strategies,evaluate-analyses,meaning-memo}.test.mjs` (expand if shared
   code touched). If a spawning test hits sandbox EPERM, request escalation for that command. Log results and
   actual framework paths/reasons here and in the diary. No changes to Typed, existing corpus or tools.

**Review requests:** Is the restricted sync gate small enough to belong in `passes/`? Is the proposed
finite comparison domain/tolerance sufficiently discriminating? Confirm the affine-only reduction error
(no declared reduction-axis slot), zero extent handling and the local-exact/global-tolerant composition rule.

**Later (not designed here):** CUDA lowering/device execution; fusion; contraction tiling; attention rewrites.
