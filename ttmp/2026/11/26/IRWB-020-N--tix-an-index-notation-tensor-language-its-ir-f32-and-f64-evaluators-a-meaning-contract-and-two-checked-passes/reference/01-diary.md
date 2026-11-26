---
Title: Diary
Ticket: IRWB-020-N
Status: active
Topics:
    - tensor
    - compiler
    - ir
    - verification
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: ttmp/2026/11/26/IRWB-020-N--tix-an-index-notation-tensor-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/design-doc/01-stage-1-design-tix-language-ir-evaluators-contract-inline-and-split-sum.md
      Note: the stage 1 design under review
    - Path: ttmp/2026/11/26/IRWB-020-N--tix-an-index-notation-tensor-language-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-two-checked-passes/scripts/01-probe-framework-fit.mjs
      Note: framework-fit probe (F1, F2)
ExternalSources: []
Summary: "Chronological diary of IRWB-020-N (tensor domain stage 1)."
LastUpdated: 2026-11-26T13:30:00-05:00
WhatFor: "Resuming and reviewing IRWB-020-N"
WhenToUse: "Before continuing implementation after the design review"
---

# Diary

## Step 1: Read the framework, probe its fit, write the stage 1 design

This was a design-only turn. I read the framework READMEs and the parts of `src/typed/` that show how a domain
uses the framework. Before writing the design, I probed the framework pieces it would rely on. The probe found
two places where the framework does not fit a native-result, synchronous domain. Both are now proposed changes,
F1 and F2. The design document covers the Tix checks, the IR, the evaluators, the exact and tolerance relations
(with τ = 2⁻¹²), the two passes and their wrong variants, the corpus and the tests.

### Prompt Context
**User prompt (verbatim):** The task brief arrived as a file. It is reproduced here by reference, not copied:
the caller's brief `claude-briefs/IRWB-020-N.md` in the session scratchpad. The brief asks for stage 1 of the
tensor domain: Tix parse/check, IR as a v6 artifact, f32 and f64 evaluators, a meaning contract with exact and
tolerance relations, `inline` and `split-sum` with wrong variants, and a six-program corpus. In this turn it asks
for design only: ticket, design document, diary, commit.
**Assistant interpretation:** Produce a reviewable design that can be built on the current framework. Propose
framework changes where the domain does not fit, and do not implement anything yet.
**Inferred user intent:** Test the framework's generality on a second domain. The framework changes and their
reasons are the result that matters.
**Commit (code):** none in this step (design only). The commit hash is in the final report.

### What I did
- Read `src/framework/{contracts,ir,strategy}/README.md`, `src/framework/passes/define-pass.ts`,
  `src/framework/contracts/differential.ts`, and the Typed `optimizationContract` (`src/typed/passes.ts`) and
  `meaningKept` (`src/typed/evaluate.ts`).
- Ran `npm run build`. It succeeded in about 3.5 s.
- Wrote and ran `scripts/01-probe-framework-fit.mjs` against `dist/`. The probe builds a tiny IR and adapter, a
  native-result pass, and exact and loose `differential()` invariants inside transformation contracts.
- Created the ticket, the design document and this diary. Added the vocabulary topic `tensor`.

### Why
- Following the policy, I probed before relying on framework features I had not seen work in a new domain:
  floating-point payloads in artifacts, native-result passes, sampled invariants as contract guarantees, and
  synchronous use.

### What worked
- `createIRArtifact` accepts a float payload (`{c:0.1}`, `{c:-1.5e-30}`) and freezes it.
- With a rebuild stub, `applyPass` accepted the pass under the loose invariant. Under the exact one it rejected
  the pass with `[contractRejected] … probe.close0: 4/4 sampled cases disagree`.
- `runDifferential(differentialSpec(inv), ports)` runs synchronously and returns `agree`.

### What didn't work
- `node scripts/01-probe-framework-fit.mjs $PWD`, without `rebuild` on the adapter, failed:
  `IRError: Adapter adapter.probe is not Rewritable` at `View.beginEdit` called from `applyPass`
  (`dist/framework/passes/define-pass.js:72`). The pass returns a native value and never uses the edit.
  This is finding F1.
- `applyPass(...)` returns a Promise (the probe printed `applyPass returns promise: true`). The fixed
  `optimizeTix` API is synchronous. This is finding F2.

### What I learned
- The contract layer fits as it is. The tolerance relation needs no framework change, because
  `differential()`'s `run(side, …)` lets the baseline side return the (f64, f32) pair of the origin.
- The exact relation has to compare against the pass's *input*, not the origin. Otherwise an exact pass applied
  after `split-sum` would be rejected.

### What was tricky to build
- `split-sum` on symbolic extents. Tix has no floor division and no conditionals, so the IR gets
  `Extent.div` (ceil division by a constant) and reduction guards. The bounds rule needs one extension: a
  reference whose affine equals a guard's affine gets the guard's bound.

### What warrants a second pair of eyes
- The τ choice and the inconclusive rule. A case counts as inconclusive when the origin itself fails τ, and
  that could hide too much if it fires often. The implementation will measure how often it fires and record the
  margins.
- F2's sync path records no facts in an `AnalysisManager`.

### What should be done in the future
- Implementation after review. Then measure the τ margins and the inconclusive counts.

### Code review instructions
- Start with section 9 (framework changes) of the design document, then section 6 (the contract).
- To reproduce the probe: `npm run build && node <ticket>/scripts/01-probe-framework-fit.mjs $PWD`, after
  removing `rebuild:(b)=>b` from the adapter to see F1.

### Technical details
- Node v24.18.0. The probe's adapter has `relationKinds: {contains: 'containment'}`. The allowed relation
  categories are `containment, dependency, binding, adjacency, provenance, control` (`src/framework/ir/adapters.ts:13`).

## Step 2: Revise the design after review

I applied the reviewer's three must-change items, the one cut, and the F2 narrowing. I did not disagree with
any item. On item 1 I disagree in part, and I kept the reason in the design: no case domain can guarantee
that an arbitrary reassociation changes bits (for example, `sum(j) 1`). The revision therefore adds a
deterministic case built to change bits under reassociation, and a test pins the verdict for the corpus.

### Prompt Context
**User prompt (verbatim):** The coordinator's turn-2 message, which is the review plus "revise it, then
implement stage 1". It is in this session and summarised here, not copied.
**Assistant interpretation:** Revise the design document, record the revision, commit, then implement.
**Inferred user intent:** A design that can be built without re-tuning during implementation, and that stays
inside the test-edit scope.
**Commit (code):** see the following commit, "IRWB-020-N: design revision 2 after review".

### What I did
- §6.1:
  - Added case 0, the wide case: shapes at 8, values `±2⁻ᵏ` with `k ∈ [0,24]`.
  - Added a JSON-safe `describeCase` (`{fn, n, shapes}`) and string reasons.
  - Added a paragraph on what is guaranteed and what is not.
- §6.4: removed the measurement plan.
- §9 F1: the test moves to a new file, `tests/framework/pass-native-sync.test.mjs`.
- §9 F2: dropped `store?`, with the `ir.unpublished` reason.
- Added a revision table at the top of the document.

### Why
- Item 3: a typed array in the evidence would make `immutable` throw inside the manager, and that error would
  replace the real rejection reason.

### What warrants a second pair of eyes
- Whether the wide case really changes bits on every corpus program with a single-index sum. The tests decide
  it.

## Step 3: Framework changes F1 and F2

I implemented both framework changes in `src/framework/passes/define-pass.ts`.
- F1: `ctx.edit` is now a getter that opens the edit on first use.
- F2: the steps that follow a native result moved into `nativeOutcome`, and `applyPassSync` uses them too.

Before writing any tests, `tsc --noEmit` was clean and the diff stayed local to `applyPass`.

### Prompt Context
**User prompt (verbatim):** see Step 2. This step implements the revised design.
**Commit (code):** b4901d8, "IRWB-020-N: framework F1 (lazy ctx.edit) and F2 (applyPassSync); tensor domain: …"

### What I did
- `applyPass`:
  - `let edit` is opened lazily through `get edit()`.
  - A result that is neither native nor an edit returns `unchanged(...)`.
  - The native branch calls `nativeOutcome(...)`.
- `applyPassSync`:
  - It checks the pass and contract domain before running the pass.
  - It refuses a thenable result.
  - It evaluates each differential `ensures` with `runDifferential(differentialSpec(inv), boundPorts)`.
  - It throws `contractRejected` with `{checks}` as evidence.

### What was tricky to build
- `ctx.edit` for the sync path. A pass there must not open an edit, so the getter throws `badResult` instead.

### What warrants a second pair of eyes
- One behaviour change for passes that neither return a native value nor touch `edit`. Before, they produced an
  empty edit and were reported unchanged. Now no edit is created, and the result is the same. No current pass
  relies on this.

## Step 4: The tensor domain, the corpus and the first runs

I wrote all of `src/tensor/`: `syntax.ts`, `check.ts`, `ir.ts`, `evaluate.ts`, `contract.ts`, `passes.ts` and
`index.ts`. I also added the six corpus programs. The first smoke run accepted every `split-sum` output under
validation except where validation itself refused it, which turned out to be a bug in my bounds rule. After the
fix, every verdict matched the design.

### What didn't work
- First smoke run (`scratchpad/irwb020n/smoke.mjs`):
  - `split-sum` came out `accepted:false` on all five programs with a one-axis sum, with
    `tensor.tix: s1/e4: cannot bound index k_b: its extent is a ceiling division and no guard covers it`.
  - The cause: the guard rule computed the guard form's minimum with the general `indexRange`. That function
    also computes the maximum, which needs the ceil-div extent of `k_b`.
  - The fix: when every coefficient of the guarded form is positive, its minimum is its constant; otherwise the
    guard is not used.
- I first wrote a correspondence "compaction" for chains of inlinings that was too convoluted. I replaced it
  with origin tracking: a map from each output expression to the set of input expressions it came from.

### What worked
These are the measurements after the fix (`smoke.mjs`, `smoke2.mjs`). The scaled error is
`|y−r|/max(1,|r|)`, and τ = 2.44e-4.

| program | origin's own max error | split-sum max error | split-sum-wrong failing error | exact cases rejecting split-sum | wide case (n=0) among them |
| --- | --- | --- | --- | --- | --- |
| matmul | 1.08e-7 | 1.08e-7 | 1.8e-1 | 5/9 | yes |
| softmax | 4.11e-8 | 4.11e-8 | Infinity | 2/9 | yes |
| layernorm | 1.03e-6 | 1.03e-6 | 7.9e+1 | 3/9 | yes |
| attention | 6.72e-8 | 6.02e-8 | 7.5e-2 | 4/9 | yes |
| mlp | 1.43e-7 | 1.43e-7 | 6.2e-1 | 6/9 | yes |

- No case was inconclusive. The honest margin below τ is at least 237×, and the wrong variant's error is at
  least 300× above τ.
- `inline-wrong` is rejected on mlp by the exact relation and accepted there by the tolerance relation.
- The async `applyPass` with a manager gives the same output revisions as `applyPassSync`, and its rejection
  message is the real one ("… sampled cases disagree"), not an `immutable` error.

### What I learned
- The wide case is what makes the exact rejection robust. On softmax only 2 of 9 cases disagree, and the wide
  case is one of them.

## Step 5: Tests and checks

I wrote the tests, fixed four mistakes in them, and ran the required suites. The four mistakes were in the
tests, not the code:
- `x[i, 1]` really is unprovable when `D` may be 1.
- A plain `x[i]` does fix i's extent at N.
- Two expected columns were wrong.

### Prompt Context
**Commit (code):** 8b52301, "IRWB-020-N: tests: …"

### What I did
- `tests/framework/pass-native-sync.test.mjs`, a new file with 3 tests:
  - F1 on an adapter without `rebuild`.
  - The F2 accept and reject paths, and agreement with `applyPass`.
  - What F2 refuses: needs, async passes, property clauses, undeclared writes.
- `tests/tensor/frontend.test.mjs` (23 tests): precedence, reduction bodies, max as call or reduction, and 18
  check errors with `line:col`.
- `tests/tensor/evaluate.test.mjs` (6 tests):
  - matmul, softmax and conv2d bit-exact against hand-written `Math.fround` loops.
  - f32 within τ of f64 on the corpus.
  - Input errors.
- `tests/tensor/contract.test.mjs` (8 tests): the verdicts above, chained inlining, idempotence of split-sum,
  `optimizeTix`, async parity, and correspondence.

### What worked
- `npm run build`: clean. `npx prettier --check "src/tensor/*.ts" src/framework/passes/define-pass.ts`: clean.
- `node --test tests/tensor/*.test.mjs`: 37/37 pass.
- `node --test tests/framework/*.test.mjs`: 228/228 pass.
- `node --test tests/typed/passes.test.mjs tests/typed/rules.test.mjs`: 16/16 pass.
- `node --test tests/typed/{program,inline,project-meta,meaning-memo,dfe}.test.mjs`: 24/24 pass.
- I did not run the full suite (`npm test`), as instructed.

### What warrants a second pair of eyes
- The design document's §13 lists the deviations from revision 2.
