---
Title: Measurement tables
Ticket: IRWB-035-B
Status: complete
Topics: [compiler, ir, verification]
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Census grouped by preset, pass, project and rule set.
LastUpdated: 2026-11-27
WhatFor: Reproduce the grouped edit and RV32 shares.
WhenToUse: Read alongside the final report.
---

## Measurement tables

Each cell gives the denominator followed by the local / structural / other shares. A dash denotes an empty denominator. The JSON ledgers preserve unrounded counts and every record in revision order. Each revision contributes the union of affected RV32 words on each side to its pass and project.

| Group | Edit records | Static RV32 words | Executed RV32 words |
| --- | --- | --- | --- |
| O2 | 2,021 · 10.0% / 69.9% / 20.0% | 7,002 · 16.7% / 41.3% / 42.0% | 832,248 · 23.0% / 55.6% / 21.4% |
| speed | 9,736 · 4.2% / 83.5% / 12.3% | 25,824 · 9.5% / 69.7% / 20.8% | 2,330,995 · 11.3% / 73.6% / 15.0% |

### O2 by pass

| Group | Edit records | Static RV32 words | Executed RV32 words |
| --- | --- | --- | --- |
| cfg | 1,058 · 0.0% / 100.0% / 0.0% | 2,053 · 0.0% / 100.0% / 0.0% | 300,393 · 0.0% / 100.0% / 0.0% |
| fold | 43 · 100.0% / 0.0% / 0.0% | 310 · 100.0% / 0.0% / 0.0% | 20,200 · 100.0% / 0.0% / 0.0% |
| simplify | 140 · 100.0% / 0.0% / 0.0% | 717 · 100.0% / 0.0% / 0.0% | 164,810 · 100.0% / 0.0% / 0.0% |
| constprop | 141 · 0.0% / 0.0% / 100.0% | 1,776 · 0.0% / 0.0% / 100.0% | 51,014 · 0.0% / 0.0% / 100.0% |
| dce | 118 · 0.0% / 0.0% / 100.0% | 127 · 0.0% / 0.0% / 100.0% | 3,429 · 0.0% / 0.0% / 100.0% |
| licm | 329 · 0.0% / 100.0% / 0.0% | 802 · 0.0% / 100.0% / 0.0% | 159,349 · 0.0% / 100.0% / 0.0% |
| lvn | 44 · 0.0% / 0.0% / 100.0% | 143 · 0.0% / 0.0% / 100.0% | 14,865 · 0.0% / 0.0% / 100.0% |
| strength | 20 · 100.0% / 0.0% / 0.0% | 143 · 100.0% / 0.0% / 0.0% | 6,436 · 100.0% / 0.0% / 0.0% |
| bce | 26 · 0.0% / 100.0% / 0.0% | 39 · 0.0% / 100.0% / 0.0% | 3,260 · 0.0% / 100.0% / 0.0% |
| subst | 102 · 0.0% / 0.0% / 100.0% | 892 · 0.0% / 0.0% / 100.0% | 108,492 · 0.0% / 0.0% / 100.0% |

### O2 by project

| Group | Edit records | Static RV32 words | Executed RV32 words |
| --- | --- | --- | --- |
| across-calls | 4 · 0.0% / 0.0% / 100.0% | 34 · 0.0% / 0.0% / 100.0% | 340 · 0.0% / 0.0% / 100.0% |
| algebra | 11 · 45.5% / 0.0% / 54.5% | 28 · 60.7% / 0.0% / 39.3% | 280 · 60.7% / 0.0% / 39.3% |
| blend | 9 · 22.2% / 55.6% / 22.2% | 38 · 13.2% / 47.4% / 39.5% | 5,360 · 7.1% / 49.6% / 43.3% |
| bounds-lab | 40 · 10.0% / 90.0% / 0.0% | 85 · 16.5% / 83.5% / 0.0% | 8,314 · 18.7% / 81.3% / 0.0% |
| bounds-offset | 7 · 14.3% / 85.7% / 0.0% | 22 · 27.3% / 72.7% / 0.0% | 1,600 · 30.0% / 70.0% / 0.0% |
| bounds-param | 3 · 33.3% / 66.7% / 0.0% | 6 · 33.3% / 66.7% / 0.0% | 308 · 35.1% / 64.9% / 0.0% |
| bounds-two | 13 · 7.7% / 92.3% / 0.0% | 27 · 14.8% / 85.2% / 0.0% | 1,320 · 16.7% / 83.3% / 0.0% |
| branches | 12 · 8.3% / 83.3% / 8.3% | 18 · 33.3% / 61.1% / 5.6% | 93 · 25.8% / 63.4% / 10.8% |
| bytecode-vm | 205 · 0.5% / 97.6% / 2.0% | 375 · 0.8% / 92.0% / 7.2% | 118,400 · 2.3% / 79.7% / 17.9% |
| call-chain | 1 · 100.0% / 0.0% / 0.0% | 6 · 100.0% / 0.0% / 0.0% | 60 · 100.0% / 0.0% / 0.0% |
| calls | 2 · 0.0% / 0.0% / 100.0% | 18 · 0.0% / 0.0% / 100.0% | 180 · 0.0% / 0.0% / 100.0% |
| checksum | 11 · 9.1% / 90.9% / 0.0% | 23 · 17.4% / 82.6% / 0.0% | 3,340 · 19.2% / 80.8% / 0.0% |
| chess-search | 764 · 11.5% / 76.6% / 11.9% | 2,143 · 29.7% / 52.4% / 17.9% | 287,516 · 41.0% / 49.5% / 9.5% |
| collatz | 0 · — / — / — | 0 · — / — / — | 0 · — / — / — |
| constants | 8 · 37.5% / 0.0% / 62.5% | 47 · 40.4% / 0.0% / 59.6% | 470 · 40.4% / 0.0% / 59.6% |
| dead-code | 24 · 12.5% / 62.5% / 25.0% | 36 · 27.8% / 44.4% / 27.8% | 280 · 21.4% / 42.9% / 35.7% |
| diagnostics | 3 · 33.3% / 0.0% / 66.7% | 6 · 33.3% / 0.0% / 66.7% | 60 · 33.3% / 0.0% / 66.7% |
| distinct | 0 · — / — / — | 0 · — / — / — | 0 · — / — / — |
| div-checks | 6 · 0.0% / 0.0% / 100.0% | 12 · 0.0% / 0.0% / 100.0% | 88 · 0.0% / 0.0% / 100.0% |
| div-magic | 2 · 100.0% / 0.0% / 0.0% | 26 · 100.0% / 0.0% / 0.0% | 358 · 100.0% / 0.0% / 0.0% |
| early-exit | 12 · 16.7% / 83.3% / 0.0% | 29 · 20.7% / 79.3% / 0.0% | 1,722 · 17.0% / 83.0% / 0.0% |
| f32-dsp | 82 · 25.6% / 67.1% / 7.3% | 237 · 44.7% / 48.1% / 7.2% | 40,310 · 43.8% / 44.0% / 12.2% |
| first-steps | 4 · 50.0% / 0.0% / 50.0% | 12 · 58.3% / 0.0% / 41.7% | 360 · 58.3% / 0.0% / 41.7% |
| fixed-point | 9 · 11.1% / 0.0% / 88.9% | 24 · 12.5% / 0.0% / 87.5% | 388 · 15.5% / 0.0% / 84.5% |
| fragments | 9 · 22.2% / 55.6% / 22.2% | 38 · 13.2% / 47.4% / 39.5% | 6,448 · 6.9% / 49.7% / 43.4% |
| gcd | 1 · 100.0% / 0.0% / 0.0% | 2 · 100.0% / 0.0% / 0.0% | 118 · 100.0% / 0.0% / 0.0% |
| heat-lab | 13 · 7.7% / 92.3% / 0.0% | 30 · 13.3% / 86.7% / 0.0% | 5,394 · 5.9% / 94.1% / 0.0% |
| histogram | 17 · 5.9% / 94.1% / 0.0% | 47 · 8.5% / 91.5% / 0.0% | 2,892 · 10.0% / 90.0% / 0.0% |
| licm-nested | 10 · 20.0% / 80.0% / 0.0% | 16 · 25.0% / 75.0% / 0.0% | 2,945 · 24.7% / 75.3% / 0.0% |
| licm-traps | 1 · 100.0% / 0.0% / 0.0% | 2 · 100.0% / 0.0% / 0.0% | 42 · 100.0% / 0.0% / 0.0% |
| lz-roundtrip | 79 · 5.1% / 57.0% / 38.0% | 573 · 1.7% / 16.2% / 82.0% | 71,802 · 3.4% / 19.5% / 77.1% |
| match-enum | 6 · 0.0% / 83.3% / 16.7% | 7 · 0.0% / 85.7% / 14.3% | 37 · 0.0% / 73.0% / 27.0% |
| my-analysis | 12 · 16.7% / 83.3% / 0.0% | 16 · 37.5% / 62.5% / 0.0% | 810 · 94.1% / 5.9% / 0.0% |
| my-first-pass | 8 · 0.0% / 0.0% / 100.0% | 15 · 0.0% / 0.0% / 100.0% | 150 · 0.0% / 0.0% / 100.0% |
| nested-loops | 5 · 40.0% / 60.0% / 0.0% | 12 · 33.3% / 66.7% / 0.0% | 3,278 · 26.7% / 73.3% / 0.0% |
| orders | 36 · 25.0% / 22.2% / 52.8% | 102 · 33.3% / 13.7% / 52.9% | 2,384 · 35.2% / 26.0% / 38.8% |
| params-demo | 9 · 22.2% / 55.6% / 22.2% | 38 · 13.2% / 47.4% / 39.5% | 6,448 · 6.9% / 49.7% / 43.4% |
| pressure | 8 · 0.0% / 0.0% / 100.0% | 82 · 0.0% / 0.0% / 100.0% | 820 · 0.0% / 0.0% / 100.0% |
| ramp | 14 · 7.1% / 71.4% / 21.4% | 32 · 12.5% / 59.4% / 28.1% | 2,000 · 16.0% / 63.0% / 21.0% |
| records | 0 · — / — / — | 0 · — / — / — | 0 · — / — / — |
| regalloc-lab | 8 · 25.0% / 25.0% / 50.0% | 58 · 37.9% / 6.9% / 55.2% | 1,026 · 37.2% / 31.6% / 31.2% |
| regex-nfa | 252 · 2.4% / 90.5% / 7.1% | 714 · 2.1% / 79.6% / 18.3% | 95,740 · 3.4% / 87.2% / 9.4% |
| sha-chacha | 206 · 5.3% / 19.4% / 75.2% | 1,728 · 5.8% / 8.2% / 86.0% | 125,002 · 24.2% / 42.7% / 33.1% |
| sort | 13 · 7.7% / 92.3% / 0.0% | 30 · 13.3% / 86.7% / 0.0% | 3,072 · 6.8% / 93.2% / 0.0% |
| start-here | 17 · 23.5% / 76.5% / 0.0% | 37 · 43.2% / 56.8% / 0.0% | 4,596 · 46.9% / 53.1% / 0.0% |
| strength | 14 · 14.3% / 64.3% / 21.4% | 40 · 37.5% / 47.5% / 15.0% | 3,852 · 18.0% / 63.6% / 18.4% |
| strings | 24 · 8.3% / 91.7% / 0.0% | 46 · 17.4% / 82.6% / 0.0% | 11,762 · 18.7% / 81.3% / 0.0% |
| ui-gallery | 11 · 36.4% / 36.4% / 27.3% | 33 · 48.5% / 18.2% / 33.3% | 1,072 · 49.4% / 25.4% / 25.2% |
| value-numbering | 5 · 20.0% / 0.0% / 80.0% | 27 · 7.4% / 0.0% / 92.6% | 5,771 · 7.7% / 0.0% / 92.3% |
| wrong-shift | 11 · 9.1% / 90.9% / 0.0% | 25 · 16.0% / 84.0% / 0.0% | 3,640 · 17.6% / 82.4% / 0.0% |

### speed by pass

| Group | Edit records | Static RV32 words | Executed RV32 words |
| --- | --- | --- | --- |
| inline | 3,165 · 0.0% / 100.0% / 0.0% | 10,342 · 0.0% / 100.0% / 0.0% | 829,101 · 0.0% / 100.0% / 0.0% |
| cfg | 4,234 · 0.0% / 100.0% / 0.0% | 6,060 · 0.0% / 100.0% / 0.0% | 637,284 · 0.0% / 100.0% / 0.0% |
| fold | 104 · 100.0% / 0.0% / 0.0% | 719 · 100.0% / 0.0% / 0.0% | 94,007 · 100.0% / 0.0% / 0.0% |
| simplify | 258 · 100.0% / 0.0% / 0.0% | 1,456 · 100.0% / 0.0% / 0.0% | 158,743 · 100.0% / 0.0% / 0.0% |
| constprop | 258 · 0.0% / 0.0% / 100.0% | 2,357 · 0.0% / 0.0% / 100.0% | 142,964 · 0.0% / 0.0% / 100.0% |
| dce | 216 · 0.0% / 0.0% / 100.0% | 230 · 0.0% / 0.0% / 100.0% | 13,136 · 0.0% / 0.0% / 100.0% |
| licm | 422 · 0.0% / 100.0% / 0.0% | 903 · 0.0% / 100.0% / 0.0% | 140,090 · 0.0% / 100.0% / 0.0% |
| lvn | 64 · 0.0% / 0.0% / 100.0% | 185 · 0.0% / 0.0% / 100.0% | 13,083 · 0.0% / 0.0% / 100.0% |
| strength | 46 · 100.0% / 0.0% / 0.0% | 279 · 100.0% / 0.0% / 0.0% | 11,496 · 100.0% / 0.0% / 0.0% |
| bce | 26 · 0.0% / 100.0% / 0.0% | 39 · 0.0% / 100.0% / 0.0% | 3,260 · 0.0% / 100.0% / 0.0% |
| subst | 662 · 0.0% / 0.0% / 100.0% | 2,597 · 0.0% / 0.0% / 100.0% | 181,262 · 0.0% / 0.0% / 100.0% |
| rotate | 281 · 0.0% / 100.0% / 0.0% | 657 · 0.0% / 100.0% / 0.0% | 106,569 · 0.0% / 100.0% / 0.0% |

### speed by project

| Group | Edit records | Static RV32 words | Executed RV32 words |
| --- | --- | --- | --- |
| across-calls | 69 · 0.0% / 91.3% / 8.7% | 128 · 0.0% / 74.2% / 25.8% | 1,400 · 0.0% / 76.4% / 23.6% |
| algebra | 11 · 45.5% / 0.0% / 54.5% | 28 · 60.7% / 0.0% / 39.3% | 280 · 60.7% / 0.0% / 39.3% |
| blend | 12 · 16.7% / 66.7% / 16.7% | 43 · 11.6% / 53.5% / 34.9% | 6,030 · 6.3% / 55.2% / 38.5% |
| bounds-lab | 58 · 6.9% / 82.8% / 10.3% | 139 · 10.1% / 71.9% / 18.0% | 13,205 · 11.8% / 69.1% / 19.2% |
| bounds-offset | 10 · 10.0% / 90.0% / 0.0% | 33 · 18.2% / 81.8% / 0.0% | 2,211 · 21.7% / 78.3% / 0.0% |
| bounds-param | 6 · 16.7% / 83.3% / 0.0% | 11 · 18.2% / 81.8% / 0.0% | 501 · 21.6% / 78.4% / 0.0% |
| bounds-two | 18 · 5.6% / 83.3% / 11.1% | 42 · 9.5% / 73.8% / 16.7% | 1,976 · 11.1% / 71.2% / 17.7% |
| branches | 12 · 8.3% / 83.3% / 8.3% | 18 · 33.3% / 61.1% / 5.6% | 93 · 25.8% / 63.4% / 10.8% |
| bytecode-vm | 205 · 0.5% / 97.6% / 2.0% | 375 · 0.8% / 92.0% / 7.2% | 118,400 · 2.3% / 79.7% / 17.9% |
| call-chain | 135 · 0.7% / 90.4% / 8.9% | 199 · 2.0% / 74.9% / 23.1% | 2,590 · 1.5% / 80.7% / 17.8% |
| calls | 96 · 0.0% / 81.3% / 18.8% | 141 · 0.0% / 64.5% / 35.5% | 1,413 · 0.0% / 66.7% / 33.3% |
| checksum | 16 · 6.3% / 81.3% / 12.5% | 40 · 10.0% / 67.5% / 22.5% | 5,621 · 11.4% / 64.6% / 24.0% |
| chess-search | 7,260 · 3.7% / 86.4% / 9.9% | 18,419 · 9.6% / 76.8% / 13.5% | 1,022,632 · 12.0% / 80.7% / 7.4% |
| collatz | 3 · 0.0% / 100.0% / 0.0% | 8 · 0.0% / 100.0% / 0.0% | 2,624 · 0.0% / 100.0% / 0.0% |
| constants | 8 · 37.5% / 0.0% / 62.5% | 47 · 40.4% / 0.0% / 59.6% | 470 · 40.4% / 0.0% / 59.6% |
| dead-code | 24 · 12.5% / 62.5% / 25.0% | 36 · 27.8% / 44.4% / 27.8% | 280 · 21.4% / 42.9% / 35.7% |
| diagnostics | 3 · 33.3% / 0.0% / 66.7% | 6 · 33.3% / 0.0% / 66.7% | 60 · 33.3% / 0.0% / 66.7% |
| distinct | 55 · 0.0% / 89.1% / 10.9% | 38 · 0.0% / 78.9% / 21.1% | 410 · 0.0% / 80.5% / 19.5% |
| div-checks | 6 · 0.0% / 0.0% / 100.0% | 12 · 0.0% / 0.0% / 100.0% | 88 · 0.0% / 0.0% / 100.0% |
| div-magic | 5 · 40.0% / 60.0% / 0.0% | 31 · 83.9% / 16.1% / 0.0% | 564 · 63.5% / 36.5% / 0.0% |
| early-exit | 17 · 11.8% / 76.5% / 11.8% | 46 · 13.0% / 67.4% / 19.6% | 2,693 · 10.8% / 67.4% / 21.7% |
| f32-dsp | 129 · 16.3% / 76.0% / 7.8% | 377 · 28.1% / 60.7% / 11.1% | 76,987 · 23.0% / 60.3% / 16.8% |
| first-steps | 51 · 11.8% / 64.7% / 23.5% | 92 · 22.8% / 42.4% / 34.8% | 1,000 · 21.0% / 47.0% / 32.0% |
| fixed-point | 55 · 3.6% / 56.4% / 40.0% | 132 · 4.5% / 50.8% / 44.7% | 1,286 · 4.7% / 56.6% / 38.7% |
| fragments | 12 · 16.7% / 66.7% / 16.7% | 43 · 11.6% / 53.5% / 34.9% | 7,254 · 6.2% / 55.3% / 38.5% |
| gcd | 4 · 25.0% / 75.0% / 0.0% | 7 · 28.6% / 71.4% / 0.0% | 324 · 36.4% / 63.6% / 0.0% |
| heat-lab | 19 · 5.3% / 94.7% / 0.0% | 43 · 9.3% / 90.7% / 0.0% | 6,522 · 4.9% / 95.1% / 0.0% |
| histogram | 22 · 4.5% / 86.4% / 9.1% | 74 · 5.4% / 68.9% / 25.7% | 4,474 · 6.4% / 67.2% / 26.3% |
| licm-nested | 16 · 12.5% / 87.5% / 0.0% | 26 · 15.4% / 84.6% / 0.0% | 4,248 · 17.1% / 82.9% / 0.0% |
| licm-traps | 4 · 25.0% / 75.0% / 0.0% | 7 · 28.6% / 71.4% / 0.0% | 102 · 41.2% / 58.8% / 0.0% |
| lz-roundtrip | 192 · 3.1% / 74.0% / 22.9% | 752 · 1.9% / 56.1% / 42.0% | 75,345 · 3.2% / 59.9% / 36.9% |
| match-enum | 6 · 0.0% / 83.3% / 16.7% | 7 · 0.0% / 85.7% / 14.3% | 37 · 0.0% / 73.0% / 27.0% |
| my-analysis | 16 · 12.5% / 87.5% / 0.0% | 28 · 21.4% / 78.6% / 0.0% | 1,923 · 39.6% / 60.4% / 0.0% |
| my-first-pass | 8 · 0.0% / 0.0% / 100.0% | 15 · 0.0% / 0.0% / 100.0% | 150 · 0.0% / 0.0% / 100.0% |
| nested-loops | 11 · 18.2% / 81.8% / 0.0% | 22 · 18.2% / 81.8% / 0.0% | 4,863 · 18.0% / 82.0% / 0.0% |
| orders | 39 · 23.1% / 28.2% / 48.7% | 107 · 31.8% / 17.8% / 50.5% | 2,627 · 32.0% / 32.9% / 35.2% |
| params-demo | 12 · 16.7% / 66.7% / 16.7% | 43 · 11.6% / 53.5% / 34.9% | 7,254 · 6.2% / 55.3% / 38.5% |
| pressure | 8 · 0.0% / 0.0% / 100.0% | 82 · 0.0% / 0.0% / 100.0% | 820 · 0.0% / 0.0% / 100.0% |
| ramp | 19 · 5.3% / 68.4% / 26.3% | 45 · 8.9% / 60.0% / 31.1% | 2,802 · 11.4% / 61.1% / 27.5% |
| records | 0 · — / — / — | 0 · — / — / — | 0 · — / — / — |
| regalloc-lab | 33 · 6.1% / 69.7% / 24.2% | 132 · 16.7% / 47.7% / 35.6% | 6,767 · 5.6% / 71.7% / 22.7% |
| regex-nfa | 288 · 2.1% / 90.3% / 7.6% | 745 · 2.0% / 79.9% / 18.1% | 100,468 · 3.2% / 87.2% / 9.6% |
| sha-chacha | 541 · 4.6% / 59.7% / 35.7% | 2,657 · 7.8% / 31.8% / 60.4% | 784,791 · 12.5% / 66.2% / 21.3% |
| sort | 19 · 5.3% / 94.7% / 0.0% | 43 · 9.3% / 90.7% / 0.0% | 3,751 · 5.5% / 94.5% / 0.0% |
| start-here | 89 · 6.7% / 73.0% / 20.2% | 190 · 13.7% / 63.2% / 23.2% | 13,513 · 16.0% / 64.2% / 19.9% |
| strength | 19 · 10.5% / 63.2% / 26.3% | 57 · 26.3% / 47.4% / 26.3% | 5,923 · 11.7% / 55.6% / 32.7% |
| strings | 34 · 5.9% / 82.4% / 11.8% | 76 · 10.5% / 71.1% / 18.4% | 18,726 · 11.8% / 68.4% / 19.8% |
| ui-gallery | 37 · 18.9% / 64.9% / 16.2% | 106 · 26.4% / 54.7% / 18.9% | 2,642 · 20.1% / 69.7% / 10.2% |
| value-numbering | 8 · 12.5% / 37.5% / 50.0% | 32 · 6.3% / 15.6% / 78.1% | 6,634 · 6.7% / 13.0% / 80.3% |
| wrong-shift | 16 · 6.3% / 81.3% / 12.5% | 44 · 9.1% / 65.9% / 25.0% | 6,221 · 10.3% / 63.2% / 26.5% |

## Rule coverage and sensitivity

### O2

Of 203 local edits, 0 carry complete explicit citations, 183 replay entirely with recorded sound table evidence, and 20 require guarded arithmetic shapes. There are 213 individual firings or guarded shape matches. Among 335 changed function–revision pairs, 116 have exclusively local recorded edits. This is an upper bound for discharging a whole function at that revision.

Across the complete preset, 13 of 102 edited project functions have exclusively local records in their own bodies. Calls can introduce additional obligations from the callee.

chess-search contributes 37.8% of edit records. Omitting that project gives 9.1% local by edit count and 13.5% local by executions.

Restricting the denominator to the 505 value-field replacement records gives 40.2% local. The remaining replacements split into 88 structural and 214 other.

If “local” included replacements that need a binding premise, it would gain 214 records (reaching constant 141, forward substitution 51, reuse prior computation 22). The local edit share would become 20.6%. Deletions and helper declarations stay in their original classes.

| Rule or proposed shape | Evidence strength | Firings | Local edits using it |
| --- | --- | --- | --- |
| not-lt | reduced-width+argument | 62 | 62 |
| mul-pow2 | proof | 47 | 46 |
| fold-shl | by-construction | 19 | 19 |
| pow2-mul | proof | 19 | 19 |
| fold-sub | by-construction | 13 | 13 |
| nonnegative-rem-pow2 | range guard required | 13 | 13 |
| nonnegative-div-pow2 | range guard required | 10 | 10 |
| fold-mul | by-construction | 9 | 9 |
| add-zero | proof | 4 | 4 |
| not-gt | reduced-width+argument | 3 | 3 |
| fold-eqz | by-construction | 2 | 2 |
| mul-one | proof | 2 | 2 |
| mul-zero | proof | 2 | 2 |
| not-le | reduced-width+argument | 2 | 2 |
| fold-add | by-construction | 1 | 1 |
| fold-gt | by-construction | 1 | 1 |
| not-ge | reduced-width+argument | 1 | 1 |
| not-ne | reduced-width+argument | 1 | 1 |
| sub-self | proof | 1 | 1 |
| sub-zero | proof | 1 | 1 |

Counting complete edit records instead gives the following disjoint rule sets. A record with several firings of one rule needs that rule only once in its set.

| Required rule set | Edits |
| --- | --- |
| not-lt | 62 |
| mul-pow2 | 46 |
| pow2-mul | 19 |
| fold-shl | 18 |
| fold-sub | 12 |
| nonnegative-rem-pow2 | 10 |
| fold-mul | 8 |
| nonnegative-div-pow2 | 7 |
| nonnegative-div-pow2 + nonnegative-rem-pow2 | 3 |
| not-gt | 3 |
| fold-eqz | 2 |
| not-le | 2 |
| add-zero | 1 |
| add-zero + mul-one | 1 |
| add-zero + mul-zero | 1 |
| add-zero + sub-self | 1 |
| fold-add + fold-shl | 1 |
| fold-gt | 1 |
| fold-mul + fold-sub | 1 |
| mul-one + sub-zero | 1 |
| mul-zero | 1 |
| not-ge | 1 |
| not-ne | 1 |

### speed

Of 408 local edits, 0 carry complete explicit citations, 362 replay entirely with recorded sound table evidence, and 46 require guarded arithmetic shapes. There are 439 individual firings or guarded shape matches. Among 662 changed function–revision pairs, 154 have exclusively local recorded edits. This is an upper bound for discharging a whole function at that revision.

Across the complete preset, 7 of 112 edited project functions have exclusively local records in their own bodies. Calls can introduce additional obligations from the callee.

chess-search contributes 74.6% of edit records. Omitting that project gives 5.7% local by edit count and 10.8% local by executions.

Restricting the denominator to the 1138 value-field replacement records gives 35.9% local. The remaining replacements split into 109 structural and 621 other.

If “local” included replacements that need a binding premise, it would gain 621 records (reaching constant 258, forward substitution 331, reuse prior computation 32). The local edit share would become 10.6%. Deletions and helper declarations stay in their original classes.

| Rule or proposed shape | Evidence strength | Firings | Local edits using it |
| --- | --- | --- | --- |
| mul-pow2 | proof | 143 | 131 |
| not-lt | reduced-width+argument | 72 | 72 |
| fold-shl | by-construction | 54 | 54 |
| fold-sub | by-construction | 33 | 33 |
| pow2-mul | proof | 28 | 28 |
| nonnegative-rem-pow2 | range guard required | 27 | 27 |
| nonnegative-div-pow2 | range guard required | 22 | 22 |
| fold-mul | by-construction | 15 | 15 |
| fold-add | by-construction | 11 | 11 |
| zero-add | proof | 9 | 9 |
| not-gt | reduced-width+argument | 5 | 5 |
| add-zero | proof | 4 | 4 |
| not-le | reduced-width+argument | 4 | 4 |
| fold-eqz | by-construction | 2 | 2 |
| mul-one | proof | 2 | 2 |
| mul-zero | proof | 2 | 2 |
| div-one | exhaustive | 1 | 1 |
| fold-gt | by-construction | 1 | 1 |
| not-ge | reduced-width+argument | 1 | 1 |
| not-ne | reduced-width+argument | 1 | 1 |
| sub-self | proof | 1 | 1 |
| sub-zero | proof | 1 | 1 |

Counting complete edit records instead gives the following disjoint rule sets. A record with several firings of one rule needs that rule only once in its set.

| Required rule set | Edits |
| --- | --- |
| mul-pow2 | 131 |
| not-lt | 72 |
| fold-shl | 45 |
| fold-sub | 32 |
| pow2-mul | 28 |
| nonnegative-rem-pow2 | 24 |
| nonnegative-div-pow2 | 19 |
| fold-mul | 12 |
| fold-add + fold-shl | 9 |
| zero-add | 9 |
| not-gt | 5 |
| not-le | 4 |
| nonnegative-div-pow2 + nonnegative-rem-pow2 | 3 |
| fold-add + fold-mul | 2 |
| fold-eqz | 2 |
| add-zero | 1 |
| add-zero + mul-one | 1 |
| add-zero + mul-zero | 1 |
| add-zero + sub-self | 1 |
| div-one | 1 |
| fold-gt | 1 |
| fold-mul + fold-sub | 1 |
| mul-one + sub-zero | 1 |
| mul-zero | 1 |
| not-ge | 1 |
| not-ne | 1 |
