---
Title: Diary
Ticket: IRWB-020-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:48:01.4150109-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Design for review

I traced how Typed passes reach the v6 artifact, adapter and meaning checker, and checked where the fixed
synchronous Tix API would not fit that route. The resulting proposal keeps the tensor IR and numerical
comparison in the domain; only the synchronous checked-pass path needs new framework support.

This is the review checkpoint. No Tix or framework code has been changed. The direct arithmetic witness was
verified in Node 24; it is not evidence of pass acceptance until the passes and contract are implemented.

### Prompt Context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-G. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-G:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-G. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

**Assistant interpretation:** Deliver a design, docmgr workspace and diary on the current branch; pause for
review before implementing anything.

**Inferred user intent:** Use a genuinely different domain to identify what the shared framework already
supports and what it lacks, while testing meaningful differences in floating-point equivalence.

### What I did

- Created the ticket, [design](../design-doc/01-tix-stage-1-design.md) and this diary with `docmgr`.
- Read the contract, IR and strategy READMEs; traced `typedPass`, `runPipeline`, and the differential checker to
  `applyPass` and `AnalysisManager`. Checked artifact snapshot rules and the framework test example.
- Described the contract's exact/tolerance domains and negative controls, and isolated the proposed framework
  changes in a table for review.

### Why

`applyPass` and `AnalysisManager.verifyTransformation` return promises even for synchronous kernels. A restricted
synchronous pass route reuses structural checks without a second transactional manager or a tensor-local bypass.
The numerical relation is already pluggable in `differential()`, so it belongs in Tix, not in the framework.

### What worked

- On Node v24.18.0 a `node --input-type=module -e` probe used `Float32Array.of`, an add loop rounding with
  `Math.fround`, and a `Uint32Array` view. For `[1,0,0,0,2**-24,2**-24,2**-24,2**-24]`, sequential and
  block-of-four sums yielded `0x3f800000` and `0x3f800002`; the latter equalled the JS double sum. The
  probe also verified the word view distinguishes `-0` from `+0`.
- A second Node probe verified exact integer intermediates beyond the safe-number range using
  `p = 9007199254740991n`, checking `(2n * p - 1n + 1n) / 2n === p`.
- `docmgr doctor --ticket IRWB-020-G --stale-after 30` reported “All checks passed”.

### What didn't work

No failed design probes. A batched `functions.edit` on `index.md` failed with `Could not find edits[2]`
(the template footer did not match); a short exact match applied successfully. The design edit tool likewise
reported `Could not find edits[3]` for an extraneous no-op replacement; the intended edits succeeded without it.
Build and repository tests are deferred until implementation.

### What I learned

Finite JSON and the existing adapter projection fit resolved index notation without changing core storage. Keep
signed zero and NaN in evaluator arrays; retain raw bit patterns as finite evidence, not as JSON floats.

### What was tricky to build

Exact inline must preserve the immediately preceding program even after reassociation. Origin-derived cases are
fixed across the pipeline; exact steps then preserve the predecessor's checked relationship to the original,
and tolerant steps compare to the original f64 directly rather than accumulating error allowances.

### What warrants a second pair of eyes

The restricted synchronous contract subset, compile-time versus call-entry shape checks, and what the numerical
sampling domain can and cannot justify.

### What should be done in the future

After review, implement the agreed design; run the tensor, framework, and affected Typed regressions and log
actual findings against the proposed framework change inventory.

### Code review instructions

Begin at the design's “Framework changes proposed” inventory; compare it against `applyPass`,
`AnalysisManager.verifyTransformation`, and `differential`. Then review shape binding and the numeric witness.

### Technical details

The exact contract compares full f32 word arrays. The tolerance proposal is the mixed elementwise bound
`8e-6 + 2e-5 * abs(reference)` over finite values of an original f64 evaluation. See the design for the sampling
budget and absence-of-coverage rule.

## Step 2: Resolve review findings

The review narrowed the framework change and exposed gaps in the shape, inline, and sampling rules.
I revised the design before starting implementation.

### Prompt Context

**User prompt (verbatim):**

````text
A reviewer has read your design for IRWB-020-G. The review:

# Review of your design

## Must change

1. **Layernorm can fail tolerance.** "signed generated epsilon may make a layernorm tolerance case nonfinite and reject", with "Reject nonfinite results for this relation". A correct `split-sum` on a corpus program would then be rejected. Constrain eps, or define how a non-finite origin reference is handled.
2. **No origin across calls.** "`TixProgram = Artifact<TensorModule>`" cannot carry the compiled program, yet the design says "Every reassociating step checks the same original f64". State where the original lives when `optimizeTix` receives an optimized program.
3. **`inline` is narrower than the brief.** "The load must give a full-axis bijection of plain, distinct consumer indices". The brief's `inline` substitutes any single-use pointwise statement into its consumer, which includes affine reads such as `t[i+1]`. Align the rule with the brief.
4. **Contradictory coverage rule.** "At least one decided case is required **per function**" conflicts with "If no shape with decided cases exists for any function, reject the changed candidate". Pick one.
5. **Case selection.** "keep up to eight valid tuples, favoring distinct/tail sizes" does not define the selection, so the implementer must invent it.

## Cut

1. "Use integer/rational arithmetic with `BigInt` internally … solve the exact equations on a call" and "retain shape-dependent bounds as call-entry predicates". No corpus program needs this, and it adds a call-time error contract beyond compile errors with `line:col`.

## Framework changes

- **`applyPassSync` with shared native preparation:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is correctly placed in `define-pass.ts`.
- **`contracts/` "new `pure-sync.ts`" and "Factor reusable named-port and check-result validation out of the manager":** not needed. Without `decide`, a differential invariant's `check` is already synchronous, and `runDifferential(differentialSpec(inv), ports)` gives the verdict a `CheckResult` gate needs. Refactoring the manager for this change is not minimal.
- No missed change.

## Keep

Keep the length-8 witness in the contract fixtures (`0x3f800002`, equal to f64, verified). Keep the negative controls, which assert that the meaning gate caused the rejection, and the exact-then-tolerance argument by induction.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-G:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
````

**Assistant interpretation:** Accept the review and implement only the revised Stage 1 after a docs commit.

### What I did and why

- Constrained scalar `eps` samples to positive `2^-10`; left nonfinite tolerance rejection intact.
- Documented a weak origin map for successive in-process optimization calls and composition of affine
  subscripts for inline. Made sampling order and per-function minimum explicit.
- Cut joint affine input solving and retained runtime range predicates from the design. The remaining call
  validation checks actual buffers; source checking still reports location-bearing errors.
- Reduced framework inventory to `applyPassSync` and shared native preparation. Reuse `runDifferential`
  directly for the meaning verdict, without changing the async contract manager.

### Evidence and review instructions

Node 24 probe confirmed the weak-map self-reference lookup and canonical `Float32Array.of(NaN)` word on this
host (`7fc00000`). `npm ci` succeeded, with only the esbuild install-script policy warning. Start at the
revised design's artifact, sampled domain and framework inventory sections.

## Step 3: Shared native pass preparation and the synchronous gate

The first end-to-end probe found that native preparation itself fit Tix, but the existing pass runner creates
an edit transaction even when the kernel returns native data. Tix has a projection and validator, not a
logical-graph rebuild. The new synchronous route does not open an edit.

### Prompt Context

See Step 2. The reviewed design is commit `00025ab`.

### What I did and why

- Factored native artifact preparation, identity reporting, and write checks in `src/framework/passes/define-pass.ts`.
  `applyPassSync` runs the host `CheckResult` callback on the validated revisions. It disallows managed clauses,
  a kernel's `edit` accessor, and asynchronous results. Async `applyPass` still uses its managed contract path.
- Added `tests/framework/sync-pass.test.mjs` for parity with async native preparation, read-only adapters,
  veto, identity, write declarations, invalid native data, and unsupported sync capabilities.

### What didn't work

After `npm run build`, a `node --input-type=module` probe calling public `optimizeTix` returned
`IRError: Adapter tensor.tix-tree is not Rewritable` (`ir.capability`). `applyPassSync` was still allocating
an unused edit via `view.beginEdit()`. After removing that allocation, the same probe inlined an affine
slice (`[4, 6]`), collapsed a chain from three statements to one, and split the length-eight witness from
`1` to `1.000000238418579`.

### What worked / review instructions

`node --test tests/framework/*.test.mjs` passed 228 tests, and
`node --test tests/typed/{passes,evaluate-analyses,meaning-memo,strategies,inline}.test.mjs` passed 31.
Review `prepareNative`, `checkWrites`, and `applyPassSync` in that order. Do not require a rebuild just to
inspect a replacement's logical projection. This finding is specific to the new entry point; the async
runner's edit capability and contract manager were not changed.

## Step 4: Tix language, evaluator, corpus and meaning checks

The public API now compiles, evaluates and optimizes a Tix artifact. All six corpus programs were checked
against independent outputs. The split-sum witness changes an exact f32 word, and the tolerant gate approves
it against original f64. Both deliberate mutations produce sampled counterexamples and retain the last
accepted artifact.

### Prompt Context

See Steps 1 and 2. Framework implementation and regressions are in `5e8fbd5`.

### What I did and why

- Built the parser, lexical extent checker, native adapter and dual evaluator under `src/tensor/`. Kept f32
  rounding in scalar operations and ordered accumulations; typed arrays never enter the artifact payload.
- Implemented affine inline, blocked sums, and their shared sampled gate. The origin weak map keeps
  tolerance pinned across calls. Tested this with two `6e-6` offsets: each would pass alone against zero,
  but the second must fail because the original budget is `8e-6`.
- Added corpus fixtures and exact/tolerance cases in `tests/tensor/`. In the pass test for a missing function
  sample, one function agrees but another is over the tensor budget, so the candidate is rejected.

### What didn't work

- During implementation, `npm run build` first reported `TS2345`/`TS2322` for a pending extent typed as
  `Affine | undefined`; converted pending binders to resolved binders explicitly. `TS2556` on a spread into
  `Math[e.fn]` led to direct unary/binary calls.
- The first `node --test --test-reporter=dot tests/tensor/*.test.mjs tests/framework/sync-pass.test.mjs`
  run had two fixture mismatches. The plain shape anchor made the wrong affine axis an `inconsistent input
  shape for 'x'` rather than `invalid binding`; tested both with separate calls. The reported counterexamples
  are capped at five, so the variable-shape mutant did not show the five-element tail in its receipt. Used a
  fixed length-five fixture for that negative control.
- A Node module probe on the `N-M`, `M-K`, `K-L` chain with all names anchored compiled, but flattening
  the two loads failed with `1:102: cannot prove affine subscript 1 in bounds of 'x'`. The pass now leaves an
  individual producer alone if revalidating the composition hits an affine bounds or safe-integer limit.
  This limitation and its rationale are explicit in the design and covered by a regression.

### Evidence and review instructions

`npm run build` succeeded. `node --test tests/tensor/*.test.mjs` passed 32 tests. The framework and Typed
commands and results are in Step 3; no further framework changes. Start at `src/tensor/index.ts` for the public
API, `meaning.ts` for the sampling and thresholds, and `tests/tensor/optimize.test.mjs` for gate evidence. No
CUDA work was attempted and `npm test` was not run.

## Step 5: Record independent evaluation and publish the report

Every result supplied for `a989925` passed. I separated those independent results from the intentional local
negative controls and inspected the gate and publication code for the distinction between acceptance and a
changed revision. There was no independent failure to reproduce or assign a cause to.

### Prompt Context

**User prompt (verbatim):**

````text
Stage 1 of IRWB-020-G has been evaluated independently. Your results:

- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision `a989925`): 25/25 passed.
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
3. **Commit** (message starting `IRWB-020-G:`). Final message: the report's path, the commit hash, and one line per failure cause.
````

### Diagnosis

- **Hidden suite:** 25/25 passed. **Independent cross-check:** 180/180 in f32 and 180/180 in f64 under the
  stated comparisons. **Inline and split-sum:** 60/60 accepted apiece, with no reported mismatches among the
  accepted outputs. There are no independent failure causes or results I dispute.
- An accepted step is not necessarily a rewrite. `src/framework/passes/define-pass.ts:270` returns an
  identity when a pass produces no candidate, and `src/tensor/optimize.ts:27` reports it as accepted. The
  independent aggregate does not specify how many artifact revisions changed.
- For contrast, the local length-eight witness changes the f32 word because of the extra accumulation at
  `src/tensor/evaluate.ts:154` and `:156`; exact comparison rejects the different word at
  `src/tensor/meaning.ts:87`. The independent f64 observation is consistent with this roundoff difference.
- The local mutants at `tests/tensor/optimize.test.mjs:110` and `:140` intentionally change the producer's
  operation or double the sum, respectively; they fail the exact check at `src/tensor/meaning.ts:87` or the
  tolerance check at `:94`. Missing coverage is deliberately reported at `src/tensor/meaning.ts:120`.
  These are not independent failures and the existing tests reproduce them without a new script.

### Evidence and review instructions

Created [the Stage 1 report](./02-report.md). On Node v24.18.0 `npm run build && node --test
--test-reporter=spec tests/tensor/*.test.mjs` succeeded (32/32 local tests). The independent aggregates are
reported as supplied, not rerun locally. `git diff --quiet a989925 -- src tests corpus` confirmed the
protected trees are unchanged. A short `functions.edit` of the generated report scaffold did not match
(`Could not find the exact text`); replaced the new scaffold with the complete report.
