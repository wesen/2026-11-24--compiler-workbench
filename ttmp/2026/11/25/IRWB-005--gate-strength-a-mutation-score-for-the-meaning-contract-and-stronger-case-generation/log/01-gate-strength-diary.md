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

## Step 3: The intern guide, its second pass, and its upload

I wrote the intern guide (`design-doc/01-intern-guide-how-strong-is-the-meaning-contract-and-how-to-make-it-stronger.md`, 580 lines) in four parts: the gate and what it protects, measuring it with mutants, a stronger generator, and the implementation plan. It is built around the Blend example from Step 2. The design decisions that shape the implementation are recorded in it: mutants are one `typed.mutant` pass applied through `Program.apply`; ten operators, each tied to the pass bug it models; a classification cascade whose classes separate "equivalent" from "equivalent under the specification"; the kill rate as an interval; the strong generator appends to the default cases and is a contract version `2+<hash>` under the same id.

The second pass found one factual error, which I checked against the code before fixing: I had written that the guest memory is 4 KiB. It is the allocated prefix, rounded to 16 bytes and at least 1,024 bytes (`Memory.image()`, evaluate.ts:95). For Blend's 40-cell buffer at 1024 the image is 1,120 bytes, so reads of cells 40–45 do not trap and cell 46 does (checked with a one-line script).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Write the intern guide, reread it as its reader and revise, store it in the ticket, upload it.
**Inferred user intent:** A document a new person can implement the milestone from.
**Commit (code):** see the commit after this step.

### What I did
- `docmgr doc add --ticket IRWB-005 --doc-type design-doc --title "Intern guide: how strong is the meaning contract, and how to make it stronger"`; wrote the guide.
- Second pass. Review notes before revising: (1) §1 had a self-correcting sentence about the counterexample; (2) §5's "4 KiB" was wrong; (3) §3 table cell empty, Candela's gate scope (all 332 functions, no `roots`) unstated; (4) §9 used the word "analogy"; (5) §12 said each method has two outcomes, the cascade has three; (6) missing: what happens when a stronger gate rejects the unmutated base; (7) missing: a picture of the harness; (8) missing: a recap at the end of Part 1; (9) §12's classes did not say whether they are per gate or per mutant. Revised each in place.
- Verified the memory layout: `new Memory().buffer(Array(40).fill(1))` → at 1024, top 1120, image 1120; cell 45 at 1118 inside, cell 46 at 1120 outside.
- `remarquee upload bundle <guide> --name "IRWB-005 Intern Guide: Gate Strength" --remote-dir "/ai/2026/11/25/IRWB-005" --toc-depth 2 --non-interactive`
- docmgr: 10 tasks added, `jjbr` checked; 4 files related to the guide; changelog entry.

### Why
- The brief orders guide → upload → implementation. Writing the operator table and the classification rules first forced decisions (base revision, the specification-relative notion of equivalence, how a stronger gate's rejection of the base is handled) that would otherwise have been made implicitly in code.

### What worked
- Upload: `OK: uploaded IRWB-005 Intern Guide: Gate Strength.pdf -> /ai/2026/11/25/IRWB-005`; `remarquee cloud ls /ai/2026/11/25/IRWB-005` lists `[f] IRWB-005 Intern Guide: Gate Strength`.

### What didn't work
- No failures. The factual error above was caught by the reread, not by a tool.

### What I learned
- Whether an out-of-bounds read traps depends on where the buffer lies in the image: past the last buffer it traps after the 16-byte padding, past an earlier buffer it reads the next buffer. This will decide many `drop-check` and `hoist-trap` classifications.

### What was tricky to build
- `check-range` on `caddr`: the natural `caddr(r, p − 1) + 2` traps wrongly at `p = 0`. The design uses `d = (p ≠ 0)`, `caddr(r, p − d) + 2d`, which checks `p ≤ cap` for `p ≥ 1` and is unchanged at `p = 0`; `p` must be pure because it is copied.

### What warrants a second pair of eyes
- The exact caller-set shortcut for Candela (guide §10): the corner case "no decided case" must combine the mutant's evidence on A with the base's on F∖A, not be computed on A alone.

### What should be done in the future
- Implement in the order of guide §17.

### Code review instructions
- Read the guide; §10–§12 are the contracts the code must meet.

### Technical details
- Classification parameters chosen: exhaustive budget 300,000 inputs over A; large sample 4,000 cases per function; step limit 2e5 for classification; divergence = mutant at 2e5 where r0 finished within 2e4.

## Step 4: Ten operators, the mutant pass, and the harness's first run

This step implements guide sections 10–13: `src/typed/mutate.ts` (operators, site enumeration, `mutantPass`, `affected`, `finiteDomain`, `compareOn`) and `tools/mutation-score.mjs` (base per project, the default gate through `Program.apply`, further gates through `checkInvariant`, classification, aggregation). The first smoke run on three projects (blend, licm-traps, sort) produced 122 mutants, none invalid, and the first real finding: the only two mutants that survive while being wrong both *diverge*. `i = i + 1` became `i = i + 0`; the loop never ends on most inputs; the gate counts those cases as no verdict and the terminating ones (n = 0) agree.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Implement D2a as designed.
**Inferred user intent:** Measured kill rates with honest equivalence accounting.
**Commit (code):** c44a839 — "IRWB-005: mutation operators and the mutant pass (src/typed/mutate.ts), strong cases and contract version 2 with a divergence rule (src/typed/cases-strong.ts), tools/mutation-score.mjs, tests"

### What I did
- `src/typed/mutate.ts`: `MutationSite { operator, fn, target, variant, stmt, text }`; `mutationSites(st, { fns, operators, live })` walks functions, blocks, statements, the statement's value fields in the evaluator's order (store: addr, value; else value, cond) and value trees in pre-order; statement operators (`drop-check` branch form, `check-range` branch form, `drop-store`, `hoist-trap`) per statement. `applyMutation` edits through the `Tx` (`rewrite` for value operators, `replaceStmt`, `remove`, `move` for statement operators). `mutantPass = typedPass({ name: 'mutant', writes: ['values','stmts','locals','cfg'], preserves: [] })`.
- `tools/mutation-score.mjs`: per subject: pipeline → base; liveness of the base for `hoist-trap`; sites; every extra gate run on the base first; per site: build the mutant with `applyPass(mutantPass, base, { manager })` (no contract), judge default with `p.apply(mutantPass, { params: { site } })` + `p.undo()`, other gates with `checkInvariant`; classify mutants some gate accepted.
- Smoke: `node tools/mutation-score.mjs --projects blend,licm-traps,sort --jsonl <scratch>/smoke.jsonl`.

### Why
- One pass with the site as a parameter keeps the gate path identical to a real pass's (`Program.apply` → `applyPass` → `optimizationContract`).

### What worked
- 122 mutants, 0 invalid, default gate: 91 killed (incl. killed-inconclusive), 2 survived-wrong, 29 equivalent; kill rate 77.1 % (lower) .. 97.8 % (upper). Per operator: cmp-flip 12/12, swap 25/25, shift 14/14, drop-store 2/2 killed; drop-check 7, check-range 7, hoist-trap 4 all equivalent (the checks of blend and sort can never fire on their specified inputs, or ever).
- Survivors and their classes: `licm-traps ratio const -1 "1"` survived-wrong (exhaustive-diverges: `args [1,-50,-3]`, "diverges: limit 200000, baseline 9 steps"); `sort const -1 "1"` survived-wrong (sample-diverges, baseline 394 steps); `blend cmp-weaken geu (i >= n)` equivalent-spec (unconstrained witness `n = -2051156667`); `blend drop-check` and `check-range` equivalent-spec; `blend hoist-trap` (the `s = s + load16[...]` moved above the check) equivalent-presumed; `licm-traps cmp-weaken geu (i >= n)` equivalent-spec-proved (exhaustive over 4,242 inputs).
- Gate time 14 s of 228 s total.

### What didn't work
- Classification was the cost: 228 s for 122 mutants, because each survivor re-evaluated r0 on 8,000+ cases.

### What I learned
- Divergence is the gate's blind spot that no amount of sampling fixes: step-limited cases are no verdict by rule, so a mutant is accepted as long as one case terminates and all terminating cases agree.
- Blend's `t7 >=u len` → `t7 >= len` is equivalent on every input, not only the specified ones: `t7 = i` and `i` runs from 0 upwards below `n`, so it is never negative.

### What was tricky to build
- `hoist-trap` legality (guide §11): the moved statement must not read what earlier statements of its block write, must not write what they read, must not move past a store when it reads memory, its local must be dead at the predecessor's other successor, and the predecessor's branch condition must not read it. With these, the only possible difference is a trap on the other path, which agrees with r0's trap whenever r0 traps there too.

### What warrants a second pair of eyes
- `check-range` on `caddr` (`caddr(r, p − d) + 2d` with `d = (p ≠ 0)`, p copied, p pure). It is exercised by the f32 fixture and Candela only.

### What should be done in the future
- Cache r0's runs per function (Step 5).

### Code review instructions
- `src/typed/mutate.ts` (`mutationSites`, `hoistable`, `applyMutation`); `tools/mutation-score.mjs` (`classify`).

### Technical details
- Record per mutant: `{ subject, base, baseRev, fn, operator, variant, target, stmt, text, mutantRev, gates: { <gate>: { verdict, agree, disagree, inconclusive, ms } }, classification }`.

## Step 5: Caching r0's runs, the strong generator, and a gate that kills less with more cases

Two changes and one surprise. r0 is the same for every mutant of a subject, so its runs on the classification cases (and the reference image's runs) are now computed once per function (`packFor`), and `compareOn` accepts precomputed baseline runs; the same smoke run fell from 228 s to 109 s with identical classes. Then I wrote `src/typed/cases-strong.ts` (pools from specification boundaries, type special values and program constants; `strongCasesFrom` = default cases + `extra` boundary cases; `meaningKeptStrong` as `typed.meaning-kept@2+<hash>`), and the strong gate killed one mutant *fewer* than the default although its cases are a superset.

The mutant is Blend's `i = i + 1` → `i = i + 0`. Default: all 40 cases have `n > 0`, all hit the limit, "no decided case among 40 (all inconclusive)", rejected. Strong: two boundary cases have `n = 0`, terminate and agree: `agree 2, disagree 0, inconclusive 78`, accepted. Under version 1's rules, more cases can turn a rejection into an acceptance. I added a divergence rule to version 2 (default factor 10; `divergence: 0` turns it off): when the candidate hits the limit it is re-run at 10× the limit, and if it still has not finished while the origin did, the case disagrees.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** D2b: a stronger generator as a new contract version; measure it against the mutants.
**Inferred user intent:** A stronger gate whose gain is measured, with the default untouched.
**Commit (code):** c44a839 (same commit as Step 4).

### What I did
- `mutate.ts` `compareOn(..., { baselineRuns })`; tool `packFor(ctx, g)` (domain, sample 4,000 seed 101 + 200 boundary cases, unconstrained 4,000 seed 102, r0 runs of each, reference runs of the first 400) and `over(ctx, A, mst, part)`.
- `cases-strong.ts`: `F32_EXTRA` (13 patterns), `constantsOf`, `i32Pool(lo, hi, consts)`, `f32Pool`, `pool(spec, type, …)` (buffers: lengths a, b, a+1, b−1 and constants in range × 5–6 cell patterns), `boundaryCases` (case j: param i takes `pool_i[(j + 3i) mod |pool_i|]`), `coverageCases` (greedy statement coverage over 4·extra boundary + 4·extra random candidates), `strongCasesFrom`, `meaningKeptStrong`, `strongOptimizationContract`; cases cached per origin revision and key.
- Divergence rule in `meaningKeptStrong.run` for the subject side; `compare` reports `got no result within 10x the step limit`.
- Gates in the tool: `strong` (40 + 40, divergence 10), `strong-cases` (40 + 40, divergence 0), `default+div` (40 + 0, divergence 10), `strong-cov` (coverage-chosen extra cases).

### Why
- Appending keeps the comparison honest ("strong kills everything default kills" when divergence is not involved) and makes the cost (count + extra)/count.
- The divergence rule is a verdict change, so it can only live in version 2; the ablation gates separate its effect from the cases'.

### What worked
- Sanity on blend, licm-traps, records, strings, histogram: the strong generator's first 40 cases equal `casesFrom`'s byte for byte; pool sizes e.g. blend `[6,16,27,27]`, licm-traps `[6,21,7]`.
- Versions: default `meaningKept({})` = `1+82965c92`, blend's gate `1+2686cc23`, strong default `2+f4977f5f` (before the divergence key was added).
- Second smoke run: 109 s (was 228 s); reference image checked on 11,600 (case, mutant) pairs: 0 disagreements with the mutant where r0 agreed, 0 with r0.

### What didn't work
- `strongCasesFrom` with destructured defaults `{ count = 40, extra = count, ... }` failed to compile: `TS7022: 'count' implicitly has type 'any' because it ... is referenced directly or indirectly in its own initializer`. Rewrote with an explicit options type.
- Appending the diary with one long shell heredoc was refused by the worktree isolation check; appended with the editor instead.

### What I learned
- The "no decided case" rule of `runDifferential` (differential.ts:140) makes the gate's verdict non-monotone in its cases.

### What was tricky to build
- The divergence rule had to fit `runDifferential`, which asks `inconclusive(outcome)` per side before comparing. The subject's `run` does the re-run itself and returns a non-limit result marked `diverged`; if the origin hit the limit, `inconclusive(baseline)` still skips the case, so a slow origin never causes a disagreement.

### What warrants a second pair of eyes
- Whether a correct pass could ever need more than 10× the step limit where the origin needed at most 1×: if so, version 2 would reject it. To be confirmed by running the corpus pipelines under version 2.

### What should be done in the future
- Run every corpus pipeline under version 2 (cost measurement and the check above).

### Code review instructions
- `src/typed/cases-strong.ts` (`pool`, `boundaryCases`, `meaningKeptStrong`).

### Technical details
- Key of version 2: `canonicalJson({ generator: 'strong-1', count, extra, coverage, divergence, seed, inputs, limit, roots? })`, version `2+hash(key)`.

## Step 6: Tests for the harness and the generator

Eight tests in `tests/typed/mutate.test.mjs`, all passing in 9.2 s. They pin the default contract's version strings (so any change to its key fails), check that site enumeration is deterministic and that every mutant of Blend and of the f32 fixture is a valid, changed revision, check that `Program.apply` and `checkInvariant` give the same verdict on every Blend mutant, and check the divergence rule, finite domains, the caller set, the strong cases' prefix property and boundary coverage, and that the strong contract accepts Blend's O2 passes and rejects `div-to-shift`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Acceptance item "tests for the harness and the generator".
**Inferred user intent:** The harness's claims are themselves tested.
**Commit (code):** c44a839.

### What I did
- `node --test tests/typed/mutate.test.mjs` → tests 8, pass 8, fail 0, 9,186 ms.
- `npx prettier --write src/typed/mutate.ts src/typed/cases-strong.ts` (the check had warned on both).

### Why
- The pinned versions are the cheapest guard of the frozen key: `1+82965c92` (no inputs), `1+2686cc23` (blend, 40), `1+c4dbecf4` (blend, 100).

### What worked
- All eight; `Program.apply` ≡ `checkInvariant` on all Blend sites; the guide's example (`drop-check` accepted with `check: '40/40'`, `i >= n` → `i > n` rejected) holds.

### What didn't work
- My first draft of two tests had a meaningless assertion and an `await` inside a non-async `find` callback; rewritten before the first run.

### What I learned
- N/A.

### What was tricky to build
- Finding the loop increment of licm-traps robustly: by the statement text `i = (i + 1)` of the site's statement.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- The tests are under `tests/typed/`, so `npm test` picks them up.

### Code review instructions
- `node --test tests/typed/mutate.test.mjs`.

### Technical details
- Pinned: `meaningKept({}).version === '1+82965c92'`, blend 40 cases `1+2686cc23`, blend 100 cases `1+c4dbecf4`.

## Step 7: Candela's gate cases do not follow its input specification (records laid out in key order)

The Candela tool's first run checked its base (r0 + bcm) against r0 on every function's 40 gate cases and reported 22 inconclusive cases. My census script 05 had counted 101 step-limit hits on "the same" cases. Chasing the difference found a defect in the frozen default generator. It writes a record's words positionally, in the order of the record table's keys, ignoring each field's declared `offset` (`makeValue`, evaluate.ts:163–168; `Memory.record`, :89). The front end's tables list fields in declaration order, which is offset order. A frozen artifact's tables are key-sorted (`immutable` sorts keys), and the gate generates its cases from the artifact (`casesFrom(storeOf(origin.value), …)` in `meaningKept`, evaluate.ts:586). For Candela's `K` record, declared `bU bO bL bB bS etab sky scene spectral …`, the artifact's order is `bB bL bO bS bU etab gBary__x gBary__y …`, so the word at offset 28, the scene index, receives the bits of the f32 `gBary__y`.

Measured: `casesFrom` on the artifact store and on the ingest store differ for 168 of Candela's 332 functions (every function with a `K` parameter) and agree for the other 164. In the first three gate cases of `rnd(K)`, `scene@28` is 6, 9, 13 from the ingest store and 1054236423, 1063981055, 1051074687 from the artifact store. The corpus is unaffected: its two record types (`Point` in match-enum and records) are `{ x, y }`, whose key order is their offset order. The default is frozen, so I did not change it. Version 2 corrects it instead (`offsetOrdered`, `layout: 'offset'`).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Explain an unexplained number before relying on either.
**Inferred user intent:** Candela measurements that mean what they claim.
**Commit (code):** pending (next commit).

### What I did
- `scripts/06-candela-limit-discrepancy.mjs` (written; superseded by the direct check below before it ran).
- Compared `st.frontEnd.records.K` of the ingest store and of `st.toNative()`: same 17 fields, same `{ type, offset }`; then key order: different.
- Read word 28 of `K` in the first three `rnd` cases from both stores (numbers above).
- Corpus: listed every record type of every project with declared, offset and sorted orders: 2 types, all `x,y`, SAME.
- `cases-strong.ts`: `byOffset(fields)`; record pools now lay fields out in offset order; `offsetOrdered(st)` is a view of the store (`Object.create(st)` with a `frontEnd` whose record tables are offset-ordered) from which `casesFrom` generates correctly laid out records; `strongCasesFrom(..., { layout: 'offset' | 'keys' })`, default `'offset'`; `meaningKeptStrong` key includes `layout`.
- Check: `strongCasesFrom(artifactStore, f, { count: 40, extra: 0 })` equals `casesFrom(ingestStore, f, …)` for 332 of 332 functions; `casesFrom(artifactStore)` vs `casesFrom(ingestStore)`: 164 same, 168 different.

### Why
- The default contract is frozen (brief), so the correction can only be offered in version 2 and reported as a finding.

### What worked
- The correction reproduces the intended cases exactly on all 332 functions.

### What didn't work
- My census (script 05) generated cases from the ingest store, so its step-limit counts (`fbm3` 7, `renderPixel` 1, `skyBuild` 40, `cdlSky` 40, `cdlRenderSpan` 13: 101) describe the *specified* inputs, not the gate's. The gate's own cases on r0 + bcm: 22 inconclusive of 13,280.

### What I learned
- Every Candela number produced through `meaningKept` (the O2 checks of IRWB-001, `tools/candela-o2.mjs`) was measured on cases whose `K` fields do not follow `kSpec`: scene, spectral, skyOn, rngS and the per-hit fields are scrambled. Agreement between two runs on such cases still means the runs agree, so the IRWB-001 results stay true as stated, but the cases are not the ones the specification describes. `tools/candela-oracle.mjs` generates from the ingest store and is not affected.

### What was tricky to build
- `offsetOrdered` must not copy the store (235,000 records). A prototype-chained view that shadows only `frontEnd` works because `casesFrom` reads only `st.fn(name)` and `st.frontEnd`.

### What warrants a second pair of eyes
- Whether the default should be fixed in a future version 1.x: it would change Candela's gate decisions (none of the corpus's).

### What should be done in the future
- Report it with the recommendation: sort a record's fields by `offset` in `makeValue` (one line) in a new contract version.

### Code review instructions
- `src/typed/cases-strong.ts` (`byOffset`, `offsetOrdered`, `strongCasesFrom` `layout`).

### Technical details
- Key order of `K` in the artifact: `bB bL bO bS bU etab gBary__x gBary__y gLam gTau gTime gTri rngS scene sky skyOn spectral`.

## Step 8: The corpus measurement: 1,144 mutants after O2, seven gate configurations

The first full measurement. Every corpus project's pipeline head was mutated at every site (1,144 mutants over 42 projects with sites; `algebra` and `distinct` have none), each mutant was judged by seven gate configurations, and every mutant some gate accepted was classified. The default gate kills 909 and lets 40 wrong mutants through; 195 are equivalent. Of the 40, 33 diverge (an increment `i + 1` became `i + 0`, or a loop condition stopped being reachable), and 7 compute a different result on inputs the gate did not sample. Contract version 2 lets 2 through. The ablations say where the gain comes from: the divergence rule alone (`default+div`) leaves 7, the 40 boundary cases alone (`strong-cases`) leave 36, both together leave 2. Doubling or more than doubling the default sample (80, 100 cases) leaves 37 and 36.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Acceptance items 1 and 2 on the corpus.
**Inferred user intent:** The kill rate per project and operator, with equivalent mutants accounted for.
**Commit (code):** c44a839 (harness as run); results committed with this step.

### What I did
- `node --max-old-space-size=8192 tools/mutation-score.mjs --gates default,default80,check100,strong,strong-cases,default+div,strong-cov --json various/04-corpus-final.json --jsonl various/04-corpus-final.jsonl` → `various/04-corpus-final.txt`; 20 min 52 s wall, 1,203 s user.
- Analysed the JSONL: classes, methods, the non-divergent survivors and their witnesses, the O2 listing of `strength.meter`.

### Why
- The final revision is the base the guide chose (guide §10); r0 as a base is the held-out run (Step 9).

### What worked
- 1,144 mutants, 0 invalid, 42 projects. Default gate: killed 908 + killed-inconclusive 1, survived-wrong 40, equivalent 195 (26 proved exhaustively on the specified domain, 13 of them different outside it; 24 equivalent under the specification with an unconstrained witness; 145 presumed). Kill rate 83.1 % (presumed counted as misses) .. 95.8 % (presumed excluded).
- Per operator (default, upper): cmp-flip 106/106, drop-store 8/8, swap 210/210 of non-equivalent, shift 109/109, const 409 of 446 (91.7 %), cmp-weaken 59 of 61 (96.7 %), check-range 3 of 4 (75 %), drop-check 4 of 4, hoist-trap 1 of 1. The equivalents concentrate in cmp-weaken (88), drop-check (27), check-range (26), hoist-trap (20): checks that can never fire and signed/unsigned changes on values that are never negative.
- Survived-wrong under default by method: sample-diverges 24, exhaustive-diverges 9, sample 6, exhaustive 1.
- Kill rate upper bound (default → v2): total 95.8 % → 99.8 %; default80 96.1 %, check100 96.2 %, strong-cases 96.2 %, default+div 99.3 %, strong-cov 99.8 %. Per project: 15 of 42 at 100 % under default; under v2 every project is at 100 % except bounds-lab 98.5 % and strength 96.3 %.
- Reference image: 81,950 (case, mutant) comparisons on survivors' sample cases, 0 disagreements with the mutant where r0 agreed, 0 with r0.
- Gate time over all 1,144 mutants (ms): default (Program.apply, incl. building the revision) 61,948; default80 34,077; check100 39,365; strong 163,218; strong-cases 28,632; default+div 83,011; strong-cov 149,433. The divergence rule's cost is in the mutants that diverge: each such case is re-run to 2e5 statements.

### What didn't work
- Nothing failed. The run took 21 minutes, most of it classification.

### What I learned
- The seven non-divergent survivors of the default gate, with what kills them:
  - `branches.grade` `score >= 80` → `>= 79` (wrong only at 79, spec [40, 100]); `branches.sign` `x < 0` → `x < -1` and `x > 0` → `x > 1` (wrong only at −1, 1); `fixed-point.qmul` `a*b + 128` → `+ 129` (wrong when a·b ≡ 127 mod 256); `bounds-lab.pairs` `i >= len(a)` → `i > len(a)`: killed by v2's boundary and constant cases.
  - `bounds-lab.pairs` check on `b` admitting `i == len(b)`: wrong only when `len(a) = len(b) + 1` (witness from case 2 of the 4,000-case sample); and `strength.meter` `t3 < 1000` → `t3 < 999`, where O2 has turned `Math.min(level + c, 1000)` into a branch: wrong only when the running sum is exactly 999 at some step (witness case 3,333 of 4,200). Both survive v2: one needs a relation between two inputs, the other a value of an intermediate. Neither boundary values of inputs nor coverage reaches them (both branches of `t3 < 1000` are covered).
- Coverage-guided selection (`strong-cov`) kills exactly what the fixed boundary scheme kills on the corpus, at similar cost.

### What was tricky to build
- N/A (measurement).

### What warrants a second pair of eyes
- The 145 presumed-equivalent mutants: no difference in 4,200 specified and 4,000 unconstrained cases each. Their inspection is Step 10.

### What should be done in the future
- Held-out base (r0), f32 fixture, Candela subset, pipeline cost under v2.

### Code review instructions
- `various/04-corpus-final.json` (`total`, `bySubject`, `byOperator`, `byFunction` per gate), `various/04-corpus-final.jsonl` (one record per mutant).

### Technical details
- Survived-wrong for v2 (`strong`): `bounds-lab.pairs check-range len+1 "if (t5 >=u load32[b+0]) goto .8 else .11"`, `strength.meter const -1 "1000"`.

## Step 9: What version 2 costs on correct pipelines, what each case set covers, and a cost bug in the divergence rule

Two measurements on correct programs, where a gate's cost matters most because nearly every pass application is correct. Version 2 accepts exactly the passes version 1 accepts on all 44 projects and ends at the same heads. The time of whole pipelines does not change measurably, because a check is a small part of a pass application on the corpus. Measured alone, a check costs in proportion to its cases: version 2 costs what 80 default cases cost, about twice the default. Coverage of r0's blocks is identical for every case set (392 of 433), so on the corpus the stronger cases kill more by choosing values, not by reaching more code.

The check-time measurement first showed version 2 at 1,977 ms against 817 ms without the divergence rule. The cause: the subject side re-ran every case at 10× the limit whenever it hit the limit, also where r0 itself hit the limit (my-analysis), and those cases are no verdict anyway. Fixed: the baseline's run records, per case object, whether the origin finished (`runDifferential` runs a case's baseline before its subject), and the subject re-runs only where it did. Verdicts cannot change; after the fix version 2 costs 1,139 ms against 1,215 ms for 80 default cases.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Measure the kill rate gained and the time cost."
**Inferred user intent:** Know whether a stronger gate is affordable.
**Commit (code):** pending (next commit).

### What I did
- `scripts/08-contract-cost-and-coverage.mjs`: per project, the pipeline under v1-40 (Program.apply's contract), v1-80, v2, v2-nodiv via `applyPass(..., { contract })`; accepted passes and head compared; then `blockCoverage` of r0 per function for v1-40, v1-100, v2, v2-cov. Output `various/08-contract-cost-and-coverage.{txt,json}`; 1 min 56 s.
- `scripts/11-check-time.mjs`: per project, the head against r0 with each invariant's own `check` (no manager): first call and mean of 10. Before the fix: `various/11-check-time-before-fix.{txt,json}`; after: `various/11-check-time.{txt,json}`.
- `cases-strong.ts`: `originFinished = new WeakMap<Case, boolean>()` per strong check; the baseline run sets it; the subject re-runs only when it is `true`.

### Why
- The per-mutant gate times of Step 8 are dominated by mutants (diverging ones pay for re-runs); correct candidates are the common case.

### What worked
- Pipelines: totals v1-40 28,563 ms, v1-80 27,902 ms, v2 26,650 ms, v2-nodiv 26,585 ms; `differs: []` (same accepted passes, same heads, all 44 projects).
- Coverage of r0: 433 blocks, 392 covered by each of v1-40, v1-100, v2, v2-cov. The 41 others are trap blocks of bounds checks that the specifications never reach and `dead-code.pick`'s two dead blocks (25 functions list one or more, e.g. `blend.blend 6/6/6/6 of 7`, `heat-lab.sort 22/22/22/22 of 28`).
- Check time, all projects' heads once (steady state, ms): before the fix v1-40 432, v1-80 853, v1-100 1,091, v2 1,977, v2-nodiv 817, v2-cov 1,981; after the fix (machine under heavier load, load average 12.7) v1-40 560, v1-80 1,215, v1-100 1,507, v2 1,139, v2-nodiv 953, v2-cov 1,090. Per case: 150–215 µs for every configuration once the wasted re-runs are gone. First calls: v2-cov 4,143 ms (coverage selection), cached per origin revision afterwards.
- `node --test tests/typed/mutate.test.mjs`: 9 of 9 after the fix.

### What didn't work
- The first version of the divergence rule wasted re-runs, as above.

### What I learned
- On the corpus, the gate's cost is linear in its cases and small next to a pass's own cost; doubling the cases is affordable. Coverage-guided selection adds nothing on the corpus because the default cases already reach every reachable block.

### What was tricky to build
- Passing information from the baseline's run to the subject's within `runDifferential`'s fixed interface: a `WeakMap` keyed by the case object, which both runs receive.

### What warrants a second pair of eyes
- The fix relies on `runDifferential` running a case's baseline before its subject (differential.ts:114–115). IRWB-004 is changing how contracts execute (caching, workers); if baseline and subject runs are separated or cached, `originFinished` must be filled another way (the fallback is safe: no re-run, the case stays no verdict).

### What should be done in the future
- Re-measure the strong gate's per-mutant time on the corpus with the fix (the Step 8 numbers include the wasted re-runs).

### Code review instructions
- `src/typed/cases-strong.ts` (`meaningKeptStrong`, `run`); the two scripts.

### Technical details
- Cases per all-project check: v1-40 2,800; v1-80 5,600; v1-100 7,000; v2 5,600.

## Step 10: The float operators on the f32 fixture

The corpus is integer only, so the `f32` operator has no site there. The f32 fixture (`tests/typed/f32-fixture.mjs`, five functions after its pipeline, r4) gives 61 mutants: 33 `f32` (operator swaps such as `fadd`→`fsub`, `flt`→`fle`, `ffloor`→`fceil`, `f2i`→`f2u`, and constants changed by one ulp or by their sign bit), 20 `const`, 5 `swap`, 2 `cmp-weaken`, 1 `cmp-flip`. The default gate kills every non-equivalent float mutant (32 of 32). The two wrong mutants it accepts are integer mutants of the loop in `scale`, and both diverge; version 2 and `default+div` kill both. The one equivalent mutant is `floorConst`'s `2.5f` moved by one ulp: `floor(2.5)` and `floor(2.5 + ulp)` are both 2, proved on the exhaustive domain.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Operator "wrong f32 operator or bit pattern" measured where floats exist.
**Inferred user intent:** The float half of the gate is measured, not assumed.
**Commit (code):** 690e2a1 — "IRWB-005: f32 fixture mutation score (61 mutants, default 96.7%, v2 100%); ..."

### What I did
- `node tools/mutation-score.mjs --no-corpus --fixture f32 --gates default,check100,strong,strong-cases,default+div --json various/16-f32-fixture.json --jsonl various/16-f32-fixture.jsonl` → `various/16-f32-fixture.txt`; 3 min 21 s wall (load average about 12).

### Why
- Candela is the real float program but costs minutes per function; the fixture covers every float operator class cheaply.

### What worked
- Default: 61 mutants, killed 58, survived-wrong 2, equivalent 1; 96.7 % (both bounds, no presumed mutant). `strong` and `default+div`: 60 killed, 0 wrong, 100 %. `check100`, `strong-cases`: as default.
- Survivors of default: `scale cmp-weaken geu (i >= n)` (sample-diverges; `args [-897, -2147483648, 0]`, baseline 5 steps: with `n` negative the unsigned comparison never ends the loop) and `scale const -1 "1"` (the increment, sample-diverges, baseline 113 steps).
- Gate time (ms, 61 mutants): default 14,286; check100 8,562; strong 25,209; strong-cases 13,525; default+div 8,602.

### What didn't work
- N/A.

### What I learned
- Every float operator change on the fixture changes a result on at least one of the 40 default cases. A likely reason (not isolated by an ablation): for an f32 parameter without a specification, the first min(15, ⌊count/4⌋) = 10 cases sweep `F32_EDGES` (evaluate.ts:241–246), so NaN, ±∞, ±0, 1, −1, the smallest subnormal, the largest finite value and the smallest normal are the first parameter's values in every such function's cases.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The fixture is small (61 sites); Candela (Step 14) is the larger float test.

### What should be done in the future
- N/A.

### Code review instructions
- `various/16-f32-fixture.jsonl`, records with a `classification`.

### Technical details
- Site variants: `f32 ulp` 6, `f32 sign` 6, `fsub` 3, `fdiv` 2, `fceil` 2, `ffloor` 2, one each of `fadd fle fmax fmin fmul fne feq flt f2u f2i u2f i2f`.

## Step 11: The frozen default, re-recorded and compared

All source changes of the milestone are in (`src/typed/{mutate,cases-strong,facts-check}.ts` new, `src/typed/evaluate.ts` +9/−2 lines, `src/framework/**` untouched), so the frozen outputs were re-recorded at 690e2a1 and compared with the baseline recorded at 420d8e1 in Step 1. Everything the brief lists is identical. `npm test` has 11 more tests (the nine of `mutate.test.mjs` and the two of `facts-check.test.mjs`); the 325 original tests have the same names and the same results.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Record a baseline and diff at the end."
**Inferred user intent:** Proof that the default contract's behaviour did not move.
**Commit (code):** 96ff6aa — "IRWB-005: frozen outputs re-recorded at 690e2a1 and diffed against 420d8e1: ..."

### What I did
- `bash scripts/01-freeze-baseline.sh various/final` (build, `npm run test:only`, `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs`, `node tools/parity.mjs`, IRWB-001 `scripts/08-corpus-revisions.mjs`).
- `scripts/18-freeze-diff.sh various/baseline various/final > various/18-freeze-diff.txt` (01's header names a `02-freeze-diff.sh`; 02 had become the site census, so the comparison is script 18). It ignores `real/user/sys` lines and per-test durations.
- `grep -rln "mutate.js\|cases-strong.js\|facts-check.js" src tools`: only the three new tools import the new modules.

### Why
- The brief's hard constraint: generator, count, seed, verdicts, key and every decision frozen.

### What worked
- npm test: baseline `tests 325 pass 322 fail 0 skipped 3`, final `tests 336 pass 333 fail 0 skipped 3`; name diff: only the 11 added tests.
- IRWB_FULL suites: 21/21 both, identical names.
- `tools/parity.mjs`: identical. Corpus revision fingerprints (44 projects, every revision hash and head): identical.
- The pinned version test (`meaningKept({})` = `1+82965c92`, blend 40 = `1+2686cc23`, blend 100 = `1+c4dbecf4`) passes, so the contract key is unchanged.

### What didn't work
- N/A.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Candela's decisions were not re-run end to end (`tools/candela-o2.mjs` is a 30-minute, Candela-scale process, and the Candela mutation run occupies the one Candela slot). The argument that they are unchanged is structural: no existing module imports the new ones; the one change on the default path is `if (observe) observe(...)` with `observe` undefined in every default call; and the Candela tool re-checked r0 + bcm against r0 under the default rules with the same counts as before the change (13,258 agree, 0 disagree, 22 inconclusive, Steps 7 and 14).

### What should be done in the future
- N/A.

### Code review instructions
- `various/18-freeze-diff.txt`.

### Technical details
- Baseline commit 420d8e11988fa12a80bc7b84019ec27ebac0f625; final 690e2a1fb264b0a96fba259577ce7d4fb203e530.

## Step 12: The held-out base: mutants of r0

The corpus measurement of Step 8 mutates each project's pipeline head. To see whether its conclusions depend on that choice, the same harness mutated every project's r0 instead (the source as lifted, before any pass). The numbers are close: 1,231 mutants over 43 projects, 221 equivalent, the default gate accepts 38 wrong ones (96.2 % upper bound, against 95.8 %), version 2 accepts 1 (99.9 %, against 99.8 %). Divergence again dominates: 33 of the 38 diverge, 30 of them loop increments. The site mix differs where O2 changes the code's shape: at r0 bounds checks are still `caddr` expressions, so `hoist-trap` has 2 sites instead of 21 and `drop-check`/`check-range` 43/42 instead of 31/30, and `strength.meter`'s `Math.min(…, 1000)` has not yet become the branch whose constant survived version 2 on the head.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Robustness of the kill rate to the choice of base (guide §10's held-out run).
**Inferred user intent:** A number that does not depend on an arbitrary choice.
**Commit (code):** 690e2a1 (harness as run); results committed with this step.

### What I did
- `node --max-old-space-size=8192 tools/mutation-score.mjs --base origin --gates default,check100,strong,strong-cases,default+div --json various/07-corpus-origin.json --jsonl various/07-corpus-origin.jsonl` → `various/07-corpus-origin.txt`; 38 min 59 s wall (1,917 s user; the machine was at load 10–15 throughout).
- `node scripts/17-report-tables.mjs various/07-corpus-origin.jsonl`.

### Why
- The head is where late passes act, but it is also the code O2 has already simplified; r0 has more and different sites.

### What worked
- Totals (mutants, killed, survived-wrong, equivalent, lower..upper): default 1231 972 38 221 83.1 %..96.2 %; check100 975 35, 96.5 %; strong 1009 1, 99.9 %; strong-cases 975 35, 96.5 %; default+div 1005 5, 99.5 %.
- Equivalent under default: 31 proved exhaustively, 30 spec (unconstrained witness), 160 presumed. Survived-wrong by method: sample-diverges 24, exhaustive-diverges 9, sample 4, exhaustive 1.
- The five non-divergent survivors of default: `bounds-lab.pairs` check on `b` admitting `len(b)` (also the one survivor of version 2, witness `len(a) = len(b) + 1`), `branches.sign` `x < 0` → `x < −1` and `x > 0` → `x > 1`, `branches.grade` `80` → `79`, `fixed-point.qmul` `+128` → `+129`.
- The three non-increment divergent ones: `div-magic.digitsum` `v > 0` → `v >= 0` and `0` → `−1` (the loop `while (v > 0) v = v / 10` never ends once `v` reaches 0; witness `v = −100000`, baseline 34 steps), `my-analysis.f` `b = 0` → `b = −1` (`a = a + b + 1` no longer grows when `flag`; witness `[29, 1]`).
- 16 of 43 projects at 100 % under default.
- Gate time (ms, 1,231 mutants): default 136,340; check100 105,351; strong 449,417; strong-cases 73,776; default+div 235,594 (doubled against Step 8 by the machine's load; the ratios are similar).

### What didn't work
- N/A.

### What I learned
- The kill rate is a property of the gate rather than of the base: the two bases agree within half a point, and the same two mechanisms (divergence; single boundary values) account for nearly all survivors in both.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The r0 run was classified with the same cascade but not deep-searched (Step 13 deep-searches the head's presumed mutants only).

### What should be done in the future
- N/A.

### Code review instructions
- `various/07-corpus-origin.{txt,json,jsonl}`.

### Technical details
- Per operator at r0 (default; mutants, killed, wrong, equivalent): swap 226 219 0 7; const 542 470 36 36; cmp-flip 119 119 0 0; cmp-weaken 162 61 1 100; drop-check 43 4 0 39; check-range 42 3 1 38; shift 87 87 0 0; hoist-trap 2 1 0 1; drop-store 8 8 0 0.

## Step 13: C5, the range facts checked against executions

`typed.ranges` claims an interval for every i32 local before every statement, and bce and strength reduction act on those claims. C5 checks the claims on executions. `src/typed/facts-check.ts` runs cases with a new `observe` option of `evaluate` (called before each executed statement with the frame's locals; nine lines added to evaluate.ts, Step 11) and compares every claim narrower than the full i32 range with the local's value. Over every revision of every corpus pipeline, 149 million claim checks found no violation. To test the checker, every finite block-entry interval at r0 was narrowed by one at each end and checked at the block's first statement: 1,185 of 2,456 narrowed facts were reported. The other 1,271 cannot be reported by any checker on these cases: the original bound is never attained, so the narrowed fact is still true on every run. The experiment therefore measures how tight the analysis is on real executions (lower bounds 76 % attained, upper bounds 20 %), and it confirms that the hook reports on the right statement and local.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** C5 (optional): "check typed.ranges facts against executions".
**Inferred user intent:** The facts that passes rely on are tested, not assumed.
**Commit (code):** bddeabf — "IRWB-005 C5: typed.ranges checked against executions (src/typed/facts-check.ts), additive observe hook in evaluate; tests"; 96acefd (evaluate.ts edit kept additive); 8ee1b7a (targeted seeded check).

### What I did
- `rangesHold(st, facts, cases, { limit, maxViolations, only, stopAtFirst })`, `rangeSites(facts)`, `perturbRanges(facts, site, 'lo' | 'hi')`; tests in `tests/typed/facts-check.test.mjs` (Blend's facts hold at every O2 revision; the loop counter's entry interval narrowed at its lower end is reported with value 0; observing a run changes nothing in it and the callback runs once per step).
- `scripts/12-ranges-hold.mjs`: per project, every revision r0..rN: `typed.ranges` through the manager, 400 specified (seed 201) and 400 unconstrained (seed 202) cases per function, records at their offsets; at r0 the seeded facts. Output `various/12-ranges-hold.{txt,json}`; 12 min 6 s.

### Why
- A wrong range fact would let bce drop a check that matters only on rare inputs, the kind of error the gate is weakest at.

### What worked
- 44 projects, 168 revisions, 220,800 case runs, 149,381,636 claim checks, 12,888 distinct (statement, local) claims exercised, 0 violations.
- Seeded: 2,456 narrowed facts (1,228 per end), 1,185 reported: lower ends 936 of 1,228, upper ends 249 of 1,228. Of the first 40 unreported ones listed, 35 are upper ends and 30 of those are counters or indices whose claimed upper bound is 2³¹−1 or 2³¹−2.

### What didn't work
- The first full run checked each narrowed fact by running every claim of the function on all its cases, without stopping: it was still in `heat-lab`'s seeded facts after more than 15 minutes (killed, PID 3995969, exit 143). The first trial run had been cut by `timeout 600` at `gcd`. Fixed with `only: { stmt, local }` (check just the narrowed claim) and `stopAtFirst`; the whole run then took 12 minutes.

### What I learned
- No range fact of any corpus revision is contradicted by 800 cases per function, including unconstrained ones.
- A seeded wrong fact is a fair test only if the original bound is attained; narrowing a bound no execution reaches yields a fact that is still true. 48 % of finite block-entry bounds are attained on these cases.

### What was tricky to build
- Reading locals without changing the evaluator's behaviour: the hook receives the frame's `Int32Array` itself and must not write it; the test checks result, trap, steps and memory are identical with and without the hook.

### What warrants a second pair of eyes
- f32 locals are skipped (their facts are always the full range); claims are checked only where they are narrower than the full i32 range.

### What should be done in the future
- A stronger seeded test would move a bound *into* the observed range of values (e.g. to the median observed value), which is wrong on the cases by construction, and check that each such fact is reported.

### Code review instructions
- `src/typed/facts-check.ts`, `tests/typed/facts-check.test.mjs`, `scripts/12-ranges-hold.mjs`.

### Technical details
- Largest projects by checks: heat-lab 30,581,254 (665 claims), sort 26,846,130 (665), strings 16,855,954 (1,556), nested-loops 10,601,333, licm-nested 9,736,571.

## Step 14: A float class reported by IRWB-006: rewrites wrong only on NaN payloads

The coordinator relayed a finding from IRWB-006: `F32_EDGES` contains only the canonical NaN, and the unsound rule `x + (−0) → x` passes on those values; it is refuted by x = 0x7fc00001, because the evaluator's `fadd` returns the canonical NaN while `x` keeps its payload. I measured this class against both contract versions. Version 1 accepts the rewrite (`80/80`); version 2 rejects it (`2/160 sampled cases disagree`), because its f32 pool already contains two non-canonical NaNs, the negative quiet NaN 0xffc00000 and the signalling NaN 0x7fa00000 (`F32_EXTRA`, Step 5). On a computed operand, `(x * k) + (−0) → x * k`, the rewrite is equivalent on every input, since every NaN the evaluator computes is canonical; both versions accept it, correctly. The default stays unchanged; the recommendation goes into the report.

### Prompt Context
**User prompt (verbatim):** see Step 1. Coordinator message (relayed finding from IRWB-006, summarized): `F32_EDGES` has only the canonical NaN; `x + (−0) → x` passes on it and fails at 0x7fc00001; treat it as a surviving-mutant class and a candidate for the stronger generator; keep the default unchanged; measure and recommend.
**Assistant interpretation:** Measure the class under both versions, add a test, and recommend.
**Inferred user intent:** The gate's float blind spot is quantified, and the fix is proposed rather than applied.
**Commit (code):** see the commit after this step ("NaN-payload class").

### What I did
- `git show irwb-001/import-v6-prototype:tests/typed/rules.test.mjs` (read only): IRWB-006's `fadd-neg-zero` candidate and its counterexample `x & 0x7fffffff = 0x7fc00001`.
- `scripts/19-nan-payload.mjs`: two functions, `addNegZero(x) = x + (−0)` and `scaled(x, k) = (x * k) + (−0)`; the rewrite as a `typedPass` (`fadd(a, const 0x80000000)` → `a`); judged by `Program.apply` and by `checkInvariant(meaningKeptStrong({ count: 40, extra: 40 }))`; both revisions run on five NaN encodings. Output `various/19-nan-payload.txt`.
- Test: `tests/typed/mutate.test.mjs`, "a float rewrite wrong only on NaN payloads (x + -0 -> x) passes version 1 and fails version 2"; 10 of 10 pass.

### Why
- The f32 operator of the harness swaps operators and moves constants; it never produces this rewrite, so the fixture's 100 % says nothing about payloads.

### What worked
- `addNegZero`: version 1 accepted (`80/80`), version 2 rejected (`2/160 sampled cases disagree`). Non-canonical NaN arguments among the cases: version 1 0, version 2 2. On 0x7fc00001, 0xffc00000, 0x7fa00000 and 0x7f800001 r0 returns 0x7fc00000 and the rewrite returns the argument.
- `scaled`: both accept; the rewrite agrees with r0 on all five encodings.
- `F32_EDGES` NaNs: 0x7fc00000 only. `F32_EXTRA` NaNs: 0xffc00000, 0x7fa00000.

### What didn't work
- My first version of the test was appended with a shell heredoc; the worktree isolation check refused the compound command. Added with the editor instead.

### What I learned
- Non-canonical NaNs only enter a program through its inputs, its memory or constant bit patterns: every NaN the evaluator computes is canonical. So the class matters exactly where a rewrite removes an operation applied to an input or a loaded value.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Version 2's pool covers the class only for unspecified f32 parameters. A parameter specified as a range (`[lo, hi]`) gets no NaN at all, by design; there the rewrite is equivalent under the specification.

### What should be done in the future
- Recommendation for a future version 1.x: add a non-canonical quiet NaN (0x7fc00001), a negative quiet NaN (0xffc00000) and a signalling NaN (0x7fa00000) to `F32_EDGES`. That changes the cases of every function with an unspecified f32 parameter, and so the version string.

### Code review instructions
- `scripts/19-nan-payload.mjs`, the new test at the end of `tests/typed/mutate.test.mjs`.

### Technical details
- Version 1's check counts both functions' 40 cases (80); version 2's, 80 per function (160).

## Step 15: Merging IRWB-004 and IRWB-006 (integration head 1f45c94)

The coordinator asked for a merge of `irwb-001/import-v6-prototype` at 1f45c94, which contains IRWB-004 (cheap experiments: an asynchronous meaning check with a verdict memo, reused evaluator buffers, frozen records from `storeOf`, a worker pool) and IRWB-006 (rewrite rules as verified data, SSA). The merge applied without conflicts, `src/typed/evaluate.ts` included: my `observe` hook now sits next to IRWB-004's reused locals window, and receives that window. One change of mine followed from reading the new `differential.ts`. The divergence rule of version 2 learned whether r0 finished from the baseline's run of the same case. With IRWB-004's memo or a worker, a baseline outcome can be replayed instead of run, which would have switched the rule off silently. The subject's `run` now runs the origin itself when it does not know. Version 2 sets no `baselineKey`, so today nothing is replayed for it, and verdicts are unchanged. After the merge, all gates pass and the frozen outputs are identical to the milestone's baseline.

### Prompt Context
**User prompt (verbatim):** see Step 1. Coordinator messages (summarized): merge `irwb-001/import-v6-prototype` (head 1f45c94) into this branch soon; resolve conflicts in `evaluate.ts` keeping both intents; re-run the gates and a sample of the mutation measurements; record the merge in the diary. Changes listed: async meaning check (`decide`), verdict memo keyed by origin revision, case and limit (`decideCase`, `differentialSpec`, `runDifferentialAsync`, `setDifferentialReuse`, `differentialStats`), reused evaluator buffers, frozen `storeOf` records, a worker pool (not default).
**Assistant interpretation:** Merge, check that nothing of mine depends on what changed, re-validate.
**Inferred user intent:** One integration line in which all milestones' work holds together.
**Commit (code):** f6a1fa8 (merge), 2948ae8 (divergence rule independent of run order), 9707c12 (gates on the merged branch).

### What I did
- `git merge --no-ff --no-commit irwb-001/import-v6-prototype` (`git rev-parse` = 1f45c94c4cbeca09c400740facf2f487bd9afd41): "Automatic merge went well"; 155 files, src: 36 files.
- Read the merged `evaluate.ts` (observe at line 466, called with `L = LOCALS.subarray(base, base + n)`) and `differential.ts` (`prepare`, `decideCase`, `memoKeys`, `runDifferential`, `runDifferentialAsync`).
- `cases-strong.ts`: in `run('subject', art, c, ports)`, if the origin's outcome for `c` is unknown, evaluate `ports.origin` on `c` at the limit and remember it.
- `npx tsc`; `node --test tests/typed/mutate.test.mjs tests/typed/facts-check.test.mjs`: 12 of 12.
- `scripts/01-freeze-baseline.sh various/final-merged`; `scripts/18-freeze-diff.sh various/baseline various/final-merged > various/18-freeze-diff-merged.txt`.
- A sample of the corpus measurement on the merged code (Step 16).

### Why
- Every assumption of the harness about the gate's internals (baseline before subject, a fresh array per call, mutable records) had to be checked against the new code, not assumed.

### What worked
- npm test on the merged branch: `tests 362 pass 359 fail 0 skipped 3`; no test removed; 37 added (12 of mine, 25 from IRWB-004/006). `IRWB_FULL=1` suites: 21/21, identical names. `tools/parity.mjs`: identical. Corpus revision fingerprints: identical to 420d8e1, so IRWB-006's rule tables and IRWB-004's changes give the same revisions, as their reports say.
- The pinned version strings still hold (`1+82965c92`, `1+2686cc23`, `1+c4dbecf4`): IRWB-004 added fields to the differential specification but not to the contract's key.

### What didn't work
- N/A.

### What I learned
- The memo keys a candidate's verdicts by `closureKey(value, fn)`, a hash of the code a case can reach, so two mutants share a replayed verdict only when their reachable code is identical; no mutant can inherit another's verdict.
- `observe` receives a window of a shared `Int32Array`; reading it during the callback is correct, keeping it is not (the facts checker only reads).

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The deep search (Step 17) and the Candela run (Step 18) were started before the merge and ran on the pre-merge build; the post-merge sample (Step 16) is the evidence that the merge changes none of their kind of result.

### What should be done in the future
- Version 2 could adopt the memo (`baselineKey`/`subjectKey`) for speed; its divergence rule is now safe under replay.

### Code review instructions
- `git show 2948ae8`; `various/18-freeze-diff-merged.txt`.

### Technical details
- Merge commit f6a1fa8 has parents 83a4f71 (this branch) and 1f45c94 (the integration head).

## Step 16: A sample of the corpus measurement on the merged code

Nine projects re-measured on the merged branch (blend, bounds-lab, branches, div-magic, fixed-point, licm-traps, sort, strength, strings: 396 mutants, six gate configurations, classification). Compared mutant by mutant with the pre-merge run of Step 8: 396 of 396 identical, in every gate's verdict and in the class. The default gate (through `Program.apply`, which now replays r0's outcomes from IRWB-004's memo) took 10.4 s for these 396 mutants against 27.8 s before the merge, on a machine under similar load.

### Prompt Context
**User prompt (verbatim):** see Step 1; coordinator request summarized in Step 15.
**Assistant interpretation:** "Re-run your gates and a sample of your mutation measurements on the result."
**Inferred user intent:** Evidence that the merge leaves the measurements valid.
**Commit (code):** 2948ae8 (code as run); results committed with this step.

### What I did
- `node --max-old-space-size=8192 tools/mutation-score.mjs --projects blend,bounds-lab,branches,div-magic,fixed-point,licm-traps,sort,strength,strings --gates default,default80,check100,strong,strong-cases,default+div --json various/21-merged-sample.json --jsonl various/21-merged-sample.jsonl` → `various/21-merged-sample.txt`; 5 min 24 s.
- `scripts/20-compare-runs.mjs various/04-corpus-final.jsonl various/21-merged-sample.jsonl` → `various/21-merged-sample-compare.txt` (matches mutants by subject, function, operator, variant, target and text).

### Why
- The sample covers every operator, both divergence and value survivors, and both survivors of version 2.

### What worked
- `subjects 9, mutants after 396, matched 396, identical 396, different 0, only before 0, only after 0`.
- Totals on the sample (mutants, killed, wrong, equivalent, lower..upper): default 396 307 18 71 81.4 %..94.5 %; default80 310 15, 95.4 %; check100 311 14, 95.7 %; strong 323 2, 99.4 %; strong-cases 311 14, 95.7 %; default+div 318 7, 97.8 %.
- Gate time on these 396 mutants (ms), before → after the merge: default 27,791 → 10,351; default80 14,074 → 8,277; check100 15,817 → 10,786; strong 56,315 → 69,492; strong-cases 11,405 → 12,151; default+div 30,197 → 35,576.

### What didn't work
- N/A.

### What I learned
- Version 1 configurations got faster with the memo (r0's cases and outcomes are kept per origin revision), version 2 did not: it has no `baselineKey`, so it still runs r0 on every case.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- Times are from a shared machine (load 8–12); only the large default speedup is clearly above the noise.

### What should be done in the future
- Give version 2 a `baselineKey` to share r0's outcomes in the harness.

### Code review instructions
- `various/21-merged-sample-compare.txt`.

### Technical details
- The pre-merge run measured `strong` before the Step 9 fix of wasted re-runs; the post-merge run after it.

## Step 17: The machine stopped responding; what survived and what has to be re-run

The machine stopped responding during the night and was rebooted in the morning; this session resumed afterwards. `journalctl --list-boots` shows the previous boot ending at Thu 2026-11-26 01:39:07 EST and the current one starting at 09:14:46. The coordinator reports that the previous boot's log ends abruptly, with no shutdown and no OOM-killer entry. The cause is not confirmed and I do not attribute one. At the time, two long processes of mine were running: the Candela mutation run (a Candela-scale process, about 2.9 GB resident when I last looked at 00:48 with `ps`) and the deep search of the corpus's presumed-equivalent mutants (corpus scale, about 0.4 GB). IRWB-003's per-scene speed run was running too, according to the coordinator. Every commit up to 486744b (01:36) is intact.

From now on every Candela-scale process runs under a memory cap (coordinator's rule): `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 …`. Over the limit, the kernel kills only that process, with exit code 137. Only one such process runs at a time, with at most 2 worker threads.

### Prompt Context
**User prompt (verbatim):** see Step 1. Coordinator message (summarized): the machine stopped responding; previous boot's log ends at 01:39:07 without shutdown or OOM-killer entry, reboot at 09:14; the cause is not confirmed. New rule: Candela-scale node processes under `systemd-run --user --scope -p MemoryMax=14G -p MemorySwapMax=0` with `--max-old-space-size=10240`, one at a time, at most 2 workers; on exit 137 reduce what the process holds, never raise the cap. Next: a diary step with the facts and the memory per function if measurable; commit the valid partial outputs labelled as cut off; resume Candela under the cap, skipping finished functions; investigate the 0-byte deep-search output; finish as briefed.
**Assistant interpretation:** Record the facts without a cause, keep what is valid, re-run the rest under the cap.
**Inferred user intent:** Lose no valid work, and never freeze the shared machine again.
**Commit (code):** 486744b was the last commit before the failure; partial outputs committed with this step.

### What I did
- `journalctl --list-boots`: boot −1 `Thu 2026-11-19 11:00:45 EST — Thu 2026-11-26 01:39:07 EST`, boot 0 from `Thu 2026-11-26 09:14:46 EST`. The last lines of boot −1 (`journalctl -b -1 -n 3`) are routine service and audit messages at 01:39:02–01:39:07.
- Candela outputs: `13-candela.jsonl` (683,603 bytes, 01:36) holds 1,093 records for 14 complete functions (acosf through skyL_wgsl): the tool appends a function's records only after the function is finished, so every function in the file is complete. `13-candela.txt` ends with the `skyL_wgsl` line at 2,649,438 ms. Renamed to `13-candela-part1-cut-off.{txt,jsonl}` and committed as valid but cut off; the four functions not reached (`cameraRay`, `cdlInit`, `cdlLayout`, `envL`) are run again (Step 18).
- Deep search: `10-corpus-final-deep.txt` is 0 bytes with mtime 00:11. That is the time the shell's redirection created the file when the script started, not the time it stopped: script 10 writes its summary and its output JSONL only when it finishes. The process was alive long after 00:11: at about 01:26 `ps -o etime,time -p 3950068` gave `01:14:14 01:06:25` (elapsed, CPU). It was killed by the failure before it finished, about 88 minutes in. Renamed to `10-corpus-final-deep-run1-killed.txt`; the search is re-run with progress output and incremental writing (Step 19).

### Why
- A record set that is complete per function is valid as measured; only the unreached functions need measuring again.

### What worked
- No committed work was lost; the per-function appending added before this run (6f80cb8) kept 14 functions' results.

### What didn't work
- Script 10 wrote nothing until the end, so 88 minutes of the deep search left no trace.

### What I learned
- A long measurement must write as it goes. Both re-runs now do.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The memory held per Candela function is measured on the re-run (Step 18), since the cut-off run did not record it.

### What should be done in the future
- N/A.

### Code review instructions
- `various/13-candela-part1-cut-off.{txt,jsonl}`, `various/10-corpus-final-deep-run1-killed.txt` (empty).

### Technical details
- Functions complete in part 1 (sites judged / sites): acosf 60/60, exp2f 47/47, hdriPdf 47/47, lum 11/11, q_absi 9/9, s10_mat_1 116/116, s12_heightAt 2/2, s15_customKernel 6/6, s17_sdUser 2/2, s3_mat_1 116/116, s5_mat_4 182/332 (150 skipped by the 600 s budget), s7_mat_2 4/4, s9_sdf_0 140/224 (84 skipped), skyL_wgsl 351/351.

## Step 18: Candela, completed under the memory cap

The four functions the failure cut off were run under the cap, with the same selection, and the two parts together are the Candela measurement: 18 functions (14 cheap ones spread by name, 4 that bcm changed), 3,931 mutants judged (1,395 sites skipped by the per-function budget, all in `s5_mat_4`, `s9_sdf_0` and `cdlInit`), none invalid. The default gate kills 97.6 % of the non-equivalent ones (upper bound; 88.0 % lower), accepting 85 wrong mutants. Unlike the corpus, nearly all of them are float mutants (83 of 85) in shading and distance-field code, and none diverges. More random cases help more than boundary cases here: 100 default cases accept 49, version 2 accepts 71. The replicated gate agreed with the framework's own `meaningKept` on all 2,289 mutants where they could be compared. The process peaked at 9.97 GB resident, under the 14 GB cap.

### Prompt Context
**User prompt (verbatim):** see Step 1; coordinator's resume message summarized in Step 17.
**Assistant interpretation:** Resume Candela under the cap, skipping finished functions; record memory per function.
**Inferred user intent:** The Candela subset completed safely.
**Commit (code):** cb159f8 (`--skip-done`, memory per function), 1d09e9c (live heap after a full GC, usage under the cap); results committed with this step.

### What I did
- `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 tools/mutation-score-candela.mjs --count 14 --bcm 4 --fn-budget 600 --gates default,check100,strong,default+div --skip-done various/13-candela-part1-cut-off.jsonl --json various/13-candela-part2.json --jsonl various/13-candela-part2.jsonl` → `various/13-candela-part2.txt`; exit 0, 15 min 28 s. The selection printed is the same 18 functions as part 1; 14 skipped, 4 run (`cameraRay`, `cdlInit`, `cdlLayout`, `envL`).
- `scripts/22-candela-summary.mjs various/13-candela.json various/13-candela-part1-cut-off.jsonl various/13-candela-part2.jsonl` → `various/13-candela-summary.txt`.

### Why
- The functions bcm changed are where a real pass acted on Candela; `cdlInit` and `cdlLayout` are called by nothing, so they also exercise the cross-check with the framework's gate.

### What worked
- Totals (mutants 3,931; killed, wrong accepted, equivalent, lower..upper): default 3,429 85 417 88.0 %..97.6 %; check100 3,477 49 405 89.1 %..98.6 %; strong 3,443 71 417 88.4 %..98.0 %; default+div 3,430 84 417 88.0 %..97.6 %.
- Per operator (default, upper): f32 830 killed / 83 wrong / 308 equivalent (90.9 %); const 99.9 %; swap 99.8 %; shift, drop-store (178), cmp-flip, cmp-weaken 100 %; drop-check 10 and check-range 10 all equivalent (Candela's checked text addresses after bcm never fail on the cases).
- Wrong accepted by default, per function: s9_sdf_0 52, s5_mat_4 10, skyL_wgsl 7, s10_mat_1 5, s3_mat_1 5, envL 2, acosf, hdriPdf, q_absi, cameraRay 1 each. By variant: `f32 sign` 22, `fdiv` 15, `ulp` 14, `fmax` 6, `fmin` 6, `fsub` 6, `fadd` 6, `fmul` 3, `fle` 3, `f2u` 1, `fge` 1, `const −1` 1, `swap` 1.
- Classes (default): survived-wrong 85 (all by the sample), equivalent-spec 35, equivalent-presumed 382.
- Cross-check on functions nothing calls: q_absi 9 (part 1), cdlInit 2,171 and cdlLayout 109 (part 2), 2,289 mutants, 0 differences between the replicated and the framework gate.
- Memory per function (after the function, before releasing its cases; process-wide): cameraRay rss 1,595 MB (heap 1,129), cdlInit 9,789 (9,241), cdlLayout 9,841 (9,317), envL 2,696 (2,204); peak 9,972 MB. The 9 GB after cdlInit was not retained: at 09:43 the resident size had fallen to 2,075 MB without any release by the tool, so it was uncollected garbage of 2,171 mutant revisions, which V8 keeps until it nears the 10 GB old-space limit. The tool now runs a full collection before measuring when started with `--expose-gc`.

### What didn't work
- `cdlInit` has 3,332 sites (one block of 514 statements); 1,161 were left unjudged by the 600 s budget, most of the time going into building revisions (533 s for 2,171 mutants).

### What I learned
- Candela's gate weakness is not divergence and not boundaries: it is the region of the input space. A distance function's terms or a material's lobe matter only for points near a surface or for parameters in a narrow range, and 40 random points mostly miss them; the classifier's 400 + 200 + 400 cases hit them. 12 mutants of the material functions are killed by `check100` alone, with cases whose `K` record is laid out in key order (outside the specification, Step 7), and are equivalent on the specified cases.

### What was tricky to build
- Resuming with the same selection: `--skip-done` recomputes the selection and removes the finished functions, rather than naming the rest by hand.

### What warrants a second pair of eyes
- Part 1 ran on the pre-merge build, part 2 on the merged one; the corpus sample of Step 16 is the evidence that the merge changes no verdict.

### What should be done in the future
- A follow-up on `s9_sdf_0` and `s10_mat_1` with a coverage-chosen and a 400-case gate (Step 20).

### Code review instructions
- `various/13-candela-summary.txt`, `various/13-candela.json`.

### Technical details
- Gate time over 3,931 mutants (ms): default 185,004; check100 553,646; strong 412,458; default+div 222,864.
