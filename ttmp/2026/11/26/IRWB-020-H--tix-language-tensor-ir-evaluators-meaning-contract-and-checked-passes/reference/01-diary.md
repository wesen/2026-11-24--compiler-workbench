---
Title: Diary
Ticket: IRWB-020-H
Status: active
Topics: [compiler, ir, verification]
DocType: reference
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Design investigation and review checkpoint for the first tensor stage.'
LastUpdated: 2026-11-26T12:48:07-05:00
WhatFor: 'Resume after review'
WhenToUse: 'When checking the evidence behind a stage decision'
---

# Diary

## Step 1: Find the framework boundary before writing a tensor compiler

I traced the path from a Typed pass to its meaning check, looking for assumptions a second domain would have to break. The representation and comparator hooks already fit tensors. The mismatch I found is about *when* a result can be returned: the public Tix optimizer is synchronous, but the pass runner awaits analysis and verification. The [design](../design-doc/01-stage-1-design-checking-tix-tensor-transformations.md) proposes sharing candidate preparation without creating another manager. This is a review checkpoint, not a tested compiler.

### Prompt context

**User prompt (verbatim):**

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-H. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-H:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-H. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
````

**Interpretation and inferred intent:** Deliver a reviewable plan now; the value of the later code is evidence of where the framework fits or fails, not device support.

### What I did and why

- Read the contract, IR and strategy guides, then the actual `definePass`, `applyPass`, `differential`, `createIRArtifact`, Typed evaluator, pass and project entry points. The guides alone don't specify the synchronous paths.
- Created the ticket, design and diary with `docmgr`. Recorded the full framework proposal in one ledger at the top of the design.
- Sought a split witness within bounded, finite inputs rather than relying on random data or catastrophic cancellation.

### What worked

On Node `v24.18.0`, with `f=Math.fround` and `sum=a=>a.reduce((x,y)=>f(x+y),0)`, I compared `sum(x)` with `sum([sum(x.slice(0,4)),sum(x.slice(4,8)),sum(x.slice(8))])` for the nine terms in the design. Result: `1` vs `1.000000238418579`; unrounded `x.reduce((a,b)=>a+b)` returned `1.0000002980232239`. Viewing `new Float32Array([-0,0]).buffer` as Uint32 gave `[2147483648,0]`. These are arithmetic probes, not results of a Tix pass.

### What didn't work

No failed command or implementation attempt. Build and regression suites deferred to the implementation gate.

### What I learned

`runDifferential` can already run two *different precisions* without any precision support in framework code. Its per-case comparator sees runtime outcomes; only the evidence must be plain finite data. A sampled agreement must not be described as exact assurance even if the comparator is bitwise.

### What was tricky to design

Inline after a split must not get permission to introduce another roundoff just because the program is now approximate. Keep an exact current-to-candidate gate for inline and test the candidate against the original relation as well. Returning a proposed artifact too early would make rejection meaningless.

### What warrants a second pair of eyes

Review the synchronous preparation boundary, per-function sample coverage, residual shape obligations and how a handle preserves the origin between optimizer calls. A shared indexing bug could make both evaluators agree: the corpus needs independent expected results.

### What should be done next

Wait for review in this session. Resolve design comments, then build the front end and small evaluator fixtures before either pass. Keep the ledger current as proposals become actual framework edits.

### Code review instructions and technical details

Start at the design's ledger, compare it with the native-result branch in `src/framework/passes/define-pass.ts`, then follow `runDifferential` in `src/framework/contracts/differential.ts`. Finish with the half-ulp fixture and the validation gates. Only ticket documentation is being committed at this checkpoint (`7cf52a5`).

## Step 2: Revise against the review

I checked `transactions.ts`: the edit constructor requires `rebuild` before the native kernel can run. Dropped the proposed async Tix parity test rather than change edit lifecycle for a test. Existing framework and Typed tests still cover the shared async path.

**User prompt (verbatim):**

````text
A reviewer has read your design for IRWB-020-H. The review:

# Review of your design

## Must change

1. **The async parity test cannot run as designed.** "A parity test will run a changed candidate through the async wrapper and manager", but the adapter has none: "native-result passes don't need a graph-to-native rebuilder". `applyPass` calls `view.beginEdit()` before the pass runs, and the `Edit` constructor throws `ir.capability` for an adapter without `rebuild`. I confirmed this in `ir/transactions.ts`. Either open the edit lazily in `applyPass` and add that change to the ledger, or drop the async parity test.
2. **Sample counts are deferred.** "Specify sample ordering and counts in fixtures" leaves the number of seeded draws per shape, and the case order, to the implementation. Fix both in the design.

## Cut

1. "Acceptance bindings: initially exact checks `origin.f32` vs `candidate.f32`. For inline **always** check `current.f32` vs `candidate.f32`; after an accepted approximation also enforce the origin tolerance", together with the handle's "accepted origin relation". Exact agreement with `current`, on the same origin-derived cases, already implies the origin check.
2. "Bind from actual lengths at call time by exact integer/rational elimination", and "obligations depending on actual parameters, e.g. `H-KH+1 >= 0`, are checked at binding". No corpus program needs this. It adds a call-time error contract beyond compile errors with `line:col`.
3. "Report the largest absolute and scaled error per corpus test and review any failure before changing it." This is a measurement plan.

## Framework changes

- **`prepareNativeCandidate` extracted from `applyPass`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal and correctly placed. Keeping the verdict in tensor code is the narrowest version of this seam among the designs.
- **Missed:** the lazy edit (item 1), if the async parity test stays.

## Keep

Keep screening the tolerance cases on the origin alone, with "a nonfinite candidate on a finite reference always fails". Keep the nine-element witness (serial `1`, blocked `1.000000238418579`, verified). Keep the requirement that the mutants be valid IR whose rejection is numerical.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-H:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
````

The revised sample order fixes the number of RNG draws before implementation. Removed the second inline comparison, shape equation solver and per-test error measurement. No outstanding disagreement. Review the sample definition alongside the eventual generator and replay fixtures.

## Step 3: Checked language and reference execution

Implemented the parser, normalized affine maps, explicit binder scopes, validated v6 projection and two-precision loop interpreter. Sticky lexer probe on Node 24 matched `x` at lastIndex 1. `npm ci --offline --no-audit --no-fund` installed the locked dependencies.

`npm run build && node --test tests/tensor/language.test.mjs` first reported `AssertionError: y[i]:f32[Q]=0;` (return shape mismatch before unknown annotation). Moved shape-name lookup to the annotation token. Rerun passed 4/4, including f32 vs f64, lexicographic accumulation, affine extents and signed zero. Review `parse.ts` and `ir.ts` separately: inference is source-only, whereas validation also applies after substitution. Committed as `2cb41d7`.

## Step 4: Separate structural preparation from numerical acceptance

Extracted the existing native revision path into `prepareNativeCandidate`. Its regression test deliberately prepares a structurally valid but meaning-changing candidate: structure is the helper's limit. In tensor code, single-use inlining moves the producer tree (retaining its IDs), and splitting constructs explicit block/lane reductions. Both run the sampled gate before adopting the result.

The focused command `node --test tests/tensor/passes.test.mjs` passed 8/8. The fixed input shows exact rejection and tolerant acceptance of the same candidate. Valid-IR mutations to axis order and tail bound were rejected on returned elements; nine ones produced 8 instead of 9 for the latter. Per-function coverage rejection and an exact inline after a split also passed. See `tests/tensor/passes.test.mjs` for reproduction. No lazy edit or framework tolerance policy was needed.

Two additional probes tightened the compiler tests. A 309-digit input dimension initially threw `IR data must contain only finite numbers` from hashing rather than a source location; the lexer/parser now catches unsafe affine integer data before artifact creation. The two f32 answers for `[1,1,5] / 3` happened to coincide; `[1,1,3]` distinguishes a greedy reduction body from a parenthesized reduction divided afterwards. The corresponding tests now exercise these cases.
