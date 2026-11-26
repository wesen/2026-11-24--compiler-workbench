---
Title: Diary
Ticket: IRWB-020-K
Status: active
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: reference
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T12:55:57.603011084-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Design Tix and identify framework gaps

I traced Typed's path from an immutable artifact through a native rewrite and a sampled meaning contract. Tensor definitions and both comparison relations fit that model. The mismatches are in applying a native pass to a read-only adapter and returning the checked result synchronously.

The [stage 1 design](../design-doc/01-tix-stage-1-design.md) proposes additions at those boundaries. No framework or tensor code was changed; the design is waiting for review.

### Prompt context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-K. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-K:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-K. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

**Assistant interpretation:** Deliver a reviewable design and commit only; treat any needed framework changes as the experiment's main result.

**Inferred user intent:** Compare another domain against the same artifact, pass and verification abstractions without expanding the stage into a GPU compiler project.

### What I did

- Read the framework contracts, IR and strategy READMEs, followed `typedPass`, `optimizationContract` and `runPipeline`, and inspected `differential()`, `applyPass` and edit construction on the design's base revision `19ad269`.
- Created the ticket, design and diary with `docmgr`. Specified the check/evaluation boundary, IR, contract domain and observations, mutation tests, corpus and regression plan.
- Used an inline Node 24 arithmetic probe to confirm the rounding witness before selecting the tolerance example.

### Why

A fixed origin prevents approximate checks from comparing against progressively degraded revisions. Exact local checking on `inline` also prevents a previous accepted split from making an unrelated exact optimization fail. Keeping both relations as `differential()` comparisons leaves tensor arithmetic and sampling in the domain, not the framework.

### What worked

Node `v24.18.0` ran the probe via `node --input-type=module -`. For block size 4 and the design's nine-element input, sequential/split output bits were `0x3f900000` and `0x3f900002`; f64 was `1.125000238418579` and the bound was `0.000024500004768371586`. Dropping the partial block would produce `1.000000238418579`. `DataView` preserved `-0` as `0x80000000`; `0x7fc00000` read as NaN. The same probe confirmed BigInt precision beyond the JS safe-integer range. This is arithmetic evidence only.

### What didn't work

The arithmetic probe passed. The first `docmgr milestone record --ticket IRWB-020-K --operation-id stage-1-design-ready` invocation passed an inline JSON array to `--evidence-file`; this binary treated it as a file path and returned `Error: open [{"kind":"design","path":"doc:/design-doc: no such file or directory`. Retrying without optional `--evidence-file` committed milestone receipt 1. `docmgr doctor --ticket IRWB-020-K --stale-after 30` reported all checks passed. Build and test suites are deferred to implementation; nothing in `src/` changed in this checkpoint.

### What I learned

`differential()` already calls domain-specific comparison code and returns a plain result unless delegated case execution is configured. The split tolerance therefore does not require a new framework assurance category. The synchronous path should still report sampled evidence for both relations.

### What was tricky to build

`applyPass` unconditionally opens a draft, and `Edit` requires `rebuild`. Making a read-only adapter falsely claim that capability would obscure one finding. Providing a synchronous verifier for pure relational postconditions is smaller than making the effectful `AnalysisManager` transaction lifecycle run synchronously.

### What warrants a second pair of eyes

Check the supported pure-verifier subset, whether the shape-dependent preflight is the intended reading of the fixed core, and whether the tolerance budget and fail-closed observations are appropriate. Review the arithmetic example as a discriminating test, not a general roundoff bound.

### What should be done in the future

After the reviewer responds in this session, update the design with the decisions and implement stage 1. Do not start CUDA or later optimization stages.

### Code review instructions

Start with the design's framework ledger, then inspect `applyPass` and `Edit` in the related files. Read the meaning contract and witness together to see precisely what the proposed checks do and do not establish. The implementation validation commands are in §6.

### Technical details

The probe used `xs.reduce((s, v) => Math.fround(s + v), 0)` over a `Float32Array` and over the three independently rounded block totals. It checked each result as a word using `DataView.setFloat32`/`getUint32` with matching byte order. The origin f64 reference used ordinary double addition in source order.

## Step 2: Narrow the design after review

I replaced the proposed synchronous contract evaluator with a `CheckResult` gate backed by the existing differential runner. The revised shape checker proves subscript bounds statically, with no coupled solver or stored access guards. `inline` checks the immediate input on origin-derived cases; `split-sum` compares with the origin f64 reference.

### Prompt context

**User prompt (verbatim):**

```text
A reviewer has read your design for IRWB-020-K. The review:

# Review of your design

## Must change

1. **Layernorm always fails tolerance.** The design combines "`layernorm` with gamma, beta and `eps[0]`", the inputs "signed zeros, seeded signed values in `[-1,1]`", and the rule "Nonfinite observations reject the tolerant check". Zero inputs give `0/sqrt(0)`, which is NaN, and a negative eps gives NaN too. So the correct `split-sum` on a corpus program is always rejected. Constrain eps, or define how a non-finite origin reference is handled.
2. **Undefined invariant.** "an interface/shape-obligation invariant" is never specified. Say what it checks and on which ports, or drop it.
3. **Budget.** "Reject a changed candidate if … an evaluation exceeds the check budget". Cases are screened on the origin, and `split-sum` adds fold steps, so a correct candidate near the cap is rejected. Say how the candidate's budget is set.
4. **Case selection.** "seeded mixed choices from the same set … Include unequal axes, zero/one extents and lengths around block boundaries where legal". No rule says how the shapes are chosen or how many there are.

## Cut

1. "whether an approximate change has been accepted" and inline's extra origin checks ("it also uses the origin as the exact baseline … additionally checks the origin in f64"). Exact agreement with the input on the same origin-derived cases already implies both.
2. "a full-column-rank system handles `N`, `2*N+1`, and coupled equations", "retain any remaining shape-dependent conditions for call preflight" and "Keep source shape obligations across rewrites". These add a solver and a call-time error contract.

## Framework changes

- **Native-only `definePass` mode:** needed. `applyPass` opens an edit eagerly, and your sync/async parity tests use a read-only adapter. Minimal and correctly placed.
- **`applyNativePassSync`:** needed and correctly placed.
- **`verifyPureTransformationSync` in `contracts/`:** not needed. A differential invariant without `decide` already checks synchronously, and `runDifferential(differentialSpec(inv), ports)` gives the verdict, so a `CheckResult` gate suffices. A second contract evaluator would have to track the manager's semantics.

## Keep

Keep the nine-element witness in the domain (`0x3f900000` against `0x3f900002`, verified). Keep the rule that mutants must reach the real contract on valid IR.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-K:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
```

**Assistant interpretation:** Commit the review response before writing code, then implement and validate the revised stage.

**Inferred intent:** Isolate the smallest framework change that lets Tix run checked passes, and make the experiment reproducible on the corpus.

**Prior commit:** `8002cc37301fdbec3cdfe01398955984782258b0` — design submitted for review.

### What I did and why

- Defined signature equality between origin and candidate. The public shape interface is structural; the differential check is numerical.
- Specified uniform and mixed shape trials, deduplication, positive corpus `eps` inputs, and an eightfold work-budget margin for the candidate.
- Dropped the general solver, persisted guards and approximate-history flag. Direct one-name affine binding still supports an input extent such as `2*N+1` without simultaneous equations.

### What worked / what didn't

`npm ci --no-audit --no-fund` installed the pinned dependencies; npm warned about the esbuild postinstall approval. This commit only changes docs, so no compiler tests yet.

### Review and resumption

See design §§1, 3 and 5 for the decisions. Next: build the checked IR and evaluators, then exercise the new pass mode and the two gates.

## Step 3: Add the two native pass hooks

The framework now distinguishes native-only passes from edit-backed passes. Both runners create and verify the same candidate, but the synchronous runner takes a host verdict rather than starting a semantic manager transaction.

### Prompt context

See Step 2. Revised design commit: `dcf0145`.

### What I did and why

- In `src/framework/passes/define-pass.ts`, added the native pass mode without a draft, and a runner that requires a synchronous `CheckResult` gate for changed artifacts. Fact and resource lifecycle remain on the existing async path.
- Shared native candidate creation, correspondence and write checks. The sync gate reuses the framework's `Check` validator and snapshots evidence; it does not evaluate `TransformationDefinition` clauses or report managed facts.
- Added `tests/framework/native-pass-sync.test.mjs` for parity on a read-only adapter, no-op behavior, undeclared writes, gate rejection, invalid and async verdicts, and refusal of manager-only features.

### What worked / what didn't

The first `npm run build` failed with `TS2322` and `TS2345` because the shared pass context's `records` lost its mapped generic type. Using the runner's existing `PassRunContext['records']` type at the context boundary fixed it. The three new framework tests passed; the full framework glob passed (228 tests), and the pass, evaluator/analysis, audit, and strategy Typed regressions passed (21 tests).

### Review instructions

Start at `applyNativePassSync` and compare its candidate preparation to `applyPass`. Confirm that `CheckResult` is a verdict from the host, not an alternate manager implementation. Existing edit-backed passes still get their draft and take the original async contract path.

## Step 4: Implement Tix, its meaning gates and the corpus

The fixed API now parses and statically checks Tix, constructs a read-only v6 tensor artifact, and interprets that artifact in either precision. The two native passes use the reviewed synchronous gate and the existing differential runner. The corpus covers all six requested programs.

### Prompt context

See Step 2. Framework commit: `3b538e2`.

### What I did and why

- Implemented affine checking, lexical index binding, scope and shape validation in `src/tensor/`, with bounds checked before creating an artifact. It stores neither call-time access guards nor typed-array payloads. A row-major interpreter shares the loop logic between f32 and f64.
- In `meaning.ts`, used the review's origin-derived case schedule, positive `eps`, explicit signature equality and separate admission/execution budgets. `inline` compares immediate f32 output words; `split-sum` checks origin f64 within the fixed bound. Proved neither relation beyond those sampled calls.
- Tested the two malformed rewrites as valid candidates: wrong scalar substitution and max of partial sums. Both reached the real gate and were declined. On the nine-element fixture exact rejects the same candidate that tolerance accepts (`0x3f900000` vs. `0x3f900002`). Corpus tests compare against independent JS formulas and show that layernorm now accepts a changed split candidate.
- Recorded one conservative implementation refinement in the design: skip an `inline` substitution if the composed affine expression overflows or its bounds proof is lost. No runtime guard or larger solver is needed. For zero-width attention heads the corpus uses `sqrt(max(D,1))`; this is ordinary `sqrt(D)` when `D>0` and keeps the empty dot product finite.

### What didn't work

- The first `npm run build` also reported `TS2556` on spreading a dynamic array into a union of unary/binary Math call signatures and `TS2345`/`TS18046` on the IR projection's expression field. I lowered the two call arities explicitly and typed the projection's records as `Param | Stmt`.
- The first combined `node --test tests/tensor/*.test.mjs tests/framework/native-pass-sync.test.mjs` had one failure: the exact test's predicate expected the specific witness in the retained examples, but got `[contractRejected] Pass tensor.split-sum output rejected: 128/140 sampled cases agree`. Earlier random cases had already filled the five-example limit. I pinned the discriminating test to shape `[1,9]` and kept dynamic and zero-length cases separately.
- The new affine composition test initially failed with `1:4: no parameter axis binds shape name 'M' independently`. The fixture now includes a bare `M` axis as required by the reviewed design; the regression tests the proof limitation rather than invalid source.

### What worked

- `npm run build` passed. `node --input-type=module -` confirmed that `dist/tensor/index.js` exports exactly `compileTix`, `optimizeTix` and `runTix` and that optimization returns synchronously.
- `node --test tests/tensor/*.test.mjs`: 21 passed. `node --test tests/framework/*.test.mjs`: 228 passed. `node --test tests/typed/{passes,evaluate-analyses,audit,strategies}.test.mjs`: 21 passed. The last repeat used the dot reporter; no full-suite run or sandbox escalation was needed.
- Prettier passed for changed source and tests; `git diff --check` passed.

### Review and remaining limits

Start with `src/tensor/index.ts` for the API, then `tests/tensor/passes.test.mjs` for the exact/tolerant witness and mutation checks. The shape checker intentionally does not solve coupled dimension equations, and the contract can decline valid changes when its bounded domain cannot supply sufficient observations. CUDA and later optimizations remain out of scope.
