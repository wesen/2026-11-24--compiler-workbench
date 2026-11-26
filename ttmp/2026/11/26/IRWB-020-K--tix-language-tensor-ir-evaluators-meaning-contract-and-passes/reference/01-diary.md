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
