---
Title: 'Stage 1 design: Tix, its IR, evaluators, meaning contract and two passes'
Ticket: IRWB-020-M
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
      Note: applyPass opens a logical edit for every pass and is async only (framework changes F1 and F2)
    - Path: src/framework/contracts/differential.ts
      Note: sampled checks keep counts but no per-case distance (framework change F3)
    - Path: src/framework/ir/transactions.ts
      Note: the Draft constructor refuses adapters without rebuild (line 42; the cause of F1)
    - Path: src/typed/passes.ts
      Note: how the Typed domain defines passes and its optimization contract (the pattern Tix follows)
    - Path: ttmp/2026/11/26/IRWB-020-M--tix-an-index-notation-tensor-language-on-the-framework-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-the-inline-and-split-sum-passes/scripts/01-probe-framework-sync-and-rebuild.mjs
      Note: probe behind F1 and F2
    - Path: ttmp/2026/11/26/IRWB-020-M--tix-an-index-notation-tensor-language-on-the-framework-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-the-inline-and-split-sum-passes/scripts/02-probe-f32-reassociation.mjs
      Note: probe behind the tolerance
ExternalSources: []
Summary: 'Design for stage 1 of the tensor domain. It covers Tix (parser and checker), its IR as a framework artifact, f32 and f64 evaluators, a meaning contract with exact and tolerance relations, the inline and split-sum passes with one deliberately wrong variant each, and the corpus. It proposes three small framework changes.'
LastUpdated: 2026-11-26T14:30:00-05:00
WhatFor: 'Review before implementation of IRWB-020-M.'
WhenToUse: 'When implementing or reviewing stage 1 of the tensor track, or when looking for where the framework did not fit a second domain.'
---

# Stage 1 design: Tix, its IR, evaluators, meaning contract and two passes

## 1. Summary

Stage 1 adds a second domain to the framework: Tix, a small index-notation language for tensor programs. It is
built in `src/tensor/` on the framework's IR definitions, artifacts, passes and differential checks. The pieces
are:

- a parser and checker that produce one IR artifact (`tensor.tix`);
- a single evaluator, run in f32 (the meaning) or in f64 (the reference);
- a meaning contract with two relations: `exact` (bit-identical f32 results) and `tolerance` (normwise relative
  error against the f64 reference of at most τ = 2⁻¹³);
- two checked passes: `inline` (checked exactly) and `split-sum` (checked under the tolerance), plus one
  deliberately wrong variant of each;
- six corpus programs.

The framework mostly fit a second domain. In three places it did not, and those three changes are the main
result of this stage:

| # | Finding (each confirmed by a probe, §10) | Proposed change to `src/framework/` |
|---|---|---|
| F1 | `applyPass` opens a logical edit (`view.beginEdit()`) before every pass, and the edit refuses adapters without `rebuild`. A domain whose passes return native values must therefore write a `rebuild` it never uses. | `applyPass` opens the edit lazily, only when the pass reads `ctx.edit`. |
| F2 | The checked-pass path (`applyPass` → `AnalysisManager.verifyTransformation`) is async throughout. The fixed Tix API `optimizeTix` is synchronous, and JavaScript cannot wait on a promise synchronously. | Add `applyPassSync`: the same candidate, diff, correspondence and `writes` logic as `applyPass`, with a synchronous gate. It refuses passes that need the manager. |
| F3 | A sampled check records only counts and up to five counterexamples. A tolerance relation decides each case by a distance, so an accepted tolerance check cannot say how close the pass came to τ. | `compare` may return a `measure`; the evidence gains `worst: {measure, case}`. |

Everything else (`defineIR`, `defineAdapter`, `createIRArtifact`, `diff`, `makeCorrespondence`, `definePass`,
`differential`, `defineTransformation`) is used as it is.

## 2. Supported input domain

Behaviour is specified only inside this domain.

- **Source text** is the fixed core grammar, plus the choices in §3.1. On source outside it, `compileTix` throws
  an `Error` whose message starts with `line:col: `. Which error is reported first, when there are several, is
  not specified.
- **Programs** are those that pass the checks in §3.2.
- **Inputs to `runTix`** must provide every parameter of the function. Shapes must agree with the declared
  types. Every dimension of every parameter and of every statement tensor must be at least 1, the data length
  must equal the product of the shape, and the values must be finite. Outside this, `runTix` throws an `Error`.
- **Pass names** for `optimizeTix` are `inline` and `split-sum`. Other names throw.
- **The contract's domain** consists of functions whose shape names can be given values in 1..8 that make every
  declared dimension at least 1 (§6.1).

## 3. Tix as implemented

### 3.1 Choices the fixed core leaves open

- `NAME` is `[A-Za-z_][A-Za-z0-9_]*`, case-sensitive. The reserved words are `fn return f32 sum max min exp log
  sqrt tanh`.
- `NUMBER` is `digits ('.' digits)? ([eE] [+-]? digits)?`. Literals are non-negative, because minus is an
  operator. In dimensions and subscripts only integers are allowed.
- An affine expression (`dim`, `aff`) is a sum or difference of terms, each of which is an integer, a name, or
  `integer '*' name`.
- **`max` disambiguation.** After `max (`, if the parenthesised list holds only bare names and the token after
  `)` can begin an operand (a name, a number, `(`, or a function or reduction keyword), the construct is a
  reduction. Otherwise it is the two-argument call. Because `-` after `)` is read as binary minus, a `max`
  reduction whose body begins with a unary minus needs parentheses: `max(j) (-x[i, j])`. `sum` has no call form,
  so `sum(j) -x[i, j]` is a reduction.
- **Precedence and the extent of a reduction body** are as the fixed core states. The parser reads a reduction's
  body with the lowest-precedence rule, so the body stops at the first `)`, `,` or `;` that is not nested inside
  it.

### 3.2 Checks (each failure reports `line:col`)

1. Function names are unique. Within a function, parameter names are unique.
2. **Shape names.** Every shape name must appear as a bare dimension (`N`, not only `H - 2`) of some parameter,
   so that binding shapes from inputs needs no solving. Names in other parameter dimensions, in the result type,
   in declared statement types and in expressions must be bound this way.
3. **Single assignment.** A statement defines a new tensor, distinct from the parameters and from earlier
   statements. A reference names a parameter or an earlier statement, so programs are acyclic, with as many
   subscripts as that tensor's rank.
4. **Indices.** A statement's left-hand indices are distinct. A reduction's indices are distinct from every index
   already in scope, so there is no shadowing. Subscripts mention only indices in scope. A bare name in an
   expression must be a shape name.
5. **Extents.** A *plain use* of an index is a subscript that is exactly that index. Each plain use gives the
   referenced tensor's dimension at that position. All plain uses of an index must agree, after normalising
   affine expressions to `c + Σ kᵢ·nameᵢ`. A left-hand index with no plain use takes its extent from the declared
   type, which is then required; if there is a declared type, it must agree with the inferred extents. A
   reduction index with no plain use is an error.
6. **Bounds.** Every subscript `c₀ + Σ cₖ·idxₖ` needs `c₀ ≥ 0` and every `cₖ ≥ 0`, so its least value `c₀` is in
   bounds. It also needs `(dim − 1) − (c₀ + Σ cₖ·(extentₖ − 1))`, which is affine in shape names, to be
   non-negative for every shape value of at least 1. That holds exactly when every coefficient of the difference
   is ≥ 0 and its constant plus the sum of its coefficients is ≥ 0. This is conservative: it does not use
   constraints such as `H ≥ KH`. It still accepts the corpus, because conv2d's difference is identically 0.
7. **Calls.** `exp`, `log`, `sqrt` and `tanh` take one argument; `max` and `min` take two.
8. **Return.** `return NAME;` names a tensor whose dimensions equal the declared result type.

The checker emits the IR directly. There is no separate typed AST.

## 4. The IR (`tensor.tix`, version 1)

### 4.1 Form

A function is an ordered list of statements, each defining one tensor:
`tensor[indices with extents] = expression`. Every index binder, on the left-hand side and in reductions,
carries an explicit extent. Expressions are trees. This is concrete index notation, and it lowers directly to
loop nests: one nest per statement over its left-hand binders, with one inner nest per reduction. Subscripts are
affine. Shapes stay symbolic.

```ts
interface Aff { c: number; terms: Record<string, number> }   // c + Σ terms[n]·n; integer, no zero coefficients
interface Binder { name: string; extent: Aff; div?: number }  // 0 ≤ name < ceil(extent / div); div is an integer ≥ 2
type Expr =
  | { op: 'num'; value: number }                               // literal as written (a double)
  | { op: 'shape'; name: string }                              // a shape value
  | { op: 'ref'; tensor: string; at: Aff[] }                   // subscripts over indices in scope
  | { op: 'neg' | 'exp' | 'log' | 'sqrt' | 'tanh'; args: [Expr] }
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'max' | 'min'; args: [Expr, Expr] }
  | { op: 'reduce'; fold: 'sum' | 'max'; over: Binder[];
      when?: { index: Aff; below: Aff };                       // a term is included iff index < below
      body: Expr };
interface Stmt { tensor: string; indices: Binder[]; body: Expr }
interface Fn { name: string; shapes: string[]; params: { name: string; dims: Aff[] }[];
               result: Aff[]; stmts: Stmt[]; ret: string }
interface TixValue { formatVersion: 1; fns: Fn[] }
```

`div` and `when` are not Tix syntax. They exist for `split-sum` (§7.2). A source program never contains them.
The extent of a reduction binder may evaluate to 0 or less, which means the reduction has no terms. Tensor
dimensions (parameters and left-hand binders) must be at least 1 (§2).

**Validator** (`defineIR`'s `validate`) checks structure only:

- the format version;
- unique function, parameter and tensor names;
- that `shapes` is exactly the set of bare parameter dimensions;
- that references name a parameter or an earlier statement, with the right rank;
- that index names are in scope with no shadowing, and that extents and `below` mention only shapes;
- that `div` is an integer ≥ 2;
- that `ret` exists and has the result's rank.

It does not prove subscript bounds. A guarded subscript is bounded only by its guard, so for IR the bounds are
checked by the evaluator at run time instead (§5). Front-end programs are proven in bounds by check 6.

**Program artifact.** `TixProgram` is the framework artifact `Artifact<TixValue>`, created with
`createIRArtifact(tixAdapter, 'tix', value)`. Probe 01(d) confirmed that a nested JSON value like this is
accepted.

### 4.2 Projection (`adapter.tensor-tix`, version 1)

| Entity | Id | Attributes |
|---|---|---|
| `fn` | `fn:<name>` | name, shapes, result, ret |
| `param` | `param:<fn>/<name>` | name, dims |
| `stmt` | `stmt:<fn>/<tensor>` | tensor, indices, body |

| Relation | Category | From → to |
|---|---|---|
| `declares` | containment | fn → param (ordered) |
| `contains` | containment | fn → stmt (ordered) |
| `reads` | dependency | stmt → param or stmt; one per tensor read (`reads:<stmt>:<tensor>`) |
| `returns` | dependency | fn → param or stmt |

Roots are the `fn` entities. The adapter has no `rebuild`. Both passes return native values, and with F1 no
rebuild is needed.

### 4.3 Why this form

- **Keeping the checked AST as the IR.** This is the simplest alternative, and it falls short. The AST leaves
  extents implicit, to be inferred from uses. `split-sum` creates binders whose extents cannot be inferred
  (`k.o` is used only inside `4*k.o + k.i`), and loop lowering needs every extent stated. Explicit extents on
  every binder are the smallest change that serves both.
- **Expression nodes as entities with stable ids, as `typed.blocks` does for values.** Rejected for this stage.
  Neither pass needs finer `writes` or correspondence than statements give: `inline` merges two statements and
  `split-sum` rewrites one. Finer entities would bring an id scheme and a `rebuild` for no check that this stage
  makes. The cost is that the framework's `writes` check can only say "statements changed" (§9).
- **Guard plus ceiling division, for the split.** The simplest alternative is to split only extents that are
  multiples of the block size. Symbolic extents such as `K` can never be shown to be multiples, so the pass would
  never apply to the corpus. Requiring divisibility in the domain would change the program's meaning domain. A
  guard is also how a loop or a CUDA kernel handles a ragged tail, so it does not bend the IR away from lowering.

## 5. Evaluators

There is one tree-walking evaluator, parameterised by a rounding function `ρ`: `Math.fround` for f32 and the
identity for f64. Two separate evaluators would be the other option, but they could drift apart in evaluation
order, which is exactly what the tolerance relation must not confound.

- **Inputs.** Values are converted on entry: `ρ` of each value, so a `Float64Array` given to the f32 evaluator is
  rounded. Shapes bind from bare parameter dimensions. Other dimensions are evaluated and compared, and every
  dimension must be at least 1.
- **Statements** are evaluated in order. Each fills a row-major array (`Float32Array` or `Float64Array`) over its
  left-hand binders in lexicographic order.
- **Expressions.**
  - `num` → `ρ(value)` and `shape` → `ρ(N)`.
  - Unary and binary operators and calls → `ρ(JS result)`, using `Math.exp`, `Math.log`, `Math.sqrt`,
    `Math.tanh`, `Math.max` and `Math.min`.
  - `reduce` starts at `0` (sum) or `−∞` (max). It iterates its binders in lexicographic order, first binder
    outermost, skips the terms that `when` excludes, and sets `acc = ρ(acc + v)` or `ρ(Math.max(acc, v))` after
    each step.
  - For `+ − × ÷` on f32 operands, `fround` of the double result is the correctly rounded f32 result, because a
    double has more than 2·24 + 2 bits. So the f32 meaning is IEEE single precision for those operations.
- **Bounds.** A read outside a tensor's bounds throws a `TixFault`. `runTix` passes it on as an `Error`; the
  contract records it as a disagreeing outcome (§6.3).
- **Result.** `{shape, data}` of the returned tensor, which is a copy if it is a parameter.

## 6. The meaning contract

### 6.1 Domain: which shapes and inputs are checked

For each function of the baseline program the contract checks `count = 24` cases, generated from `seed = 7` with
the framework's `seededRandom`.

- **Case 0** sets every shape name to 1. **Case 1** sets every shape name to 7.
- **Cases 2 to 23** draw each shape name uniformly from 1..8. A draw, or a corner case, that makes any declared
  dimension less than 1 is replaced by a fresh draw, up to 100 tries.
- **Data.** Every parameter element is uniform in [−1, 1], rounded to f32.

In case 1, every extent that is a single shape name is 7 = 4 + 3. With the default block size B = 4, that is
longer than B + 1 = 5 and has a ragged last block. Probe 02 shows why that matters: the split changes bits only
when some block after the first has at least two terms, which needs an extent of at least B + 2.

The simplest alternative was a fixed shape list per corpus program. It needs a hand-written file per program,
covers ragged extents only if someone remembers to, and gives programs outside the corpus no domain at all.

### 6.2 Observation

The observation is the returned tensor of every function: its shape and its values, from the evaluator of §5.

### 6.3 Relations

- **`exact`.** The shapes are equal and every element satisfies `Object.is(c_i, b_i)` on the f32 values. That is
  bit-identical, except that NaN payloads are not distinguished; inputs in the domain do not produce NaN in the
  corpus. A fault in the candidate disagrees.
- **`tolerance`.** The relation uses `err(y) = max_i |y_i − r_i| / max_i |r_i|`, where `r` is the f64 result of
  the origin, with 0/0 taken as 0 and e/0 as ∞. A case agrees iff the shapes are equal, the candidate is finite
  and `err(c) ≤ τ`, with **τ = 2⁻¹³ ≈ 1.22·10⁻⁴ = 2048 u** (u = 2⁻²⁴). A case is **inconclusive** if `r` has a
  non-finite element, or if the origin's own f32 result already fails the bound (`err(o) > τ`). On such a case
  the tolerance cannot tell any candidate apart from the program itself. The framework already counts
  inconclusive cases, and fails a check that has none decided. Each decided case reports `measure = err(c)` (F3).

**Why normwise and why 2⁻¹³.** Probe 02 (§10) measured f32 dot products of length n from 2 to 1728, with
operands in [−1, 1], over 200 trials each.

- The f32 meaning itself is at most 7.9·10⁻⁶ (133 u) from f64. The worst case is a one-element output with
  cancellation.
- The blocked sum is no worse.
- Dropping a single term moves the result by at least 1.5·10⁻³.

τ = 2⁻¹³ sits near the geometric middle of that gap. It is about 15 times above the largest rounding difference
seen and about 12 times below the smallest dropped-term effect.

The simplest alternative was an elementwise `|c − r| ≤ atol + rtol·|r|`. It fails on the program itself: one
cancelled element already has a relative error of 133 u, and the corpus produces near-zero elements by
construction (layernorm's centred values, softmax tails), so `rtol` is meaningless there and `atol` would need a
scale chosen per program. A self-calibrating bound (at most K times the origin's own error) was also rejected,
because that error is 0 on small exact cases (probe: 1 u at n = 2), and the bound then collapses.

The probe covers only sums of products. The implementation will measure, through F3's `worst`, the largest
`err` of `split-sum` on every corpus program, and a test will require it to be below τ/4 with no inconclusive
cases. If the corpus contradicts the probe, I will report it rather than quietly retune τ.

### 6.4 Baselines: what each relation compares against

`exact` compares the candidate with **the pass's input**. `tolerance` compares it with **the f64 result of the
origin** (r0, the compiled program).

The simplest alternative was to check everything against the origin, as the Typed contract does. It would reject
`inline` after `split-sum`, because the input to `inline` already differs in bits from r0. Checking everything
against the pass's input instead would let tolerance errors add up along a pipeline. With these baselines,
exactness composes step by step, and every tolerance step is bounded against r0 directly. Both orders of
`['inline', 'split-sum']` are therefore checked meaningfully.

### 6.5 In framework terms

- `meaningKept(relation)` is a `differential` invariant `tensor.meaning-kept` over the ports
  `{baseline, candidate}`. Its version is `1+<hash of relation, count, seed, τ>`.
  - `run('baseline')` returns `{y32}` for `exact` and `{y32, y64}` for `tolerance`; `run('subject')` returns
    `{y32}` or `{fault}`.
  - `inconclusive`, `compare` and `describeCase` (`{fn, n, shapes}`) are as in §6.3.
  - `baselineKey` is the baseline's revision, so baseline outcomes are computed once per program.
- `meaningContract(relation)` is a `defineTransformation` (`tensor.optimization`) with inputs `{input, origin}`
  and output `{output}`. It ensures `meaningKept(relation)`, with `baseline` bound to `input` (exact) or to
  `origin` (tolerance), and `candidate` bound to `output`. `applyPass` gates on it through the
  `AnalysisManager`. `applyPassSync` gates on `runDifferential(differentialSpec(meaningKept(relation)), …)`.
  Both paths use the same invariant object.

## 7. Passes

Each pass is a `definePass` over `TixIR` and `tixAdapter`, with no `needs` and no `preserves`, and returns a
native value. Each also declares its relation, which `optimizeTix` uses.

### 7.1 `inline` (`tensor.inline` v1, relation `exact`)

- **Candidates.** In program order, find each statement `p` that is *pointwise* (no `reduce` in its body), is not
  `ret`, and is referenced exactly once in its function, by one `ref` node in a consumer `c`.
- **Rewrite.** Let σ map `p`'s k-th index to the k-th subscript of that `ref`. Replace the `ref` with `p.body`,
  in which every subscript `a` becomes `a∘σ` (affine composed with affine is affine), then remove `p`.
  - `p` has no binders, so nothing can be captured.
  - Chains are handled by the single sweep: when `p` is inlined into a pointwise `c`, `c` may itself become a
    candidate later in the same sweep.
- **Why it is bit-identical.** The substituted expression computes the same operations on the same operand
  values, in the same order and with the same rounding. Storing a rounded value in a `Float32Array` is exact.
- **`writes`.** Entities `stmt`; relations `contains`, `reads`.
- **Correspondence.** `{from: [p, c], to: [c], relation: 'inlined'}`, a merge. Everything else is retained
  implicitly.

Example (softmax): `z[i, j] = x[i, j] - m[i]; e[i, j] = exp(z[i, j]);` becomes
`e[i, j] = exp(x[i, j] - m[i]);`.

### 7.2 `split-sum` (`tensor.split-sum` v1, relation `tolerance`, parameter `block`, default B = 4)

- **Candidates.** Every `reduce` with `fold: 'sum'`, exactly one binder `j`, no `div` and no `when`. That
  excludes reductions the pass has already split, so the pass is idempotent.
- **Rewrite.**
  `sum(j < E) body` → `sum(j.o < ceil(E / B)) sum(j.i < B | B·j.o + j.i < E) body[j := B·j.o + j.i]`.
  - The new names contain `.`, which Tix names cannot, so they are fresh.
  - The inner sum starts at 0 for each block and the outer sum adds the partial sums in block order. That is the
    reassociation.
- **`writes`.** Entities `stmt`; no relations, because the reads are unchanged. Correspondence: the statement is
  retained (same id).

Example (matmul):
`c[i, j] = sum(k.o < ceil(K/4)) sum(k.i < 4 | 4*k.o + k.i < K) a[i, 4*k.o + k.i] * b[4*k.o + k.i, j]`.

Multi-index sums (conv2d's `sum(c, dy, dx)`) are not split, because the brief says "over one index". `max`
reductions are not split either.

B = 4 is below the domain's extents (up to 8), so most sampled reductions get two or more blocks and a ragged
tail. A GPU stage will choose its own block size through the parameter.

### 7.3 Deliberately wrong variants (in `WRONG_PASSES`, not in `optimizeTix`'s table)

Both variants produce valid IR, so it is the contract that rejects them, not the validator. Each models a
realistic bug class rather than an arbitrary corruption.

- **`inline-wrong`.** Same as `inline`, except that σ maps `p`'s k-th index to the consumer's k-th left-hand
  index instead of to the k-th subscript (it skips a consumer with fewer left-hand indices than `p`'s rank). This
  is the "elementwise access" assumption. It is correct whenever the consumer reads `p` at its own point
  (softmax, layernorm), and wrong when it does not. On attention
  (`o[i, c] = sum(j) p[i, j] * v[j, c]`) and on the MLP it yields wrong values or out-of-bounds faults. It is
  rejected under `exact`.
- **`split-sum-wrong`.** Same as `split-sum`, except that it computes the number of blocks as `floor(E/B)`,
  encoded as `ceil((E − B + 1)/B)`. That drops a ragged tail block. The rewrite is correct when B divides E and
  wrong otherwise, so the test also shows that the domain's ragged extents matter. It is rejected under
  `tolerance`: probe 02 puts one dropped term about 12 times above τ.

The simplest alternative was an obviously broken rewrite, such as replacing an expression with 0. It would show
only that the contract is not vacuous, and not that the domain and the relation catch these two bug classes.

## 8. API and modules

```ts
compileTix(source: string): TixProgram                       // Artifact<TixValue>
runTix(program, fn, inputs, options?: { precision?: 'f32' | 'f64' }): { shape: number[]; data: Float32Array | Float64Array }
optimizeTix(program, passes: string[]): { program: TixProgram;
  steps: { pass: string; accepted: boolean; changed: boolean; reason?: string; evidence?: DifferentialEvidence }[] }
// beyond the fixed API:
applyTixPass(program, pass: TixPass, options?: { origin?: TixProgram; relation?: 'exact' | 'tolerance'; params? }):
  { pass: string; accepted: boolean; changed: boolean; program: TixProgram; reason?: string; evidence?: DifferentialEvidence }
PASSES, WRONG_PASSES, meaningKept(relation), meaningContract(relation), TIX_TOLERANCE, TixIR, tixAdapter
```

`optimizeTix` runs `applyTixPass(cur, PASSES[name], {origin: program})` for each name, using the pass's own
relation. A rejected pass leaves the program unchanged and the pipeline continues, as in Typed's `runPipeline`. A
pass that changes nothing is accepted without a check. `applyTixPass` uses `applyPassSync` with the gate of §6.5.

| File | Contents |
|---|---|
| `src/tensor/syntax.ts` | tokenizer and parser (positions on every node) |
| `src/tensor/check.ts` | the checks of §3.2, and emission of the IR |
| `src/tensor/ir.ts` | IR types, affine helpers, validator (`TixIR`), adapter (`tixAdapter`) |
| `src/tensor/evaluate.ts` | the evaluator (§5) |
| `src/tensor/contract.ts` | domain, relations, `meaningKept`, `meaningContract` |
| `src/tensor/passes.ts` | `inline`, `split-sum`, the wrong variants |
| `src/tensor/index.ts` | the API |

### 8.1 Corpus (`corpus/tensor/<name>/main.tix`)

| Program | Shape of the program | `inline` | `split-sum` |
|---|---|---|---|
| matmul | `c[i, j] = sum(k) a[i, k] * b[k, j]` | none | k |
| softmax | max-shifted: m, z, e, s, y | z into e | s |
| layernorm | mu, xc, v, `r[i] = 1 / sqrt(v[i] + 0.00001)`, `y = xc * r * gamma + beta` | r into y | mu, v |
| attention | `sc = (sum(d) q·k) / sqrt(D)`, max-shifted softmax over j, `o = sum(j) p·v` | p into o | sc, l, o |
| mlp | `h = b1 + sum(k) x·w1`, tanh-GELU g, `y = b2 + sum(j) g·w2` | g into y | h, y |
| conv2d | NCHW, stride 1, no padding: `y[n, f, oy, ox]: f32[N, F, H - KH + 1, W - KW + 1] = sum(c, dy, dx) x[n, c, oy + dy, ox + dx] * w[f, c, dy, dx]` | none | none (three-index sum) |

GELU uses `0.5 * h * (1 + tanh(0.7978845608028654 * (h + 0.044715 * h * h * h)))`. eps is a literal, because Tix
has no scalar parameters.

## 9. Framework changes in detail

**F1: lazy logical edit in `applyPass`** (`src/framework/passes/define-pass.ts`).

- *Finding.* `applyPass` calls `view.beginEdit()` before running the pass. `Draft`'s constructor
  (`ir/transactions.ts:42`) throws `ir.capability` for an adapter without `rebuild`. Probe 01(b): a native pass
  over such an adapter is refused with "Adapter adapter.probe-toy is not Rewritable".
- *Change.* `ctx.edit` becomes a getter that opens the draft on first access. Afterwards, an unopened edit means
  the pass made no edit.
- *Results.* Unchanged for every existing pass. Typed's passes return native values and simply stop opening an
  unused draft.
- *Simplest alternative.* Write `rebuild` for the Tix adapter, roughly 50 lines of graph-to-native code plus the
  risk of a lossy round trip, only to satisfy a call the pass never uses. That is designing around the problem.

**F2: `applyPassSync`** (same file).

- *Finding.* Probe 01(a): `applyPass` returns a Promise, and so does every `AnalysisManager` gate. The fixed
  `optimizeTix` is synchronous. Probe 01(c): `runDifferential` and a differential invariant's check are
  synchronous.
- *Change.*
  `applyPassSync(pass, before, { params?, gate?: (after, correspondence) => CheckResult }): PassResult`.
  - It throws if the pass declares `needs` or `preserves` (they need the manager) or if `run` returns a thenable.
  - A failing gate throws `PassError('contractRejected')`, as `applyPass` does.
  - The code after `run` (unchanged shortcut, native artifact, `diff`, `makeCorrespondence`, `undeclaredWrites`)
    moves into one internal function that both entry points call. `applyPass`'s behaviour does not change.
- *Simplest alternative.* A domain-local loop over the framework primitives. It would copy about 40 lines of
  `applyPass`, which have already had fixes (IRWB-004's no-op shortcut), and the copy would drift. Blocking on a
  worker thread with `Atomics.wait` would keep `applyPass` but is far heavier.
- *Limit.* A synchronous gate does not record facts in a manager. The async path stays available, and a test
  checks that it gives the same verdicts.

**F3: per-case measure in differential evidence** (`src/framework/contracts/differential.ts`).

- *Finding.* `DifferentialEvidence` has counts and counterexamples (reasons of disagreeing cases only). For an
  accepted tolerance check it says "24/24 agree", whether the worst case was at τ/1000 or at 0.99τ.
- *Change.*
  - `CaseComparison` gains an optional `measure` (a finite distance; larger is worse).
  - `Decided` agree and disagree carry it, so memo replay and worker decisions keep it.
  - `DifferentialEvidence` gains an optional `worst: {measure, case}`, the largest measure among decided cases.
    It is present only if some comparison returned a measure.
  - Typed's comparisons return booleans, so its evidence stays the same object as today.
- *Simplest alternative.* Compute margins in a test with a copy of the relation. That measures a copy, not the
  check that accepted the pass, and the evidence `optimizeTix` returns would still hide the margin.

**Observations that need no change.**

- The `writes` check is only as fine as the projection, which here is statements (§4.3).
- `differential`'s two-sided `run` carries the f64 reference on the baseline side without any change.
- `node --test tests/framework/` fails on Node 24.18 with `MODULE_NOT_FOUND`, because the directory is taken as a
  module. `node --test tests/framework/*.test.mjs` passes 225 of 225 on this branch before any change.

## 10. Probes run for this design

| Probe | Result |
|---|---|
| `npm run build` in the worktree | builds into `dist/` (node_modules resolves from the repository root) |
| 01(a) `applyPass(...) instanceof Promise` | `true` |
| 01(b) `applyPass` with a native pass on an adapter without `rebuild` | throws `IRError` `ir.capability` "Adapter adapter.probe-toy is not Rewritable" |
| 01(c) `runDifferential` and `invariant.check` without a manager | synchronous; `agree 3/3` |
| 01(d) `createIRArtifact` on nested JSON expression trees | accepted |
| 02 f32 behaviour | `Math.fround(0.1) = 0.10000000149011612`; `Object.is(-0, 0) = false` |
| 02 normwise error vs f64 (max over 200 trials) | seq/blocked: n=2: 1u/1u; n=5, one row: 133u/133u (bits never differ, as predicted for n ≤ B+1); n=16: 4.2u/2.9u; n=512: 20u/9.1u; n=1728: 45u/17u |
| 02 smallest effect of one dropped term | 1.55·10⁻³ (n=5, one row); 1.09·10⁻² (n=1728) |
| 02 rows whose f32 bits differ (blocked vs sequential) | n=8: 357/800; n=16: 2030/3200; n=1728: 3101/3200 |

## 11. Tests, by where the risk is

1. **The evaluator defines the meaning that every check compares against**, so it carries the most risk. For
   each corpus program, the test has a hand-written JavaScript f32 implementation that follows the definition
   literally (fround after every operation, the same order), and compares it bit for bit with `runTix` on several
   random shapes; f64 is compared the same way. Small hand cases cover the accumulation order, the `−∞` start of
   `max`, and the rounding of literals and shape values.
2. **Checker.** The corpus compiles. Each check in §3.2 has a failing example whose error message has the
   expected `line:col`. Also covered: the `max` disambiguation and where a reduction body ends.
3. **Contract and passes.**
   - On matmul, `split-sum` is rejected under `exact` and accepted under `tolerance`.
   - On every corpus program, `split-sum` is accepted under `tolerance` with 0 inconclusive cases and
     `worst < τ/4`.
   - `inline` is accepted under `exact` wherever it applies.
   - `inline-wrong` is rejected on attention and mlp; `split-sum-wrong` is rejected on matmul.
   - Both orders of `optimizeTix(p, ['inline', 'split-sum'])` are accepted, and the optimized program runs.
   - The async path (`applyPass` with `AnalysisManager` and `meaningContract`) gives the same verdicts as the
     sync path.
4. **Framework changes.**
   - F1: a native pass on a non-rewritable adapter succeeds.
   - F2: `applyPassSync` gives the same `PassResult` fields as `applyPass` for one pass; a failing gate is
     `contractRejected`.
   - F3: `worst` is present with measures and absent without them.
   - These tests live in `tests/tensor/framework.test.mjs`, so no existing test is modified. After the change,
     run `node --test tests/framework/*.test.mjs`, then the Typed tests that use `applyPass` or `differential`:
     `passes`, `meaning-memo`, `parallel`, `f32`, `audit`, `mutate`, `rules` and `ssa`.

## 12. Implementation plan

1. F1, F2 and F3 with their tests. Run the framework suite and the Typed tests listed above.
2. `ir.ts`: types, affine helpers, validator, adapter.
3. `syntax.ts` and `check.ts`, the corpus, and the checker tests.
4. `evaluate.ts` and the evaluator tests.
5. `contract.ts`, `passes.ts` and `index.ts`, with the contract and pass tests.
6. Diary, changelog, commit.

## 13. Left out, and why

- **A printer for IR** (guards and `div` have no Tix syntax). Tests compare IR values structurally, and
  `describe` labels statements by `tensor[indices]`.
- **Analyses through the manager** (`needs`, `preserves`). The sync path cannot run them, and use counts are
  cheap to compute inside `inline`.
- **`subjectKey` memoisation and the strategy bridge.** Nothing in this stage needs them.
- **Splitting `max` reductions and multi-index sums.** Not asked for.

## 14. Later

- A `rebuild` for the Tix adapter, when a pass edits the logical projection or uses the framework's patterns.
- Expression-level entities in the projection, when a pass needs finer `writes` or correspondence.
- An rfactor-style split into a partial-sum tensor, for a two-kernel GPU reduction.
- Shape constraints such as `H ≥ KH` in the bounds check.
- CUDA lowering, fusion, tiling and attention rewrites (later stages; not designed here).
