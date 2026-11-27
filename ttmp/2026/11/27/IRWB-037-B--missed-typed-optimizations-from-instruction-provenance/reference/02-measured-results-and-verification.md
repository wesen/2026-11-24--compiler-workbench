---
Title: Measured results and verification
Ticket: IRWB-037-B
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/analyses.ts
      Note: Refines the successful unsigned edge
    - Path: repo://src/typed/attribute.ts
      Note: Ranks surviving statement costs
    - Path: repo://src/typed/passes.ts
      Note: Queries the range at the original check
ExternalSources: []
Summary: Four eliminated guards save 346 instructions on regex. The same checked pass saves 11,347 on the LZ fixture.
LastUpdated: 2026-11-27T12:48:16.772908404-05:00
WhatFor: ""
WhenToUse: ""
---

# Measured results and verification

The checked bounds pass now removes four array guards in the regex matcher. Together they cost exactly 346 RV32 instructions on the original fixture. Their removal puts this compiler 41 instructions below the reference. The same change helps the LZ hash table, the bytecode VM and SHA/ChaCha. No measured corpus project regressed under either pipeline.

## Historical fixtures

The before compiler is 2966b9b, which already contains D1. The design commit 5938705 has the same compiler. The after implementation is 76532ab. Script 01 runs the original project fixtures and oracles on both compilers.

| Fixture and backend | speed before | speed after | Saved | Reference |
| --- | ---: | ---: | ---: | ---: |
| Regex, default options | 6,933 | 6,587 | 346 | 6,628 |
| LZ, chains + coalesce + homes | 156,782 | 145,435 | 11,347 | 156,405 |
| Chess, chains + coalesce + homes | 10,038,193 | 10,038,193 | 0 | 10,827,760 |

Regex includes compiling `[a-c]*[b-d]*a*d` and matching `abccabbd`. LZ sums the 100 seed-7 calls to `roundTrip`, including compression and decompression. Chess runs quiet-mate-in-two at depth 3 and budget 1,600. Both images found d6c7 at score 29,997 in 1,344 nodes. These three workloads differ from the all-functions corpus comparison below.

## From provenance to a checked change

Script 03 ran D1's `attributeSteps` over the checked regex revisions. It also grouped the final image's dynamic PC counts by the statement named in `covers`, then joined each surviving ID to the D1 rows that name it. This second view finds expensive statements even when no step changes their cost. The production implementation adds `residual` to the result and `--hot` to the CLI. It reuses the final per-site counts already computed by D1. The residual counts partition the last image's dynamic cost. A site's reductions list describes decreases in groups that explicitly named that ID. An empty list is evidence about recorded history only. Moving work between groups can change the counts indirectly.

| Regex site after baseline speed | Instructions | Decision |
| --- | ---: | --- |
| 237, 242, 247, checks of state against 9 | 128 each | Each ran 64 times and emitted a literal and a branch each time. CFG retargeted them at zero delta. Retain the first guard and eliminate the two repetitions. |
| 144 and 162, checks of first and second against 9 | 52 and 38 | Each has an earlier successful guard on the same local. Source-layout changes had already helped both. |
| 188, five times state | 128 | 64 literal materializations and 64 multiplies, no D1 row. Tested the strength reduction below. |
| 3, zero 180 bytes of frame storage | 137 | 45 stores, 45 pointer increments, 45 branches and two setup instructions. No D1 row. Distinct backend opportunity. |

**Bounds elimination.** On the successful edge of `i <u N` or the false edge of `i >=u N`, a positive signed i32 constant N implies the signed interval [0, N−1]. Version 2 of `typed.ranges` intersects that interval with the existing one for a local read. The existing forward dataflow analysis propagates it through assignments and joins. Version 2 of `typed.bce` uses its declared range fact to replace a fixed-bound trap branch with a jump to the in-bounds arm if the local's whole interval is in bounds. Restricting the removed expression to a local and a literal preserves evaluation effects. The transaction records the original statement, revision-specific range and fixed bound. The pass also exploits intervals that another transfer, such as a bit mask, already established. Strategy plan builders now take exact pass versions from the definitions, including per-function search plans.

Saved strategy plans that explicitly request typed.bce version 1 need regeneration to select version 2. Named pipelines and generated plans resolve the current definition.

A local pair-of-checks peephole would miss checks separated by branch targets, as well as facts derived from masks. A new bounds analysis would duplicate the existing interval lattice, transfer and join. The only compiler decision added here is the existing checked pass acting on a proven interval. Its regex step goes from 6,974 to 6,628 before substitution and rotation. D1 credits all −346 to the four replacements, leaving −346 at the end of the pipeline as well.

**LZ.** The inlined hash ends in `& 15`. Range analysis therefore proves `bucket` fits the 16-element head table. On the first maximum-length generated input (case 20, 24 cells), three bucket checks go from 20, 44 and 44 instructions to zero. The whole BCE step saves 233 instructions on that call, including indirect changes in register allocation and layout. On case 0, the empty input, the same step adds 12 frame instructions. The 100-case total captures both effects. Script 06 emits the rows, including their stated reasons.

**Verified candidate.** Script 04 constructs `5*x → x + (x << 2)` for pure i32 x, verifies it with `verifyRule`, and runs it after strength through a checked pass. The verifier passed its structural check, proved equality of linear forms modulo 2³², and passed 100,048 boundary and random evaluations. The guard permits duplicating the operand. Four static matches left regex at 6,933 in both runs. At site 188, materializing 5 and multiplying already costs two instructions, the same as a shift and an add. Site 120 has a load operand and is ineligible for duplication. The rule stays in the experiment. No new simplifier rule ships.

## All 50 corpus projects

Script 02 generates ten cases per function at r0 with seed 7 and the project's input specifications. All images see the same arguments and initial memory. The O2 column uses default backend settings. Speed enables chains, coalesce and homes. Reference uses the vendored compiler's default policy on the same assembled source. Each changed pass in the corpus benchmark uses D1's five-case check. The three named fixture runs use their original checks. Script 07 checks every project ID, the reference counts on both runs, trap and cap totals, and the empty rejection lists before summing. The emulator limit of 200,000 and the fixed case count reproduce D1's protocol. One my-analysis call is charged at the limit, so this is a capped workload total.
| Project | O2 before | O2 after | speed before | speed after | Reference |
| --- | ---: | ---: | ---: | ---: | ---: |
| across-calls | 640 | 640 | 210 | 210 | 700 |
| algebra | 20 | 20 | 20 | 20 | 170 |
| blend | 1,925 | 1,925 | 1,585 | 1,585 | 1,715 |
| bounds-lab | 5,333 | 5,333 | 4,426 | 4,426 | 4,234 |
| bounds-offset | 1,364 | 1,364 | 1,258 | 1,258 | 894 |
| bounds-param | 502 | 502 | 408 | 408 | 426 |
| bounds-two | 810 | 810 | 665 | 665 | 675 |
| branches | 139 | 139 | 131 | 131 | 211 |
| bytecode-vm | 32,295 | 31,981 | 24,750 | 24,593 | 28,889 |
| call-chain | 1,050 | 1,050 | 290 | 290 | 1,120 |
| calls | 651 | 651 | 227 | 227 | 840 |
| checksum | 1,410 | 1,410 | 1,110 | 1,110 | 1,170 |
| chess-search | 423,077 | 423,077 | 297,382 | 297,382 | 334,902 |
| collatz | 7,461 | 7,461 | 5,769 | 5,769 | 7,016 |
| constants | 70 | 70 | 70 | 70 | 160 |
| dead-code | 30 | 30 | 30 | 30 | 200 |
| diagnostics | 30 | 30 | 30 | 30 | 90 |
| distinct | 340 | 340 | 60 | 60 | 700 |
| div-checks | 162 | 162 | 152 | 152 | 308 |
| div-magic | 769 | 769 | 661 | 661 | 807 |
| early-exit | 631 | 631 | 557 | 557 | 575 |
| f32-dsp | 49,030 | 49,030 | 44,107 | 44,107 | 40,740 |
| first-steps | 220 | 220 | 80 | 80 | 500 |
| fixed-point | 411 | 411 | 242 | 242 | 647 |
| fragments | 2,299 | 2,299 | 1,891 | 1,891 | 2,021 |
| gcd | 324 | 324 | 265 | 265 | 365 |
| heat-lab | 8,832 | 8,832 | 7,996 | 7,996 | 6,758 |
| histogram | 2,292 | 2,292 | 2,000 | 2,000 | 2,036 |
| licm-nested | 1,678 | 1,678 | 1,596 | 1,596 | 2,426 |
| licm-traps | 153 | 153 | 142 | 142 | 196 |
| lz-roundtrip | 34,551 | 34,195 | 28,330 | 26,358 | 28,499 |
| match-enum | 251 | 251 | 226 | 226 | 396 |
| my-analysis | 200,975 | 200,975 | 200,618 | 200,618 | 200,696 |
| my-first-pass | 50 | 50 | 50 | 50 | 120 |
| nested-loops | 2,342 | 2,342 | 2,252 | 2,252 | 2,312 |
| orders | 1,194 | 1,194 | 952 | 952 | 1,351 |
| params-demo | 2,299 | 2,299 | 1,891 | 1,891 | 2,021 |
| pressure | 240 | 240 | 230 | 230 | 490 |
| ramp | 1,040 | 1,040 | 780 | 780 | 1,120 |
| records | 260 | 260 | 240 | 240 | 391 |
| regalloc-lab | 2,614 | 2,614 | 1,716 | 1,716 | 2,028 |
| regex-nfa | 40,212 | 38,580 | 28,128 | 27,312 | 34,041 |
| sha-chacha | 232,820 | 228,336 | 107,102 | 104,860 | 136,109 |
| sort | 5,043 | 5,043 | 4,563 | 4,563 | 3,898 |
| start-here | 3,871 | 3,871 | 2,559 | 2,559 | 3,167 |
| strength | 1,938 | 1,938 | 1,404 | 1,404 | 1,889 |
| strings | 10,833 | 10,833 | 9,262 | 9,262 | 9,392 |
| ui-gallery | 1,058 | 1,058 | 594 | 594 | 825 |
| value-numbering | 3,082 | 3,082 | 2,453 | 2,453 | 3,771 |
| wrong-shift | 1,650 | 1,650 | 1,340 | 1,340 | 1,410 |
| **Total** | 1,090,271 | 1,083,485 | 792,800 | 787,613 | 875,417 |

Each column includes 246 calls flagged as traps, including 1 at the instruction cap.

O2 improved on 4 projects. Regressions none.

speed improved on 4 projects. Regressions none.

## Framework and verification

There are no changes in src/framework. The existing framework dataflow analysis, pass needs, checked transformation, transactions with correspondence and versioned strategy plans cover this change. Residual site attribution belongs in Typed because its inputs are Typed statement IDs and RV32 instruction coverage.

The measured results are emulator instruction counts for these exact calls, checked revisions, rule-verifier results and oracle comparisons. The range argument establishes when the branch is redundant assuming sound incoming intervals. The case checks exercise that claim and do not quantify over every program. No reference instruction was attributed to a matching Typed site. The measurements establish the end-to-end gap, not which optimization the reference used.

Repository parity covered 50 projects and 135 functions. All 8,286 decided cases agreed and 14 were inconclusive. The intentionally broken div-to-shift pass was rejected as expected. The separate reference-image and O2-image checks each agreed on 8,286 decided cases, with 14 inconclusive. The historical LZ run also checked each changed speed revision on all 400 generated function cases, including BCE. The fixed-array regression checks that a conditional reassignment at a join retains the final guard and that negative and one-past-the-end indices still trap.

The TypeScript build succeeded. The final run of tests/typed, tests/framework and tests/workbench against 76532ab reported 417 tests, 414 passed, three opt-in Candela tests skipped, zero failures. Full output is in [the test log](../various/tests.txt).

## Reproduction

From the repository root, build with `npm run build`. Run the numbered scripts under this ticket. Scripts 01–04 collected the baseline on the design commit with the scripts from the implementation commit. Scripts 01–03 repeat the measurements on the after compiler. Script 05 runs the required suites. Script 06 gives the longest generated LZ case by default and case zero with `--first`. Script 07 reads both corpus JSONL files. Script 08 runs the repository parity and reference checks. Script 09 exercises the production hot-site CLI. Raw output is in `various/`.

## Later

- Instruction selection for frame zeroing has a separate code-size tradeoff. It was outside the chosen bounds optimization.
- Value-level and cross-ID lineage could distinguish the cost of a subexpression inside a surviving statement. Statement coverage sufficed for the four measured checks.
