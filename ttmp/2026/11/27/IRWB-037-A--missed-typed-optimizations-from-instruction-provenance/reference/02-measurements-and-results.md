---
Title: Measurements and results
Ticket: IRWB-037-A
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/analyses.ts
      Note: Unsigned branch refinement for fixed bounds
    - Path: repo://src/typed/attribute.ts
      Note: Executed final-site counts and edit history
    - Path: repo://src/typed/passes.ts
      Note: Checked fixed-bound elimination
    - Path: repo://src/typed/rules/simplify.ts
      Note: Verified Horner rewrite
    - Path: repo://src/typed/rules/verify.ts
      Note: Shared low-bit mask proof
    - Path: repo://ttmp/2026/11/27/IRWB-037-A--missed-typed-optimizations-from-instruction-provenance/scripts/01-measure.mjs
      Note: Paired RV32 fixture and corpus benchmark
ExternalSources: []
Summary: RV32 attribution, verified optimizations and paired corpus results
LastUpdated: 2026-11-27T12:39:54.211753888-05:00
WhatFor: ""
WhenToUse: ""
---

# Measurements and results

Fixed-bound elimination closed the default regex gap. The historical fixture fell from 6,933 RV32 instructions to 6,587, 41 below the reference. Fixed-bound elimination and one verified rewrite brought tuned LZ down from 156,782 to 141,787, 14,618 below the reference.

## How the candidates were found

The baseline is `2966b9b`, which already includes IRWB-034-G’s fixes. First rerun the historical cases from IRWB-014, IRWB-015 and IRWB-017. Then run the same cases through D1’s `attributeSteps`. The revised attribution reports all executed final sites, including unchanged statements, their opcode counts, and earlier edited or indirect changes along their statement ancestry. `tools/attribute.mjs … --hot` shows the ranked sites. Value origin notes now appear in the corresponding rewrite decision, including the Horner rule’s name.

When a statement splits into multiple descendants, each descendant can show the same group history. Sum the step rows for accounting and the final sites for coverage. The hot-site test reconciles the final site and mnemonic totals with the emulator’s totals. A missing direct reduction describes the measured revisions and case. It is a useful search filter, with no claim about indirect register or layout effects.

The gap probe also compares dynamic mnemonic counts with the reference, decoding both images the same way. The reference lacks Typed statement IDs, so compare the mnemonic distributions and then follow the workbench’s coverage IDs to IR. On the regex fixture the two images both ran 861 adds, 861 immediate shifts and 134 multiplies. The workbench instead ran 248 more `addi` and 209 more `jal` instructions, with compensating reductions in loads and other operations. This ruled out scaled addresses as the first place to investigate the 305-instruction gap. [Regex trace before](../various/regex-gap-before.txt) · [Regex trace after](../various/regex-gap-after.txt)

| Regex bound-check shape at the starting `speed` head | Executions per check | Instructions at the sites | Removed instructions |
| --- | ---: | ---: | ---: |
| Same `state >=u 9` in the copy-and-clear loop, statements `.237`, `.242`, `.247` | 64 each | 384 | 256 |
| Second `first >=u 9` after loading the active state, `.144` | 26 | 52 | 52 |
| Second `second >=u 9` after loading the active state, `.162` | 19 | 38 | 38 |
| **Total removed at the BCE step** | | | **346** |

These checks have a literal bound and read the same local as an earlier successful check. The three state checks had no prior direct reduction. BCE eliminated 173 check executions across the four sites.

LZ exposed a second contextual opportunity. The two bucket checks at `compress.88` and `compress.93` each cost 2,082 instructions across the 100 round trips. The first hash site’s check at `compress.15` adds 1,266. They repeat the upper bound 16 after a four-bit mask already restricted the bucket to `[0, 15]`. The two hash statements `compress.112` and `.118` accounted for 4,431 and 7,287 instructions before optimization. Each hash evaluates `((a*31 + b)*31 + c) & 15`. These hashes also account for all 3,348 multiplies in both images. The reference histogram exposed the workbench’s load and branch overhead, but the statement trace exposed an arithmetic gain available to both compilers. [LZ trace before](../various/lz-gap-before.txt) · [LZ trace after](../various/lz-gap-after.txt)

## Changes and verification

- **Fixed bounds in `bce`.** `typed.ranges@2` intersects a local’s signed interval with `[0, bound−1]` on the successful edge of an unsigned comparison against a positive literal. The existing framework dataflow solver propagates that interval through CFG joins and assignments. BCE replaces a fixed-bound trap check with its success branch when the incoming interval fits, recording the fact and bound on the edit’s replacement statement. The alternative of comparing reaching-definition IDs at a dominating check misses assignments that compute known ranges such as `x & 15`. It also requires care when a definition executes again between two checks. The interval implementation covers both repeated checks and range-producing assignments.
- **`horner31-mask15` in `simplify`.** Rewrite the measured hash to `(a - b + c) & 15`. The two coefficients 961 and 31 reduce to 1 and −1 modulo 16. Both sides evaluate `a`, `b` and `c` once in the same order. The verifier now detects a shared literal mask with contiguous low bits and compares the existing linear normal forms modulo the mask plus one. This proves other masked linear identities too, such as dropping terms that contribute only discarded high bits. The rule’s saved evidence includes structural verification, the coefficient proof and 1,110,592 boundary and pseudorandom assignments using the repository’s existing verification settings. A runtime pattern for arbitrary base and mask would require a guarded coefficient test and additional verifier domain support. The literal rule covers the measured shape with the existing rule grammar. [Verifier evidence](../various/horner-evidence.json)

The fixed-bound regression exercises successful checks, a branch join and an index reassignment with negative and upper-bound inputs. The changed named-pipeline passes ran through their ordinary meaning contracts. Regex passed 40/40 on each changed pass, and LZ passed 160/160 on each. The rule fired at one O2 site and three speed sites in LZ, including the two inlined copies.

| Historical fixture and lowering | Baseline | Fixed BCE only | With Horner rule | Rule gain after BCE |
| --- | ---: | ---: | ---: | ---: |
| Regex O2 | 7,882 | 7,536 | 7,536 | 0 |
| Regex speed | 6,933 | 6,587 | 6,587 | 0 |
| Regex speed tuned | 5,405 | 5,232 | 5,232 | 0 |
| LZ O2 | 191,399 | 189,317 | 182,621 | 6,696 |
| LZ O2 tuned | 186,703 | 184,621 | 179,599 | 5,022 |
| LZ speed | 159,079 | 153,649 | 146,953 | 6,696 |
| LZ speed tuned | 156,782 | 145,435 | 141,787 | 3,648 |

The middle column is the measured implementation before integrating the rule. The isolated probe applied the rule after the named pipelines and produced the same LZ counts as the final compiler, which applies the rule in the normal simplify steps. The 5,430 default LZ speed saving from BCE equals the measured costs of the three eliminated bucket checks. Tuned lowering has a larger end-to-end saving after BCE because block layout and register allocation also respond to the edited CFG. The experiment did not isolate those tuned effects from each other. The checked ablation replayed the isolated counts on the final source by omitting the one rule from simplify. [Ablation replay](../various/candidate-replay.jsonl)

### Alternatives tried

- A late `lvn → dce → cfg` gained 2,082 in LZ speed under both lowering configurations by sharing a repeated bucket address. LVN failed on both regex pipelines with a stale value ID, so this schedule stayed out.
- Late `bcm → simplify → fold` changed no regex sites. On LZ it saved 1,674 in O2 and 200 in tuned speed, with no default speed effect. This stage targeted the larger gains from the fixed-bound and Horner changes. [Checked candidate runs](../various/candidates.jsonl)

## Historical `speed` fixtures

The historical regex result uses default backend options, and the historical LZ and chess results use chains, coalescing and homes. `scripts/01-measure.mjs --fixtures` also records every other option set in the same run. Regex is `[a-c]*[b-d]*a*d` over `abccabbd`. LZ is 100 seed-7 `roundTrip` cases. Chess is the existing depth-three quiet-mate fixture.

| Workload | Backend options | Before | After | Reference |
| --- | --- | ---: | ---: | ---: |
| Regex | Default | 6,933 | 6,587 | 6,628 |
| LZ | Tuned | 156,782 | 141,787 | 156,405 |
| Chess | Tuned | 10,038,193 | 10,038,193 | 10,827,760 |

The three fixtures agree with the reference on results and guest memory. The raw fixture logs also include default LZ and chess and tuned regex. [Before](../various/fixtures-before.jsonl) · [After](../various/fixtures-after.jsonl)

## Corpus instruction counts

Ten seed-7 inputs per declared entry, or per function for projects with no entry list. O2, speed and the default vendored reference received the same guest memory and scalar inputs. The sampler excluded one capped `my-analysis` call in each comparison. Every included call agreed with the reference, and no O2 or speed pass was rejected. Cells with arrows show before and after. Tuned columns use chains, coalescing and homes. [Raw baseline](../various/corpus-before.jsonl) · [Raw final measurements](../various/corpus-after.jsonl)

| Project | O2 | speed | O2 tuned | speed tuned | Reference |
| --- | ---: | ---: | ---: | ---: | ---: |
| across-calls | 640 | 270 | 630 | 210 | 700 |
| algebra | 20 | 20 | 20 | 20 | 170 |
| blend | 1,925 | 1,915 | 1,750 | 1,585 | 1,715 |
| bounds-lab | 5,333 | 5,012 | 4,843 | 4,426 | 4,234 |
| bounds-offset | 1,364 | 1,355 | 1,268 | 1,258 | 894 |
| bounds-param | 502 | 499 | 452 | 408 | 426 |
| bounds-two | 810 | 756 | 710 | 665 | 675 |
| branches | 139 | 139 | 131 | 131 | 211 |
| bytecode-vm | 32,295 → 31,981 | 32,295 → 31,981 | 24,750 → 24,593 | 24,750 → 24,593 | 28,889 |
| call-chain | 1,050 | 350 | 1,050 | 290 | 1,120 |
| calls | 651 | 288 | 580 | 227 | 840 |
| checksum | 1,410 | 1,251 | 1,260 | 1,110 | 1,170 |
| chess-search | 397,500 | 309,202 | 381,202 | 281,768 | 311,176 |
| collatz | 7,461 | 6,955 | 5,779 | 5,769 | 7,016 |
| constants | 70 | 70 | 70 | 70 | 160 |
| dead-code | 30 | 30 | 30 | 30 | 200 |
| diagnostics | 30 | 30 | 30 | 30 | 90 |
| distinct | 340 | 80 | 340 | 60 | 700 |
| div-checks | 162 | 162 | 152 | 152 | 308 |
| div-magic | 769 | 759 | 710 | 661 | 807 |
| early-exit | 631 | 564 | 559 | 557 | 575 |
| f32-dsp | 49,030 | 46,361 | 47,923 | 44,107 | 40,740 |
| first-steps | 220 | 80 | 220 | 80 | 500 |
| fixed-point | 411 | 251 | 392 | 242 | 647 |
| fragments | 2,299 | 2,289 | 2,090 | 1,891 | 2,021 |
| gcd | 324 | 314 | 314 | 265 | 365 |
| heat-lab | 8,832 | 8,664 | 8,026 | 7,996 | 6,758 |
| histogram | 2,292 | 2,222 | 2,008 | 2,000 | 2,036 |
| licm-nested | 1,678 | 1,631 | 1,678 | 1,596 | 2,426 |
| licm-traps | 153 | 149 | 153 | 142 | 196 |
| lz-roundtrip | 34,551 → 32,943 | 28,745 → 26,531 | 33,660 → 32,365 | 28,330 → 25,662 | 28,499 |
| match-enum | 251 | 251 | 226 | 226 | 396 |
| my-analysis | 975 | 966 | 795 | 618 | 696 |
| my-first-pass | 50 | 50 | 50 | 50 | 120 |
| nested-loops | 2,342 | 2,289 | 2,342 | 2,252 | 2,312 |
| orders | 1,194 | 1,185 | 1,010 | 952 | 1,351 |
| params-demo | 2,299 | 2,289 | 2,090 | 1,891 | 2,021 |
| pressure | 240 | 240 | 230 | 230 | 490 |
| ramp | 1,040 | 962 | 790 | 780 | 1,120 |
| records | 260 | 260 | 240 | 240 | 391 |
| regalloc-lab | 2,614 | 2,051 | 2,462 | 1,716 | 2,028 |
| regex-nfa | 40,178 → 38,546 | 35,604 → 33,972 | 38,711 → 37,079 | 28,094 → 27,278 | 33,997 |
| sha-chacha | 231,890 → 227,406 | 125,151 → 120,667 | 210,676 → 208,596 | 106,772 → 104,530 | 135,119 |
| sort | 5,043 | 4,950 | 4,589 | 4,563 | 3,898 |
| start-here | 3,871 | 2,932 | 3,467 | 2,559 | 3,167 |
| strength | 1,938 | 1,793 | 1,414 | 1,404 | 1,889 |
| strings | 10,833 | 10,283 | 9,282 | 9,262 | 9,392 |
| ui-gallery | 1,058 | 754 | 1,016 | 594 | 825 |
| value-numbering | 3,082 | 3,073 | 2,666 | 2,453 | 3,771 |
| wrong-shift | 1,650 | 1,491 | 1,490 | 1,340 | 1,410 |
| **Total** | 863,730 → 855,692 | 649,282 → 640,638 | 806,326 → 801,162 | 576,822 → 570,939 | 650,657 |

Default O2 saved 8,038 instructions and default speed saved 8,644. Tuned O2 saved 5,164 and tuned speed saved 5,883. Four projects improved and no measured project rose in any of the four comparisons. In addition to regex and LZ, the pass removed three fixed checks in the bytecode VM and six in SHA-256/ChaCha20. The Horner rule fired only in LZ.

## Framework scope and evidence limits

The Typed range analysis uses the existing framework lattice, edge transfer, solver and pass dependency declarations. The BCE edits use the normal transaction and correspondence mechanism, and Horner uses the existing table compiler. There were no changes under `src/framework/`. The new proof case belongs to Typed's existing rule verifier, where the semantics of its i32 operators are known.

The emulator measurements establish instruction counts, the before-and-after comparisons and step deltas. The meaning checks and reference comparisons establish agreement for the stated samples. The unsigned range argument and the scope of its transfer to all valid bound checks follow from interval containment and control-flow semantics. The Horner equivalence is proved by the verifier and independently exercised by the sampled pass check. Instruction counts beyond the stated inputs and wall-clock speed were outside the measurement.

## Qualification

| Check | Result |
| --- | --- |
| `npm run build` on Node v24.18.0 | Passed |
| `node --test --test-concurrency=2 tests/typed/*.test.mjs` | 157 passed, 2 opt-in tests skipped |
| `node --test --test-concurrency=2 tests/framework/*.test.mjs` | 234 passed |
| `node --test --test-concurrency=2 tests/workbench/*.test.mjs` | 24 passed, 1 opt-in test skipped |
| `node tools/parity.mjs` | 8,286 of 8,286 decided cases agreed, 14 inconclusive, no failures |
| `node tools/reference-check.mjs` and `--o2` | Both agreed on 8,286 decided cases, 14 inconclusive each |

The parity command exercised 50 projects and rejected the deliberately wrong `div-to-shift` pass as expected. The test worker count was limited to two for the shared machine.

## Later

- Repair the stale-value-ID failure in late LVN before considering that schedule.
- Add a rule grammar guard for interchangeable bases and masks if more corpus examples justify it.
