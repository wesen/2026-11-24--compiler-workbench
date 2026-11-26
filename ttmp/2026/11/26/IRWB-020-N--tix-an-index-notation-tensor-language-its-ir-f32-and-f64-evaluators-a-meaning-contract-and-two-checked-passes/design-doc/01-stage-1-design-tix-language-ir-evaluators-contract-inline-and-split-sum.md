---
Title: 'Stage 1 design: Tix language, IR, evaluators, contract, inline and split-sum'
Ticket: IRWB-020-N
Status: review
Topics:
    - tensor
    - compiler
    - ir
    - verification
    - typescript
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/framework/passes/define-pass.ts
      Note: applyPass; both proposed framework changes land here
    - Path: src/framework/contracts/differential.ts
      Note: differential(), runDifferential, differentialSpec; the meaning contract is built on these unchanged
    - Path: src/framework/ir/adapters.ts
      Note: defineAdapter/createIRArtifact; the Tix IR projection
    - Path: src/typed/passes.ts
      Note: optimizationContract, the pattern the tensor contract follows
    - Path: src/typed/evaluate.ts
      Note: meaningKept, the differential invariant the tensor relations mirror
    - Path: ttmp/2026/11/26/IRWB-020-N--tix-an-index-notation-tensor-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/01-probe-framework-fit.mjs
      Note: probe that found both framework frictions
ExternalSources: []
Summary: "Design for stage 1 of the tensor domain: Tix syntax and checks, a statement-level IR as a v6 artifact, f32/f64 evaluators, exact and tolerance meaning relations, the inline and split-sum passes, a six-program corpus, and two small framework changes."
LastUpdated: 2026-11-26T13:30:00-05:00
WhatFor: "Review before implementation of IRWB-020-N"
WhenToUse: "Reading or reviewing the tensor domain's stage 1"
---

# Stage 1 design: Tix language, IR, evaluators, contract, inline and split-sum

## 1. Summary

Stage 1 adds a second domain, tensor programs written in **Tix**, on the framework in `src/framework/`. The
deliverable is a front end (parser plus checker), a statement-level IR stored as a v6 artifact, two evaluators
(f32 is the meaning, f64 is the reference), a meaning contract with two relations (exact and tolerance), two
checked passes (`inline`, `split-sum`) with one deliberately wrong variant each, and a corpus of six programs.

The framework mostly fits. The IR, artifacts, passes and the sampled differential check need no change. A probe
(`scripts/01-probe-framework-fit.mjs`, run against the built `dist/`) found two places where it does not fit.
Both are small changes to `src/framework/passes/define-pass.ts`:

- **F1.** `applyPass` always opens an IR edit, and opening one requires a *rewritable* adapter (one with
  `rebuild`), even when the pass returns a native value and never touches the edit. Proposed change: open the
  edit only when the pass first uses `ctx.edit`.
- **F2.** Checked pass application exists only as an `async` function, but the fixed API
  `optimizeTix(...)` is synchronous. Proposed change: add `applyPassSync`. It shares the native-result path with
  `applyPass` and checks a contract whose guarantees are all sampled differential invariants.

Section 9 describes both changes. They are the main result of this stage.

## 2. Supported domain

Everything below is specified only for this domain.

- **Source.** Programs written in the fixed Tix core from the brief, extended only as stated in section 3.
- **Shapes.** Every shape name is bound by appearing as a *plain* dimension (just the name) of some parameter.
  Shape values are positive integers, and every declared dimension evaluates to at least 1.
- **Inputs to `runTix`.** One entry per parameter, giving a shape and row-major data of the right length, with
  finite values. Shapes must bind each shape name consistently. If they do not, `runTix` throws an `Error`,
  and nothing more is specified.
- **Passes.** They run on programs that `compileTix` produced, or on programs that an earlier accepted pass
  produced from those.
- **Meaning check.** It uses the sampled cases defined in section 6.1. It establishes agreement on those cases
  only. It is not a proof.

## 3. Tix: syntax and checks

The grammar, precedence, reduction-body extent and f32 meaning are exactly the ones in the brief. The front end
adds the following rules. Each is a check error, reported as `line:col: message`, with the position of the
offending token.

1. **Names.** Within a function, parameter names, statement tensor names, shape names and index names come from
   separate sets, and no name may belong to two of them. A tensor is defined once (single assignment) and only
   used after its definition. The `return` name must be a defined tensor.
2. **Bare names.** A bare `NAME` in an expression must be one of the function's shape names. Its value is that
   shape's value, as a number.
3. **Ranks.** A reference has exactly as many indices as its tensor has dimensions. A statement's left-hand
   indices are distinct. A reduction's indices are distinct and must not reuse an enclosing index.
4. **Extents.** A use is *plain* when the index expression is the bare index name. The extent of an index is the
   dimension of the referenced tensor at its plain uses. All plain uses must give equal extents, compared as
   normalised affine forms, so `H - 2` and `H - 3 + 1` are equal but `H - 2` and `H - R + 1` are not. A
   left-hand index with no plain use takes its extent from the statement's declared type, which is then
   required. If a declared type is present, it must equal the inferred extents. A reduction index must have a
   plain use. A statement's tensor shape is the list of its left-hand extents.
5. **Bounds.** Every affine index `a = c + Σ aᵢ·iᵢ` is checked against the dimension `d` it indexes. Its
   minimum and maximum come from substituting `0` or `extent − 1` for each index, depending on the sign of the
   coefficient. Both `min ≥ 0` and `d − 1 − max ≥ 0` must be *provable*. An affine form over shape names is
   provable non-negative when every shape-name coefficient is ≥ 0 and the constant plus the sum of the
   coefficients is ≥ 0, because shapes are ≥ 1. This handles conv2d: `p + r` with `p < H − R + 1` and `r < R`
   gives `max = H − 1`. Anything the rule cannot prove is an error.
6. **Return.** The returned tensor's shape must equal the declared result type.

There are no calls between Tix functions, since the grammar has none. `runTix` names the function to run. A
program may contain several functions.

## 4. The IR (`tensor.tix`, version 1)

**Form.** The IR is a statement-level index-notation IR, one record per Tix statement. Each statement has
explicit index extents and an expression tree. Expression nodes live in a flat table and carry stable ids. It is
the checked source, made explicit: every extent is resolved, and every reduction axis carries its extent and
order.

```ts
type Affine = { c: number; t: Record<string, number> };   // c + Σ t[name]·name, sorted keys, no zero coefficients
type Extent = { aff: Affine; div?: number };               // ceil(aff / div); div only appears after split-sum
interface TixModule { fns: Record<string, Fn>; stmts: Record<string, Stmt>; exprs: Record<string, Expr>; next: number }
interface Fn   { name: string; shapes: string[]; params: { name: string; dims: Affine[] }[];
                 result: Affine[]; body: string[] /* stmt ids, program order */; returns: string /* stmt id */ }
interface Stmt { id: string; fn: string; tensor: string; indices: { name: string; extent: Affine }[];
                 root: string; at: string /* "line:col" */ }
type Expr =
  | { op: 'num'; value: number } | { op: 'shape'; name: string }
  | { op: 'ref'; tensor: string; at: Affine[] }            // tensor: a param name or a stmt id
  | { op: 'neg' | 'exp' | 'log' | 'sqrt' | 'tanh'; a: string }
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'max' | 'min'; a: string; b: string }
  | { op: 'reduce'; kind: 'sum' | 'max'; axes: { name: string; extent: Extent }[];
      guard?: { at: Affine; lt: Affine }[]; blocked?: true; body: string };
```

- **A guard** on a reduction skips any iteration where `at < lt` is false. Only `split-sum` creates guards. The
  bounds rule (section 3, rule 5) is extended in one way: a reference whose affine equals a guard's `at` gets the
  bound `lt − 1`.
- **Validation** (`defineIR` `validate`) is structural plus bounds. Every id must resolve. The expressions must
  form trees, with no sharing. References must resolve to a parameter or an earlier statement of the same
  function. Ranks must match. Every index in an affine must be bound by the left-hand side or an enclosing
  reduction. Extents may mention only the function's shapes. Bounds are checked with the same function the front
  end uses, without positions. A pass whose output fails validation is therefore rejected before the contract
  runs.
- **v6 projection** (`defineAdapter`). Entities are `fn:`, `param:`, `stmt:` and `expr:<op>`. Relations are
  `contains` (fn to stmt, ordered; containment), `root` (stmt to expr; containment), `operand` (expr to expr,
  ordered; dependency), `reads` (ref to stmt or param; dependency) and `returns` (fn to stmt; dependency). The
  adapter has no `rebuild`, because passes return native values (see F1).
- **The public `TixProgram`** is `Artifact<TixModule>`, created with `createIRArtifact`.

**Lowering.** A statement maps one-to-one onto a loop nest. There is one loop per left-hand index, with extents
given as expressions over shape names. A `reduce` becomes inner loops in axis order, with the guard as an `if`.
Later stages need nothing more from this stage.

**Alternatives.**
- The simplest IR would be the parse tree itself, with nested expressions and no ids. It falls short because
  passes need stable entity ids for v6 correspondence, and they need the resolved extents.
- An explicit loop-nest IR would commit stage 1 to loop order and make `inline` a loop-fusion problem.
- An SSA graph of whole-tensor operations, like `matmul` and `reduce`, cannot express `split-sum`'s index
  arithmetic.

## 5. Evaluators

There is one interpreter, `evaluate(module, fn, inputs, round)`, with `round = Math.fround` for f32 and the
identity for f64.

- **Shapes.** Shapes are bound from the input shapes, and each declared dimension is then evaluated and checked.
- **Statements** run in program order. Each produces a row-major `Float64Array` buffer, whose values are
  f32-exact in f32 mode, over its left-hand index space in lexicographic order.
- **Expressions** are evaluated recursively per element, and `round` is applied to every result. Literals are
  `round(value)`, shapes are `round(N)`, and builtins use `Math.exp/log/sqrt/tanh/max/min`.
- **Reductions.** `sum` starts at `+0`. `max` starts at `−∞`. Both walk the axes in lexicographic order with
  the first axis outermost, skip iterations whose guard fails, and apply `acc = round(acc ⊕ v)` at each step.
  Inputs are rounded on entry in f32 mode.
- **Output.** `runTix` returns a `Float32Array` for f32 and a `Float64Array` for f64.

**Alternative.** Compiling statements to JavaScript closures would be faster. The interpreter was chosen because
the cases are small (section 6.1), and one plain interpreter is the easiest thing to trust as the meaning.

## 6. The meaning contract

The contract is a pair of v6 differential invariants (`differential()` from `src/framework/contracts`), wrapped
in two `defineTransformation` contracts. Both contracts have inputs `{input, origin}` and output `{output}`,
following `typed.optimization`.

### 6.1 Domain: the sampled cases

- For each function in the program, the checker generates 8 cases from seed 1 with `seededRandom`.
- In each case, every shape name is drawn uniformly from 1 to 8. The draw is repeated, at most 100 times, until
  every parameter dimension, result dimension and statement extent is at least 1. A function with no valid draw
  makes the check fail, which is the framework's rule for "no decided case".
- Each input element is drawn uniformly from [−1, 1] and rounded to f32.
- The cases come from the baseline port's program. Passes do not change signatures, so both sides accept the
  same cases.

### 6.2 Observation

The observation is the returned tensor of each function: its shape and data. Intermediate tensors are not
observed, because `inline` removes them.

### 6.3 Relations

- **Exact** (`tensor.exact-f32`). The baseline is `input`, the subject is `output`. A case agrees when the
  shapes are equal and every element of the candidate's f32 output satisfies `Object.is` against the input
  program's f32 output. In practice this means bit-identical, because JavaScript has a single NaN in a
  `Float32Array` read.
  - The exact relation is checked against the *pass input*, not the origin. An exact pass applied after a
    tolerance pass must preserve the bits it was given.
- **Tolerance** (`tensor.close-f64`). The baseline is `origin`, the subject is `output`. The baseline outcome is
  the origin program's **f64** output, together with the origin's own f32 output. Per element, with `r` the f64
  reference, the candidate's f32 value `y` must satisfy `|y − r| ≤ τ · max(1, |r|)`, where **τ = 2⁻¹² ≈ 2.4e−4**.
  A case is **inconclusive** in two situations:
  - Some element of `r` is not finite.
  - The origin's own f32 output fails the same bound. The relation cannot judge a pass on a case where the
    original program is not that accurate.

  Comparing every step with the origin's f64 output, rather than with the previous revision, means that
  successive tolerance passes cannot accumulate slack.

### 6.4 Why τ = 2⁻¹² with the `max(1, |r|)` scale

1. **It accepts the honest rewrite.** Reassociating a sum of n terms of magnitude ≤ M changes the f32 result by
   at most about 2·n·u·n·M, where u = 2⁻²⁴. Within the domain, split-sum only touches single-index sums with
   n ≤ 8 and terms of order 1, which gives about 8e−6. That is 30 times below τ. Products of reductions
   (attention, MLP) multiply this by small constants.
2. **It rejects real bugs.** A wrong reduction typically drops or duplicates a term of magnitude about 0.5, a
   relative error of about 0.1. That is 400 times above τ.
3. **Why the `max(1, |r|)` scale.** A purely relative or ULP-based bound rejects honest results near zero after
   cancellation, such as layernorm's `x − μ` or a sum of mixed signs. A normwise bound would let one large
   element hide errors in small ones. The mixed scale is absolute near zero and relative above 1.
4. **The inconclusive rule** covers ill-conditioned cases that the a-priori argument does not, such as a
   layernorm row with near-zero variance. Those cases are never counted as agreement.

During implementation I will measure, over the corpus cases, the largest scaled error of each origin program,
the largest error of the honest `split-sum` output, and the smallest failing error of `split-sum-wrong`. I will
record all three in the diary. If the honest margin is under 10×, I will reopen this choice. I will not quietly
retune τ.

**Alternatives.**
- The simplest relation would be a single global relative tolerance against the f32 origin. It is rejected
  because the f32 origin is itself approximate, so the bound would be measuring the distance between two
  roundings rather than accuracy.
- A rigorous per-element bound would need a third evaluator that propagates absolute values (γₙ·Σ|x|). It is
  listed under Later.

### 6.5 Packaging

- `exactContract` and `toleranceContract` are created once (the registry rejects redefinition).
- Each invariant sets `baselineKey` to the baseline artifact's revision, so cases and baseline outcomes are
  computed once per revision.
- No framework change is needed for the contract. `differential()`'s `run(side, …)` lets the baseline side
  return the pair (f64 output, f32 output), and the subject side return the f32 output.

## 7. Passes

Both passes are `definePass` passes. Each returns a native `TixModule` plus correspondence entries, and declares
`writes`. They declare no `needs` and no `preserves`.

### 7.1 `inline` (contract: exact)

- **What it inlines.** A statement P is eligible when:
  - its expression contains no `reduce` (it is pointwise),
  - it is not the returned statement, and
  - it is referenced by exactly one `ref` node in its function.
- **The rewrite.** That `ref P[a₁…aₙ]` is replaced by a fresh copy of P's expression tree. In the copy, P's
  left-hand index `iₖ` is replaced by the affine `aₖ` (an affine of an affine is still affine). P is then
  removed.
  - P has no binders, so nothing can be captured.
  - The consumer's reads stay in bounds, because the substituted index stays within P's extent, so P's own
    in-bounds proof carries over.
- **Order.** The earliest eligible statement goes first, repeated until no statement is eligible. One
  application therefore inlines chains, such as MLP's `g` into `y`.
- **Correspondence.** P and its expression nodes split into their copies. The replaced `ref` merges into the
  copy's root.
- **Why the result is bit-identical.** Under the f32 meaning, every operation is rounded, and P's element is a
  function of P's inputs at that index only. Recomputing it inside the consumer performs the same rounded
  operations on the same values.
- **`writes`:** entities `stmt`, `expr.*`; relations `contains`, `root`, `operand`, `reads`.

### 7.2 `split-sum` (contract: tolerance)

- **What it rewrites.** Every `reduce` with `kind: 'sum'`, exactly one axis, no guard and no `blocked` mark. The
  block size is `B = 4`, a pass parameter with that default.
- **The rewrite.** Take `sum(j: E) body`. It becomes
  `sum(jb: ceil(E/4), blocked) sum(jk: 4, blocked, guard 4·jb + jk < E) body[j := 4·jb + jk]`.
  - The fresh index names avoid every name in the function.
  - The rewrite works for symbolic `E`. That is why the IR has `Extent.div` and guards: Tix has neither
    floor division nor conditionals.
- **Why the result differs.** The meaning sums each block from `+0`, then sums the block results. This
  reassociates the sum, so f32 results differ, and the exact relation must reject it.
- **Correspondence.** The old `reduce` splits into the two new ones.
- **`writes`:** entities `expr.*`; relations `operand`, `root`.

**Alternative.** The simplest version would split only sums whose extent is a constant multiple of B. Tix
extents are almost always symbolic (`D`, `K`), so that version would never fire on the corpus.

### 7.3 The deliberately wrong variants (test-only, not in `optimizeTix`'s name table)

- **`inline-wrong`** inlines like `inline`, then rewrites `x * (y * z)` in the copy as `(x * y) * z` (and does
  the same for `+`).
  - This is the bug an inliner that also "simplifies" would make. It is exact over the reals.
  - The exact relation rejects it, and the tolerance relation would accept it. That isolates what the exact
    relation adds.
  - It fires on the corpus because MLP's GELU contains products like that.
- **`split-sum-wrong`** gives the outer axis `floor(E/4)` blocks instead of `ceil(E/4)`. That drops the
  remainder whenever `4 ∤ E`. The tolerance relation rejects it, and with extents drawn from 1 to 8 most cases
  hit the bug.

## 8. Public API and module layout

- **`compileTix(source)`** parses, checks, builds the IR and validates it. It returns the artifact, or throws
  `Error("line:col: …")`.
- **`runTix(program, fn, inputs, {precision})`** binds the inputs and evaluates them as in section 5.
- **`optimizeTix(program, passes)`**:
  - `origin` is the program passed in.
  - For each name, it looks the pass up in `{inline, split-sum}` (an unknown name throws) and calls
    `applyPassSync(pass, current, {contractInputs: {origin}})`.
  - An accepted pass advances `current`. A `contractRejected` or invalid output leaves `current` unchanged and
    is recorded as `accepted: false`.
  - It returns `{program: current, steps}`.
- **Files under `src/tensor/`**: `syntax.ts` (lexer and parser), `check.ts` (names, extents, bounds), `ir.ts`
  (model, `TixIR`, validate, adapter), `evaluate.ts`, `contract.ts`, `passes.ts` (the two passes and the two
  wrong variants), `index.ts`.
- **Corpus**: `corpus/tensor/{matmul,softmax,layernorm,attention,mlp,conv2d}/main.tix`. Sketches of three of
  them:

```
fn conv2d(x: f32[N, C, H, W], w: f32[K, C, R, S]): f32[N, K, H - R + 1, W - S + 1] {
  y[n, k, p, q]: f32[N, K, H - R + 1, W - S + 1] = sum(c, r, s) x[n, c, p + r, q + s] * w[k, c, r, s];
  return y;
}
fn layernorm(x: f32[N, D], gamma: f32[D], beta: f32[D]): f32[N, D] {
  mu[i] = (sum(d) x[i, d]) / D;
  xc[i, d] = x[i, d] - mu[i];
  var[i] = (sum(d) xc[i, d] * xc[i, d]) / D;
  y[i, d] = xc[i, d] / sqrt(var[i] + 0.00001) * gamma[d] + beta[d];
  return y;
}
fn mlp(x: f32[N, D], w1: f32[D, F], b1: f32[F], w2: f32[F, D], b2: f32[D]): f32[N, D] {
  h[n, j] = (sum(d) x[n, d] * w1[d, j]) + b1[j];
  g[n, j] = 0.5 * h[n, j] * (1 + tanh(0.7978845608 * (h[n, j] + 0.044715 * (h[n, j] * (h[n, j] * h[n, j])))));
  y[n, e] = (sum(j) g[n, j] * w2[j, e]) + b2[e];
  return y;
}
```

The other three corpus programs:
- matmul is `c[i, j] = sum(k) a[i, k] * b[k, j]`.
- softmax is the brief's example.
- attention computes `q·kᵀ / sqrt(D)`, a max-shifted softmax over keys, and a sum over `p·v`. Its `p` is
  inlined into the output reduction.

## 9. Framework changes (the primary result)

### F1. `applyPass` opens the IR edit lazily

- **Finding.** `applyPass` calls `view.beginEdit()` before running the pass. `Edit` throws
  `Adapter … is not Rewritable` when the adapter has no `rebuild`. The probe reproduced this.
  - A domain whose passes return native values must currently write a `rebuild` (graph to native) that nothing
    ever calls.
  - Typed does not hit this, because its adapter is rewritable.
- **Change.** `PassRunContext.edit` becomes a getter that calls `view.beginEdit()` on first access. The edit is
  rolled back on a native result, but only if it was opened. A pass that neither returns a native value nor
  touched `edit` produces no change. This is the same result as the current zero-operation branch.
  - The type is unchanged, and rewritable adapters see the same behaviour.
- **Simplest alternative.** Give the Tix adapter a `rebuild` that throws. It is rejected because it advertises
  a capability, `Rewritable`, that the adapter does not have, and every future native-result domain would
  repeat the workaround.
- **Test.** Add a test in `tests/framework/ext-e3-e6.test.mjs`: a native-result pass on a non-rewritable
  adapter is applied and its contract checked. This is a new test case. Existing tests are not modified.

### F2. `applyPassSync`, a synchronous checked application

- **Finding.**
  - Every path from a pass to an accepted, contract-checked revision goes through `AnalysisManager`, and the
    manager is async throughout (`verifyTransformation`, `checkInvariant`). The fixed `optimizeTix` API returns
    its result directly, and an async function's result cannot be awaited synchronously in Node.
  - However, a sampled differential invariant is synchronous already. `runDifferential(differentialSpec(inv),
    ports)` is what the Typed tools use outside a manager.
- **Change.**
  - Factor out of `applyPass` the steps that follow a native result: build the artifact, diff, make the
    correspondence, enforce `writes`. They become one internal function that both entry points call.
  - Add
    `applyPassSync(pass, before, {contract?, contractInputs?, outputId?, store?, params?}): PassResult<S>`.
  - Its domain:
    - `pass.run` returns a `NativeResult` synchronously.
    - The pass has no `needs` and no `preserves`.
    - Every clause of the contract is an `ensures` over a differential invariant without `decide`.
  - Outside that domain it throws `PassError('badResult')` naming the reason.
  - It evaluates each invariant with `runDifferential` on the bound ports. If any invariant does not agree, it
    throws `PassError('contractRejected')`, the same error `applyPass` throws. `result.contract` holds the list
    of `{invariant, evidence}`.
- **What the sync path does not do.** It records no facts in a manager. The evidence is returned to the caller
  and not stored. That is the cost of a synchronous host API, and it is a finding to raise for later domains.
- **Simplest alternative.** Do the same steps inside `src/tensor/` using the exported pieces
  (`createIRArtifact`, `diff`, `makeCorrespondence`, `undeclaredWrites`, `runDifferential`). It is rejected
  because it duplicates the pass-application sequence outside the framework. The next domain with a synchronous
  host would duplicate it again, and the copies would drift from `applyPass`.
- **Tests.**
  - A framework test: `applyPassSync` accepts with a loose invariant, rejects with an exact one, and refuses a
    pass with `needs`.
  - A tensor test: `applyPass` (async, with a manager) and `applyPassSync` give the same verdict and revision
    for `inline` and `split-sum`.

### What fitted without change

- `defineIR`, `createIRArtifact` with floating-point payloads (probed).
- `defineAdapter` and the projection.
- `definePass` `writes` enforcement.
- `differential()` with a custom outcome shape and an inconclusive rule.
- `ApplyOptions.contract` overrides. Tests use them to apply `split-sum` under the exact contract.

After the implementation I will run `node --test tests/framework/` and `tests/typed/passes.test.mjs`,
`tests/typed/rules.test.mjs`. Those are the Typed tests that go through `applyPass`.

## 10. Tests (`tests/tensor/`)

The tests go where the risk is:

1. **Front end.**
   - Precedence, and the rule that a reduction's body extends to the right (`sum(d) x[i,d] / D` against
     `(sum(d) x[i,d]) / D`).
   - One negative case per check rule in section 3, each asserting the message's `line:col`.
2. **The f32 meaning.**
   - matmul, softmax and conv2d are compared with hand-written JavaScript loops that use `Math.fround`. The
     check is bit-exact: this is the one independent check on the evaluator.
   - f64 is compared against f32 within τ on the corpus.
3. **Contract.**
   - `inline` is accepted (exact) on every corpus program where it fires.
   - `split-sum` is rejected by exact and accepted by tolerance on matmul, softmax, layernorm and attention.
   - `inline-wrong` is rejected on mlp.
   - `split-sum-wrong` is rejected on matmul.
   - A program after `optimizeTix([...'inline', 'split-sum'])` runs, and its output stays within τ.
4. **Framework changes.** As listed under F1 and F2.

## 11. Left out, and why

- **User function calls in Tix.** The fixed grammar has none.
- **Choosing the block size through `optimizeTix`.** The API names passes only, so it is fixed at B = 4.
- **Fact records for sync-checked passes** (see F2).
- **Configurable case domain per program.** Defaults suffice for the corpus.
- **Error-recovery diagnostics.** The first error throws.

## 12. Later

- A rigorous per-element tolerance from an absolute-value error evaluator.
- An async `optimizeTix` variant that records facts in an `AnalysisManager`.
- Fusion, tiling, attention rewrites and CUDA lowering (stages 2 and later).
- Splitting multi-index sums (conv2d).
