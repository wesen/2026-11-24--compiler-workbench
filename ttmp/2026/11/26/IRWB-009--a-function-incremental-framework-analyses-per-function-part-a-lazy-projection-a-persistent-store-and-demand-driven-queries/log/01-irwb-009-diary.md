---
Title: IRWB-009 diary
Ticket: IRWB-009
Status: active
Topics:
    - compiler
    - ir
    - performance
    - workbench
DocType: log
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/core/runtime.ts
      Note: the task runtime (Compiler, CompilationRun) the query engine would build on
    - Path: repo://src/framework/dataflow/analysis.ts
      Note: solveArtifact, where an analysis is solved and frozen for the whole program
    - Path: repo://src/framework/ir/adapters.ts
      Note: createIRArtifact and its eager projection
    - Path: repo://src/typed/parts.ts
      Note: function parts and closure keys, the identities the design keys on
ExternalSources: []
Summary: 'Chronological investigation diary of the IRWB-009 intern guide: reading the system, grounding measurements on Candela (analyses per function, projection pieces, edit sizes across O2, source edits), the guide, its second pass and its upload.'
LastUpdated: 2026-11-26T10:00:00-05:00
WhatFor: Evidence trail for the IRWB-009 guide's numbers and decisions.
WhenToUse: Read the latest step when resuming; expand earlier steps only as needed.
---

# IRWB-009 diary

Steps are chronological, oldest first. Paths are relative to the repository root unless they start with `/`. `$T` stands for this ticket's directory, `ttmp/2026/11/26/IRWB-009--a-function-incremental-framework-analyses-per-function-part-a-lazy-projection-a-persistent-store-and-demand-driven-queries`. Every Candela-scale process below ran under the memory cap of IRWB-001 diary step 32 (`systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 …`), one at a time; two other agents were running Candela jobs on the same machine.

## Step 1: Reading the system, the merged IRWB-004 work and the code the design touches

This ticket is a writing and analysis task: an intern guide for a function-incremental framework, grounded in small measurements, uploaded to reMarkable. Nothing under `src/`, `tests/` or `tools/` is changed. Before measuring, I read the system's explanation, the milestone that made records and verdicts reusable per function, and every file the design would touch. The reading established two facts the brief did not state: the framework's task runtime already implements early cutoff on revisions, and every one of the six Typed analyses is strictly intraprocedural, so "analyses per function part" needs no summaries to be correct today.

### Prompt Context

**User prompt (verbatim):** "For each, Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

The coordinator's brief for IRWB-009 adds the approved direction (analyses keyed by function part; a lazy projection; a persistent content-addressed store; demand-driven queries with early cutoff on the task runtime), the hard requirement that revision hashes stay identical, the research framing ("cost per edit independent of program size" as a measured invariant), the measurements to ground the guide, the upload command, and the rule to stop after the upload. Two later coordinator messages first added and then withdrew a vault report: **the vault report is deferred to the implementation milestone**, and no vault file was created.

**Assistant interpretation:** Read the system and IRWB-004, measure just enough on Candela to ground the design, write the guide with docmgr, add tasks for its phases, upload it, commit ticket files only, and stop.

**Inferred user intent:** A new person should be able to pick up the function-incremental framework from this guide alone, and the design's claims should rest on numbers from this machine and this code.

**Commit (code):** none; the worktree is at `a4beda6`.

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`, and read the writing-style and investigation-entry references.
- Read IRWB-002's guide Part 1 (§1–§17) and Part 2's C3, D1, F1–F4, J4, and §22's risk "Hash stability under F1".
- Read IRWB-004's guide in full, its diary steps 1–13, `tasks.md` (open: `rodj` per-function validation, `i5cw` open and passes in the worker), `changelog.md`, and `various/{20-browser-open-and-pass.json,22-framework-cost-final-strength.json,23-final-measurements.txt}`.
- Read IRWB-001 `log/02-implementation-diary.md` step 12 (the first caches) and steps 30–33.
- Read the code: `src/framework/core/{data,types,runtime,sha256}.ts`; `src/framework/ir/{adapters,store,view,diff,correspondence,transactions,types}.ts`; `src/framework/passes/define-pass.ts`; `src/framework/contracts/{differential,analysis-manager,definitions,types}.ts`; `src/framework/dataflow/analysis.ts`; `src/typed/{parts,meaning-exec,ir,model,analyses,passes,program,project,lift}.ts`; `src/typed/parallel/*`; `site-src/engine-worker.js`.
- `grep -rn "new Compiler(\|CompilationRun" src tests tools site-src`: only `src/framework/core/runtime.ts`, `src/conformance/01-runtime.ts`, `src/labs/lab.ts` and four framework tests. `grep -rn IRStore … | grep -v src/framework/ir/`: only `bridge.ts`'s optional option, a conformance program and three framework tests.
- `npm run build` (7.1 s) to produce `dist/`, which the scripts import; `dist/` is ignored by git.

### Why
- The design changes where work happens, not what it computes. That is only possible if I know what every whole-program step reads, which only the code says.

### What worked
- The reading gave the map the guide's Part 1 follows: artifact → `createIRArtifact` (freeze, validate, two hashes, eager projection) → `applyPass` (needs, `typedPass.run`, artifact, diff, correspondence, contract, preservation) → `AnalysisManager` → `runDifferential` with IRWB-004's memo.

### What didn't work
- No failures in this step.

### What I learned
- **The task runtime already has early cutoff.** `CompilationRun.execute` (`runtime.ts:674–797`) reuses a cache entry only after re-resolving each recorded task dependency and comparing its revision with the recorded fingerprint (`runtime.ts:741`). A dependency that re-executes and produces the same revision leaves its dependents reused. That is the early-cutoff rule of query-based compilers, implemented, and unused by the Typed compiler.
- **Its cache does not scale as written.** `_candidates(taskId)` filters every cache entry on each lookup and `_store` finds the least recently used entry by a linear scan (`runtime.ts:308–330`); the default capacity is 2,048 entries. A query per function per pass on Candela is 332 × 16 = 5,312 tasks for one O2 run.
- **`IRStore` is a per-view throwaway for the Typed compiler.** `openIR(artifact, adapter, store = new IRStore())` (`view.ts:331`) and no Typed caller passes a store, so each view retains exactly one revision in a store that dies with it. It is a compare-and-swap revision lineage, not a cache.
- **All six analyses are intraprocedural.** A call's range is the full interval (`evalRange` has no `call` case; `analyses.ts:382–414`), `reaching` and `liveness` are per region, and `regions` makes one region per function (`analyses.ts:257`). Item C3's summaries do not exist.
- **Typed passes all have version `'1'`** (`typedPass`, `passes.ts:175–177`). A persistent store keyed by pass id and version would serve stale results after a code change; the store needs a code fingerprint.
- **`Program.fromArtifact` and `createIRArtifactAsync` do not exist.** IRWB-004 proposed them (§16.6, §16.7); task `i5cw` is open.

### What was tricky to build
- Nothing was built. The care needed was in separating what IRWB-004 built (D1, records keep identity, parts, closure keys, pools, engine worker for renders) from what it only proposed (per-function validation, the async artifact, open and apply in the worker).

### What warrants a second pair of eyes
- My reading that the evaluator never reads `ops` records or `origin` fields rests on `evaluate.ts` reading only `st.get` of statements, values and blocks and `st.fn`; IRWB-004 step 8 made the same argument for closure keys. A design that excludes `ops` from an analysis key must test it, not only argue it.

### What should be done in the future
- Measure (Step 2 onward).

### Code review instructions
- Start with `src/framework/core/runtime.ts:447–870` (`resolve`, `execute`) and `src/framework/dataflow/analysis.ts:122–152` (`solveArtifact`).

### Technical details
- Layering rule: `tests/framework/layering.test.mjs`; nothing under `src/framework` imports outside it.

## Step 2: How analyses and the projection split by function on Candela r0

Two scripts measure what the design would split. `01-analyses-per-function.mjs` builds r0's call graph and times the `ranges`, `reaching` and `liveness` solves region by region, then applies `cfg` (110 functions) and compares results function by function. `02-projection-pieces.mjs` times `createIRArtifact`'s pieces on an all-new value and on a value that shares every record, builds the projection per part, and diffs r0 against r1 both whole and over the changed parts only. The headline: one function, `tracePath`, is 66% of the `ranges` solve and 55% of its result; the median function solves in 0.16 ms; every unchanged function's result is identical after `cfg`; and the per-part diff finds exactly the whole diff's changes.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The brief's first two grounding measurements.
**Inferred user intent:** The design's split should follow where the time actually is.
**Commit (code):** none (scripts and measurements only).

### What I did
- `systemd-run … node --max-old-space-size=10240 $T/scripts/01-analyses-per-function.mjs > $T/various/01-analyses-per-function.json` (load 4.8; wall 31.9 s; max RSS 1.69 GB).
- First run of `02-projection-pieces.mjs` failed (below); fixed and rerun (load 4.9; wall 27.1 s; max RSS 1.57 GB) → `$T/various/02-projection-pieces.json`.

### Why
- The brief asks how the analyses split by function and what crosses a function boundary, and what the projection costs by piece.

### What worked
- **Call graph of r0** (`01-…json`, `callGraph`): 332 functions, 918 call values, 668 distinct call edges, 122 leaves, 21 functions nobody calls, **no recursion** (no strongly connected component of more than one function, no self-call). A function's call closure: median 3 functions, 90th percentile 13, maximum 310 (`cdlRenderSpan`). Its transitive callers: median 10, 90th percentile 16, maximum 104 (`q_floor`; then `lobeNone` 93, `fresnelDielectric` 78, `q_sin` 60).
- **Per-region solves** (`analyses`):

  | analysis | solve, sum of regions | median region | largest region | freeze whole result | result text | `manager.analyse`, cold |
  |---|---:|---:|---|---:|---:|---:|
  | ranges | 1,055.6 ms | 0.16 ms | `tracePath` 700.8 ms, 6,453,309 chars | 1,213.6 ms | 11,753,185 chars | 2,879.6 ms |
  | reaching | 971.3 ms | 0.12 ms | `tracePath` 520.1 ms, 6,913,986 chars | 265.9 ms | 10,714,353 chars | 1,498.0 ms |
  | liveness | 63.1 ms | 0.07 ms | `tracePath` 13.7 ms, 108,484 chars | 39.6 ms | 328,971 chars | 129.8 ms |

  `tracePath` has 252 of the 2,409 blocks. Freezing each region on its own costs about what freezing the whole does (ranges 1,430 ms against 1,214 ms), so splitting saves nothing on a cold solve; it saves the regions that did not change.
- **Independence** (`independence`): `cfg` without a contract (6,842 ms) gives r1 `4aea7e81dd04…` (the revision IRWB-004 recorded), with 110 functions touched and 222 parts that are the same objects as r0's. For all three analyses: 222 of 222 unchanged parts have canonically equal results; 110 of 110 changed parts have different ones.
- **Projection pieces** (`02-…json`), Node, ms:

  | piece | cold (all records new) | warm (all records shared) |
  |---|---:|---:|
  | `immutable` | 1,306.8 | 0.1 |
  | content hash (text + SHA-256) | 878.1 | 287.5 |
  | revision hash (text cached) | 26.5 | 31.6 |
  | `validateBlocks` | 240.9 | 124.2 |
  | entities (`blocksEntities`) | 826.4 | 80.8 |
  | relations (`blocksRelations`) | 1,220.4 | 100.4 |
  | `validateGraph` (incl. two sorts) | 607.5 | 325.3 |
  | of which sorting 132,054 relations, alone | 29.9 | 23.6 |
  | resolve check (103,618 entities) | 222.7 | 216.8 |
  | **`createIRArtifact`, whole** | **6,388.6** | **1,045.8** |

- **Per part, cold:** 2,113.8 ms for all 332 parts' entities and relations, each sorted within its part (median part 2.5 ms; `tracePath` 177.5 ms, `cdlInit` 112.3 ms).
- **Delta r0 → r1:** whole diff 419.4 ms, 882 entities and 3,737 relations changed; `makeCorrespondence` 5,212.2 ms for 103,618 entries of which 882 are not `retained`; the diff over the 110 changed parts alone finds the same 882 and 3,737 in 721.9 ms (it builds those parts' projections, cold for r1's new records); `entityIdSet` of both revisions 245.4 ms.

### What didn't work
- First run of `02-projection-pieces.mjs`: `TypeError: Cannot read properties of undefined (reading 'pow2i')` at `dist/typed/passes.js:46` (`view`), called from `PASSES.cfg.run`. The `cfg` pass reads the `cfg` analysis, and I called `run` with empty `facts`. Fixed by computing each of `PASSES.cfg.needs` with an `AnalysisManager` first.

### What I learned
- **The work per function is very uneven.** The cost of an edit to `tracePath` alone is most of a whole-program analysis. "Cost per edit independent of program size" therefore has to be stated per changed function's size, not per edit count.
- **The relation sort is not the projection's cost in Node.** Sorting 132,054 relations takes 24–30 ms; building entities and relations (2.0 s cold) and `validateGraph`'s per-element checks are the cost. In Chromium IRWB-004 measured `project` 3.0 s at open, `perRecord` 1.5 s and `validateGraph` 0.8 s (`various/20-browser-open-and-pass.json`).
- **`makeCorrespondence` is the largest single piece of a changing pass's framework work** in this run (5.2 s for 882 non-trivial entries); IRWB-004's profile gave 1.8 s for it under `applyPass`. One sample on a shared machine; the order of magnitude is what matters: it is proportional to the program.
- **A dense fact format.** `ranges` stores an interval per local at the entry and exit of every block, so `tracePath`'s result is 6.5 MB. A persistent store's size is dominated by such results.

### What was tricky to build
- **Cold against warm.** IRWB-004's per-record caches (`RECORD_ENTITIES`, `TEXT`, `VALID_ENTITIES`) are keyed on frozen records, so a second measurement on the same value is warm. The script makes three independent all-new values with `st.toNative()` for the cold pieces, and a new top-level object over r0's records (`immutable({ ...r0.value, rev: rev + 1 })`) for the warm ones.

### What warrants a second pair of eyes
- The per-part diff builds part projections through a minimal value (`{ fns, blocks, stmts, values, ops }` of one function) passed to `blocksEntities`/`blocksRelations`; it relies on those functions reading only these tables. The equal change counts (882 and 3,737) support it.

### What should be done in the future
- Edit sizes across O2 (Step 3), source edits (Step 4).

### Code review instructions
- `node …/01-analyses-per-function.mjs` and `…/02-projection-pieces.mjs` under the cap; outputs in `$T/various/01-*`, `02-*`.

### Technical details
- `01` replicates `solveArtifact` (`dataflow/analysis.ts:122`) region by region with the spec's own `regions`, `boundary`, `transfer`, `edge`, `widen` and `strategy`, so the per-region times add up to the same work.

## Step 3: The size of each O2 edit on Candela, in parts, records and closure keys

`03-o2-edit-size.mjs` replays O2 on Candela pass by pass with `applyPass` and no contract, and records, per pass, the functions touched, the parts whose hash changed, the records that are not the previous revision's objects, and the closure keys that changed. Every one of the 16 revisions equals IRWB-004's baseline (`various/04-candela-o2-baseline.json`), head `b33d1737…` included. The result is the case for the whole ticket in one table: a pass that rewrites 4 records of 82,660 still costs 6.3 s without the meaning check.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The brief's third grounding measurement ("the size of a realistic edit, in functions touched per pass, across O2 on Candela").
**Inferred user intent:** Know how small real edits are before designing for them.
**Commit (code):** none.

### What I did
- IRWB-004's O2 logs record only counts of touched functions, not their names, so closure-key fan-in could not be computed from them. I replayed O2 instead: `systemd-run … node --max-old-space-size=10240 $T/scripts/03-o2-edit-size.mjs > $T/various/03-o2-edit-size.json` (load 5.7, in the background; process RSS at exit 2,217 MB).

### Why
- Without the contract the pass results are the same (every O2 pass on Candela was accepted, IRWB-004 Step 4), and the run costs two minutes instead of a quarter hour.

### What worked
- `r0Matches: true`, every `matches: true`, `headMatches: true`.
- Per pass (`needs ms`: the analyses it reads, solved first; `apply ms`: `applyPass` without a contract):

  | # | pass | fns | parts changed | records new / total | closure keys changed | needs ms | apply ms |
  |---:|---|---:|---:|---:|---:|---:|---:|
  | 1 | cfg | 110 | 110 | 952 / 92,353 | 204 | 172 | 7,484 |
  | 2 | fold | 103 | 103 | 1,445 / 90,012 | 173 | 0 | 7,035 |
  | 3 | simplify | 19 | 19 | 171 / 89,994 | 68 | 0 | 10,041 |
  | 4 | constprop | 124 | 124 | 4,199 / 89,994 | 162 | 2,147 | 9,982 |
  | 5 | fold | 53 | 53 | 307 / 88,372 | 89 | 0 | 7,616 |
  | 6 | simplify | — | — | no change | — | 0 | 706 |
  | 7 | dce | 144 | 144 | 367 / 83,401 | 177 | 363 | 7,935 |
  | 8 | cfg | 3 | 3 | 27 / 83,392 | 12 | 144 | 7,218 |
  | 9 | licm | 8 | 8 | 116 / 83,446 | 44 | 120 | 9,020 |
  | 10 | lvn | 38 | 38 | 578 / 83,390 | 134 | 0 | 7,386 |
  | 11 | strength | — | — | no change | — | 3,554 | 850 |
  | 12 | bce | — | — | no change | — | 1,826 | 1,194 |
  | 13 | subst | 160 | 160 | 1,415 / 82,960 | 207 | 164 | 8,550 |
  | 14 | subst | 132 | 132 | 925 / 82,680 | 176 | 165 | 8,255 |
  | 15 | dce | 2 | 2 | 2 / 82,672 | 15 | 186 | 12,724 |
  | 16 | cfg | 2 | 2 | 4 / 82,660 | 12 | 21 | 6,256 |

- Over the whole run 226 distinct functions are touched at least once. No pass added or removed a function.

### What didn't work
- No failures.

### What I learned
- **Edits are small in records and moderate in functions.** The largest pass rewrites 4,199 records (4.7%); six of the thirteen changing passes rewrite fewer than 400. The function count is larger (up to 160) because a pass like `subst` makes one small change in many functions.
- **Fan-in multiplies a change by about 4–8 in closure keys** when few functions change (2 parts → 12 and 15 keys; 3 → 12; 8 → 44), and by less when many do (110 → 204), because callers overlap.
- **The work is not proportional to the edit.** Passes 15 and 16 change 2 functions each and cost 12.7 s and 6.3 s; pass 1 changes 110 and costs 7.5 s. Step 5 takes pass 16 apart.
- `typedPass` reports exactly the functions whose part hash changed (`fns` equals `parts changed` on every row).

### What was tricky to build
- Identity of records against the previous value: the script counts a record as new when `before[id] !== after[id]` across the five tables, which is IRWB-004's sharing made visible; it relies on `toNative`'s `keep` (`model.ts:379`).

### What warrants a second pair of eyes
- `needs ms` for `strength` (3,554 ms) is `ranges` solved from scratch at r9 on a loaded machine; IRWB-004 measured 2,362 ms for the same solve at r0.

### What should be done in the future
- Source edits (Step 4) and a breakdown of a 2-function pass (Step 5).

### Code review instructions
- `node …/03-o2-edit-size.mjs` under the cap; it prints one line per pass on stderr.

### Technical details
- Closure keys compared with `closureKey(cur.value, n) !== closureKey(next.value, n)` (`src/typed/parts.ts:241`).

## Step 4: What a source edit does to parts: one function for a constant, 154 for a blank line

`04-source-edits.mjs` edits Candela's source string in memory five ways, ingests the whole program again as the workbench does, and compares parts with r0's, both by IRWB-004's part hash and by a "code hash" that leaves out the front-end operations and the source positions of locals. A same-length constant change touches exactly one part. A blank line or a comment in `s3_mat_0` touches 154 parts and 173 closure keys, because every later front-end operation records an absolute line and offset; by code hash it touches none.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The workbench's realistic edit is a source change; the brief asks for "realistic edit streams such as the workbench's".
**Inferred user intent:** Know whether a user's edit is small in the framework's units.
**Commit (code):** none.

### What I did
- `systemd-run … node --max-old-space-size=10240 $T/scripts/04-source-edits.mjs > $T/various/04-source-edits.json` (load 7.9; wall 24.6 s; max RSS 1.49 GB). The corpus files are not modified; `candelaSource()` checks their digests as before.
- The first attempt to append this diary step with a shell heredoc was refused by the worktree guard ("this command names git in a form too complex to verify"); IRWB-004 Step 4 met the same rule. Diary edits now go through the editor.

### Why
- Parts and closure keys are only useful keys if an ordinary edit leaves most of them unchanged.

### What worked
- r0 ingests in 2,303 ms; all 40,916 front-end operations carry a source position.

  | edit | ingest ms | parts changed | code hashes changed | closure keys changed | by code hash |
  |---|---:|---:|---:|---:|---:|
  | constant in `s3_mat_0` (`0.08` → `0.09`) | 2,511 | 1 | 1 | 11 | 11 |
  | constant in `fresnelDielectric` | 2,131 | 1 | 1 | 79 | 79 |
  | constant in `tracePath` | 1,831 | 1 | 1 | 3 | 3 |
  | blank line after `s3_mat_0`'s header | 4,236 | 154 | 0 | 173 | 0 |
  | comment at the end of that header | 2,059 | 154 | 0 | 173 | 0 |

- `frontEnd` and `counters` are unchanged by all five edits.

### What didn't work
- No failures in the measurement.

### What I learned
- **Ids are stable under source edits; positions are not.** Ids carry the function name and a per-function counter (`store.fresh(\`v:${F}\`)`, `lift.ts:476`), so other functions' records keep their ids. But each `op` record stores `at: { line, col, start, end }` (`lift.ts:183`), and the function record's locals store `at` too, so any edit that moves text moves the positions of every later function.
- **A key that ignores positions would survive such edits completely**: 0 of 332 code hashes changed. Whether such a key is sound for a given consumer is a separate question (Step 1's second-pair-of-eyes item).
- **The front end is whole-program.** Each edit re-ingests all 332 functions (1.8–4.2 s). This term is outside the framework and stays linear unless lifting becomes per function.
- **A source edit changes the origin.** The meaning check's D1 memo is keyed by the origin's revision (`baselineKey` in `meaningKept`), so after any source edit all 13,280 baseline outcomes are recomputed, even for the 331 functions whose code did not change. Per-function origin keys would keep them.

### What was tricky to build
- The edits must keep the program valid and change a known function only: `constantEdit` changes the last digit of the first decimal literal inside the function's body (same length, so no offset moves).

### What warrants a second pair of eyes
- The code hash drops `ops` and locals' `at` only. Statement and value `origin` fields name op ids (`op:F#n`), which are stable; if a future lifter put positions into origins, the code hash would have to drop them too.

### What should be done in the future
- The guide should treat positions as a separate per-part concern in keys, while the revision text keeps them unchanged.

### Code review instructions
- `node …/04-source-edits.mjs` under the cap.

### Technical details
- `codeHash(p) = sha256(canonical([fn without locals, locals without at, blocks, stmts, values]))`; `codeClosure` hashes `name:codeHash` lines over `closureOf(v, f)`.

## Step 5: A 2-function pass taken apart, and the slices a page would adopt a revision in

`05-small-pass-and-slices.mjs` replays O2 to r12 without a contract and then takes the last `cfg` (2 functions: `hitMesh`, `traceAll`; 12 entities and 36 relations changed) apart piece by piece. The total correspondence is the largest piece by far: 11.1 s for 93,138 entries. The same script then measures, for the O2 head, how large the pieces are in which a page could adopt a revision: parsing and freezing one part takes at most 82.6 ms (`tracePath`), and a 1 MiB slice of the portable SHA-256 at most 62.1 ms, in Node.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Ground the claim that a small pass's cost is framework work proportional to the program, and ground the "slices under 100 ms" acceptance with slice sizes.
**Inferred user intent:** Targets in the guide should be achievable on this code and this program.
**Commit (code):** none.

### What I did
- `systemd-run … node --max-old-space-size=10240 $T/scripts/05-small-pass-and-slices.mjs > $T/various/05-small-pass-and-slices.json` (load 8.5, in the background; RSS at exit 2,540 MB).

### Why
- Step 3 showed that a 2-function pass costs 6.3 s; the design needs to know which piece to remove first.

### What worked
- r12 `f7ff969f7ff9…` and r13 `b33d1737c725…` equal IRWB-004's baseline (`r12Matches`, `matches`, `applyPassSameRevision` all true). The replay to r12 took 112.0 s.
- **The last `cfg`, piece by piece (ms):** the `cfg` analysis, solved for r12, 22.7; `Store.from` alone 207.1; `pass.run` 831.6 (copy, 332 bodies, `toNative`, explicit correspondence); `createIRArtifact` 1,791.8; both views 65.3; `diff` 366.0; **`makeCorrespondence` 11,052.2 for 93,138 entries**; undeclared-write check 0; the whole `applyPass` again 8,361.8.
- **Slices for the head:** 332 parts, 14,797,589 characters of part text. Parse and freeze per part: sum 1,093.6 ms, median 1.4 ms, largest `tracePath` (946,233 chars) 82.6 ms, `cdlInit` 59.0 ms, `sampleLobe` 29.5 ms. `assembleParts` 173.4 ms; `validateBlocks` 111.2 ms; the revision text from the freshly parsed records 1,253.2 ms (16,319,710 chars; no record text cached yet); the portable streaming SHA-256 over it 358.2 ms in 16 slices of 1 MiB, worst slice 62.1 ms; the digest equals the revision.

### What didn't work
- No failures.

### What I learned
- **The correspondence dominates a small pass.** In Step 2, `makeCorrespondence` took 5.2 s for a 110-function pass; here 11.1 s for a 2-function pass at higher load. Both are proportional to the program (one entry per entity) and almost all entries say "retained".
- **`createIRArtifact` of a value that shares all but 2 parts still costs 1.0–1.8 s** (Step 2's warm run and this one): content text join and hash, `validateBlocks`, the projection's assembly and `validateGraph`, the resolve check.
- **Part-sized slices fit in 100 ms in Node, but only just for `tracePath`** (82.6 ms). In Chromium, where IRWB-004 measured larger costs for the same work, the largest part may need splitting by table.
- **Text is the expensive part of adopting a revision in a fresh realm**: 1.25 s to encode the records of a freshly parsed value, more than parsing them (1.09 s). Encoding in slices of a few thousand records is required for a page.

### What was tricky to build
- `Sha256.update` receives slices cut at arbitrary UTF-16 positions; the portable implementation holds back a trailing high surrogate (IRWB-004 Step 6), and the digest matching the revision confirms it on this text.

### What warrants a second pair of eyes
- The separate `makeCorrespondence` (11.1 s) is longer than the whole `applyPass` that follows (8.4 s), which contains it. The machine was at load 8.5 with other agents' Candela jobs; garbage collection of the first run's 93,138 entries may fall into the second. The order of magnitude is the finding.

### What should be done in the future
- Measure demand: how many functions `strength` actually asks about (Step 6).

### Code review instructions
- `node …/05-small-pass-and-slices.mjs` under the cap (about 2.5 min).

### Technical details
- The breakdown calls `PASSES.cfg.run`, `createIRArtifact`, `openIR`, `diff`, `makeCorrespondence` and `undeclaredWrites` in `applyPass`'s order (`define-pass.ts:204–273`); `cfg` declares no preserved analyses (`passes.ts:350`), so there is no preservation step.

## Step 6: Demand: `strength` needs the range facts of one function

`strength` reads `ranges.of` only for a `div` or `rem` by a constant power of two (`passes.ts:563`). `06-demand-strength.mjs` counts such candidates in Candela r0: there are 6 divisions or remainders in the whole program and exactly one function, `finishHit`, with candidates (2). Solving and freezing `ranges` for that function alone takes 76.4 ms; for all 332 functions, 3,292.0 ms. Building range views for it alone takes 15.4 ms; for all, 264.2 ms.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Quantify what demand-driven facts would save on the pass that misses IRWB-004's "first no-change pass under 1 s".
**Inferred user intent:** An acceptance target that the design can actually meet.
**Commit (code):** none.

### What I did
- `systemd-run … node --max-old-space-size=10240 $T/scripts/06-demand-strength.mjs > $T/various/06-demand-strength.json` (load 7.8; wall 11.8 s; max RSS 787 MB).

### Why
- IRWB-004's first no-change `strength` took 4.3 s, of which the `ranges` analysis was 2.4 s and `typedPass.run` 0.9 s (IRWB-004 `various/23-final-measurements.txt`). Both are eager over all functions.

### What worked
- `divOrRem: 6`, `candidateFunctions: 1` (`finishHit`, 2 candidates); `solveAndFreezeCandidatesMs: 76.4`, `solveAndFreezeAllMs: 3292.0`; `viewsCandidatesMs: 15.4`, `viewsAllMs: 264.2`.

### What didn't work
- No failures.

### What I learned
- **Most of a fact is never read.** For `strength` on Candela, 1 of 332 functions' range facts is demanded. A pass that asks for facts per function, when its body first needs them, would make the first no-change `strength` cost its body's scan plus about 0.1 s of facts, which puts IRWB-004's missed 1-second target within reach without any persistent store.

### What was tricky to build
- Nothing beyond Step 2's region-by-region solve.

### What warrants a second pair of eyes
- `bce` also reads `ranges` (and `dominators`, `reaching`); its demand was not measured. On Candela it changes nothing because checks are `caddr`, not branches (IRWB-002 §16).

### What should be done in the future
- Write the guide.

### Code review instructions
- `node …/06-demand-strength.mjs` under the cap.

### Technical details
- Solving here freezes each region's record separately (`immutable` per region), so `solveAndFreezeAllMs` (3.3 s) is comparable to Step 2's solve plus per-region freeze (1.06 s + 1.43 s, at lower load).

## Step 7: The guide's first draft, and the notes of its second reading

I created the design doc with `docmgr doc add --ticket IRWB-009 --doc-type design-doc --title "Intern guide: a function-incremental framework for the IR Workbench"` and wrote the first draft in full: Part 1 (§1–§10, the system with this ticket's measurements), Part 2 (§11–§26, the design, risks, plan, API, related work, open questions, file map, glossary). Then I reread the whole draft as its reader, top to bottom, and wrote down what a newcomer would stumble on and what was technically wrong, before changing anything.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Write the guide; the brief asks for a second pass "reread it as its reader and revise".
**Inferred user intent:** A guide an intern can act on, not a draft.
**Commit (code):** none.

### What I did
- `docmgr doc add …` → `$T/design-doc/01-intern-guide-a-function-incremental-framework-for-the-ir-workbench.md`; wrote the draft with the editor.
- Reread it in five chunks and recorded the notes below.

### Review notes: comprehension gaps
1. §1 uses "O2" and "r13" without saying what they are. Add: O2 is the 16-pass standard pipeline; rN is the program after N changing passes.
2. Part 2 has no overview of how its pieces fit together; a reader meets keys, per-part facts, validation, projection, the page, the store and the query engine one after another without a map back to the four approved pieces. Add a short section with a diagram.
3. §11.2's work size `W(e)` mixes records and cases through a conversion constant `c̄` that nothing measures. Split it into two sizes, each with its own time, so that both are measurable.
4. §13.2's code sketch uses an invented `await-free` keyword; replace with plain pseudocode, and justify the "under one second" claim with arithmetic from measured pieces instead of a reference to §15 and §18.5 (which do not apply to a pass that changes nothing).
5. §18.1's table derives `part@i` from `revision@i`, which would make every function's part task depend on the whole revision and re-run after any edit. Derive `part@i/f` from `step#i/f` instead, and state the bookkeeping term that remains (one verification per function per stage).
6. §17.4 rule 3 says the page accepts derived results "only when the pack was produced by a local tool", which the page cannot check. Restate it in terms of what the page can load at all (same-origin scripts from the user's own server).

### Review notes: technical corrections
7. §1's table gives "`makeCorrespondence` 5–11 s" for the 2-function pass; for that pass it was measured once, 11.1 s, alone. "Three pieces … this table shows them" introduces a four-row table.
8. §2.4 cites IRWB-004 step 4 for the 18,178,949-character text; step 3 measured it.
9. §3.4 refers to "the code hash of §12.2"; it is §12.1.
10. §12.1 claims the recording store sees reads of `at` fields; a store wrapper sees `get`/`fn` calls, not field reads. Field reads need read-tracking proxies in test mode; the position-shift test is the robust check.
11. §12.1 calls a text-moving edit "the most common edit in the workbench"; nothing measured that. Say "any edit that adds or removes a line".
12. §15.1 claims the eager projection leaves "every pipeline step" once §15.3–§15.4 hold; `applyPass` still calls `openIR`, whose constructor projects (`view.ts:196`). §15.5 must make `openIR` lazy in the graph, not only in the entity map.
13. §15.4 says the compact correspondence has "one entry per changed entity … a few dozen"; it has entries for every entity of the changed parts. Say that.
14. §21 P2's target "2-function `cfg` under 1 s" ignores `pass.run` (832 ms, 05), which P2 does not change. Target under 1.5 s for P2 and itemize the remainder; the per-function step memo of P5 is what removes `pass.run`'s whole-program copy.
15. §12.3 says "§21 measures how often it matters"; it is P4 that records it.
16. §20 lacks the risk that task verification itself visits every function's task once per stage (5,312 per O2 run).

### What worked
- The draft's structure held up; every number traced to a `various/` file, an IRWB-004 file or a diary step.

### What didn't work
- No failures; the notes above are the defects.

### What I learned
- The draft's weakest parts were the ones I wrote from the design outward (the query table, the acceptance targets) rather than from a measurement inward.

### What was tricky to build
- Keeping proposed acceptance targets honest: each must be derivable from measured remaining components (P1: IRWB-004's 655 ms warm no-change pass plus 76 ms of demanded facts; P2: 832 ms of `pass.run` remain).

### What warrants a second pair of eyes
- P4's "under 60 s" for a warm-store O2 run and P6's 1.5× criterion are judgments, not measurements; they are stated as targets.

### What should be done in the future
- Apply the sixteen notes (Step 8).

### Code review instructions
- Read the guide against this list.

### Technical details
- None beyond the notes.

## Step 8: The revision applied; docmgr tasks, relations, changelog and index

I applied all sixteen notes of Step 7 to the guide, then reread the changed passages in the context of the whole document: the opening promises, the invariant's notation (now `T_rec/R`, `T_case/K`, `T_id/N` everywhere, including falsification item 2, P0, P6 and the glossary), the query table and its diagram, the walk-throughs and the plan's targets now tell one story. Then the ticket's bookkeeping: six files related to the guide, eleven tasks (the three of this round, P0–P6, and the deferred vault report), a changelog entry, and the index's overview.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Finish the second pass; "Add docmgr tasks for the phases, and relate the key files."
**Inferred user intent:** The ticket should show what was delivered and what the next person does.
**Commit (code):** none (documents only).

### What I did
- Edits to the guide for notes 1–16, among them: §1 explains O2 and rN and corrects the 2-function row; §11.2 defines two work sizes R(e), K(e) and three time terms; a new §11.4 maps the seven design sections to the four approved pieces with a diagram; §13.2's pseudocode is plain, and its one-second claim is arithmetic from IRWB-004's warm no-change run (655 ms) minus the views not built (249 ms) plus one demanded region (76 ms); §15.5 makes `openIR` lazy in its graph; §18.1 derives `part@i/f` from `step#i/f` and §18.2 states the verification bookkeeping term; §17.4 rule 3 is restated in terms of what the page can load; P2's target is 1.5 s with `pass.run` named as the remainder.
- One further correction found while applying note 4: IRWB-004's profile figures for `typedPass.run` (876 ms) and `beginEdit` (211 ms) are sums over its two runs (`various/23-final-measurements.txt`: "within applyPass (3,508 ms sampled over both)"). §1, §4.4 and §13.2 now say so instead of presenting them as one run's cost.
- `docmgr doc relate --doc …/design-doc/01-… --file-note …` for `adapters.ts`, `define-pass.ts`, `dataflow/analysis.ts`, `runtime.ts`, `parts.ts`, `passes.ts`; `docmgr doc relate --ticket IRWB-009` for the guide and `scripts/03-o2-edit-size.mjs`.
- `docmgr task add` ×11; `docmgr task check --id n6lg,w95r`; `docmgr changelog update`; index overview, summary, what-for and when-to-use written.
- `docmgr doctor --ticket IRWB-009 --stale-after 30`: "All checks passed".

### Why
- The second pass is the brief's requirement and the writing guidance's; the tasks are how the next person finds the phases.

### What worked
- The guide is 1,003 lines (101,487 bytes) before these edits and slightly longer after; every number cites a `various/` file, an IRWB-004 file or a diary step.

### What didn't work
- No failures.

### What I learned
- Profile totals across repeated runs are easy to misread as one run's cost; the source file said "over both", and I had dropped that qualifier in the first draft.

### What was tricky to build
- Keeping the query engine's walk-through consistent with its table after changing where `part@i` comes from: the blank-line edit now re-runs 154 × 13 part assemblies and fourteen identity terms, and no `step`, `facts` or `verdict` task.

### What warrants a second pair of eyes
- The guide's related-work section lists only works I am certain of, and names two more (ThinLTO; an OOPSLA 2015 incremental build system) as unverified.

### What should be done in the future
- Upload (Step 9).

### Code review instructions
- `docmgr doc list --ticket IRWB-009`; `docmgr task list --ticket IRWB-009`.

### Technical details
- Task ids: `n6lg` measurements, `w95r` guide, `n28g` upload, `r3a5` P0, `c8gw` P1, `26kv` P2, `m8bh` P3, `z0z7` P4, `prcr` P5, `mz2q` P6, `ab2z` vault report (deferred).

## Step 9: Upload to reMarkable, and the stop

The guide went up as one PDF with a two-level table of contents, and the cloud listing shows it. This round stops here, as the brief says; no vault report is written (deferred to the implementation milestone, Step 1).

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Store in the ticket and then upload to remarkable"; verify with a listing; never `--force`.
**Inferred user intent:** The guide readable on the device.
**Commit (code):** `ae291fb` — "IRWB-009: intern guide for a function-incremental framework (design-doc 01) with its second pass; …" (the uploaded content).

### What I did
- `remarquee upload bundle ttmp/2026/11/26/IRWB-009--…/design-doc/01-intern-guide-a-function-incremental-framework-for-the-ir-workbench.md --name "IRWB-009 Intern Guide: A Function-Incremental Framework" --remote-dir "/ai/2026/11/26/IRWB-009" --toc-depth 2 --non-interactive`
- `remarquee cloud ls /ai/2026/11/26/IRWB-009 --long --non-interactive`
- `docmgr task check --ticket IRWB-009 --id n28g`

### Why
- The brief's delivery step and its verification.

### What worked
- `OK: uploaded IRWB-009 Intern Guide: A Function-Incremental Framework.pdf -> /ai/2026/11/26/IRWB-009`
- Listing: `[f]	IRWB-009 Intern Guide: A Function-Incremental Framework`

### What didn't work
- No failures. No `--force` was used; the folder was new.

### What I learned
- Nothing new; the bundle path rendered the box-drawing diagrams without a local test render, as the remarkable-upload skill's defaults (DejaVu fonts) suggest.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- I did not inspect the rendered PDF; the upload result is cloud delivery, not a visual check.

### What should be done in the future
- Implementation, starting with P0 (the harness) and P1 (facts per part on demand); then the vault report.

### Code review instructions
- `remarquee cloud ls /ai/2026/11/26/IRWB-009 --long --non-interactive`.

### Technical details
- Commits of this round on the worktree branch: `0b57100` (measurements, diary 1–6), `ae291fb` (guide, bookkeeping, diary 7–8), and this step's commit.
