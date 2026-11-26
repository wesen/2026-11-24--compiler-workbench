---
Title: Design and implementation diary
Ticket: IRWB-020-V
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
Summary: "Chronological record of the design and implementation of Tix stage 1."
LastUpdated: 2026-11-26T14:46:28.469096662-05:00
WhatFor: ""
WhenToUse: ""
---

# Design and implementation diary

## Step 1 — Trace the framework and design Tix stage 1

I traced Typed's pass and meaning-check paths, then probed the built framework with a small read-only artifact. The fixed synchronous optimizer needs a reusable entry to native-candidate preparation. The differential evaluator already has a synchronous runner.

### Prompt context

<details>
<summary>User brief, verbatim</summary>

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-V. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-V:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-V. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

</details>

The immediate deliverable is a committed ticket for review. The implementation should make the framework fit visible by identifying which parts carry over and where the synchronous API needs a shared framework entry point.

### What I did

- Read the framework contracts, IR and strategy documentation and traced `src/typed/project.ts`, `src/typed/passes.ts` and `src/typed/evaluate.ts`.
- Created IRWB-020-V using docmgr and wrote the [stage 1 design](../design-doc/01-tix-stage-1-design.md).
- Probed the built pass, adapter and differential APIs, then checked the proposed sum witness and tail mutation in Node.

### Why

The native artifact lets two local expression rewrites use the framework's validation, projection and correspondence. A shared native preparation helper removes the need for either an artificial graph rebuild or a Tix copy of the native preparation rules.

### What worked

- `npm run build` passed on Node 24.18.0.
- A `node --input-type=module` probe created and opened a read-only v6 artifact. `runDifferential(differentialSpec(invariant), ports)` returned a synchronous disagreement for positive and negative zero.
- A separate Node reduction probe produced `0x3f800000` sequentially and `0x3f800002` with width-two blocks. The f64 result was `1.0000001788139343` and the split error was `5.960464477539063e-8`, within the calculated budget of `8.940699935955941e-7`. Dropping the last term of the integer ramp would return 10 instead of 15.
- BigInt coefficients survived an immutable artifact round trip as strings. Node stored the probe's `Math.fround(NaN)` as `0x7fc00000`.

### What did not work

The deliberate `applyPass(pass, artifact, {})` probe returned a promise and rejected with `Adapter probe.tensor is not Rewritable` before calling the native kernel. The design extracts the native preparation already inside that function. The await-based manager remains available to existing callers.

The initial `git add -- "$ticket"` failed with `fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/t1-v3-sm-irwb-020-v/index.lock': Read-only file system`. The ticket files were writable. Staging requires access to the separate Git worktree metadata.

### What I learned

Symbolic extents and lexical binder IDs fit inside a canonical native payload. The artifact rules require runtime floating-point results to stay outside that payload. The framework's existing differential runner already accepts custom observations and comparison, so tolerance is a tensor policy.

### What was tricky to specify

A tolerance-accepted split can change f32 bits. A following exact pass must preserve the immediate predecessor's bits, and further splits must continue to check the original f64 result. The same generated inputs let these checks compose across a pipeline.

### What warrants a second pair of eyes

Review the division between source-level shape errors and constraints evaluated when concrete shapes bind, the fixed sample domain, and the size of the native pass preparation API.

### What should happen next

Implement after review, starting with the checked artifact and interpreter, then exercise the shared pass boundary with the same real and mutant kernels described in the design.

### Review instructions

Start with the design's framework change table. Compare it to the native-result arm of `applyPass` and the existing synchronous `runDifferential` entry point. The numeric witnesses above are standalone design probes. End-to-end Tix and Typed regression runs belong to implementation.

### Technical details

The design records the affine corner calculation, the reduction order, the tolerance derivation and the comparison fixtures. All documentation in this checkpoint belongs to IRWB-020-V.
