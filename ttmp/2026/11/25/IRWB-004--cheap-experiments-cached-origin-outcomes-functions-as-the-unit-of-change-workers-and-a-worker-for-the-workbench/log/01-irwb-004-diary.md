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
RelatedFiles:
    - Path: repo://site-src/engine-worker.js
      Note: Candela engine worker
    - Path: repo://src/typed/evaluate.ts
      Note: meaningKept keys and decide hook; evaluator buffer reuse
    - Path: repo://src/typed/model.ts
      Note: Store.base, toNative record reuse, Store.view
    - Path: repo://src/typed/parallel/node-pool.ts
      Note: worker pool for the meaning check
    - Path: repo://src/typed/parts.ts
      Note: function parts, closure keys, PartsRef
ExternalSources: []
Summary: 'Chronological, step-numbered investigation diary of IRWB-004: measuring where a pass on Candela spends its time, then caching the origin''s outcomes (D1), making functions the unit of change (F1), and moving work onto worker threads in Node and a Web Worker in the browser (F4).'
LastUpdated: 2026-11-25T23:30:00-05:00
WhatFor: Resume point and evidence trail for IRWB-004.
WhenToUse: Read the latest step when resuming; expand earlier steps only as needed.
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

## Step 6: Increment 1, the fixes that keep the definition (A1–A7)

The seven fixes of the guide's §13 are in, each behind the same identity: an empty edit returns its input, a revision is hashed once per frozen value (`revisionOf`), a frozen value is validated once per validator (`validateOnce`), the invariant's cycle key names revisions instead of encoding two programs, correspondence entries are sorted by keys computed once, and SHA-256 streams its input (and uses `node:crypto` in Node). The no-change pass on Candela r0 went from 13.3 s to 4.2 s on a machine at load 9.75, with the same revision. Every corpus revision is identical.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Guide §19, increment 1.
**Inferred user intent:** Remove the work that recomputes known facts, without changing a hash.
**Commit (code):** `9d3ea30` — "IRWB-004 A1-A7: the empty edit is the identity, revisions hashed once per value, …"

### What I did
- `src/framework/core/sha256.ts` (new): `Sha256` (streaming, portable: `TextEncoder.encodeInto` into a 64 KiB buffer, compression on `Int32Array`), `sha256Parts(parts)` (node:crypto through `process.getBuiltinModule('node:crypto')` when present), `sha256Portable`, `sha256Implementation`.
- `src/framework/core/data.ts`: `sha256` delegates to `sha256Parts`; new `revisionOf(kind, schemaVersion, value)` and `validateOnce(validator, value, check?, thisArg?)`; `TEXT` now also keeps texts of canonical objects of 64 characters or more (`RECORD_MIN`).
- `src/framework/ir/adapters.ts`: `createIRArtifact` and `validateIRArtifact` use `revisionOf` and `validateOnce`.
- `src/framework/ir/store.ts`: `#snapshot` uses `revisionOf`; `retain` and `assertHead` compare artifacts by identity before encoding them (`sameText`).
- `src/framework/ir/view.ts`, `diff.ts`: identity before encoding.
- `src/framework/contracts/definitions.ts` `validateArtifact`: `validateOnce`, `revisionOf`, and no `canonical(a)` for an artifact `immutable` built.
- `src/framework/contracts/analysis-manager.ts` `invariantInternal`: the cycle key replaces each IR port's artifact by `{ id, kind, schemaVersion, revision }`.
- `src/framework/ir/correspondence.ts` `validateCorrespondence`: sorts `[key, entry]` pairs by the key computed for the dedup map.
- `src/framework/ir/transactions.ts` `Edit.operationCount`, `src/framework/ir/types.ts` `IREdit.operationCount`; `src/framework/passes/define-pass.ts` `applyPass` returns `{ changed: false, artifact: before }` for an edit with no operations.
- `tests/framework/identity-caches.test.mjs` (new): the original SHA-256 kept in the test as the reference; 300 random texts (alphabet with lone surrogates and astral characters) whole, in random pieces, and through both paths; `revisionOf` against `fingerprint` on 400 random values, plain and frozen; `validateOnce` call counts; the empty edit on Blend returns the input object.

### Why
- Each of these recomputed a fact about a frozen object: its hash, its validity, its encodability, its text. A frozen object cannot change, so the first answer is the answer.

### What worked
- `node --test tests/framework/identity-caches.test.mjs`: 4 of 4.
- Corpus revisions: `diff` against `various/01-corpus-revisions-baseline.txt`, no output (`IDENTICAL-44`).
- `npm test`: 329 tests, 326 pass, 3 skipped (4 new). Parity unchanged (`"agree":6986,"inconclusive":14,"failures":0`). `IRWB_FULL`: 21 of 21 in 15.9 s (30.2 s at the base).
- `various/07-framework-cost-inc1.json` (load average 9.75): `strength` 4,215 ms, revision `cd36346e…` (13,265 ms at the base); `sha256` of the 18 MB text 34 ms (535 MB/s, node:crypto); `cfg` 29,493 ms, revision `4aea7e81…`, check 13,280 / 13,258 / 0 / 22.

### What didn't work
- `cfg` measured slower (29.5 s) than at the base (25.2 s). The same run measured the evaluator at 7.7 s against 3.4 s at the base, on unchanged evaluator code, so the machine (load 9.75, other agents' test runs) explains it; I stopped comparing absolute `cfg` times across runs made at different loads.
- My first `data.ts` edit was a Python heredoc, refused by the worktree guard; I made the edits with the editor.

### What I learned
- After A1, the no-change pass's remainder is the `ranges` analysis (2.4 s under load) and `Store.from` (0.3 s); the framework's share is gone.

### What was tricky to build
- **Pieces of a text and surrogate pairs.** `node:crypto` encodes each `update` separately, so a surrogate pair split between two pieces would hash as two U+FFFD instead of one code point. `sha256Parts` joins the pieces in that case; the portable `Sha256` keeps a trailing high surrogate back until the next piece. The test cuts texts at random positions to exercise both.
- **`validateOnce` and `this`.** An adapter's `validate` is called as a method; a memo keyed on the function identity must not wrap it in a closure, so `validateOnce` takes the owner as `thisArg`.

### What warrants a second pair of eyes
- A1 assumes the projection–rebuild round trip is exact for every adapter that uses `applyPass` with logical edits. For `typed.blocks` it is tested; a lossy adapter would previously have published a spurious revision for a pass that edited nothing, and now reports no change.

### What should be done in the future
- Increment 2 (records keep their identity).

### Code review instructions
- `src/framework/core/data.ts` (`revisionOf`, `validateOnce`), `src/framework/core/sha256.ts`, `src/framework/passes/define-pass.ts` (the `operationCount === 0` branch); `node --test tests/framework/identity-caches.test.mjs`.

### Technical details
- `revisionOf` hashes `['{"kind":' + JSON(kind) + ',"schemaVersion":' + JSON(schemaVersion) + ',"value":', canonical(value), '}']`, which is `canonical({ kind, schemaVersion, value })` in three pieces.

## Step 7: Increment 2, records keep their identity across a pass

`toNative` now gives back the frozen base record wherever the working record still equals it (`sameJson`), so a pass's output shares every record it did not change with its input, and every cache keyed on frozen objects starts to hit. Around that: `Store.from` copies with a plain JSON copy instead of `structuredClone`; `storeOf` shares a frozen value's records instead of copying them (`Store.view`); the adapter's entities and relations are cached per frozen record; graph validation and `diff` skip objects they have seen; and `immutable` and `canonical` are faster with identical output. On Candela, `Store.from` went from 468 to 208 ms and `storeOf` from 403 to 121 ms, and the contract's bookkeeping (key, port validation) dropped out of the profile.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Guide §19, increment 2 (§14.1 and §14.2).
**Inferred user intent:** A pass that changes a few functions should cost about that much.
**Commit (code):** `8e81345` — "IRWB-004 F1 (records): a pass's output shares every record it did not change with its input …"

### What I did
- `src/typed/model.ts`: `copyJson` (replaces `structuredClone`; `__proto__` keys kept as own properties), `sameJson` (equality of canonical text, `0 === -0`), `Store.base` (set by `Store.from` when the input is canonical), `toNative` reusing base records (`keep`) for functions, blocks, statements, values, operations, and for `counters`, `fnOrder`, `frontEnd`; `Store.view(native)`, a read-only store over frozen records.
- `src/typed/ir.ts`: `storeOf` uses `Store.view` for frozen values; `entityIdSet(v)`; `blocksEntities`/`blocksRelations` built from per-record frozen arrays (`RECORD_ENTITIES`, `RECORD_RELATIONS`), generated in id-prefix order before the final sort.
- `src/typed/passes.ts` `revisionCorrespondence`: `entityIdSet` instead of projecting both revisions (two lines).
- `src/framework/ir/adapters.ts` `validateGraph`: `VALID_ENTITIES`, and per captured adapter `VALID_RELATIONS`; graph-wide checks (dangling ends, duplicates, roots) still run every time, in the original order of checks.
- `src/framework/passes/define-pass.ts`: correspondence ids from `view.graph().entities` instead of `view.entities()` (which builds a frozen reference per entity).
- `src/framework/core/data.ts`: `encodeCanonical` for canonical values (no re-checks, keys already sorted unless integer-like); `immutable` assigns properties instead of `defineProperty` (except `__proto__`), and reads array descriptors by index.
- `$T/scripts/07-immutable-bench.mjs`: old (`IRWB_BASE`) against new `immutable` and `canonical` on Candela's value and its ranges result.

### Why
- `structuredClone` and the copy in `toNative` made every record of every revision a new object; every identity cache missed. Copying is still needed at the start (pass bodies mutate records), but the end can give back what did not change.

### What worked
- Tests: `npm test` 326 of 329 pass, 3 skipped (36.3 s); parity unchanged; `IRWB_FULL` 21 of 21 in 5.5 s; corpus revisions `IDENTICAL-44`.
- `various/09-immutable-bench.json` (load 4.75): `immutable` 1,405 → 931 ms on Candela's native value, `canonical` 925 → 615 ms (0 ms when cached), the ranges result 1,283 → 1,035 ms; `sameJson`, `sameText`, `rangesSameJson`, `rangesSameText` all `true`.
- `various/08-framework-cost-inc2.json` (load ~7.4): `Store.from` 208 ms, `storeOf` 121 ms, `strength` 4,567 ms (same revision), `cfg` 19,211 ms (same revision, same evidence 13,280 / 13,258 / 0 / 22).
- Profile `08-inc2-strength-cfg.cpuprofile`, under `verify`: 9.5 s, of which evaluation 7.4 s and `casesFrom` 1.6 s; `fingerprint` and `validatePorts` no longer appear.

### What didn't work
- The no-change pass is still above 4 s. Profile `08-inc2-strength.cpuprofile` (4.0 s under `applyPass`): the `ranges` analysis 3.3 s, of which `immutable` of its result 2.2 s and the solver 0.9 s; `typedPass.run` 0.6 s. The framework's own share is below 0.2 s.

### What I learned
- `storeOf` sharing frozen records broke no test: no consumer (the evaluator, listing, analyses, the backend, the workbench) writes to the store it gets.
- `immutable`'s remaining cost is per object (a descriptor per key, a key sort, a set of ancestors, a freeze), so a result made of many small arrays, like a dataflow result, stays expensive.

### What was tricky to build
- **Which base record to compare with.** A record is compared with the base record of the same id; a removed-and-recreated id with new content is not equal and is copied. `Store.from` sets `base` only for a canonical input, because sharing records of a value that is not deep-frozen would let a later mutation of one reach the other.
- **Error precedence in `validateGraph`.** Relation checks are split into the shape part (cached per relation object) and the graph part (always), and kept in the original order, so an invalid graph reports the same first error as before.

### What warrants a second pair of eyes
- `Store.view` returns frozen records from `get`; a future consumer of `storeOf` that writes to it now throws a `TypeError` instead of silently mutating a cached store.

### What should be done in the future
- D1 next: the contract is now the largest share of a changing pass.

### Code review instructions
- `src/typed/model.ts` (`toNative`, `keep`), `src/typed/ir.ts` (`perRecord`), `src/framework/ir/adapters.ts` (`validateGraph`); `IRWB_BASE=<snapshot>/ node … $T/scripts/07-immutable-bench.mjs`.

### Technical details
- `sameJson(a, b)`: `a === b`, else both arrays of equal length with equal items, or both plain records with the same own key count, every key of `a` own in `b`, and equal values.

## Step 8: D1, function parts and closure keys; the meaning check reuses what cannot have changed

The meaning check now keeps, per origin revision, its cases and the origin's outcome on each, and keeps every decided verdict under the case index and a *closure key*: a hash of the code the case can reach. A later check replays a verdict instead of evaluating the case when the candidate's closure key for that case's function is the one it was decided under. The closure key is built from *function parts*, which F1's shared records make identity-stable: a part is one function's records, and a pass that changes three functions yields 329 parts that are the previous revision's objects. On the corpus, the evidence of every check is identical with reuse on, reuse off, and on the base build.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Guide §15 (D1) and the parts of §14.3 that D1 needs.
**Inferred user intent:** An experiment that changes a few functions should not re-run the origin, or the functions it did not change.
**Commit (code):** `bc5690c` — "IRWB-004 D1 + F4 (contract): function parts and closure keys; …" (together with Steps 9 and 10)

### What I did
- `src/typed/parts.ts` (new): `partsOf(v)` (per frozen value; reuses the previous part object when the function record and every record list are the same objects), `partText`, `partHash` (once per part object), `calleesOf`, `hasFrameArrays`, `closureOf`, `closureKey(v, f)` = SHA-256 of sorted `name:partHash` lines (or `name:missing`) plus `frames:<bool>`.
- `src/framework/contracts/differential.ts`: spec fields `baselineKey`, `subjectKey`, `decide`; a `REUSE` map (at most 4 keys) of `{ cases, outcomes[], verdicts: Map<"i\0subjectKey", Decided> }` keyed by `id@version#seed#count#baselineKey`; `runDifferential` and `runDifferentialAsync` decide each case once per memo key and tally in case order (`tally`); `setDifferentialReuse`, `differentialStats`.
- `src/typed/evaluate.ts` `meaningKept`: `baselineKey: origin kind@schema:revision`, `subjectKey: closureKey(candidate.value, c.fn)`. `casesFrom` and `agrees` are untouched.
- `tests/typed/meaning-memo.test.mjs` (new, 4 tests): parts kept by identity across O2 on `calls`; a callee change changes the caller's key, an unreachable function does not, frame arrays do; reuse gives deep-equal evidence for agreeing candidates (Blend, across-calls) and for `div-to-shift` on wrong-shift (counterexamples in order); the origin's outcome is computed once per case.
- `$T/scripts/08-corpus-evidence.mjs`: each corpus project through O2 as `Program.apply` checks it; prints head revision, summed counts and a SHA-256 of every step's evidence.

### Why
- What a case's outcome depends on, read from `evaluate`: the case, the step limit (in the spec version), the records reachable by calls by name, and whether any function has frame arrays (`STACK_BYTES` above guest memory). `validateBlocks` enforces that a statement's values and blocks belong to its own function, so the part grouping by `fn` is exact.

### What worked
- `node --test tests/typed/meaning-memo.test.mjs`: 4 of 4.
- Corpus evidence: `IRWB_ROOT=<base>/ node …/08-corpus-evidence.mjs` against this build with `IRWB_REUSE=0` and with reuse: `EVIDENCE-IDENTICAL` (44 lines; `various/10-corpus-evidence-baseline.txt`). Run times 34.6 s (base), 4.7 s (no reuse), 4.2 s (reuse).
- Candela O2 with D1 only (`various/11-candela-o2-d1.{json,log}`, load 8.9): wall 12:06 → 6:10, peak RSS 5.79 → 3.03 GB, every revision and every check identical to `04-candela-o2-baseline.json`.

### What didn't work
- The first parts test used `cfg` on across-calls, which does not change that program (A1 returned r0 itself), so `assert.notEqual(revision)` failed with both revisions `811ef589…`. A survey over the corpus (scratch script) showed `calls` (3 functions, O2 changes 1) and found no part that was a new object with equal content.

### What I learned
- The baseline outcome cache stores each case's `RunResult` with its memory image; for Candela that is about 13,280 images of a few KiB.

### What was tricky to build
- **Evidence in case order.** Verdicts can come from the memo, from this thread or from workers; `tally` walks the cases in order, so counts and the first five counterexamples are those of the unmemoized loop.

### What warrants a second pair of eyes
- The soundness of `subjectKey` rests on the evaluator's dependencies listed above. A future evaluator that reads something else of the program (the front end's tables, counters) must add it to `closureKey`.

### What should be done in the future
- F4 for the cases that are still evaluated (Step 9).

### Code review instructions
- `src/typed/parts.ts`, `src/framework/contracts/differential.ts` (`prepare`, `memoKeys`, `runDifferential`), the two lines in `meaningKept`; `node --test tests/typed/meaning-memo.test.mjs`; `node …/08-corpus-evidence.mjs`.

### Technical details
- Memo key: `${index}\0${closureKey}` under `typed.meaning-kept@1+<params hash>#7#40#typed.blocks@<schema>:<origin revision>`.

## Step 9: F4 in Node, a worker pool for the contract; the evaluator's memory made the main thread three times slower

The meaning check can hand its undecided cases to a `decide` hook; `src/typed/parallel/node-pool.ts` implements it with worker threads that hold programs as parts and decide each case with the same `decideCase` and the same specification. Measuring it showed that one worker decided the 13,280 cases of Candela's cfg check in 17.9 s while the main thread took 46.7 s. The profile put 18.2 of the main thread's 38.9 s in the garbage collector: every evaluation allocated a fresh 66 KiB working memory (the case memory plus `STACK_BYTES`), and that external memory made V8 mark the main thread's 464 MB heap about once a second. Reusing one buffer for the stack-area memory cut the local check to 11.0 s; the identical evidence held throughout.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Guide §16 (F4, Node), and the measurement the brief asks for (speed-up and identical verdicts).
**Inferred user intent:** Use the machine's cores for the contract without trusting the parallel path more than the serial one.
**Commit (code):** `bc5690c`

### What I did
- `src/framework/contracts/differential.ts`: `decideCase` exported (the one function that runs both sides, then `inconclusive`, then `compare`); `differentialSpec(inv)` (a WeakMap from the invariant to its spec, so the invariant object keeps its shape); `runDifferentialAsync`; `check` returns a promise when the spec has `decide`.
- `src/typed/meaning-exec.ts` (new): `setMeaningExecutor`, `meaningExecutor`, `MeaningJob`. `meaningKept` passes `decide: (ports, cases, todo) => meaningExecutor()?.decide({ params, origin, candidate, cases, todo })`.
- `src/typed/parallel/protocol.ts`, `meaning-worker.ts`, `node-pool.ts` (new): case i to worker i mod N (so each worker computes the origin's outcome of its cases once); jobs carry only missing part texts and cases; `minCases` (64) keeps small jobs local; workers `unref` when idle; first-in-first-out case sets on both sides (`CASE_SETS_MAX` 8).
- `src/typed/evaluate.ts` `evaluate`: with frame arrays, the working memory is a zeroed prefix of one reused `SCRATCH` buffer (the result still gets `bytes.slice(0, memBytes.length)`); a call's locals are a zeroed `subarray` of one reused `LOCALS` Int32Array. `DataView` over exactly the prefix.
- `tests/typed/parallel.test.mjs` (new, 2 tests): workers (3 threads, `minCases: 1`) give deep-equal evidence for Blend, across-calls and strength through O2 and for the wrong pass, with reuse on and off, two rounds each; small jobs stay local.
- `$T/scripts/09-candela-contract.mjs`: the check alone (r0 against its cfg revision), local and on 1, 2, 4 threads, cold and warm; `--local-only` for a profile. `04-candela-o2-revisions.mjs` gained `--threads N` and `--no-reuse`. `03-profile-summary.mjs` gained `--window NAME`.

### Why
- Evaluating cases is the contract's whole cost once D1 removed the repeated work, and cases are independent.

### What worked
- `various/13-candela-contract-threads.json` (before the evaluator fix, load 12.6–15.3): local 46,661 ms; 1 thread 23,489 cold / 17,852 warm; 2 threads 17,032 / 10,629; 4 threads 16,889 / 8,347; all `same: true`, counts 13,280 / 13,258 / 0 / 22.
- `various/14-contract-gc.txt`: `--trace-gc` counts for the local check: 99 scavenges and 35 mark-compacts (34,772 ms) → with `LOCALS` only 97 / 34 (37,330 ms) → with `SCRATCH` 105 / 5 (10,959 ms).
- `various/17-candela-contract-threads-inc3.json` (after the fix, load 10.3): local 9,058 ms; 4 threads warm 4,637 ms (1.95×), cold 10,766 ms; 2 threads warm 7,849; reuse warm (same candidate) 21 ms; all identical.
- Gates: `npm test` 335 tests, 332 pass, 3 skipped (79.4 s on a loaded machine); corpus revisions `IDENTICAL-44`; corpus evidence `EVIDENCE-IDENTICAL`; parity unchanged; `IRWB_FULL` 21 of 21 (12.6 s).

### What didn't work
- Importing `CASE_SETS_MAX` from `meaning-worker.js` into the pool would run the worker's top level on the main thread (`parentPort` is null there); the shared types and constant moved to `protocol.ts` before the first run.
- The `LOCALS` change alone did nothing measurable (34 mark-compacts instead of 35); the trigger was the 64 KiB stack area, not the locals. I kept it, since it removes an allocation per call and the evidence is identical.

### What I learned
- One worker beat the main thread by 2.6× on the same code because the main thread's heap was large and the evaluator's ArrayBuffers forced full markings of it. After the fix the main thread is as fast per case as a worker, and the pool's gain is what the cores give (1.95× on 4 threads at load 10).
- A cold pool pays for shipping 442 part texts and assembling two programs in each worker: 10.8 s cold against 4.6 s warm.

### What was tricky to build
- **The same decision in two realms.** The worker obtains the specification by calling `meaningKept(params)` itself and `differentialSpec` on the result, and decides with the exported `decideCase`; no comparison logic is duplicated.
- **A reused buffer and the bounds check.** `check(addr, w)` compares against `bytes.length`, so the working memory must be a view of exactly `size` bytes, and the `DataView` must not extend past it.

### What warrants a second pair of eyes
- `evaluate` now shares `LOCALS` and `SCRATCH` per realm; it is synchronous and never re-entered, but a future host call from inside the evaluator would break that assumption.
- Workers report errors as messages; an evaluator `Error` (not a `Trap`) on a worker becomes an `Error` with the worker's stack in its message, not the original object.

### What should be done in the future
- A pool that keeps part texts per revision would avoid recomputing which parts each worker lacks; cheap already (a set lookup per part).

### Code review instructions
- `src/typed/parallel/*.ts`, `decideCase` and `runDifferentialAsync` in `differential.ts`, the two buffers in `evaluate`; `node --test tests/typed/parallel.test.mjs`; `node --max-old-space-size=12288 $T/scripts/09-candela-contract.mjs`.

## Step 10: Candela O2 before and after, on the calling thread and on four workers

With increments 1–3, O2 on Candela takes 3:27 instead of 12:06, with every revision and every check's counts identical. On four worker threads it took 3:42: on a machine at load 11–15 the workers did not get the cores, and each revision's parts and program assembly cost each worker time the calling thread does not spend.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The acceptance item "before and after times for cfg, full O2 on Candela".
**Inferred user intent:** Numbers measured on the same script, with the revisions diffed.
**Commit (code):** `bc821fa` (the measurement files)

### What I did
- `/usr/bin/time -v node --max-old-space-size=12288 $T/scripts/04-candela-o2-revisions.mjs` → `various/15-candela-o2-inc3.{json,log}`; then with `--threads 4` → `16-…`. Compared step by step with `04-candela-o2-baseline.json`.

### What worked
- Revisions: r0 `cd36346e…`, head `b33d1737…` in all three runs; every step's revision and `checks` equal (`same same` for all 16 steps).
- Wall time 12:06.05 → 3:26.58 (local) and 3:42.26 (4 threads); passes 721,434 → 187,556 and 205,336 ms; peak RSS 5,789,656 → 4,700,036 kB and 6,939,668 kB.
- Per step (base / local / 4 threads, ms): cfg 18,811 / 19,763 / 28,900; fold 21,400 / 12,731 / 17,461; simplify 27,868 / 9,806 / 13,291; constprop 37,193 / 14,071 / 19,985; fold 42,339 / 9,927 / 12,221; simplify 10,536 / 706 / 978; dce 42,489 / 15,555 / 20,515; cfg 45,596 / 8,984 / 9,959; licm 50,193 / 8,756 / 11,910; lvn 54,390 / 9,135 / 13,254; strength 13,231 / 5,573 / 5,712; bce 15,184 / 3,262 / 3,737; subst 75,523 / 12,421 / 14,149; subst 80,738 / 13,020 / 13,545; dce 89,577 / 21,567 / 10,332; cfg 96,366 / 22,279 / 9,387.
- `differentialStats` over the local run: 13,280 origin runs, 64,040 subject runs, 108,600 replayed verdicts (of 172,640 decided cases, 63% replayed). The pool run delegated the same 64,040.

### What didn't work
- Four threads were slower overall. The first cfg (28.9 s against 19.8 s) pays the cold start; later steps are within noise of the local run except the last dce and cfg, where the workers were faster (10.3 / 9.4 s against 21.6 / 22.3 s).

### What I learned
- Base times grew with the revision number (18.8 s to 96.4 s) because the base copied and re-hashed everything and RSS grew to 5.3 GB; the new times stay between 0.7 and 22 s.

### What should be done in the future
- Use the pool by default only where cores are free; the tools take `--threads`.

## Step 11: F4 in the browser, the Candela view's engines in a Web Worker

The Candela view now renders on a Web Worker: compiling the reference image, lifting r0, the sky table and every engine call run there, and the page only draws. A stride-1 render of B-01 holds the page for at most 96 ms (evaluator) and 116 ms (emulator), against 3.5 s for the emulator in the page; worker frames are bit-identical to the page's (0 of 307,200 floats and 0 of 102,400 colour sums differ). Two things were not the engines: the page stalled 0.6–3.5 s inside `CanvasRenderingContext2D::FinalizeFrame` waiting on the GPU process, fixed with a CPU-backed canvas, and the portable SHA-256 ran at 7 MB/s in Chromium.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Guide §16.4: a worker for rendering, opening Candela and passes, within the page's CSP and SRI rules; frames identical.
**Inferred user intent:** The workbench stays usable while Candela works.
**Commit (code):** `bc821fa` — "IRWB-004 F4 (browser): the Candela view's engines run in a Web Worker …"

### What I did
- `site-src/engine-worker.js` (new): messages `init` (Candela data from the page), `render` (engine `kernel | stock | r0 | head | own`; a project revision as a `PartsRef` plus missing part texts; progress about every 100 ms), `stop`, `lift`. A rebuilt revision must hash to the revision the page named, or the worker refuses it.
- `tools/build-site.mjs`: `candela/engine-worker.js` = the seven vendored scripts (each checked against `VENDOR.json`) followed by the esbuild bundle; `LAZY.candela.worker` with its SHA-384 for the record.
- `site-src/index.html` CSP: `worker-src 'self'`. `tools/serve-site.mjs`: the same policy as a `content-security-policy` header on every response, so the worker (which does not see the meta tag) runs under it.
- `site-src/candela.js`: the worker client; `UI.S.cdl.where = 'page'` renders in the page as before; history entries carry `where`, and frames are compared across engines or across `where`; Stop reaches the worker. Canvas context `getContext('2d', { willReadFrequently: true })`.
- `src/typed/parts.ts`: `PartsRef`, `partsRef`, `parsePart`, `assembleParts`, `missingParts` (the meaning worker uses them too). `site-src/wb.js` exports the part helpers.
- `src/framework/core/sha256.ts` `Sha256.update`: encodes a window of at most `(room)/3` UTF-16 units (a surrogate pair kept together), not `text.slice(pos)`.

### Why
- A worker script cannot carry an `integrity` attribute and `connect-src 'none'` rules out fetching bytes to check, so the worker loads nothing: everything it runs is in one same-origin file, assembled and checked at build time, like `app.js`.

### What worked
- Playwright, `dist/site` on 127.0.0.1:8772 (`various/19-browser-render.json`, screenshot `18-browser-worker-render-B01-stride1.png`): r0 stride 8 in the worker 3,273 ms, longest page gap 25 ms; the page's r0 frame 0 / 4,800 different from it; kernel stride 1 in the worker 35.6 s, longest gap 116 ms; r0 stride 1 in the worker 65.7 s, longest gap 96 ms, 0 / 307,200 (acc 0 / 102,400) against kernel; kernel stride 1 in the page 33.6 s, longest gap 3,460 ms (86 gaps over 100 ms), identical to both worker frames. Console: 0 errors, 0 warnings.
- SHA-256 portable on 18 MB in Node after the fix: 330–392 ms, the same digest as node:crypto; `tests/framework/identity-caches.test.mjs` 4 of 4.

### What didn't work
- The first worker renders still showed a 3.2–3.6 s gap on the page while the page's JS profile was idle. A CDP trace showed `CrRendererMain CanvasRenderingContext2D::FinalizeFrame` → "GPU backpressure via GL_COMMANDS_COMPLETED_CHROMIUM" (581 ms in the traced run) and `CrGpuMain` tasks of 991 ms: headless Chromium's software GPU under load. After the canvas change: 25 ms.
- `PerformanceObserver('longtask')` reported the same gaps as long tasks; a 10 ms `setInterval` heartbeat was the measure I could trust.

### What I learned
- Opening Candela in the page still takes 8.6 s (profiled) after the hashing fix: `immutable` 2.2 s, the eager projection in `createIRArtifact` 3.0 s (per-record entities and relations 1.5 s, `validateGraph` 0.8 s), both hashes 1.1 s, `canonical` 0.5 s, GC 1.9 s (`various/20-browser-open-and-pass.json`). cfg in the page: 21.3 s (about 45 s before), one task.

### What warrants a second pair of eyes
- The worker bundle includes the reference compiler; its SHA-384 is recorded in `LAZY` but no browser checks a worker script's integrity.

### What should be done in the future
- Open and passes in the worker need the page to adopt a revision in slices (parts, tables, canonical text, hashing, validation and projection, each under 100 ms). Not done; see the final report.

### Code review instructions
- `site-src/engine-worker.js`, the worker section of `site-src/candela.js`, the worker block in `tools/build-site.mjs`; `npm run build:site && node tools/serve-site.mjs dist/site 8772`, Candela layout, Render with the default (worker) and with `wbUI.S.cdl.where = 'page'`.

## Step 12: The job pool, and the remaining acceptance measurements

A small pool for independent runs completes F4 in Node. The remaining acceptance numbers were then measured, each against the base build where the machine's load made earlier numbers incomparable:
- cfg on r0 takes 13.6 s against 41–51 s for the base build, measured alternately with it.
- A per-scene run takes 119 s against 312 s, back to back.
- The no-change pass takes 4.3 s cold and 0.66 s once its analysis is solved.

Every gate is green on the final code.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task 3bga (job pool, one per-scene run before and after) and aa2m (acceptance measurements).
**Inferred user intent:** Numbers that can be compared, and a statement of what was not reached.
**Commit (code):** `7324ded` — "IRWB-004 F4 (jobs): a worker-thread pool for independent runs …"

### What I did
- `src/typed/parallel/job-pool.ts` (new): `startJobPool(module, exportName, { threads, maxOldSpaceMB })`. It is an eval'd CommonJS worker that imports the module once. Each job goes to the first idle worker, and results come back in call order.
- `$T/scripts/11-corpus-job.mjs` (one project through O2 as a job), `12-corpus-evidence-pool.mjs` (the corpus through the pool).
- `$T/scripts/10-candela-per-scene.mjs`: a copy of IRWB-001's `12-candela-per-scene.mjs` that honours `IRWB_ROOT`, so one scene runs on both builds. Run R-01 on this build, then on `<scratchpad>/baseline/`.
- `02-framework-cost.mjs --passes strength --repeat 2` with a CPU profile; `02-framework-cost.mjs --passes cfg` alternating base, new, base, new (`various/24-cfg-back-to-back.txt`).
- `$T/scripts/13-figures.py`: the two figures for the report.

### What worked
- Per-scene R-01 (`various/21-per-scene-R01-*.json`, `23-final-measurements.txt`):

  | step | this build (ms) | base build (ms) |
  |---|---|---|
  | specialize | 14,071 | 71,254 |
  | constprop | 13,188 | 51,811 |
  | fold | 10,520 | 35,454 |
  | cfg | 9,536 | 34,267 |
  | dce | 7,527 | 36,199 |
  | cfg (no change) | 411 | 24,377 |
  | dfe | 9,090 | 25,879 |
  | **total** | **118,870** | **312,243** |

  The loads were 9.4–11.3 and 11.3–8.7. Both runs went from 332 to 137 functions and from 12,358 to 5,400 statements, the frame records are identical, and `differentBits` is 0.
- cfg alternated: base 51,177 ms (load 13.4), new 13,565 (10.5), base 40,736 (9.9), new 13,555 (8.5). The revision was `4aea7e81dd04` and the check 13,280 / 13,258 / 0 / 22 in all four runs.
- No-change `strength`: 4,295 ms, then 655 ms. Both returned revision `cd36346ea7c4f175…` with `changed: false`.
- Job pool, the corpus through O2: 2,709 ms on one thread without the pool, 2,822 ms with a 1-thread pool, 2,267 ms with a 4-thread pool. All three outputs equal `10-corpus-evidence-baseline.txt`.
- Final gates:
  - `npm test`: 335 tests, 332 pass, 0 fail, 3 skipped.
  - Parity: `{"projects":44,"functions":70,"cases":7000,"decided":6986,"agree":6986,"inconclusive":14,"failures":0}`.
  - `IRWB_FULL`: 21 of 21, 11.2 s.
  - Corpus revisions: `IDENTICAL-44`.

### What didn't work
- The no-change pass is not under 1 s the first time. The profile (`profiles/22-final-strength.cpuprofile`, 3,508 ms under `applyPass`) splits it as follows:
  - the `ranges` analysis solved for the first time, 2,362 ms: `immutable` of its result 1,510 ms, the solver 699 ms;
  - `typedPass.run`, 876 ms, of which `Store.from` is 368 ms;
  - `beginEdit`, 211 ms.

  The framework's per-revision steps do not run.
- The job pool gains little on the corpus (2.3 s against 2.7 s): each worker imports the compiler and the vendored front end itself. Candela-scale jobs in parallel were not run, because the machine allowed one Candela-scale process at a time.

### What I learned
- On this machine, comparisons across runs made minutes apart differ by 2–3× (the base build's cfg was 18.6 s in Step 3 and 51.2 s here). Only alternated or back-to-back runs are evidence.

### What should be done in the future
- Per-function analysis results keyed by part, so that a first analysis after a small change re-solves only the changed functions.

## Step 13: The vault report

The report is written in the vault, with three figures in `_assets/` under the `irwb004-` prefix. I reread it against this diary and corrected it in four places. The vault is not committed, as the brief asks.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** A deep-dive report in textbook style, no analogies, frontmatter as the 2026/11/24 reports; checked against the diary.
**Commit (code):** this step's commit (diary and figures script only).

### What I did
- `/home/manuel/code/wesen/go-go-golems/go-go-parc/Projects/2026/11/25/PROJECT REPORT - IR Workbench - Cheap Experiments - Shared Records, Replayed Verdicts, Worker Threads and an Engine Worker, With Every Revision Unchanged - A Technical Deep Dive.md`.
- Figures: `irwb004-o2-per-pass.png` and `irwb004-contract-threads.png` (from `13-figures.py`), and `irwb004-browser-worker-render.png` (the screenshot `18-…`).

### What didn't work
- My first draft of section 1 credited the base cfg's time to copying records ("several seconds"). Step 3's profile says `Store.from` took 0.33 s and `toNative` 0.32 s, so section 1 now gives the profile's figures.
- The draft's intro said a no-change pass took 18 s. That is IRWB-001's figure; this milestone measured 13.3–15.9 s, and the intro now says 13 to 18 s.
- The draft said "D1 alone" for the 6:10 O2 run. That run had A1–A7, F1 and D1 in place, so the text now says that.
- The draft said Candela's "evidence" was identical. On Candela the comparison covered revisions and check counts, not the full evidence records (the full evidence was compared on the corpus), and the text now says that.
