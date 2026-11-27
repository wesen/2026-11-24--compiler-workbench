# Edit classes on the corpus

50 projects, pipelines O2, speed; 11757 edits in 493 changed applications; run 1841 s; problems: none.

## 1. Per pipeline

| pipeline | edits | local % | structural % | other % | instructions | local % | structural % | other % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| O2 | 2021 | 19.5 | 72.0 | 8.4 | 4517 | 59.6 | 36.1 | 4.3 |
| speed | 9736 | 10.2 | 84.1 | 5.6 | 15735 | 34.3 | 61.7 | 4.0 |

The local class by reason, and the share of value edits (`replace` records) that are local:

| pipeline | local | rule | fact | uncited | rule % of all edits | rule % of all instructions | `replace` edits | local % of them | rule % of them |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| O2 | 395 | 183 | 212 | 0 | 9.1 | 16.5 | 505 | 78.2 | 36.2 |
| speed | 997 | 362 | 635 | 0 | 3.7 | 9.9 | 1138 | 87.6 | 31.8 |

## 2. Per reason

### O2

| class/reason | edits | % | instructions | % | passes |
|---|---:|---:|---:|---:|---:|
| local/fact | 212 | 10.5 | 1947 | 43.1 | constprop strength subst |
| local/rule | 183 | 9.1 | 745 | 16.5 | fold simplify |
| other/dead-statement | 170 | 8.4 | 193 | 4.3 | cfg dce subst |
| structural/cfg | 1117 | 55.3 | 1093 | 24.2 | bce cfg licm |
| structural/cfg/branch-by-fact | 13 | 0.6 | 26 | 0.6 | bce |
| structural/motion | 226 | 11.2 | 513 | 11.4 | licm lvn |
| structural/new-local | 100 | 4.9 | 0 | 0.0 | licm lvn |

### speed

| class/reason | edits | % | instructions | % | passes |
|---|---:|---:|---:|---:|---:|
| local/fact | 635 | 6.5 | 3848 | 24.5 | constprop strength subst |
| local/rule | 362 | 3.7 | 1550 | 9.9 | fold simplify |
| other/dead-statement | 548 | 5.6 | 631 | 4.0 | cfg dce subst |
| structural/cfg | 4405 | 45.2 | 3252 | 20.7 | bce cfg licm rotate |
| structural/cfg/branch-by-fact | 13 | 0.1 | 26 | 0.2 | bce |
| structural/cfg/test-duplicated | 192 | 2.0 | 511 | 3.2 | rotate |
| structural/inline | 3165 | 32.5 | 5327 | 33.9 | inline |
| structural/motion | 290 | 3.0 | 590 | 3.7 | licm lvn |
| structural/new-local | 126 | 1.3 | 0 | 0.0 | licm lvn |

## 3. Per pass

### O2

| pass | edits | local % | structural % | other % | instructions | local % | structural % | other % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cfg | 1058 | 0.0 | 99.9 | 0.1 | 1061 | 0.0 | 100.0 | 0.0 |
| licm | 329 | 0.0 | 100.0 | 0.0 | 457 | 0.0 | 100.0 | 0.0 |
| constprop | 141 | 100.0 | 0.0 | 0.0 | 1272 | 100.0 | 0.0 | 0.0 |
| simplify | 140 | 100.0 | 0.0 | 0.0 | 505 | 100.0 | 0.0 | 0.0 |
| dce | 118 | 0.0 | 0.0 | 100.0 | 127 | 0.0 | 0.0 | 100.0 |
| subst | 102 | 50.0 | 0.0 | 50.0 | 616 | 89.3 | 0.0 | 10.7 |
| lvn | 44 | 0.0 | 100.0 | 0.0 | 75 | 0.0 | 100.0 | 0.0 |
| fold | 43 | 100.0 | 0.0 | 0.0 | 240 | 100.0 | 0.0 | 0.0 |
| bce | 26 | 0.0 | 100.0 | 0.0 | 39 | 0.0 | 100.0 | 0.0 |
| strength | 20 | 100.0 | 0.0 | 0.0 | 125 | 100.0 | 0.0 | 0.0 |

### speed

| pass | edits | local % | structural % | other % | instructions | local % | structural % | other % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cfg | 4234 | 0.0 | 100.0 | 0.0 | 3074 | 0.0 | 100.0 | 0.0 |
| inline | 3165 | 0.0 | 100.0 | 0.0 | 5327 | 0.0 | 100.0 | 0.0 |
| subst | 662 | 50.0 | 0.0 | 50.0 | 2255 | 82.2 | 0.0 | 17.8 |
| licm | 422 | 0.0 | 100.0 | 0.0 | 513 | 0.0 | 100.0 | 0.0 |
| rotate | 281 | 0.0 | 100.0 | 0.0 | 647 | 0.0 | 100.0 | 0.0 |
| simplify | 258 | 100.0 | 0.0 | 0.0 | 956 | 100.0 | 0.0 | 0.0 |
| constprop | 258 | 100.0 | 0.0 | 0.0 | 1761 | 100.0 | 0.0 | 0.0 |
| dce | 216 | 0.0 | 0.0 | 100.0 | 230 | 0.0 | 0.0 | 100.0 |
| fold | 104 | 100.0 | 0.0 | 0.0 | 594 | 100.0 | 0.0 | 0.0 |
| lvn | 64 | 0.0 | 100.0 | 0.0 | 106 | 0.0 | 100.0 | 0.0 |
| strength | 46 | 100.0 | 0.0 | 0.0 | 233 | 100.0 | 0.0 | 0.0 |
| bce | 26 | 0.0 | 100.0 | 0.0 | 39 | 0.0 | 100.0 | 0.0 |

## 4. Per project

### O2

| project | edits | local % | structural % | other % | instructions | local % | structural % | other % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| across-calls | 4 | 50.0 | 0.0 | 50.0 | 30 | 93.3 | 0.0 | 6.7 |
| algebra | 11 | 72.7 | 0.0 | 27.3 | 18 | 83.3 | 0.0 | 16.7 |
| blend | 9 | 33.3 | 55.6 | 11.1 | 20 | 55.0 | 40.0 | 5.0 |
| bounds-lab | 40 | 10.0 | 90.0 | 0.0 | 48 | 16.7 | 83.3 | 0.0 |
| bounds-offset | 7 | 14.3 | 85.7 | 0.0 | 10 | 20.0 | 80.0 | 0.0 |
| bounds-param | 3 | 33.3 | 66.7 | 0.0 | 4 | 50.0 | 50.0 | 0.0 |
| bounds-two | 13 | 7.7 | 92.3 | 0.0 | 15 | 13.3 | 86.7 | 0.0 |
| branches | 12 | 8.3 | 83.3 | 8.3 | 12 | 33.3 | 58.3 | 8.3 |
| bytecode-vm | 205 | 1.5 | 97.6 | 1.0 | 219 | 12.8 | 86.3 | 0.9 |
| call-chain | 1 | 100.0 | 0.0 | 0.0 | 6 | 100.0 | 0.0 | 0.0 |
| calls | 2 | 50.0 | 0.0 | 50.0 | 14 | 85.7 | 0.0 | 14.3 |
| checksum | 11 | 9.1 | 90.9 | 0.0 | 13 | 15.4 | 84.6 | 0.0 |
| chess-search | 764 | 18.1 | 78.1 | 3.8 | 1387 | 53.4 | 43.9 | 2.7 |
| collatz | 0 | - | - | - | 0 | - | - | - |
| constants | 8 | 75.0 | 0.0 | 25.0 | 33 | 93.9 | 0.0 | 6.1 |
| dead-code | 24 | 20.8 | 58.3 | 20.8 | 29 | 44.8 | 37.9 | 17.2 |
| diagnostics | 3 | 66.7 | 0.0 | 33.3 | 6 | 83.3 | 0.0 | 16.7 |
| distinct | 0 | - | - | - | 0 | - | - | - |
| div-checks | 6 | 66.7 | 0.0 | 33.3 | 12 | 83.3 | 0.0 | 16.7 |
| div-magic | 2 | 100.0 | 0.0 | 0.0 | 12 | 100.0 | 0.0 | 0.0 |
| early-exit | 12 | 16.7 | 83.3 | 0.0 | 17 | 23.5 | 76.5 | 0.0 |
| f32-dsp | 82 | 26.8 | 72.0 | 1.2 | 162 | 58.0 | 42.0 | 0.0 |
| first-steps | 4 | 75.0 | 0.0 | 25.0 | 12 | 91.7 | 0.0 | 8.3 |
| fixed-point | 9 | 66.7 | 0.0 | 33.3 | 24 | 79.2 | 0.0 | 20.8 |
| fragments | 9 | 33.3 | 55.6 | 11.1 | 20 | 55.0 | 40.0 | 5.0 |
| gcd | 1 | 100.0 | 0.0 | 0.0 | 2 | 100.0 | 0.0 | 0.0 |
| heat-lab | 13 | 7.7 | 92.3 | 0.0 | 15 | 13.3 | 86.7 | 0.0 |
| histogram | 17 | 5.9 | 94.1 | 0.0 | 25 | 8.0 | 92.0 | 0.0 |
| licm-nested | 10 | 20.0 | 80.0 | 0.0 | 13 | 30.8 | 69.2 | 0.0 |
| licm-traps | 1 | 100.0 | 0.0 | 0.0 | 2 | 100.0 | 0.0 | 0.0 |
| lz-roundtrip | 79 | 24.1 | 57.0 | 19.0 | 336 | 78.0 | 15.5 | 6.5 |
| match-enum | 6 | 0.0 | 83.3 | 16.7 | 5 | 0.0 | 80.0 | 20.0 |
| my-analysis | 12 | 16.7 | 83.3 | 0.0 | 10 | 40.0 | 60.0 | 0.0 |
| my-first-pass | 8 | 25.0 | 50.0 | 25.0 | 12 | 50.0 | 33.3 | 16.7 |
| nested-loops | 5 | 40.0 | 60.0 | 0.0 | 9 | 44.4 | 55.6 | 0.0 |
| orders | 36 | 44.4 | 44.4 | 11.1 | 85 | 76.5 | 18.8 | 4.7 |
| params-demo | 9 | 33.3 | 55.6 | 11.1 | 20 | 55.0 | 40.0 | 5.0 |
| pressure | 8 | 25.0 | 50.0 | 25.0 | 23 | 69.6 | 21.7 | 8.7 |
| ramp | 14 | 21.4 | 71.4 | 7.1 | 22 | 40.9 | 50.0 | 9.1 |
| records | 0 | - | - | - | 0 | - | - | - |
| regalloc-lab | 8 | 25.0 | 75.0 | 0.0 | 19 | 63.2 | 36.8 | 0.0 |
| regex-nfa | 252 | 6.3 | 90.5 | 3.2 | 423 | 23.9 | 74.0 | 2.1 |
| sha-chacha | 206 | 40.3 | 21.4 | 38.3 | 1222 | 87.0 | 6.2 | 6.8 |
| sort | 13 | 7.7 | 92.3 | 0.0 | 15 | 13.3 | 86.7 | 0.0 |
| start-here | 17 | 23.5 | 76.5 | 0.0 | 24 | 50.0 | 50.0 | 0.0 |
| strength | 14 | 28.6 | 64.3 | 7.1 | 28 | 57.1 | 39.3 | 3.6 |
| strings | 24 | 8.3 | 91.7 | 0.0 | 26 | 15.4 | 84.6 | 0.0 |
| ui-gallery | 11 | 54.5 | 36.4 | 9.1 | 22 | 81.8 | 13.6 | 4.5 |
| value-numbering | 5 | 20.0 | 80.0 | 0.0 | 22 | 9.1 | 90.9 | 0.0 |
| wrong-shift | 11 | 9.1 | 90.9 | 0.0 | 14 | 14.3 | 85.7 | 0.0 |

Local share by edits across the 47 projects with edits: minimum 0.0 %, median 25.0 %, maximum 100.0 %; projects with a local share of at least half: 13.

### speed

| project | edits | local % | structural % | other % | instructions | local % | structural % | other % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| across-calls | 69 | 4.3 | 91.3 | 4.3 | 79 | 27.8 | 63.3 | 8.9 |
| algebra | 11 | 72.7 | 0.0 | 27.3 | 18 | 83.3 | 0.0 | 16.7 |
| blend | 12 | 25.0 | 66.7 | 8.3 | 25 | 44.0 | 52.0 | 4.0 |
| bounds-lab | 58 | 12.1 | 82.8 | 5.2 | 102 | 29.4 | 67.6 | 2.9 |
| bounds-offset | 10 | 10.0 | 90.0 | 0.0 | 21 | 9.5 | 90.5 | 0.0 |
| bounds-param | 6 | 16.7 | 83.3 | 0.0 | 9 | 22.2 | 77.8 | 0.0 |
| bounds-two | 18 | 11.1 | 83.3 | 5.6 | 30 | 26.7 | 70.0 | 3.3 |
| branches | 12 | 8.3 | 83.3 | 8.3 | 12 | 33.3 | 58.3 | 8.3 |
| bytecode-vm | 205 | 1.5 | 97.6 | 1.0 | 219 | 12.8 | 86.3 | 0.9 |
| call-chain | 135 | 5.2 | 90.4 | 4.4 | 141 | 22.7 | 70.2 | 7.1 |
| calls | 96 | 10.4 | 81.3 | 8.3 | 83 | 34.9 | 54.2 | 10.8 |
| checksum | 16 | 12.5 | 81.3 | 6.3 | 30 | 33.3 | 63.3 | 3.3 |
| chess-search | 7260 | 8.6 | 86.9 | 4.5 | 10792 | 28.1 | 68.6 | 3.4 |
| collatz | 3 | 0.0 | 100.0 | 0.0 | 8 | 0.0 | 100.0 | 0.0 |
| constants | 8 | 75.0 | 0.0 | 25.0 | 33 | 93.9 | 0.0 | 6.1 |
| dead-code | 24 | 20.8 | 58.3 | 20.8 | 29 | 44.8 | 37.9 | 17.2 |
| diagnostics | 3 | 66.7 | 0.0 | 33.3 | 6 | 83.3 | 0.0 | 16.7 |
| distinct | 55 | 5.5 | 89.1 | 5.5 | 32 | 15.6 | 75.0 | 9.4 |
| div-checks | 6 | 66.7 | 0.0 | 33.3 | 12 | 83.3 | 0.0 | 16.7 |
| div-magic | 5 | 40.0 | 60.0 | 0.0 | 17 | 70.6 | 29.4 | 0.0 |
| early-exit | 17 | 17.6 | 76.5 | 5.9 | 34 | 35.3 | 61.8 | 2.9 |
| f32-dsp | 129 | 18.6 | 79.1 | 2.3 | 257 | 42.0 | 56.8 | 1.2 |
| first-steps | 51 | 23.5 | 64.7 | 11.8 | 76 | 59.2 | 30.3 | 10.5 |
| fixed-point | 55 | 27.3 | 56.4 | 16.4 | 92 | 54.3 | 31.5 | 14.1 |
| fragments | 12 | 25.0 | 66.7 | 8.3 | 25 | 44.0 | 52.0 | 4.0 |
| gcd | 4 | 25.0 | 75.0 | 0.0 | 7 | 28.6 | 71.4 | 0.0 |
| heat-lab | 19 | 5.3 | 94.7 | 0.0 | 28 | 7.1 | 92.9 | 0.0 |
| histogram | 22 | 9.1 | 86.4 | 4.5 | 52 | 38.5 | 59.6 | 1.9 |
| licm-nested | 16 | 12.5 | 87.5 | 0.0 | 23 | 17.4 | 82.6 | 0.0 |
| licm-traps | 4 | 25.0 | 75.0 | 0.0 | 7 | 28.6 | 71.4 | 0.0 |
| lz-roundtrip | 192 | 14.6 | 74.0 | 11.5 | 543 | 45.5 | 49.9 | 4.6 |
| match-enum | 6 | 0.0 | 83.3 | 16.7 | 5 | 0.0 | 80.0 | 20.0 |
| my-analysis | 16 | 12.5 | 87.5 | 0.0 | 22 | 18.2 | 81.8 | 0.0 |
| my-first-pass | 8 | 25.0 | 50.0 | 25.0 | 12 | 50.0 | 33.3 | 16.7 |
| nested-loops | 11 | 18.2 | 81.8 | 0.0 | 19 | 21.1 | 78.9 | 0.0 |
| orders | 39 | 41.0 | 48.7 | 10.3 | 90 | 72.2 | 23.3 | 4.4 |
| params-demo | 12 | 25.0 | 66.7 | 8.3 | 25 | 44.0 | 52.0 | 4.0 |
| pressure | 8 | 25.0 | 50.0 | 25.0 | 23 | 69.6 | 21.7 | 8.7 |
| ramp | 19 | 21.1 | 68.4 | 10.5 | 35 | 37.1 | 54.3 | 8.6 |
| records | 0 | - | - | - | 0 | - | - | - |
| regalloc-lab | 33 | 12.1 | 81.8 | 6.1 | 56 | 37.5 | 55.4 | 7.1 |
| regex-nfa | 288 | 6.3 | 90.3 | 3.5 | 453 | 23.2 | 74.8 | 2.0 |
| sha-chacha | 541 | 21.4 | 60.4 | 18.1 | 1771 | 68.4 | 24.8 | 6.8 |
| sort | 19 | 5.3 | 94.7 | 0.0 | 28 | 7.1 | 92.9 | 0.0 |
| start-here | 89 | 18.0 | 73.0 | 9.0 | 130 | 40.0 | 52.3 | 7.7 |
| strength | 19 | 26.3 | 63.2 | 10.5 | 45 | 53.3 | 42.2 | 4.4 |
| strings | 34 | 11.8 | 82.4 | 5.9 | 56 | 28.6 | 67.9 | 3.6 |
| ui-gallery | 37 | 29.7 | 64.9 | 5.4 | 63 | 54.0 | 42.9 | 3.2 |
| value-numbering | 8 | 12.5 | 87.5 | 0.0 | 27 | 7.4 | 92.6 | 0.0 |
| wrong-shift | 16 | 12.5 | 81.3 | 6.3 | 33 | 36.4 | 60.6 | 3.0 |

Local share by edits across the 49 projects with edits: minimum 0.0 %, median 16.7 %, maximum 75.0 %; projects with a local share of at least half: 4.

## 5. Verified-rule coverage of the local rewrites

| pipeline | local | re-derived by a verified table | % | of them made by that table's pass | by another pass | instructions of local | re-derived % |
|---|---:|---:|---:|---:|---:|---:|---:|
| O2 | 395 | 183 | 46.3 | 183 | 0 | 2692 | 27.7 |
| speed | 997 | 362 | 36.3 | 360 | 2 | 5398 | 28.7 |

### O2: evidence and rules of the re-derived edits

| weakest evidence of the edit | edits | % of re-derived |
|---|---:|---:|
| proof | 71 | 38.8 |
| reduced-width+argument | 69 | 37.7 |
| by-construction | 43 | 23.5 |

Firings: not-lt 62, mul-pow2 47, pow2-mul 19, fold-shl 19, fold-sub 13, fold-mul 9, add-zero 4, not-gt 3, mul-one 2, mul-zero 2, fold-eqz 2, not-le 2, sub-zero 1, sub-self 1, not-ge 1, fold-add 1, fold-gt 1, not-ne 1.

### O2: the local rewrites no table re-derives, by shape

| shape | edits | instructions | passes | coverage of local if covered, cumulative % |
|---|---:|---:|---:|---:|
| `get -> constant by definition` | 141 | 1272 | constprop | 82.0 |
| `get -> get by definition` | 29 | 322 | subst | 89.4 |
| `get -> tree by definition` | 22 | 228 | subst | 94.9 |
| `rem(get,#) -> and(get,#) by fact:ranges` | 8 | 44 | strength | 97.0 |
| `div(get,#) -> shr(get,#) by fact:ranges` | 7 | 30 | strength | 98.7 |
| `div(get,#) -> shr(get,#); rem(get,#) -> and(get,#) by fact:ranges` | 3 | 35 | strength | 99.5 |
| `rem(_,#) -> and(_,#) by fact:ranges` | 2 | 16 | strength | 100.0 |

### speed: evidence and rules of the re-derived edits

| weakest evidence of the edit | edits | % of re-derived |
|---|---:|---:|
| proof | 176 | 48.6 |
| by-construction | 102 | 28.2 |
| reduced-width+argument | 83 | 22.9 |
| exhaustive | 1 | 0.3 |

Firings: mul-pow2 143, not-lt 72, fold-shl 54, fold-sub 33, pow2-mul 28, fold-mul 13, fold-add 9, zero-add 9, add-zero 6, not-gt 5, not-le 4, mul-one 2, mul-zero 2, fold-eqz 2, zero-mul 2, sub-zero 1, sub-self 1, not-ge 1, div-one 1, fold-gt 1, not-ne 1.

### speed: the local rewrites no table re-derives, by shape

| shape | edits | instructions | passes | coverage of local if covered, cumulative % |
|---|---:|---:|---:|---:|
| `get -> constant by definition` | 264 | 1820 | constprop subst | 62.8 |
| `get -> get by definition` | 207 | 1083 | subst | 83.6 |
| `get -> tree by definition` | 118 | 712 | subst | 95.4 |
| `div(get,#) -> shr(get,#) by fact:ranges` | 19 | 80 | strength | 97.3 |
| `rem(get,#) -> and(get,#) by fact:ranges` | 14 | 68 | strength | 98.7 |
| `rem(_,#) -> and(_,#) by fact:ranges` | 12 | 76 | strength | 99.9 |
| `div(get,#) -> shr(get,#); rem(get,#) -> and(get,#) by fact:ranges` | 1 | 9 | strength | 100.0 |

## 6. Checks on the attribution

| pipeline | changed applications | changed values and statements | claimed by no edit | instructions affected | instructions in the images before and after, summed over applications | % | edits with no instruction |
|---|---:|---:|---:|---:|---:|---:|---:|
| O2 | 199 | 3628 | 0 | 4517 | 135629 | 3.3 | 651 |
| speed | 294 | 19086 | 0 | 15735 | 300304 | 5.2 | 5739 |

O2: unresolved, unknown or note edits: 0.
speed: unresolved, unknown or note edits: 0.
