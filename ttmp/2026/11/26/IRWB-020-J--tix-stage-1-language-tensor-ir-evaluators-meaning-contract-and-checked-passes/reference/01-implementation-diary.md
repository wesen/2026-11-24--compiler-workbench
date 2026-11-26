---
Title: Implementation diary
Ticket: IRWB-020-J
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/core/data.ts
      Note: Canonical finite JSON representation that motivates preserving literal text and external runtime buffers
ExternalSources: []
Summary: Investigation checkpoints, evidence and review handoffs for Tix stage 1.
LastUpdated: 2026-11-26T12:55:15.330812555-05:00
WhatFor: Resume after review without mistaking proposed code or tests for landed work.
WhenToUse: Start with the latest numbered step; see Step 1 for the request.
---

# Implementation diary

## Step 1: Locate the framework boundary and find a numerical witness

I traced one Typed pass from definition to acceptance before choosing a tensor representation. The differential
checker already allows a baseline to run at a different precision from the subject. The mismatch is in pass
application, not in how the framework expresses meaning: the public Tix API is synchronous.

The [design](../design-doc/01-design-tix-programs-and-checked-tensor-passes.md) proposes one restricted pass
entry point. There is no tensor implementation or framework patch yet. The one numerical result below is a
standalone Node experiment to make the review falsifiable, not a result from a compiler.

### Prompt context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-J. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-J:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-J. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

**Interpretation:** specify a reviewable, implementable second domain; stop at the design commit.
**Inferred intent:** use changed and deliberately wrong revisions to learn where v6 actually fits, not add a tensor product layer to v6.
**Revision inspected:** `19ad269`, branch `t1-pi-ax/irwb-020-j`. No code commit in this step.

### What I did and why

- Read the three requested framework READMEs, the Typed pass/meaning/pipeline code, and the underlying pass,
  differential, canonical data, adapter and edit implementations. The actual call and return types matter more
  than the word “checked”: `applyPass` returns a Promise even for a synchronous kernel.
- Created the ticket, design and diary with `docmgr`. Put the framework delta ledger first in the design; keep
  paths that are only proposals out of `RelatedFiles` until they exist.
- Tested an explicit seven-element input rather than counting on different random seeds to distinguish the
  reductions. Chose two nested reductions so the new evaluation order is visible in the candidate graph.

### What worked

On Node v24.18.0 this standalone probe (formatting abbreviated) reproduced the split witness:

```js
const a = Float32Array.of(1, 0, 0, 0, 2**-24, 2**-24, 2**-24);
const sum = x => x.reduce((s, v) => Math.fround(s + v), 0);
const bits = x => new Uint32Array(Float32Array.of(x).buffer)[0].toString(16);
const s = sum(a), t = sum([sum(a.slice(0, 4)), sum(a.slice(4))]);
const r = a.reduce((x, y) => x + y, 0);
console.log(s, bits(s), t, bits(t), r, Math.abs(t - r));
```

`node --input-type=module` printed `1 3f800000 1.000000238418579 3f800002 1.0000001788139343 5.960464477539063e-8`.
Reinterpreting f32 `-0` yielded `80000000`; `3n*2n===6n` returned `true` (exact integer arithmetic available
for affine checks). Neither is an implementation benchmark.

### What didn't work

`ls -d dist node_modules` reported `ls: cannot access 'dist': No such file or directory` and likewise for
`node_modules`. No build or compiler test attempted: this step needs source inspection only. A batched document
edit failed with `Could not find edits[5]` on unmatched trailing context; removing the stale match allowed the
intended text changes. No implementation blocker identified.

### What I learned / what was tricky

- Framework canonical data intentionally erases signed zero and excludes nonfinite numbers. Keep numeric
  outcomes transient, literals as text, and evidence as replay descriptions/bit strings. No reason to alter
  artifact hashing for tensor data.
- The baseline is not always the previous revision. After a legal split it is impossible to promise both
  bit identity to the *original f32* and preservation of that split's changed bits. For a subsequent inline,
  check local f32 equality **and** the active origin relation; don't chain tolerances.

### What warrants a second pair of eyes

Review the sync subset against `passes/define-pass.ts`, the shape-binding and access-bound rules, and whether
the error budget is useful on small nonsymmetric cases. The corpus is not yet evidence that it is.

### Next step and review instructions

Review the design ledger, the policy table, the concrete split witness and negative controls. After the
review reply, record decisions before coding. The build, six corpus runs, tensor tests, full framework and
affected Typed tests are deferred to implementation. `docmgr doctor --ticket IRWB-020-J --stale-after 30` reported “All checks passed” for the design ticket.

## Step 2: Apply review before implementing

Accepted all review items. Positive profiles now depend on the declared singleton type, not a parameter name. Origin admission and candidate work bounds are separate. Bitwise equality on the same calls is transitive, so inline needs no history flag. Dropped equation solving and error measurement. No new framework capability beyond the reviewed sync gate. Review the sample-domain and composition sections first. `npm ci --offline --no-audit --no-fund` installed six packages. Next: build and exercise the reviewed design.
