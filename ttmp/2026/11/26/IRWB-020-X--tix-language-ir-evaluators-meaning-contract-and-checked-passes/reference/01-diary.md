---
Title: Diary
Ticket: IRWB-020-X
Status: active
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design checkpoint and framework and numeric probes for stage 1
LastUpdated: 2026-11-26T14:46:02.293486084-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1. Design Tix on the v6 framework

I traced Typed's pass application from the current artifact to the check against the origin, then checked
which parts of that path are usable behind the synchronous Tix API. The design shares the native candidate
preparation and uses the framework's direct differential runner for both relations. Node probes confirmed
the artifact identity, rounding witness and NaN representation choice.

### Prompt context

User request, verbatim.

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-X. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-X:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-X. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
~~~~

The requested deliverable is a review checkpoint before source implementation. The central review question
is how much the shared framework must change to support the second domain.

### What I did

- Read the three framework READMEs, candidate preparation in `src/framework/passes/define-pass.ts` and
  Typed's pass definition, application, evaluation and project entry points.
- Opened the ticket with docmgr and wrote the [stage 1 design](../design-doc/01-stage-1-tix-design.md).
- Built the current checkout with `npm run build` and ran short probes against the built framework
  and against Node v24.18.0's numeric operations.

### Why and what worked

- The built framework accepted matching contract and adapter artifacts. The two constructors gave the
  same revision for the same IR, the diff and write authorization ran synchronously, and the direct
  differential runner returned a disagreement on a one-case invariant. `applyPass` was an async function.
- A projection-only adapter supported native artifact diffing. Calling `applyPass` with the same
  adapter rejected at edit construction with `Adapter tensor.probe is not Rewritable` before invoking
  the native pass. The proposed extraction only needs the projection.
- A Node probe using `[1, 2^-24, 2^-24, 2^-24]` reproduced the serial and paired sums in the design.
  The words were `3f800000` and `3f800001`, and the blocked result was `5.960464477539063e-8` from
  the f64 reference. The proposed bound was `9.536744869365066e-7` for that reference. Doubling the
  blocked result exceeded the bound.
- An integer larger than the JS safe-integer range round-tripped via its decimal string and `BigInt`.
  This supports the affine representation inside canonical JSON.

### What did not work

- `git add -- "$ticket_dir"` could not create the worktree's Git `index.lock` because the sandbox
  mounted that administrative path read-only. Use the approved unsandboxed Git command for the design commit.

- `docmgr version` returned `Error: unknown command "version" for "docmgr"`. Command help,
  `docmgr status --summary-only`, and ticket and document creation worked with the installed binary.
- A `node --input-type=module` probe asserted raw equality for a naïve typed-array and `Math.fround`
  NaN round trip. It failed on words `7fe00000` and `7fc00000`. The follow-up wrote a fixed quiet NaN
  word through a `Uint32Array` view. Every tested NaN store then had word `7fc00000`, and negative zero
  retained word `80000000`.

### What was tricky and warrants review

The exact relation distinguishes f32 words that ordinary JS number equality conflates. The tolerance
is sized for short sums and serves as a measured acceptance criterion for complete sampled programs.
It will conservatively decline some reassociations. Review the shape-binding restriction, ambiguous
`max` syntax, and the decision to compare inline against both origin and immediate input when they differ.

### Validation

`docmgr doctor --ticket IRWB-020-X --stale-after 30` passed. The repository build checked the existing
framework used in the probes. Tensor and regression tests are part of the implementation checkpoint.

### Next checkpoint

Review the design in this session. Parser, evaluator, corpus, passes and regression tests remain for
implementation after review.
