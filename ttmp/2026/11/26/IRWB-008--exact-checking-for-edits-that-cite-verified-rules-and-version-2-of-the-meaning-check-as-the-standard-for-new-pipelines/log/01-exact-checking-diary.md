---
Title: Exact checking diary
Ticket: IRWB-008
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
Summary: "Chronological, step-numbered investigation diary of IRWB-008's guide round: reading the system and the evidence of IRWB-004, IRWB-005 and IRWB-006, small corpus measurements that ground the design, writing the intern guide on exact checking for rule-backed edits and version 2 of the meaning check, and its upload."
LastUpdated: 2026-11-26T10:00:00-05:00
WhatFor: "Resume point and evidence trail for IRWB-008 (analysis and design only; no implementation in this round)."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Exact checking diary

Steps are chronological, oldest first. Every number in a step is a measurement from the command shown in it, or a quotation of another ticket's diary with its commit. Scripts are in `../scripts/`, measurements in `../various/`.

## Step 1: Read the system, the merged tickets IRWB-004 and IRWB-006, and the unmerged IRWB-005

This round is analysis and design only: an intern guide for IRWB-008, grounded by small measurements, uploaded to reMarkable. Nothing under `src/`, `tests/` or `tools/` changes. Before measuring anything I read the parts of the system the design touches, from the code at `a4beda6` (this worktree's base), and the three tickets whose results the design builds on. IRWB-005 is not merged; I read it in its own worktree, at its branch head `d9cf4e9`, without running any of its code.

The reading settled the shape of the design. The meaning contract is the only gate a pass meets, and it is sampled. IRWB-006 left every `simplify` and `fold` rule with recorded evidence, but a revision does not say which rule made which value, and it cannot without changing O2's hashes. IRWB-004 gave the sampled check a memo keyed by origin revision and closure key; IRWB-005's version 2 has no such key, so it gets none of that saving.

### Prompt Context
**User prompt (verbatim):** "For each, Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
(This is the user's request as relayed verbatim in the coordinator's brief. The brief, from the coordinating agent, adds the direction the user approved: the gap that IRWB-005 measured, the fix in two parts (exact acceptance of edits citing verified rules; version 2 as the standard for new pipelines, O2 frozen), the blocker (rule names in provenance change frozen hashes, so new pass variants), the research framing (translation validation made exact and compositional, an evidence-strength lattice, future sections), the process, and the hard constraints: no downloaded code run, Candela-scale processes under a 14 GB cap, one at a time.)
**Assistant interpretation:** Write IRWB-008's intern guide (system, measurements, design, risks, phased plan), ground it with small measurements in the ticket's `scripts/` and `various/`, keep this diary, upload, commit ticket files only, and stop.
**Inferred user intent:** A design an intern can implement, that makes the gate exact where the evidence already allows it and cheaper where it does not have to sample, without touching O2.
**Commit (code):** none in this step.

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`, and their writing-style and investigation-entry references.
- Read IRWB-002's guide Part 1 (sections 1–17) and items B1, B2, D2, D3, D4 (`ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md`, lines 1–740, 924–970, 1221–1330).
- Read IRWB-006's guide (all of it) and diary steps 4–6 and 10–11; the code in `src/typed/rules/` (`form.ts`, `compile.ts`, `passes.ts`, `candidates.ts`, `simplify.ts`, `fold.ts`, `semantics.ts`, `verify.ts` lines 1–240, the head of `evidence.ts`) and `tests/typed/rules.test.mjs`.
- Read IRWB-004's code: `src/framework/contracts/differential.ts` (all 327 lines), `src/framework/passes/define-pass.ts` (all 337 lines), `src/typed/parts.ts` (header), and its diary steps 4 and 8–10.
- Read `src/typed/tx.ts` (`Edit`, `MakeOptions`, `ValueHandle`, `Tx.origin`, `Tx.record`, `Tx.rewrite`), `Origin` in `src/typed/model.ts:103`, `src/typed/passes.ts` (`typedPass`, `revisionCorrespondence`, `optimizationContract`, `fold`, `simplify`, `constprop`, `strength`, `PASSES`, `PIPELINES`), `meaningKept` and `casesFrom` in `src/typed/evaluate.ts`, `isPure`/`hasEffect` in `src/typed/analyses.ts`, `SSA_PIPELINES` in `src/typed/sccp.ts`.
- IRWB-005, read only: `git log --oneline -25 worktree-agent-a6abc74d4c978a51f` (head `d9cf4e9`); its guide (all 583 lines); diary steps 5, 7–10, 12–18; `src/typed/cases-strong.ts` (header and lines 300–491); `various/04-corpus-final.txt` and `various/13-candela-summary.txt`.
- Built this worktree: `/home/manuel/code/wesen/2026-11-24--compiler-workbench/node_modules/.bin/tsc -p tsconfig.json` (8.4 s wall, no errors). The worktree has no `node_modules`; TypeScript found `@types/node` by walking up to the main checkout.
- `docmgr doc add --ticket IRWB-008 --doc-type log --title "Exact checking diary"`.

### Why
- The design's claims rest on four facts that only the code can settle: what a revision records about the rule that made a value, what the contract receives as inputs, how the memo decides what to re-run, and what version 2 changes. Each was read at its source.

### What worked
- The numbers the brief attributes to IRWB-005's commit messages, checked in its diary at `d9cf4e9`:
  - corpus, 1,144 mutants of the pipeline heads: default gate 83.1 % .. 95.8 %, version 2 99.8 % (step 8; `various/04-corpus-final.txt` TOTAL row: 1144 909 40 195 83.1 % 95.8 %);
  - held-out, 1,231 mutants of r0: default 96.2 %, version 2 99.9 % (step 12);
  - range facts: 44 projects, 168 revisions, 149,381,636 claim checks, 0 violations (step 13);
  - NaN payloads: `x + (−0) → x` accepted by version 1 (`80/80`), rejected by version 2 (`2/160 sampled cases disagree`) (step 14).
- Two numbers beyond the brief: Candela, 18 functions, 3,931 mutants: default 97.6 % upper bound in diary step 18; the summary file (`various/13-candela-summary.txt`) gives 97.3 % after reclassifying 11 mutants that `check100` killed on a specified case, with 85 (step 18) or 96 (summary) wrong mutants accepted, nearly all `f32`. I cite the summary's numbers and say which file they come from.
- Version 2's cost on correct pipelines (step 9): pipelines over all 44 projects, v1 28,563 ms against v2 26,650 ms (no measurable difference), same accepted passes and heads; the check alone on all heads, v1-40 560 ms against v2 1,139 ms (load average 12.7).

### What didn't work
- `cat $G/worktrees/agent-a6abc74d4c978a51f/HEAD` (reading IRWB-005's head through the git directory) was refused by the worktree isolation check: "this command names git in a form too complex to verify that it stays inside the worktree". The branch is shared through the common repository, so `git log --oneline -25 worktree-agent-a6abc74d4c978a51f` from this worktree gave the head instead.

### What I learned
- **A revision does not name the rule that made a value.** `Tx.origin` writes `{ from, via, kind, rev, because, note }` (`tx.ts:187`); for `simplify`, `via` is `simplify`, `because` the constant operands, `note` a sentence (`compile.ts:72`, `provenance`). The rule's name appears nowhere. Adding it changes every origin it is added to, and the origins are inside the revision hash.
- **The contract sees revisions, not edits.** `applyPass` calls `manager.verifyTransformation({ input, ...contractInputs }, { output }, gate, [correspondence])` (`define-pass.ts:279`). The pass's `report` (its `Edit` list) is not an input. An edit validator therefore needs either the report as a port or a way to recover the edits from the two revisions and the correspondence.
- **One `replace` edit can carry several rule firings.** `Tx.rewrite` records one edit per statement field (`tx.ts:458`), with the old root and the new root; the rules that fired inside the tree are not listed. IRWB-006 step 5: 56 `simplify` firings for 48 statement edits on Candela.
- **Intermediate trees do not survive.** `Tx.rewrite` rebuilds a parent around a changed argument (origin note `rebuilt around a changed argument`); when a rule then rewrites that rebuilt node, the rebuilt copy is in neither revision. A validator must re-derive from the before-tree, not look up intermediates.
- **Version 2 sets no `baselineKey`** (`cases-strong.ts` 369–466; IRWB-005 step 16: "version 2 did not [get faster]: it has no `baselineKey`, so it still runs r0 on every case"). Its divergence rule needs to know whether the origin finished; step 15 made `run` compute that itself when the baseline was not run, which is what a memo needs.
- **Version 2 also fixes a case-layout defect.** IRWB-005 step 7: the default generator writes a record's words in key order, so for 168 of Candela's 332 functions the `K` record's fields are scrambled; version 2 lays them out by offset (`layout: 'offset'`).

### What was tricky to build
- N/A (reading).

### What warrants a second pair of eyes
- The Candela kill rate differs between IRWB-005's diary (97.6 %) and its summary file (97.3 %) by the 11 reclassified mutants; IRWB-005 is still running, and its head may move past `d9cf4e9`.

### What should be done in the future
- Measure, on the corpus, how much of each pipeline's change comes from `simplify` and `fold`, whether every one of their edits can be re-derived from its before-tree and the rule data alone, and what the sampled check costs per pass (Step 2).

### Code review instructions
- Start with `Tx.origin` and `Tx.rewrite` in `src/typed/tx.ts`, `applyPass` in `src/framework/passes/define-pass.ts:190`, and `prepare`/`memoKeys` in `src/framework/contracts/differential.ts`.

### Technical details
- Base commit: `a4beda6`. IRWB-005 read at `d9cf4e9` (branch `worktree-agent-a6abc74d4c978a51f`). IRWB-006 and IRWB-004 are merged in the base (`4fb1bba`, `1f45c94`).

## Step 2: The corpus census: where edits come from, exact re-derivation of every rule-backed edit, and what the sampled check costs

The guide's hypothesis is that most value-level edits are instances of a few verified local rules, and that those can be checked exactly and cheaply. This step measures that on the corpus with a script that prototypes the proposed validator, written from the rule data alone. For every `replace` edit of `simplify` and `fold` it takes the before-tree, re-applies the pass's rule table bottom-up with its own matcher and guards, and compares the result with the after-tree. All 394 such edits re-derive exactly, in 10.8 ms in total, against 177 ms for the sampled checks of the same applications with IRWB-004's memo and 1,210 ms without it.

The hypothesis holds for value-level edits and not for edits in general: `simplify` and `fold` make 394 of the 659 `replace` edits (59.8 %), but only 394 of all 2,118 edits (18.6 %) and 1,542 of 4,795 changed entities (32.2 %), because `cfg` alone makes 1,060 structural edits. The guide has to say both.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Ground the guide with small measurements": the share of edits and changed entities from `simplify` and `fold` against structural passes, and the sampled contract's time per pass on the corpus.
**Inferred user intent:** Numbers that confirm or limit the claim "stronger guarantees and cheaper passes at once".
**Commit (code):** none (ticket scripts and measurements; committed with the ticket files).

### What I did
- `scripts/01-edit-census-corpus.mjs`: for each of the 44 projects and each of the pipelines `O1`, `O2`, `O2+`, `loops`, `checks`, `O2-sccp`, apply each pass with `applyPass(pass, cur, { manager })` (no contract), then time `runDifferentialAsync(differentialSpec(meaningKept({ inputs })), { origin: r0, candidate })` and read `differentialStats()` before and after; count edits by kind (`report.edits`), entity changes (`changes.entities`) and functions touched (`report.fns`); for `simplify` and `fold`, re-derive every `replace` edit (`normalize` in the script).
- `node $T/scripts/01-edit-census-corpus.mjs --json $T/various/01-edit-census-corpus.json > $T/various/01-edit-census-corpus.txt` (7.1 s wall); then with `--no-reuse` into `02-edit-census-corpus-no-reuse.{json,txt}` (13.4 s wall). Load average 4.4–5.3.
- A `node -e` over the JSON for the edit kinds per pass.
- `scripts/02-evidence-strength-by-firing.mjs`: the recorded strength of every rule (`RULE_EVIDENCE`), weighted by firings on the corpus (from 01) and on Candela's O2 (IRWB-006's `various/04-rules-equivalence-candela.json`) → `various/03-evidence-strength-by-firing.txt`.

### Why
- Running the check apart from `applyPass` separates the pass's own cost from the gate's; it runs the same invariant on the same ports, so its verdict is the gate's.
- The re-derivation is the cheapest experiment that can falsify the central claim: if a rule-backed edit could not be re-derived from its before-tree and the table, "an edit is an instance of a rule" would be false for this compiler.

### What worked
- Per pass, memo on (`01-edit-census-corpus.txt`; apps = applications, chg = applications that changed the program):
  ```text
  pass        apps chg  edits  ent.chg  fns/tot   pass ms  check ms
  cfg          660 193   1060      865  247/319      1467       255
  fold         352  52     65      308    56/88       436        29
  simplify     440 207    329     1234  259/313      1409       148
  constprop    132  39     81      354    42/57       304        22
  dce          352  63     86      182    67/97       434        35
  licm         176  28    120      204    28/32       198        43
  lvn          176  20     96      240    24/32       206        11
  strength     132   3      3       30      3/6       284        11
  bce          176  40    104      416    52/76       484        37
  subst        352  69    146      830   73/106       645        58
  sccp          44  13     28      132    14/19        86        14
  rule-backed (simplify, fold): edits 394 of 2118 (18.6 %), entity changes 1542 of 4795 (32.2 %)
  simplify: replace edits 329, re-derived 329, not 0; 8.9 ms re-deriving
  fold: replace edits 65, re-derived 65, not 0; 1.9 ms re-deriving
  ```
- Edit kinds: `cfg` retarget 382, unreachable 416, remove 57, move 139, merge 57, replaceStmt 9; `dce` remove 86; `licm` local 36, insert 40, replace 32, block 4, retarget 8; `lvn` local 24, replace 48, insert 24; `bce` replaceStmt 52, unreachable 52; `subst` replace 73, remove 73; `constprop` replace 81; `sccp` replace 28; `strength` replace 3. All 659 `replace` edits: 394 rule-backed (59.8 %), 112 fact-backed value substitutions (`constprop` 81, `sccp` 28, `strength` 3; 17.0 %), 153 paired with structural changes (`licm`, `lvn`, `subst`).
- Weakest strength per re-derived edit: `simplify` 125 proof, 204 reduced-width+argument; `fold` 65 by-construction.
- Memo counters for `simplify`: 2,600 subject runs and 9,920 replayed verdicts (79 % replayed); `fold` 800 and 2,720.
- Without the memo (`02-…-no-reuse.txt`): check ms `simplify` 1,079, `fold` 131, `cfg` 1,356, all passes 3,585; re-deriving 14.4 + 2.8 ms.
- Changed applications: 727 in all, 259 of them `simplify` or `fold` (35.6 %). Sampled-check time on them: 177 of 663 ms with the memo (26.7 %), 1,210 of 3,585 ms without.
- Evidence × firings (`03-…txt`): `simplify` corpus firings proof 152, reduced-width+argument 204 (`not-lt` 192, `not-gt` 6, `not-ne` 6), exhaustive 0; Candela proof 40, reduced-width 16 (`not-lt` 12, `not-le` 4). `fold` all by-construction: corpus 73, Candela 2,081 (1,145 of them f32 operators). 0 rules without matching evidence.

### What didn't work
- Nothing failed.

### What I learned
- The most frequent rule on the corpus, `not-lt` (192 of 356 `simplify` firings), is one of the eight with the weakest non-sampled strength. Raising the comparison inversions from "reduced width + argument" to a proof would raise the floor of 204 of the 329 `simplify` edits.
- On the corpus a check is cheap next to a pass (663 ms against 5,953 ms of pass time with the memo); the saving from skipping sampled checks is real but small there. Candela is where the cost is (measurement 03).
- `fns/tot` shows why the corpus says little about locality: corpus programs have one to three functions, so a pass usually touches most of them. Candela's per-pass function counts (IRWB-004 step 10) are the relevant ones.

### What was tricky to build
- Reproducing `Tx.rewrite`'s order exactly in a pure tree normalizer: operands first, then the first matching rule of the root operator in table order, and the replacement is not visited again (`tx.ts:452–454`: `visit` returns an id and `walk` returns it without recursing). A normalizer that re-normalized the replacement would re-derive different trees.
- Types of made values: a constant template carries its `type`; an operator template gets `f32` exactly when the operator is in `F32_RESULT`, as `Tx.make`'s `typeOf` decides.

### What warrants a second pair of eyes
- The re-derivation shares the evaluator's operator functions (`evalOp`) with the pass; it shares neither the matcher nor the guards nor `Tx`. Whether the validator should also be independent of `evalOp` is a decision for the guide (it is the specification, so I think not).

### What should be done in the future
- Candela (measurement 03, running under the cap).

### Code review instructions
- `scripts/01-edit-census-corpus.mjs` (`normalize`, `match`, `guard`, `inst`); rerun: `node $T/scripts/01-edit-census-corpus.mjs` (about 7 s).

### Technical details
- `$T` is `ttmp/2026/11/26/IRWB-008--exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-as-the-standard-for-new-pipelines`.
- The memo keeps at most four origin keys (`REUSE_MAX`, `differential.ts:151`); the script checks one project's six pipelines in a row against one r0, so all six share the key.

## Step 3: The census on Candela's O2, under the memory cap

The corpus is small and integer-only; Candela is where the check costs time and where `fold` acts on floats. This step runs the corpus census on Candela's O2: one Candela-scale process, run alone among mine, under the coordinator's memory cap, with two other agents' Candela jobs running (5.3 GB and 1.5 GB resident at the start; 49 GB of 62 GB available). It finished in 2 min 44 s with a 3.92 GB peak and reproduced the official O2 chain (`r0 cd36346ea7c4`, head `b33d1737c725`).

Every one of the 838 `simplify` and `fold` edits re-derives exactly from its before-tree, in 22 ms in total, including 1,145 float folds. The re-derived firings equal IRWB-006's recorded Candela firings rule for rule. The sampled check costs 32.4 s of the 153.2 s of pass and check time with the memo; the three rule-backed steps account for 6.2 s of it.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Use Candela only if needed, from existing logs, or under the cap": the existing logs (IRWB-004 step 10) give per-pass wall times but not the check's share, nor any re-derivation; a capped run gives both.
**Inferred user intent:** The cost claim measured where cost matters, without endangering the shared machine.
**Commit (code):** none (scripts and measurements; committed with the ticket files).

### What I did
- `free -g` (62 total, 49 available) and `ps -eo pid,rss,etime,args --sort=-rss` (PIDs 81442 at 5.3 GB and 73147 at 1.5 GB: other agents' Candela jobs).
- `scripts/03-edit-census-candela.mjs`: ingest Candela from the tape (as IRWB-004's script 04 does), `meaningKept({ inputs: candelaInputs(st), count: 40 })` (the parameters `runPipeline` uses), O2 pass by pass as in measurement 01, one JSON line per step to stderr.
- `/usr/bin/time -v systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 node --max-old-space-size=10240 $T/scripts/03-edit-census-candela.mjs > $T/various/04-edit-census-candela.json 2> $T/various/04-edit-census-candela.log` (background; exit 0).
- A `node -e` summary → `$T/various/05-edit-census-candela-summary.txt`.

### Why
- The cost claim ("cheaper passes") is about Candela-sized programs; the corpus check is 663 ms in all (Step 2).

### What worked
- `Elapsed (wall clock) time 2:43.80`, `Maximum resident set size (kbytes): 3919972`, exit 0. Every check: `[13280, 13258, 0, 22]` (total, agree, disagree, inconclusive), as in IRWB-004.
- Per step (`05-…summary.txt`):
  ```text
  pass       chg  edits replace ent.chg  fns   pass ms  check ms  subj.runs replayed
  cfg          1    974       0     882  110      8826     10390      13280        0
  fold         1    676     676    3879  103      9156      2597       6920     6360
  simplify     1     48      48     264   19      7699      1989       2720    10560
  constprop    1    925     925    6548  124     11956      2580       6480     6800
  fold         1    114     114    2008   53      7423      1612       3560     9720
  dce          1   2164       0    4971  144     10386      2363       7080     6200
  cfg          1     18       0       9    3      6708       908        480    12800
  licm         1     87      19      97    8      7032      1921       1760    11520
  lvn          1    256     128     918   38      7054      1687       5360     7920
  subst        1    430     215    2400  160      8429      2459       8280     5000
  subst        1    280     140    1570  132      7790      2226       7040     6240
  dce          1      2       0       8    2     14488       899        600    12680
  cfg          1     20       0      12    2      5987       737        480    12800
  ```
  (and the unchanged steps: second `simplify` 636 ms, `strength` 4,287 ms, `bce` 2,938 ms.)
- Totals: 5,994 edits, 2,265 `replace`, 23,566 entity changes; pass 120,795 ms, check 32,368 ms; 13,280 baseline runs, 64,040 subject runs, 108,600 replayed (the same counters as IRWB-004 step 10).
- Rule-backed steps (`fold` twice, `simplify` once): 838 edits (14.0 % of edits), 838 `replace` (37.0 %), 6,151 entity changes (26.1 %), 6,198 ms of check (19.1 %), 13,200 subject runs (20.6 %).
- `constprop`: 925 `replace` edits (40.8 % of `replace`), all fact-backed substitutions. Rule-backed plus `constprop`: 1,763 of 2,265 `replace` edits (77.8 %).
- Re-derivation: `fold` 676 of 676 (12 ms) and 114 of 114 (8 ms), all by-construction; `simplify` 48 of 48 (2 ms), weakest 32 proof, 16 reduced-width+argument. Firings summed over the two `fold` steps equal IRWB-006's `04-rules-equivalence-candela.json` for all 12 rules (for example `fold-fmax` 83 + 202 = 285).
- Check time per evaluated run, over all steps: 32,368 ms / (64,040 + 13,280) = 0.419 ms.

### What didn't work
- Nothing failed.

### What I learned
- The first check of a pipeline is the expensive one (10.4 s: 13,280 cases on both sides); after it, a check costs 0.7–2.6 s, in proportion to the subject runs the memo cannot replay. Exact acceptance of the three rule-backed steps removes 13,200 of the 64,040 subject runs.
- With the memo, the check is 21 % of O2's pass-plus-check time on Candela (32.4 of 153.2 s); without exact checking or the memo, version 2 (80 cases per function, no `baselineKey`) would evaluate every case on both sides at every step. That cost is estimated in the guide, not measured: IRWB-005's code is read only in this round.

### What was tricky to build
- Nothing new; the script is measurement 01's loop around IRWB-004's Candela loader.

### What warrants a second pair of eyes
- The pass times here (applyPass without a contract) are not comparable with IRWB-004's per-step wall times, which include the check.

### What should be done in the future
- Measure version 2 on Candela's O2 (cost and acceptance) when IRWB-005 is merged; its record layout fix changes the cases of 168 of Candela's functions.

### Code review instructions
- `$T/various/05-edit-census-candela-summary.txt`; `$T/scripts/03-edit-census-candela.mjs`.

### Technical details
- `systemd-run --scope` executes the command in place, so `/usr/bin/time` measured node itself.

## Step 4: Worked examples, and three design findings they force

The guide needs one small example the reader can follow from the edit record to the evidence. `scripts/04-blend-worked-example.mjs` prints, for every `simplify` and `fold` edit of a project's O2 run, the edit record, both trees, the origin of the new root, the correspondence entry of the old root, the rules the independent re-derivation fires, and their recorded strength. On Blend it gives the two edits the guide follows (`fold` at r2, `simplify` at r3). On `algebra` it shows something the code reading predicted but no document had shown: an edit after which no entity of the output revision records which rule made it.

Three findings follow, and they change the order of the plan: the validator needs no citations, so it can be built and run in shadow mode on O2 first; citations are for provenance and for future passes whose output is not a normal form; and they cannot live only on made values.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** A concrete trace for the guide, and a check of the design against it.
**Inferred user intent:** A design that fits the code as it is.
**Commit (code):** none.

### What I did
- `node $T/scripts/04-blend-worked-example.mjs blend > $T/various/06-blend-worked-example.txt`; the same with `algebra` into `07-algebra-worked-example.txt`.

### What worked
- Blend, `fold` at r2: `edit:r2.0` `s:blend.0` value `mul(4, 16)` → `64`; new root `v:blend.34` with origin `{ from: v:blend.2, via: fold, rev: 2, because: [v:blend.0, v:blend.1] }`; re-derived by `fold-mul@1` (by-construction).
- Blend, `simplify` at r3: `edit:r3.0` `s:blend.4` cond `eqz(lt(get#6, get#1))` → `ge(get#6, get#1)`; new root `v:blend.35`, origin `{ from: v:blend.8, via: simplify, rev: 3, because: [], note: "!(<) is >=" }`; correspondence `{ from: [v:blend.8], to: [v:blend.35], relation: simplify, note: "!(<) is >=" }`; re-derived by `not-lt@1` (reduced-width+argument; evidence methods structural pass, exhaustive-w8 65,536 cases, random-32 1,002,304 cases, exhaustive-32 n/a).
- `algebra`, `simplify` at r1, `edit:r1.3`: `add(add(add(a, b), z), sub(x, x))` → `add(add(a, b), z)`; re-derived by `sub-self@1` then `add-zero@1`; the new root is an existing value; the correspondence entry is `{ from: [v:tidy.21], relation: removed, to: [] }`.

### What didn't work
- Nothing failed.

### What I learned
- **The validator needs no rule citations.** The census re-derived every edit of O2's own `simplify` and `fold` (1,232 on the corpus and Candela) from the before-tree and the table alone. Normalizing with any verified rule set is sound, whichever set the pass used. So exact checking does not wait for pass variants, and it can run beside O2's gate without changing O2.
- **Citations cannot live only on made values.** In `edit:r1.3`, `sub-self` makes a constant 0 and `add-zero` then returns an existing operand; the 0 and the rebuilt parent are in neither revision. A rule token in a made value's `because` would be lost with them. A complete citation has to be attached to the statement field (in the edit record and the correspondence, which are not hashed) and, for `Program.why`, to the statement's origins (which are).
- **Citations still matter.** For provenance (`why` should name the rule; today the correspondence says only `removed`), for checking that a pass says what it did, and for any future pass whose output is not the table's normal form (a search or an e-graph extraction, IRWB-010), where re-derivation by normalization cannot reproduce the output and a cited derivation has to be checked step by step instead.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- That the correspondence and the edit list are outside the revision hash: `revisionCorrespondence` (`passes.ts:117`) is returned as `NativeResult.correspondence` and the edits as `report`; neither enters `createIRArtifact`. Adding citations there changes O2's edit lists (which `tests/typed/rules.test.mjs` compares) but none of its hashes.

### What should be done in the future
- Write the guide (Step 5).

### Code review instructions
- `$T/various/06-blend-worked-example.txt`, `$T/various/07-algebra-worked-example.txt`.

### Technical details
- Local indices in the printed trees: Blend's locals are `work n a b scale s i t7` (0–7), so `get#6` is `i` and `get#1` is `n`.

## Step 5: The guide's first draft

With the system read and the measurements in, I wrote the whole guide in one pass: Part 1 the system (revisions and what lies outside the hash, `Tx` and edit records, provenance and correspondence, `applyPass`, version 1, the memo, version 2, the rules and their evidence, the mutation results), Part 2 the measurements, Part 3 the design, Part 4 risks, falsification, future work and related work, Part 5 the plan. The design follows the measurements more than the brief's wording in one respect: since the validator re-derives without citations, it comes first and runs in shadow mode on O2, and the rule-citing variants come later, for provenance.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The guide's content list in the brief, every number with its source, related work only where certain.
**Inferred user intent:** A design an intern can implement and falsify.
**Commit (code):** none yet (committed after the second pass).

### What I did
- `docmgr doc add --ticket IRWB-008 --doc-type design-doc --title "Intern guide: exact checking for edits that cite verified rules, and version 2 of the meaning check for new pipelines"`, then wrote the document (30 sections).
- Checked two claims before relying on them: `Program.why` reads `origin[0]` only (`program.ts:469`), and the only read of `origin` in `src/typed/passes.ts` is `revisionCorrespondence` (`:140`); `sccp.ts`, `specialize.ts` and `analyses.ts` read none. So origins cannot change a pass's decisions, and a pipeline of citing variants makes O2's programs up to origins.

### Why
- Writing the whole draft before reviewing is the writing guidance's first pass; the review notes come next, separately.

### What worked
- The design's main pieces each rest on a measured or read fact: re-derivation (1,232 of 1,232), semantic part keys (the memo's closure keys, IRWB-004), citations in three places (the `algebra` edit), version 3's cost (an estimate from 0.419 ms per run, labelled as one).

### What didn't work
- Nothing failed.

### What I learned
- `Program.apply(pass, { check: false })` (`program.ts:256`) publishes a revision without any contract. An exact step applied after it would inherit no acceptance. The chain assumption of the design is therefore a real precondition, which the version 3 contract must check rather than assume.

### What was tricky to build
- Keeping three different "1,232"s apart: IRWB-006's 1,232 comparisons (616 steps, each compared twice) and this ticket's 1,232 re-derived edits (394 + 838) are unrelated. The draft used both; the review must remove the collision.

### What warrants a second pair of eyes
- The cost estimates for version 2 on Candela (section 21) assume a version 2 run costs what a version 1 run costs.

### What should be done in the future
- The second pass (Step 6).

### Code review instructions
- `$T/design-doc/01-intern-guide-exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-for-new-pipelines.md`.

### Technical details
- N/A.

## Step 6: Second pass: the draft reread as its reader, review notes before revising

I reread the whole draft (821 lines) as a newcomer would, writing down each place where a reader would ask "what is this for?", "which thing does this mean?" or "is that true?", and checking the claims that carry the argument against the code. The notes are below, split into comprehension gaps and technical corrections; the revision applies them all (Step 7).

The most consequential finding is a correction to the design itself. The draft made the version 3 check *require* that its input had been accepted, and listed a violated chain assumption as a risk. Rereading it against the memo's mechanics shows the requirement is unnecessary. A verdict is replayed only if it was decided on a closure with the same semantic key, so the chain argument is carried by the memo case by case, and a revision published with `check: false` simply has its cases run. The precondition becomes a property the existing reuse-on/reuse-off test already measures.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Second pass: reread it as its reader and revise."
**Inferred user intent:** A guide that a newcomer can follow without the author.
**Commit (code):** none.

### What I did
- Read the draft in four parts with the editor's reader, and checked: `Program.why` reads `origin[0]` only (`program.ts:469`); the evaluator counts executed statements (`++steps > limit`, `evaluate.ts:454`); `constprop` calls `tx.rewrite` once per block, not once per function (`passes.ts:296–297`); the prototype's re-derivation is lines 47–99 of script 01.

### Review notes: comprehension gaps
1. Introduction: "40 of 949 deliberately wrong programs" gives no context for 949. State that of 1,144 mutants, 949 were shown wrong on a specified input.
2. §11: "three ways", with a four-row table that follows.
3. §12: a reader will ask how the validator knows which table a pass used. Point forward to §17 ("any verified set will do").
4. §15: "roughly a three-hundredth" is vague and not quite the ratio (22 ms / 6,198 ms = 1/282). Give the two numbers.
5. §16 link 3 and §18: nothing says why inconclusive cases stay inconclusive after a derived step. The skeleton is unchanged and the evaluator counts executed statements, so the same statements run and the step limit is hit on the same cases. Say it in both places.
6. §17: `tree(after, s[k])` is ambiguous (whose `s`?), and the algorithm does not say what happens when every field's tree is structurally equal but ids differ. Name it "unchanged up to ids and origins".
7. §19 table header "what an error in it would need" reads oddly. Rename it "what would have to be wrong".
8. §20: "applies a table bottom-up to a fixed point" is wrong: `Tx.rewrite` makes one bottom-up walk and does not revisit a replacement. Say "in one bottom-up walk".
9. API references: Part 1 cites functions with line numbers, but nothing gives the implementer one table of the existing signatures to call. Add one to §30.
10. A short glossary at the end for the terms the design introduces (derived, residual, semantic key, skeleton, citation, version 1/2/3).

### Review notes: technical corrections
11. §9: "1,232 comparisons on the corpus" (IRWB-006: 616 steps compared twice) collides with this ticket's 1,232 re-derived edits. Rephrase IRWB-006's number as 616 steps.
12. §3: "`simplify`, `fold`, `constprop` and `strength` are all written as one call to it"; `constprop` calls it per block. Say "are written with it".
13. §3 table: `licm` also makes `retarget` edits (8 on the corpus).
14. §6: "No Typed check produces `checked-exact` today" needs its source (IRWB-002 item D3).
15. §8: "kills every mutant version 1 kills at the same count" is imprecise, because IRWB-005 step 5 found the gate non-monotone under the no-decided-case rule. Say instead that every disagreement version 1 finds, version 2 finds too.
16. §10: "33 of the 40 … loop forever (an increment `i + 1` became `i + 0`)": step 8 gives that as one cause of two. Say "for example".
17. §12 and §17: "about 60 lines" should be about 50.
18. §16, §17 trust table, §21 pseudocode and §22, §23 risks, §24 F6: the chain assumption, as above. Replace "require: input accepted" with replay-by-semantic-key, and make F6 the reuse-on/reuse-off identity test.
19. §21: "about a ninth of what version 2 would cost without keys": 54 / 290 is about a fifth.
20. §27 Phase 2 acceptance: add identical evidence with reuse on and off under version 3.

### What worked
- Every number in the draft was traced to its source file or diary step; besides items 11, 17 and 19, none needed correcting.

### What didn't work
- N/A.

### What I learned
- The memo makes the compositional argument mechanical. Each replayed verdict was decided on content with the same semantic key, so "r(k) agrees with r0 on C" holds case by case without a separate claim about the history of acceptance.
- Script 01's local strength order (`STRENGTH_ORDER`) puts `by-construction` above `reduced-width+argument`, the reverse of the guide's order. No re-derived edit fires rules from both tables, so the reported "weakest" counts are the same under either order.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- That memo replay alone carries the chain: this relies on the alias map holding only derivations, and on `closureKey` capturing every dependency, which is IRWB-004's open review point.

### What should be done in the future
- Apply the notes (Step 7).

### Code review instructions
- Compare the guide before and after the next commit.

### Technical details
- N/A.

## Step 7: Revision from the review notes, and IRWB-005's final numbers

I applied all twenty review notes of Step 6. While I was revising, the coordinator reported that IRWB-005 had finished and been merged into `irwb-001/import-v6-prototype`, with final head `bff08a6`, and that some of its numbers had changed after a deep search and a classification audit. I verified each figure in IRWB-005's diary at that commit (steps 19–22) and in its vault report (§5, §7.4, §15) before using it. The guide now cites `bff08a6` throughout.

### Prompt Context
**User prompt (verbatim):** see Step 1. Coordinator message (summarized): IRWB-005 merged, final head `bff08a6`. Use the final numbers from its diary up to step 22 and report §15: corpus 1,144 mutants, 192 equivalent; default 909 of 952 killed, 43 accepted, 83.1 %..95.5 %; 33 of the 43 diverge, 30 of them a loop increment made `+0`; version 2 accepts 5 (99.5 %) at about twice the default's time; Candela 96.8 % upper, 87.4 % lower being the safer figure; the five recommendations of report §15 are undecided and the user's, the first a correctness fix (records laid out by offset; `K` scrambled in the cases of 168 functions). No reply needed.
**Assistant interpretation:** Replace the `d9cf4e9` figures with verified final ones, and present the recommendations as the user's open decisions.
**Inferred user intent:** A guide that does not repeat superseded numbers.
**Commit (code):** see the commit after this step.

### What I did
- Read IRWB-005 at `bff08a6` through the shared repository from this worktree: its log of the last eight commits; its diary steps 19–22 and `various/13-candela-summary.txt` (TOTAL rows) at that commit; the source diff between `d9cf4e9` and `bff08a6` restricted to `src/` (empty, so the cited line numbers of `cases-strong.ts` stand, which a grep of that file at `bff08a6` confirmed); and §5, §7.4 and §15 of the IRWB-005 vault report (read only).
- Edits to the guide: the introduction (1,144 / 952 / 43 / 5); conventions (`bff08a6`); §3 (`constprop` calls `Tx.rewrite` per block; `licm` makes `retarget`); §6 (source of "no `checked-exact`"); §8 (superset of disagreements, not of kills); §9 (IRWB-006's 616 steps); §10 (final table, lower bounds, Candela follow-up, the five recommendations); §11 ("four ways"); §12 (50 lines; how the validator picks a table); §15 (22 ms against 6,198 ms); §16 (step limit; the chain carried by replay, `check: false`); §17 (notation, "unchanged up to ids", trust-table row for the memo); §18 (two more safety points); §19 (table header); §20 ("one bottom-up walk"); §21 (no `require` line; "a fifth"); §22 (replay chain); §23 (risk: memo keys); §24 (F4 thresholds 99.5 % / 99.9 % / 97.2 %; F6 reuse identity); §27 (rebase onto the merged branch; F6 in Phase 2); §29 (open question 6); §30 (existing-API table); §31 (glossary).
- A grep of the guide for stale figures and phrases (`99.8`, `95.8`, `97.3`, `97.7`, `97.6`, `d9cf4e9`, "accepted revision", "assumption", "ninth", "60 lines", "three ways", "1,232 comparisons", "fixed point"): only intended occurrences remain.

### Why
- The final figures supersede the earlier ones. The deep search found 3 more wrong mutants on the corpus (95.8 % → 95.5 %; version 2 99.8 % → 99.5 %), and the audit moved 29 Candela mutants from equivalent to wrong (97.3 % → 96.8 %; version 2 97.7 % → 97.2 %).

### What worked
- Verified final figures:
  - Corpus, default gate: 909 killed, 43 wrong, 192 equivalent (26 proved, 24 specification-only, 142 presumed), 83.1 %..95.5 %.
  - Wrong mutants accepted per gate on the final records: default 43, default80 40, check100 39, strong-cases 39, default+div 10, strong 5, strong-cov 5 (step 20).
  - Candela TOTAL rows: default 3,429 / 114 / 388, 87.4 %..96.8 %; check100 67, 98.1 %; strong 100, 97.2 %; default+div 113, 96.8 % (step 19).
  - Follow-up on `s9_sdf_0` and `s10_mat_1`: 400 random cases kill 180 of 242, version 2 120, coverage 121, default 110 (step 21).
  - Report §5: 30 of the 33 divergent mutants are `const −1` on a loop increment.

### What didn't work
- My first attempt to append this step with a shell heredoc was refused by the worktree isolation check ("this command names git in a form too complex to verify that it stays inside the worktree"), because the step's text quoted git commands; appended with the editor instead.
- My first edit of §10 said version 2 "already contains the first four" recommendations. Recommendation 4 lists three NaNs, and version 2's `F32_EXTRA` has two of them (0xffc00000 and 0x7fa00000, not 0x7fc00001). I corrected it to "the first three, and two of the fourth's three NaNs".

### What I learned
- The held-out r0 measurement (96.2 % / 99.9 %, step 12) was not deep-searched, so it is not directly comparable with the heads' final 95.5 % / 99.5 %. The guide says so in the table.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The F4 threshold for Candela (97.2 % upper) inherits the unresolved presumed equivalents there; IRWB-005 names 87.4 % (lower) as the safer figure.

### What should be done in the future
- docmgr bookkeeping, commit, upload (Step 8).

### Code review instructions
- Diff the guide between the next commit and `635d2ff`.

### Technical details
- N/A.

## Step 8: Bookkeeping, commit, upload; the vault report deferred

Milestone entry. The ticket's bookkeeping was completed and committed, and the guide was uploaded and verified in the cloud. This round ends here, as briefed: nothing under `src/`, `tests/` or `tools/` changed.

- **Bookkeeping:** `docmgr doc relate` (7 files on the guide); `docmgr task add` (the guide round, Phases 0–5, the user's decisions); `docmgr changelog update`; the overview in `index.md`; `docmgr doctor --ticket IRWB-008 --stale-after 30`: all checks passed.
- **Commit:** `16e06b8` — "IRWB-008: intern guide (…), second pass, IRWB-005 final numbers at bff08a6; phase tasks, changelog, overview; diary steps 5-7" (ticket files only). Earlier: `635d2ff` (measurements, diary steps 1–4).
- **Upload:** `remarquee upload bundle <guide.md> --name "IRWB-008 Intern Guide: Exact Checking for Verified Rules" --remote-dir "/ai/2026/11/26/IRWB-008" --toc-depth 2 --non-interactive` → `OK: uploaded IRWB-008 Intern Guide: Exact Checking for Verified Rules.pdf -> /ai/2026/11/26/IRWB-008`. Verified: `remarquee cloud ls /ai/2026/11/26/IRWB-008 --non-interactive` → `[f] IRWB-008 Intern Guide: Exact Checking for Verified Rules`. No `--force`.
- **Vault report: deferred.** The coordinator first relayed a request for a vault report after the upload, then withdrew it (summarized: for IRWB-007 to IRWB-011 the vault report comes only after the implementation, not after the guide round). The report is deferred to the implementation milestone. No file was created in the vault under `Projects/2026/11/26/` or `_assets/irwb008-*`, so nothing had to be deleted.
- **Task:** `cgxs` (guide round) checked; Phases 0–5 and the user's decisions stay open.
