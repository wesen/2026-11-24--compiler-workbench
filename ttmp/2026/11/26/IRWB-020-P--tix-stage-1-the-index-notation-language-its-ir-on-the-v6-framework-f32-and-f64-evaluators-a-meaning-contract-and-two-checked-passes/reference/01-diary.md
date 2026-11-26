---
Title: Diary
Ticket: IRWB-020-P
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
Summary: "Chronological diary of IRWB-020-P (Tix stage 1)."
LastUpdated: 2026-11-26T13:08:36.498528758-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

Record the work on IRWB-020-P: the Tix language, its IR on the v6 framework, the evaluators, the meaning contract
and the two checked passes, with every framework change and its reason.

## Step 1: Read the framework as a second domain would, create the ticket

The turn is design only. I read the three framework READMEs the brief names, `passes/define-pass.ts`,
`passes/bridge.ts`, `contracts/differential.ts`, and the parts of `src/typed/` that show one domain's use of them
(`optimizationContract` in `passes.ts`, `runPipeline` in `project.ts`, `meaningKept` in `evaluate.ts`, the adapter
in `ir.ts`). Then I created the ticket and built the repository in the worktree.

Reading alone raised one conflict with the fixed API: `applyPass` and `AnalysisManager.verifyTransformation` are
`async`, and `optimizeTix` is specified to return its result directly.

### Prompt Context

**User prompt (verbatim):** "Read your full brief at /tmp/claude-1000/-home-manuel-code-wesen-2026-11-24--compiler-workbench/6d4ded76-01c1-42ed-bd4c-3f506f14dfc9/scratchpad/claude-briefs/IRWB-020-P.md and carry it out exactly. It contains the policy, how to work in your git worktree, and the task (a design-only turn: create the docmgr ticket, write the design document, start the diary, commit). When you are done, reply with the final message the brief asks for."

**Assistant interpretation:** Create ticket IRWB-020-P, write the stage-1 design under the brief's design policy
(explicit domain, simplest alternative per decision, smallest deliverable, probe before relying on a feature), start
this diary, commit on `t1-fa-m/irwb-020-p`, and report paths, proposed framework changes and the commit hash.

**Inferred user intent:** Test whether the v6 framework carries a second domain. The framework changes and their
reasons are the result that matters; the tensor compiler is the instrument.

### What I did

- `docmgr ticket create-ticket --ticket IRWB-020-P ...`; topics set to `compiler`, `ir`, `verification` (the
  vocabulary has no `framework` topic).
- `npm run build` in the worktree: succeeds in about 4 s (`node_modules` resolves from the repository root), Node
  v24.18.0.

### Why

- The design has to describe what the current code can carry, so the framework had to be read first.

### What worked

- The build, and `docmgr` in the worktree (root `ttmp/`, 18 tickets before this one).

### What didn't work

- No failures in this step.

### What I learned

- Typed's contract is a `TransformationDefinition` with ports `input`, `origin` and `output` and one `ensures`
  clause on a differential invariant. The caller supplies `origin` through `contractInputs`.
- `runDifferential(spec, inputs)` exists for running a differential spec without a manager, and is synchronous.

### What was tricky to build

- N/A (reading).

### What warrants a second pair of eyes

- N/A.

### What should be done in the future

- N/A.

### Code review instructions

- N/A (no code).

### Technical details

- `src/framework/passes/define-pass.ts`: `applyPass` is one `async` function; the part between the pass's return
  and the contract gate (artifact, diff, correspondence, `writes`) is synchronous.

## Step 2: Probe the framework with a toy second domain

Before designing on `definePass`, `applyPass` and the differential check for a new domain, I ran them. The probe
defines a toy IR (statements with a constant and the names they read), an adapter without `rebuild`, a native-result
pass, a wrong pass, and a contract with an `origin` port.

It failed on its first call, which is the stage's first framework finding: `applyPass` opens a graph edit for every
pass, and an edit requires a `Rewritable` adapter.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** The policy asks for a minimal probe of any framework feature not yet seen working for
this use.

**Inferred user intent:** Findings about the framework should come from running it.

### What I did

- Wrote `scripts/01-probe-framework-fit.mjs` and ran it from the worktree root after the build.

### Why

- Two design choices depended on the answers: whether the Tix adapter needs `rebuild`, and whether any checked path
  is synchronous.

### What worked

Final output:

```
0 adapter without rebuild, native-result pass: ir.capability - Adapter adapter.probe-toy is not Rewritable
1 applyPass returns a Promise: true
2 native result, origin port: changed = true entities changed = 2
3 wrong pass rejected with code contractRejected
4 runDifferential is synchronous: true agree 3/3
5 invariant.check without a manager context is synchronous: true true
6 a non-finite number in an artifact value is refused: IR data must contain only finite numbers
7 -0 kept as -0: false
```

### What didn't work

- First run, `node ttmp/.../scripts/01-probe-framework-fit.mjs`:

  ```
  IRError: Adapter adapter.probe-toy is not Rewritable
      at new Edit (dist/framework/ir/transactions.js:25:19)
      at View.beginEdit (dist/framework/ir/view.js:133:16)
      at Module.applyPass (dist/framework/passes/define-pass.js:72:23)
  ```

  The pass returns a native value and never uses the edit. I kept the failure as line 0 of the probe and gave a
  second copy of the adapter a `rebuild` that returns its base, to reach the remaining lines.

### What I learned

- `applyPass` needs `rebuild` from every adapter (proposed change F2: open the edit on first use).
- Nothing in the checked path is synchronous except `runDifferential` and a differential invariant's own `check`
  (proposed change F1: `applyPassSync` with a synchronous check callback).
- Artifact values canonicalise -0 to 0 and refuse NaN and infinities. The Tix IR holds only finite non-negative
  literals, so no change is needed.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- F1 gates a pass without the analysis manager, so `optimizeTix` leaves no manager record. The design keeps the
  manager path (`applyPass` with `tensorContract`) and tests that both give the same verdicts. Whether that is
  acceptable for the fixed API is a reviewer's call.

### What should be done in the future

- N/A.

### Code review instructions

- Run `npm run build && node ttmp/2026/11/26/IRWB-020-P--*/scripts/01-probe-framework-fit.mjs`.

### Technical details

- `src/framework/ir/transactions.ts`, `Edit` constructor: `if (!view.adapter.rebuild) throw ... not Rewritable`.

## Step 3: Choose the tolerance by measurement, write the design

I expected to propose a fixed relative tolerance, as the simplest rule. A probe on hand-written kernels over the
planned check domain showed that it does not separate correct programs from wrong ones, so the design uses a
running error bound instead, and the probe's numbers are its justification.

The rest of the design followed from the IR choice (statements as loop nests with explicit extents) and from the
two probes. The design document is `design-doc/01-...md`.

### Prompt Context

**User prompt (verbatim):** see Step 1.

**Assistant interpretation:** "Choose the tolerance and justify it."

**Inferred user intent:** A tolerance relation that accepts reassociation and still rejects wrong passes, with a
reason a reviewer can check.

### What I did

- `scripts/02-probe-tolerance.mjs`: matvec, softmax, layernorm and covariance kernels; sequential sums, sums in
  blocks of 4, and a wrong split that drops the partial last block; f32 against f64; extents 1 to 8, values in
  [-4, 4); 200,000 cases each.
- `scripts/03-probe-tolerance-rules.mjs`: the same kernels over an arithmetic, so they also run with a first-order
  running error bound; compares the fixed rule at four values of tau with the bound rule at factors 1, 2 and 4.
- Wrote the design document, the tasks and the changelog entry.

### Why

- The tolerance is the one numeric choice the brief asks to be justified, and the evaluators did not exist yet, so
  hand-written kernels were the cheapest evidence.

### What worked

Output of 02 (metric: max|c - r| / max|r|):

```
matvec     seq max 1.00e-4  split max 1.00e-4  split != seq bits in 30%  wrong differs in 75%, min 4.33e-6
softmax    seq max 2.75e-7  split max 2.21e-7  split != seq bits in 11%  wrong differs in 75%, min 1.53e-4
layernorm  seq max 2.85e-4  split max 2.85e-4  split != seq bits in 14%  wrong differs in 75%, min 1.11e-4
covariance seq max 9.01e-3  split max 9.89e-3  split != seq bits in 17%  wrong differs in 62%, min 1.61e-6
```

Output of 03, the lines the design quotes:

```
matvec: max |c-r|/bound over correct programs 0.887; non-finite bounds 0
  rule F  tau 0.0001: rejects correct 0.001%, accepts wrong 0.003%
          tau 0.001: rejects correct 0.000%, accepts wrong 0.032%
  rule B  rho 2: rejects correct 0.000%, accepts wrong 0.000%
softmax: max |c-r|/bound over correct programs 0.754; non-finite bounds 74961
  rule F  tau 0.0001: rejects correct 0.000%, accepts wrong 0.000%
          tau 0.001: rejects correct 0.000%, accepts wrong 0.896%
  rule B  rho 2: rejects correct 0.000%, accepts wrong 0.000%
layernorm: max |c-r|/bound over correct programs 0.941; non-finite bounds 0
  rule F  tau 0.0001: rejects correct 0.001%, accepts wrong 0.000%
          tau 0.001: rejects correct 0.000%, accepts wrong 0.009%
  rule B  rho 2: rejects correct 0.000%, accepts wrong 0.000%
covariance: max |c-r|/bound over correct programs 0.578; non-finite bounds 0
  rule F  tau 0.0001: rejects correct 0.074%, accepts wrong 0.007%
          tau 0.001: rejects correct 0.009%, accepts wrong 0.075%
  rule B  rho 2: rejects correct 0.000%, accepts wrong 0.001%
```

### What didn't work

- The fixed tolerance, as a design: correct evaluations reach 9.9e-3 relative error (covariance) while wrong ones go
  down to 1.6e-6, so no tau separates them.

### What I learned

- The split differs in bits from the sequential sum in only 11% to 30% of cases at these sizes (a block of 4 needs an
  extent of 6 or more to reassociate). The `exact` relation rejects `split-sum` because one differing case is
  enough, but the check domain must reach extent 6. It goes to 8.
- softmax's 74,961 non-finite bounds are all from the wrong split: with fewer than 4 classes it has no block, the
  sum is 0 and the division has no bound. The candidate's value is infinite there, so the relation tests "candidate
  element not finite" before "bound not finite" (rule order 2 before 3 in the design).

### What was tricky to build

- Every variant of a kernel must see the same sizes and data. The probes reset the generator's state before each
  variant instead of storing the draws.

### What warrants a second pair of eyes

- The bound is computed on the candidate program. A wrong pass that also makes its program ill-conditioned widens
  its own allowance. The design states this as a limit.
- The `max(` call-or-reduction rule (design section 3, rule 3) decides by whether the names are shape names.

### What should be done in the future

- After the evaluators exist, repeat measurement 03 through `runTix` and `runTixBound` on the corpus
  (`contract.test.mjs` asserts the origin's f32 result is within the bound).

### Code review instructions

- Read design sections 9 (framework changes), 6.3 (tolerance) and 12 (alternatives) first.
- `node ttmp/2026/11/26/IRWB-020-P--*/scripts/03-probe-tolerance-rules.mjs` reproduces the table (about 10 s).

### Technical details

- Bound of a rounded operation: `e = p + u * (|v| + p)`, u = 2^-24, p the propagated operand error (table in design
  section 6.3).

## Step 4: Revise the design after review

The reviewer accepted both framework changes and the tolerance rule, required two fixes on the manager path, and cut
three knobs. I accepted every item; none needed a counter-argument. The design document's new section 17 lists each
item and where it landed.

### Prompt Context

**User prompt (verbatim):** "Turn 2 for IRWB-020-P: a reviewer has read your design; revise it, then implement stage 1 in your worktree. Same rules as turn 1 (worktree only, no other agents' tickets, no push)." followed by the review (Must change 1-2, Cut 1-3, Framework changes, Keep) and four instructions: revise the design and commit; implement stage 1 as revised; check it with the tensor tests, the framework tests and the Typed tests that cover the framework change, not the full suite; final message with paths, checks, framework changes, deviations and commit hashes.

**Assistant interpretation:** Apply the review to the design, then build it.

**Inferred user intent:** A stage-1 implementation whose public API is exactly the brief's, with the framework
changes recorded.

### What I did

- Section 6.4: the three contract factories share one cache per `(relation, count, seed)` (Must 1).
- Section 6.1: a case is `{ fn, n, shapes, seed }`, plain JSON, and is its own `describeCase` (Must 2).
- Section 8: `optimizeTix` has no options; public pass names are `inline` and `split-sum` (Cut 1, Cut 2).
- Section 6.1: no per-parameter range (Cut 3), with the consequence for layernorm's `eps` stated.
- Section 9: `applyPassSync` has no `store` and a required `check`.
- One unrequested change: the differential spec gets a third port, `origin`, because under `exact` the reference is
  the pass's input and cases must still be generated from the origin.

### Why

- Must 1 and Must 2 are both failures that would have shown up as a rejection with the wrong reason, which is the
  worst kind for a contract test.

### What worked

- N/A (document revision).

### What didn't work

- N/A.

### What I learned

- `applyPass` reports any throw from `verifyTransformation` as `contractRejected`, so a registry or encoding error on
  the manager path looks like a failed meaning check. The parity test therefore has to assert the reason, not only
  the verdict.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- With Cut 3, about half of layernorm's cases are expected to be inconclusive. The contract test will report the
  measured count.

### What should be done in the future

- N/A.

### Code review instructions

- Design section 17, then the sections it points to.

### Technical details

- Cache key: `relation/count/seed`; id `tensor.meaning-<relation>`, version `1+<count>.<seed>`.

## Step 5: Framework changes F2 and F1

I made the two framework changes first, since the tensor passes cannot be applied without them. Both are in
`src/framework/passes/define-pass.ts`. The synchronous middle of `applyPass` moved into one internal function,
`settle`, which `applyPass` and the new `applyPassSync` both call.

### Prompt Context

**User prompt (verbatim):** see Step 4.

**Assistant interpretation:** Implement F1 and F2 as revised (no `store`, required `check`).

**Inferred user intent:** The framework changes are the stage's primary result, so they are a commit of their own
with their own tests.

**Commit (code):** 6022b40 — "IRWB-020-P: framework F1 applyPassSync and F2 edit opened on first use, with tests/framework/pass-sync.test.mjs"

### What I did

- F2: `lazyEdit(view)`; `PassRunContext.edit` is a getter. A pass that returns nothing without reading `edit` is
  unchanged.
- F1: `applyPassSync(pass, before, { params?, outputId?, check })`. It refuses a pass with `needs` or `preserves`
  and a `run` that returns a thenable (`badResult`), and a missing `check`.
- `tests/framework/pass-sync.test.mjs`: 6 tests on a toy domain without `rebuild`.

### Why

- F1: `optimizeTix` is synchronous in the fixed API; `applyPass` is async. F2: `beginEdit` requires `rebuild`.

### What worked

- `node --test tests/framework/*.test.mjs`: 231 pass, 0 fail.
- `node --test tests/typed/{passes,rules,mutate,ssa,f32,project-meta,meaning-memo,parallel,audit,regex-nfa,candela}.test.mjs`
  (the Typed tests that apply passes): 53 tests, 52 pass, 0 fail, 1 skipped (the skip is in the test file).

### What didn't work

- No failures.

### What I learned

- `define-pass.ts` was not Prettier-clean before my change (15 diff lines on the committed file), so formatting the
  file also reflowed a few lines I did not write.

### What was tricky to build

- An unchanged result must not be checked, and an undeclared write must be refused before the check runs. `settle`
  returns `undefined` for "unchanged" and throws for the write, so both happen before either caller reaches its
  gate. The test counts check calls to pin this.

### What warrants a second pair of eyes

- `applyPassSync` opens the input and the output each in a fresh `IRStore`, as `applyPass` does when it is given no
  store.

### What should be done in the future

- N/A.

### Code review instructions

- `src/framework/passes/define-pass.ts`: `lazyEdit`, `settle`, `applyPassSync`; then `applyPass`, which now calls
  `settle`.

### Technical details

- A rejected check throws `PassError('contractRejected', ..., { check })`, the same code a rejected contract has.

## Step 6: The tensor domain

`src/tensor/` in seven files and the six corpus programs. The first smoke run over the corpus (four passes, two
relations) gave the design's verdict table at once, except for one crash in my comparison code.

### Prompt Context

**User prompt (verbatim):** see Step 4.

**Assistant interpretation:** Implement stage 1 as revised.

**Inferred user intent:** see Step 4.

**Commit (code):** c4e699e — "IRWB-020-P: src/tensor (Tix parser and checker, IR and adapter, evaluator in three arithmetics, meaning contract, inline and split-sum, API) and corpus/tensor"

### What I did

- `ir.ts` (types, affine forms, validation, IR type, adapter), `syntax.ts` (tokens, parser), `check.ts` (extent
  inference, bounds, lowering), `evaluate.ts` (one evaluator, arithmetics `F32`, `F64`, `BOUND`), `contract.ts`
  (domain, cases, the two relations, cached spec and contract, `checkMeaning`), `passes.ts` (`inline`, `split-sum`,
  `WRONG_PASSES`, `applyChecked`), `index.ts` (the fixed API, nothing else exported).
- `corpus/tensor/{matmul,softmax,layernorm,attention,mlp,conv2d}/main.tix`.

### Why

- The split into files follows the design's sections.

### What worked

- Smoke run, per program, pass/relation → verdict (`-` is unchanged):

  ```
  attention inline/e:ok inline/t:ok split/e:REJ split/t:ok wInline/e:REJ wInline/t:REJ wSplit/e:REJ wSplit/t:REJ
  conv2d    inline/e:-  inline/t:-  split/e:-   split/t:-  wInline/e:-   wInline/t:-   wSplit/e:-   wSplit/t:-
  layernorm inline/e:ok inline/t:ok split/e:REJ split/t:ok wInline/e:ok  wInline/t:ok  wSplit/e:REJ wSplit/t:REJ
  matmul    inline/e:-  inline/t:-  split/e:REJ split/t:ok wInline/e:-   wInline/t:-   wSplit/e:REJ wSplit/t:REJ
  mlp       inline/e:ok inline/t:ok split/e:REJ split/t:ok wInline/e:REJ wInline/t:REJ wSplit/e:REJ wSplit/t:REJ
  softmax   inline/e:-  inline/t:-  split/e:REJ split/t:ok wInline/e:-   wInline/t:-   wSplit/e:REJ wSplit/t:REJ
  ```

- A whole program's eight checks take 5 to 70 ms.

### What didn't work

- First smoke run crashed in the tolerance comparison on layernorm's wrong split:

  ```
  TypeError: Cannot read properties of undefined (reading '0')
      at Object.compare (dist/tensor/contract.js:185:75)
  ```

  A candidate with one non-finite element has no bound (rule 2 decides it), but the loop reached finite elements
  before the non-finite one and read `bound[i]`. Fixed: without a bound, only the non-finite element is reported.
- `tsc`: `Property 'bound' does not exist on type 'Outcome'` in `inconclusive`; narrowed with
  `o.trap === undefined`.

### What I learned

- conv2d is changed by none of the four passes, and layernorm's only inlinable statement has rank 1, where the
  wrong inline is the correct one. The verdict table is therefore shown on four programs for `split-sum` and on two
  (attention, mlp) for the wrong inline, plus the small programs in the tests.
- An inline chain (a into b, then b into c) needs one correspondence entry per final consumer; an entry naming a
  statement that no longer exists is not a valid target.

### What was tricky to build

- The differential spec needs the origin under both relations (cases come from it), but under `exact` the reference
  is the pass's input. It has three ports, `origin`, `reference` and `candidate`; `tolerance` binds the first two to
  the same artifact.
- The framework asks `inconclusive` before `compare`, per outcome, without the other side. To keep the rule order
  (candidate wrong shape or not finite: disagree; bound not finite: inconclusive), the candidate's run computes a
  bound only when its result has the origin's shape and is finite, so "has a bound that is not finite" is the only
  inconclusive candidate.

### What warrants a second pair of eyes

- `check.ts`, `nonNegative`: the bounds proof is a sufficient test (non-negative coefficients, non-negative at all
  ones). It rejects programs that are in bounds only through a relation between shape names.
- `syntax.ts`, the `max(` rule: a list of two or more bare names that are all shape names is a call.

### What should be done in the future

- N/A.

### Code review instructions

- Start at `src/tensor/index.ts`, then `passes.ts` (`applyChecked`), `contract.ts` (`makeSpec`), `evaluate.ts`
  (`evaluateFn`, `BOUND`).

### Technical details

- attention's first draft had `scale[t] = sqrt(D) + 0 * q[t, 0];` to give a scalar an index. Replaced by
  `/ sqrt(D)` inline.

## Step 7: Tests

33 tests in four files under `tests/tensor/`. Writing them found two defects in the implementation and several
wrong expectations of mine.

### Prompt Context

**User prompt (verbatim):** see Step 4.

**Assistant interpretation:** Put the tests where the risk is: evaluation order and rounding, the checker's
errors, the bound, the verdict table, and the manager path.

**Inferred user intent:** see Step 4.

**Commit (code):** 34db3b5 — "IRWB-020-P: tests/tensor (front end, evaluators, contract, passes), subscript error positions, -0 in reasons"

### What I did

- `syntax-check.test.mjs` (7): precedence, the reduction body rule, the `max(` rule, 35 check errors with their
  `line:col`.
- `evaluate.test.mjs` (7): all six corpus programs bit-identical to hand-written `Math.fround` loops; conv2d's loop
  order distinguished from the swapped order; f64; input validation; a trap on hand-built IR; one bound by hand.
- `contract.test.mjs` (8): cases deterministic, JSON-safe and accepted by `immutable`; redraw for conv2d; the bound
  holds on the corpus; self-check; inconclusive; `-0`; changed signature; cached objects.
- `passes.test.mjs` (11): the verdict table on the corpus; inline with affine subscripts; split-sum against
  hand-blocked loops at N = 1, 3, 4, 5, 8, 11; the wrong variants; the pipeline `split-sum` then `inline`; manager
  parity in one manager; changes and correspondence.

### Why

- Nothing else checks tensor programs.

### What worked

- `node --test tests/tensor/*.test.mjs`: 33 pass, 0 fail, about 0.5 s.
- The bound on the built evaluators, largest error / bound over 48 cases: attention 0.073, conv2d 0.701, layernorm
  0.568, matmul 0.568, mlp 0.464, softmax 0.462. layernorm: 29 decided, 19 inconclusive.
- All six evaluator comparisons with hand-written loops passed on the first run.

### What didn't work

- Defect: an affine subscript's error pointed at its operator (`1:46` for `x[i + 1]`), because a binary node's
  position is its operator. Now the subscript's start (`1:44`).
- Defect: a rejection reason printed `-0` as `0` (`element 0 is 0, the reference has 0`). Reasons now show `-0`.
- My expectations, not the code: three column numbers pointed at the statement instead of the index; a comment in a
  one-line test source swallowed `return y; }`; a test program used `u[j + 1, j]` under a declared `N - 1`, which
  the checker correctly rejects (`j` has a plain use of extent N); the framework names a changed entity `updated`.
  I checked each actual position against the source text before changing the expected value.

### What I learned

- With the default 16 cases, the exact relation rejects `split-sum` on 3 to 7 cases of 16 per program: most cases
  have extents too small to reassociate.

### What was tricky to build

- The manager-parity test asserts the rejection's message (`sampled cases disagree`), not only the verdict, because
  `applyPass` reports any throw from the manager as `contractRejected`.

### What warrants a second pair of eyes

- `passes.test.mjs` asserts that the wrong inline is *accepted* on layernorm (rank 1). That is a property of the
  chosen wrong variant, not of the contract.

### What should be done in the future

- A corpus program on which every pass applies to conv-style code (a pointwise statement feeding conv2d) would
  extend the table to conv2d.

### Code review instructions

- `npm run build && node --test tests/tensor/*.test.mjs`.

### Technical details

- `tests/tensor/helpers.mjs` holds the corpus loader, the test data generator and `sameBits`.

## Step 8: Diagnose the evaluation's failures, write the report

The independent evaluation passed 22 of 25 hidden tests. All three failures are one compile error, and its cause is
a rule I added to the language that the task did not state. I changed no code in this step, as instructed.

### Prompt Context

**User prompt (verbatim):** "Turn 3 for IRWB-020-P: your stage-1 implementation has been evaluated; diagnose the failures and write your final report. Same rules as before (your worktree only, no push)." followed by the results (hidden suite 22/25 at revision `2f82984`, the three failures all with `5:8: 'x' is a tensor and cannot be an index`; 25/25 with one index renamed; cross-check 180/180 in f32 and f64; `inline` and `split-sum` accepted and correct on 60/60) and the instructions: no changes under `src/`, `tests/` or `corpus/`; diagnose every failure with `file:line` in the diary; write `reference/02-report.md`; commit.

**Assistant interpretation:** Find the cause of the three failures, say whether the result is right, and write the
publishable report.

**Inferred user intent:** An honest account of what was built and measured, including what failed and why.

### What I did

- Wrote `scripts/04-repro-index-named-like-tensor.mjs` and ran it against the built evaluated revision.
- Wrote `reference/02-report.md`.

### Why

- One error message appears in all three failures, so one reproduction covers them.

### What worked

Output of the reproduction:

```
index named x (also the input tensor): 4:8: 'x' is a tensor and cannot be an index
index renamed to e: compiles; result 1.6823840141296387
1:29: 'y' is a tensor and cannot be an index   <- fn f(a: f32[N]): f32[N] { y[y] = a[y]; return y; }
1:38: 'a' is a tensor and cannot be an index   <- fn f(a: f32[N]): f32[N] { y[i] = sum(a) a[a] * 0 + a[i]; return y; }
```

### What didn't work

The three failures and their one cause:

| Hidden test | Cause |
| --- | --- |
| f32 meaning, bit-exact: mlp | `src/tensor/check.ts:123-124` |
| f64 precision against an f64 reference: mlp | `src/tensor/check.ts:123-124` |
| optimizeTix inline on the corpus programs | `src/tensor/check.ts:123-124` (the suite's mlp is one of the programs) |

`check.ts:123-124`, in `bind`, the function that brings an index into scope:

```ts
if (tensors.has(n.name) || n.name === s.name)
  throw new TixError(n.pos, `'${n.name}' is a tensor and cannot be an index`);
```

The suite's mlp has `y[i, x] = (sum(f) g[i, f] * w2[f, x]) + b2[x];` where `x` is also the input tensor.

### What I learned

- The rule comes from my design, section 3, rule 2: "shape names, tensor names and index names are disjoint sets".
  Only part of it has a reason. An index must not share a name with a *shape*, because a bare name in an expression
  is a shape value and the `max(` rule decides call or reduction by shape names. An index and a *tensor* cannot be
  confused: a tensor name occurs only before `[`, an index name only inside subscripts and binder lists.
- Nothing after the checker depends on the rule. `validateTix` keeps `bound` (indices) and `rank` (tensors) apart;
  `evaluateFn` keeps index slots and the tensor map apart; `inlineFn` substitutes index names only inside affine
  forms; `splitFn` makes fresh names against index and shape names. Deleting lines 123-124 would accept the program.
  I did not delete them: the evaluated revision stays as it is.
- I think the suite's result is right and the failure is mine. The brief does not say the names may coincide, but
  it gives a grammar in which they can, and I narrowed it.
- My tests did not find it because my corpus mlp, and every test program I wrote, uses index names that are not
  tensor names. The test list even asserts the restriction for shape names and never tries a tensor name.

### What was tricky to build

- N/A.

### What warrants a second pair of eyes

- The same reasoning applies to "no shadowing" (design rule 5): `sum(j) a[i, j] + sum(j) b[i, j]` parses as a
  nested reduction that rebinds `j` and is rejected. The hidden suite and the 60 random programs did not exercise
  it, so I do not know which reading they take.

### What should be done in the future

- Remove `check.ts:123-124` and add a test with an index named like a parameter and like the statement itself.
- Decide the shadowing rule against the reference evaluator used in the cross-check.

### Code review instructions

- `npm run build && node ttmp/2026/11/26/IRWB-020-P--*/scripts/04-repro-index-named-like-tensor.mjs`.

### Technical details

- The error position `5:8` in the suite and `4:8` in my reproduction differ by the suite's extra first line; both
  point at the `x` in `y[i, x]`.
