---
Title: Diary
Ticket: IRWB-020-E
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
LastUpdated: 2026-11-26T12:48:04.202171192-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: Locate the boundary between sampled checks and pass application

The evaluator and sampled relation fit v6 without putting numerical policy into the framework. The mismatch appeared one layer higher: Typed can await `applyPass`; the fixed tensor API cannot. The design proposes sharing candidate preparation rather than introducing a second manager.

### Prompt context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-E. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-E:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-E. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

**Interpretation and intent:** Establish a reviewable experiment in reuse. Stop before implementation.

### What I did and why

Read the framework READMEs, `define-pass.ts`, `differential.ts` and the Typed pass/evaluator/project entry points at `19ad269`. Compared the native pass lifecycle and the standalone synchronous case runner to determine where a change actually belongs. Created the ticket, design and tasks with docmgr.

### What worked

A Node v24.18.0 probe with the nine input values in the design, f32 rounding after every add and width four, printed `1.25 1.2500001192092896 1.2500001192092896` (sequential, blocked, double). This witness distinguishes the relations without relying on random luck. `docmgr doctor --ticket IRWB-020-E` passed.

### What didn't work

No failing probe. No compiler build or implementation tests this turn.

### What I learned / what was tricky

`runDifferential` already accepts different baseline and subject observations. The subtlety is retaining an exact local obligation after an approved approximate edit while still checking against the original. One baseline alone cannot express both requirements.

### Second pair of eyes / next step

Review the restricted synchronous gate, shape-domain constraints, and exact-vs-tolerance policy for mixed pipelines. Await review before writing code.

### Review instructions and technical details

Start at the [framework change ledger](../design-doc/01-stage-1-design.md#framework-change-ledger). Compare `applyPass`'s native-result branch with `runDifferential`'s side-specific callback. The delivery section lists the intended gates, not tests already passed.


## Step 2: Review boundary

Accepted every review item. The contract now enumerates concrete bindings in order, samples positive parameters (eps:f32[1]), and uses only one relation per step. Plain input axes bind symbols. The sync gate takes an existing Pass, not a second pass spec. The design diff is the review checklist. Next implement, build and test using globs.

### User prompt for Step 2 (verbatim)

````text
A reviewer has read your design for IRWB-020-E. The review:

# Review of your design

## Must change

1. **Positive inputs and non-finite references.** "positive samples for log/sqrt" gives no rule for which parameters feed `log` or `sqrt`, and layernorm's eps form is unspecified. Together with "Fail closed if a required reference/candidate is nonfinite", a signed eps makes `sqrt(var + eps)` NaN and rejects the correct `split-sum` on a corpus program. State the eps form and the positive-sample rule in terms of the signature, or define how a non-finite origin reference is handled.
2. **Shape domain.** "Try shape bindings cycling through 1, 3, 4, 5, 9 and unequal per-axis permutations" does not say which assignments are generated, in what order, or how many are kept per function. Write the enumeration down.

## Cut

1. "Also check every candidate against original program: exact until an approximate step is accepted, tolerance thereafter (carry this state with the handle across calls)". Inline's exact check against its immediate input, on the same origin-derived cases, already implies this check. The extra check and its state can go.
2. "Parameter shape expressions define a linear system in shape names … at call time solve against actual dimensions", and "Carry unresolved shape-only inequalities as domain constraints on concrete shapes". No corpus program needs this. It adds a call-time error contract beyond compile errors with `line:col`.
3. "Measure deviations on corpus; report outliers rather than increasing threshold". This is a measurement plan, not stage-1 design.

## Framework changes

- **Shared native-candidate preparation plus a synchronous checked-native application:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It belongs in `define-pass.ts`.
- **"Give it a restricted spec type (pure native function of `before` and view; writes, IR, adapter)":** not minimal. `definePass` already carries this metadata. Take a `Pass` and refuse `needs` and `preserves`.
- No missed change: the design does not call the async `applyPass` on a read-only adapter.

## Keep

Keep the nine-element witness with its 0.25 tail inside the domain (`1.25` against `1.2500001192092896`, verified), which catches both the reassociation and a dropped partial block. Also keep the elementwise, fail-closed comparison against the untransformed origin's f64.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-E:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
````

## Step 3: Checked indexed representation and execution

Implemented lexical binder IDs, affine composition and bounds checks on each revision, a read-only v6 projection, and precision-parametric row-major evaluation. `npm run build` passed after installing locked dependencies. No source translation via Typed. Next wire the sampled gate and run independent oracles.

## Step 4: Synchronous native acceptance

At front-end checkpoint `e0e2556`, the read-only adapter fit the native-result path but not the async edit lifecycle. Shared candidate preparation and write enforcement in `define-pass.ts`; the synchronous caller supplies the semantics callback. The expression fixture exercises rejection before publication, unsupported clauses and async checks. `node --test tests/framework/*.test.mjs` passed 226/226; `node --test tests/typed/{passes,inline,meaning-memo,strategies}.test.mjs` passed 26/26. No escalation required.

## Step 5: Differential witnesses and corpus qualification

Wired both passes through the native gate from `adb8fab`. The nine-lane case distinguishes sequential f32 (1.25) from blocked f32 (1.2500001192092896); the latter agrees with origin f64. The same gate rejects a truncated final block and a transposed inline substitution. The six corpus programs also have independent numerical oracles.

`node --check tests/tensor/corpus.test.mjs` initially found `SyntaxError: Unexpected token ')'` in the conv2d oracle; removed the extra closing parenthesis. Final `npm run build` succeeded; `node --test tests/tensor/*.test.mjs` passed 17/17. The built index exports exactly compileTix, optimizeTix and runTix. See Step 4 for framework and Typed checks. Ticket doctor passed; no full-suite run. Remaining limitation: the deterministic finite test domain is evidence, not proof for all shapes or data.

## Step 6: Replay the independent evaluation's only rejection

On the evaluated implementation (`a0277f9`), program 39 fails the declared lane-wise accuracy requirement. The same comparison fails without applying any pass. This distinction is not visible in the public acceptance bit; the ticket replay calls the existing gate and inspects the counterexample it rejects.

### User prompt (verbatim)

````text
Stage 1 of IRWB-020-E has been evaluated independently. Your results:

- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision `a0277f9`): 25/25 passed.
- **Differential cross-check:** 60 random programs in the fixed core, 3 inputs each, compared with an independent reference evaluation. f32 results bit-identical in 180/180 cases; `precision: 'f64'` results within 1e-9 (relative to max(1, |r|)) in 180/180.
- **`optimizeTix(p, ['inline'])`** on the same 60 programs: accepted on 60, and every accepted result is bit-identical to the original.
- **`optimizeTix(p, ['split-sum'])`:** accepted on 59/60, and every accepted result computes the same function (f64 run within 1e-9).
- **`split-sum` was rejected on 1 program(s):** 39. Every program is valid and the pass is correct on each, and plain f32 evaluation of these programs stays within 3.7e-7 of f64 (relative to max(1, |r|)) on the evaluation's inputs. So each rejection is a false rejection unless your contract found a real violation. Source:

```
fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[C] {
  t0[i0] = (sum(r1, r2) -(v[i0] / (v[i0] * v[i0] + 1)) * u[r1] - u[r2]);
  t1[i3, i4] = (sqrt(v[i4] * v[i4] + 0.5) - (sum(r5) v[i4] + v[r5])) / C - u[i3];
  t2[i6] = u[i6] - -u[i6];
  t3[i7] = (sum(r8) (sum(r9) C - v[r9]) + (t0[i7] - x[r8, i7]));
  return t3;
}
```

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
3. **Commit** (message starting `IRWB-020-E:`). Final message: the report's path, the commit hash, and one line per failure cause.
````

### Diagnosis and evidence

- Ran `node ttmp/2026/11/26/IRWB-020-E--*/scripts/01-replay-39.mjs`. One disagreement out of 20, seed 20, `(C,N)=(4,5)`, coordinate pattern, lane 0. Public optimization retained the original. Running `verify('tolerance', origin, origin, origin)` produced the identical counterexample.
- `src/tensor/passes.ts:34` leaves `t0`'s two-axis sum intact. `src/tensor/evaluate.ts:105` rounds its ordinary sum updates. Returning `t0` in an inspection copy measured −14.226834297180176 (f32) vs −14.226831896551728 (f64). The outer sum reuses this five times while cancelling against 14.421875. Dead statements `t1` and `t2` do not contribute to `t3`.
- `src/tensor/contract.ts:84–85` compares absolute error to `2e-6 + 2e-5*abs(reference)`; `src/tensor/index.ts:41` selects tolerance for split. Exact diagnostic: `lane 0: |-0.19665948275863876 - -0.1966714859008789| = 0.000012003142240146758, bound 0.000005933189655172776`. Original and split f32 returned identical values on the failing lane. A true counterexample to the output-accuracy relation on our samples, not to rewrite correctness. No other independent failures were reported.

### Review and follow-up

Read [the report](02-report.md), then run the replay above. The independent cross-check and the local replay use different inputs. A rejection diagnostic should report origin f32 as well as candidate f32 and reference f64 to avoid misattribution. No evaluated source, test or corpus file was changed.
