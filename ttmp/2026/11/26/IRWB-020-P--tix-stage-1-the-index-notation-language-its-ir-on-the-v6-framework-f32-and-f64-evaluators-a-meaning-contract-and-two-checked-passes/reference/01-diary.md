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
