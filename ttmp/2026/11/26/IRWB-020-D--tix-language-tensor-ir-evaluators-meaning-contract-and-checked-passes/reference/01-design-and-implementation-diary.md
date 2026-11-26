---
Title: Design and implementation diary
Ticket: IRWB-020-D
Status: active
Topics:
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design investigation, runtime probes and implementation handoff.
LastUpdated: 2026-11-26T12:39:33.472999438-05:00
WhatFor: ""
WhenToUse: ""
---

# Design and implementation diary

## Step 1 — Check the framework fit before choosing the tensor IR

At baseline `19ad269` I traced how a Typed project retains its original artifact while applying a pass to a later revision. The same model lets Tix check an exact inline after a reassociating split. The important difference is at the call boundary. Typed awaits each pass, whereas a Tix caller can pass the result straight to `runTix`.

### Request

The [stage-1 design](../design-doc/01-stage-1-design-for-the-tix-tensor-domain.md) is the review deliverable. The verbatim request is recorded below for the implementation handoff.

<details>
<summary>Original user request</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-D. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-D:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-D. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).

</details>

### Investigation and decisions

- Read the contracts, IR and strategy READMEs. Followed `ingestProject`, `typedPass`, `optimizationContract` and `meaningKept` to their framework definitions. The existing differential specification already passes a side tag to the evaluator. Precision and comparison belong in the domain.
- Inspected native result preparation in `applyPass` and the constructor of `Edit`. Calling the asynchronous pass API with a native-only projection still constructs a graph transaction. The design proposes sharing native preparation and write validation with a small synchronous checked entry point.
- Chose a sampled elementwise relation and a five-element witness that simultaneously tests rounding and a nonempty block tail. A separate transposed-load mutant tests substitution of pointwise axes.

### Commands and observations

`docmgr status --summary-only` selected this worktree's `ttmp` root. Created the ticket, design and diary with `docmgr ticket create-ticket` and `docmgr doc add`. Node reported v24.18.0. The first toolchain probe, `tsc --version`, produced `zsh:1: command not found: tsc`. This checkout had neither local dependencies nor build output. `npm ci --offline --ignore-scripts --no-audit --no-fund` installed six packages from cache and `npm run build` exited successfully.

A `node --input-type=module` probe imported from that build. A one-entity `defineAdapter` with a validator, entity enumeration/resolution, description and empty relations produced a valid artifact with `createIRArtifact`. Its projection had one entity. Passing it to `applyPass` with an identity native kernel and an `AnalysisManager` produced a Promise. Awaiting it reported `Adapter probe is not Rewritable`. The relevant ordering is `view.beginEdit()` before `pass.run(...)`. A separate call confirmed `Object.is(immutable([-0])[0], -0)` is false. A unary minus node preserves the spelling's semantics through a finite JSON artifact.

The arithmetic probe used this Node fragment and fed the three pairs of observations into the built `differential`, `differentialSpec` and `runDifferential` functions, with one deterministic case per relation.

```js
const row = [1, 0, 2 ** -24, 2 ** -24, 0.25];
const sum = xs => xs.reduce((s, x) => Math.fround(s + x), 0);
const partials = [sum(row.slice(0, 2)), sum(row.slice(2, 4)), sum(row.slice(4))];
const flat = sum(row);
const blocked = sum(partials);
const reference = row.reduce((s, x) => s + x, 0);
```

| Comparison | Observation | Runner verdict |
| --- | --- | --- |
| flat f32 vs blocked f32 | words `3fa00000` and `3fa00001` | disagree |
| origin f64 vs blocked f32 | both 1.2500001192092896 | agree |
| origin f64 vs result with last partial omitted | 1.2500001192092896 vs 1.0000001192092896 | disagree |

The measured values come from arithmetic probes. Running actual Tix on the same witness is an implementation acceptance test. The full framework and affected Typed suites are scheduled after the implementation.

### Review and next checkpoint

Start with the proposed framework change in the design. Review the native-only kernel/gate boundary, origin handling when the two passes are chained, and the extent rule for an affine-only bound reduction index. After review, implement the agreed slice and use the corpus and both mutants to test the normal entry points. Record the actual framework diff and the executing regression tests here.
