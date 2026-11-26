---
Title: 'Tix stage 1 design: language, IR, evaluators, meaning contract, inline and split-sum'
Ticket: IRWB-020-P
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
      Note: the differential check the meaning contract is built on
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass, the target of proposed changes F1 and F2
    - Path: repo://src/tensor/contract.ts
      Note: the meaning contract
    - Path: repo://src/tensor/passes.ts
      Note: inline, split-sum and the wrong variants
    - Path: repo://src/typed/project.ts
      Note: runPipeline, the model for optimizeTix
    - Path: repo://ttmp/2026/11/26/IRWB-020-P--tix-stage-1-the-index-notation-language-its-ir-on-the-v6-framework-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/01-probe-framework-fit.mjs
      Note: probe behind F1 and F2
    - Path: repo://ttmp/2026/11/26/IRWB-020-P--tix-stage-1-the-index-notation-language-its-ir-on-the-v6-framework-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/03-probe-tolerance-rules.mjs
      Note: measurement behind the tolerance rule
ExternalSources: []
Summary: 'Design of the tensor domain''s first stage: Tix front end, a loop-nest IR as a v6 artifact, one evaluator in three arithmetics, a meaning contract with an exact and a running-error-bound relation, inline and split-sum, and two framework changes.'
LastUpdated: 2026-11-26T13:08:36.3090965-05:00
WhatFor: ""
WhenToUse: ""
---

# Tix stage 1 design: language, IR, evaluators, meaning contract, inline and split-sum

## 1. Summary

Stage 1 adds a second domain, `src/tensor/`, on the v6 framework: the Tix language, an IR for it, evaluators, a
meaning contract and two checked passes. This document is the design, revised after review (section 17 lists what
the review changed).

The stage is built from these parts:

| Part | Choice |
| --- | --- |
| Front end | A hand-written parser and a checker that infers every index extent symbolically and proves affine subscripts in bounds. |
| IR | Per function, an ordered list of statements. A statement is a loop nest: named indices with explicit extents, and an expression tree in which a reduction is an inner loop nest. One v6 artifact per program. |
| Evaluators | One tree evaluator, run in three arithmetics: f32 (the meaning), f64 (the reference) and f64 with a running error bound (used only by the tolerance relation). |
| Contract | A sampled differential check over generated shapes and values. Two relations: `exact` (bit-identical f32 against the pass's input) and `tolerance` (f32 within twice the candidate's running error bound of the origin's f64 result). |
| Passes | `inline` (declares `exact`), `split-sum` (declares `tolerance`), and a deliberately wrong variant of each. |

Two changes to `src/framework/` are proposed (section 9). Both were found by a probe that ran the existing
framework against a toy second domain:

- **F1.** `applyPassSync`: apply a pass and gate it without a Promise. The fixed API's `optimizeTix` returns its
  result directly, and `applyPass` is asynchronous end to end.
- **F2.** `applyPass` opens its graph edit only when the pass asks for it. Today it opens one for every pass, so
  every domain must write a `rebuild` (graph to native value), including domains whose passes return native values.

## 2. Supported domain

Behaviour is specified only inside this domain.

- **Source.** A Tix program in the fixed core grammar, with the resolutions of section 3. Anything else is a check
  error whose message starts with `line:col:`.
- **Calls.** `runTix` is called with one input per parameter, row-major, of the parameter's rank, with shapes that
  bind each shape name consistently and make every extent in the function at least 1 and less than 2^24. Input
  values are finite.
- **Passes.** `inline` and `split-sum` apply to IR produced by `compileTix` and by each other. Each pass states
  which statements it rewrites (section 7) and leaves the rest unchanged.
- **Contract.** The check domain is extents 1 to 8 and values in [-4, 4) (section 6.1). A verdict says nothing
  about larger shapes or other values.

## 3. Tix front end

Files: `src/tensor/syntax.ts` (tokens, parser, AST with positions) and `src/tensor/check.ts` (checker, lowering to
the IR). Errors are `Error` with the message `line:col: text`, 1-based.

The fixed core leaves these points open. Each is resolved the simplest way I found:

1. **`NUMBER`** is `digits [. digits] [e|E [+|-] digits]`.
2. **Names.** In one function, shape names, tensor names and index names are disjoint sets. A shape name is a name
   that occurs in a parameter's dims. A bare name in expression position must be a shape name.
3. **`max(` and `min(`.** `max(N, D)` (a call on two shape values) and `max(i, j) x[i, j]` (a reduction) start the
   same way. If the parenthesised list is two or more bare names that are all shape names, or is not a list of
   bare names, it is a call. Otherwise it is a reduction. `sum(` always starts a reduction. This works because of
   rule 2. The simplest alternative, deciding by the token after `)`, fails on `max(N, D) - 1`.
4. **Binding shape names.** Each shape name must occur as a whole dim (`N`, not `N + 1`) of some parameter. That
   occurrence binds it at a call. Other dims are evaluated and compared. A shape name with no such occurrence is a
   check error. The alternative, solving affine equations at the call, is not needed by any corpus program.
5. **No shadowing.** A reduction index may not reuse a name bound by the statement or an enclosing reduction.
   Sibling reductions may reuse a name.
6. **Extent inference.** An index has a *plain* use where it is a whole subscript (`x[i, j]`), and an *affine* use
   elsewhere (`x[i + dy]`). The extent of an index is the dim at its plain uses, which must all be equal as affine
   forms. A left-hand index may also take its extent from the statement's declared type, which must agree with the
   plain uses when both exist. An index with neither is a check error.
7. **Bounds of affine subscripts.** For a subscript `a` into a dim `d`, the checker computes the largest and
   smallest value of `a` over the index extents (substitute `extent - 1` or 0 by the sign of each coefficient).
   Both are affine in the shape names. It accepts when `d - 1 - max(a)` and `min(a)` are affine forms with
   non-negative coefficients and a non-negative value at all shape names equal to 1. That is sufficient for every
   binding with shape names at least 1. Otherwise it reports `subscript may be out of bounds`. The rule accepts
   conv2d (`y` in `H - KH + 1`, `dy` in `KH`, into `H`: slack 0). It rejects programs that are in bounds only
   because of a relation between shape names; none is in the corpus.
8. **Result.** `return NAME` names any tensor of the function. Its dims must equal the declared result type.
9. **Single assignment.** A statement's name must be new in its function (not a parameter, not an earlier
   statement). A reference must name a parameter or an earlier statement, with as many subscripts as its rank.
10. Functions do not call each other (the grammar has no such call), so a program is a set of independent functions.

## 4. The IR

File: `src/tensor/ir.ts`. The IR is the checked program with every inferred fact made explicit, so that no pass and
no evaluator repeats inference.

```ts
interface TixIR { readonly fns: Readonly<Record<string, Fn>> }
interface Fn {
  readonly name: string;
  readonly shapes: readonly string[];          // shape names, sorted
  readonly params: readonly Param[];
  readonly stmts: readonly Stmt[];             // in source order; a statement reads only parameters and earlier statements
  readonly result: string;                     // tensor name
}
interface Param { readonly name: string; readonly dims: readonly Aff[] }
interface Stmt  { readonly name: string; readonly indices: readonly Index[]; readonly expr: Expr }
interface Index { readonly name: string; readonly extent: Extent }

/** c + sum of coef * name. In dims: shape names. In subscripts: index names. In extents: both. */
interface Aff { readonly c: number; readonly terms: Readonly<Record<string, number>> }
type Extent =
  | { readonly k: 'aff'; readonly aff: Aff }
  | { readonly k: 'min'; readonly a: Extent; readonly b: Extent }
  | { readonly k: 'ceildiv'; readonly a: Extent; readonly by: number };

type Expr =
  | { readonly k: 'lit'; readonly value: number }                       // finite, non-negative
  | { readonly k: 'shape'; readonly name: string }
  | { readonly k: 'ref'; readonly tensor: string; readonly at: readonly Aff[] }
  | { readonly k: 'neg'; readonly a: Expr }
  | { readonly k: 'bin'; readonly op: '+' | '-' | '*' | '/'; readonly a: Expr; readonly b: Expr }
  | { readonly k: 'call'; readonly fn: 'exp' | 'log' | 'sqrt' | 'tanh' | 'max' | 'min'; readonly args: readonly Expr[] }
  | { readonly k: 'reduce'; readonly op: 'sum' | 'max'; readonly indices: readonly Index[]; readonly body: Expr };
```

- A statement is a perfect loop nest over `indices`. Its tensor's shape is the extents of those indices.
- A reduction is an inner loop nest with one accumulator. Its `indices` are in loop order, first outermost.
- The checker produces only `aff` extents over shape names. `min` and `ceildiv`, and extents that mention an
  enclosing reduction index, exist for `split-sum` (section 7.2): a blocked loop needs `ceil(N / B)` blocks and
  `min(B, N - B*jb)` iterations in the last one, and the fixed surface grammar cannot write either.
- Index names are unique within a statement along every path from the statement to a leaf.

**Validation** (`validate`, used by the IR type and the adapter) is structural: names resolve, ranks match, each
extent mentions only shape names and indices bound outside it, literals are finite. It does not re-prove subscript
bounds. After `split-sum` that proof would need reasoning about `min`. The evaluator checks every subscript against
its dim instead, and a failed check is an outcome the contract compares (section 6.2).

**Projection for the framework** (the adapter `adapter.tensor-tix`):

| Entity kind | Id | Attributes |
| --- | --- | --- |
| `fn` | `fn:<fn>` | shape names, result tensor |
| `param` | `param:<fn>/<name>` | dims |
| `stmt` | `stmt:<fn>/<name>` | indices, expr (the whole tree, as data) |

| Relation | Category | From, to |
| --- | --- | --- |
| `declares` | containment | fn to its params and statements, ordered |
| `reads` | dependency | a statement to each tensor it references, one relation per reference occurrence |
| `returns` | binding | fn to its result tensor |

The adapter has `entities`, `resolve`, `relations`, `roots`, `describe`, `validate`, `serialize` and `deserialize`.
It has no `rebuild` (see F2).

## 5. Evaluators

File: `src/tensor/evaluate.ts`. One evaluator walks a function's statements in order and materialises each tensor.
It takes an *arithmetic*: how to make a literal, a shape value and an input element, and how to apply each
operation. There are three:

| Arithmetic | A value is | An operation is |
| --- | --- | --- |
| `f32` | a double that is an f32 | the JavaScript double result, then `Math.fround` |
| `f64` | a double | the JavaScript double result |
| `bound` | a pair (v, e) | v as in `f64`; e by the rules of section 6.3 |

Reductions follow the fixed meaning in all three: `sum` starts at 0, `max` at negative infinity, and both
accumulate in increasing lexicographic order of the indices, applying the arithmetic's `+` or `max` at each step.
`max` and `min` are `Math.max` and `Math.min`. A subscript outside its dim throws `TixTrap`.

`runTix` uses `f32` or `f64` by `options.precision` (default `f32`) and returns `Float32Array` or `Float64Array`
data. `bound` is exported from `evaluate.ts` as `runBound` for the contract and its tests.

## 6. The meaning contract

File: `src/tensor/contract.ts`. The contract is a v6 differential check (`contracts/differential.ts`). The
framework needs no change for it: `run(side, ...)` receives the side, so the reference side can run in f64 while
the candidate side runs in f32.

### 6.1 Domain

A case is `(function, shape binding, inputs)`. Cases are generated from the **origin** program (the program
`compileTix` returned), `count` per function (default 16), from a seed (default 7):

- each shape name is drawn uniformly from 1 to 8;
- the binding is redrawn (up to 64 times) if an extent of the origin function is below 1, or if the function's loop
  work, the sum over statements of the product of its extents, exceeds 2^18;
- each input element is uniform in [-4, 4), rounded to f32.

A case is the record `{ fn, n, shapes, seed }`: the function, the case number, the shape binding and the seed its
input values are generated from. It is plain JSON, and it is also what `describeCase` returns. Evidence on the
manager path passes through the framework's `immutable`, which refuses typed arrays and non-finite numbers, so a
case never holds input data, and a counterexample's reason is a string.

There is one domain. `optimizeTix` cannot pass any other, so no test checks another. A consequence: layernorm's
`eps` is drawn from [-4, 4) like every input, so the cases where `variance + eps` is negative have a NaN reference
and are inconclusive (rule 1 of section 6.3). They are counted as such and the remaining cases decide.

Extents up to 8 are enough for the two passes: with block size 4, an extent of 6 or more reassociates a sum, and an
extent that is not a multiple of 4 has a partial last block.

### 6.2 Observation

The observation of a run is the function's result: its shape and elements, or `trap` when the evaluator throws
(`TixTrap`, or a function or parameter that no longer exists). Intermediate tensors are not observed.

### 6.3 Relations

**`exact`.** The reference is the pass's **input** revision, run in f32. The candidate, run in f32, must have the
same shape and bit-identical elements (`Object.is` per element). A candidate trap disagrees.

**`tolerance`.** The reference is the **origin**, run in f64, giving r. The candidate is run in f32, giving c, and
in `bound`, giving e. Per case:

1. an element of r is not finite: the case is inconclusive;
2. the candidate traps, has another shape, or an element of c is not finite: disagree;
3. an element of e is not finite: inconclusive;
4. agree if `|c[i] - r[i]| <= 2 * e[i]` for every i, else disagree.

The framework already counts inconclusive cases and fails a check in which no case was decided.

The two relations bind different references on purpose. `exact` is transitive, so comparing with the input is the
same claim as "this step changed no bit", and it stays usable after a `tolerance` step has been accepted.
`tolerance` is not transitive, so each step is compared with the origin's reference and error does not accumulate
across steps unnoticed.

**The bound.** e is a first-order running error bound of the candidate's own f32 evaluation, with u = 2^-24. For a
rounded operation with f64 result v and propagated operand error p, `e = p + u * (|v| + p)`:

| Value | p, or e directly |
| --- | --- |
| input element, shape value | e = 0 |
| literal | e = u * \|v\| |
| a + b, a - b | p = ea + eb |
| a * b | p = \|a\| eb + \|b\| ea + ea eb |
| a / b | d = \|b\| - eb; e is infinite if d <= 0; else p = (ea + \|v\| eb) / d |
| -a | e = ea |
| exp(a) | p = \|v\| * expm1(ea) |
| log(a) | e is infinite if a - ea <= 0; else p = -log1p(-ea / a) |
| sqrt(a) | p = 0 if ea = 0; e is infinite if a - ea < 0; else p = v - sqrt(a - ea) |
| tanh(a) | p = ea |
| max(a, b), min(a, b) | e = max(ea, eb) |
| sum, max reductions | the `+` or `max` rule at each accumulation step |

**Why this tolerance.** The simplest rule that would serve is a fixed relative tolerance,
`max|c - r| <= tau * max|r|`. I measured both rules on hand-written kernels over the check domain
(`scripts/03-probe-tolerance-rules.mjs`, 200,000 cases per kernel, correct programs being the sequential sum and the
split sum, the wrong program dropping the partial last block):

| Kernel | Fixed, tau = 1e-4: rejects correct / accepts wrong | Fixed, tau = 1e-3 | Bound, factor 2 | Largest \|c - r\| / e, correct programs |
| --- | --- | --- | --- | --- |
| matvec | 0.001% / 0.003% | 0.000% / 0.032% | 0.000% / 0.000% | 0.887 |
| softmax | 0.000% / 0.000% | 0.000% / 0.896% | 0.000% / 0.000% | 0.754 |
| layernorm | 0.001% / 0.000% | 0.000% / 0.009% | 0.000% / 0.000% | 0.941 |
| covariance (mean of products minus product of means) | 0.074% / 0.007% | 0.009% / 0.075% | 0.000% / 0.001% | 0.578 |

The fixed rule falls short because the error of a correct f32 evaluation depends on the conditioning of the case,
not on the size of the result. The first probe (`scripts/02-probe-tolerance.mjs`) found correct evaluations with
relative error up to 9.9e-3 (covariance) and wrong ones with error down to 1.6e-6, so no tau separates them. A check
that must accept *every* case then rejects correct passes at a rate that grows with the case count and with how
much the program cancels. The bound rule scales with each case's conditioning. It never rejected a correct program
in about 1.6 million evaluations, and the correct programs came within 0.941 of the bound, so it is not loose either.

The factor 2 covers what the first-order bound leaves out: second-order terms, the error of the f64 reference, and
`Math.exp`, `Math.log` and `Math.tanh` not being correctly rounded in double. With factor 1 no correct
program was rejected either; 2 is the margin.

Limits of the rule, stated so a reader does not take it for a proof: it is a first-order estimate computed with f64
magnitudes; and it is computed on the candidate, so a wrong pass that also makes its program ill-conditioned widens
its own allowance.

### 6.4 The contract as framework definitions

- `meaningSpec(relation, { count, seed })`: a `DifferentialSpec` with ports `origin` (cases are generated from
  it), `reference` and `candidate`, with `baselineKey` set to the origin's and the reference's revisions so the
  cases and the reference's outcomes are computed once.
- `tensorContract(relation, { count, seed })`: a `TransformationDefinition` with inputs `{ input, origin }`, output
  `{ output }` and one `ensures` clause on `differential(meaningSpec(...))`, binding `reference` to `input` for
  `exact` and to `origin` for `tolerance`. This is the contract `applyPass` takes, as Typed's
  `optimizationContract` is.
- `checkMeaning(relation, { origin, input, output }, { count, seed })`: the same spec through `runDifferential`,
  returning a `CheckResult` without a Promise. `optimizeTix` uses it through F1.

**One object per parameter set.** The three factories share one cache keyed by `(relation, count, seed)` and return
the same spec, invariant and contract objects for the same key, as Typed's `meaningKept` does. The id is
`tensor.meaning-<relation>` and the version carries `count` and `seed`. `ContractRegistry.register` refuses a second
object under one id and version, and `applyPass` reports any throw from `verifyTransformation` as
`contractRejected`, so a fresh object per call would be a false rejection.

## 7. Passes

File: `src/tensor/passes.ts`. Each pass is a `definePass` over the Tix IR that returns a native value, declares
`writes: { entities: ['stmt'], relations: ['reads', 'declares'] }`, and carries the relation it claims.

### 7.1 `inline` (claims `exact`)

A statement D is inlined when its expression contains no reduction, it is not the function's result, and exactly
one reference to it exists in the function. The reference `D[a1, ..., an]` is replaced by D's expression with D's
k-th index replaced by `ak` in every subscript (affine forms compose), and D is removed. The pass repeats until no
statement qualifies. Correspondence: D and its consumer merge into the consumer.

It is bit-identical because the f32 meaning rounds every operation separately and an inlined expression performs the
same operations on the same values.

**The wrong inline** (`WRONG_PASSES.inline`, exported from `src/tensor/passes.ts`, not in the public pass table) binds D's indices to the subscripts in reverse order. For rank 2 and above it reads the wrong
elements (or traps, on a non-square shape). For rank 1 it is the correct pass, so the demonstration uses a rank-2
statement.

### 7.2 `split-sum` (claims `tolerance`)

Every `sum` reduction with exactly one index `j`, whose extent E is an `aff` over shape names, becomes

```
sum(jb) sum(ji) body[j := 4*jb + ji]      jb in ceildiv(E, 4),  ji in min(4, E - 4*jb)
```

with fresh names for `jb` and `ji`. The block size 4 is the pass's parameter default. Sums over several indices
(conv2d's) and sums already split are left unchanged.

**The wrong split-sum** (`WRONG_PASSES.splitSum`) uses `floor(E / 4)` blocks, written as `ceildiv(E - 3, 4)`, with `ji` in 4. It drops the
partial last block.

### 7.3 Expected verdicts

| Pass | Under `exact` | Under `tolerance` |
| --- | --- | --- |
| `inline` | accepted | accepted |
| `split-sum` | **rejected** | accepted |
| wrong inline | rejected | rejected |
| wrong split-sum | rejected | rejected |

The tests assert this table on the corpus and on small programs written for it, through `applyPassSync` with
`checkMeaning` under the relation the row names. The public API checks a pass only under the relation it claims.

## 8. API

File: `src/tensor/index.ts`. The fixed three functions, with these additions that the brief leaves open:

```ts
interface TixProgram { readonly origin: Artifact<TixIR>; readonly current: Artifact<TixIR> }

optimizeTix(program, passes): {
  program: TixProgram;
  steps: { pass: string; accepted: boolean; changed: boolean; relation: 'exact' | 'tolerance'; reason?: string }[]
}
```

- `compileTix` returns `origin === current`. `optimizeTix` keeps `origin` and advances `current`.
- Each pass is checked under the relation it claims (`inline`: `exact`; `split-sum`: `tolerance`), over the one
  check domain with its default count and seed. There is no option to choose another relation or domain.
- A rejected pass leaves `current` as it was and the remaining passes still run, as in Typed's `runPipeline`.
- A pass that changes nothing is `accepted: true, changed: false`.
- The public pass names are `inline` and `split-sum`. Another name throws.

## 9. Framework changes (the primary result)

Both come from `scripts/01-probe-framework-fit.mjs`, which defines a toy second domain (an adapter without
`rebuild`, a native-result pass, a contract with an `origin` port and a differential invariant) and runs it against
the built framework. Its output:

```
0 adapter without rebuild, native-result pass: ir.capability - Adapter adapter.probe-toy is not Rewritable
1 applyPass returns a Promise: true
2 native result, origin port: changed = true entities changed = 2
3 wrong pass rejected with code contractRejected
4 runDifferential is synchronous: true agree 3/3
5 invariant.check without a manager context is synchronous: true true
6 a non-finite number in an artifact value is refused: IR data must contain only finite numbers
7 -0 kept as -0: false
```

### F1. `applyPassSync` in `src/framework/passes/define-pass.ts`

**Reason.** The fixed API's `optimizeTix` returns `{ program, steps }`, not a Promise. `applyPass` is `async`
because the analysis manager is, even when the pass, the differential check and every callback are synchronous
(lines 4 and 5 of the probe). Typed never met this: its pipeline runner is itself asynchronous.

**Change.**

```ts
applyPassSync<S, P>(pass: Pass<S, {}, P>, before: Artifact<S>, options: {
  params?: P; outputId?: string;
  check: (io: { input: Artifact<S>; output: Artifact<S>; correspondence: EntityCorrespondence }) => CheckResult;
}): PassResult<S>
```

Its domain is a pass with no `needs` and no `preserves` whose `run` returns a native result synchronously. The part
of `applyPass` between the pass's return and the contract gate (create the output artifact, diff the two
projections, build the correspondence, detect "nothing changed", enforce `writes`) moves into one internal function
that both `applyPass` and `applyPassSync` call. A `check` that returns `ok: false` throws
`PassError('contractRejected')`, as a rejected contract does in `applyPass`. `applyPass` keeps its behaviour.

`check` is required: a step without it would be unchecked. There is no `store` option: with a native result and a
caller's store, opening the output in that store throws `ir.unpublished`, because the store already holds a head for
the same artifact id. Each application opens its views in fresh stores.

**What it does not do.** It writes no record in an analysis manager: there are no facts, no evidence history and no
reuse across calls. The manager path stays available for the same pass and the same spec (`applyPass` with
`tensorContract`), and one test asserts that both paths give the same verdicts.

**Simplest alternative.** No framework change: `optimizeTix` calls `pass.run` and `runDifferential` itself. It
falls short because the tensor domain would then re-implement the diff, the correspondence and the `writes`
enforcement, which are what `definePass` is for. A larger alternative, a synchronous mode of the analysis manager
that evaluates a `TransformationDefinition` and records it, would touch the 1,600-line manager for the same
verdict.

### F2. `applyPass` opens its edit on first use

**Reason.** `applyPass` calls `view.beginEdit()` before running any pass, and `beginEdit` refuses an adapter without
`rebuild` (line 0 of the probe). So a domain whose passes all return native values must still write the translation
from the logical graph back to its native value. For Tix that is rebuilding expression trees from attributes, about
a hundred lines that nothing in this stage would call.

**Change.** `PassRunContext.edit` becomes a getter that opens the edit when a pass first reads it. A pass that
returns a native result never opens one. A pass that returns nothing without having read `edit` made no change.
Typed's passes all run with a rewritable adapter, so they see the same behaviour, one unused draft fewer per
application.

**Simplest alternative.** Give the Tix adapter a `rebuild` that returns its base unchanged, as the probe does to get
past line 0. It falls short because it declares a capability (`Rewritable`) the adapter does not have, and a later
graph edit would silently do nothing.

### Findings that need no change

- The differential check carries the tolerance relation as it is (section 6).
- Artifact values refuse non-finite numbers and store -0 as 0 (lines 6 and 7). Tix literals are finite and
  non-negative, and negation is an operation, so the IR never holds either.
- A contract with an extra `origin` port works for a new domain through `contractInputs` (lines 2 and 3).

## 10. Corpus

`corpus/tensor/<name>/main.tix`, one function each:

| Name | Notes |
| --- | --- |
| `matmul` | `c[i, j] = sum(k) a[i, k] * b[k, j]` |
| `softmax` | the brief's example (max-shifted) |
| `layernorm` | `x: f32[N, D]`, `gamma, beta: f32[D]`, `eps: f32[1]` read as `eps[0]`; mean, centred values, variance, scale and shift |
| `attention` | single head: `q, k: f32[T, D]`, `v: f32[T, E]`; scores scaled by `sqrt(D)`, max-shifted softmax per row, weighted sum of `v` |
| `mlp` | linear, tanh-GELU (`0.5 * h * (1 + tanh(0.7978845608 * (h + 0.044715 * h * h * h)))`), linear |
| `conv2d` | `x: f32[N, C, H, W]`, `w: f32[O, C, KH, KW]`, result `f32[N, O, H - KH + 1, W - KW + 1]`, declared type on the statement |

## 11. Tests

In `tests/tensor/`, where the risk is:

| File | What it pins |
| --- | --- |
| `syntax-check.test.mjs` | precedence and associativity; the reduction body rule (`sum(d) x[i, d] / D` against `(sum(d) x[i, d]) / D`); the `max(` rule; each check error of section 3 with its `line:col` |
| `evaluate.test.mjs` | f32 results bit-identical to hand-written `Math.fround` loops for matmul, softmax and conv2d; accumulation order with two reduction indices; f64 differs from f32 where it should; a trap on a bad subscript in hand-built IR |
| `contract.test.mjs` | the bound holds for the corpus (origin f32 within the bound of origin f64); case generation is deterministic and respects the redraw rules; inconclusive and trap outcomes |
| `passes.test.mjs` | the table of section 7.3 on the corpus and on small programs; `inline` with affine subscripts; `split-sum` at extents 1, 3, 4, 5, 8; the synchronous path and `applyPass` with `tensorContract` agree, including twice in one manager; a rejection on the manager path carries the meaning check's reason; a program optimized by `optimizeTix` runs in `runTix` |
| `tests/framework/pass-sync.test.mjs` | F1 and F2 on a toy domain: accepted, rejected, undeclared write, no `rebuild` |

After the implementation: `node --test tests/framework/`, and from `tests/typed/` the tests that apply passes
(they cover `applyPass`, which F1 and F2 touch).

## 12. Decisions and their simplest alternatives

| Decision | Simplest alternative | Why not |
| --- | --- | --- |
| IR is statements as loop nests with expression trees | Keep the AST and re-infer extents where needed | Every evaluator and pass would repeat inference, and `split-sum` needs extents the surface grammar cannot write |
| Statements are entities, expressions are attribute data | Every expression node an entity | Both passes work on whole statements; nothing in this stage matches patterns inside expressions |
| Extents may be `min` and `ceildiv` and mention an outer index | Full blocks plus a separate remainder sum, using floor division and modulo | Same count of new extent forms, a second reduction per split, and an extra `+ 0` when there is no remainder |
| One evaluator in three arithmetics | Two or three separately written evaluators | The accumulation order is the meaning; one copy of it cannot disagree with itself |
| Subscript bounds: proved by the checker, checked at run time by the evaluator | Prove them again in IR validation | Needs reasoning about `min` after `split-sum`; the run-time check also turns a wrong pass's bad read into an outcome the contract rejects |
| Tolerance is a running error bound | Fixed relative tolerance | Section 6.3: measured to reject correct programs and to have no separating value |
| `exact` compares with the input, `tolerance` with the origin | Both compare with the origin | `inline` after an accepted `split-sum` would be rejected under `exact` |
| Wrong variants are a separate export, applied in tests through `applyPassSync` | Named passes in the public table | Review: a deliberately wrong pass does not belong in the public table |
| F1 and F2 | Sections 9, each | |

## 13. Left out

- A printer from IR back to Tix-like text. Tests compare IR values and results.
- Special values in the check domain (zeros, equal elements, large magnitudes). Uniform values exercise both
  passes; adding classes is a domain change, not a design change.
- `split-sum` on sums over several indices, and a block-size argument through `optimizeTix` (the fixed API passes
  names only).
- Manager records for `optimizeTix` (see F1).
- Choosing the relation, the case count or the value ranges through the public API (review, section 17).
- A workbench view, strategies and dataflow analyses for the tensor domain. Nothing in this stage uses
  `framework/strategy` or `framework/dataflow`.

## 14. Later

- Lowering to CUDA, fusion, tiling of contractions, attention-specific rewrites (other stages).
- Expression nodes as entities, when a pass wants the framework's patterns inside expressions.
- A margin in `DifferentialEvidence` (how close the worst case came to the tolerance); today it holds counts and
  counterexample reasons only.
- A synchronous mode of the analysis manager, if a second synchronous host appears.

## 15. Implementation plan

1. F2, then F1, with `tests/framework/pass-sync.test.mjs`; run `tests/framework/` and the Typed pass tests.
2. `syntax.ts`, `check.ts`, `ir.ts` and the corpus; `syntax-check.test.mjs`.
3. `evaluate.ts` (three arithmetics); `evaluate.test.mjs`.
4. `contract.ts`; `contract.test.mjs`.
5. `passes.ts`, `index.ts`; `passes.test.mjs`.

Each step is a commit and a diary step.

## 16. Open questions

None. The two questions of the first version were answered by the review (section 17).

## 17. Revision after review

| Review item | Outcome |
| --- | --- |
| Must 1: definition identity on the manager path | Accepted. Section 6.4: one cached spec, invariant and contract per `(relation, count, seed)`. A test applies two passes through one manager. |
| Must 2: case encoding in evidence | Accepted. Section 6.1: a case is `{ fn, n, shapes, seed }` and is its own `describeCase`; input values are regenerated from the seed. |
| Cut 1: `optimizeTix` options | Accepted. Section 8: no options. The verdict table is shown through `applyPassSync` with `checkMeaning`. |
| Cut 2: wrong variants in the public table | Accepted. Section 7: `WRONG_PASSES` is a separate export of `passes.ts`. |
| Cut 3: per-parameter value range | Accepted. Section 6.1 states the consequence for layernorm's `eps`. |
| F1: drop `store?`, make `check` required | Accepted. Section 9. |

One addition the review did not ask for: the differential spec has a third port, `origin`, next to `reference` and
`candidate`. Cases must come from the origin under both relations, and under `exact` the reference is the pass's
input, whose extents after a `split-sum` are no longer plain affine forms.

## 18. As built

The implementation follows this document. The differences:

| Design | As built | Reason |
| --- | --- | --- |
| `inline` counts single uses as incoming `reads` relations on the view | It counts references in the native statements | The pass inlines to a fixed point, and the view describes only the first round |
| A plain use is a whole subscript | A subscript whose affine form is one index (`j + 0` counts) | The checker decides on the normalised form |
| Tests listed four files | Also `tests/tensor/helpers.mjs` (corpus loading, test data) | Shared by the four |
| attention divides by a statement holding `sqrt(D)` | The scale is written inline, `/ sqrt(D)` | A statement needs an index; a scalar has none |
| An error position is the node's | For a subscript it is where the subscript starts | A binary node's own position is its operator |

Measured on the built evaluators (`tests/tensor/contract.test.mjs`, 48 cases per program, f32 against f64 of the
same program): the largest error as a share of the bound is 0.073 (attention), 0.701 (conv2d), 0.568 (layernorm),
0.568 (matmul), 0.464 (mlp), 0.462 (softmax). No case exceeded its bound. 19 of layernorm's 48 cases are
inconclusive, as section 6.1 predicts for `eps`.

Verdicts on the corpus (`tests/tensor/passes.test.mjs`): the table of section 7.3 holds wherever a pass changes the
program. conv2d is changed by no pass (its sum has three indices and it has no pointwise statement). On layernorm
the wrong inline is the correct pass, because the statement it inlines has rank 1.

## References

- `src/framework/passes/define-pass.ts`, `src/framework/contracts/differential.ts`, `src/framework/ir/README.md`
- `src/typed/passes.ts` (`optimizationContract`), `src/typed/project.ts` (`runPipeline`), `src/typed/evaluate.ts`
  (`meaningKept`)
- `scripts/01-probe-framework-fit.mjs`, `scripts/02-probe-tolerance.mjs`, `scripts/03-probe-tolerance-rules.mjs`
  in this ticket
- N. J. Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed., chapters 3 and 4 (running error bounds,
  summation)
