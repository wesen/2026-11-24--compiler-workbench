---
Title: Measurement report
Ticket: IRWB-037-C
Status: active
Topics:
    - typed
    - optimization
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:39:14.897288626-05:00
WhatFor: ""
WhenToUse: ""
---

# Measurement report

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Status

This is an incomplete investigation: no new rule or pass change was established to pay, and no compiler or framework files changed. The candidate below requires further work before it can safely be implemented. The numbers here are baseline measurements, not an after-optimization result. No rule was added, so no new rule-verification result is claimed.

## Method and evidence

The checked corpus baseline (`scripts/01-corpus-measure.mjs`) uses D1's measurement: 10 generated cases per function, seed 7, checks of five cases per pass, default backend and a 200,000 instruction limit. `scripts/05-reference-corpus.mjs` runs the same cases against the reference image. `various/baseline.json` and `reference.json` retain results and limits. The total includes a capped case in my-analysis on both sides and is therefore not the actual total instructions for that case. A reference image and workbench image may take different paths; each cap is recorded separately. No pass was rejected in the baseline.

For the original regex fixture `[a-c]*[b-d]*a*d` on `abccabbd`, `scripts/02-regex.sh` reproduces 8,183 r0, 6,933 speed and 6,628 reference instructions. This is 305 above reference, after D1 lowered the earlier 8,040. Its attribution records 6,933 instructions after speed; inline saves 181, LICM saves 735, and rotate saves 26. Attribution is per edit group, not proof that a particular remaining instruction is redundant.

The head-site probe `scripts/03-hot-sites.mjs` attributes actual executed instructions to statement coverage. The sites include a load and equality branch at 360 instructions (72 executions, five instructions each), a second at 320 (64 times), and a 5-times-index load at 310 (62 times). Repeated array checks include four sites of 128 instructions apiece (64 executions of two instructions); they are candidates for proving an earlier check sufficient. Some comparisons to nonzero constants and multiplication by five take two instructions; replacing multiplication with shift plus add also takes two and does not alone promise a gain. Coverage aggregates backend instructions under a statement, so it does not independently establish which instructions are removable.

A reference-gap-guided experiment tried existing checked passes after speed on this fixture (`scripts/04-pass-candidates.mjs`). `bce`, `bcm`, `lvn`, `simplify`, `cfg`, `subst`, and `strength` made no edits; `constprop` made five checked edits (40/40 cases) but left the count at 6,933. This is a measured negative result, not evidence that other orderings cannot help. A potential new repeated-check elimination needs a path-sensitive proof that the index has not been reassigned between the dominating successful check and the later check, including loop iterations; equal reaching-definition sets alone are insufficient to establish equal dynamic values. No such proof or implementation is claimed here.

The original LZ benchmark test reports 156,782 tuned speed instructions over 100 seed-7 cases against 156,405 reference (previously 157,682 and 156,405). Regex and LZ focused tests passed. The large original chess fixture was not remeasured; the comparable generated corpus cases below give 327,316 speed versus 334,902 reference. These cases differ from the original 10.08M/10.83M fixture and cannot be compared to it.

## Corpus baseline

The table is default backend, with O2 and speed measured before any change; as no compiler change was made these are also the unchanged after values, not independent reruns. Reference uses its default policy. The final column records speed/reference cases hitting the limit. O2 has the same one capped case. `scripts/06-table.mjs` constructs this table from the raw data.
| Project | O2 | speed | reference | limited (ours/reference) |
| --- | ---: | ---: | ---: | ---: |
| across-calls | 640 | 270 | 700 | 0/0 |
| algebra | 20 | 20 | 170 | 0/0 |
| blend | 1925 | 1915 | 1715 | 0/0 |
| bounds-lab | 5333 | 5012 | 4234 | 0/0 |
| bounds-offset | 1364 | 1355 | 894 | 0/0 |
| bounds-param | 502 | 499 | 426 | 0/0 |
| bounds-two | 810 | 756 | 675 | 0/0 |
| branches | 139 | 139 | 211 | 0/0 |
| bytecode-vm | 32295 | 32295 | 28889 | 0/0 |
| call-chain | 1050 | 350 | 1120 | 0/0 |
| calls | 651 | 288 | 840 | 0/0 |
| checksum | 1410 | 1251 | 1170 | 0/0 |
| chess-search | 423077 | 327316 | 334902 | 0/0 |
| collatz | 7461 | 6955 | 7016 | 0/0 |
| constants | 70 | 70 | 160 | 0/0 |
| dead-code | 30 | 30 | 200 | 0/0 |
| diagnostics | 30 | 30 | 90 | 0/0 |
| distinct | 340 | 80 | 700 | 0/0 |
| div-checks | 162 | 162 | 308 | 0/0 |
| div-magic | 769 | 759 | 807 | 0/0 |
| early-exit | 631 | 564 | 575 | 0/0 |
| f32-dsp | 49030 | 46361 | 40740 | 0/0 |
| first-steps | 220 | 80 | 500 | 0/0 |
| fixed-point | 411 | 251 | 647 | 0/0 |
| fragments | 2299 | 2289 | 2021 | 0/0 |
| gcd | 324 | 314 | 365 | 0/0 |
| heat-lab | 8832 | 8664 | 6758 | 0/0 |
| histogram | 2292 | 2222 | 2036 | 0/0 |
| licm-nested | 1678 | 1631 | 2426 | 0/0 |
| licm-traps | 153 | 149 | 196 | 0/0 |
| lz-roundtrip | 34551 | 28745 | 28499 | 0/0 |
| match-enum | 251 | 251 | 396 | 0/0 |
| my-analysis | 200975 | 200966 | 200696 | 1/1 |
| my-first-pass | 50 | 50 | 120 | 0/0 |
| nested-loops | 2342 | 2289 | 2312 | 0/0 |
| orders | 1194 | 1185 | 1351 | 0/0 |
| params-demo | 2299 | 2289 | 2021 | 0/0 |
| pressure | 240 | 240 | 490 | 0/0 |
| ramp | 1040 | 962 | 1120 | 0/0 |
| records | 260 | 260 | 391 | 0/0 |
| regalloc-lab | 2614 | 2051 | 2028 | 0/0 |
| regex-nfa | 40212 | 35638 | 34041 | 0/0 |
| sha-chacha | 232820 | 125491 | 136109 | 0/0 |
| sort | 5043 | 4950 | 3898 | 0/0 |
| start-here | 3871 | 2932 | 3167 | 0/0 |
| strength | 1938 | 1793 | 1889 | 0/0 |
| strings | 10833 | 10283 | 9392 | 0/0 |
| ui-gallery | 1058 | 754 | 825 | 0/0 |
| value-numbering | 3082 | 3073 | 3771 | 0/0 |
| wrong-shift | 1650 | 1491 | 1410 | 0/0 |
| **total** | **1090271** | **867770** | **875417** | |

## Left out and later

- Implement and check a path-sensitive repeated bounds-check elimination, then measure it across the corpus; the present observation is not a correctness argument.
- Reproduce the original chess fixture and measure the final compiler after an actual optimization.
- Extend attribution to connect head-site costs and rewrite-rule identities automatically; this investigation joins the existing attribution with a separate head-site probe.
