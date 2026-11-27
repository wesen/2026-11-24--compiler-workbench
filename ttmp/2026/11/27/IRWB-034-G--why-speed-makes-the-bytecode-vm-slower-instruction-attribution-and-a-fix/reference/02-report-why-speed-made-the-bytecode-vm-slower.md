---
Title: 'Report: why speed made the bytecode VM slower'
Ticket: IRWB-034-G
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Attribution table, cause, fix and corpus measurements
LastUpdated: 2026-11-27T10:07:25.362623561-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: why speed made the bytecode VM slower

## Summary

- **Cause.** `typed.loops` returned one loop per back edge. The VM's dispatch loop has one header and nine back
  edges, so licm saw nine loops with the same header and id. It made a preheader for each and sent to it every
  jump to the header from outside *that* loop's body, which includes the other eight back edges. The nine
  preheaders, with the fifteen statements licm hoisted into them, ended up on the back edges and ran on every
  dispatch: +2,599 instructions for Fibonacci at n = 12, seed = 8, against a pipeline that otherwise saves 991.
- **Fix.** Three changes, each needed by a measurement. (1) `typed.loops` returns one natural loop per header (the
  union over its back edges): the VM's preheader is then the entry block and hoisted statements run once. (2) licm
  gives structurally equal invariant trees of a loop one local instead of one per use: with (1) alone the
  now-effective hoisting spilled 20 values in regex-nfa's matcher. (3) The coalescer lets two copies of one
  register share it: (2) exposed that limit in one project.
- **Result.** Fibonacci 9,286 to 6,349 and checksum 8,218 to 5,677 under `speed` and under O2 (r0: 7,678 and
  6,874). Eight of the 50 corpus projects change, all downwards; no project is higher under O2 or `speed` with
  either backend option set (totals: O2 1,124,912 to 1,090,271, `speed` 892,944 to 867,770 with the default
  options); parity is clean.
- **Tool.** `attributeSteps` (`src/typed/attribute.ts`) and `tools/attribute.mjs` credit the difference in
  executed instructions to pass decisions with sums that equal the emulator's counts.

## The attribution

### Method

`attributeSteps(revisions, call, { backend })` takes a chain of published revisions (`Program.revisions`) and one
call that finishes on each. For every revision it lowers the program, runs the call with per-instruction counts,
and sums the counts per site: the statement an instruction covers (`covers`, the backend's record), `frame` for
instructions that cover only their function, `backend` for those that cover nothing. For each pass step it joins
the sites of the two revisions (the same statement id; a statement made by `replaceStmt` with the one it
replaced), takes each group's difference, and labels the group with the decision the pass's edit records give
for those statements: the edit kinds, the note of the edit or of the new statement's origin, and the `because`
ids. A group whose count changed with no edit is the pass's indirect effect (the same statement compiled
differently).

The rows of a step sum to the emulator's difference for that step and the steps sum to head minus r0. The test
asserts both, and that each total equals `runImage(...).steps` for that revision.

`node tools/attribute.mjs bytecode-vm speed runVm --input '{"entry":0,"n":12,"seed":8}' --coalesce --rows`

### The table, before the fix

Fibonacci, n = 12, seed = 8, `coalesce: true`, the compiler as it was (`various/attribution-before-fib.txt`; the
checksum's table has the same shape with 160 dispatches instead of 184, `attribution-before-checksum.txt`).

| Revision | Instructions | Step |
| --- | ---: | ---: |
| r0 ingest | 7,678 | |
| r1 cfg | 7,055 | -623 |
| r2 fold | 6,871 | -184 |
| r3 cfg | 6,688 | -183 |
| r4 licm | 9,287 | +2,599 |
| r5 subst | 9,287 | 0 |
| r6 subst | 9,287 | 0 |
| r7 cfg | 9,286 | -1 |

| Decision | Difference | Runs after the pass | Groups |
| --- | ---: | ---: | ---: |
| licm: insert (hoisted out of loop:runVm@bb:runVm.3) | +2,748 | 2,748 | 15 |
| licm: insert (the jump of the last preheader, `goto .3`) | +184 | 184 | 1 |
| subst: replace | +184 | 2,024 | 2 |
| cfg: move | +183 | 4,783 | 16 |
| licm: indirect, frame | +20 | 23 | 1 |
| cfg: merges, licm: insert+retarget (four rows) | 0 | 0 | 14 |
| licm: retarget | -12 | 160 | 9 |
| licm: replace+retarget | -13 | 52 | 1 |
| cfg: replaceStmt | -184 | 0 | 1 |
| fold: replace | -184 | 184 | 1 |
| subst: remove (substituted into its only reader) | -184 | 0 | 2 |
| licm: replace | -328 | 1,008 | 14 |
| cfg: indirect | -367 | 0 | 2 |
| cfg: retarget | -439 | 1,353 | 47 |
| **sum** | **+1,608** | | |

Reading it:

- The fifteen hoisted statements (`inv = frame+0`, `inv1 = frame+16`, ...) are one instruction each. Fourteen run
  184 times and one 172 times: once per dispatch. A hoisted statement should run once per call.
- The row detail (`--rows`) names them and their reason, `loop:runVm@bb:runVm.3`, the same id for all nine loops.
- What licm gained is the `licm: replace` row: 14 uses that no longer compute the frame address, -328.
- licm's own step is +2,748 +184 +20 -12 -13 -328 = +2,599. All other passes together are -991.
- It is not register pressure: `licm: indirect, frame` is +20 (callee-saved registers saved and restored once).

### The table, after the fix

| Revision | Instructions | Step |
| --- | ---: | ---: |
| r0 ingest | 7,678 | |
| r1 cfg | 7,055 | -623 |
| r2 fold | 6,871 | -184 |
| r3 cfg | 6,688 | -183 |
| r4 licm | 6,349 | -339 |
| r5, r6 subst | 6,349 | 0 |

| Decision | Difference | Runs after the pass | Groups |
| --- | ---: | ---: | ---: |
| subst: replace | +184 | 2,024 | 2 |
| licm: insert (hoisted out of loop:runVm@bb:runVm.3) | +2 | 2 | 2 |
| cfg: indirect | -183 | 0 | 1 |
| cfg: replaceStmt | -184 | 0 | 1 |
| fold: replace | -184 | 184 | 1 |
| subst: remove (substituted into its only reader) | -184 | 0 | 2 |
| licm: replace | -341 | 1,060 | 15 |
| cfg: retarget | -439 | 1,353 | 46 |
| **sum** | **-1,329** | | |

Two hoisted statements (`frame+0`, `frame+16`), two instructions per call
(`various/attribution-after-fib.txt`). With the loops change alone the table had 15 hoisted statements at 15
instructions and `licm: indirect, frame` at +20, for 6,382.

## The fix and its reasons

### 1. One loop per header (`loopsOf`, `src/typed/analyses.ts`)

Back edges are grouped by header. `body` is the union of the back edges' bodies, `latches` lists every back-edge
source, `latch` stays (the first, for existing readers), and `exits`, `assigned` and `preheader` are computed
against the union. `typed.loops` is version 2.

- Reason: a natural loop is a property of a header. With one loop per back edge, a block that is in the loop
  (another arm's latch) counted as outside it, and licm's "retarget every jump from outside the body to the
  preheader" moved the preheader into the loop. The output was still correct (each per-edge loop was treated
  consistently with its own body, and the meaning checks passed); it was slower.
- The alternative of guarding licm (skip headers with several back edges) would leave the VM at the counts
  before licm, 6,688 and 5,968, and keep nine loops with one id in the analysis and in the workbench's loop
  view. The union is the textbook definition and gives 6,382 and 5,710.
- rotate already handled each header once.
- The book (`corpus/book/08-control.md`) and the reference (`corpus/reference.md`) described one loop per back
  edge; both now say one per head and list `latches`.

Measured alone (`various/corpus-after-loops.json`): two projects change. The VM falls; regex-nfa falls in three
cells and rises in one, O2 with the tuned options, 41,695 to 45,933. So this change alone does not meet "no
regression".

### 2. licm shares a local among equal invariant trees (`src/typed/passes.ts`)

Within one loop, invariant trees with the same structure (operator, immediate, type, operands) are hoisted
into one local; each use reads it. `share: false` as a pass parameter gives the old local per use.

- Reason: licm made a local per hoisted use. In the VM that is fifteen locals for two values; in
  `regex-nfa.regexMatch`, now that its multi-latch loops are hoisted out of properly, the locals are live across
  the loops and the allocator spills 20 values (`scripts/08-orders-share.mjs regex-nfa O2`: frame 416, 20
  spills; with sharing frame 368, 6 spills; 45,899 against 38,711 instructions over the seeded cases).
- Equal trees over operands the loop does not assign have equal values at the preheader, so one evaluation
  serves all uses.
- The simplest alternative is to leave it to lvn, which runs after licm in O2. It did not merge them: with the
  loops change alone the VM's fifteen locals were still there at the end of the pipeline.

### 3. The coalescer accepts two copies of one register (`src/typed/backend/coalesce.ts`)

At a copy `rd <- rs`, a register that an earlier copy in the same block set from the same `rs`, with neither side
redefined since, holds the value `rd` receives; the definition no longer makes the two interfere.

- Reason: sharing turned `a = inv; b = inv1` into `a = inv; b = inv` in `orders.kernel`. The coalescer merged
  `a` with `inv` and then refused `b`, because `b` is defined while `a` is live. One copy stayed in the loop:
  orders rose by 48 instructions under the tuned options (962 to 1,010 under `speed`).
- The argument is the one for the existing exception (a copy does not interfere with its source): at this
  definition both registers hold the same value. Later redefinitions add their own edges as before.
- It applies only under the `coalesce` option; default images are unchanged.
- After it, orders under the tuned options is 1,010 under O2 (from 1,020) and 952 under `speed` (from 962).

## The bytecode VM, n = 12, seed = 8, `coalesce: true`

| Fixture | r0 | O2 before | O2 after | speed before | speed after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fibonacci | 7,678 | 9,286 | 6,349 | 9,286 | 6,349 |
| Checksum | 6,874 | 8,218 | 5,677 | 8,218 | 5,677 |

(`scripts/01-per-pass-steps.mjs`, output in `various/per-pass-after.txt`; "before" from the same script at
commit 85889a1, recorded in the design.) Per guest instruction: 34.5 and 35.5 RV32 instructions, from 50.5 and
51.4. The image is 772 bytes (r0 840, before 904). O2 and `speed` are the same program here: there is nothing to
inline and no loop to rotate.

## Corpus: instructions per project

Summed over the seeded cases `measure` uses (10 per function, seed 7), `scripts/03-corpus-measure.mjs`.
"tuned" is chains + coalesce + homes. A cell with an arrow changed (before → after); every other cell is
identical before and after.

| Project | r0 | r0 tuned | O2 | O2 tuned | speed | speed tuned |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| across-calls | 660 | 630 | 640 | 630 | 270 | 210 |
| algebra | 100 | 100 | 20 | 20 | 20 | 20 |
| blend | 2,255 | 2,080 | 1,925 | 1,750 | 1,915 | 1,585 |
| bounds-lab | 5,923 | 5,495 | 5,333 | 4,905 → 4,843 | 5,012 | 4,426 |
| bounds-offset | 1,364 | 1,268 | 1,364 | 1,268 | 1,355 | 1,258 |
| bounds-param | 502 | 452 | 502 | 452 | 499 | 408 |
| bounds-two | 910 | 860 | 810 | 760 → 710 | 756 | 665 |
| branches | 165 | 148 | 139 | 131 | 139 | 131 |
| bytecode-vm | 39,954 | 29,483 | 47,076 → 32,295 | 42,809 → 24,750 | 47,076 → 32,295 | 42,809 → 24,750 |
| call-chain | 1,050 | 1,050 | 1,050 | 1,050 | 350 | 290 |
| calls | 651 | 580 | 651 | 580 | 288 | 227 |
| checksum | 1,710 | 1,560 | 1,410 | 1,260 | 1,251 | 1,110 |
| chess-search | 432,856 | 412,676 | 424,927 → 423,077 | 407,383 → 406,477 | 329,320 → 327,316 | 298,300 → 297,382 |
| collatz | 7,461 | 5,779 | 7,461 | 5,779 | 6,955 | 5,769 |
| constants | 100 | 100 | 70 | 70 | 70 | 70 |
| dead-code | 110 | 100 | 30 | 30 | 30 | 30 |
| diagnostics | 30 | 30 | 30 | 30 | 30 | 30 |
| distinct | 340 | 340 | 340 | 340 | 80 | 60 |
| div-checks | 172 | 152 | 162 | 152 | 162 | 152 |
| div-magic | 729 | 670 | 769 | 710 | 759 | 661 |
| early-exit | 761 | 689 | 631 | 559 | 564 | 557 |
| f32-dsp | 49,706 | 48,551 | 49,030 | 47,923 | 46,361 | 44,107 |
| first-steps | 280 | 280 | 220 | 220 | 80 | 80 |
| fixed-point | 429 | 410 | 411 | 392 | 251 | 242 |
| fragments | 2,697 | 2,488 | 2,299 | 2,090 | 2,289 | 1,891 |
| gcd | 324 | 314 | 324 | 314 | 314 | 265 |
| heat-lab | 8,832 | 8,026 | 8,832 | 8,026 | 8,664 | 7,996 |
| histogram | 2,416 | 2,132 | 2,292 | 2,008 | 2,222 | 2,000 |
| licm-nested | 2,677 | 2,677 | 1,678 | 1,678 | 1,631 | 1,596 |
| licm-traps | 153 | 153 | 153 | 153 | 149 | 142 |
| lz-roundtrip | 33,646 | 32,210 | 37,654 → 34,551 | 34,325 → 33,660 | 28,925 → 28,745 | 28,510 → 28,330 |
| match-enum | 282 | 239 | 251 | 226 | 251 | 226 |
| my-analysis | 200,975 | 200,795 | 200,975 | 200,795 | 200,966 | 200,618 |
| my-first-pass | 60 | 60 | 50 | 50 | 50 | 50 |
| nested-loops | 2,634 | 2,634 | 2,342 | 2,342 | 2,289 | 2,252 |
| orders | 1,350 | 1,272 | 1,204 → 1,194 | 1,020 → 1,010 | 1,195 → 1,185 | 962 → 952 |
| params-demo | 2,697 | 2,488 | 2,299 | 2,090 | 2,289 | 1,891 |
| pressure | 280 | 280 | 240 | 230 | 240 | 230 |
| ramp | 1,180 | 1,050 | 1,040 | 790 | 962 | 780 |
| records | 260 | 240 | 260 | 240 | 260 | 240 |
| regalloc-lab | 2,614 | 2,472 | 2,614 | 2,462 | 2,051 | 1,716 |
| regex-nfa | 41,650 | 37,294 | 47,739 → 40,212 | 41,695 → 38,745 | 41,147 → 35,638 | 38,679 → 28,128 |
| sha-chacha | 239,636 | 213,138 | 240,190 → 232,820 | 212,640 → 211,526 | 128,181 → 125,491 | 108,912 → 107,102 |
| sort | 5,043 | 4,589 | 5,043 | 4,589 | 4,950 | 4,563 |
| start-here | 4,385 | 3,981 | 3,871 | 3,467 | 2,932 | 2,559 |
| strength | 2,220 | 1,792 | 1,938 | 1,414 | 1,793 | 1,404 |
| strings | 11,895 | 10,344 | 10,833 | 9,282 | 10,283 | 9,262 |
| ui-gallery | 1,214 | 1,172 | 1,058 | 1,016 | 754 | 594 |
| value-numbering | 3,721 | 3,092 | 3,082 | 2,666 | 3,073 | 2,453 |
| wrong-shift | 1,950 | 1,790 | 1,650 | 1,490 | 1,491 | 1,340 |
| **total** | 1,123,009 | 1,050,205 | 1,124,912 → 1,090,271 | 1,056,301 → 1,032,485 | 892,944 → 867,770 | 824,328 → 792,800 |

- 8 of 50 projects change; 42 are identical in all six cells. No cell is higher than before, and no pass was
  rejected in either pipeline (`various/corpus-table.txt`, from `corpus-before.json` and `corpus-after.json`).
- Totals: O2 -3.1% (default) and -2.3% (tuned); `speed` -2.8% and -3.8%. Without the VM: O2 1,077,836 to
  1,057,976 (default), `speed` 845,868 to 835,475 (default).
- bounds-lab and bounds-two change only under O2 with the tuned options. They were unchanged in the run with
  sharing and without the coalescer change (`corpus-after-share.json`), so that cell is the coalescer; so is
  sha-chacha's last step under `speed` tuned (108,862 to 107,102).
- Still above r0 after this work, all of them already so before: div-magic under O2 (769 against 729, and 710
  against 670 tuned) and under `speed` with the default options (759, unchanged), lz-roundtrip under O2 (34,551
  against 33,646; 33,660 against 32,210 tuned), regex-nfa under O2 with the tuned options (38,745 against
  37,294). Every other cell is at or below r0.


## Experiments

### licm variants (`scripts/06-licm-variants.mjs`, `scripts/08-orders-share.mjs`)

Measured on the whole corpus under `speed`, on top of the loops change, with unchecked passes
(`various/licm-variants-speed.json`; these runs predate the coalescer change):

| Variant | Total, default options | Total, tuned | Projects that differ from base |
| --- | ---: | ---: | --- |
| base (a local per hoisted use) | 877,151 | 809,497 | |
| share: one local per structurally equal invariant tree | 867,770 | 794,618 | 6: five lower, orders +48 tuned |
| leaves: a bare `frame+K` is not hoisted | 878,637 | 803,755 | 4: mixed (VM, lz, sha higher by default) |
| both | 876,623 | 802,885 | |

- **share** worked and is in the fix (section 2 above). I first kept it as an option, off, because of orders;
  the checked run of the loops change alone then showed regex-nfa rising without it, which reversed the decision
  and led to the coalescer change.
- **leaves** is a negative result: not hoisting the frame address helps where registers are short and costs one
  `addi` per use elsewhere. Removed from the code after the experiment.

### The static cost estimate as a guard (`scripts/05-estimate-vs-emulator.mjs`)

Question: would "reject a pass whose output has a higher static estimate" (`backend/frequency.ts`) have caught
this, and what else would it reject? Measured with the loops change alone (before sharing). Per function and
changed revision of `speed` over the corpus (658 steps,
`various/estimate-corpus.json`), the sign of the estimate's change against the emulator's:

| Estimate | Emulator up | Emulator down | Emulator same |
| --- | ---: | ---: | ---: |
| up | 39 | 65 | 25 |
| down | 3 | 219 | 76 |
| same | 0 | 0 | 231 |

- On the VM with the old loops the estimate did rise at licm (295.4 to 432.6, emulator 34,888 to 48,009):
  the guard would have caught the defect.
- It also rises at the correct licm (295.4 to 318.9, emulator 34,888 to 33,548) and at a cfg step that saves
  instructions (151.8 to 295.4). Over the corpus the guard would fire on 129 steps, and 65 of them are steps
  where the emulator count falls (rotate 39, inline 21). For licm alone: 20 steps, estimate up on 11 (5 of them
  emulator up), down on 9 (2 emulator up).
- Negative result as a gate: it rejects about as many improvements as regressions. The estimate was built to
  compare two compilations of one function body, where block frequencies are the same on both sides; across a
  pass that changes the blocks the frequencies change too.
- A by-product for the next stage: the emulator count rises at 42 steps. 22 are constprop (later passes take it
  back), 11 inline, 7 licm. With the loops change licm still costs in `chess-search.chessOrder` (304 to 468 over the
  seeded cases) and `regex-nfa.regexMatch` (39,281 to 39,973).

## Framework changes

None. `src/framework/` is unchanged: the pass edit records, statement origins and the backend's `covers` were
enough to build the attribution, and the defect was in a Typed analysis.

Changes outside the framework:

| File | Change | Reason |
| --- | --- | --- |
| `src/typed/analyses.ts` | `loopsOf` returns one loop per header, with `latches`; `typed.loops` version 2 | the fix |
| `src/typed/attribute.ts` (new) | `attributeSteps`, `formatAttribution` | the attribution, callable |
| `tools/attribute.mjs` (new) | command line for a corpus project | the attribution, as a tool |
| `src/typed/passes.ts` | licm shares a local among equal invariant trees (`share: false` turns it off) | fix 2 |
| `src/typed/backend/coalesce.ts` | two copies of one register do not interfere | fix 3 |
| `tests/typed/attribute.test.mjs` (new) | 5 tests | loops per header, exact sums, the VM, sharing |
| `tests/typed/speed.test.mjs` | 1 test | the orders copies coalesce, and the image agrees with r0 |
| `tests/workbench/strategies.test.mjs` | expects `typed.loops@2` | the pinned version changed |
| `corpus/book/08-control.md`, `corpus/reference.md` | one loop per head, `latches` | they described the old output |
| `corpus/projects/bytecode-vm/notes.md` | the measurement table and its sentence | the numbers changed |

## Measured and argued

Measured:

- every instruction count in this report (emulator runs; scripts 01, 03, 05, 06, 08 and the tool);
- the attribution's sums against the emulator (test);
- the spill counts that motivate sharing (script 08 on regex-nfa);
- parity, the reference checks and the test suites (below).

Argued, not measured beyond the checks named:

- that sharing is sound (equal trees of invariant operands have equal values at the preheader); every pipeline
  run in parity and the tests passed its meaning checks with it;
- that the coalescer change is sound (the copy-exception argument); the corpus agrees with r0 under each backend
  option and all together (`IRWB_FULL=1 tests/typed/speed.test.mjs`, below);
- that the union body is right for every reducible multi-latch loop (the definition), beyond the corpus and the
  test program;
- that the estimate fails as a guard because frequencies change with the blocks: the table shows that it fails,
  the reason is my reading of `frequency.ts`.

## Verification

All on the final compiler sources (commit f503708; 6cb091b and later change one test expectation, notes and
this ticket), after `npm run build`:

| Check | Result |
| --- | --- |
| `node tools/parity.mjs` | 50 projects, 135 functions, 8,286 of 8,286 decided cases agree, 14 at the limit, 0 failures (`various/parity-after.log`) |
| `node tools/reference-check.mjs` | reference images: 8,286 of 8,286 agree |
| `node tools/reference-check.mjs --o2` | our O2 images: 8,286 of 8,286 agree |
| `node --test tests/typed/*.test.mjs` | 157 tests, 155 pass, 2 skipped, 0 fail |
| `node --test tests/framework/*.test.mjs` | 234 pass |
| `node --test tests/workbench/*.test.mjs` | 25 tests, 24 pass, 1 skipped, 0 fail |
| `IRWB_FULL=1 node --test tests/typed/speed.test.mjs` | 9 pass: every corpus project agrees with r0 under each backend option and all together |
| `node tools/build-site.mjs` | builds |
| `tools/format-docs.mjs --check`, `tools/format-corpus.mjs --check` | no file would change |

- wrong-shift's `div-to-shift` is rejected in the parity run, as its `broken` pipeline intends.
- One test outside the directories of the brief changed: `tests/workbench/strategies.test.mjs` pinned licm's
  need as `typed.loops@1`; it now expects `@2`. The first workbench run failed on exactly that line.
- Parity was not run at the starting commit; only the instruction baseline (`various/corpus-before.json`) was
  taken there.
- Timing: `attributeSteps` on the VM's `speed` chain (7 revisions) is inside a test that takes about 6 s under a
  machine load above 30, most of it the checked pipeline; the attribution itself was not timed separately.


## Left out

- A value-level attribution (sites are statements; `Program.why` answers for a value).
- A guard in `speed` that picks the pipeline by emulator count: `fastest-all` does that, and it would have hidden
  the loops defect.

## Later

- The coalescer's new exception is per block; copies of one register in different blocks still interfere.
- Projects whose O2 count is above r0 after this work (see the corpus table): candidates for the next stage.
- licm cost: it hoists expressions out of loops that run zero times or that sit on cold paths (chessOrder).
- Attribution over a weighted case set, and to rewrite-rule ids, for the missed-optimization stage.
- constprop raises the count at its own step in 22 functions; whether the pipeline's later passes always take it
  back was not checked per function.
