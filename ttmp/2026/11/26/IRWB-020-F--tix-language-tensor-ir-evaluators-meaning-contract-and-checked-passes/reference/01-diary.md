---
Title: Diary
Ticket: IRWB-020-F
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
Summary: Design investigation and implementation checkpoints for Tix.
LastUpdated: 2026-11-26T12:48:03.58980049-05:00
WhatFor: Record design and implementation evidence.
WhenToUse: Resume the ticket or review decisions and validation.
---

# Diary

## Step 1: Inspect the framework and prepare the Stage 1 design for review

I traced a Typed revision through its artifact adapter, `applyPass`, and the differential meaning invariant to
see where a tensor program could use the same machinery. The important mismatch is not representation or the
comparison relation; it is that the fixed synchronous API cannot await the current pass/contract lifecycle.
The proposed sync path deliberately does not implement transaction features that Tix does not need.

### Prompt Context

**User prompt (verbatim):**

~~~~markdown
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.

This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.

Your ticket is IRWB-020-F. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.

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
- Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-F:`. Do not push.
- Final message: the ticket and design paths, the framework changes you propose, the commit hash.
Your ticket ID is IRWB-020-F. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).
~~~~

**Assistant interpretation:** Propose a complete Stage 1 design and commit the ticket paperwork, then stop for review.

**Inferred user intent:** Use Tix to expose framework fit and non-fit rather than anticipate later GPU stages.

### What I did

- Read the framework contracts, IR and strategy READMEs, then the pass runner, artifact adapters, contract
  definitions/manager/evaluator, and Typed pass, evaluator and project integration.
- Created the ticket, design and diary with `docmgr`. Wrote the IR/shape model, evaluator and contract policy,
  rewrite tests, implementation/validation plan and framework change ledger.
- Probed the proposed f32 disagreement witness directly in Node 24:

  ```sh
  node --input-type=module -e 'const h=2**-24, x=[1,0,0,0,h,h], sum=(v,r)=>v.reduce((a,b)=>r(a+b),0), f=Math.fround; const a=sum(x,f), b=sum([sum(x.slice(0,4),f),sum(x.slice(4),f)],f), ref=sum(x,Number); const bits=new Uint32Array(new Float32Array([a,b,-0,0]).buffer); console.log({a,b,ref,bits:[...bits].map(v=>v.toString(16)),within:Math.abs(b-ref)<=2e-5+2e-5*Math.abs(ref)});'
  ```

### Why

A tensor-native tree keeps reduction order explicit. A small sync seam reuses native revision checks and
framework contracts without inventing a synchronous analysis/effects lifecycle or asking the tensor adapter to
implement a graph rebuild it would never use.

### What worked

The arithmetic probe printed sequential f32 `1` (`3f800000`), split f32 and f64 reference
`1.0000001192092896` (`3f800001` for f32), and `within: true`. The same probe distinguished `-0` from `+0`
(`80000000` vs `0`). This is arithmetic evidence, not an end-to-end pass test. A second Node probe used
`m = 2n**54n + 1n`, computed `(m - 1n) / 2n` exactly, and round-tripped the result through decimal text
(`9007199254740992`), confirming the proposed JSON-safe representation for wide affine integers.
`docmgr doctor --ticket IRWB-020-F --stale-after 30` reported all checks passed.

### What didn't work

No runtime failure was observed. Some exact-text edits to generated prose did not match; the edit tool
reported `Could not find the exact text`. The design scope note and ticket links were updated with narrower
replacements. The build and test suites are deferred to implementation.

### What I learned

`applyPass` creates an `IREdit` before invoking even a native rewrite, so the async path currently requires
adapter rebuild for a pass that may never use it. `differential` already accepts custom relations and has a
local sync evaluator; the evaluator itself does not require a change to handle tolerance.

### What was tricky to design

Exact preservation after a tolerant rewrite must compare against the immediate predecessor. The cumulative
error check still needs r0, so later exact rewrites cannot spend the remaining tolerance or shift the baseline.

### What warrants a second pair of eyes

Check that the sync subset cannot silently drop a contract clause. Review the compile-time versus invocation
split for symbolic affine bounds, and the limits and witness coverage of the sampled domain.

### What should be done in the future

Wait for review in this session. Then implement and validate in the order listed in the design; record any
new framework changes with their reason.

### Code review instructions

Start with the framework change ledger in [the design](../design-doc/01-stage-1-design-tix-and-checked-tensor-passes.md),
then compare `applyPass`, `differential`, and `AnalysisManager.verifyTransformation`. No source code was changed.

### Technical details

Node reported `v24.18.0`. The probe used two contiguous blocks (four and two elements), rounding each
accumulation via `Math.fround`. The design records separate tests for an affine-inline index bug and a
missing split-sum tail; neither was implemented or tested in this turn.

## Step 2: Revise the design after review

The review identified an underspecified sample order and a shared budget that could reject a correct blocked
sum. I specified the ordered shape streams, quotas and replayable patterns, and gave transformed revisions
a separate 500K-step cap. I removed both redundant r0 checks for inline and the proposed contracts API.

### Prompt Context

**User prompt (verbatim):**

~~~~markdown
A reviewer has read your design for IRWB-020-F. The review:

# Review of your design

## Must change

1. **Case selection is not defined.** "Try uniform shape-name assignments, single-name perturbations and bounded mixed assignments from `{1,2,3,4,5,6,8,9}`, in a fixed order … reserve half for nonuniform assignments if there are multiple names and feasible choices. … Prioritize block-boundary values". The design never states the order, the perturbation rule or the reservation rule, so the implementer must invent the domain. Write it down.
2. **Budget.** "If any function has no cases, or an evaluated case exhausts its budget, the changed candidate cannot be accepted." Cases are screened on r0, and `split-sum` adds outer accumulation steps. A correct candidate near the 250K-step cap is therefore rejected. Say how the candidate's budget is set.

## Cut

1. Inline's extra checks: "check exact against the immediate predecessor and against r0 if still in exact mode. After an accepted tolerant edit, additionally require the r0 tolerance check". Exact agreement with the predecessor, on the same r0-derived cases, already implies both.
2. "At invocation, solve the fixed system exactly … uniquely determined over the rationals (full column rank)", "carry residual obligations on symbolic dimensions into shape binding" and "keep the original invocation-domain obligations". No corpus program needs this solver. It adds a call-time error contract beyond compile errors with `line:col`.

## Framework changes

- **`applyNativePassSync` with shared native-candidate preparation:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal and in the right file.
- **`contracts/`: "an explicit context-free, synchronous invariant definition and a `verifyPostconditionsSync` runner":** not needed. Without `decide`, a differential invariant's `check` is already synchronous, and `runDifferential(differentialSpec(inv), ports)` returns the verdict. A `CheckResult` gate in the pass entry suffices. A new invariant kind plus a second postcondition evaluator is more than the gap requires.
- No missed change.

## Keep

Keep the length-six reassociation witness (`0x3f800001` against `0x3f800000`, verified) inside the domain, and the shape-valid mutants whose rejection is asserted as semantic rather than structural. Also keep the tolerance anchored at r0's f64.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-F:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
~~~~

### Decisions and evidence

- Retained exact affine binding and access checks because the fixed grammar accepts more than the corpus uses.
  The design explains the domain and reuses r0's shape planner rather than adding an obligation artifact.
- The synchronous runner accepts a domain-owned `CheckResult` gate; `contracts/` is unchanged.
- `npm ci --no-audit --no-fund` and the baseline `npm run build` succeeded. The install warned that esbuild's
  postinstall was not covered by `allowScripts`; TypeScript did not require it.
- Review the sample order and caps in **Meaning contract** and the narrowed **Framework change ledger**.
  Next: implement and test the frontend/evaluators, then the native runner and checked rewrites.

## Step 3: Implement the Tix frontend, IR, and interpreter

`compileTix` now produces an immutable v6 artifact, and the two precisions share a shape planner and
row-major evaluator. The parser infers index extents before creating the artifact; its validator independently
checks the tree and projects stable IDs, ordered containment, reads, and binding edges.

### Changes and rationale

- `src/tensor/parse.ts` parses greedy reductions and locates source errors. `affine.ts` normalizes affine
  terms and binds coupled dimensions with exact integer elimination. `ir.ts` defines native validation and
  the v6 read-only adapter. `evaluate.ts` plans access bounds and implements ordered reduction and rounding.
- Reused the r0 shape planner at runtime so an inlined-away materialization does not enlarge the input domain.
- Kept signed zero and canonical NaN in f32 buffers, outside the finite-JSON artifact format.

### Evidence and fixes

- `npm run build` initially reported TS2339, TS7006 and TS2345 in `src/tensor/ir.ts`: the exhaustive
  expression switch narrowed to `never`, and the parameter/definition array erased the subtype. The
  projection now traverses parameters and definitions separately. The build passed.
- `node --test tests/tensor/*.test.mjs` first failed on two test assertions: the anchored regexp matched
  `Error: ...` rather than the `.message` property, and `[1,1,5]` gave the same f32 answer for both division
  orders (`2.3333332538604736`). The `[1,1,3]` probe gave `1.6666667461395264` vs `1.6666666269302368`.
  The next run found a wrong expected scalar (`-3.75` vs `-3.25`); corrected the hand calculation.
- Review `tests/tensor/tix.test.mjs` for the source/shape boundary and independent f32, f64 and layout checks.

## Step 4: Gate native rewrites and qualify Stage 1

The sync path shares preparation and write auditing with async `applyPass`, but has no edit or analysis
transaction. Tix passes a domain-owned differential verdict into that entry point. Both rewrites and their
mutants run through the same artifact checks and gate.

### Changes and rationale

- Framework commit `a021809` — `IRWB-020-F: Add a synchronous checked native pass entry point`.
  Only `src/framework/passes/define-pass.ts` changed. New framework tests cover read-only adapters,
  tampered/invalid artifacts, undeclared writes, valid/rejected gate evidence and unsupported async features.
- `src/tensor/meaning.ts` selects cases in the revised order. Inline compares against the predecessor and
  split-sum compares against r0's f64, including across separate optimization calls. `passes.ts` keeps stable
  IDs when moving the producer's tree; no clone IDs are needed. The tail mutant changes the loop extent in
  the test artifact, not in the production IR schema.
- Added independent goldens for all six `corpus/tensor/*/main.tix` fixtures. A near-cap test confirms a correct
  split can cross the r0 cost cap and still fit its own cap.

### Validation

- `npm run build` — passed.
- `node --test tests/tensor/*.test.mjs` — 23 passed, including exact rejection of `0x3f800001` vs `0x3f800000`,
  tolerance acceptance, semantic rejection of both shape-valid mutants and rejection of cumulative drift.
- `node --test tests/framework/*.test.mjs` — 228 passed.
- `node --test tests/typed/{passes,inline,meaning-memo}.test.mjs` — 18 passed under the default test settings.
- No full suite run; no EPERM encountered. The verdicts remain sampled, not proofs.

### Review entry points

Start with `src/tensor/index.ts` for exports and `tests/tensor/passes.test.mjs` for contract evidence. The
[design ledger](../design-doc/01-stage-1-design-tix-and-checked-tensor-passes.md#framework-change-ledger)
records the only framework change. CUDA lowering and the later optimization stages remain out of scope.
