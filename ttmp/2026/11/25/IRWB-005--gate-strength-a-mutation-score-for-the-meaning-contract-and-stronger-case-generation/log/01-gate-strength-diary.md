---
Title: Gate strength diary
Ticket: IRWB-005
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological, step-numbered investigation diary of IRWB-005: a mutation harness that measures how many wrong revisions the meaning contract lets through, and a stronger, opt-in case generator."
LastUpdated: 2026-11-25T23:20:00-05:00
WhatFor: "Resume point and evidence trail for IRWB-005 (D2a mutation score, D2b stronger cases, C5 facts against executions)."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Gate strength diary

Steps are chronological, oldest first. Every number is a measurement with its command; outputs are in `various/`, scripts in `scripts/`.

## Step 1: Read the gate, record the frozen baseline

This step starts milestone IRWB-005. Before designing anything I read the parts of the system the milestone measures: how `applyPass` gates a pass, how `typed.meaning-kept` generates and judges cases, and the input specifications that shape those cases. I then recorded the outputs that must stay identical at the end (the "frozen" default contract), so that every later change can be diffed against them.

The baseline is green: `npm test` 322 pass and 3 skipped (Candela-only suites), the full typed suites 21 of 21, parity 6,986 decided cases agree with 14 at the step limit over 44 projects and 70 functions, and 44 revision-fingerprint lines from IRWB-001 script 08.

### Prompt Context
**User prompt (verbatim, as relayed in the coordinator's brief):** "ask subagents to always commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). When a milestone is finished, write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). [...] For each, create a ticket and design doc (if you don't have already) Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Then implement"

**Assistant interpretation:** Own IRWB-005: write an intern guide for measuring and strengthening the meaning contract, upload it, then implement D2a (a mutation harness with equivalent-mutant classification), D2b (an opt-in stronger case generator) and optionally C5, keep the default contract and all book numbers frozen, and finish with a vault report.

**Inferred user intent:** Turn "is 40 cases enough?" into measured numbers per project and per kind of fault, and find out which wrong programs the gate accepts, before techniques that generate many candidates (rules, search) rely on it.

**Commit (code):** none yet.

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`.
- Read IRWB-002's intern guide: Part 1 sections 7 (evaluator), 9.3 (`applyPass`), 10 (contracts, the meaning check), 16 (oracles), and items C5, D2, D5 and the risks "Trust in the gate" and "Overfitting the metric" (section 22).
- Read `src/typed/evaluate.ts` in full (`casesFrom` :230, `makeValue` :128, `makeF32` :204, `F32_EDGES` :194, `evaluate` :345, `agrees` :531, `MeaningParams` :539, `meaningKept` :564), `src/framework/contracts/differential.ts` (`runDifferential` :102), `src/framework/passes/define-pass.ts` (`applyPass` :190), `src/typed/program.ts` (`apply` :248, `check` :593), `src/typed/passes.ts` (`typedPass`, `optimizationContract`, all passes), `src/typed/tx.ts`, `src/typed/model.ts`, `src/typed/analyses.ts` (`hasEffect`, `isPure`, `evalRange`, `rangeView`).
- Read the 44 `corpus/projects/*/project.json` input specifications, `tools/candela.mjs` (`candelaInputs`, `kSpec`), `src/workbench/candela-inputs.ts`, `tools/parity.mjs`, `tools/candela-o2.mjs`, `tools/reference-check.mjs`, `src/typed/reference.ts`.
- Wrote `scripts/01-freeze-baseline.sh` and ran it:

```bash
bash ttmp/2026/11/25/IRWB-005--*/scripts/01-freeze-baseline.sh ttmp/2026/11/25/IRWB-005--*/various/baseline
```

### Why
- The milestone's hard constraint is that the default contract (generator, count, seed, verdicts, key, every decision) stays identical. A diff at the end needs a recorded "before".

### What worked
- `npm run build` works in the worktree with the parent repository's `node_modules` (resolved up the directory tree); 3 s.
- Baseline (`various/baseline/`, commit 420d8e1):
  - `npm-test.txt`: tests 325, pass 322, fail 0, skipped 3 (the three `IRWB_CANDELA`/`IRWB_FULL` Candela suites), 56 s.
  - `irwb-full.txt`: 21 of 21 pass, 22 s (corpus parity test 15.7 s).
  - `parity.txt`: `{"projects":44,"functions":70,"cases":7000,"decided":6986,"agree":6986,"inconclusive":14,"failures":0}`, 11 s.
  - `corpus-revisions.txt`: 44 lines `id r0 revisions image`, 16 s.

### What didn't work
- A first attempt to create directories and the script in one compound shell command was refused by the worktree isolation check ("this command is too complex to verify that it stays inside the worktree"). Split into a plain `mkdir -p` and a file write.

### What I learned
- The gate's verdict per case: a trap on the origin side agrees with any trap on the candidate side (`agrees`, evaluate.ts:533); a step limit on *either* side makes the case inconclusive (`runDifferential`, differential.ts:116), and a check with no decided case fails. So a mutant that loops forever on some cases and agrees on the rest is accepted; one that loops on every case is rejected.
- Cases for a function depend only on that function's signature, its input specification and the seed (`casesFrom` restarts `rng(seed)` per function). The gate's verdict for a mutant confined to function f therefore depends only on the cases of f and of the functions that reach f by calls; the other functions run identical code on both sides.
- `Program.apply` (program.ts:248) is `applyPass` with `optimizationContract({ inputs, count: 40, seed: 7, roots? })` and `contractInputs: { origin: r0 }`. `Program.check` (program.ts:593) is a separate loop with 100 cases and a 2e4 limit that counts traps on both sides.
- The corpus programs are i32 only; the f32 operators and `caddr` occur only on the tape path (Candela, the f32 fixtures in `tests/typed/f32-fixture.mjs`).

### What was tricky to build
- Nothing built yet.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Re-run `01-freeze-baseline.sh` into `various/final/` at the end and diff.

### Code review instructions
- `scripts/01-freeze-baseline.sh`; outputs in `various/baseline/`.

### Technical details
- Gate parameters: `Program.apply` count 40, seed 7, limit 2e4 (`meaningKept` default); `Program.check` and `tools/parity.mjs` 100 cases.
- Generator: xorshift32 `rng(seed)`; unspecified i32: 72 % in [-20, 60], 20 % in [-1000, 1000], 5 % from `[0, 1, -1, MAX, MIN, 65535, 65536]`, 3 % any i32; unspecified buffer: length [0, 40], cells [0, 255]; f32 parameters: the first ⌊count/4⌋ cases (at most 15) sweep `F32_EDGES`.

## Step 2: Census of mutation sites, and a probe that a mutant can be a pass

Before writing the design I wanted two facts: how many mutation sites the corpus offers after its pipelines (so the harness's cost is known), and whether a mutant can be expressed as an ordinary `typedPass` applied through `Program.apply`, so that the gate judges it exactly as it judges a real pass. Both came out favourably. The corpus offers about 1,500 sites after O2 and a 40-case check costs 1–15 ms per project. A hand-written mutant pass goes through `Program.apply` unchanged.

The probe also produced the example the guide is built around. Dropping Blend's bounds check (what a wrong `bce` would do) is *accepted* by the gate, 40 of 40, and 4,000 cases under Blend's input specification agree as well; 131 of 4,000 cases *without* the specification disagree. Blend's specification fixes the buffer at 40 cells and `n` in [0, 40], so the check can never fire on a specified input. The mutant is equivalent under the specification and wrong outside it.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Size and de-risk the harness before designing it.
**Inferred user intent:** A design grounded in measured costs.
**Commit (code):** none yet.

### What I did
- `scripts/02-site-census.mjs`: for every project, run its pipeline, count i32 constants, comparisons, non-commutative operators, shifts, trapping operators, `caddr`, f32 values, stores and branch-form bounds checks at the head, and time one 40-case `meaningKept` check of head against r0. Output `various/02-site-census.txt`.
- `scripts/03-probe-blend-mutants.mjs`: two `typedPass` mutants of Blend's O2 head, applied with `p.apply(m)`; accepted ones re-checked with 4,000 cases under the spec and 4,000 unconstrained (`inputs: {}`), limit 2e5. Output `various/03-probe-blend-mutants*.txt`.

### Why
- The design question "can mutants be revisions through the framework" is cheaper to answer by running it than by reading.

### What worked
- Census totals (corpus, after each project's pipeline): `{"trapping":142,"const":291,"noncomm":215,"cmp":106,"shift":54,"check":30,"store":8}`; no `caddr`, no f32. Check cost 0.9 ms (constants) to 45 ms (my-analysis, which hits the step limit on 4 of 40 cases).
- Probe:
  - `drop-check {"pass":"mutant","rev":"r7","edits":2,"changed":true,...,"check":"40/40"}`; spec 4000: agree 4000; unconstrained 4000: agree 3869, disagree 131, first counterexample `args [1024,26,-16,518]`: expected trap, got -2855784.
  - `ge->gt`: `[contractRejected] ... 40/40 sampled cases disagree`.

### What didn't work
- My first second probe rewrote `lt` to `le` and changed nothing: after O2 Blend has no `lt` (simplify turned `!(i < n)` into `i >= n`). `p.apply` returned `changed: false`. Retargeted to `ge` → `gt`.

### What I learned
- A mutant must be enumerated on the revision it mutates; operators present in the source may be gone after O2.
- "Equivalent mutant" needs two notions here: equivalent on every input, and equivalent on every input the project's specification allows. The gate only samples the second, so a mutant of the second kind is not a gate failure, but it is worth reporting, because a pass that made such a change would be relying on the specification as an assumption.
- The corpus cannot exercise the `caddr`, bcm and f32 operators; those need Candela or the f32 fixture (`tests/typed/f32-fixture.mjs`).

### What was tricky to build
- N/A (probe only).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Use `drop-check` on Blend as the guide's running example.

### Code review instructions
- Run the two scripts; outputs as above.

### Technical details
- The mutant pass declares `writes: ['stmts', 'cfg', 'values']`; `tx.replaceStmt` of the `br_if` by `br` and the transaction's `commit` prune the trap block (`unreachable` edit).
