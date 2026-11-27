---
Title: Final report — the attribution, the fix, and the measurements
Ticket: IRWB-034-E
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: report
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/attribute.ts
      Note: the attribution tool other code can call
    - Path: repo://src/typed/analyses.ts
      Note: the loopsOf merge that fixes the cause
    - Path: repo://tests/typed/attribution.test.mjs
      Note: the tool's test, pinning the fixed world
    - Path: repo://ttmp/2026/11/27/IRWB-034-E--why-speed-makes-the-bytecode-vm-slower-instruction-attribution-and-a-fix/scripts/
      Note: the probes and sweeps, with their outputs
ExternalSources: []
Summary: The cause found from the compiler's records, the attribution tool built to find it, the loopsOf merge that fixes it, and the before/after measurements.
LastUpdated: 2026-11-27
WhatFor: ""
WhenToUse: ""
---

# Final report — the attribution, the fix, and the measurements

## 1. The cause, from the compiler's own records

Script `01` lowers every revision the `speed` pipeline publishes on
`bytecode-vm` to an RV32 image and runs both fixtures (n = 12, seed = 8) on
the emulator. Before the fix, the published revisions were r1 cfg, r2 fold,
r3 cfg, r4 licm, r5-r6 subst ×2, r7 cfg, with these executed-instruction
counts:

| rev | pass | fib | checksum |
| --- | --- | ---: | ---: |
| r0 | ingest | 7,678 | 6,874 |
| r3 | cfg | 6,688 | 5,968 |
| **r4** | **licm** | **9,287 (+2,599)** | **8,219 (+2,251)** |
| r7 | cfg | 9,286 | 8,218 |

The whole regression is the `licm` revision; every other pass improves the
program (the two `inline` passes and `rotate` publish nothing: one function,
no rotatable header).

`typed.loops` (`loopsOf`) reported **one natural loop per back edge**. The
dispatch loop has nine arms that jump back to one header (`bb:runVm.3`), so
after the two cfg passes folded the branch chain, `loopsOf` returned nine
loops with the same head, the same id `loop:runVm@bb:runVm.3`, and bodies that
each excluded the other arms (script `04`). `licm` iterated over all nine:
for each it created a preheader (no sub-loop has one) and retargeted every
predecessor of the head outside *that sub-loop's body* — including the other
arms' back edges — into it. The nine preheaders chained onto the runtime
cycle (`n0 → … → n8 → head`), so every dispatch re-ran the "hoisted" code.

## 2. The attribution: method and tables

`src/typed/attribute.ts` (`attributeSteps`, `attributeTransition`,
`attributeOrigins`) is the reusable tool. Method, per revision transition:

1. both revisions are lowered with the same backend options and run on the
   emulator with per-instruction counts — the transition's cost is the
   emulator's own difference (`after.steps − before.steps`), not an estimate;
2. counts are attributed to statements through the image's `covers`
   (the existing heat), and carried across the transition through the
   revision's correspondence entries (`from → to` groups), so surviving,
   removed and created statements all get exact per-entity deltas — this is
   what follows an instruction through several passes;
3. each entry's credit is assigned to the first edit of the revision that
   names one of its entities: the decision table (insert, replace, remove,
   retarget, with the pass's `note`);
4. the residual (`overhead`) is the executed instructions covering no
   statement — callee-saved saves/restores, spill and frame code the backend
   added or removed because of the pass's register pressure. Entries plus
   overhead always sum to the measured delta; the test asserts this per
   transition.

**The bytecode VM under `speed`, before the fix** (script `06`, fib at
n = 12, seed = 8; checksum in brackets):

- r4 licm: delta **+2,599** [+2,251] = entries +2,579 [+2,231] + overhead
  **+20** [+20];
- decisions: **15 hoist inserts at +184 each [+160]** (one at +172 [+136]) —
  the hoisted frame-address sets (`inv = frame+0`, `inv1 = frame+16`, …)
  executing **once per guest instruction**, not once — plus one preheader
  jump insert at +184; against them, the replace/retarget edits where the
  arms' own address computations used to be: −341 total [−353];
- overhead +20: ten callee-saved registers (`s1`–`s10`) saved and restored
  because the fourteen new `inv` locals are live across the whole loop
  (frame 32 → 80 bytes, image 206 → 226 instructions);
- the origin view of the head image: ingest 6,515, **licm 2,748** instructions
  over 15 statements, backend 23; total 9,286.

So the extra instructions were credited by the compiler's own records to one
decision class: **licm's per-sub-loop preheaders**, which (a) moved pure
hoisted code onto the hot path and (b) created the live-across-the-loop
locals that pushed ten callee-saved saves/restores into the prologue.

## 3. The fix

`loopsOf` (src/typed/analyses.ts) now **merges natural loops that share a
header**: one loop per header, body = the union of the per-back-edge bodies
(the smallest predecessor-closed set containing the header), assigned locals
= the union, latch = the first back edge's source, id unique per header. This
is the textbook treatment; per-back-edge loops under one id were a
degenerate representation that every consumer had to re-deduplicate
(`rotate` already did).

With one loop, licm's preheader for the dispatch loop is the entry block
itself (its only outside predecessor), the hoisted sets run **once**, and no
back edge is retargeted. The same attribution, after the fix: r4 licm delta
**−306** [−258]; the 15 hoist inserts cost **+1 each** (one execution); the
savings (−341 [−353]) come from the arms' address computations the hoisted
values replaced; overhead +20 (the callee-saved saves — the register
pressure remains, but it is paid once per call, not per dispatch).

Alternatives: a licm-only guard (never retarget another same-head loop's
back edge) fixes this program but keeps nine wrong bodies for code motion; a
licm cost check (do not hoist what the backend rematerializes for one
instruction, like `aaddr`) was held in reserve — after the merge it is not
needed, and the merge is the better decision because it fixes the
representation every pass sees.

## 4. Instructions per corpus project, before and after

Per-case headline (script `10`, checked pipelines, backend `coalesce: true`):

| | r0 | O2 before | O2 after | speed before | speed after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fibonacci (184 guest) | 7,678 | 9,286 | 6,382 | 9,286 | **6,382** |
| checksum (160 guest) | 6,874 | 8,218 | 5,710 | 8,218 | **5,710** |

(`speed` was not alone: O2's own licm step had the same bug. After the fix
`speed` equals O2 on this program — its extra passes publish nothing — and
both are well below r0.)

Corpus sweep (script `08`, all 47 projects, `measure`'s protocol — the
project's own 10 seeded cases; passes run without the meaning gate on both
sides since they are deterministic; the checked pipelines are validated by
the tests, script `10` and parity):

| | O2 before | O2 after | speed before | speed after |
| --- | ---: | ---: | ---: | ---: |
| full corpus | 1,124,912 | 1,107,836 | 892,944 | 877,151 |
| without bytecode-vm | 1,077,836 | 1,075,211 | 845,868 | 844,526 |

The only programs whose numbers changed at all (script `08` outputs, committed):

- `bytecode-vm`: O2 and speed 47,076 → **32,625** (−30.7%);
- `regex-nfa`: O2 47,739 → 45,114, speed 41,147 → 39,805 (its matcher loop
  has the same multi-back-edge shape after cfg; the merge fixes it too);
- `my-analysis`: one seeded case hits the emulator limit on both sides;
  200,975 → 200,975 (O2), 200,966 → 200,966 (speed) — unchanged;
- every other project: identical instruction counts, revision for revision.

No project regressed; the corpus totals improved.

## 5. Framework changes

- `src/typed/attribute.ts` (new): the attribution tool — `attributeSteps`,
  `attributeTransition`, `attributeOrigins`. Reason: the task's requirement
  that attribution be a reusable tool for the next stage (missed
  optimizations from provenance); it reads only records the compiler already
  keeps (emulator counts, `covers`, edits, correspondence, origins).
- `src/typed/analyses.ts` (`loopsOf`): merge same-header natural loops.
  Reason: the cause (section 1); per-back-edge loops under one id made
  licm's preheader creation put hoisted code on the runtime cycle.
- `tests/typed/attribution.test.mjs` (new): the tool's test — exactness
  per transition (entries + overhead = the emulator's delta, decisions sum),
  the fixed licm account, the merged loops fact (one dispatch loop, entry
  block as preheader), and the origin view.
- `src/framework/`, `src/workbench/`, `src/tensor/`, `tools/` (except none),
  the corpus programs and their expectations: unchanged. `tools/build-site.mjs`
  still builds (run as a check).

## 6. Measured vs argued

Measured:

- the per-revision step table before the fix (script `01`) and the
  attribution tables (script `06`), including the +184-per-dispatch hoists
  and the +20 overhead;
- per-case r0/O2/speed before and after (script `10`, checked pipelines,
  40/40 contract cases per changed pass);
- the 47-project corpus sweep before and after (script `08`, outputs
  committed);
- parity (`tools/parity.mjs`): bytecode-vm 6 revs 100/100, regex-nfa 11 revs
  100/100, zero failures, zero inconclusive;
- the test suites: `tests/typed` (32 files, 0 fail), `tests/framework`,
  `tests/workbench` (0 fail), `tools/build-site.mjs`.

Argued, not measured:

- that the 45 unchanged projects are bit-identical, not merely equal in
  instructions: their loops facts are unchanged (single-back-edge loops get
  the same body, latch, preheader and assigned set as before — the merge only
  alters functions with more than one back edge into a header), passes are
  deterministic in their facts, and their measured instruction counts are
  identical; I did not diff their revisions.
- that the sweep's `check: false` runs equal the checked pipelines: pass
  kernels are deterministic and the contract only gates; the checked
  pipelines are validated on the changed programs (script `10` and parity).

## 7. What worked and what did not

- **Attribution through correspondence** worked exactly: every executed
  instruction reached a statement, every statement delta reached an edit, and
  the account closed to the emulator's count to the instruction on every
  transition of every case tried. It identified the decision class (hoist
  inserts re-executed per dispatch) without any guesswork.
- **Per-statement heat alone** (the existing `heat`) was not enough: it
  names the suffering statements but not the decision; the correspondence
  walk and the edit assignment are what make it a decision table.
- **The overhead bucket** is what surfaces register pressure: licm's r4
  account is entries (code motion) + 20 (backend saves) — the two costs the
  task asked to separate ("a hoist and its register pressure").
- **A cost model for hoisting** (reject one-instruction rematerializable
  values) turned out unnecessary after the representation fix; the merge
  removed both the re-execution and the case for a special cost check on
  this program. It remains the natural next guard if a future hoist regresses
  elsewhere.
- **The r0-only multi-back-edge scan** (script `09`) did not find the
  affected programs: the dispatch loop is a single natural loop at r0 and
  only becomes multi-back-edge after cfg folds the branch chain. The full
  sweep was needed to find regex-nfa.

## 8. Later

- A workbench surface for the attribution (a tile or console command over
  `attributeSteps`), for browser use.
- The licm cost check (do not hoist a value the backend can rematerialize
  for one instruction) as a second line of defense.
- The next stage's use: provenance-driven missed-optimization search calls
  `attributeSteps` on a candidate chain and reads the negative decisions.
