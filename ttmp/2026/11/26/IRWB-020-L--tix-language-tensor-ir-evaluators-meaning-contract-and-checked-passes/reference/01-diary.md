---
Title: Diary
Ticket: IRWB-020-L
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
Summary: ""
LastUpdated: 2026-11-26T12:54:58.633642558-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1 — Trace the framework and prepare the Stage 1 design

The fixed Tix API called for synchronous optimization. I read the v6 contract, IR and strategy guides, then followed Typed's artifact creation, pass registration and origin-based meaning checks through the actual calls. The direct differential runner and affine tensor trees cover most of the new domain. A native pass entry point is the proposed framework change.

The design also fixes the observable f32 order and writes down a concrete reassociation witness. This checkpoint contains the design and ticket records. The pass and evaluator implementation follows review.

### Prompt context

**User prompt (verbatim)**

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.
>
> This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.
>
> Your ticket is IRWB-020-L. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.
>
> ## Stage 1 (yours): the language, its IR, evaluators, a contract, two passes
> - **Tix,** a small index-notation language, specified below. Parse it and check it (shapes, index extents, single assignment), with errors that give `line:col`.
> - **Its IR as a v6 artifact** in `src/tensor/`, using `src/framework` (artifacts, IR definitions, contracts, passes). Choose the IR's form.
> - **Two evaluators:** f32 (the program's meaning, defined below) and f64 (a reference for tolerance checks).
> - **A meaning contract for tensor passes.** It needs a domain (which shapes and input values to check on), an observation (what is compared) and a relation. The relation is either exact (bit-identical f32 outputs) or a tolerance against the f64 reference. Choose the tolerance and justify it.
> - **Two checked passes** that exercise the contract:
>   - `inline`: substitute a pointwise statement with a single use into its consumer. Its f32 results must be bit-identical.
>   - `split-sum`: rewrite a `sum` reduction over one index into a two-level reduction (blocks, then within blocks). It reassociates the sum, so f32 results change, and it must be accepted only under the tolerance relation.
>
>   Show that the exact relation rejects `split-sum`, that the tolerance relation accepts it, and that the contract rejects a deliberately wrong variant of each pass.
> - **A corpus** under `corpus/tensor/<name>/main.tix`, with at least: matmul, softmax (max-shifted), layernorm (gamma, beta, eps), single-head attention, an MLP block with tanh-GELU, and conv2d (NCHW, stride 1, no padding).
>
> Later stages, which are not yours: lowering to CUDA and running it on the GPU machine, fusion, tiling of contractions, attention-specific rewrites. Do not design them. Do not let them bend this stage, beyond keeping the IR suitable for loop-level lowering.
>
> ## Tix, fixed core (implementations are compared on it)
> ```
> program := fn+
> fn      := 'fn' NAME '(' param (',' param)* ')' ':' type '{' stmt* 'return' NAME ';' '}'
> param   := NAME ':' type
> type    := 'f32' '[' dim (',' dim)* ']'        dim := affine expression of shape names and integers (N, D, H - 2)
> stmt    := NAME '[' NAME (',' NAME)* ']' (':' type)? '=' expr ';'
> expr    := expr ('+' | '-' | '*' | '/') expr | '-' expr | NUMBER | SHAPENAME | ref | call | reduce | '(' expr ')'
> ref     := NAME '[' aff (',' aff)* ']'           aff := affine expression of index names and integers (y + dy)
> call    := ('exp' | 'log' | 'sqrt' | 'tanh') '(' expr ')' | ('max' | 'min') '(' expr ',' expr ')'
> reduce  := ('sum' | 'max') '(' NAME (',' NAME)* ')' expr
> ```
> - Line comments are `//`. Precedence is the usual one: unary minus, then `*` and `/`, then `+` and `-`, all left-associative.
> - A reduction's body extends as far right as possible, to the end of the enclosing parentheses or statement. So `sum(d) x[i, d] / D` sums `x[i, d] / D`, and `(sum(d) x[i, d]) / D` divides the sum.
> - Each statement defines a new tensor, assigned once. Its left-hand index names range over extents inferred from their plain (non-affine) uses on the right. An index used only in affine positions takes its extent from the statement's declared type, which is then required.
> - Reduction indices are bound by their reduction and range over extents inferred the same way. A shape name such as `D` used in an expression denotes its value as a number. A function's shape names are bound by its inputs' shapes when it is called.
> - **f32 meaning:**
>   - every literal, shape value, operation and function result is rounded to f32 (`Math.fround` of the JavaScript double result);
>   - `sum` starts at 0 and `max` at −∞, and both accumulate in increasing lexicographic order of their indices, the first listed outermost, rounding after each step.
>   - Inputs are finite. Behaviour outside the valid domain (inconsistent shapes, an extent that cannot be inferred) is a check error at compile time.
>
> Example:
> ```
> fn softmax(x: f32[N, C]): f32[N, C] {
>   m[i] = max(j) x[i, j];
>   e[i, j] = exp(x[i, j] - m[i]);
>   s[i] = sum(j) e[i, j];
>   y[i, j] = e[i, j] / s[i];
>   return y;
> }
> ```
>
> ## Fixed API (in `dist/tensor/index.js` after the build)
> ```ts
> compileTix(source: string): TixProgram      // throws Error whose message contains line:col on invalid source
> runTix(program: TixProgram, fn: string,
>        inputs: Record<string, { shape: number[]; data: Float32Array | Float64Array }>,
>        options?: { precision?: 'f32' | 'f64' }): { shape: number[]; data: Float32Array | Float64Array }
> optimizeTix(program: TixProgram, passes: string[]): { program: TixProgram; steps: { pass: string; accepted: boolean }[] }
> ```
> `runTix` takes row-major data. `optimizeTix` runs the named passes in order, each checked by your contract, and returns a program `runTix` can run. Anything beyond this API is yours to design.
>
> ## Repository facts
> - Build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`. See `tests/framework/core.test.mjs` for the pattern. Prettier: 110 columns, single quotes.
> - Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/strategy/README.md`, and enough of `src/typed/` (for example `src/typed/passes.ts`, `src/typed/evaluate.ts`, `src/typed/project.ts`) to see how one domain uses the framework.
> - Nothing checks tensor programs yet. The Typed corpus-wide tests cover only `corpus/projects`. Your tests are the only checks on your work, so put them where the risk is.
> - In the sandbox, a test that spawns `node` can fail with EPERM. Request escalation for that command.
> - Scope: you may add `src/tensor/`, `tests/tensor/` and `corpus/tensor/`, and change `src/framework/` where the tensor domain needs it. Record every framework change in your design. After the implementation, run `node --test tests/framework/` and the tests in `tests/typed/` that cover what you changed. Do not modify `src/typed/`, `tools/`, `corpus/projects/` or existing tests, except framework tests that your framework change makes necessary.
> - Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-L:`. Do not push.
> - Final message: the ticket and design paths, the framework changes you propose, the commit hash.
> Your ticket ID is IRWB-020-L. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).

**Interpretation.** Produce the design now. Use the second domain to identify what the framework needs independently of the tensor code.

### What I did

- Created IRWB-020-L with `docmgr ticket create-ticket` and added the design and diary with `docmgr doc add`.
- Traced `TypedBlocks`, `typedPass`, `meaningKept`, `optimizationContract` and `runPipeline`. Reviewed the framework's artifact validation, adapter capabilities, pass runner and differential checker.
- Built the worktree with `npm run build`. Ran `node --test tests/framework/ext-e3-e6.test.mjs tests/framework/ext-e5.test.mjs`; both files passed.
- Ran a minimal `node --input-type=module` probe against `dist/framework/` with Node 24.18.0. It built a native artifact with a flat or blocked fold, exercised the managed gate and pass, and checked the standalone differential verdicts.

### Why

A scoped native IR resolves index extents once and leaves the evaluation order explicit for both precisions. Using the existing standalone differential runner keeps the relations in the tensor domain. A synchronous native pass with shared candidate preparation addresses the synchronous API and the unused edit requirement together.

### What worked

The standalone differential run gave `disagree` for the exact relation and `agree` for tolerance. With `[1,0,0,0,2^-25,2^-25,2^-25,2^-25]` and block size four, the flat f32 word was `0x3f800000`, the blocked f32 word was `0x3f800001` and the flat f64 result was `1.0000001192092896`. The same word-view method distinguished positive and negative zero. Node executed the exact integer `BigInt` arithmetic probe successfully. `docmgr doctor --ticket IRWB-020-L --stale-after 30` passed, and the ticket, design and diary links resolved inside the worktree.

### What did not work

The first `node --input-type=module` probe called `applyPass` with an adapter that projects but has no `rebuild`. It failed at `view.beginEdit()` with `IRError: Adapter probe.adapter is not Rewritable` (`ir.capability`), before the native body ran. The follow-up asserted that failure and ran the same native body with a Rewritable adapter whose `rebuild` would throw. The pass succeeded and never called `rebuild`.

The sandboxed `git add -- ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes` failed with `fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/t1-sx-irwb-020-l/index.lock': Read-only file system`. The local commit needs the elevated Git invocation for this worktree index.

### What I learned

`runDifferential` is already a synchronous, comparator-agnostic framework API. `applyPass` and `verifyTransformation` return promises even for synchronous evaluators and gates. Typed's approach to retaining an origin still applies to tolerance checks. An exact inline after a tolerant step instead compares bitwise to its predecessor on the same cases, preserving whatever observation was accepted against the origin.

### What was tricky

The parser has one overlap between a two-shape-argument `max` call followed by subtraction and a two-index `max` reduction with a unary-minus body. The design specifies the resolution and a grouping spelling. Symbolic dimensions also require separating source contradictions from checks that require the caller's concrete dimensions.

### What warrants a second pair of eyes

Review the affine access checks and their compile/call boundary, the fixed tolerance and sample budget, and the scope of the synchronous native entry point. The existing managed pass tests are the baseline for the shared candidate-preparation change.

### What should be done in the future

Incorporate the reviewer response before implementing. After implementation, run the tensor corpus and deliberate mutants, then run the framework suite and Typed regressions.

### Code review instructions

Start with the framework changes and gate tests in the [Stage 1 design](../design-doc/01-stage-1-design-for-tix-tensor-programs.md). The two targeted commands above exercised the existing framework. The probe tested the arithmetic and acceptance machinery directly. Tensor parsing and pass behavior will have their own tests after implementation.

## Step 2 — Revise the design after review

The review identified a reference-lifetime bug in the proposed API. The revised program handle retains the flat source artifact across optimization calls. Wrong variants are now test kernels registered with the same pass API and checked on generated inputs. Framework coverage goes in a new test file.

### Prompt context

The reviewer requested a separate revision commit followed by Stage 1 implementation and targeted verification. The review required actual wrong kernels, a new framework test file and a persistent reference. It asked to cut the joint rank solver and call-time access checks, and clarified that the native runner should take a `definePass` pass.

### Decisions and checks

- Kept direct exact inversion for single-symbol affine input axes to handle `2*N+1` without a joint solver. Coupled axes can be checked after names are bound by other axes.
- Moved the access proof to compile time using symbolic intervals and simple sufficient bounds. Concrete calls remain limited to valid shape bindings.
- Kept the standalone differential runner, exceptional-value matching, the rounding witness, and one origin-derived suite per call.
- The implementation and review gates follow this documentation checkpoint.

## Step 3 — Add the synchronous native pass runner

The new framework entry point takes the existing `definePass` object and reuses native candidate preparation, correspondence and declared-write checks from `applyPass`. It accepts a synchronous check and exposes its decision as pass evidence. It can open a read-only adapter because it does not start an edit.

### Prompt context

**User prompt (verbatim)**

> A reviewer has read your design for IRWB-020-L. The review:
>
> # Review of your design
>
> ## Must change
>
> 1. **The wrong variants are artifact edits, not pass variants.** The design says "Change an inlined addition to subtraction while keeping the artifact valid" and "Mutate a blocked sum with a fixed extent of seven to stop at four". The brief requires that the contract reject a deliberately wrong *variant of each pass*. Define each wrong variant as a kernel, run it through `applyNativePassSync`, and check it on the contract's generated cases, not as a hand-mutated artifact.
> 2. **Scope.** "`tests/framework/ext-e3-e6.test.mjs` | Check that a read-only projection supports the new native path…". The brief allows edits to existing framework tests only where the framework change requires them. Put the new tests in a new file.
> 3. **Which program is the reference across calls.** The design says "`TixProgram` is a v6 `Artifact<TensorIR>`" and "`split-sum` always compares to the pipeline origin's flat f64 evaluation". On a second `optimizeTix` call, the pipeline origin may already be split, so its f64 run is no longer flat. State which program is the tolerance reference, and where it is kept.
>
> ## Cut
>
> 1. "check that the affine input axes determine every shape name uniquely by rank over the rationals". No corpus program needs this solver.
> 2. "Discharge remaining shape-dependent access and extent conditions when actual shapes are bound, before indexing". This is a call-time error contract beyond compile errors with `line:col`.
>
> ## Framework changes
>
> - **`applyNativePassSync` sharing candidate creation, diff, correspondence and write checks with `applyPass`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal, and correctly placed in `define-pass.ts`. The design does not say whether it takes a `definePass` `Pass`. It should, so that pass metadata is not declared a second time.
> - No missed change. Your probe correctly found the `beginEdit` capability error, and the sync path avoids it.
>
> ## Keep
>
> - Matching nonfinite references by NaN or signed infinity, instead of failing them. This keeps zero and signed-zero inputs usable.
> - The 2⁻²⁵ witness, which separates the two orders (`0x3f800000` against `0x3f800001`, verified).
> - One origin-derived suite per call.
>
> Now do the following in this session:
> 1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
> 2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-L:`, and keep the diary at each significant step.
> 3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
> 4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.

### Decisions and evidence

- The review revision is `afa7ca0`. The synchronous path uses the existing registered pass with empty analysis records and an unavailable edit capability. It validates the artifact under the adapter and declared IR type, checks declared writes before the gate, and returns the candidate after acceptance.
- `npm run build` passed. `node --test tests/framework/native-pass-sync.test.mjs tests/framework/ext-e3-e6.test.mjs` passed both files. The new tests cover a read-only adapter, change and correspondence evidence, undeclared writes, rejected evidence and misuse of the synchronous API.
- `node --test tests/framework/*.test.mjs` passed all 18 files. `node --test tests/typed/passes.test.mjs tests/typed/strategies.test.mjs` passed both existing Typed files, including native, edit and strategy call paths.
- The tensor implementation initially failed `npm run build` with `src/tensor/ir.ts(141,41): error TS7006: Parameter 'binder' implicitly has an 'any' type.` The `Array.isArray` check had widened the item type when iterating the readonly statements. I retained the explicitly typed statement list and the build passed.
