---
Title: Instruction attribution and corpus results
Ticket: IRWB-034-B
Status: active
Topics:
    - compiler
    - performance
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/attribution.ts
      Note: Replays revisions and explains executed machine words
    - Path: repo://src/typed/passes.ts
      Note: Shared-header guard before LICM edits
    - Path: repo://tests/typed/attribution.test.mjs
      Note: Execution accounting, provenance and VM regression
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:12.548535013-05:00
WhatFor: ""
WhenToUse: ""
---
# Why the bytecode VM got slower under speed

**LICM put frame-address calculations on the VM's dispatch path.** Nine backedges go to the same header. The loop analysis returns one natural loop per backedge. LICM treated each body as an independent place to insert a preheader. While preparing one body, it redirected backedges from other bodies. The resulting chain recomputed addresses for opcode handlers that had not executed. Both images had zero spills.

## Instruction account for the original speed pipeline

These are measured instruction counts on the real Fibonacci and checksum bytecode, at n = 12 and seed = 8, with coalescing enabled and all other backend options at their defaults. Each row lowers a published revision and reruns the same call. Subtracting the previous row credits the pass with its complete marginal cost, including changes to code it did not edit directly. No-op passes have zero cost and publish no row.

| Revision and decision | Fib instructions | Fib delta | Checksum instructions | Checksum delta |
|---|---:|---:|---:|---:|
| r0 ingest | 7,678 | — | 6,874 | — |
| r1 cfg | 7,055 | −623 | 6,287 | −587 |
| r2 fold | 6,871 | −184 | 6,127 | −160 |
| r3 cfg | 6,688 | −183 | 5,968 | −159 |
| r4 licm | 9,287 | +2,599 | 8,219 | +2,251 |
| r5 subst | 9,287 | 0 | 8,219 | 0 |
| r6 subst | 9,287 | 0 | 8,219 | 0 |
| r7 cfg | 9,286 | −1 | 8,218 | −1 |
| **speed minus r0** | | **+1,608** | | **+1,344** |

The attribution function takes the published timeline, a concrete call and fixed backend options. It returns the signed deltas, edit records and executed instruction words with their counts. Calling a row's `explain(insn.id)` follows that image's correspondence and the preceding pass correspondences through the existing framework `whyEntity`. This supports calls that produce counters at every revision. A PC counts once regardless of how many values and statements its selection rule covers. Revision deltas depend on pass order. Provenance alone cannot establish the marginal cost of an individual edit.

For example, at r4 the instruction `insn:runVm+0x318` is `addi t1, sp, 0`. Its two covered entities are `v:runVm.44` and `s:runVm.144`. Both paths lead to LICM's “hoisted out of loop:runVm@bb:runVm.3” record. The insert edit places the statement in `bb:runVm.n0`. The PC ran 172 times on Fibonacci. Counting both paths would double that charge. The complete paths and per-PC readings are in [preheaders-before.txt](preheaders-before.txt).

### Inside the r4 increase

The table joins each LICM insert edit to the emitted words covering that statement. It counts executions of those words, grouped by the new block. For example, block n1 materializes the addresses of both frame arrays. Its two instructions each run 184 times in Fibonacci, including dispatches of other opcodes.

| LICM decision, all blocks in runVm | Fib executions | Checksum executions |
|---|---:|---:|
| n0, one frame address | 172 | 136 |
| n1, two frame addresses | 368 | 320 |
| n2, two frame addresses | 368 | 320 |
| n3, three frame addresses | 552 | 480 |
| n4, three frame addresses | 552 | 480 |
| n5, three frame addresses | 552 | 480 |
| n6, one frame address | 184 | 160 |
| n7, no emitted word covering an insert | 0 | 0 |
| n8, jump back to the dispatch header | 184 | 160 |
| **Gross executions covered by the new statements** | **2,932** | **2,536** |
| Remaining r4 executions minus all r3 executions | −333 | −285 |
| **Net LICM delta** | **+2,599** | **+2,251** |

The residual includes work previously done at the use sites and other lowering changes. The gross counts are measured on one image. Removing a single hoist and relowering could change other instructions too, so the table makes no independent counterfactual claim for each hoist.

## Fix and counterfactual

Skipping only LICM in the original pipeline gave 6,688 and 5,968. The compiler fix skips LICM for **headers shared by multiple loop facts** and retains it for single-latch headers, including other headers in the same function. It checks before creating any blocks or locals. The cost is that profitable invariants in these shared-header loops may stay inside them. Combining all latches, recomputing the common preheader and using the union of assigned locals could recover those opportunities. That more general transformation is deferred.

A spill guard would have missed this regression. Racing whole pipelines under the emulator would also have worked on these two calls but would add compilation work and make the choice depend on training inputs. A structural guard follows from the recorded CFG and works without runtime samples.

| Concrete VM call | r0 before | r0 after | O2 before | O2 after | speed before | speed after |
|---|---:|---:|---:|---:|---:|---:|
| Fibonacci | 7,678 | 7,678 | 9,286 | 6,688 | 9,286 | 6,688 |
| Checksum | 6,874 | 6,874 | 8,218 | 5,968 | 8,218 | 5,968 |

## Framework and scope

The implementation adds a Typed profiler and a guard to the existing checked pass. The framework already provides the contiguous correspondence chain and reverse explanation function. The backend already records selection reasons, covers and per-word counters. No framework, workbench, backend, tensor or corpus program changes were needed.

## Corpus measurements

For each project, script 02 generated ten cases per declared entry (all functions when entries are unspecified) using seed 7, matching the case count and seed in the existing strategy metric. It reused each r0 call and memory for O2 and speed, with the same coalescing policy as the VM fixture. The table sums finite emulator instruction counts, including counted guest traps. It does not substitute a step-limit penalty for a missing measurement.

| Project | r0 | O2 before | O2 after | speed before | speed after |
|---|---:|---:|---:|---:|---:|
| across-calls | 630 | 630 | 630 | 240 | 240 |
| algebra | 100 | 20 | 20 | 20 | 20 |
| blend | 2090 | 1760 | 1760 | 1750 | 1750 |
| bounds-lab | 5495 | 4905 | 4905 | 4817 | 4817 |
| bounds-offset | 1294 | 1294 | 1294 | 1285 | 1285 |
| bounds-param | 452 | 452 | 452 | 449 | 449 |
| bounds-two | 860 | 760 | 760 | 706 | 706 |
| branches | 165 | 139 | 139 | 139 | 139 |
| bytecode-vm | 39021 | 47066 | 33955 | 47066 | 33955 |
| call-chain | 1050 | 1050 | 1050 | 330 | 330 |
| calls | 580 | 580 | 580 | 227 | 227 |
| checksum | 1560 | 1260 | 1260 | 1251 | 1251 |
| chess-search | 395888 | 387232 | 387232 | 295188 | 295188 |
| collatz | 7461 | 7461 | 7461 | 6955 | 6955 |
| constants | 100 | 70 | 70 | 70 | 70 |
| dead-code | 100 | 30 | 30 | 30 | 30 |
| diagnostics | 30 | 30 | 30 | 30 | 30 |
| distinct | 340 | 340 | 340 | 60 | 60 |
| div-checks | 152 | 152 | 152 | 152 | 152 |
| div-magic | 709 | 749 | 749 | 739 | 739 |
| early-exit | 696 | 566 | 566 | 564 | 564 |
| f32-dsp | 49706 | 49030 | 49030 | 45401 | 45401 |
| first-steps | 280 | 220 | 220 | 80 | 80 |
| fixed-point | 410 | 392 | 392 | 242 | 242 |
| fragments | 2498 | 2100 | 2100 | 2090 | 2090 |
| gcd | 314 | 314 | 314 | 304 | 304 |
| heat-lab | 8255 | 8255 | 8255 | 8087 | 8087 |
| histogram | 2132 | 2008 | 2008 | 2000 | 2000 |
| licm-nested | 2677 | 1678 | 1678 | 1631 | 1631 |
| licm-traps | 153 | 153 | 153 | 149 | 149 |
| lz-roundtrip | 32698 | 35415 | 35415 | 28740 | 28740 |
| match-enum | 252 | 231 | 231 | 231 | 231 |
| my-analysis | 975 | 975 | 975 | 966 | 966 |
| my-first-pass | 60 | 50 | 50 | 50 | 50 |
| nested-loops | 2634 | 2342 | 2342 | 2289 | 2289 |
| orders | 1292 | 1030 | 1030 | 1021 | 1021 |
| params-demo | 2498 | 2100 | 2100 | 2090 | 2090 |
| pressure | 280 | 230 | 230 | 230 | 230 |
| ramp | 1040 | 970 | 970 | 962 | 962 |
| records | 240 | 240 | 240 | 240 | 240 |
| regalloc-lab | 2533 | 2523 | 2523 | 1960 | 1960 |
| regex-nfa | 41499 | 47457 | 43169 | 40560 | 37887 |
| sha-chacha | 223494 | 226610 | 226610 | 119191 | 119191 |
| sort | 4717 | 4717 | 4717 | 4624 | 4624 |
| start-here | 4070 | 3556 | 3556 | 2775 | 2775 |
| strength | 1948 | 1666 | 1666 | 1657 | 1657 |
| strings | 11364 | 10302 | 10302 | 10283 | 10283 |
| ui-gallery | 1172 | 1016 | 1016 | 628 | 628 |
| value-numbering | 3721 | 3082 | 3082 | 3073 | 3073 |
| wrong-shift | 1800 | 1500 | 1500 | 1491 | 1491 |
| All projects | 863485 | 866708 | 849309 | 645113 | 629329 |
| Excluding VM | 824464 | 819642 | 815354 | 598047 | 595374 |

Observed finite instruction counts for 829 of 830 calls per column.

The VM and regex-nfa improved on both measured pipelines. Each of the other 48 projects matched its before total exactly. One my-analysis call lacked a finite count in each column. These totals describe this seeded workload. The structural explanation generalizes to any LICM input with a shared header, but runtime gains on other inputs have not been measured.

## Reproduction

The pre-fix compiler and profiling tool coexist in commit `3a4cc49`. With that revision built, run scripts 01 (speed, O2, and speed with licm omitted), 02 (corpus), and 03 (individual preheaders). On the fixed revision, build with `npm run build`, run scripts 04 and 05 for tests and measurements, then 07 for the table. Script 06 compares O2 code sizes with the compiler's optional corpus test snapshots. All paths are relative to this ticket's scripts directory and commands are launched from the repository root.

The optional code-size snapshots track compiled artifacts. O2's default image shrank from 908 to 828 bytes for the VM and from 2,028 to 1,972 bytes for regex-nfa. Only these compiler-side size expectations changed. Their reference-compiler sizes and language-level expected outputs are unchanged.

## Validation

- Script 08 ran all 442 VM fixture calls with both r0 and fixed speed. Every speed call used fewer instructions. Fibonacci saved 18–990 per call and checksum saved 18–906. The existing VM test independently compared the guest results and memory with its oracle and the reference compiler.
- The one unavailable corpus timing was my-analysis.f(-6, 0). The emulator reached its 200,000-instruction limit under r0, O2 and speed. Omission is consistent across the measured totals.
- Corpus parity covered all 50 projects. All 8,286 decided cases agreed, 14 were inconclusive, and there were zero failures. The separate reference-image comparison also agreed on 8,286 decided cases across 83 entry functions. [Parity](parity.txt) · [Reference comparison](reference.txt)
- The requested Typed, framework and workbench test groups passed with 408 passes, zero failures and three opt-in Candela checks skipped. The focused attribution file was also run separately after adding the single-latch provenance assertion. [Group test output](tests.txt) · [Focused tests](attribution-tests.txt)
