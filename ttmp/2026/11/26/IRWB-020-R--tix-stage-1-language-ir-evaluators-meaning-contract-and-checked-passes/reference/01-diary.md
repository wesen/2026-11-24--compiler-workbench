---
Title: Diary
Ticket: IRWB-020-R
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
Summary: ""
LastUpdated: 2026-11-26T13:45:52.128738818-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-020-R diary

## Step 1 — Design the first tensor domain

I read the framework's artifact, IR, contract, pass and strategy interfaces alongside Typed's use of them,
then drafted the Tix stage-one design. Two differences drive the proposed framework change. The fixed API
requires synchronous pass application, and both passes return native candidates that need inspection and
validation without opening a logical edit.

### Prompt context

Authored request, verbatim.

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-R. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-R:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-R. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

This turn produces the review checkpoint. The intended outcome is evidence about where the existing
framework fits tensor IR and where it needs an extension.

### Work and rationale

- Created the ticket and design with `docmgr`. The design describes the source subset, checked index-tree IR,
  one traversal for both precisions, differential cases, the two passes and the six-program corpus.
- Followed Typed's path from `runPipeline` through native `definePass` kernels and the differential contract.
  The new synchronous entry point can reuse native candidate validation, diff and declared-write checks.
- Chose an original-source f64 reference for repeated split checks. Exact inline checks use the current
  revision so an earlier tolerated split remains in effect.

### Probe results

- `npm ci --offline --no-audit --no-fund` failed in the esbuild install hook with
  `Error: spawnSync …/node_modules/esbuild/bin/esbuild EPERM`. For the TypeScript-only probe,
  `npm ci --offline --no-audit --no-fund --ignore-scripts` followed by `npm run build` succeeded.
- In `node --input-type=module` on Node v24.18.0, the probe created two scalar v6 artifacts, opened the
  first through a projection-only adapter, and compared them with `differential`. The synchronous
  `runDifferential(differentialSpec(check), ports)` returned the same disagreement evidence as
  `AnalysisManager.checkInvariant`. The artifact also confirmed that canonical data normalizes numeric
  `-0` to `0`.
- The same probe's `applyPass(pass, origin, { manager })` returned a promise and rejected with
  `IRError: Adapter probe is not Rewritable` before calling the native kernel. Giving the scalar probe a
  real `rebuild` callback made that native pass succeed. The proposed tensor entry point avoids the edit
  context because neither tensor pass consumes it.
- A Node arithmetic probe accumulated from +0 with `Math.fround` after each addition, in source order
  and in consecutive pairs with an outer sum. For `u = 2^-24` and inputs `[1,u,u,u]`, the results were
  `1` and `1 + 2u`, with f64 reference `1 + 3u`. For `[-4,-u,4,-u]`, the source and paired f32
  values were `-u` and zero, with reference `-2u`. The latter sets the absolute floor at `2u`.
  A Uint32Array view of f32 `[0, -0, NaN]` also distinguished the zero signs.

### Review checkpoint

`docmgr doctor --ticket IRWB-020-R --stale-after 30` passed.

Start with the [design](../design-doc/01-tix-stage-1-design.md), especially the pass entry point and tolerance
policy. The reviewer can check the two framework constraints in `applyPass` and `Edit`, and the invariant
reuse in `differential.ts`. The tolerance is a sampled verdict, and the design specifies witnesses that
distinguish a bit change from an invalid rewrite. The implementation and regression suites follow the review.
