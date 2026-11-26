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
