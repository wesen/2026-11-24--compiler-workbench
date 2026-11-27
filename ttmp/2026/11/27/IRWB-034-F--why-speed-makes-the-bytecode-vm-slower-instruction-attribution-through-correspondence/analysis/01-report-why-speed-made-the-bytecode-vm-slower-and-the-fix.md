---
Title: 'Report: why speed made the bytecode VM slower, and the fix'
Ticket: IRWB-034-F
Status: active
Topics:
    - compiler
    - performance
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/attribution.ts
      Note: attributeInstructions and attributeSteps
    - Path: repo://src/typed/passes.ts
      Note: loopsByHead and licm
    - Path: repo://src/typed/program.ts
      Note: Program.attribute
    - Path: repo://tests/typed/attribution.test.mjs
      Note: the attribution's tests and the VM pin
ExternalSources: []
Summary: licm handled a loop head with nine back edges as nine loops and put its preheader on the back edges; the attribution finds it from the revisions' records; licm now merges loops by head and hoists each expression once.
LastUpdated: 2026-11-27T12:00:00-05:00
WhatFor: The results of IRWB-034-F
WhenToUse: When reading or reusing src/typed/attribution.ts, or the licm change
---

# Report: why speed made the bytecode VM slower, and the fix

## Summary

- **Cause.** The VM's dispatch loop `while (true)` has one head (`bb:runVm.3`) and nine back edges, one per
  opcode arm. The `typed.loops` fact lists one natural loop per back edge, all with the id
  `loop:runVm@bb:runVm.3`. `licm` treated each as its own loop: for each it built a preheader and redirected
  every predecessor of the head outside *that* loop's partial body, which included the other eight latches. The
  nine preheaders formed a chain on the back edges, so the 15 hoisted frame addresses (and a jump) ran on every
  guest instruction instead of once per call, and held ten callee-saved registers.
- **Fix** (`src/typed/passes.ts`, licm only, `loopsByHead`): treat each head once, as the union of its
  back-edge loops: one body, one set of assigned locals, one preheader outside all of them. A head with one back
  edge is handled exactly as before.
- **Attribution** (`src/typed/attribution.ts`): credits every executed instruction of the last image and debits
  every executed instruction of the first to a pass decision, from the instructions' covers, the revisions'
  correspondences and their edit logs. The nets sum exactly to the difference. Callable as
  `attributeInstructions`, `attributeSteps`, or `Program.attribute(cases, { from, to, backend, steps })`.


## The bytecode VM, n = 12, seed = 8 (measured, `scripts/05-vm-fixtures.mjs`)

| backend | revision | Fibonacci before | after | checksum before | after |
| --- | --- | ---: | ---: | ---: | ---: |
| coalesce | r0 | 7,678 | 7,678 | 6,874 | 6,874 |
| coalesce | O2 | 9,286 | 6,382 | 8,218 | 5,710 |
| coalesce | speed | 9,286 | 6,382 | 8,218 | 5,710 |
| default | r0 | 7,863 | 7,863 | 7,035 | 7,035 |
| default | O2 | 9,287 | 6,383 | 8,219 | 5,711 |
| default | speed | 9,287 | 6,383 | 8,219 | 5,711 |

Results are unchanged (1,152 and 1,298,667,478). O2 had the same slowdown: it runs the same licm. Over all 442
valid calls `speed` is faster than r0 except at n = 0 (four guest instructions), where it costs 178 against 166:
the 15 hoisted addresses and the ten callee saves they occupy are a per-call prologue that four dispatches do
not earn back. `tests/typed/bytecode-vm.test.mjs` now pins that: the calls slower than r0 are exactly the n = 0
ones.

## The attribution

### Method

`attributeInstructions(chain, cases, backend)` lowers the first and the last revision of a chain with the same
backend options and runs both on the cases with per-instruction counts.

- Every executed instruction names the typed.blocks entities it implements (`covers`). For an entity of the
  last revision, its **lineage** walks the chain backwards: a correspondence entry that derives it from other
  entities is a decision of that step; a `retained` entry continues with the same id, but the step's **edit
  log** is read for in-place edits of it (`replace`, `retarget`, `move`, `insert`), which the correspondence
  does not show. For an entity of the first revision, its **fate** is the first step that removes it, derives
  something from it or edits it.
- A decision is `(revision, pass, sorted because)`: for licm the loop id and the hoisted `set` statement, so
  each hoist is its own decision.
- An instruction of the last image is credited to the earliest decision in its covers' lineage; one of the first
  image is debited to the earliest fate. No decision: `unchanged`. Only `fn:` covers (prologue, saves, restores,
  return): `frame <fn>`. Every executed instruction is counted exactly once on its side, so the nets sum to the
  difference of the totals exactly (tested).
- `attributeSteps` applies the same function to each consecutive pair of revisions. Its per-step nets equal the
  difference of consecutive images, which is what replaying the pipeline pass by pass measures (tested for every
  step of the VM under `speed`).

### The table: bytecode VM under `speed`, before the fix, step by step (both fixtures, coalesce)

From `scripts/results/04-before-fix.txt`. Steps r5 and r6 (subst) change nothing; r1 to r3 and r7 are listed by
pass total.

| step | decision | net | credit | debit |
| --- | --- | ---: | ---: | ---: |
| r1 cfg | jump threading, removed jumps and retargets | -1,210 | | |
| r2 fold | | -344 | | |
| r3 cfg | | -342 | | |
| **r4 licm** | **15 hoists `[loop:runVm@bb:runVm.3, s:runVm.<set>]`** | **+4,490** | 5,124 | 634 |
| r4 licm | the new preheader blocks' jumps (`inserted`) | +344 | 1,542 | 1,198 |
| r4 licm | `frame runVm` (10 saves + 10 restores, per fixture) | +40 | 46 | 6 |
| r4 licm | replaced addresses and retargeted back edges `[loop:runVm@bb:runVm.3]` | -24 | 1,086 | 1,110 |
| r4 licm | total | **+4,850** | | |
| r7 cfg | merging the preheader chain | -2 | | |
| all | r0 14,552 -> 17,504 | +2,952 | | |

Each hoist is credited 344 executions: once per guest instruction (184 + 160), not once per call. Its debit
(12 to 124) is the in-body address computation it replaced, which ran only in one opcode arm. After the fix
(`results/04-after-merge.txt`) each of the 15 hoists is credited 2 (once per call per fixture), the licm step is
-564, and the whole chain is 14,552 -> 12,092 (-2,460).

### Whole chain against step by step

The whole-chain attribution follows each instruction through every pass to r0 (the new approach). Its per-pass
sums before the fix: licm +4,516, cfg r1 -1,260, fold -688, cfg r7 +342, cfg r3 +2, frame +40; the replay says
licm +4,850, cfg r7 -2, cfg r3 -342. The total is exact, but the earliest-change rule gives a term to the first
pass that touched a statement: r3's removal of a jump goes to r1, which had retargeted it, and r7 cfg's move of
the head's statements into the merged preheader block is credited to r7. The whole-chain view answers "which
decision made this instruction differ from r0"; the step view answers "what did this pass cost". Both are kept,
one implementation.

### The attribution on another project

The licm change was first tried with a second part (hoist each distinct expression once, below). On `orders`
it made O2 slower by 48 instructions under `coalesce: true`. `scripts/08-attribute-project.mjs orders O2
'{"coalesce":true}' licm` found it in one run: the row `r7 licm [loop:kernel@bb:kernel.1] {replace}` kept 58
executions of `addi t3, t2, 0`, the copy `a = inv`, which subst could no longer remove because the shared local
had two readers. Without the second part the same row has no credit and a net of -116.

## The fix and its reason

`typed.loops` reports one natural loop per back edge. `licm` now groups those by head (`loopsByHead`): the
union body, the union of assigned locals (at least as conservative as any part, so every hoist that was valid
remains valid), and a preheader recomputed against the union body. The VM's dispatch loop then has its preheader
in the entry block, and each hoist runs once per call.

Alternatives, measured where it was cheap (`scripts/06-guard-variant.mjs`, coalesce):

| variant | Fibonacci n=12 | checksum n=12 | n=0 | corpus |
| --- | ---: | ---: | ---: | --- |
| r0 | 7,678 | 6,874 | 166 | |
| guard: skip a shared head (here: speed without licm) | 6,688 | 5,968 | 148 | not measured |
| **merge (committed)** | **6,382** | **5,710** | 178 | no project worse |
| merge + hoist once (`scripts/09-licm-hoist-once.patch`) | 6,349 | 5,677 | 145 | five projects better, `orders` +48 with coalesce |

The guard is simplest and never worse than r0 on the VM, but gives up 306 and 258 instructions at n = 12. Merging
in `typed.loops` itself was not done: the fact has one `latch` per loop, the workbench lists the fact, and rotate
already de-duplicates by head.

## Corpus: instructions per project, before and after (measured, `scripts/03-corpus-measure.mjs`)

Cases: the `typed.metrics` cases, 10 per function, seed 7, generated from r0 so all revisions run the same
calls; a run at the step limit would cost the limit (none did). Default backend; the coalesce columns are in the
JSON. Before = `results/03-baseline.log`, after = `results/03-final.log`.

Only two projects change, both faster, under both backends and both pipelines (`scripts/07-compare.mjs`):

- bytecode-vm: O2 47,076 -> 32,625 (default), 47,066 -> 32,615 (coalesce); speed the same.
- regex-nfa: O2 47,739 -> 45,114 and 47,491 -> 44,866; speed 41,147 -> 39,397 and 40,594 -> 38,844. Its
  O2 was also slower than r0 (41,650) before; it is still slower than r0 under O2 after, but not under speed.
- chess-search also has a head with several back edges where licm runs; nothing it hoists changes.
- No project is slower; no pass is rejected in either pipeline.

Totals:

| backend | projects | r0 | O2 before | O2 after | speed before | speed after |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| default | all 50 projects | 1,123,009 | 1,124,912 | 1,107,836 | 892,944 | 876,743 |
| default | the 49 others | 1,083,055 | 1,077,836 | 1,075,211 | 845,868 | 844,118 |
| coalesce | all 50 projects | 1,090,094 | 1,092,892 | 1,075,816 | 862,113 | 845,912 |
| coalesce | the 49 others | 1,051,073 | 1,045,826 | 1,043,201 | 815,047 | 813,297 |

Per project (default backend):

| project | r0 | O2 before | O2 after | speed before | speed after |
| --- | ---: | ---: | ---: | ---: | ---: |
| across-calls | 660 | 640 | 640 | 270 | 270 |
| algebra | 100 | 20 | 20 | 20 | 20 |
| blend | 2255 | 1925 | 1925 | 1915 | 1915 |
| bounds-lab | 5923 | 5333 | 5333 | 5012 | 5012 |
| bounds-offset | 1364 | 1364 | 1364 | 1355 | 1355 |
| bounds-param | 502 | 502 | 502 | 499 | 499 |
| bounds-two | 910 | 810 | 810 | 756 | 756 |
| branches | 165 | 139 | 139 | 139 | 139 |
| bytecode-vm | 39954 | 47076 | 32625 | 47076 | 32625 |
| call-chain | 1050 | 1050 | 1050 | 350 | 350 |
| calls | 651 | 651 | 651 | 288 | 288 |
| checksum | 1710 | 1410 | 1410 | 1251 | 1251 |
| chess-search | 432856 | 424927 | 424927 | 329320 | 329320 |
| collatz | 7461 | 7461 | 7461 | 6955 | 6955 |
| constants | 100 | 70 | 70 | 70 | 70 |
| dead-code | 110 | 30 | 30 | 30 | 30 |
| diagnostics | 30 | 30 | 30 | 30 | 30 |
| distinct | 340 | 340 | 340 | 80 | 80 |
| div-checks | 172 | 162 | 162 | 162 | 162 |
| div-magic | 729 | 769 | 769 | 759 | 759 |
| early-exit | 761 | 631 | 631 | 564 | 564 |
| f32-dsp | 49706 | 49030 | 49030 | 46361 | 46361 |
| first-steps | 280 | 220 | 220 | 80 | 80 |
| fixed-point | 429 | 411 | 411 | 251 | 251 |
| fragments | 2697 | 2299 | 2299 | 2289 | 2289 |
| gcd | 324 | 324 | 324 | 314 | 314 |
| heat-lab | 8832 | 8832 | 8832 | 8664 | 8664 |
| histogram | 2416 | 2292 | 2292 | 2222 | 2222 |
| licm-nested | 2677 | 1678 | 1678 | 1631 | 1631 |
| licm-traps | 153 | 153 | 153 | 149 | 149 |
| lz-roundtrip | 33646 | 37654 | 37654 | 28925 | 28925 |
| match-enum | 282 | 251 | 251 | 251 | 251 |
| my-analysis | 200975 | 200975 | 200975 | 200966 | 200966 |
| my-first-pass | 60 | 50 | 50 | 50 | 50 |
| nested-loops | 2634 | 2342 | 2342 | 2289 | 2289 |
| orders | 1350 | 1204 | 1204 | 1195 | 1195 |
| params-demo | 2697 | 2299 | 2299 | 2289 | 2289 |
| pressure | 280 | 240 | 240 | 240 | 240 |
| ramp | 1180 | 1040 | 1040 | 962 | 962 |
| records | 260 | 260 | 260 | 260 | 260 |
| regalloc-lab | 2614 | 2614 | 2614 | 2051 | 2051 |
| regex-nfa | 41650 | 47739 | 45114 | 41147 | 39397 |
| sha-chacha | 239636 | 240190 | 240190 | 128181 | 128181 |
| sort | 5043 | 5043 | 5043 | 4950 | 4950 |
| start-here | 4385 | 3871 | 3871 | 2932 | 2932 |
| strength | 2220 | 1938 | 1938 | 1793 | 1793 |
| strings | 11895 | 10833 | 10833 | 10283 | 10283 |
| ui-gallery | 1214 | 1058 | 1058 | 754 | 754 |
| value-numbering | 3721 | 3082 | 3082 | 3073 | 3073 |
| wrong-shift | 1950 | 1650 | 1650 | 1491 | 1491 |

## Parity and tests (measured)

- `node tools/parity.mjs` (every pass checked against r0 on 40 cases, then 100 cases of the head against r0):
  50 projects, 135 functions, 8,286 decided, 8,286 agree, 14 at the step limit, 0 failures
  (`results/parity-final.txt`).
- `node tools/reference-check.mjs --o2` (our O2 images against the evaluator): 83 functions, 8,286 decided,
  8,286 agree (`results/reference-o2-final.txt`).
- `tests/typed/*.test.mjs`: 155 tests, 152 pass, 2 skipped, 1 failed: the tile-width check on
  `corpus/projects/bytecode-vm/notes.md`, whose paragraph I had rewritten (74 columns). Rewrapped;
  `tests/typed/format.test.mjs` then passes 5/5 (`results/tests-typed-final.txt`).
- `tests/framework/*.test.mjs` 234/234; `tests/workbench/*.test.mjs` 24 pass, 0 fail (one skipped); the new
  `tests/typed/attribution.test.mjs` 4/4; `tests/typed/bytecode-vm.test.mjs` 3/3.
- `node tools/build-site.mjs` builds (50 projects).

## Framework changes

None. The attribution reads the framework's `EntityCorrespondence` records and Typed's own edit logs; licm is a
Typed pass. `Program.attribute` is a method on the Typed program handle. `node tools/build-site.mjs` builds.

## Measured and argued

- Measured: every count in this report (emulator steps), the attribution tables, the replay cross-check, the
  corpus tables, parity, tests.
- Argued, not measured: that the union of assigned locals keeps every hoist valid (each pass is also checked by
  the meaning contract against r0 on 40 cases, and parity checks 100 more); that the per-call prologue is the
  only reason n = 0 is slower (the attribution shows +40 `frame` and 15 hoists credited 2 each, against
  debits of zero at n = 0, but the n = 0 table was not printed); that the `frame` term is register pressure from
  the hoisted locals (the allocator does not record why it takes a callee-saved register).

## Left out

- Merged loops in `typed.loops` (version 2): changes the fact, its view and its consumers for one consumer.
- Recording in-place edits as correspondence entries, so `whyEntity` sees them: changes every revision's
  correspondence, which `tests/typed/rules.test.mjs` pins; the attribution reads the edit log instead.
- Hoist-once: one project regressed; kept as a patch.
- Attributing `frame` instructions to the decision whose live ranges caused them: needs the allocator's reasons.

## Later

- Missed-optimization reports from provenance, on the per-instruction rows (`Attribution.insns[].steps`).
- Hoist-once with a way to forward the copies of the shared local (the `orders` case).
- A cost check for hoisting cheap expressions (a frame address is one `addi`) against the registers they hold.

