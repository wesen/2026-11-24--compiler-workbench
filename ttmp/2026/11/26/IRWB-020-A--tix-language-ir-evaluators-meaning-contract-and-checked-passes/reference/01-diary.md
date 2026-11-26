---
Title: Diary
Ticket: IRWB-020-A
Status: active
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Stage 1 design decisions, framework probes, and the implementation handoff.
LastUpdated: 2026-11-26T12:45:58.575718124-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1. Trace the framework and design Stage 1

I followed Typed's project, pass and meaning-check calls before designing the tensor equivalents. The native v6 artifact and synchronous differential helper fit. The fixed API needs a synchronous pass gate, and the native pass path can avoid the graph reconstruction capability that the existing edit path opens before every kernel.

### Prompt context

The requested checkpoint is a design, diary and commit for review. Implementation follows that review. The experiment is to identify which parts of the framework needed to change for a second domain.

<details>
<summary>User request, verbatim</summary>

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-A. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-A:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-A. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
~~~~

</details>

### What I did and why

- Traced `runPipeline` through `applyPass`, native candidate preparation and the differential checker. Selected a native pass entry point so Tix can share diff, correspondence and write enforcement with Typed.
- Chose scalar expression trees with explicit iteration bounds inside indexed statements. Extents and binder identity remain explicit through inlining and blocked reductions.
- Designed the two relations and the corpus checks. The exact gate compares each inline with the revision it edits. The tolerance gate anchors to the original f64 result across the pipeline.

### What worked

- On base revision `19ad269`, `npm run build` and `node --test tests/framework/ext-e3-e6.test.mjs` exited successfully under Node `v24.18.0`. The rerun with `--test-isolation=none` reported all seven tests passing.
- With a rebuilding adapter, a `node --input-type=module` probe imported the built framework, verified that `applyPass` returned a Promise, and produced one native entity diff. `runDifferential` returned `disagree` for the exact relation and `agree` for tolerance on the same candidate.
- The arithmetic probe at block size four returned f32 bits `3f800000` and `3f800001` for input `[1,0,0,0,2^-24,2^-24]`. It returned `00000000` and `80000000` for positive and negative zero. On six ones, dropping the tail returned 4 against a reference of 6 and failed the proposed bound.

### What did not work

- The first arithmetic probe put both half-ULP values in the first block. The assertion comparing the two orders failed with `AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to: '3f800000'`. Moving both small terms after the first block exposed the reassociation.
- The first framework probe ran `await applyPass(rewrite, original, {manager: new AnalysisManager()})` with an adapter that omitted `rebuild`. The rejection was `IRError: Adapter probe.tensor is not Rewritable`, code `ir.capability`, from `new Edit`. Adding the trivial probe inverse let the check finish and confirmed that the design should avoid opening an edit for a native-only kernel.

### What I learned

Bit-identical comparison still uses sampled evidence. The relation can be exact for each observed output while the suite gives no universal equivalence proof. The sample generator, precision modes and tolerance belong in the domain, while candidate preparation belongs in the framework.

### What was tricky

A fixed origin serves as the tolerance anchor, but an exact inline after an accepted split must compare with its immediate input. Keeping the case set fixed by the original signature lets the exact step inherit the preceding evidence on that set.

### Review and next checkpoint

Read the [design](../design-doc/01-tix-stage-1-design.md), especially the framework finding, affine proof limits and acceptance domain. Review the native-pass entry point, the `max` disambiguation choice and the treatment of programs whose sampled reference is nonfinite. The next diary entry should record review decisions before implementation.

## Step 2. Incorporate the review

The review identified choices that needed to be fixed before implementation, particularly the treatment of nonfinite references, the case order and the budget for blocked reductions. The revised design also removes the general shape solver and builds the native path on existing pass definitions.

### Prompt context

<details>
<summary>Review and implementation request, verbatim</summary>

~~~~text
A reviewer has read your design for IRWB-020-A. The review:

# Review of your design

## Must change

1. **Non-finite outcomes reject a correct pass.** The rule "On an applicable tolerance check a nonfinite output is a failed comparison" meets all-zero, alternating-sign and seeded `[-1,1]` inputs. Layernorm's eps is unspecified. If eps is an input, `sqrt(var + eps)` is NaN on some cases, and the correct `split-sum` is rejected on a corpus program. State the eps form and how a non-finite *reference* is treated.
2. **Wrong variants.** "Exercise the deliberately wrong native rewrites … using test-local definitions and explicit witness inputs." The contract must reject them. Show the rejection on its generated cases, not on hand-picked inputs.
3. **Budget.** "the candidate must complete every selected case within the budget". Cases are screened on the origin, and `split-sum` adds outer-loop visits, so a correct candidate near the cap is rejected. Say how the candidate's budget is set.
4. **Case selection.** "Select up to eight distinct legal bindings per function, prioritizing empty, singleton, full block and tail reductions when present". The ranking is undefined, so the implementer must invent it.
5. **Scope.** "Add focused framework coverage to `tests/framework/ext-e3-e6.test.mjs`". The brief allows edits to existing tests only where the framework change requires them. Use a new file.

## Cut

1. "Use exact elimination over affine forms for parameter binding and compile-time bounds … eliminate variables from linear inequalities over rationals". No corpus program needs this solver.
2. "Keep the source dimension constraints in the function signature in the artifact, including those of annotated temporaries". These constraints serve call-time shape errors, which go beyond compile errors with `line:col`.

## Framework changes

- **Extract native-candidate preparation, plus `applyNativePassSync` with a `(before, after) => CheckResult` gate:** needed, minimal and correctly placed.
- **`defineNativePass`:** not needed. `definePass` already describes a native-result pass. Take a `Pass` and refuse `needs` and `preserves`.
- No missed change.

## Keep

Keep the half-ULP witness in the contract's domain, which makes exact rejection deterministic. Keep the tolerance anchored at the origin's f64 across steps and calls.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-A:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
~~~~

</details>

### What changed and why

- Layernorm uses a positive literal epsilon. The tolerance comparison preserves NaN and signed infinity classifications from the f64 reference.
- Specified uniform and mixed shape order, deterministic generated mutation witnesses and logical reduction accounting. The extra physical block visits are bounded by the number of charged terms.
- Removed general affine elimination and retained only executable dimensions. Compile-time access proofs use normalized intervals and local nonnegativity facts.
- Kept `definePass`, with a synchronous native runner sharing candidate preparation. New framework coverage goes in its own test file.

### Review checkpoint

Implementation follows the revised [design](../design-doc/01-tix-stage-1-design.md). The design checkpoint contains documentation only.
