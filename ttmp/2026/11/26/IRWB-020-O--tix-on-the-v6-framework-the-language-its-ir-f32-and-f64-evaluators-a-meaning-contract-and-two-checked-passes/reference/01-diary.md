---
Title: Diary
Ticket: IRWB-020-O
Status: active
Topics:
    - compiler
    - ir
    - verification
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/01-framework-probes.mjs
      Note: Step 3, framework probes and their output
    - Path: repo://ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/02-tolerance-probe.mjs
      Note: Step 5, tolerance measurement and its output
ExternalSources: []
Summary: 'Chronological record of IRWB-020-O: the design turn (reading, framework probes, tolerance probe, design decisions), then the implementation.'
LastUpdated: 2026-11-26T13:13:47.710368384-05:00
WhatFor: What was done, what failed and why each decision was taken, in order.
WhenToUse: When resuming the ticket or reviewing how the design was reached.
---

# Diary

## Goal

Record the work on IRWB-020-O in order: stage 1 of the tensor domain on the v6 framework (the Tix language, its
IR, the f32 and f64 evaluators, the meaning contract, `inline` and `split-sum`). The design is in
`design-doc/01-tix-stage-1-language-ir-evaluators-meaning-contract-inline-and-split-sum.md`.

## Step 1: Read the brief, open the ticket

The task is a design-only turn: create the ticket, write the design document, start this diary, commit. A
reviewer replies afterwards and the implementation follows in the same session. I read the brief, looked at the
layout of the worktree, and created the ticket with a design document and this diary.

### Prompt Context
**User prompt (verbatim):** "Read your full brief at /tmp/claude-1000/-home-manuel-code-wesen-2026-11-24--compiler-workbench/6d4ded76-01c1-42ed-bd4c-3f506f14dfc9/scratchpad/claude-briefs/IRWB-020-O.md and carry it out exactly. It contains the policy, how to work in your git worktree, and the task (a design-only turn: create the docmgr ticket, write the design document, start the diary, commit). When you are done, reply with the final message the brief asks for."

<details>
<summary>The brief (verbatim)</summary>

> ## Policy (follow throughout)
> When writing a design, specification or plan (as opposed to changing code now):
> - State the supported input domain explicitly and specify behaviour only within it. Do not add status codes, error precedence or guarantees about state on failure for inputs outside it unless the user asks for them.
> - For each significant decision, name the simplest alternative that would serve the goal and say why it was chosen or why it falls short. In design documents, decision records and reviews, comparing alternatives is requested; contrastive phrasing is allowed for that purpose.
> - Covering every part of a request means addressing each requested item, not maximizing its depth. Prefer the smallest deliverable that fully meets the goal, and list what you left out and why.
> - Describe only what can be built with the current code. Work that depends on missing features gets one line each in a "Later" list.
> - If a small piece of infrastructure is missing, propose the change instead of designing around it.
> In all tasks: before relying on a language, library, loader or tool feature you have not seen work in this repository, run a minimal probe and state the result.
> Work only from the files in your worktree (and any outside repository your task names). Do not read other git branches, other worktrees, or other agents' tickets.
>
> ## How to work in this environment
> - Your git worktree is `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-fa-x-irwb-020-o` (branch `t1-fa-x/irwb-020-o`). Do all work there. Shell state does not persist between your commands, so start every shell command with `cd /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-fa-x-irwb-020-o && `, and use absolute paths under `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-fa-x-irwb-020-o` for file tools.
> - Do not spawn subagents. Do not read or modify anything outside your worktree except installed skills and tools (`node_modules` resolves from the repository root).
>
> ## Task
> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). Until now it has compiled one language: Typed, a small statically typed language, to 32-bit RISC-V. Every optimization pass is checked against the original program. The compiler is built on a reusable IR framework in `src/framework/` (`core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`), which has so far carried only that one domain. The Typed domain is in `src/typed/`.
>
> This task starts a second domain on the same framework: tensor programs, eventually compiled to CUDA for an NVIDIA GPU. The purpose is to test the framework, not to build a product. Where the framework does not fit tensor programs, that is a finding. Each change you make to `src/framework/`, with its reason, is the primary result of this stage.
>
> Your ticket is IRWB-020-O. This turn is **design only**: create the ticket, write the design document, start the diary, and commit. A reviewer will read the design and reply in this session. Implementation follows after the review, in the same session.
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
> - Use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-020-O:`. Do not push.
> - Final message: the ticket and design paths, the framework changes you propose, the commit hash.
>
> Your ticket ID is IRWB-020-O. Name the ticket after the stage-1 work (the Tix language, its IR, evaluators, contract and passes).

</details>

**Assistant interpretation:** Design stage 1 of the tensor domain, record every proposed framework change with
its reason, keep to the policy (explicit input domain, simplest alternative per decision, smallest deliverable,
probes before relying on anything unseen), and commit on `t1-fa-x/irwb-020-o` without pushing.
**Inferred user intent:** Learn where the v6 framework does not fit a second domain, from a design small enough
to review and implement in one session.

### What I did
- `git status`, `git log`, `ls` of `src/framework/*`, `src/typed`, `tests/*`, `corpus`, `ttmp`.
- `docmgr ticket create-ticket --ticket IRWB-020-O --title "Tix on the v6 framework: ..." --topics compiler,ir,verification,typescript`
- `docmgr doc add --ticket IRWB-020-O --doc-type design-doc --title "Tix stage 1: ..."` and
  `docmgr doc add --ticket IRWB-020-O --doc-type reference --title "Diary"`.
- `npm run build` (3.4 s) and `node --test tests/framework/core.test.mjs` (13 pass), to know the build and the
  test runner work in this worktree before writing probes against `dist/`.

### Why
- The probes of steps 3 and 5 import from `dist/`, so the build had to work first.

### What worked
- `node_modules` resolves from the repository root, so `npm run build` runs `tsc` from inside the worktree.

### What didn't work
- Nothing failed in this step.

### What I learned
- Node is 24.18.0. `dist/` is ignored by git. The ticket workspace has `scripts/` for probe code.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Ticket: `ttmp/2026/11/26/IRWB-020-O--tix-on-the-v6-framework-the-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/`.

## Step 2: Read the framework and how Typed uses it

I read the three READMEs the brief names and the code a domain touches, to list what the tensor domain must
supply and what it can reuse. The outcome is the list of framework pieces the design uses and two places where
I expected trouble, which step 3 then probed.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/strategy/README.md`.
- Read `src/framework/passes/define-pass.ts`, `src/framework/contracts/differential.ts`,
  `src/framework/contracts/types.ts`, `src/framework/contracts/definitions.ts`, `src/framework/core/data.ts`,
  `src/framework/ir/adapters.ts`, `src/framework/ir/types.ts`, and the parts of
  `src/framework/contracts/analysis-manager.ts` around `verifyTransformation` and `invariantInternal`.
- Read `src/typed/project.ts`, `src/typed/meaning-exec.ts`, `src/typed/ir.ts`, the head of `src/typed/passes.ts`
  (`typedPass`, `optimizationContract`), `meaningKept` in `src/typed/evaluate.ts`, the head of
  `src/typed/mutate.ts`, and `tests/framework/ext-e3-e6.test.mjs`, `tests/framework/layering.test.mjs`.

### What I learned
- A domain supplies: an IR definition (`defineIR`), an adapter with a projection into entities and relations
  (`defineAdapter`), passes (`definePass`) and a contract. Typed's contract is a transformation with inputs
  `{ input, origin }` whose `ensures` is a `differential` invariant.
- `differential`'s `run` receives `side` (`'baseline'` or `'subject'`), so one side can run in f64 and the
  other in f32 without any change.
- `applyPass` is `async`, and so is every path through `AnalysisManager`. The fixed `optimizeTix` returns its
  result directly.
- `applyPass` calls `view.beginEdit()` before running any pass; `IREdit`'s constructor throws when the adapter
  has no `rebuild`.
- Artifact values and check evidence go through `immutable`: finite numbers only, and -0 becomes 0.
- `runDifferential` is exported for use without a manager and is synchronous.
- `src/labs/expressions.ts` has a small IR and adapter the framework tests use; the tests for the framework
  changes can use it too.

### What warrants a second pair of eyes
- Whether I missed a synchronous path through the manager. I found none: `checkInvariant`, `condition`,
  `verify` and `verifyTransformation` are all `async`.

## Step 3: Probe the framework with a miniature statement-level IR

Before designing around what I had only read, I wrote a probe that builds a miniature of the planned IR
(statements as entities, `reads` relations) and runs the framework on it. It confirmed two misfits that need a
framework change and showed that the rest works at statement level.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Wrote `scripts/01-framework-probes.mjs` and ran it with `node`.

### What worked
- Output (Node 24.18.0, after `npm run build`):

```
A  applyPass, adapter without rebuild: {"threw":"ir.capability: Adapter adapter.probe-mini is not Rewritable"}
B1 applyPass returns a Promise: true
B2 entity changes: ["removed t:e","updated t:y"]
B3 relation changes: ["removed contains:e","updated contains:y","removed reads:e:x","removed reads:y:e","inserted reads:y:x"]
B4 a pass that declares only tensor.def entities and no relations: {"threw":"undeclaredWrite: [undeclaredWrite] Pass probe.inline changed kinds it did not declare in writes"}
C  runDifferential (no manager, no await): {"status":"agree","agree":3,"total":3}
D  evidence { got: NaN } through the manager: {"threw":"Error: IR data must contain only finite numbers"}
E1 immutable({ v: -0 }) keeps the sign: false
E2 immutable({ v: Infinity }): {"threw":"Error: IR data must contain only finite numbers"}
F  by hand, synchronously, no rebuild: {"changed":true,"undeclared":[],"correspondence":["fn -> fn (retained)","t:e+t:y -> t:y (inlined)","t:x -> t:x (retained)"],"gate":"agree"}
```

### What didn't work
- First run: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../ttmp/dist/framework/contracts/definitions.js'`.
  The imports went five directories up; the ticket's `scripts/` is six below the repository root
  (`ttmp/2026/11/26/<ticket>/scripts`). Fixed with `sed` to `../../../../../../dist/`.

### What I learned
- F1: a checked pass cannot be applied synchronously through `applyPass` (B1), yet every step before the
  contract gate is synchronous and manager-free (F), and so is `runDifferential` (C).
- F2: a native-result pass needs `rebuild` on its adapter only because `applyPass` opens an edit it never uses
  (A against F).
- The declared-writes check is useful at statement level: `inline` must declare `contains` and `reads`, and a
  pass that declares only `tensor.def` cannot touch a parameter or a signature (B4).
- Non-finite numbers in evidence make the manager throw a plain `Error` (D). The contract's evidence will carry
  values as text.

### Why
- The policy asks for a probe before relying on a feature not seen working in the repository, and for a
  proposed change where a small piece of infrastructure is missing.

### What warrants a second pair of eyes
- F1's shape: `applyPassSync` takes a `check` function; it does not evaluate a `TransformationDefinition`. The
  alternative (a synchronous contract evaluator in `contracts/`) would be a second, partial implementation of
  what the manager does.

## Step 4: Decide the language rules and the IR

With the framework questions settled, I fixed what the brief leaves open in the language and chose the IR. The
main outcomes: the IR is the checked program with every extent explicit; a two-level sum is a `block` field on
the reduction; one checker serves the front end and the IR validator.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Wrote the six corpus programs on paper against the grammar to see what the checker must accept (the declared
  type for conv2d's `i`, `j`; shape names as values in `/ D` and `sqrt(A)`).
- Worked out the bounds rule for affine index expressions over symbolic extents.

### What I learned
- The grammar is ambiguous at `max(a, b) - x` (a call minus `x`, or a reduction over `a, b` of `-x`). It is
  resolved by scope: a call when both names are shape names, which index names may not be.
- Inference cannot be redone after `inline`: an index can be left with only affine uses. So the IR stores
  extents.
- The fixed core cannot express a two-level sum for a symbolic extent: block counts need a division. Three
  forms were possible; `block: B` on the reduction is one field, keeps every extent affine (so the same checker
  validates every revision) and lowers to the same two loops as the others.
- With the wording "single use", `inline` fires on mlp and attention as I first wrote them, and on layernorm
  once `sqrt(var[i] + 1e-5)` is its own statement. Written with the same index names in producer and consumer, a
  wrong `inline` that skips index substitution would be right by accident, so attention reads `p` under other
  names and the wrong-variant test uses a transposed read.

### What was tricky to build
- The wrong variant of `split-sum`. With `block` on the reduction, the remainder is part of the IR's meaning and
  a pass cannot drop it. The wrong variant therefore sets `block` and shortens the extent by one, which the
  explicit extents make expressible and the bounds check accepts (the access stays in bounds).
- Blocks of 4 leave a 5-term sum in the same order: `(x0+x1+x2+x3) + x4`. The association first changes at 6
  terms, which sets the shape range of the contract (1 to 8).

### What warrants a second pair of eyes
- `block` as the form of a two-level reduction (open question 2 of the design).
- The bounds check ignores relations between shape names that hold only because an extent is positive. It is
  sound; it can reject a program that is in bounds only through such a relation.

## Step 5: Measure the tolerance

The brief asks for a tolerance and a justification. I measured, on the planned domain, how far f32 results are
from f64 for three corpus programs written by hand, as written, with sums in blocks of 4, and with a wrong split
that loses the last term. The first scale I tried did not hold up, and the measurement changed the design.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Wrote `scripts/02-tolerance-probe.mjs` (matmul, softmax, layernorm with `Math.fround`; shapes 1 to 8, values in
  [-2, 2], mulberry32 seed 1) and ran it with 20,000 and then 100,000 cases per program (9.7 s).

### What didn't work
- First version: error relative to the largest reference output only. Its output with 20,000 cases (the softmax
  block and two layernorm lines omitted):

```
matmul: 20000 cases, shapes 1..8, values in [-2, 2]
  largest error / scale:  as written 526.1 u,  sums split 161.1 u   (tolerance 4096 u)
  split differs in f32 bits: 7087 cases; 7087 of the 7471 with 6 or more summed terms
  wrong split (last term lost) within tolerance: 2 of 17566 cases; its least error 5.13e-1 x tolerance
  as-written f32 fails elementwise allclose(rtol 1e-5, atol 1e-8) against f64: 502 cases
layernorm: 20000 cases, shapes 1..8, values in [-2, 2]
  largest error / scale:  as written 361.2 u,  sums split 361.2 u   (tolerance 4096 u)
  wrong split (last term lost) within tolerance: 0 of 17595 cases; its least error 2.14e+0 x tolerance
```

  526 u for an unchanged matmul comes from outputs that are one element near zero through cancellation: the
  rounding error scales with the operands and the output does not. The tail is heavy, so a larger sample would
  go higher.

### What worked
- Scale `s` = the largest magnitude among the case's inputs and the reference output. Output of the script as
  committed (100,000 cases):

```
matmul: 100000 cases, shapes 1..8, values in [-2, 2]; tolerance 4096 u x scale
  largest error / scale:  as written 5.8 u,  sums split 5.8 u
  split differs in f32 bits: 35695 cases; 35695 of the 37565 with 6 or more summed terms
  wrong split (last term lost) within tolerance: 6 of 87581 cases with 2 or more summed terms
  alternatives, as-written f32 against f64: largest error / (largest |reference| only) 526.1 u; fails elementwise allclose(rtol 1e-5, atol 1e-8) in 2415 cases
softmax: 100000 cases, shapes 1..8, values in [-2, 2]; tolerance 4096 u x scale
  largest error / scale:  as written 1.7 u,  sums split 1.7 u
  split differs in f32 bits: 26706 cases; 26706 of the 37576 with 6 or more summed terms
  wrong split (last term lost) within tolerance: 0 of 87483 cases with 2 or more summed terms
  alternatives, as-written f32 against f64: largest error / (largest |reference| only) 3.9 u; fails elementwise allclose(rtol 1e-5, atol 1e-8) in 0 cases
layernorm: 100000 cases, shapes 1..8, values in [-2, 2]; tolerance 4096 u x scale
  largest error / scale:  as written 285.4 u,  sums split 285.4 u
  split differs in f32 bits: 29339 cases; 29339 of the 37358 with 6 or more summed terms
  wrong split (last term lost) within tolerance: 1 of 87619 cases with 2 or more summed terms
  alternatives, as-written f32 against f64: largest error / (largest |reference| only) 442.5 u; fails elementwise allclose(rtol 1e-5, atol 1e-8) in 3098 cases
```

### What I learned
- `tau = 2^-12` (4096 u) relative to `s` leaves a factor 14 above the worst correct result (layernorm, rows whose
  variance is near `eps`) and rejects the wrong split in all but 7 of about 262,000 cases; a check has 16 cases.
- Elementwise `allclose` rejects the unchanged program in 2.4% (matmul) and 3.1% (layernorm) of cases.
- The exact relation will see `split-sum`: 71% to 95% of cases with 6 or more summed terms change bits.

### Why
- A constant without a measurement on both sides would be a guess. A per-element running error bound would be
  better founded, and it needs a second, bound-carrying evaluator; it is in the design's Later list.

### What warrants a second pair of eyes
- The probe covers three of the six programs with hand-written loops, not the real evaluator. The design makes
  the same measurement a test over all six.
- Layernorm's worst case by analysis is higher than the 285 u observed (amplification up to `1/sqrt(eps)`, about
  316, of a few `u` times the operands), still under 4096 u on this domain.

## Step 6: Write the design, bookkeeping, commit

I wrote the design document with the framework findings first, each decision with its simplest alternative, a
list of what is left out and a Later list, then filled the ticket index, tasks and changelog and committed.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Wrote `design-doc/01-tix-stage-1-language-ir-evaluators-meaning-contract-inline-and-split-sum.md`.
- `docmgr doc relate`, `docmgr task add`, `docmgr changelog update`, `docmgr doctor --ticket IRWB-020-O`.
- Committed on `t1-fa-x/irwb-020-o` with a message starting `IRWB-020-O:`. The hash is in the final message of the
  turn and will be recorded in the next step.

### What didn't work
- No vault report was written: the brief confines all writes to the worktree.

### What warrants a second pair of eyes
- The two open questions at the end of the design.

### What should be done in the future
- After the review: implement in the order of the design's implementation plan, one diary step per plan step.

### Code review instructions
- Read the design's section 2 (framework), then 6 (contract) and 7 (passes).
- Re-run the probes: `npm run build`, then `node <ticket>/scripts/01-framework-probes.mjs` and
  `node <ticket>/scripts/02-tolerance-probe.mjs`.
