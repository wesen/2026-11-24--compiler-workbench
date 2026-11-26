---
Title: Diary
Ticket: IRWB-020-C
Status: active
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: analysis
Intent: short-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/index.ts
      Note: Fixed synchronous API
    - Path: repo://src/tensor/meaning.ts
      Note: Case sampling and numerical relations
    - Path: repo://tests/framework/native-pass-sync.test.mjs
      Note: Framework native-pass checks
    - Path: repo://tests/tensor/passes.test.mjs
      Note: Numeric and mutation witnesses
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:39:58.974572318-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1 — Trace the native pass and write the stage 1 design

I traced Typed's origin check through the v6 pass, contract and IR layers. Tix can reuse
the artifact and differential machinery. The fixed synchronous optimizer needs a native
pass entry point that shares the existing validation and write checks.

### Prompt context

The user asked for the stage 1 design and a review checkpoint before implementation.
The authored request follows verbatim.

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-C. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-C:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-C. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
~~~~

### What I did and why

- Read the framework's contracts, IR and strategy docs and followed Typed's
  `typedPass`, `optimizationContract`, `meaningKept` and `runPipeline` code.
- Created the docmgr ticket, design and diary. The design proposes a synchronous native
  pass entry point with a mandatory gate and a shared v6 candidate-preparation path.
- Used the existing differential runner to check the planned rounding witness. This isolates
  the two numerical relations before adding parsing, indexing or evaluation.

### What worked

- `npm ci --offline --ignore-scripts --no-audit --no-fund` and
  `node node_modules/typescript/bin/tsc -p tsconfig.json` succeeded.
- On Node 24.18.0, creating and opening artifacts, applying a native pass through the
  existing async API with a rebuild-capable adapter, and running a differential invariant's
  spec synchronously all worked. The native pass returned a promise. The signed zero probe
  confirmed raw f32 word `0x80000000` and identical core canonical keys for either zero.
- The linear and blocked results were `1.25` and `1.250000238418579`. The f64 reference
  matched the blocked value. The existing differential runner reported disagreement under
  exact comparison and agreement under tolerance. Dropping the tail gave `1.000000238418579`.

### What did not work

- `npm ci --offline --no-audit --no-fund` failed in the esbuild postinstall with
  `spawnSync …/node_modules/esbuild/bin/esbuild EPERM`. TypeScript built after installation
  with lifecycle scripts disabled.
- The first native pass probe used an adapter with no graph rebuild and
  `applyPass` threw `IRError: Adapter probe is not Rewritable` (`ir.capability`).
  The retest used a rebuild-capable probe adapter. Tix's proposed native path requires only
  projection.

### What warrants a second pair of eyes

Review the affine signature and extent rules, the requirement for comparable cases per
entry, and the choice to carry each function's original relation across later calls to
`optimizeTix`. The proposed framework surface intentionally scopes out synchronous
analysis transactions. Check whether that split is the right one for later domain users.

### Review checkpoint

Start with the [stage 1 design](../design-doc/01-tix-stage-1-design.md), especially
“Meaning contract and pass policy” and “Framework change.” Implementation, the corpus and
the tensor and framework test suites follow the design review. The ticket's design commit
contains this checkpoint and can be found by its `IRWB-020-C:` subject.

## Step 2 — Revise the design after review

The review tightened the synchronous pass surface and made the sampling policy
reproducible. I revised the design before beginning implementation. The native path
accepts an existing `Pass`, and inline keeps its prior relation to the origin by
matching the incoming revision exactly on the same origin-derived cases.

### Prompt context

The user supplied the review below. The implementation request follows the design revision.

~~~~text
A reviewer has read your design for IRWB-020-C. The review:

# Review of your design

## Must change

1. **Wrong `split-sum` variant.** "Mutate the block result to drop the final partial block in the test candidate. In the fixed-shape fixture, make a valid eight-column prefix with `prefix[i,d]: f32[1,8] = x[i,d+i];` and block the sum over that prefix." What the prefix fixture shows, and its expected verdict, are never stated. Define the wrong variant as a pass kernel run through the sync gate on the contract's cases.
2. **Budget.** "Fail the check if a candidate exhausts that budget on a selected case". The budget is measured "per origin case", and `split-sum` adds outer accumulation visits. A correct candidate near the cap is therefore rejected. Say how the candidate's budget is set.
3. **`NUMBER` is undefined.** "Numeric expressions accept finite JS numeric literals" admits `0x10`, `1_0` and `.5`. Give the token grammar.
4. **Case selection.** "plus seeded mixed assignments from those sizes and targeted shapes with a full block and a tail" fixes neither how many assignments there are nor how they are chosen.

## Cut

1. Inline's second check, "Check the result against the original as well … tolerance for functions where an earlier split was accepted", and "Store the set of functions that entered tolerance mode". Exact agreement with the input on the same origin-derived cases implies both.
2. "Bind shape names … by solving the affine signature equations … rational elimination" and "Record constraints that depend on concrete sizes and check them when the call binds". These add a solver and a call-time error contract.

## Framework changes

- **`applyNativePassSync` with shared native-candidate preparation:** needed, because the fixed API is synchronous, and correctly placed. As specified it is not minimal: "receives a pass ID, version, IR definition, adapter, write declarations, kernel and mandatory check" duplicates `definePass`. Take a `Pass` and refuse `needs` and `preserves`.
- No missed change.

## Keep

Keep the rule that tolerance cases are chosen "with entirely finite reference outputs independently of the candidate". Keep the 0.25-tail witness (`0x3fa00000` against `0x3fa00002`, verified), which catches both the reassociation and a dropped tail.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-C:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
~~~~

The design revision is commit `4cedbf8`.

### What changed and why

- Replaced simultaneous affine binding with direct single-name anchors. This keeps
  shifted dimensions such as `H - 2` and makes the supported signature domain explicit.
- Made bounds a compile-time obligation, with ordinary shape validation when instantiating
  tensor types.
- Specified the decimal NUMBER grammar, the sixteen deterministic shape assignments and
  the separate origin and candidate work budgets.
- Specified the tail-dropping kernel, its in-domain prefix and the expected tolerance
  rejection through the synchronous gate. Retained the original f64 reference and finite
  reference case selection.
- Marked the review complete. The implementation checkpoint will record code and tests.

### Checks

`docmgr doctor` checks the revised ticket. No implementation tests belong to this
checkpoint.

## Step 3 — Implement the checked tensor pipeline

Tix now compiles to a `tensor.tix@1` artifact with a projection for functions,
parameters, statements and their dependencies. Both evaluators use the same index
enumeration and scalar tree traversal. The optimizer applies the native kernels
through the framework and advances its artifact only after a changed revision passes
the configured comparison.

### Prompt context

See step 2 for the reviewed implementation request. The public API remains the
synchronous `compileTix`, `runTix` and `optimizeTix` from the original brief.

### What changed and why

- `src/framework/passes/define-pass.ts` adds `applyNativePassSync` over `definePass`.
  It reuses artifact creation, projection diff, entity correspondence and declared-write
  checking with the existing asynchronous path. Its required check returns a synchronous
  `CheckResult`. A projection-only adapter works.
- `src/tensor/` provides the lexer, parser, static shape and bounds checks, v6 artifact,
  evaluators, sampled relations and the two checked kernels. The exact gate compares
  raw f32 words against the immediate revision. The tolerance gate uses finite outcomes
  from the original f64 evaluator on the same sampled call domain.
- `corpus/tensor/` holds matmul, softmax, layernorm, attention, MLP and convolution.
  `tests/tensor/` covers the fixed API, language, arithmetic, sample coverage and pass
  witnesses. `tests/framework/native-pass-sync.test.mjs` covers the new entry point.

### What worked

- `npm run build` succeeded, and `dist/tensor/index.d.ts` has the fixed signatures.
- `node --test tests/tensor/*.test.mjs` passed all three files.
  `node --test --test-isolation=none tests/tensor/*.test.mjs` passed all 17 individual tests.
- `node --test tests/framework/*.test.mjs` passed all 18 files.
- `node --test tests/typed/{passes,inline,meaning-memo,strategies}.test.mjs` passed all four files.
- Prettier passed on the changed source and tests. `git diff --check` passed.
- The real split fails exact and passes tolerance on the specified witness. The tolerance
  gate rejects the wrong tail-dropping kernel with the same cases, and the exact gate
  rejects the wrong inline kernel's swapped axes. The 3,846-term budget regression
  shows a split can use its extra outer accumulations above the origin's work cap.

### What did not work

The first tensor run failed in `tests/tensor/passes.test.mjs`. The command
`node --test --test-isolation=none tests/tensor/passes.test.mjs` exposed
`[badResult] Pass test.drop-tail requires a native result on the synchronous path`.
Spreading the pass context in the mutant invoked the unavailable logical-edit getter.
The mutant now supplies only the artifact its delegated native kernel needs. The rerun
exercised the expected contract rejection.

### Review checkpoint

The implementation follows the revised design. Read `src/tensor/index.ts` for the
public API, `src/tensor/meaning.ts` for selection and comparison, and
`tests/tensor/passes.test.mjs` for both real and wrong pass decisions. The framework
change is limited to `src/framework/passes/define-pass.ts` and its new focused test.

## Step 4 — Diagnose the independent evaluation and publish the report

The independent evaluation targets `ce9cf4d281e6025466b198ea3061fa8edfe76f1a`.
I checked the four reported groups against the evaluated source and the checked-in
tests. Every reported check passed or was accepted. There are zero external
failures or rejections to trace, and I found no basis for disputing the results.

### Prompt context

The user supplied independently measured results and requested a report commit.
The authored request follows verbatim.

~~~~text
Stage 1 of IRWB-020-C has been evaluated independently. Your results:

- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision `ce9cf4d`): 25/25 passed.
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
3. **Commit** (message starting `IRWB-020-C:`). Final message: the report's path, the commit hash, and one line per failure cause.
~~~~

### Diagnostic findings

- Hidden acceptance reported 25 of 25 passing.
- All 180 f32 cases matched bitwise, and all 180 f64 cases met the reported threshold.
- Both pass runs reported 60 of 60 accepted. The evaluation did not report how many
  inputs actually changed. An identity returns without a comparison in
  `src/framework/passes/define-pass.ts:273` or `src/framework/passes/define-pass.ts:284`.
  The public optimizer records its acceptance at `src/tensor/index.ts:43`.
- The expected local exact rejection comes from comparing different f32 words at
  `src/tensor/meaning.ts:135` after the outer addition at
  `src/tensor/evaluate.ts:234). The tail-dropping mutation omits the ninth value at
  `tests/tensor/passes.test.mjs:36`, which exceeds the comparison bound at
  `src/tensor/meaning.ts:145`. The swapped-axis mutation at
  `tests/tensor/passes.test.mjs:77` triggers the exact comparator at
  `src/tensor/meaning.ts:135`. These are local contract tests with expected rejection
  outcomes. The independent evaluation reported no such rejection.

### Verification

`npm run build` and `node --test --test-isolation=none tests/tensor/passes.test.mjs`
passed. All five focused tests passed. The report distinguishes those locally
repeated tests from the independent results as supplied by the user. With zero
reported external failures, no reproduction script was needed.

The [final report](../reference/02-report.md) records the domain, design, evaluation,
and what I would change about verification and reporting. This checkpoint changes
ticket documentation only.
