---
Title: 'Tix stage 1: language, IR, evaluators, meaning contract, inline and split-sum'
Ticket: IRWB-020-O
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
      Note: differential and runDifferential, which the meaning contract is built on
    - Path: repo://src/framework/ir/transactions.ts
      Note: IREdit constructor, where beginEdit requires rebuild (F2)
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass; target of the proposed changes F1 (applyPassSync) and F2 (edit only for rewritable adapters)
    - Path: repo://src/typed/passes.ts
      Note: How Typed defines passes and its optimization contract; the pattern followed
    - Path: repo://ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/01-framework-probes.mjs
      Note: Framework probes A to F quoted in section 11
    - Path: repo://ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/02-tolerance-probe.mjs
      Note: Tolerance measurement quoted in section 6
ExternalSources: []
Summary: 'Design for the first tensor stage on the v6 framework: the Tix front end, the tensor.tix IR and its artifact, f32 and f64 evaluators, a meaning contract with an exact and a tolerance relation, the passes inline and split-sum, and two proposed changes to src/framework/passes.'
LastUpdated: 2026-11-26T13:13:47.524427933-05:00
WhatFor: Review before implementation; afterwards the reference for what src/tensor does and why the framework changed.
WhenToUse: When reviewing or implementing IRWB-020-O, or when a later tensor stage needs the IR, the contract or the framework changes explained.
---

# Tix stage 1: language, IR, evaluators, meaning contract, inline and split-sum

## Executive Summary

Stage 1 puts a second domain on the v6 framework: Tix, a small index-notation tensor language. This document
designs its front end, its IR as a v6 artifact, an f32 and an f64 evaluator, a meaning contract with an exact and
a tolerance relation, and two checked passes, `inline` and `split-sum`. Nothing is implemented yet. The design
rests on two probe scripts whose results are quoted where they matter (section 11).

What to look at first:

- **Two framework changes are proposed, both in `src/framework/passes/define-pass.ts`** (section 2).
  `applyPassSync`: the fixed `optimizeTix` returns its result directly, and the framework can apply a checked pass
  only asynchronously. And the pass's `IREdit` is opened only for rewritable adapters: today a pass that returns a
  native value still needs an adapter with `rebuild`.
- The rest of the framework fits as it is: IR definition, adapter, artifacts, diff, declared writes,
  correspondence, and the differential checker, which already lets the two sides of a check run at different
  precisions.
- The IR is the checked program: per function, an ordered list of single-assignment tensor statements with every
  index extent explicit. A two-level sum is a `block` field on the reduction.
- The exact relation compares f32 bits against the pass's input. The tolerance relation compares the f32 result
  against the f64 result of the original program, within 2^-12 of the largest magnitude in the case. In the
  probe, correct results stay within 285 roundoff units of the reference; the tolerance is 4096.

## Problem Statement

The framework in `src/framework/` has carried one domain, Typed. This stage starts tensor programs on it to find
where it does not fit. The brief fixes the Tix core grammar, its f32 meaning, the API (`compileTix`, `runTix`,
`optimizeTix`), the two passes, and the list of corpus programs. Mine to design: the checks, the IR's form, the
evaluators, the contract (domain, observation, relation, tolerance), how the passes work on the IR, the tests,
and any framework change.

### Supported input domain

Behaviour is specified only for the following.

- `compileTix(source)`: `source` is a string. A valid program follows the grammar of the brief and the check
  rules of section 3. An invalid one throws an `Error` whose message starts with `line:col:` (both 1-based).
- `runTix(program, fn, inputs, options)`: `program` came from `compileTix` or `optimizeTix`; `fn` names one of its
  functions; `inputs` has one entry per parameter, whose `shape` has the parameter's rank and positive integer
  dimensions that bind the function's shape names consistently and make every tensor dimension of the function at
  least 1; `data` is a `Float32Array` or a `Float64Array` (either one, for either precision), row-major, with as
  many elements as the shape has, all finite.
- `optimizeTix(program, passes)`: `passes` is a list of `'inline'` and `'split-sum'`, in any order, with repeats.
- The contract's verdicts are specified for functions whose f64 output is finite on the generated cases
  (section 6). The six corpus programs are.

## Proposed Solution

### 1. Layout

```
src/tensor/syntax.ts     lexer and parser: source -> unchecked functions, positions in a side table
src/tensor/check.ts      affine forms, extent inference (front end), the checker (front end and IR validator)
src/tensor/ir.ts         TixIR types, TixIRType (defineIR), tixAdapter (defineAdapter), expression helpers
src/tensor/evaluate.ts   shape binding and the interpreter, with a rounding function as parameter
src/tensor/contract.ts   tensorMeaning (differential invariant), tensorContract, cases, comparison
src/tensor/passes.ts     inline, splitSum (definePass), the PASSES table, applyChecked
src/tensor/wrong.ts      the two deliberately wrong passes, for tests
src/tensor/index.ts      compileTix, runTix, optimizeTix
corpus/tensor/<name>/main.tix          matmul, softmax, layernorm, attention, mlp, conv2d
tests/tensor/*.test.mjs, tests/framework/pass-sync.test.mjs
```

### 2. Framework: findings and proposed changes

This is the primary result of the stage. Findings F1 and F2 lead to changes; F3 and F4 do not. Probe letters
refer to `scripts/01-framework-probes.mjs` (section 11).

**F1. A checked pass can only be applied asynchronously. Change: add `applyPassSync`.**
`applyPass` returns a Promise (probe B1), because its contract gate is `AnalysisManager.verifyTransformation`
and the manager is asynchronous throughout. The fixed API says `optimizeTix(...)` returns
`{ program, steps }`, and JavaScript cannot wait for a Promise inside a synchronous function. Everything
`applyPass` does before the gate is already synchronous and needs no manager (probe F), and
`runDifferential` checks a differential invariant synchronously without a manager (probe C).

Proposed, in `src/framework/passes/define-pass.ts`:

```ts
export interface PassCandidate<S> {
  readonly before: Artifact<S>;
  readonly after: Artifact<S>;
  readonly changes: ChangeSet;
  readonly correspondence: EntityCorrespondence;
}
export interface SyncApplyOptions<S, P> {
  readonly store?: IRStore;
  readonly params?: P;
  readonly outputId?: string;
  /** The gate: called once for a changed output, after the declared-writes check. `ok: false` rejects it. */
  readonly check?: (candidate: PassCandidate<S>) => CheckResult;
}
/** `applyPass` for hosts whose own API is synchronous: no manager, nothing awaited. */
export function applyPassSync<S, P>(pass: Pass<S, {}, P>, before: Artifact<S>,
                                    options?: SyncApplyOptions<S, P>): PassResult<S>;
```

- Its domain: passes with no `needs`, no `preserves` and no `contract` of their own (all three need the manager),
  whose `run` returns a native result or uses the edit, synchronously. Outside it, it throws
  `PassError('badResult')`.
- It runs the pass, builds the output artifact, diffs the projections, builds the correspondence and rejects
  undeclared writes exactly as `applyPass` does: that part of `applyPass` moves into one internal function both
  call. Then it calls `check`; `ok: false` throws `PassError('contractRejected')` carrying the result as
  evidence. The returned `PassResult.contract` is the `CheckResult`.
- `applyPass` keeps its signature and behaviour.
- Simplest alternative: `optimizeTix` does not use `applyPass` and repeats those steps in `src/tensor`. That
  duplicates framework logic in the domain to get around a gap in the framework, and the next synchronous host
  would do it again. Larger alternative: a synchronous `verifyTransformation` in the manager. Its contexts,
  analyses and invariants all return Promises, so the change reaches through most of its 1,642 lines; it is in
  the Later list.

**F2. A pass that returns a native value still needs a rewritable adapter. Change: open the edit only when the
adapter has `rebuild`.**
`applyPass` calls `view.beginEdit()` for every pass, and `beginEdit` throws `ir.capability` when the adapter has
no `rebuild` (probe A). Both tensor passes return native values and never use the edit. Proposed: `applyPass`
and `applyPassSync` open the edit only if `pass.adapter.rebuild` exists; reading `ctx.edit` otherwise throws
`PassError('badResult')`. Rewritable adapters see no change.
Simplest alternative: give the tensor adapter a `rebuild`. That is about 40 lines that must round-trip the
projection exactly and that nothing would call.

**F3. IR data and check evidence are canonical JSON: finite numbers, and -0 becomes 0 (probes D, E). No change.**
A Tix literal is finite and unary minus is an operation, so the IR never needs -0, an infinity or a NaN in this
stage (`max` starts at negative infinity inside the evaluator; the IR does not store it). Evidence carries
values as text.

**F4. Differential evidence is one verdict per case. No change.**
A tolerance relation would naturally also record how close an accepted case came to the tolerance. This stage
measures that in a test instead (section 6).

**What fits unchanged.** `defineIR`, `defineAdapter` and `createIRArtifact` take the tensor IR with statements
as entities. `diff` and the declared-writes check work at that level (probes B2 to B4): a pass that claims to
write only statements cannot change a parameter or a function signature. `differential` passes `side` to `run`,
so the baseline can run in f64 and the subject in f32, and outcomes can be typed arrays (probe C).

### 3. Tix front end

**Lexing.** Names are `[A-Za-z_][A-Za-z0-9_]*`. Numbers are decimal with optional fraction and exponent, and must
be finite. `fn`, `return` and `f32` are reserved. `sum`, `max`, `min`, `exp`, `log`, `sqrt` and `tanh` are
functions only when followed by `(`; elsewhere they are ordinary names, so a tensor may be called `max`.

**Parsing.** Recursive descent with the precedence of the brief. A reduction is parsed as a primary whose body is
a full expression, which makes it extend as far right as possible. Dimensions and index expressions are parsed
with `+`, `-`, `*`, unary minus and parentheses and must reduce to an affine form with integer coefficients.

The grammar is ambiguous at `max(a, b) - x`: a call followed by a subtraction, or a reduction over `a, b` of
`-x`. Rule: `max(` followed by a list of bare names, `)` and the start of an operand (a number, a name, `(` or
`-`) is a reduction. When that start is `-` and there are two names, it is a call if both names are shape names
and a reduction otherwise. This is sound because an index name may not be a shape name (rule 3 below).

**Checking.** Errors carry the position of the offending token.

1. Parameters have distinct names. Every name in a parameter dimension is a shape name of the function, and each
   shape name must be a whole dimension of at least one parameter, so input shapes can bind it. Names in
   declared statement types and in the result type must be shape names.
2. Single assignment: a statement's name is neither a parameter nor an earlier statement.
3. Indices: left-hand indices are distinct; a reduction's indices are distinct and not bound by an enclosing
   scope (sibling reductions may reuse a name); no index name is a shape name; an index used in a reference must
   be bound.
4. A reference names a parameter or an earlier statement and has as many index expressions as the tensor has
   dimensions. A bare name in an expression must be a shape name.
5. Extents. A plain use is an index expression that is exactly one index. An index takes the dimension at each of
   its plain uses, and they must be equal as affine forms. A left-hand index must also equal the declared
   dimension if a type is declared, and takes it when it has no plain use. A reduction index has only its plain
   uses. An index with no source for its extent is an error.
6. Bounds. Every index expression must lie in `0 .. dim-1` for every binding of the shape names to positive
   integers. For `c0 + Σ ci·i` with extents `Ei`, the largest value is `c0 + Σ(ci>0) ci·(Ei-1)` and the smallest
   `c0 + Σ(ci<0) ci·(Ei-1)`. An affine form in shape names is non-negative for all positive values exactly when
   no coefficient is negative and the constant plus the coefficients is non-negative. The check is exact for
   independent shape names; it does not use relations between them that hold only because some extent is
   positive. No corpus program needs one.
7. The `return` names a tensor whose shape equals the declared result type.

Extent inference (rule 5) runs only in the front end. The other rules are one function over the IR, used twice:
by the front end with source positions from a side table, and by the IR validator without positions. The
validator therefore requires that accesses stay in bounds, and allows an index to range over less than a
dimension.
Simplest alternative: a front-end checker and a separate validator, which states the rank and bounds rules
twice.

### 4. The IR and its artifact

```ts
type Affine = { c: number; of: Record<string, number> }; // c + Σ of[name]·name; integers, no zero coefficients
type Index = { name: string; extent: Affine };           // 0 .. extent-1; the extent is over shape names
type Expr =
  | { k: 'const'; v: number }                            // the literal as written
  | { k: 'shape'; name: string }                         // a shape name's value
  | { k: 'ref'; t: string; ix: Affine[] }                // index expressions over index names
  | { k: 'un'; op: 'neg' | 'exp' | 'log' | 'sqrt' | 'tanh'; a: Expr }
  | { k: 'bin'; op: 'add' | 'sub' | 'mul' | 'div' | 'max' | 'min'; a: Expr; b: Expr }
  | { k: 'red'; op: 'sum' | 'max'; ix: Index[]; block?: number; body: Expr };
interface Stmt { name: string; indices: Index[]; expr: Expr } // the tensor's shape is the extents of `indices`
interface Fn {
  name: string; shapes: string[]; params: { name: string; shape: Affine[] }[]; stmts: Stmt[]; result: string;
}
interface TixIR { formatVersion: 1; fnOrder: string[]; fns: Record<string, Fn> }
```

Statements are in source order, which is a dependency order by rule 4. After checking, nothing is left to infer:
every tensor has a shape and every index an extent, both affine in the shape names.

**Blocked sums.** `block: B` (an integer of at least 2, on `sum` only) makes the reduction two-level over its
first index `k` of extent `n`. Its meaning: the outer accumulator starts at 0. For each block
`b = 0, 1, …` while `b·B < n`, an inner accumulator starts at 0 and accumulates the body for
`k = b·B .. min(n, b·B+B) - 1` and all values of the remaining indices, in lexicographic order, rounding after
each step; then the outer accumulator adds the inner one and rounds. The fixed core has no syntax for this.

**Lowering.** Each statement is one loop nest over its left-hand indices that writes one element per iteration.
Each reduction is an inner nest with one accumulator, two with `block`. Subscripts are affine. A later lowering
needs no inference.

**Artifact.** `TixIRType = defineIR({ id: 'tensor.tix', version: '1', validate })`, where `validate` checks the
shape of the JSON and runs the checker of section 3. `tixAdapter` projects:

| Entity | Id | Attributes |
| --- | --- | --- |
| `fn` | `fn:<fn>` | name, shapes, result |
| `tensor.param` | `t:<fn>/<name>` | name, shape |
| `tensor.def` | `t:<fn>/<name>` | name, indices, expr |

| Relation | Category | From, to |
| --- | --- | --- |
| `contains` | containment | fn to each tensor, ordered: parameters, then statements |
| `reads` | dependency | a statement to each tensor it references, with attribute `uses` (the count) |
| `returns` | dependency | fn to its result tensor |

The adapter has `entities`, `relations`, `resolve`, `describe` and `validate`, and no `rebuild` (F2).
`compileTix` creates the artifact with `createIRArtifact(tixAdapter, 'tix', ir)`.

### 5. Evaluators

One interpreter over the IR takes a rounding function `R`: `Math.fround` for f32, the identity for f64.

1. Bind shape names from the input shapes and compute every tensor's shape.
2. For each statement in order, for each tuple of its left-hand indices in lexicographic order, evaluate the
   expression and store the element.
3. Return a copy of the result tensor with its shape.

A literal is `R(v)`, a shape value `R(value)`, an input element `R(x)`; an operation is `R` of the JavaScript
result on its evaluated operands (`Math.exp`, `Math.log`, `Math.sqrt`, `Math.tanh`, `Math.max`, `Math.min`).
`sum` starts at `R(0)` and steps `acc = R(acc + body)`; `max` starts at negative infinity and steps
`acc = R(Math.max(acc, body))`; a blocked sum is as in section 4. f32 tensors are `Float32Array`, f64 tensors
`Float64Array`. The f64 evaluation keeps the accumulation order, so it differs from f32 only by rounding.

It is a tree-walking interpreter with a map from index names to values. The contract's cases have extents of at
most 8, which that handles in milliseconds.

### 6. The meaning contract

`tensorMeaning(relation, params)` is a `differential` invariant with ports `reference` and `candidate`, both
`TixIRType`. `tensorContract(relation, params)` wraps it as a transformation contract with inputs
`{ input, origin }` and output `{ output }`, as Typed's `optimizationContract` does. It binds `reference` to
`input` for the exact relation and to `origin` for the tolerance relation, and `candidate` to `output`. A host
with a manager applies the passes through `applyPass` with this contract; `optimizeTix` checks the invariant
directly (section 8). The parameters and their defaults are
`{ count: 16, seed: 1, shapes: [1, 8], values: [-2, 2], tau: 2 ** -12 }`; the invariant's version carries their
hash.

**Domain.** For every function of the reference program, `count` cases. A case binds each shape name to an
integer drawn uniformly from `shapes`, redrawn (at most 64 times) until every tensor dimension of the function is
at least 1, and fills each parameter with values drawn uniformly from `values` and rounded to f32. Both sides get
the same `Float32Array` inputs. With blocks of 4, shapes 1 to 8 give a partial block (1 to 3), one full block
(4), a full block and a tail (5 to 7) and two full blocks (8). A sum's association changes from 6 terms on (with
5 terms the blocked order is `(x0+x1+x2+x3) + x4`, the same as in sequence).

**Observation.** The function's returned tensor: its shape and all its elements. Intermediate tensors are not
observed, because passes remove them.

**Relations.**

| | exact | tolerance |
| --- | --- | --- |
| `reference` is | the pass's input | the origin: the program `compileTix` produced |
| reference runs in | f32 | f64 |
| candidate runs in | f32 | f32 |
| agree when | shapes equal and every element has the same f32 bits (any NaN equals any NaN) | shapes equal and every element satisfies `abs(c - r) <= tau * s` |

`s` is the largest magnitude among the case's input elements and the reference's output elements. A case whose
f64 reference output has a non-finite element is inconclusive under the tolerance relation, which the framework
counts and never treats as a verdict. A candidate that fails to evaluate disagrees.

Why the references differ: exact agreement composes, so checking each exact pass against its own input is enough
and keeps working after a tolerance pass has changed the bits. Closeness does not compose, so every tolerance
pass is checked against the one f64 reference of the original program and no error builds up along a pipeline.
For this, a `TixProgram` carries its origin artifact (section 8).

**The tolerance and its justification.** `tau = 2^-12`, about 2.4e-4.

- Unit. f32 has unit roundoff `u = 2^-24`. Reordering a sum of `n` terms changes it by at most `(n-1)·u·Σ|x_k|`
  to first order (Higham, section 4.2). So a correct pass moves the result by a small multiple of `u`, times the
  size of the operands, times the conditioning of what follows the sum.
- Scale. That error is proportional to the operands, and a result can be much smaller than its operands
  through cancellation. So the tolerance is relative to `s`, which includes the inputs.
- Value. `2^-12` is the square root of `u`: 4096 roundoff units above one rounding error, and a factor 4096 below
  an error of the size of the data. A wrong pass that loses or misplaces a term changes the result by about one
  term.
- Measured (`scripts/02-tolerance-probe.mjs`: matmul, softmax and layernorm written by hand with `Math.fround`,
  100,000 cases each on the domain above):

  | | matmul | softmax | layernorm |
  | --- | --- | --- | --- |
  | largest error over `s`, as written | 5.8 u | 1.7 u | 285 u |
  | largest error over `s`, sums in blocks of 4 | 5.8 u | 1.7 u | 285 u |
  | cases with 6 or more summed terms where the split changes f32 bits | 95% | 71% | 79% |
  | cases where a split that loses the last term stays within tolerance | 6 of 87,581 | 0 of 87,483 | 1 of 87,619 |

  The tolerance is 4096 u. Layernorm's 285 u comes from rows whose variance is near `eps`, where the division
  amplifies the rounding error of `x - mean` by up to `1/sqrt(eps)`, about 316. That is the program's
  conditioning, and the tolerance is 14 times above it. A check has 16 cases per function and rejects if one
  disagrees.
- Kept true by a test: on the contract's own cases, each corpus program as written and after `split-sum` is
  within `tau/8` of the reference, and both wrong passes are rejected.

Simplest alternative: elementwise closeness as in NumPy, `abs(c - r) <= atol + rtol·abs(r)` with `rtol = 1e-5`
and `atol = 1e-8`. In the probe the unchanged f32 program fails it against its own f64 result in 2.4% of the
matmul cases and 3.1% of the layernorm cases, on elements that are near zero through cancellation. Scaling by
the largest reference output alone has the same weakness when the whole output is one such element (526 u for
matmul).

Limit: a fixed `tau` suits programs whose own f32 result is within it on the domain. The test above fails for a
corpus program that is not.

### 7. The passes

Both are built with `definePass`, return native values, and are applied by `applyPassSync` (F1).

**`inline`** (`tensor.inline`, checked under `exact`; writes `tensor.def` entities and `contains`, `reads`
relations). A statement `P` qualifies when its expression contains no reduction, exactly one reference to it
exists in the function, and it is not the result. The reference `P[a1, …, an]` in the consumer is replaced by
`P`'s expression with each left-hand index of `P` replaced by the corresponding `a`. Index expressions are
affine, so the composition is affine. `P` has no reductions, so it binds no index and nothing can be captured.
`P` is removed. The pass repeats until no statement qualifies, so a chain collapses in one application. The
correspondence records `{ from: [P, consumer], to: [consumer], relation: 'inlined' }`.
The result is bit-identical by construction: every operation result is already rounded, so storing an element
and reading it back changes nothing.

**`split-sum`** (`tensor.split-sum`, checked under `tolerance`; writes `tensor.def` entities and no relations).
Every `sum` reduction without a `block` gets `block: 4`. Nothing else changes.

**Deliberately wrong variants** (`src/tensor/wrong.ts`, not in the table `optimizeTix` reads). Each builder in
`passes.ts` takes the one step its wrong variant gets wrong.

- `inline` without index substitution: the expression of `P` is pasted with `P`'s own index names. It is right
  when the consumer happens to use the same names in the same positions, and wrong otherwise. The test program
  reads `d` transposed, where the wrong output is still valid IR and has a different meaning:

  ```
  fn skew(a: f32[N, N]): f32[N, N] {
    d[i, j] = a[i, j] - a[j, i];
    y[i, j] = d[j, i] * 2;      // inline gives (a[j, i] - a[i, j]) * 2; the wrong variant (a[i, j] - a[j, i]) * 2
    return y;
  }
  ```
- `split-sum` that loses the last term: it sets `block` and shortens the extent of the first index by 1, the
  off-by-one of a hand-written remainder loop.

**What the tests show.**

| Pass | exact | tolerance |
| --- | --- | --- |
| `inline` | accepted (its declared relation) | accepted |
| `split-sum` | rejected | accepted (its declared relation) |
| `inline` without index substitution | rejected | rejected |
| `split-sum` that loses the last term | rejected | rejected |

### 8. The API

```ts
interface TixProgram { readonly artifact: Artifact<TixIR>; readonly origin: Artifact<TixIR> }

compileTix(source)                      // parse, infer, check; artifact = origin
runTix(program, fn, inputs, options)    // evaluate program.artifact; f32 unless options.precision is 'f64'
optimizeTix(program, passes)            // applyChecked for each name, in order
applyChecked(program, pass, relation = pass.relation)
  // -> { program, accepted, changed, evidence? }: one pass through applyPassSync, gated by
  //    runDifferential(differentialSpec(tensorMeaning(relation)), { reference, candidate })
```

`optimizeTix` keeps the program unchanged after a rejected pass and continues with the next one, as Typed's
`runPipeline` does. A pass that changes nothing is accepted. Each step object has exactly the two fixed fields
`pass` and `accepted`. The returned program keeps the `origin` of the one passed in, so the tolerance reference
stays the compiled program across calls.

### 9. Corpus

```
// matmul
fn matmul(a: f32[N, K], b: f32[K, M]): f32[N, M] {
  c[i, j] = sum(k) a[i, k] * b[k, j];
  return c;
}
// softmax: the example of the brief
// layernorm
fn layernorm(x: f32[N, D], gamma: f32[D], beta: f32[D]): f32[N, D] {
  mean[i] = (sum(d) x[i, d]) / D;
  c[i, d] = x[i, d] - mean[i];
  var[i] = (sum(d) c[i, d] * c[i, d]) / D;
  sd[i] = sqrt(var[i] + 1e-5);
  y[i, d] = gamma[d] * c[i, d] / sd[i] + beta[d];
  return y;
}
// attention: single head, self-attention with query, key and value projections
fn attention(x: f32[T, D], wq: f32[D, A], wk: f32[D, A], wv: f32[D, A]): f32[T, A] {
  q[t, a] = sum(d) x[t, d] * wq[d, a];
  k[t, a] = sum(d) x[t, d] * wk[d, a];
  v[t, a] = sum(d) x[t, d] * wv[d, a];
  s[i, j] = (sum(a) q[i, a] * k[j, a]) / sqrt(A);
  m[i] = max(j) s[i, j];
  e[i, j] = exp(s[i, j] - m[i]);
  z[i] = sum(j) e[i, j];
  p[i, j] = e[i, j] / z[i];
  o[t, a] = sum(u) p[t, u] * v[u, a];
  return o;
}
// mlp: linear, tanh-GELU, linear
fn mlp(x: f32[N, D], w1: f32[D, H], b1: f32[H], w2: f32[H, D], b2: f32[D]): f32[N, D] {
  h[i, j] = (sum(d) x[i, d] * w1[d, j]) + b1[j];
  u[i, j] = h[i, j] + 0.044715 * h[i, j] * h[i, j] * h[i, j];
  t[i, j] = tanh(0.7978845608 * u[i, j]);
  g[i, j] = 0.5 * h[i, j] * (1 + t[i, j]);
  y[i, d] = (sum(j) g[i, j] * w2[j, d]) + b2[d];
  return y;
}
// conv2d: NCHW, stride 1, no padding
fn conv2d(x: f32[N, C, H, W], w: f32[K, C, KH, KW]): f32[N, K, H - KH + 1, W - KW + 1] {
  y[n, k, i, j]: f32[N, K, H - KH + 1, W - KW + 1] = sum(c, di, dj) x[n, c, i + di, j + dj] * w[k, c, di, dj];
  return y;
}
```

Every program has a `sum`, so `split-sum` changes all six. `inline` changes layernorm (`sd`), attention (`p`,
read under other index names) and mlp (`u`, then `t`, then `g`); on the other three it finds nothing. There is
no metadata file: the contract generates its own cases.

### 10. Tests

Nothing else checks tensor programs, and implementations are compared on `runTix`, so the evaluator gets an
oracle that shares no code with it.

- `tests/tensor/front.test.mjs`: precedence and reduction bodies (`sum(d) x[i, d] / D` against
  `(sum(d) x[i, d]) / D`, by value), both readings of `max(`, and one failing program per check rule with its
  `line:col`.
- `tests/tensor/evaluate.test.mjs`: each of the six corpus programs against a hand-written JavaScript loop nest,
  f32 results bit for bit and f64 results equal. Small cases where the rule is visible: `sum` of `[1e8, 1, -1e8]`
  in f32 and f64, lexicographic order of a two-index sum, `max` over negative values, rounding of a literal and
  of a shape value. A blocked sum of 7 terms against a hand-written two-level loop.
- `tests/tensor/contract.test.mjs`: the table of section 7, on corpus programs and on the transposed-read
  program; `inline` accepted after `split-sum` (exact against the pass input); the calibration test of
  section 6; the same verdicts through `applyPass` with an `AnalysisManager` and `tensorContract`.
- `tests/tensor/passes.test.mjs`: `inline` removes `u`, `t`, `g` from mlp and leaves multi-use statements,
  reductions and the result alone; index substitution through an affine and a permuted reference; f32 results
  bit-identical on random inputs, compared directly with `runTix`; `split-sum` marks every sum and is a no-op
  the second time.
- `tests/tensor/api.test.mjs`: `optimizeTix` returns an object and not a Promise, steps have exactly `pass` and
  `accepted`, the returned program runs.
- `tests/framework/pass-sync.test.mjs`: on the labs expression IR, `applyPassSync` accepts, rejects through
  `check`, rejects an undeclared write, returns the input when nothing changed, and refuses a pass with `needs`;
  `applyPass` and `applyPassSync` apply a native-result pass on an adapter without `rebuild`.
- After the implementation: `node --test tests/framework/` and the Typed tests that go through `applyPass`
  (`tests/typed/passes`, `mutate`, `rules`, `ssa`, `audit`, `f32`, `meaning-memo`, `parallel`).

### 11. Probes

Both scripts are in the ticket's `scripts/` and run after `npm run build` (Node 24.18.0).

`01-framework-probes.mjs`, on a miniature statement-level IR:

| Probe | Result |
| --- | --- |
| A. `applyPass`, native-result pass, adapter without `rebuild` | throws `ir.capability: Adapter adapter.probe-mini is not Rewritable` |
| B1. `applyPass` return value | a Promise |
| B2, B3. Diff of an inlining, with a `rebuild` added | entities: `removed t:e`, `updated t:y`; relations: `removed contains:e`, `updated contains:y`, `removed reads:e:x`, `removed reads:y:e`, `inserted reads:y:x` |
| B4. The same pass declaring no relation writes | `undeclaredWrite` |
| C. `runDifferential`, baseline `Float64Array`, subject `Float32Array` | returns synchronously, `status: agree`, 3 of 3 |
| D. Evidence `{ got: NaN }` through the manager | throws `IR data must contain only finite numbers` |
| E. `immutable({ v: -0 })`; `immutable({ v: Infinity })` | sign lost; throws |
| F. The steps of `applyPassSync` by hand, adapter without `rebuild` | changed, no undeclared writes, correspondence `t:e+t:y -> t:y (inlined)`, gate `agree` |

`02-tolerance-probe.mjs`: the table of section 6.

Not probed, because nothing of it exists yet: the Tix parser, the checker and the interpreter. Attention, mlp and
conv2d are not in the tolerance probe; the calibration test covers all six with the real evaluator.

## Design Decisions

Each decision is listed with the simplest alternative that would serve the goal.

| Decision | Simplest alternative, and why it was chosen or falls short |
| --- | --- |
| The IR is the checked program with explicit extents | The parsed tree, with extents inferred on demand. After `inline` an index can be left with only affine uses, where inference fails. |
| A two-level sum is `block` on the reduction | This is the simplest form. Two nested sums need extents `n div 4` and `n mod 4`, a duplicated body for the tail, and division reasoning in the bounds check. Index-dependent ranges are a general loop-bound language, which belongs to the tiling stage. |
| Expressions are nested trees; entities are statements | Chosen as the simplest. Both passes act on whole statements. |
| One interpreter with a rounding function | Chosen as the simplest. Two interpreters could drift apart, and the reference would then differ from the meaning by more than rounding. |
| Exact against the pass input, tolerance against the origin's f64 | Everything against the origin, as Typed does: an exact pass after an accepted tolerance pass would be rejected. Everything against the pass input: tolerance error would add up per pass. |
| `tau·s` with `tau = 2^-12` | Elementwise `allclose`: rejects the unchanged program (section 6). |
| Random shapes 1 to 8, values in [-2, 2], 16 cases per function | One fixed shape per program: misses partial blocks and extents of 1, and needs a metadata file. |
| `applyPassSync` gated by `runDifferential` | Repeat `applyPass`'s steps in `src/tensor` (section 2, F1). |
| No `rebuild` on the tensor adapter | Write one (section 2, F2). |
| One checker for the source and for the IR validator | Two checkers (section 3). |
| `inline` runs to a fixpoint | One substitution per application: the caller would have to loop. |
| `split-sum` splits every sum on its first index, block 4 | Chosen as the simplest. Single-index sums only would leave conv2d untouched and saves no code. |
| Wrong variants in `src/tensor/wrong.ts` | Define them in the test file: they need the passes' internals. Typed keeps its wrong passes in `src` too (`mutate.ts`). |

## Alternatives Considered

The alternatives are in the table above and in sections 2 and 6. Two IR forms were also set aside: a loop-nest IR
with explicit loops and accumulators, which is the output of the later lowering and would make both passes
match loops instead of index expressions; and an operator graph (matmul and softmax as nodes), which cannot
express conv2d or an arbitrary contraction without an operator for each.

### Left out, and why

- A printer from IR to Tix text: no requirement needs it, and a blocked sum has no syntax.
- Expression nodes as entities, and `rebuild`: no pass edits through the projection.
- `baselineKey` and `subjectKey` reuse of outcomes, and worker execution: a check takes milliseconds.
- Strategy plans and dataflow analyses: a pass list is a loop, and there is no control flow.
- A block size parameter: the contract's shapes would have to reach past two blocks of whatever size is asked.
- A cost model for `inline`: the brief defines when it applies.

### Later

- Lowering to CUDA, fusion, tiling of contractions, attention rewrites: the later stages of the brief.
- A synchronous verification in `AnalysisManager`, so synchronous hosts also get execution records.
- The margin of accepted cases in differential evidence: needs a `measure` on `CaseComparison`.
- A tolerance derived per element from a running error bound: needs a reference evaluator that carries bounds.
- Constants -0, infinity and NaN in the IR (for constant folding): needs literals stored as bits, as Typed does.
- Per-parameter input ranges and special values (zeros, denormals): needs corpus metadata.
- Patterns and rewrite rules on expressions: needs expression nodes as entities.

## Implementation Plan

1. Framework: F2, then F1, with `tests/framework/pass-sync.test.mjs`; run `tests/framework/` and the Typed tests
   named in section 10.
2. `ir.ts`, `check.ts`, `syntax.ts`, the corpus, `front.test.mjs`.
3. `evaluate.ts`, `evaluate.test.mjs` with the hand-written oracles.
4. `contract.ts`, `passes.ts`, `wrong.ts`, `contract.test.mjs`, `passes.test.mjs`.
5. `index.ts`, `api.test.mjs`; `npm run build`, all of `tests/tensor/`, and `prettier --check` on the files this
   ticket adds. `npm run format:check` fails today on 10 existing files, `define-pass.ts` among them, so that file
   gets its new lines formatted and is otherwise left as it is.

One commit per step, a diary step for each, and the design updated if the implementation departs from it.

## Open Questions

1. F1: is a synchronous application without the manager acceptable for `optimizeTix`? It leaves no execution
   record in an `AnalysisManager`; the verdict and the evidence come back from `applyChecked`.
2. Is `block` on the reduction an acceptable form for "a two-level reduction"? The remainder block is then part
   of the IR's meaning, so no pass can get it wrong, and the wrong variant of `split-sum` has to shorten an
   extent to lose a term.

## References

- `src/framework/passes/define-pass.ts`: `applyPass`, the target of F1 and F2.
- `src/framework/contracts/differential.ts`: `differential`, `runDifferential`, `differentialSpec`.
- `src/framework/ir/adapters.ts`, `src/framework/ir/transactions.ts`: `createIRArtifact`; where `beginEdit`
  requires `rebuild`.
- `src/typed/passes.ts`, `src/typed/evaluate.ts`, `src/typed/project.ts`: how Typed builds its contract and
  pipeline; `src/typed/mutate.ts`: its deliberately wrong passes.
- N. J. Higham, Accuracy and Stability of Numerical Algorithms, 2nd edition, section 4.2 (error of summation in
  any order).
