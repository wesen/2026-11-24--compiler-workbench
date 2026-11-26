---
Title: Design and Implementation Diary
Ticket: IRWB-020-T
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
LastUpdated: 2026-11-26T13:44:50.75960816-05:00
WhatFor: ""
WhenToUse: ""
---

# Design and implementation diary

## Step 1 — Design review checkpoint

I followed Typed's checked pass from its native result through `applyPass` and the semantic manager.
The synchronous public API and the read-only IR projection each prevent direct reuse of that entry point.
The design extracts the shared candidate preparation and uses the differential engine's synchronous
evaluation for the two pure tensor relations.

I also checked that the proposed blocking produces an exact disagreement, passes the proposed tolerance
gate and exposes a dropped tail. These probes are evidence about the host arithmetic and existing framework
primitives. The Tix parser, interpreter and passes are still at the design stage.

### Prompt context

User prompt, verbatim.

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-T. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-T:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-T. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
~~~~

### What I did and why

- Created the ticket with docmgr and added the design, diary and implementation tasks.
- Read the contract, IR and strategy documentation and traced the Typed optimizer. Reuse of the
  synchronous numerical checker keeps the comparison code in the invariant spec. The framework
  extraction keeps native diff, write checks and correspondence in one place.
- Chose symbolic axes and a checked expression tree with stable binding IDs. The corpus exercises
  affine access without requiring either a solver for arbitrary parameter shapes or a loop IR in stage 1.

### Probe results and recoveries

- `npm ci --offline --ignore-scripts --no-audit --no-fund --cache /tmp/irwb-020-t-npm-cache`
  returned `ENOTCACHED` for `undici-types-6.21.0.tgz`. The design probes used the installed Node
  runtime directly. The build and implementation suites follow the review.
- Under Node v24.18.0, `node --input-type=module` with an inline `registerHooks` resolver
  mapping relative imports from `.js` to `.ts` failed in `src/framework/ir/common.ts` with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` for a constructor parameter property. Adding
  `--experimental-transform-types` loaded the existing framework. The resolver and flag were
  only used for that probe. The proposed implementation uses the existing TypeScript build.
- `view.beginEdit()` on the probe adapter without `rebuild` threw
  `Adapter probe.tensor is not Rewritable`. Adding a minimal rebuild function for the probe let
  the native-output pass run. `applyPass` returned a Promise even with that synchronous kernel.
- Creating a v6 artifact with a numeric negative zero normalized it to zero. Exact matching uses
  runtime f32 words, and the IR stores literal lexemes and explicit unary signs.
- The framework's `runDifferential(differentialSpec(invariant), ports)` returned disagreement
  for exact and agreement under an initial `8u` bound on a probe that folded a five-element Float32Array
  left-to-right and in clipped pairs using `Math.fround`. The original was `1`, the candidate
  and the f64 reference were `1.0000001192092896`, using `[1, 0, 2^-24, 2^-24, 0]`.
  A separate arithmetic assertion using the final `4u` bound measured a tolerance of
  `2.3841860752327193e-7` for that reference. The tail mutant on five ones returned `4`
  with error `1` and an allowed bound of `0.0000011920928955078125`.

### Review before implementation

Read the framework extraction, native artifact and meaning contract sections first. The review points are
the narrow boundary between candidate preparation and acceptance, the declared source subset for
shape inference and the fact that the tolerance gate rejects the whole candidate if a sampled case
fails in any entry. The pass and corpus tests in the design give the implementation acceptance criteria.

[Stage 1 design](../design-doc/01-tix-stage-1-design.md)
