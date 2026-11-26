---
Title: Diary
Ticket: IRWB-020-I
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design decisions, probes, review and implementation checkpoints.
LastUpdated: 2026-11-26T14:50:38.372212719-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1 — Locate the pass boundary and choose a numerical witness

The design starts from the fixed synchronous API. I traced Typed's original-program check to the underlying pass runner, then ran the existing expression lab through the relevant framework calls. The measurements below use repository code and small arithmetic examples. They precede implementation of Tix.

### Prompt context

The user requested a ticket, a reviewable design and this checkpoint before implementation. The stage is an experiment in framework reuse. The ledger in the [design](../design-doc/01-tix-semantics-tensor-ir-and-checked-rewrites.md) is the place to record the eventual diff and its reasons.

<details>
<summary>Original task, verbatim</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-I. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

## Stage 1 (yours): the language, its IR, evaluators, a contract, two passes
- **Tix,** a small index-notation language, specified below. Parse it and check it (shapes, index extents, single assignment), with errors that give `line:col`.
- **Its IR as a v6 artifact** in `src/tensor/`, using `src/framework` (artifacts, IR definitions, contracts, passes). Choose the IR's form.
- **Two evaluators:** f32 (the program's meaning, defined below) and f64 (a reference for tolerance checks).
- **A meaning contract for tensor passes.** It needs a domain (which shapes and input values to check on), an observation (what is compared) and a relation. The relation is either exact (bit-identical f32 outputs) or a tolerance against the f64 reference. Choose the tolerance and justify it.
- **Two checked passes** that exercise the contract:
  - `inline`: substitute a pointwise statement with a single use into its consumer. Its f32 results must be bit-identical.
  - `split-sum`: rewrite a `sum` reduction over one index into a two-level reduction (blocks, then within blocks). It reassociates the sum, so f32 results change, and it must be accepted only under the tolerance relation.

  Show that the exact relation rejects `split-sum`, that the tolerance relation accepts it, and that the contract rejects a deliberately wrong variant of each pass.
- **A corpus** under `corpus/tensor/<name>/main.tix`, with at least: matmul, softmax (max-shifted), layernorm (gamma, beta, eps), single-head attention, an MLP block with tanh-GELU, and conv2d (NCHW, stride 1, no padding).

Later stages, which are not yours: lowering to CUDA and running it on the GPU machine, fusion, tiling of contractions, attention-specific rewrites. Do not design them. Do not let them bend this stage, beyond keeping the IR suitable for loop-level lowering.

## Tix, fixed core (implementations are compared on it)
```
program := fn+
fn      := 'fn' NAME '(' param (',' param)* ')' ':' type '{' stmt* 'return' NAME ';' '}'
param   := NAME ':' type
type    := 'f32' '[' dim (',' dim)* ']'        dim := affine expression of shape names and integers (N, D, H - 2)
stmt    := NAME '[' NAME (',' NAME)* ']' (':' type)? '=' expr ';'
expr    := expr ('+' | '-' | '*' | '/') expr | '-' expr | NUMBER | SHAPENAME | ref | call | reduce | '(' expr ')'
ref     := NAME '[' aff (',' aff)* ']'           aff := affine expression of index names and integers (y + dy)
call    := ('exp' | 'log' | 'sqrt' | 'tanh') '(' expr ')' | ('max' | 'min') '(' expr ',' expr ')'
reduce  := ('sum' | 'max') '(' NAME (',' NAME)* ')' expr
```
- Line comments are `//`. Precedence is the usual one: unary minus, then `*` and `/`, then `+` and `-`, all left-associative.
- A reduction's body extends as far right as possible, to the end of the enclosing parentheses or statement. So `sum(d) x[i, d] / D` sums `x[i, d] / D`, and `(sum(d) x[i, d]) / D` divides the sum.
- Each statement defines a new tensor, assigned once. Its left-hand index names range over extents inferred from their plain (non-affine) uses on the right. An index used only in affine positions takes its extent from the statement's declared type, which is then required.
- Reduction indices are bound by their reduction and range over extents inferred the same way. A shape name such as `D` used in an expression denotes its value as a number. A function's shape names are bound by its inputs' shapes when it is called.
- **f32 meaning:**
  - every literal, shape value, operation and function result is rounded to f32 (`Math.fround` of the JavaScript double result);
  - `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
  - Inputs are finite. Behaviour outside the valid domain (inconsistent shapes, an extent that cannot be inferred) is a check error at compile time.

Example:
```
fn softmax(x: f32[N, C]): f32[N, C] {
  m[i] = max(j) x[i, j];
  e[i, j] = exp(x[i, j] - m[i]);
  s[i] = sum(j) e[i, j];
  y[i, j] = e[i, j] / s[i];
  return y;
}
```

## Fixed API (in `dist/tensor/index.js` after the build)
```ts
compileTix(source: string): TixProgram      // throws Error whose message contains line:col on invalid source
runTix(program: TixProgram, fn: string,
       inputs: Record<string, { shape: number[]; data: Float32Array | Float64Array }>,
       options?: { precision?: 'f32' | 'f64' }): { shape: number[]; data: Float32Array | Float64Array }
optimizeTix(program: TixProgram, passes: string[]): { program: TixProgram; steps: { pass: string; accepted: boolean }[] }
```
`runTix` takes row-major data. `optimizeTix` runs the named passes in order, each checked by your contract, and returns a program `runTix` can run. Anything beyond this API is yours to design.

## Repository facts
- Build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`. See `tests/framework/core.test.mjs` for the pattern. Prettier: 110 columns, single quotes.
- Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/strategy/README.md`, and enough of `src/typed/` (for example `src/typed/passes.ts`, `src/typed/evaluate.ts`, `src/typed/project.ts`) to see how one domain uses the framework.
- Nothing checks tensor programs yet. The Typed corpus-wide tests cover only `corpus/projects`. Your tests are the only checks on your work, so put them where the risk is.
- In the sandbox, a test that spawns `node` can fail with EPERM. Request escalation for that command.
- Scope: you may add `src/tensor/`, `tests/tensor/` and `corpus/tensor/`, and change `src/framework/` where the tensor domain needs it. Record every framework change in your design. After the implementation, run `node --test tests/framework/` and the tests in `tests/typed/` that cover what you changed. Do not modify `src/typed/`, `tools/`, `corpus/projects/` or existing tests, except framework tests that your framework change makes necessary.
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-I:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-I. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).

</details>

### What I did and why

- At base `19ad269`, read the contracts, IR and strategy READMEs, then traced `typedPass`, `optimizationContract`, `meaningKept` and `runPipeline`. The split between a fixed origin and a moving current revision matters once two different numerical relations can occur in a sequence.
- Inspected `define-pass.ts`, `ir/transactions.ts` and `contracts/differential.ts`. Tested whether a pure native pass could operate through a read-only projection and whether a differential invariant could produce a synchronous verdict. These questions determine the scope of shared code changes.
- Probed a four-term block sum, an omitted tail and per-operation rounding with Node. Chose the eight-element witness because the honest rewrite differs by one f32 word and agrees exactly with the original f64 calculation.

### What worked

Node `v24.18.0` loaded the local TypeScript via `--experimental-transform-types`. A process-local `registerHooks` resolver mapped relative `.js` specifiers to the matching `.ts` sources. The minimal loader probe imported `canonical` and encoded `[-0,1]` as `[0,1]`. This resolver was used only to inspect the existing framework in a worktree without build products.

Using `src/labs/expressions.ts`, I removed `rebuild` from a copy of `expressionAdapter`, gave the copy its own adapter ID, then called `createIRArtifact` and `validateArtifact(ExpressionIR, artifact)`. Both succeeded. On that artifact, a `differential` invariant with one case, a revision observation and equality as its comparator gave an immediate `sampled agree 1` through `runDifferential(differentialSpec(inv), ports)`.

The arithmetic probe used `f = Math.fround` and `seq(xs) = xs.reduce((a,b) => f(a+b), 0)`. The blocked result applied `seq` to consecutive slices of four and then to their partials. The observed words came from a Uint32Array view of the result's Float32Array buffer.

| Input | Serial f32 | Blocked f32 | Original f64 |
| --- | --- | --- | --- |
| `1, 0, 0, 0, 2^-24, 2^-24, 0, 0` | `3f800000` | `3f800001` | 1.0000001192092896 |
| Nine ones | 9 | 9 (8 if the tail is dropped) | 9 |

Rounding the `4097*4097` product before subtracting 16785408 gave 0. Rounding only the final result gave 1. The Uint32Array view also distinguished negative zero as `80000000`.

### What didn't work

`ls -ld dist node_modules` reported `ls: cannot access 'dist': No such file or directory` and the equivalent message for `node_modules`. `command -v tsc` exited 1. The Node source probe above made a dependency installation unnecessary for this investigation.

In `node --disable-warning=ExperimentalWarning --experimental-transform-types --input-type=module`, calling `applyPass(identity, artifact, {manager: new AnalysisManager()})` with the read-only adapter returned a Promise and rejected with `ir.capability Adapter probe.read-only is not Rewritable`. The diagnostic came before the kernel's entry marker. The editor constructor requires `rebuild` even though this kernel would simply return `{native:before.value}`. Trying `immutable(new Float32Array([1]))` separately produced `IR data must be plain records or arrays`.

### What I learned and what was tricky

The shared representation can hold the program and its shape algebra as plain data. The sampled checker can evaluate each side at a different precision. The two reproducible gaps are both at the pass boundary. Keeping typed arrays inside evaluator outcomes also avoids normalizing signed zero while hashing artifacts.

An exact inline after a previously accepted split has two obligations. Its output must equal its immediate input bit-for-bit, and must still meet the original program's tolerance. The design retains both revisions and the accepted relation. The unrounded original reference is always evaluated on the same generated f32 inputs as the candidate.

### What warrants a second pair of eyes

Review the synchronous runner's native-only scope, the interpretation of an affine-only reduction binder without an axis annotation, and the sampled domain, especially nonempty coverage for every function. The numerical threshold is a proposal. The witness has been measured. Corpus execution awaits implementation.

### Review and next checkpoint

Start with the framework change ledger in the design, then the two-level fold and its two rejection examples. The code anchors in its frontmatter identify the existing runner, differential invariant and Typed integration. The next checkpoint follows the reviewer's reply in this session. Framework and Typed regression runs belong to the implementation checkpoint.

Ticket validation passed with `docmgr doctor --ticket IRWB-020-I --fail-on warning`. The Markdown links resolve within this worktree.

## Step 2 — Accept the review

All four cuts are adopted. Inline compares with its input on origin-derived cases, split-sum compares with the origin in f64, and identity skips evaluation. Each shape symbol binds directly at a parameter axis. Concrete sampler instantiation is sufficient to discard illegal shapes. The implementation keeps both reviewed changes to the pass runner.

<details>
<summary>Review and implementation request, verbatim</summary>

A reviewer has read your design for IRWB-020-I. The review:

# Review of your design

## Must change

None found. The domain, observation, both relations, the baselines, the deterministic shapes and value patterns, and the treatment of `f32[1]` parameters are specified well enough to implement without guessing. The motif `[1,0,0,0,2^-24,2^-24,0,0]` at K = 8 deterministically makes `exact` reject `split-sum` (I verified `0x3f800000` against `0x3f800001`).

## Cut

1. "Also check the candidate against the compiled origin using exact comparison until the first accepted reassociation and tolerance thereafter", together with the program's "accepted origin relation". Exact agreement with the immediate input, on the same origin-derived cases, already implies the origin check. The extra check and its state add nothing.
2. "Exact rational elimination covers signatures such as `f32[N+M,N-M]` with no bare anchor", and "At call time solve those same equations … and check redundant equations". No corpus program needs this. It adds a call-time error contract beyond compile errors with `line:col`.
3. "Symbolic restrictions that depend on call sizes describe the legal shape domain … Use these restrictions when instantiating check cases". This is a second constraint representation that exists only for item 2. Case generation can instantiate dimensions and drop illegal shapes directly.
4. "Verify an identity candidate under the already accepted origin relation". A pass that changes nothing needs no check.

## Framework changes

- **`applyNativePassSync(pass, before, verify)` taking a `definePass` pass, with shared native-candidate preparation:** needed, because the fixed `optimizeTix` is synchronous. It is minimal and in the right file. Binding the origin inside `verify` keeps domain policy out of the framework.
- **Lazy `ctx.edit`:** needed. I confirmed that the `Edit` constructor throws `ir.capability` without `rebuild`, and your sync/async structural comparison runs `applyPass` on a read-only adapter. It is minimal and correctly placed.
- No missed change.

## Keep

Keep the precise shape schedule (1, 8, 9, then 3/5/9) and the value patterns, including positive values for `f32[1]` so that layernorm's eps is valid. Also keep the per-pass baselines: exact against the input, and tolerance against the origin's f64.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-I:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.

</details>

## Step 3 — Share native candidate preparation

Design revision `0ed7084` incorporated the review. Both runners now build the native revision, diff and correspondence through the same function and check declared writes. The asynchronous path opens an editor on demand. The synchronous path applies the caller's invariant only to a changed candidate.

A locked offline install initially failed during esbuild's version check with `spawnSync .../bin/esbuild EPERM`; the approved rerun of `npm ci --offline --no-audit --no-fund` succeeded. `npm run build` passed. Running `node tests/framework/native-pass-sync.test.mjs` exercised both new tests successfully, including failed write/meaning checks on a real v6 artifact.

## Step 4 — Check and execute indexed programs

The scanner and precedence parser resolve tensor reads and lexical index binders while constructing the IR. A second traversal validates the artifact and diagnoses impossible affine bounds. The same validator checks native rewrite results. The evaluator binds each expression to its inputs and loops, with f32 rounding at each operation and reduction step.

`npm run build` and the five tests in `node tests/tensor/language.test.mjs` passed. These checks include an affine transpose, two valid readings of `max(A,B) - …`, reduction order visible in f32, empty reductions, and diagnostics after a line comment. Commit `ecf9a93` contains the preceding framework change.

## Step 5 — Check transformed artifacts against the two baselines

The built index exports exactly `compileTix`, `optimizeTix` and `runTix`. The origin determines the per-function case list for both contracts. A changed inline compares to its input at f32. A changed split compares to the f64 origin. The same driver accepted both pass orders in the smoke probe.

`node tests/tensor/passes.test.mjs` passed five tests. The eight-term reduction produced the two predicted adjacent f32 words. A changed candidate omitting the ninth term failed tolerance with reference 9 and candidate 8. An inline losing negation failed in the second function, and the following honest pass used the last accepted artifact. The preceding parser/evaluator checkpoint is `d73d247`.

## Step 6 — Execute the six corpus oracles and regress the shared runner

Each corpus program passed an independent numerical check in f32 and f64, before and after the checked pass sequence. The convolution oracle uses sparse, asymmetric taps across two batches and channels. The attention fixture has one uniform row and one row whose weights depend on the scale. These cases distinguish axis, offset and normalization errors from floating-point noise.

Reviewing the native validator exposed a missing unary operand that an expression traversal could treat as a leaf. The validator now checks it explicitly, with a regression on an edited native value. Additional relation tests distinguish zero signs, reject nonfinite tolerance observations and check accumulated error against the fixed origin. Nested blocked sums were checked at zero, partial and complete block sizes. The honest and deliberately wrong pass kernels in the preceding checkpoint are exercised through the same acceptance path (commit `c6032fa`).

| Command | Result |
| --- | --- |
| `npm run build` | Passed on Node 24.18.0. The built index exports the three required functions. |
| `node --test tests/tensor/*.test.mjs` | All 3 files passed, covering 19 tests, including 6 independent corpus oracles. |
| `node --test tests/framework/*.test.mjs` | All 18 framework files passed. |
| `node --test --test-concurrency=2 tests/typed/{passes,inline,strategies,audit,ssa,parallel,f32,mutate,meaning-memo,rules}.test.mjs` | All 10 targeted Typed files passed. The concurrency limit kept the shared-machine run small. |
| Prettier check of changed TypeScript and test files, `git diff --check` | Passed. |

Stage 1 follows the revised design. The meaning verdict is sampled over the specified shape/value schedule. A changed pass needs a valid, nonempty observation for every function. GPU work remains in the later stages.

## Step 7 — Independent evaluation and final report

The independent evaluator identified revision `8b94514`. I checked that the worktree started at `8b94514f89c9bfdece735fdf52cdc091008f6388` and read the implementation and repository assertions at that revision. **The independent evaluation reported zero failures, zero mismatches and zero rejected pass applications.** There is no failing input, rejection cause or corresponding source line to diagnose. The counts below are the evaluator's supplied results.

| Check | Independent result | Relevant code at the evaluated revision |
| --- | --- | --- |
| Hidden fixed-core and API suite | 25/25 passed | `src/tensor/index.ts:12` compiles and `src/tensor/index.ts:24` dispatches execution. |
| Differential f32 evaluation | 180/180 bit-identical, from three inputs for each of 60 programs | `src/tensor/evaluate.ts:12` selects rounding and `src/tensor/evaluate.ts:54` rounds each sum update. |
| Differential f64 evaluation | 180/180 within 1e-9 relative to max(1, ∣r∣) | `src/tensor/evaluate.ts:11` selects storage and `src/tensor/evaluate.ts:12` selects the identity operation for rounding in f64. |
| Inline | 60/60 accepted, bit-identical outputs on the tested inputs | `src/tensor/passes.ts:8` substitutes index tuples. `src/tensor/contract.ts:94` reads f32 output words for exact comparison. |
| Split-sum | 60/60 accepted, f64 agreement within the reported 1e-9 criterion | `src/tensor/passes.ts:85` constructs the two folds. `src/tensor/evaluate.ts:67` clamps the inner endpoint. `src/tensor/contract.ts:104` implements the optimizer's separate f32-versus-f64 tolerance. |

The repository has intentional rejections. The exact gate detects adjacent f32 words after reassociation (`tests/tensor/passes.test.mjs:26`). The wrong inline drops a negation (`tests/tensor/passes.test.mjs:75`) and the wrong split shortens an axis to a multiple of four (`tests/tensor/passes.test.mjs:101`). They are positive tests of the verifier and are reported as such.

<details>
<summary>Evaluation and reporting request, verbatim</summary>

Stage 1 of IRWB-020-I has been evaluated independently. Your results:

- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision `8b94514`): 25/25 passed.
- **Differential cross-check:** 60 random programs in the fixed core, 3 inputs each, compared with an independent reference evaluation. f32 results bit-identical in 180/180 cases; `precision: 'f64'` results within 1e-9 (relative to max(1, |r|)) in 180/180.
- **`optimizeTix(p, ['inline'])`** on the same 60 programs: accepted on 60, and every accepted result is bit-identical to the original.
- **`optimizeTix(p, ['split-sum'])`:** accepted on 60/60, and every accepted result computes the same function (f64 run within 1e-9).

In this turn, do not change any code under `src/`, `tests/` or `corpus/`. The evaluated revision must stay as it is.

1. **Diagnose.** For every failure or rejection listed above, find its cause in your code and state it with `file:line` in your diary. Reproduce it with a script in your ticket's `scripts/` if that helps. If you think a result is wrong, say why.
2. **Write your final report** as `reference/02-report.md` in your ticket. It is for a reader who knows compilers but not this repository, and it will be published as written. Cover:
   - Tix;
   - the IR you chose and why;
   - the evaluators;
   - the meaning contract: relations, cases, the tolerance and how you justified it;
   - the two passes;
   - each framework change and why it was needed;
   - how you checked the work;
   - the evaluation results above, including every failure and its cause;
   - what you would do differently.

   Write prose first, with short code excerpts and at least one diagram (Mermaid). Aim for 2,000 to 3,500 words. Report only what you built and measured.
3. **Commit** (message starting `IRWB-020-I:`). Final message: the report's path, the commit hash, and one line per failure cause.

</details>

The [final report](02-report.md) distinguishes an accepted invocation from a changed revision. `src/framework/passes/define-pass.ts:284` returns identity for a kernel with no result, and `src/tensor/passes.ts:112` reports the accepted step. The independent summary supplies no changed-revision count. I measured it separately on the repository corpus.

`npm run build` and `node --test tests/tensor/*.test.mjs` passed on Node 24.18.0. For each of the six corpus files I applied inline and then split-sum, comparing adjacent `current.revision` values. All 12 steps were accepted. Inline changed attention and the MLP. Split-sum changed matmul, softmax, layernorm, attention and the MLP. For those five final revisions I used `samples(origin.value, seededRandom(20))` per module, ran the origin at f64 and the candidate at f32, and divided each absolute difference by `1e-5 + 1e-5 * abs(reference)`. Across 60 concrete shape/fill cases and 2,415 output elements, the maximum ratio was 0.029826323291286257. The element was MLP output 21, flat row-major, on signed data at shape bindings [8, 8, 8, 8]. Its candidate was 0.3402996063232422 and its reference was 0.3403000060854551. These are local corpus measurements, independent of the evaluator's random-program counts.
