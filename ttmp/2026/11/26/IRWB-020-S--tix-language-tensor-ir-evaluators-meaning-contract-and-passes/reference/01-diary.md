---
Title: Diary
Ticket: IRWB-020-S
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
Summary: "Investigation and implementation diary for the Tix stage-1 ticket."
LastUpdated: 2026-11-26T13:44:40.805012638-05:00
WhatFor: "Record design decisions, evidence, and review handoff."
WhenToUse: "When resuming or reviewing IRWB-020-S."
---

# Diary

## Step 1: Inspect v6 and propose the stage-1 design

I traced Typed's pass and meaning integration to separate reusable pieces from assumptions about its domain. The artifact and comparison APIs already fit; the fixed synchronous optimizer cannot use the existing async executor, and even the native-result branch of that executor first needs a rebuild-capable adapter. The [design](../design-doc/01-stage-1-design.md) proposes one narrow entry for native passes with sampled contracts, reusing the structural and numerical kernels.

I checked the rounding witness on Node 24 and wrote down what it does and does not establish. This checkpoint is design-only; wait for the reviewer before implementing.

### Prompt Context

**User prompt (verbatim):**

~~~~markdown
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-S. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-S:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-S. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
~~~~

**Assistant interpretation:** This checkpoint needs a reviewable design and documented framework findings, not a new compiler entry point yet.

**Inferred user intent:** Test the reuse boundary on a second domain and make any extension of v6 small enough for the reviewer to isolate from Tix features.

### What I did

- Read the framework contract, IR and strategy READMEs and followed `src/typed/project.ts` → `optimizationContract` → `meaningKept` → `differential`, plus `applyPass`, the edit constructor, and framework artifact canonicalization.
- Created the docmgr workspace, design, review/implementation tasks, and this diary. The design's framework inventory distinguishes proposed changes from existing capabilities.
- Ran a standalone Node numeric probe for the split witness and signed-zero bits, without touching source or adding a test-only evaluator.

### Why

The v6 comparator already supports distinct evaluators and a custom relation. The first extension should remove the sync and native-result barriers without moving numerical policy into v6 or replacing the async contract manager.

### What worked

On Node `v24.18.0` (worktree base `19ad269`), the serial f32 fold was `1` (`3f800000`), the size-two blocked f32 fold was `1.0000001192092896` (`3f800001`), and the serial f64 fold equaled the blocked result. `Math.fround(-0)` stored as `80000000`. A fold of five ones returned `5`; truncating to four entries returned `4`. Those are arithmetic probes, not integration test results.

`docmgr doctor --ticket IRWB-020-S --stale-after 30` passed; `docmgr ticket resume --ticket IRWB-020-S` reports review as the next step.

### What didn't work

- `docmgr metadata update --help` returned `Error: unknown command "metadata" for "docmgr"`. Used the generated document frontmatter and `docmgr doc relate` instead.
- An initial source search included `src/typed/index.ts`; `rg` reported `No such file or directory (os error 2)` for that path. The relevant Typed integration is exported from `project.ts`, `passes.ts` and `evaluate.ts`.
- `git diff --cached --check` flagged `index.md:39: new blank line at EOF.` Removed the extra line before staging the design commit.

### What I learned

- The existing adapter path validates and hashes native finite JSON; its canonicalizer normalizes `-0` to `0`. Keep unary negation explicit and runtime observations outside the artifact.
- The manager's evidence field can carry the existing sampled verdict. It need not assert an exact proof just because comparisons are bitwise on each sampled case.

### What was tricky to build

The gate needs two baselines in one case: inline must be exact relative to its immediate input, even after accepted reassociation, while each changed candidate must still meet the original program's relation. Keep the frozen origin in `TixProgram` and bind it explicitly rather than silently starting a new tolerance budget per pass or per optimizer call.

### What warrants a second pair of eyes

- Does the narrow synchronous path share enough validation with the async manager without pretending to support its effect and transaction model?
- Is the affine subset sufficient for the corpus, and is rejection of unproved accesses the right boundary?
- Are the fixed sample profiles and nonfinite tolerance rejection appropriate for the intended pass experiments?

### What should be done in the future

After the review, implement only the agreed scope and run the tensor, framework, and affected Typed tests. There were no compiler builds or suite runs for this docs-only checkpoint.

### Code review instructions

Start with sections 3–5 of the [design](../design-doc/01-stage-1-design.md). Compare its proposed sync entry with `src/framework/passes/define-pass.ts`, `src/framework/contracts/differential.ts`, and `src/framework/contracts/analysis-manager.ts`. The witness below can be run independently of the compiler.

### Technical details

```sh
node --input-type=module -e 'const u=2**-24,x=[1,0,u,u,0],f=Math.fround; const sum=(xs,r=f)=>xs.reduce((a,b)=>r(a+b),0); const pair=xs=>sum(Array.from({length:Math.ceil(xs.length/2)},(_,i)=>sum(xs.slice(2*i,2*i+2)))); const bits=x=>new Uint32Array(Float32Array.of(x).buffer)[0].toString(16).padStart(8,"0"); console.log(JSON.stringify({node:process.version, flat:sum(x), blocked:pair(x), f64:sum(x,v=>v), flatBits:bits(sum(x)), blockedBits:bits(pair(x)), negativeZero:bits(f(-0)), wrongOnes:pair([1,1,1,1]), correctOnes:pair([1,1,1,1,1])}));'
```
