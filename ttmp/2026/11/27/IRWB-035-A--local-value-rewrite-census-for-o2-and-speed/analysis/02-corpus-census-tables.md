---
Title: Corpus census tables
Ticket: IRWB-035-A
Status: active
Topics:
    - compiler
    - verification
    - research
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/scripts/01-census.mjs
      Note: Generates these tables from checked pipeline revisions
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:58:47.166791047-05:00
WhatFor: ""
WhenToUse: ""
---
# Corpus census tables

Each cell is a count and its share of the row total for that unit. A dash indicates a zero denominator.

## Per pipeline

| Pipeline | Local edits | Structural edits | Other edits | Local statements | Structural statements | Other statements |
| --- | --- | --- | --- | --- | --- | --- |
| O2 | 203 (10.0%) | 1413 (69.9%) | 405 (20.0%) | 203 (11.3%) | 1194 (66.7%) | 392 (21.9%) |
| speed | 408 (4.2%) | 8128 (83.5%) | 1200 (12.3%) | 408 (4.6%) | 7356 (82.2%) | 1182 (13.2%) |

## Per pass

| Pipeline | Pass | Applications | Changed | Rejected | Local edits | Structural edits | Other edits | Local statements | Structural statements | Other statements |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O2 | cfg | 150 | 47 | 0 | 0 (0.0%) | 1058 (100.0%) | 0 (0.0%) | 0 (0.0%) | 958 (100.0%) | 0 (0.0%) |
| O2 | fold | 100 | 18 | 0 | 43 (100.0%) | 0 (0.0%) | 0 (0.0%) | 43 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| O2 | simplify | 100 | 40 | 0 | 140 (100.0%) | 0 (0.0%) | 0 (0.0%) | 140 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| O2 | constprop | 50 | 16 | 0 | 0 (0.0%) | 0 (0.0%) | 141 (100.0%) | 0 (0.0%) | 0 (0.0%) | 141 (100.0%) |
| O2 | dce | 100 | 18 | 0 | 0 (0.0%) | 0 (0.0%) | 118 (100.0%) | 0 (0.0%) | 0 (0.0%) | 118 (100.0%) |
| O2 | licm | 50 | 13 | 0 | 0 (0.0%) | 329 (100.0%) | 0 (0.0%) | 0 (0.0%) | 197 (100.0%) | 0 (0.0%) |
| O2 | lvn | 50 | 8 | 0 | 0 (0.0%) | 0 (0.0%) | 44 (100.0%) | 0 (0.0%) | 0 (0.0%) | 31 (100.0%) |
| O2 | strength | 50 | 3 | 0 | 20 (100.0%) | 0 (0.0%) | 0 (0.0%) | 20 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| O2 | bce | 50 | 10 | 0 | 0 (0.0%) | 26 (100.0%) | 0 (0.0%) | 0 (0.0%) | 39 (100.0%) | 0 (0.0%) |
| O2 | subst | 100 | 26 | 0 | 0 (0.0%) | 0 (0.0%) | 102 (100.0%) | 0 (0.0%) | 0 (0.0%) | 102 (100.0%) |
| speed | inline | 100 | 16 | 0 | 0 (0.0%) | 3165 (100.0%) | 0 (0.0%) | 0 (0.0%) | 3864 (100.0%) | 0 (0.0%) |
| speed | cfg | 200 | 54 | 0 | 0 (0.0%) | 4234 (100.0%) | 0 (0.0%) | 0 (0.0%) | 2730 (100.0%) | 0 (0.0%) |
| speed | fold | 100 | 19 | 0 | 104 (100.0%) | 0 (0.0%) | 0 (0.0%) | 104 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| speed | simplify | 100 | 41 | 0 | 258 (100.0%) | 0 (0.0%) | 0 (0.0%) | 258 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| speed | constprop | 50 | 18 | 0 | 0 (0.0%) | 0 (0.0%) | 258 (100.0%) | 0 (0.0%) | 0 (0.0%) | 258 (100.0%) |
| speed | dce | 100 | 20 | 0 | 0 (0.0%) | 0 (0.0%) | 216 (100.0%) | 0 (0.0%) | 0 (0.0%) | 216 (100.0%) |
| speed | licm | 50 | 13 | 0 | 0 (0.0%) | 422 (100.0%) | 0 (0.0%) | 0 (0.0%) | 250 (100.0%) | 0 (0.0%) |
| speed | lvn | 50 | 8 | 0 | 0 (0.0%) | 0 (0.0%) | 64 (100.0%) | 0 (0.0%) | 0 (0.0%) | 46 (100.0%) |
| speed | strength | 50 | 3 | 0 | 46 (100.0%) | 0 (0.0%) | 0 (0.0%) | 46 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| speed | bce | 50 | 10 | 0 | 0 (0.0%) | 26 (100.0%) | 0 (0.0%) | 0 (0.0%) | 39 (100.0%) | 0 (0.0%) |
| speed | subst | 150 | 59 | 0 | 0 (0.0%) | 0 (0.0%) | 662 (100.0%) | 0 (0.0%) | 0 (0.0%) | 662 (100.0%) |
| speed | rotate | 50 | 33 | 0 | 0 (0.0%) | 281 (100.0%) | 0 (0.0%) | 0 (0.0%) | 473 (100.0%) | 0 (0.0%) |

## Per project and pipeline

| Project | Pipeline | Local edits | Structural edits | Other edits | Local statements | Structural statements | Other statements |
| --- | --- | --- | --- | --- | --- | --- | --- |
| across-calls | O2 | 0 (0.0%) | 0 (0.0%) | 4 (100.0%) | 0 (0.0%) | 0 (0.0%) | 4 (100.0%) |
| across-calls | speed | 0 (0.0%) | 63 (91.3%) | 6 (8.7%) | 0 (0.0%) | 45 (88.2%) | 6 (11.8%) |
| algebra | O2 | 5 (45.5%) | 0 (0.0%) | 6 (54.5%) | 5 (45.5%) | 0 (0.0%) | 6 (54.5%) |
| algebra | speed | 5 (45.5%) | 0 (0.0%) | 6 (54.5%) | 5 (45.5%) | 0 (0.0%) | 6 (54.5%) |
| blend | O2 | 2 (22.2%) | 5 (55.6%) | 2 (22.2%) | 2 (25.0%) | 4 (50.0%) | 2 (25.0%) |
| blend | speed | 2 (16.7%) | 8 (66.7%) | 2 (16.7%) | 2 (15.4%) | 9 (69.2%) | 2 (15.4%) |
| bounds-lab | O2 | 4 (10.0%) | 36 (90.0%) | 0 (0.0%) | 4 (10.8%) | 33 (89.2%) | 0 (0.0%) |
| bounds-lab | speed | 4 (6.9%) | 48 (82.8%) | 6 (10.3%) | 4 (6.3%) | 53 (84.1%) | 6 (9.5%) |
| bounds-offset | O2 | 1 (14.3%) | 6 (85.7%) | 0 (0.0%) | 1 (14.3%) | 6 (85.7%) | 0 (0.0%) |
| bounds-offset | speed | 1 (10.0%) | 9 (90.0%) | 0 (0.0%) | 1 (8.3%) | 11 (91.7%) | 0 (0.0%) |
| bounds-param | O2 | 1 (33.3%) | 2 (66.7%) | 0 (0.0%) | 1 (33.3%) | 2 (66.7%) | 0 (0.0%) |
| bounds-param | speed | 1 (16.7%) | 5 (83.3%) | 0 (0.0%) | 1 (12.5%) | 7 (87.5%) | 0 (0.0%) |
| bounds-two | O2 | 1 (7.7%) | 12 (92.3%) | 0 (0.0%) | 1 (8.3%) | 11 (91.7%) | 0 (0.0%) |
| bounds-two | speed | 1 (5.6%) | 15 (83.3%) | 2 (11.1%) | 1 (5.3%) | 16 (84.2%) | 2 (10.5%) |
| branches | O2 | 1 (8.3%) | 10 (83.3%) | 1 (8.3%) | 1 (9.1%) | 9 (81.8%) | 1 (9.1%) |
| branches | speed | 1 (8.3%) | 10 (83.3%) | 1 (8.3%) | 1 (9.1%) | 9 (81.8%) | 1 (9.1%) |
| bytecode-vm | O2 | 1 (0.5%) | 200 (97.6%) | 4 (2.0%) | 1 (0.7%) | 137 (96.5%) | 4 (2.8%) |
| bytecode-vm | speed | 1 (0.5%) | 200 (97.6%) | 4 (2.0%) | 1 (0.7%) | 137 (96.5%) | 4 (2.8%) |
| call-chain | O2 | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| call-chain | speed | 1 (0.7%) | 122 (90.4%) | 12 (8.9%) | 1 (1.1%) | 82 (86.3%) | 12 (12.6%) |
| calls | O2 | 0 (0.0%) | 0 (0.0%) | 2 (100.0%) | 0 (0.0%) | 0 (0.0%) | 2 (100.0%) |
| calls | speed | 0 (0.0%) | 78 (81.3%) | 18 (18.8%) | 0 (0.0%) | 60 (76.9%) | 18 (23.1%) |
| checksum | O2 | 1 (9.1%) | 10 (90.9%) | 0 (0.0%) | 1 (10.0%) | 9 (90.0%) | 0 (0.0%) |
| checksum | speed | 1 (6.3%) | 13 (81.3%) | 2 (12.5%) | 1 (5.9%) | 14 (82.4%) | 2 (11.8%) |
| chess-search | O2 | 88 (11.5%) | 585 (76.6%) | 91 (11.9%) | 88 (12.3%) | 539 (75.4%) | 88 (12.3%) |
| chess-search | speed | 267 (3.7%) | 6276 (86.4%) | 717 (9.9%) | 267 (4.0%) | 5710 (85.4%) | 709 (10.6%) |
| collatz | O2 | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) |
| collatz | speed | 0 (0.0%) | 3 (100.0%) | 0 (0.0%) | 0 (0.0%) | 5 (100.0%) | 0 (0.0%) |
| constants | O2 | 3 (37.5%) | 0 (0.0%) | 5 (62.5%) | 3 (37.5%) | 0 (0.0%) | 5 (62.5%) |
| constants | speed | 3 (37.5%) | 0 (0.0%) | 5 (62.5%) | 3 (37.5%) | 0 (0.0%) | 5 (62.5%) |
| dead-code | O2 | 3 (12.5%) | 15 (62.5%) | 6 (25.0%) | 3 (15.8%) | 10 (52.6%) | 6 (31.6%) |
| dead-code | speed | 3 (12.5%) | 15 (62.5%) | 6 (25.0%) | 3 (15.8%) | 10 (52.6%) | 6 (31.6%) |
| diagnostics | O2 | 1 (33.3%) | 0 (0.0%) | 2 (66.7%) | 1 (33.3%) | 0 (0.0%) | 2 (66.7%) |
| diagnostics | speed | 1 (33.3%) | 0 (0.0%) | 2 (66.7%) | 1 (33.3%) | 0 (0.0%) | 2 (66.7%) |
| distinct | O2 | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) |
| distinct | speed | 0 (0.0%) | 49 (89.1%) | 6 (10.9%) | 0 (0.0%) | 33 (84.6%) | 6 (15.4%) |
| div-checks | O2 | 0 (0.0%) | 0 (0.0%) | 6 (100.0%) | 0 (0.0%) | 0 (0.0%) | 6 (100.0%) |
| div-checks | speed | 0 (0.0%) | 0 (0.0%) | 6 (100.0%) | 0 (0.0%) | 0 (0.0%) | 6 (100.0%) |
| div-magic | O2 | 2 (100.0%) | 0 (0.0%) | 0 (0.0%) | 2 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| div-magic | speed | 2 (40.0%) | 3 (60.0%) | 0 (0.0%) | 2 (28.6%) | 5 (71.4%) | 0 (0.0%) |
| early-exit | O2 | 2 (16.7%) | 10 (83.3%) | 0 (0.0%) | 2 (18.2%) | 9 (81.8%) | 0 (0.0%) |
| early-exit | speed | 2 (11.8%) | 13 (76.5%) | 2 (11.8%) | 2 (11.1%) | 14 (77.8%) | 2 (11.1%) |
| f32-dsp | O2 | 21 (25.6%) | 55 (67.1%) | 6 (7.3%) | 21 (26.3%) | 54 (67.5%) | 5 (6.3%) |
| f32-dsp | speed | 21 (16.3%) | 98 (76.0%) | 10 (7.8%) | 21 (15.1%) | 109 (78.4%) | 9 (6.5%) |
| first-steps | O2 | 2 (50.0%) | 0 (0.0%) | 2 (50.0%) | 2 (50.0%) | 0 (0.0%) | 2 (50.0%) |
| first-steps | speed | 6 (11.8%) | 33 (64.7%) | 12 (23.5%) | 6 (14.6%) | 23 (56.1%) | 12 (29.3%) |
| fixed-point | O2 | 1 (11.1%) | 0 (0.0%) | 8 (88.9%) | 1 (11.1%) | 0 (0.0%) | 8 (88.9%) |
| fixed-point | speed | 2 (3.6%) | 31 (56.4%) | 22 (40.0%) | 2 (3.7%) | 30 (55.6%) | 22 (40.7%) |
| fragments | O2 | 2 (22.2%) | 5 (55.6%) | 2 (22.2%) | 2 (25.0%) | 4 (50.0%) | 2 (25.0%) |
| fragments | speed | 2 (16.7%) | 8 (66.7%) | 2 (16.7%) | 2 (15.4%) | 9 (69.2%) | 2 (15.4%) |
| gcd | O2 | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| gcd | speed | 1 (25.0%) | 3 (75.0%) | 0 (0.0%) | 1 (16.7%) | 5 (83.3%) | 0 (0.0%) |
| heat-lab | O2 | 1 (7.7%) | 12 (92.3%) | 0 (0.0%) | 1 (7.7%) | 12 (92.3%) | 0 (0.0%) |
| heat-lab | speed | 1 (5.3%) | 18 (94.7%) | 0 (0.0%) | 1 (4.3%) | 22 (95.7%) | 0 (0.0%) |
| histogram | O2 | 1 (5.9%) | 16 (94.1%) | 0 (0.0%) | 1 (6.3%) | 15 (93.8%) | 0 (0.0%) |
| histogram | speed | 1 (4.5%) | 19 (86.4%) | 2 (9.1%) | 1 (4.3%) | 20 (87.0%) | 2 (8.7%) |
| licm-nested | O2 | 2 (20.0%) | 8 (80.0%) | 0 (0.0%) | 2 (33.3%) | 4 (66.7%) | 0 (0.0%) |
| licm-nested | speed | 2 (12.5%) | 14 (87.5%) | 0 (0.0%) | 2 (12.5%) | 14 (87.5%) | 0 (0.0%) |
| licm-traps | O2 | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) | 1 (100.0%) | 0 (0.0%) | 0 (0.0%) |
| licm-traps | speed | 1 (25.0%) | 3 (75.0%) | 0 (0.0%) | 1 (16.7%) | 5 (83.3%) | 0 (0.0%) |
| lz-roundtrip | O2 | 4 (5.1%) | 45 (57.0%) | 30 (38.0%) | 4 (5.7%) | 36 (51.4%) | 30 (42.9%) |
| lz-roundtrip | speed | 6 (3.1%) | 142 (74.0%) | 44 (22.9%) | 6 (3.1%) | 144 (74.2%) | 44 (22.7%) |
| match-enum | O2 | 0 (0.0%) | 5 (83.3%) | 1 (16.7%) | 0 (0.0%) | 4 (80.0%) | 1 (20.0%) |
| match-enum | speed | 0 (0.0%) | 5 (83.3%) | 1 (16.7%) | 0 (0.0%) | 4 (80.0%) | 1 (20.0%) |
| my-analysis | O2 | 2 (16.7%) | 10 (83.3%) | 0 (0.0%) | 2 (18.2%) | 9 (81.8%) | 0 (0.0%) |
| my-analysis | speed | 2 (12.5%) | 14 (87.5%) | 0 (0.0%) | 2 (11.1%) | 16 (88.9%) | 0 (0.0%) |
| my-first-pass | O2 | 0 (0.0%) | 0 (0.0%) | 8 (100.0%) | 0 (0.0%) | 0 (0.0%) | 6 (100.0%) |
| my-first-pass | speed | 0 (0.0%) | 0 (0.0%) | 8 (100.0%) | 0 (0.0%) | 0 (0.0%) | 6 (100.0%) |
| nested-loops | O2 | 2 (40.0%) | 3 (60.0%) | 0 (0.0%) | 2 (50.0%) | 2 (50.0%) | 0 (0.0%) |
| nested-loops | speed | 2 (18.2%) | 9 (81.8%) | 0 (0.0%) | 2 (14.3%) | 12 (85.7%) | 0 (0.0%) |
| orders | O2 | 9 (25.0%) | 8 (22.2%) | 19 (52.8%) | 9 (28.1%) | 6 (18.8%) | 17 (53.1%) |
| orders | speed | 9 (23.1%) | 11 (28.2%) | 19 (48.7%) | 9 (24.3%) | 11 (29.7%) | 17 (45.9%) |
| params-demo | O2 | 2 (22.2%) | 5 (55.6%) | 2 (22.2%) | 2 (25.0%) | 4 (50.0%) | 2 (25.0%) |
| params-demo | speed | 2 (16.7%) | 8 (66.7%) | 2 (16.7%) | 2 (15.4%) | 9 (69.2%) | 2 (15.4%) |
| pressure | O2 | 0 (0.0%) | 0 (0.0%) | 8 (100.0%) | 0 (0.0%) | 0 (0.0%) | 7 (100.0%) |
| pressure | speed | 0 (0.0%) | 0 (0.0%) | 8 (100.0%) | 0 (0.0%) | 0 (0.0%) | 7 (100.0%) |
| ramp | O2 | 1 (7.1%) | 10 (71.4%) | 3 (21.4%) | 1 (7.7%) | 9 (69.2%) | 3 (23.1%) |
| ramp | speed | 1 (5.3%) | 13 (68.4%) | 5 (26.3%) | 1 (5.0%) | 14 (70.0%) | 5 (25.0%) |
| records | O2 | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) |
| records | speed | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) | 0 (—) |
| regalloc-lab | O2 | 2 (25.0%) | 2 (25.0%) | 4 (50.0%) | 2 (28.6%) | 2 (28.6%) | 3 (42.9%) |
| regalloc-lab | speed | 2 (6.1%) | 23 (69.7%) | 8 (24.2%) | 2 (5.9%) | 25 (73.5%) | 7 (20.6%) |
| regex-nfa | O2 | 6 (2.4%) | 228 (90.5%) | 18 (7.1%) | 6 (3.1%) | 167 (87.4%) | 18 (9.4%) |
| regex-nfa | speed | 6 (2.1%) | 260 (90.3%) | 22 (7.6%) | 6 (2.6%) | 205 (88.0%) | 22 (9.4%) |
| sha-chacha | O2 | 11 (5.3%) | 40 (19.4%) | 155 (75.2%) | 11 (5.6%) | 32 (16.2%) | 154 (78.2%) |
| sha-chacha | speed | 25 (4.6%) | 323 (59.7%) | 193 (35.7%) | 25 (5.0%) | 283 (56.6%) | 192 (38.4%) |
| sort | O2 | 1 (7.7%) | 12 (92.3%) | 0 (0.0%) | 1 (7.7%) | 12 (92.3%) | 0 (0.0%) |
| sort | speed | 1 (5.3%) | 18 (94.7%) | 0 (0.0%) | 1 (4.3%) | 22 (95.7%) | 0 (0.0%) |
| start-here | O2 | 4 (23.5%) | 13 (76.5%) | 0 (0.0%) | 4 (25.0%) | 12 (75.0%) | 0 (0.0%) |
| start-here | speed | 6 (6.7%) | 65 (73.0%) | 18 (20.2%) | 6 (6.7%) | 65 (73.0%) | 18 (20.2%) |
| strength | O2 | 2 (14.3%) | 9 (64.3%) | 3 (21.4%) | 2 (15.4%) | 8 (61.5%) | 3 (23.1%) |
| strength | speed | 2 (10.5%) | 12 (63.2%) | 5 (26.3%) | 2 (10.0%) | 13 (65.0%) | 5 (25.0%) |
| strings | O2 | 2 (8.3%) | 22 (91.7%) | 0 (0.0%) | 2 (9.1%) | 20 (90.9%) | 0 (0.0%) |
| strings | speed | 2 (5.9%) | 28 (82.4%) | 4 (11.8%) | 2 (5.6%) | 30 (83.3%) | 4 (11.1%) |
| ui-gallery | O2 | 4 (36.4%) | 4 (36.4%) | 3 (27.3%) | 4 (36.4%) | 4 (36.4%) | 3 (27.3%) |
| ui-gallery | speed | 7 (18.9%) | 24 (64.9%) | 6 (16.2%) | 7 (17.5%) | 27 (67.5%) | 6 (15.0%) |
| value-numbering | O2 | 1 (20.0%) | 0 (0.0%) | 4 (80.0%) | 1 (33.3%) | 0 (0.0%) | 2 (66.7%) |
| value-numbering | speed | 1 (12.5%) | 3 (37.5%) | 4 (50.0%) | 1 (12.5%) | 5 (62.5%) | 2 (25.0%) |
| wrong-shift | O2 | 1 (9.1%) | 10 (90.9%) | 0 (0.0%) | 1 (10.0%) | 9 (90.0%) | 0 (0.0%) |
| wrong-shift | speed | 1 (6.3%) | 13 (81.3%) | 2 (12.5%) | 1 (5.9%) | 14 (82.4%) | 2 (11.8%) |

## Coverage and classification audit

### O2

- Local among statement-field value replacements: 203/505 (40.2%).

- Local edits with a verified citation for every firing: 0/203 (0.0%).

- Local edits entirely re-derived from verified rules: 183/203 (90.1%).

- Matched rule evidence by weakest strength in the edit: proof 71, reduced-width+argument 69, by-construction 43.

- Local edits with any verified citation: 0.

- With contextual replacements included, local edits are 417 (20.6%), local statements are 423 (23.5%), and local value replacements are 417 (82.6%). Full counts in local/structural/other order are 417/1413/191 edits and 423/1194/180 statements.

- Statement class incidences beyond one class: 0 primary, 8 contextual.

- Records without a statement endpoint: 102 (local 100, remove 1, retarget 1).

- Changed or moved statement IDs absent from the footprint: 0.

- Unmatched value replacements: 0.

- Rejected applications: 0.

| Unverified local rule shape | Containing edits |
| --- | --- |
| rem(x, 2^k) → and(x, 2^k − 1) if x ≥ 0 | 13 |
| div(x, 2^k) → shr(x, k) if x ≥ 0 | 10 |

| Contextual rule shape | Containing edits |
| --- | --- |
| read → constant with unanimous reaching definitions | 141 |
| read → pure RHS with a stable reaching assignment | 51 |
| repeated pure expression → read of a shared temporary | 22 |

| Matched existing rule | Containing edits |
| --- | --- |
| not-lt | 62 |
| mul-pow2 | 46 |
| fold-shl | 19 |
| pow2-mul | 19 |
| fold-sub | 13 |
| fold-mul | 9 |
| add-zero | 4 |
| not-gt | 3 |
| fold-eqz | 2 |
| mul-one | 2 |
| mul-zero | 2 |
| not-le | 2 |
| fold-add | 1 |
| fold-gt | 1 |
| not-ge | 1 |
| not-ne | 1 |
| sub-self | 1 |
| sub-zero | 1 |

### speed

- Local among statement-field value replacements: 408/1138 (35.9%).

- Local edits with a verified citation for every firing: 0/408 (0.0%).

- Local edits entirely re-derived from verified rules: 362/408 (88.7%).

- Matched rule evidence by weakest strength in the edit: proof 174, by-construction 104, reduced-width+argument 83, exhaustive 1.

- Local edits with any verified citation: 0.

- With contextual replacements included, local edits are 1029 (10.6%), local statements are 1040 (11.6%), and local value replacements are 1029 (90.4%). Full counts in local/structural/other order are 1029/8128/579 edits and 1040/7356/563 statements.

- Statement class incidences beyond one class: 0 primary, 13 contextual.

- Records without a statement endpoint: 1164 (local 1162, remove 1, retarget 1).

- Changed or moved statement IDs absent from the footprint: 0.

- Unmatched value replacements: 0.

- Rejected applications: 0.

| Unverified local rule shape | Containing edits |
| --- | --- |
| rem(x, 2^k) → and(x, 2^k − 1) if x ≥ 0 | 27 |
| div(x, 2^k) → shr(x, k) if x ≥ 0 | 22 |

| Contextual rule shape | Containing edits |
| --- | --- |
| read → pure RHS with a stable reaching assignment | 331 |
| read → constant with unanimous reaching definitions | 258 |
| repeated pure expression → read of a shared temporary | 32 |

| Matched existing rule | Containing edits |
| --- | --- |
| mul-pow2 | 131 |
| not-lt | 72 |
| fold-shl | 54 |
| fold-sub | 33 |
| pow2-mul | 28 |
| fold-mul | 15 |
| fold-add | 11 |
| zero-add | 9 |
| not-gt | 5 |
| add-zero | 4 |
| not-le | 4 |
| fold-eqz | 2 |
| mul-one | 2 |
| mul-zero | 2 |
| div-one | 1 |
| fold-gt | 1 |
| not-ge | 1 |
| not-ne | 1 |
| sub-self | 1 |
| sub-zero | 1 |
