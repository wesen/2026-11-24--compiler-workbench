---
Title: Implementation diary
Ticket: IRWB-020-B
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
LastUpdated: 2026-11-26T12:39:57.193570702-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Find the smallest framework change for synchronous checked rewrites

I traced the Typed optimization contract from its original artifact through its sampled invariant and the pass runner. The comparison callbacks already support a different evaluator on each side. The proposed framework work concerns the point where a native candidate is validated and checked before publication.

### Prompt context

The user requested this design stage verbatim:

~~~~text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-B. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-B:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-B. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
~~~~

I interpreted the review boundary as a request for a buildable proposal and measured framework findings. The design identifies how to distinguish numerical changes from invalid rewrites.

### What I did and why

Read the IR, contracts and strategy guides, the native path of `applyPass`, Typed's `optimizationContract`, evaluator and project loading code. Used the local docmgr configuration and created this ticket. Probed the compiled framework because the fixed optimizer signature requires a value before control returns to the caller.

### What worked

On baseline `19ad269`, `npm run build` exited 0. With Node v24.18.0, an ESM probe imported the built contracts, IR and passes barrels. It created an IR type, an adapter with empty entity/edge enumerations, an artifact with value `{n:1}` and a one-case differential spec comparing the two sides' n. Calling `runDifferential(differentialSpec(inv), {origin:a,candidate:a}).status` produced `agree`.

### What did not work

In the initial `node --input-type=module` probe, passing `kind:ir.kind, schemaVersion:ir.schemaVersion` to defineAdapter raised `IRError: Adapter kind must be nonempty text`. Using the IR definition's id and version fixed it. On this adapter with no rebuild callback, `applyPass(pass,a,{manager:{}})` returned a Promise and rejected with `Adapter t.probe is not Rewritable` before the native identity kernel ran. The empty manager was a probe stub. No manager method was reached.

### What I learned and what was tricky

Even an identity native kernel requires an edit-capable adapter under the current runner. A sync differential gate needs neither edits nor async manager services. The more subtle semantic issue is composition after split-sum. The proposal retains an exact local check for inline and an original-program reference for cumulative error.

### Technical details

On the same Node version, fold with `(acc,x) => Math.fround(acc+x)`, initial 0, on `[1,0,0,0,2**-24,2**-24,2**-24]`. One sequential fold returned 1. Folding the width-four pieces then their results returned 1.000000238418579. JS double addition returned 1.0000001788139343. A Uint32Array view of Float32Array.of(-0) produced the hex word 80000000.

### Review and follow-up

Start with the design's framework ledger, then review the scope of the proposed synchronous path, symbolic shape checks and the contract for inline after split-sum. Following review, implement and run the framework, tensor and affected Typed tests listed in the design. This checkpoint qualifies only the probes and documents.

## Step 2. Incorporate the review

Accepted all four cuts. Direct input axes bind symbols, and compile-time checks use source positions. Inline checks its immediate input on origin-derived cases. A split checks the original in f64. An unchanged pass skips verification. The native entry takes an existing Pass and a two-artifact gate. The tensor caller owns the origin. Review target is the ledger and composition paragraph in the revised design.

## Step 3. Implement the native pass path and executable IR

Extracted native preparation and write enforcement from applyPass and reused them in applyNativePassSync. The new runner rejects manager-dependent declarations and returns immediately on an unchanged revision. Its regression test uses an adapter without rebuild. Added the parser, lexical binder resolution, affine forms, IR projection and evaluator. After npm run build, a worktree probe parsed a row sum, created a tensor.tix artifact and evaluated [1,2,3] to Float32Array [6]. The installed formatter was available through npm exec --offline.

## Step 4. Gate both rewrites and exercise all six programs

Added the public API, contract selection and both native rewrites. The generator checks coverage per function and screens on the origin. The exact and tolerance checks use the same framework differential machinery with different baselines. Identity-order substitution and floor block count are test-only kernels submitted to the normal checked pass entry.

Added six independent numerical corpus fixtures and checks for both precisions before and after optimization. A probe showed that our first two reduction-precedence examples rounded to the same f32 result. Replacing [1,1,16777216] with [1,2,4] distinguishes an in-body division (2.3333334922790527) from division after the fold (2.3333332538604736). The static address checks use all inferred extents after parsing the RHS.

## Step 5. Verify the implementation

At `69bb106`, the Node 24 build exports exactly compileTix, optimizeTix and runTix. The six corpus cases passed independent numerical checks in both precisions before and after optimization. The genuine split fails exact and passes tolerance. Both valid changed mutants fail through applyNativePassSync. A third mutant checks that exact comparison distinguishes the signs of zero.

- `npm run build` exited 0.
- `node --test tests/tensor/*.test.mjs` passed all three files. With `--test-isolation=none`, Node reported 16 passing individual tests.
- `node --test tests/framework/*.test.mjs` passed all 18 files.
- `node --test tests/typed/{passes,program,mutate,strategies}.test.mjs` passed all four files.
- Prettier's check of the changed TypeScript and test files passed.

The actual framework change is recorded in the design ledger. Actual work metering includes loop iterations as well as scalar visits. No call-time shape-error protocol or solver was added. The public optimizer returns an accepted identity step without invoking its semantic gate. The implementation commits are `1a99a16` and `69bb106`, following reviewed design revision `4e0b7eb`.

### Review request (verbatim, Step 2)

~~~~text
A reviewer has read your design for IRWB-020-B. The review:

# Review of your design

## Must change

None found. The domain, observation, both relations and their baselines are specified closely enough to implement without guessing:

- the deterministic shape schedule;
- the three value streams;
- finite-reference screening "chosen from the origin alone";
- declining a function with no comparable case.

The K = 7 pattern makes the exact rejection deterministic (blocked result `1.000000238418579`, f64 reference `1.0000001788139343`, verified).

## Cut

1. "While the pipeline has only exact steps, also require exact origin-to-candidate equality. Once a changed split has been accepted, keep the origin tolerance requirement for the remaining pipeline, including across repeated optimize calls". Inline's exact check against its immediate input, on the same origin-derived cases, already implies the origin check. The extra check and the carried state can go.
2. "Precompute an independent set of equations at compile time, checking full column rank … At call time solve over exact rationals". No corpus program needs this solver.
3. "carry symbolic shape-dependent validity conditions to specialization (e.g. `H-2 >= 0`)". This is a call-time error contract beyond compile errors with `line:col`.
4. "Check identity candidates too, so every reported step has a verdict". A pass that makes no change needs no check.

## Framework changes

- **A synchronous native-pass entry with shared preparation and write enforcement:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It belongs in `define-pass.ts`.
- **Not minimal as specified:**
  - "a versioned descriptor (IR, adapter, writes, synchronous native kernel and required synchronous check)" duplicates `definePass`. Take a `Pass` and refuse `needs` and `preserves`.
  - "call the gate with origin, current and candidate" puts the tensor domain's origin policy into a framework signature. A `(before, candidate) => CheckResult` gate can close over the origin.
- No missed change: nothing calls the async `applyPass` on the read-only adapter.

## Keep

Keep the shape and value schedule, with the half-ULP sequence in storage order. Keep the decision that a nonfinite candidate fails against a finite reference. Keep the mutants (identity-order substitution, `floor(K/4)`), which must produce valid changed artifacts and fail through the actual gate.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-B:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
~~~~
