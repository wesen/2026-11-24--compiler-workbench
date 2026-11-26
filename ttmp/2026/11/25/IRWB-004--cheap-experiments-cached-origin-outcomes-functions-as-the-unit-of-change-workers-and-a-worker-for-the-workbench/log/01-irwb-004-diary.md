---
Title: IRWB-004 diary
Ticket: IRWB-004
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological, step-numbered investigation diary of IRWB-004: measuring where a pass on Candela spends its time, then caching the origin's outcomes (D1), making functions the unit of change (F1), and moving work onto worker threads in Node and a Web Worker in the browser (F4)."
LastUpdated: 2026-11-25T23:30:00-05:00
WhatFor: "Resume point and evidence trail for IRWB-004."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# IRWB-004 diary

Steps are chronological, oldest first. Paths are relative to the repository root unless they start with `/`. `$T` stands for this ticket's directory, `ttmp/2026/11/25/IRWB-004--cheap-experiments-cached-origin-outcomes-functions-as-the-unit-of-change-workers-and-a-worker-for-the-workbench`.

## Step 1: Reading the system and the evidence before measuring anything

The milestone is about cost, and every cost it must cut was measured by someone else on an earlier build. Before planning, I read the explanation of the whole system, the two diary steps that measured the framework, and the UI agent's account of what the browser pays. The reading changed the plan in one important way: the 18 s "no-change pass" is not spent on encoding the program once. It is spent on a dozen whole-program operations that each run because a cache key could not prove the input unchanged.

### Prompt Context

**User prompt (verbatim):** "ask subagents to always commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). When a milestone is finished, write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). [...] For each, create a ticket and design doc (if you don't have already) Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Then implement"

The coordinator's brief for this milestone (IRWB-004) adds the items D1 (cache the origin's outcomes), F1 (functions as the unit of change), F4 (worker threads in Node, a Web Worker in the browser) and F2 (a persistent store, only if cheap), the hard constraint that every revision hash stays bit-for-bit identical, and the acceptance measurements.

**Assistant interpretation:** Write an intern guide for this milestone, upload it, then implement D1, F1 and F4 on my worktree branch with every revision hash unchanged, measure before and after, and write a vault report.

**Inferred user intent:** Experiments on Candela (a pass, a pipeline, a search, a scene) should cost seconds, not minutes, so that the research agenda can be run at all; and the browser workbench should stay responsive while it does Candela-sized work.

**Commit (code):** none yet; the worktree is at `420d8e1`.

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`.
- Read `ttmp/2026/11/24/IRWB-002--research-agenda-*/design-doc/01-*.md`, Part 1 (sections 1–17), and from Part 2 the items D1 (line 1234), F1–F6 (lines 1490–1630) and the risk "Hash stability under F1" (line 2027).
- Read IRWB-001 `log/02-implementation-diary.md` steps 12 (framework performance), 16 (the full Candela O2 run) and 26 (per-scene runs), and the UI agent's diary `log/05-ui-agent-diary.md` steps 6–11.
- Read the code every pass goes through: `src/framework/core/data.ts`, `src/framework/ir/adapters.ts`, `view.ts`, `diff.ts`, `store.ts`, `transactions.ts` (`Edit.prepare`), `correspondence.ts`, `src/framework/passes/define-pass.ts` (`applyPass`), `src/framework/contracts/differential.ts`, the parts of `analysis-manager.ts` that verify a transformation, `src/typed/model.ts` (`Store`), `src/typed/ir.ts` (validator, adapter, `storeOf`), `src/typed/passes.ts` (`typedPass`), `src/typed/evaluate.ts` (`meaningKept`), `src/typed/program.ts`, and on the browser side `site-src/candela.js`, `src/workbench/candela.ts`, `src/workbench/projects.ts` (`kernelFor`), `tools/build-site.mjs`, `tools/serve-site.mjs`, `site-src/index.html` (the CSP).

### Why
- The hard constraint (identical revision hashes) and the acceptance (a no-change pass under 1 s) pull in different directions only if the cost is inherent in the definition of a revision. Whether it is depends on where the time goes, which only the code and a profile can say.

### What worked
- The reading located the repeated whole-program work without running anything:
  - `applyPass` (`define-pass.ts:190`) handles a pass that returns nothing by preparing an empty logical edit (`transactions.ts:295`), which rebuilds the native value from the projection, creates a new artifact and projects it again.
  - `IRStore.#snapshot` (`store.ts:23`) recomputes the revision hash of every artifact it retains, and `validateArtifact` (`definitions.ts:278`) runs the IR validator and both hashes for every port of every analysis and check.
  - `invariantInternal` (`analysis-manager.ts:1120`) fingerprints its inputs, which for the meaning check are two whole programs, to build a key used only for cycle detection.
  - `makeCorrespondence` (`correspondence.ts:99`) sorts one entry per entity by its canonical text, encoding each entry O(log n) times.
  - `typedPass.run` clones every record with `structuredClone` (`model.ts:219`), and `toNative` clones them all again, so after a pass no record object is shared with the input and every cache keyed on frozen objects misses.
  - `runDifferential` (`differential.ts:102`) generates the cases from r0 and evaluates r0 on every case, for every pass.

### What didn't work
- No failures in this step.

### What I learned
- `rev` and `counters` sit early in the canonical text of a `typed.blocks` value (keys are sorted: `blocks, counters, fnOrder, fns, formatVersion, frontEnd, ops, program, rev, stmts, values`). SHA-256 can resume only from a prefix, so caching hash states cannot help: any changed revision changes `rev` and must hash nearly the whole text. The definition-preserving answer is to make the text cheap to build and the hash cheap to run, not to hash less.
- The UI agent found that opening Candela in the page costs about 10 s, almost all of it `createIRArtifact`, and that the contract's evaluation, not the pass, dominates a pass in the page (45 s).

### What was tricky to build
- Nothing built yet.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Measure before designing: a profile of the no-change pass and of `cfg`, and the full O2 run with every revision hash recorded (no earlier evidence records the O2 revision hashes in full).

### Code review instructions
- N/A (reading only).

### Technical details
- Worktree: `/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-ace75c1737b051a8c`, branch `worktree-agent-ace75c1737b051a8c`, base `420d8e1`.

## Step 2: The worktree builds, and the corpus baseline is recorded

The worktree had no `node_modules`, so nothing could build. I linked the main checkout's `node_modules` (it is gitignored), built, and recorded the corpus's revision listing at the base commit. This listing is the reference that every framework change in this milestone is diffed against.

### Prompt Context

**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Record the baseline the brief requires before changing any framework code.
**Inferred user intent:** Proof that no revision hash moves.
**Commit (code):** none (no code changed).

### What I did
- `ln -s /home/manuel/code/wesen/2026-11-24--compiler-workbench/node_modules node_modules`; `git status` stays clean (`/node_modules` is in `.gitignore`).
- `npm run build`: 19.2 s wall.
- `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs > $T/various/01-corpus-revisions-baseline.txt` at `420d8e1`: 44 lines, 19.3 s wall.
- Copied `dist`, `tools`, `vendor`, `corpus` and `package.json` of the base build to the session scratchpad (`…/scratchpad/baseline/`), so that "before" measurements can be repeated later against the unchanged build. My scripts take `IRWB_ROOT` to point at it.

### Why
- The IRWB-001 script prints 12-character prefixes. That is enough to detect any change in practice, and it is the format the brief names; full hashes for Candela come from my own script (Step 3).

### What worked
- `01-corpus-revisions-baseline.txt`, first lines:
  ```
  across-calls 811ef589b3da 811ef589b3da,91e24eda152a,d267fe99f315 139d2bc722fc
  algebra 228a7e23e69f 228a7e23e69f,15815efe71b5,032a7376ff87,0410a2f6970a,6ec2a617c3c3,a8b378ce7135,a7eb3b0f13e3 24d26910699d
  blend 2a3b3eb1f8a7 2a3b3eb1f8a7,fad91c0fd44e,8c5226a95809,e55271c4fec9,1997637b6c94,a470579cf9ca,707852c20def 87f1da0e9ba7
  ```

### What didn't work
- My first attempt chained `git rev-parse HEAD` into a longer shell command; the worktree guard refused it ("this command names git in a form too complex to verify that it stays inside the worktree"). Running `git rev-parse HEAD` on its own worked (`420d8e11988fa12a80bc7b84019ec27ebac0f625`).

### What I learned
- The machine was busy when I measured (load average 8.5 at 23:14, five `node --test` processes from other agents), so absolute times in this milestone carry noise; I report them with the load where it matters.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- Diff this listing after every framework change.

### Code review instructions
- `diff $T/various/01-corpus-revisions-baseline.txt <(node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs)`.

### Technical details
- The listing has, per project: the r0 revision, every revision of O2, and the O2 image's revision.

## Step 3: Where a pass on Candela spends its time

`$T/scripts/02-framework-cost.mjs` repeats IRWB-001's cost measurement (lift, artifact, projection, the cfg analysis, a no-change pass and the `cfg` pass, each under the meaning contract at 40 cases per function), prints full revisions, and times the pieces separately. Run with `--cpu-prof`, `$T/scripts/03-profile-summary.mjs` turns the profile into inclusive and self time per function. The no-change pass took 13.3 s, `cfg` 25.2 s, and the profile names the culprits: an empty edit that rebuilds the program (11 s of the no-change pass), re-hashing and re-validating artifacts that are already known valid, re-encoding records that did not change, and evaluating r0 again on every case.

### Prompt Context

**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Measure before designing.
**Inferred user intent:** The design should remove the costs that exist, not the ones I expect.
**Commit (code):** none (scripts only).

### What I did
- `node --max-old-space-size=12288 --cpu-prof --cpu-prof-dir=$T/various/profiles --cpu-prof-name=02-baseline-strength-cfg.cpuprofile $T/scripts/02-framework-cost.mjs`, under `/usr/bin/time -v` (load average 3.06).
- The same with `--passes strength` and with `--passes cfg` alone, each with its own profile, so the two passes' samples do not mix.
- `node $T/scripts/03-profile-summary.mjs <profile> --within applyPass` (samples whose stack contains `applyPass`) and `--within verify` (the contract, which runs after an `await` and so is not under `applyPass` on the stack).

### Why
- IRWB-001 step 12 profiled the old build before its caches existed. The caches changed which costs remain, so its profile no longer describes the code.

### What worked
- `$T/various/02-framework-cost-baseline.json`:
  ```
  lift 236 ms · toNative 463 · createIRArtifact 3709 · canonical (cached) 6 · text 18,178,949 chars
  sha256 of the revision text 315 ms (58 MB/s) · Store.from 468 · storeOf 403 · project (cached) 0
  entities 103,618 · relations 132,054 · cfg analysis 496
  strength 13,265 ms, unchanged, cd36346ea7c4f175d7db025afe953e89f078902ef1ee44beaf15a7906b140456
  cfg 25,228 ms, 110 functions, 4aea7e81dd046901b550627db94bd36074be8797e59d9a75323c68e03472b1a3,
      check 13,280 cases: 13,258 agree, 0 disagree, 22 inconclusive
  rss 1,837 MB; wall 44.8 s; maximum RSS 2.03 GB
  ```
  The two revisions equal IRWB-001 step 12's (`cd36346ea7c4f175`, `4aea7e81dd046901`).
- **The no-change pass** (`strength` alone, 15.9 s in that run; 14.0 s of samples under `applyPass`):
  - `Edit.prepare` of the empty edit: 11.0 s. Inside it: `createIRArtifact` 3.7 s, `makeCorrespondence` 2.4 s, `diffGraphs` 2.1 s, `project` 1.9 s, `rebuildBlocks` 0.4 s.
  - the `ranges` analysis the pass needs: 1.9 s (`solveArtifact` 1.5 s).
  - `openIR` of the input: 1.0 s, of which `IRStore.retain` (re-hashing) 0.6 s.
  - `typedPass.run`: 0.5 s, of which `Store.from` 0.4 s.
- **`cfg`** (18.6 s in its own run): 10.2 s of samples under `applyPass`, 6.2 s under `verify`:
  - under `applyPass`: `createIRArtifact` 3.3 s (`immutable` 3.1, `fingerprint` 2.5), `makeCorrespondence` 1.8 s, `project` 1.7 s, `diff` 1.4 s, `openIR` 1.0 s, `validateBlocks` 0.6 s, `typedPass.run` 0.9 s (`Store.from` 0.33, `toNative` 0.32, `revisionCorrespondence` 0.27).
  - under `verify` (the contract): evaluation 3.4 s (r0 and the candidate on 13,280 cases), `casesFrom` 0.7 s, `fingerprint` of the invariant's key 1.5 s, `validatePorts` 1.2 s (the validator and both hashes, again, for both artifacts), `storeOf` of the candidate 0.36 s.
  - garbage collection: 5.2 s over the whole first run.

### What didn't work
- My first `--within run` filter matched every function named `run` and summarized 7.7 s of 44.6 s; filtering on `applyPass` and `verify` separately is what separates the pass from its check.

### What I learned
- Of the no-change pass's 13–16 s, about 11 s is work on an empty edit whose result is known before it starts: an empty edit rebuilds a value canonically equal to its base (the projection and `rebuild` are inverses, and a test checks it on the corpus).
- The JavaScript SHA-256 runs at 58 MB/s, and the revision text of Candela r0 is 18.2 MB, so every full hash costs about 0.3 s; one pass hashed the same programs about 20 times (7.0 s of `sha256` in the first run).
- About a third of `cfg`'s time is the contract, and half of that is evaluating r0 again.

### What was tricky to build
- Attributing time across `await`: V8's profile records the synchronous stack only, so time in the contract appears under `verify` without `applyPass` above it. The summary script's `--within` option is the way to split a pass from its check.

### What warrants a second pair of eyes
- Absolute times vary by about 20% between runs on this shared machine (strength 13.3 s and 15.9 s in two runs).

### What should be done in the future
- The full O2 run with revisions (Step 4), and a design that addresses each line above.

### Code review instructions
- `node --max-old-space-size=12288 $T/scripts/02-framework-cost.mjs --passes strength,cfg`; for a profile add `--cpu-prof --cpu-prof-dir=DIR`, then `node $T/scripts/03-profile-summary.mjs DIR/*.cpuprofile --within applyPass`.

### Technical details
- Profiles: `$T/various/profiles/02-baseline-{strength-cfg,strength,cfg}.cpuprofile`.
- Measurements: `$T/various/02-framework-cost-baseline{,-strength,-cfg}.json`.

## Step 4: The Candela O2 baseline, with every revision hash and every piece of evidence

No earlier evidence records Candela's O2 revisions in full, and the brief requires them to stay identical. `$T/scripts/04-candela-o2-revisions.mjs` runs O2 pass by pass the way `tools/candela-o2.mjs` does (`runPipeline` with `start`), without its final check, and records for each pass its time, whether it changed the program, the full revision hash, the functions touched, the contract's evidence counts and the resident memory. I ran it on the snapshot of the base build. It took 12 min 6 s with a 5.79 GB peak, and it showed something the single-pass profile could not: pass times grow fivefold over the run while the work per pass does not.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The second half of the "before" measurements, and the reference for "identical revisions and identical verdicts".
**Inferred user intent:** A before/after for full O2 that also proves nothing changed.
**Commit (code):** none (scripts and measurements).

### What I did
- `IRWB_ROOT=…/scratchpad/baseline/ /usr/bin/time -v node --max-old-space-size=12288 $T/scripts/04-candela-o2-revisions.mjs > $T/various/04-candela-o2-baseline.json 2> $T/various/04-candela-o2-baseline.log` (run in the background, alone among my Candela-scale processes).
- `$T/scripts/06-text-layout.mjs`: where each table starts in r0's revision text (`$T/various/06-text-layout.json`).
- `$T/scripts/05-sha256-bench.mjs`: three SHA-256 implementations on an 18 MB text and on 400 random texts (`$T/various/05-sha256-bench.json`).
- The test gates at the base commit: `npm test`, `node tools/parity.mjs`, `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs`.

### Why
- Evidence equality is part of the acceptance ("identical verdicts"), so the evidence counts per pass are recorded, not only the hashes.

### What worked
- **O2 baseline:** r0 `cd36346ea7c4f175d7db025afe953e89f078902ef1ee44beaf15a7906b140456`, head `b33d1737c725506c7880b8701899d0a0d78f71d6a7b981db89d85d84f48c40d9`, 13 revisions; `Elapsed (wall clock) time 12:06.05`, `Maximum resident set size (kbytes): 5789656`; passes 721,434 ms.
  ```
  pass         ms    rev  fns  check [total, agree, disagree, inconclusive, cx]  rssMB
  cfg        18811   r1   110  [13280,13258,0,22,0]   1360
  fold       21400   r2   103  …                      1825
  simplify   27868   r3    19                         2007
  constprop  37193   r4   124                         2316
  fold       42339   r5    53                         2724
  simplify   10536   -       0  (no change)           3176
  dce        42489   r6   144                         3364
  cfg        45596   r7     3                         3420
  licm       50193   r8     8                         3788
  lvn        54390   r9    38                         3656
  strength   13231   -       0  (no change)           3961
  bce        15184   -       0  (no change)           5279
  subst      75523   r10  160                         5077
  subst      80738   r11  132                         5148
  dce        89577   r12    2                         5282
  cfg        96366   r13    2                         5268
  ```
  Every check: 13,280 cases, 13,258 agree, 0 disagree, 22 inconclusive.
- **Text layout of r0** (`06-text-layout.json`): 18,178,949 characters; `counters` starts at 3.59%, `ops` at 9.60% (40,916 records), `rev` at 46.15%, `values` at 59.32% (37,220 records). The first byte a pass changes is therefore within the first 4%.
- **SHA-256** (`05-sha256-bench.json`): `{"agreed":400,"chars":18000045,"ms":{"portable":469,"fastPortable":179,"nodeCrypto":24},"MBps":{"portable":38,"fastPortable":101,"nodeCrypto":750}}`; all three agree on all 401 texts, including lone surrogates.
- **Gates at `420d8e1`:** `npm test` 325 tests, 322 pass, 3 skipped, 46.4 s (50.8 s wall with the build); parity `{"projects":44,"functions":70,"cases":7000,"decided":6986,"agree":6986,"inconclusive":14,"failures":0}` in 14.9 s; `IRWB_FULL` 21 of 21 in 30.2 s.

### What didn't work
- A heredoc-based shell command (a scratch script written inline) was refused by the worktree guard ("this command is too complex to verify that it stays inside the worktree"). Scripts now go into `$T/scripts/` through the editor and run as plain `node` commands, which is also what the ticket's conventions ask for.

### What I learned
- **Time per pass grows with the run.** `cfg` changed 110 functions at r1 in 18.8 s and 2 functions at r13 in 96.4 s; resident memory grew from 1.4 GB to 5.3 GB. The work per pass is the same whole-program work at every revision, so the growth points to the heap (revisions, analyses and contract executions with 103,618-entry correspondences, all kept alive). This is an inference, to be tested by the after-measurement.
- The 12-minute run is faster than IRWB-001 step 16's 19 minutes (1,129 s for the passes then, 721 s now), on a less loaded machine and without the final check; I compare after-measurements with this run, not with step 16.
- `ops` take 37% of the revision text and almost never change. Records that survive a pass are the common case, by bytes as well as by count.

### What was tricky to build
- Recording evidence per pass: `runPipeline` returns the `PassResult` in `steps[0].result`, and the evidence is in `result.contract.execution.checks[k].evidence`. Reading it there, instead of re-running a check, keeps the measurement identical to what the pipeline did.

### What warrants a second pair of eyes
- The O2 run is the only full-pipeline identity check for Candela; its JSON is the reference the after-runs are diffed against (revisions and `checks` arrays; times are expected to differ).

### What should be done in the future
- Write the guide's design from these numbers.

### Code review instructions
- `node -e` over `$T/various/04-candela-o2-baseline.json` prints the table above; the script is `$T/scripts/04-candela-o2-revisions.mjs`.

### Technical details
- Base-build snapshot for repeatable "before" runs: `/tmp/claude-1000/-home-manuel-code-wesen-2026-11-24--compiler-workbench/6d4ded76-01c1-42ed-bd4c-3f506f14dfc9/scratchpad/baseline/` (dist, tools, vendor, corpus; `IRWB_ROOT` points scripts at it).

## Step 5: The intern guide, its second pass, and its upload

The guide (`$T/design-doc/01-intern-guide-cheap-experiments-in-the-ir-workbench.md`) has three parts: the path a pass takes through the code (artifacts, canonical text and revisions, adapters and projection, the native value and the `Store`, `typedPass` and `applyPass`, analyses, the meaning contract, `Program`, the page and the Candela view), what each step costs on Candela (from Steps 3 and 4 and the earlier diaries), and the design. The design's central decision is that no new identity is introduced: records that a pass did not change stay the same frozen objects, so the caches that already exist start to hit, and the revision's text is assembled from cached pieces instead of being redefined.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Create a detailed analysis / design / implementation guide that is for a new intern … Store in the ticket and then upload to remarkable."
**Inferred user intent:** A document that lets someone new understand and continue this work without the conversation.
**Commit (code):** see the commit after this step.

### What I did
- `docmgr doc add --ticket IRWB-004 --doc-type design-doc --title "Intern guide: cheap experiments in the IR Workbench"`; wrote Parts 1 and 2, then Part 3 (design: A1–A7, F1 with records, parts and closure keys, D1 with a baseline cache and a verdict memo, F4 for Node and the browser, API changes, plan, risks, file map, glossary).
- Second pass, as the reader, with notes before revising:
  - the diagram in §1 pointed diff and correspondence at §6 (analyses) instead of §3 and §5.2: fixed;
  - §2.4 said "the first few percent" without a measurement: measured (`06-text-layout.mjs`) and replaced by "within the first 4%" with the table offsets;
  - §5.2 said "a test checks" the round trip without naming it: now `tests/typed/ingest.test.mjs:49` and `tests/typed/tape.test.mjs:52`;
  - §7.4 attributed "a large part of the 5.8 GB" to executions without a measurement: replaced by the measured RSS series of the O2 run;
  - §9's explanation of the growing pass times was stated as fact: now labelled an inference, to be tested;
  - "Step 3" and "Step 16" were ambiguous between this ticket and IRWB-001: made explicit everywhere.
- `docmgr doc relate` for six key files; `remarquee upload bundle … --name "IRWB-004 Intern Guide: Cheap Experiments" --remote-dir "/ai/2026/11/25/IRWB-004" --toc-depth 2 --non-interactive`.

### Why
- The design is written before the code so that the reviewer can hold the implementation to it, and so that deviations are visible as deviations.

### What worked
- Upload: `OK: uploaded IRWB-004 Intern Guide: Cheap Experiments.pdf -> /ai/2026/11/25/IRWB-004`.
- Verification: `remarquee cloud ls /ai/2026/11/25/IRWB-004 --long --non-interactive` lists `[f]	IRWB-004 Intern Guide: Cheap Experiments`.

### What didn't work
- A first attempt to append Part 3 with a shell heredoc was refused by the worktree guard; I appended it with the editor instead.

### What I learned
- Writing §7.3 (what an outcome depends on) found the one program-wide input of the evaluator: whether any function has frame arrays (`evaluate.ts:356–358`) changes the memory size. A per-function memo that ignored it would be wrong for a pass that removed the last function with frame arrays; the closure key includes it.

### What was tricky to build
- Keeping three kinds of statement apart in one document: what the code does (Part 1, checked against the source), what was measured (Part 2, each number with its file), and what is proposed (Part 3, marked **Proposed**).

### What warrants a second pair of eyes
- §15.2's argument that memoized verdicts reproduce the evidence exactly rests on §7.3's list of what an outcome depends on. If the evaluator ever reads anything else program-wide, the closure key must include it.

### What should be done in the future
- Implement in the order of the guide's §19.

### Code review instructions
- Read the guide's §11 (constraints), §13 (fixes) and §15 (D1) first; they carry the correctness arguments.

### Technical details
- Guide: about 750 lines; diagrams in `text` blocks; API sketches marked **Proposed**.
