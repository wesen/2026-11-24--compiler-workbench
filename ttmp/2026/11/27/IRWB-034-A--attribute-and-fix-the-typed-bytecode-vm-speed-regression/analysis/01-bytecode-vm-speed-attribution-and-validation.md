---
Title: Bytecode VM speed attribution and validation
Ticket: IRWB-034-A
Status: complete
Topics: []
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/backend/attribution.ts
      Note: Traces executed instruction words through pass correspondence
    - Path: repo://src/typed/passes.ts
      Note: Groups back edges by header for LICM
    - Path: repo://src/typed/rules/compile.ts
      Note: Records named rule applications in Typed edits
    - Path: repo://ttmp/2026/11/27/IRWB-034-A--attribute-and-fix-the-typed-bytecode-vm-speed-regression/scripts/04-compare-corpus.mjs
      Note: Checks and renders paired per-project measurements
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:19:45.549559659-05:00
WhatFor: ""
WhenToUse: ""
---

At n = 12 and seed = 8, coalesced RV32 Fibonacci drops from 9,286 to
6,349 instructions under `speed`. The checksum drops from 8,218 to
5,677. The fix is in Typed LICM and reaches both O2 and `speed`.

## How the attribution works

`attributeInstructions(lowered, run, revisions)` takes a lowered Typed
image with its correspondence, a counted emulator run of that image, and
the published revision chain starting at r0. It returns each executed
instruction once, with its execution count, covered entities, ancestor
entities from r0, and ordered per-revision correspondence, origins, and
edit records. It indexes correspondence by target once per revision and
deduplicates entities at each step. Stable statement IDs can have an
implicit retained edge after a retarget, a move, or a value replacement.
The corresponding edit supplies that decision even when the edge
indicates retention. The fold and simplify visitors now include the
rule name, version and matched/result IDs in the replace edit. Those IDs
can include intermediate transaction values. Rule metadata is reporting
data. It leaves the optimized IR and its hashes intact.

For the surviving-work table, each word's count goes to the latest
revision with recorded changes on its lineage. All the matched entities
and edit evidence are available in the API rows. Words whose recorded
lineage has no changes go under r0, and words with no Typed coverage go
under uncovered. Script 03 constructs those totals from the API.
Attribution by lineage describes executed work associated with surviving
edits. The adjacent revision runs measure net cost, including work that
disappeared, shifts in execution frequency, register allocation and jump
layout. Those quantities answer different questions.

| Latest surviving decision at old speed head | Fibonacci | Checksum |
|---|---:|---:|
| r0 lineage | 1,863 | 1,779 |
| r1 cfg | 880 | 760 |
| r2 fold | 0 | 0 |
| r3 cfg | 0 | 0 |
| r4 licm | 1,760 | 1,520 |
| r5 subst | 0 | 0 |
| r6 subst | 0 | 0 |
| r7 cfg | 4,783 | 4,159 |
| Uncovered | 0 | 0 |
| **Total** | **9,286** | **8,218** |

The latest-only view assigns the largest count to final CFG cleanup
because that pass moved preheader statements. Walking past those moves
reaches LICM and attributes 2,748 Fibonacci and 2,376 checksum frame
address executions to its hoisted statements. Fourteen of those
statements ran 184 and 160 times respectively, once per guest dispatch.
The remaining one ran 172 and 136 times. The counts come directly from
the hoist insertions, their origins, and the final image correspondence.
At the earlier r2 checkpoint, the tool names `fold-eqz@1` on the
branch with 184 Fibonacci and 160 checksum executions. At r3, CFG
replaces that branch and its folded condition. It has no surviving
rule-owned word at the final head.

## What caused the regression

The before run published seven revisions. Only r4 increased instructions
under coalescing, and its increase exceeds the net regression because
earlier cleanup saved instructions. Inlining and rotation did not
publish changes on this input program.

| Published decision | Fibonacci steps | Change | Checksum steps | Change |
|---|---:|---:|---:|---:|
| r0 | 7,678 | — | 6,874 | — |
| r1 cfg | 7,055 | −623 | 6,287 | −587 |
| r2 fold | 6,871 | −184 | 6,127 | −160 |
| r3 cfg | 6,688 | −183 | 5,968 | −159 |
| r4 licm | 9,287 | +2,599 | 8,219 | +2,251 |
| r5 subst | 9,287 | 0 | 8,219 | 0 |
| r6 subst | 9,287 | 0 | 8,219 | 0 |
| r7 cfg | 9,286 | −1 | 8,218 | −1 |
| **Net from r0** | | **+1,608** | | **+1,344** |

At r3 there are nine natural-loop records with header `bb:runVm.3`.
The loop analysis represents each back edge separately. LICM built a
preheader for each record. When a sibling latch was outside an individual
record's body, LICM treated it as an external predecessor and redirected
it. The nine added blocks, 18 retargets, and 15 address hoists are in
the r4 edit report. Every hoisted expression was an address of the VM
stack or locals array (`frame+0` or `frame+16`). Branches back to the
dispatch header therefore ran address calculations intended to run once
on entry. Script 02 joins the emitted instruction reasons to emulator
counts at the r3/r4 boundary.

| RV32 reason at r3 → r4 | Fibonacci | Checksum |
|---|---:|---:|
| Frame-array address | 342 → 2,749 (+2,407) | 294 → 2,377 (+2,083) |
| Jump | 761 → 933 (+172) | 701 → 849 (+148) |
| Callee-saved register saves and restores | 0 → 20 (+20) | 0 → 20 (+20) |
| All other reasons combined | 0 net change | 0 net change |
| Allocator spill slots | 0 → 0 | 0 → 0 |

The 20 one-time saves and restores account for the measured register
pressure effect. Chain layout as a counterfactual made the jump delta
zero, but address work still rose by 2,407 and 2,083 steps. With
coalescing and chains, r3 → r4 still increased 6,026 → 8,451 and
5,366 → 7,467. Layout alone was insufficient. Omitting LICM and rerunning
the rest of `speed` yielded 6,688 and 5,968 with coalescing. That
counterfactual removes the regression but also discards useful motion.

## Fix

LICM groups natural loops by header and takes the union of their bodies
and assigned locals. It chooses a preheader from predecessors outside
that union, or creates one and redirects only external edges. A
computation is invariant across the combined dispatch region only if
no member assigns its operands. `runVm` now uses its existing true
entry preheader. When a group has multiple latches, LICM shares the
temporary for each hoisted frame offset across its arms and records the
defining statement as evidence at every use. The 15 original address
uses now read two preheader definitions. The nine synthetic preheaders
and their back-edge redirects disappear. The per-back-edge loop
analysis remains available to consumers that need each latch, including
rotation. The compiler uses pass-local grouping and address reuse.

Grouping alone cut the two VM runs to 6,382 and 5,710. Its corpus
check exposed an interaction in `regex-nfa` O2 with all backend extras
enabled. The estimator chose chained layout for both versions. Across
the 100 cases its issued spill reloads rose from 38,286 to 79,623, and
spill stores rose from 2,562 to 12,976. The lower frame-address count
and the layout's jumps could not make up for that reload traffic.
Sharing frame offsets reduced the live address temporaries. The same
O2 option combination reached 376,332 instructions, compared with
392,605 at baseline and 434,313 with grouping alone. Scripts 05 and
06 preserve the option ablation and the frame-address sharing probe.

| VM fixture, coalescing enabled | r0 before and after | O2 before | O2 after | Speed before | Speed after |
|---|---:|---:|---:|---:|---:|
| Fibonacci | 7,678 | 9,286 | 6,349 | 9,286 | 6,349 |
| Checksum | 6,874 | 8,218 | 5,677 | 8,218 | 5,677 |

With default backend options the same comparison is 7,863 → 9,287 →
6,350 for Fibonacci and 7,035 → 8,219 → 5,678 for checksum (r0, old
head, new head).

## Framework changes

None. The existing correspondence supports reverse traversal, and
image lowering and the emulator already provide coverage and execution
counts. Typed adds a read-only attribution API and records rule IDs in
Typed transaction reports. LICM consumes the existing loop facts.

## Corpus measurement

The corpus run covers all 50 project directories from `tools/corpus.mjs`.
For each project, script 01 generates 100 cases per configured entry
(or per function for projects without entry roots), at seed 7, from r0.
It runs the same cases for all images and sums the emulator's finite
instruction counts. Cases where the emulator supplied no count are
excluded. The before and after files report those counts separately.
Each pipeline uses its ordinary checked passes. The table uses
coalescing to match the VM fixture. The JSONL results also carry default
backend options and the combination of chains, coalescing and homes.

- Reproduce a run with `node <ticket>/scripts/01-measure.mjs corpus`
  after building the revision being measured. Commit `0fd67e5` has the
  attribution scripts and the old LICM decision.
- `node <ticket>/scripts/04-compare-corpus.mjs coalesce` checks the paired
  results and prints the table. Use `default` or `extras` to compare the
  other configurations.

| Project | Cases | O2 before | O2 after | Speed before | Speed after |
|---|---:|---:|---:|---:|---:|
| across-calls | 200 | 6,300 | 6,300 | 2,400 | 2,400 |
| algebra | 100 | 200 | 200 | 200 | 200 |
| blend | 100 | 22,910 | 22,910 | 22,810 | 22,810 |
| bounds-lab | 400 | 45,100 | 45,100 | 44,297 | 44,297 |
| bounds-offset | 100 | 13,925 | 13,925 | 13,839 | 13,839 |
| bounds-param | 100 | 5,668 | 5,668 | 5,631 | 5,631 |
| bounds-two | 100 | 6,710 | 6,710 | 6,231 | 6,231 |
| branches | 200 | 1,377 | 1,377 | 1,377 | 1,377 |
| bytecode-vm | 100 | 431,176 | 295,867 | 431,176 | 295,867 |
| call-chain | 300 | 10,500 | 10,500 | 3,300 | 3,300 |
| calls | 300 | 5,800 | 5,800 | 2,252 | 2,252 |
| checksum | 100 | 16,440 | 16,440 | 16,342 | 16,342 |
| chess-search | 200 | 3,857,656 | 3,857,656 | 2,939,064 | 2,939,064 |
| collatz | 100 | 97,519 | 97,519 | 90,865 | 90,865 |
| constants | 100 | 700 | 700 | 700 | 700 |
| dead-code | 100 | 300 | 300 | 300 | 300 |
| diagnostics | 100 | 300 | 300 | 300 | 300 |
| distinct | 200 | 3,400 | 3,400 | 600 | 600 |
| div-checks | 200 | 1,486 | 1,486 | 1,486 | 1,486 |
| div-magic | 200 | 7,424 | 7,424 | 7,324 | 7,324 |
| early-exit | 100 | 4,902 | 4,902 | 4,864 | 4,864 |
| f32-dsp | 300 | 435,700 | 435,700 | 399,767 | 399,767 |
| first-steps | 200 | 2,200 | 2,200 | 800 | 800 |
| fixed-point | 200 | 3,910 | 3,910 | 2,410 | 2,410 |
| fragments | 100 | 18,890 | 18,890 | 18,793 | 18,793 |
| gcd | 100 | 3,338 | 3,338 | 3,239 | 3,239 |
| heat-lab | 100 | 114,204 | 114,204 | 111,770 | 111,770 |
| histogram | 100 | 32,422 | 32,422 | 32,327 | 32,327 |
| licm-nested | 100 | 16,068 | 16,068 | 15,515 | 15,515 |
| licm-traps | 100 | 2,308 | 2,308 | 2,242 | 2,242 |
| lz-roundtrip | 400 | 399,232 | 399,232 | 323,174 | 323,174 |
| match-enum | 200 | 2,303 | 2,303 | 2,303 | 2,303 |
| my-analysis | 100 | 45,576 | 45,576 | 45,490 | 45,490 |
| my-first-pass | 100 | 500 | 500 | 500 | 500 |
| nested-loops | 100 | 24,962 | 24,962 | 24,303 | 24,303 |
| orders | 200 | 9,640 | 9,640 | 9,547 | 9,547 |
| params-demo | 100 | 18,890 | 18,890 | 18,793 | 18,793 |
| pressure | 100 | 2,300 | 2,300 | 2,300 | 2,300 |
| ramp | 100 | 11,559 | 11,559 | 11,462 | 11,462 |
| records | 200 | 2,400 | 2,400 | 2,400 | 2,400 |
| regalloc-lab | 300 | 24,356 | 24,356 | 18,872 | 18,872 |
| regex-nfa | 100 | 444,169 | 414,664 | 382,165 | 349,654 |
| sha-chacha | 200 | 2,262,825 | 2,262,825 | 1,188,629 | 1,188,629 |
| sort | 100 | 46,615 | 46,615 | 45,696 | 45,696 |
| start-here | 400 | 33,770 | 33,770 | 26,517 | 26,517 |
| strength | 200 | 17,177 | 17,177 | 17,083 | 17,083 |
| strings | 200 | 103,797 | 103,797 | 103,601 | 103,601 |
| ui-gallery | 200 | 11,690 | 11,690 | 7,370 | 7,370 |
| value-numbering | 100 | 42,594 | 42,594 | 42,497 | 42,497 |
| wrong-shift | 200 | 19,320 | 19,320 | 19,222 | 19,222 |
| **Total** | | 8,692,508 | 8,527,694 | 6,474,145 | 6,306,325 |

The three configurations showed no project-level regressions on either
pipeline. Fourteen cases from `my-analysis` had no finite emulator
instruction count in each run, before and after. The totals include the
other 8,286 cases.

| Backend configuration | O2 before | O2 after | Speed before | Speed after |
|---|---:|---:|---:|---:|
| Default | 9,016,818 | 8,852,004 | 6,770,511 | 6,610,525 |
| Coalescing | 8,692,508 | 8,527,694 | 6,474,145 | 6,306,325 |
| Chains, coalescing, and homes | 8,319,091 | 8,137,611 | 6,090,847 | 5,896,762 |

## Measured and argued

- **Measured.** The VM revision deltas, correspondence counts, layout
  and LICM ablations, frame-offset sharing probe, and corpus totals
  come from emulator runs. The named pipelines were checked using
  project inputs and the ordinary pass contracts. The validation
  commands below cover evaluator and RV32 agreement on generated cases.
- **Argued.** A branch from any latch in the same natural-loop body is
  internal to the combined region. A value proven invariant against
  the union of assigned locals remains invariant across any of those
  back edges. An `aaddr` of a given offset names the same activation
  address throughout that invocation. This justifies the shared
  temporary and preheader placement independently of the speed counts.
- These measurements cover executed instructions on the recorded
  inputs and backend options. Hardware cycle counts and a general
  profitability model are outside this investigation.

## Validation

- `npm run build` succeeded on Node 24.18.0.
- `node tools/parity.mjs --json` reported 50 projects, 8,286/8,286
  decided cases agreeing, 14 inconclusive cases, and zero failures.
- `node tools/reference-check.mjs` and
  `node tools/reference-check.mjs --o2` each reported 8,286/8,286
  decided cases agreeing and 14 inconclusive cases.
- `node --test --test-concurrency=1 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs`
  reported 408 passes, three skips, and zero failures. The attribution
  test checks count conservation, cross-pass lineage and rule records.
  The VM test checks execution parity and the instruction budget for
  both reported entries.
