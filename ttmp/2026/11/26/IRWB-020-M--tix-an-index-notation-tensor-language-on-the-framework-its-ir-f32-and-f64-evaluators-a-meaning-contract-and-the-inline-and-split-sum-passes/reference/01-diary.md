---
Title: Diary
Ticket: IRWB-020-M
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
    - Path: ttmp/2026/11/26/IRWB-020-M--tix-an-index-notation-tensor-language-on-the-framework-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-the-inline-and-split-sum-passes/design-doc/01-stage-1-design-tix-its-ir-evaluators-meaning-contract-and-two-passes.md
      Note: the design this diary records
    - Path: ttmp/2026/11/26/IRWB-020-M--tix-an-index-notation-tensor-language-on-the-framework-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-the-inline-and-split-sum-passes/sources/01-brief-IRWB-020-M.md
      Note: the brief, copied from the session scratchpad
ExternalSources: []
Summary: 'Chronological record of IRWB-020-M: the design turn (orientation, probes, decisions) and later the implementation.'
LastUpdated: 2026-11-26T14:40:00-05:00
WhatFor: 'Resuming or reviewing IRWB-020-M.'
WhenToUse: 'Before continuing the implementation after the design review.'
---

# Diary

## Goal

Record how stage 1 of the tensor track (Tix, its IR, evaluators, meaning contract, two passes) was designed and
built, with the evidence behind each decision and every failure as it happened.

## Step 1: Orientation and ticket

I read the brief, the three framework READMEs (contracts, IR, strategy), `define-pass.ts`, `differential.ts`, and
the Typed domain's `passes.ts`, `evaluate.ts` (the meaning check), `project.ts` and `ir.ts` (its IR definition and
adapter), then created the ticket. The brief is a design-only turn: ticket, design document, diary, commit.

### Prompt Context
**User prompt (verbatim):** "Read your full brief at /tmp/claude-1000/-home-manuel-code-wesen-2026-11-24--compiler-workbench/6d4ded76-01c1-42ed-bd4c-3f506f14dfc9/scratchpad/claude-briefs/IRWB-020-M.md and carry it out exactly. It contains the policy, how to work in your git worktree, and the task (a design-only turn: create the docmgr ticket, write the design document, start the diary, commit). When you are done, reply with the final message the brief asks for."
**Assistant interpretation:** The brief (copied to `sources/01-brief-IRWB-020-M.md`) asks for a stage-1 design of a tensor domain on `src/framework`: the Tix language, its IR, f32/f64 evaluators, a meaning contract (domain, observation, exact and tolerance relations), `inline` and `split-sum` with wrong variants, and a corpus; framework changes are the primary result. No implementation this turn.
**Inferred user intent:** Test whether the framework carries a second domain, and compare how agents design under an anti-over-engineering policy.

### What I did
- Worktree `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-op-x-irwb-020-m`, branch `t1-op-x/irwb-020-m`, clean at `19ad269`.
- `docmgr vocab add --category topics --slug tensor ...`; `docmgr ticket create-ticket --ticket IRWB-020-M ...`; added the design doc and this diary with `docmgr doc add`.

### Why
- The Typed domain is the only worked example of how a domain uses `defineIR`, `defineAdapter`, `definePass` and `differential`, so I followed its shape (IR definition + adapter + passes + a contract built per parameter set).

### What worked
- `npm run build` builds in the worktree (node_modules resolves from the repository root).

### What didn't work
- `node --test tests/framework/` (the form the brief names) fails on Node v24.18.0: `Error: Cannot find module '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-op-x-irwb-020-m/tests/framework'` (`MODULE_NOT_FOUND`). `node --test tests/framework/*.test.mjs` works: `ℹ tests 225 ... ℹ pass 225 ℹ fail 0` (baseline before any change).

### What I learned
- `applyPass` calls `view.beginEdit()` unconditionally, and `Draft` refuses non-rewritable adapters (`ir/transactions.ts:42`).
- Every gate in the analysis manager is async; `runDifferential` is synchronous.

### What was tricky to build
- N/A (orientation only).

### What warrants a second pair of eyes
- I did not read other tickets in `ttmp/` (one, IRWB-011, is a sketch about tolerance contracts) to stay within "do not read other agents' tickets".

### What should be done in the future
- N/A

### Code review instructions
- Start at the design doc, §1 (framework changes table).

### Technical details
- Ticket path: `ttmp/2026/11/26/IRWB-020-M--tix-an-index-notation-tensor-language-on-the-framework-its-ir-f32-and-f64-evaluators-a-meaning-contract-and-the-inline-and-split-sum-passes/`.

## Step 2: Probes behind the framework findings and the tolerance

Two probes, kept in `scripts/`, settle what the design relies on: whether the framework's pass path can serve a synchronous API and a non-rewritable adapter, and how large f32 reassociation differences are compared with a real bug.

### Prompt Context
**User prompt (verbatim):** (see Step 1)
**Assistant interpretation:** The policy requires a minimal probe before relying on a feature not yet seen working.
**Inferred user intent:** Decisions backed by observed behaviour, not by reading.

### What I did
- `scripts/01-probe-framework-sync-and-rebuild.mjs`: a toy IR with nested JSON expression trees, an adapter without `rebuild`, a native pass through `applyPass`, and a differential invariant run with `runDifferential`.
- `scripts/02-probe-f32-reassociation.mjs`: dot products of length 2..1728, operands uniform in [−1, 1] rounded to f32, sequential vs blocked (B = 4) f32 sums against f64, plus the effect of dropping the last term; normwise relative errors, 200 trials each.

### Why
- Probe 01 decides whether framework changes are needed (F1, F2) or whether the domain can use the framework as is.
- Probe 02 places the tolerance between rounding noise and the smallest real bug the wrong `split-sum` makes.

### What worked
- Probe 01 output:
  ```
  (d) createIRArtifact on nested JSON: ok, revision 6ffce809f9ad
  (a) applyPass returns a Promise: true
  (b) applyPass with a non-rewritable adapter: threw IRError "ir.capability" Adapter adapter.probe-toy is not Rewritable
  (c) runDifferential is synchronous: true status agree 3/3
      the invariant check itself without a manager is synchronous: true true
  ```
- Probe 02 output (abridged; full table in design §10): max normwise error seq/blocked n=5 one row 133.2u/133.2u (bits never differ), n=16 4.2u/2.9u, n=1728 44.9u/17.4u; smallest dropped-term effect 1.55e-3; rows whose bits differ n=8 357/800, n=1728 3101/3200.

### What didn't work
- No failures observed.

### What I learned
- The blocked sum equals the sequential sum bit for bit when the extent is at most B + 1 (the second block's single term is added exactly as the sequential sum would add it). The exact relation can reject `split-sum` only on cases with an extent of at least B + 2, so the domain needs such extents (case 1: all shapes 7).
- Single-element outputs with cancellation reach 133u normwise, so an elementwise relative tolerance would fail on the program itself.

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- Probe 02 covers sums of products only; exp, division and tanh in the corpus are not covered. The design makes the corpus measurement (via F3's `worst`) a test with a margin of τ/4 and says to report, not retune, if it fails.

### What should be done in the future
- Run the corpus margin measurement as soon as the contract exists.

### Code review instructions
- `npm run build && node ttmp/2026/11/26/IRWB-020-M--*/scripts/01-probe-framework-sync-and-rebuild.mjs`
- `node ttmp/2026/11/26/IRWB-020-M--*/scripts/02-probe-f32-reassociation.mjs`

### Technical details
- u = 2⁻²⁴ = 5.96e-8; τ chosen = 2⁻¹³ = 2048u ≈ 1.22e-4, about 15× above the worst rounding difference seen and 12× below the smallest dropped-term effect.

## Step 3: Design decisions

I wrote the design document. Its core decisions: a statement-level index-notation IR with explicit binder extents, and expression trees as statement attributes; a guard plus ceiling division so that `split-sum` handles symbolic, ragged extents; one evaluator parameterised by rounding; exact (against the pass input) and normwise tolerance (against the origin's f64) relations; and wrong variants that model real bug classes. It proposes three framework changes (F1 lazy edit, F2 `applyPassSync`, F3 per-case measure in differential evidence).

### Prompt Context
**User prompt (verbatim):** (see Step 1)
**Assistant interpretation:** Design only; name the simplest alternative for each significant decision; list what is left out and what is later.
**Inferred user intent:** A design a reviewer can accept or redirect before implementation.

### What I did
- Wrote `design-doc/01-stage-1-design-tix-its-ir-evaluators-meaning-contract-and-two-passes.md` (§1 framework changes, §2 domain, §3 language choices and checks, §4 IR, §5 evaluator, §6 contract, §7 passes, §8 API and corpus, §9 framework changes in detail, §10 probes, §11 tests, §12 plan, §13 left out, §14 later).

### Why
- **F2 is forced** by the fixed API: `optimizeTix` is synchronous, and the framework's gate is async only. The alternative (a domain-local copy of `applyPass`'s middle) would duplicate framework logic.
- **F1 avoids writing a `rebuild`** that no pass uses.
- **F3 exists because a tolerance check's evidence should show its margin.** It is the one place where the tensor domain's relation (a distance) does not fit the framework's boolean per-case model.
- **Baselines.** Exact against the input and tolerance against r0. Checking everything against r0, as Typed does, would reject `inline` after `split-sum`.

### What worked
- The corpus programs fit the fixed core without extensions. conv2d's bounds difference is identically 0 under the conservative bounds rule.

### What didn't work
- After I wrote the design doc, the file was changed on disk by something other than me: the prose was reworded and restructured into bullets, with the same decisions. The harness reported "changed on disk since you last read it". I kept that version as the current state, re-read it in full, and applied my three planned corrections to it (case-1 wording, the skip condition of `inline-wrong`, the `applyTixPass` result type), then re-wrapped two paragraphs.

### What I learned
- In the corpus as naturally written, every `inline` candidate is read at the identity mapping, except the reduction reads in attention and mlp. A wrong variant built on substitution bugs that are invisible at identity mappings would be accepted, so `inline-wrong` uses the "elementwise access" assumption, which is wrong exactly on those reduction reads.

### What was tricky to build
- Splitting a symbolic extent K needs both a ragged-tail guard and ceil(K/B) blocks. Strided outer binders and dependent inner extents (`min(B, K − j.o)`) need just as much IR. A guard (`when: index < below`) plus `div` on a binder is the smallest pair, and it lowers to the usual CUDA `if (idx < K)`.

### What warrants a second pair of eyes
- τ = 2⁻¹³ normwise, and the "origin out of tolerance → inconclusive" rule.
- Whether F3 should be in this stage. The design includes it; it is separable.
- The IR validator does not prove bounds. Faults are found at run time and count as disagreement.

### What should be done in the future
- Implementation after review (design §12).

### Code review instructions
- Read design §1, §6.3–6.4 and §9 first.

### Technical details
- Pass ids: `tensor.inline` v1 (exact), `tensor.split-sum` v1 (tolerance, `block` = 4). Invariant `tensor.meaning-kept`, transformation `tensor.optimization`, IR `tensor.tix` v1, adapter `adapter.tensor-tix` v1.

## Step 4: Bookkeeping and commit

I added the implementation tasks and a changelog entry, related the key files, ran `docmgr doctor`, and committed the ticket on `t1-op-x/irwb-020-m`. The commit hash is recorded in the next step (or in the final report of this turn).

### Prompt Context
**User prompt (verbatim):** (see Step 1)
**Assistant interpretation:** Commit with a message starting `IRWB-020-M:`; do not push.
**Inferred user intent:** A reviewable checkpoint.

### Evidence and commits
- See the commit `IRWB-020-M: design ...` on `t1-op-x/irwb-020-m`.

### Noteworthy decisions or failures
- None observed beyond Step 3.

### Remaining requirements and next action
- Wait for the reviewer's reply in this session, then implement design §12 step 1 (framework changes F1–F3 and their tests).
