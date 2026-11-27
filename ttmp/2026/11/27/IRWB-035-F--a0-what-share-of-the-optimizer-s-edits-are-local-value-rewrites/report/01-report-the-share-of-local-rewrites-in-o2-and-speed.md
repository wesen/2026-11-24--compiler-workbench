---
Title: 'Report: the share of local rewrites in O2 and speed'
Ticket: IRWB-035-F
Status: active
Topics:
    - compiler
    - rewrite-rules
DocType: report
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/edit-classes.ts
      Note: the classifier and weights
    - Path: repo://tests/typed/edit-classes.test.mjs
      Note: classifier test
    - Path: repo://tools/edit-classes.mjs
      Note: corpus census and tables
    - Path: repo://ttmp/2026/11/27/IRWB-035-F--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/scripts/05-units-and-applications.mjs
      Note: unit sensitivity and applications
    - Path: repo://ttmp/2026/11/27/IRWB-035-F--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/various/03-edit-classes-corpus.txt
      Note: the tables
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:20:59.8166263-05:00
WhatFor: ""
WhenToUse: ""
---

## Summary

Every edit record that O2 and `speed` publish on the 50 corpus projects (gated by the meaning check as `Program.pipeline` runs them; no step was rejected) was classified by `src/typed/edit-classes.ts`. Counting records, **local rewrites are 17.0 % of O2's edits and 6.8 % of speed's**. Structural edits are 69.9 % and 83.5 %, and other edits are 13.1 % and 9.7 %. Weighted by the instructions they touch, local rewrites are 37.9 % (static) and 24.9 % (executed) of O2's weight, and 16.0 % (static) and 14.6 % (executed) of speed's. A record-count share depends on how finely a pass writes records: a block merge writes one record per moved statement. Counting each structural change once per application, function and sub-class, the local share is 40.6 % of O2's changes and 30.4 % of speed's.

**Of the local rewrites, 53.2 % (O2) and 54.4 % (speed) are matched exactly by a verified rule** (simplify or fold, re-derived with the passes' own matcher). **None cites a rule in its edit record**, because the framework records no citations. Weighted by executed instructions, the matched share is 78.0 % (O2) and 64.8 % (speed). Most of the rest is one shape, constprop's `get(l) → const c` guarded by reaching definitions: 141 of O2's 161 unmatched local rewrites. The other 20 are strength's `x / 2^k` and `x % 2^k` under a range fact. Speed splits 258 to 46. A verified `const-read` rule with a reaching-definitions certificate would raise the coverage of local rewrites to 94.2 % (O2) and 93.1 % (speed). With the two range-guarded strength rules added, coverage would reach 100 %.

For programme A, this means that rules can replace the sampled check for whole pass applications, but not yet for whole functions. In O2, 58 of 199 published applications (29 %) consist only of verified local rewrites, and 77 (39 %) consist only of local rewrites. Only 13 of the 102 functions that O2 changes receive nothing but local edits. Most of the others are held back by control-flow edits (71 of the 102 functions contain one), then by `dce`'s removals (41) and by `subst` and `lvn`'s coupled replacements (29).

## 1. Method and definitions

The full definitions are in the design (`design-doc/01-…`, sections 3 and 4). In brief:

- **Unit:** one edit record of a published revision (`RevisionReport.edits`, one per `Tx` operation). The pipelines run through `Program.pipeline`, gated against r0 (40 cases, seed 7), on every corpus project. All 50 projects ingest, and no step was rejected.
- **Classes**, decided by the first rule that applies:
  - **D1:** every record of `inline`, `rotate` or `licm` is structural.
  - **D2:** `retarget`, `block`, `unreachable`, `merge`, `move`, and a `replaceStmt`, `remove` or `insert` of a terminator are structural/control-flow.
  - **D3:** each `replace` of a statement field is compared as a pair of trees, `T` in the input revision and `T'` in the output. It is
    - **(a)** other/coupled if `T'` reads a local the input lacks, cites a statement the same application removes or inserts, or involves a value another record of the application made or replaced again;
    - **(b)** local/verified if a verified rule table re-derives `T'` from `T` exactly;
    - **(c)** local/fact-guarded if every differing window is a shape of the catalog (`const-read`, `div-pow2`, `rem-pow2`, nestable) and its fact is cited;
    - **(d)** otherwise other/unmatched-value.
  - **D4:** any other `remove` is other.
  - **D5:** every remaining record is other.
- **Verified** means that every rule that fired has a `sound` record of the same version in `RULE_EVIDENCE`. The row keeps the weakest strength among them.
- **Weights:** an edit's sites are the input statements it changes or removes. When it has none, they are the output statements it adds. Statements that inline copies without naming them are counted on its `inline` record. *Static* weight is the number of image instructions whose `covers` include a site. *Executed* weight is their executions over `typed.metrics`'s seeded cases: 10 per function, seed 7, step limit 2·10^5, default backend options. Prologue and epilogue instructions weigh nothing.

Two amendments to the design came from the implementation:

- D3a also covers a record whose trees cannot be read as one pair, because another record of the same application made or replaced the value.
- The catalog's shapes nest, because strength rewrites `(x / 2^j) % 2^k` in one tree.

Checks run with every census:

- All fold and simplify `replace` edits are local/verified (545 of 545). This re-measures IRWB-008's 394 of 394, on O2 and speed.
- No new statement is left without an edit to weigh it. The unattributed weight is 0 for every pass.

## 2. Tables

From `various/03-edit-classes-corpus.txt`. In the share tables, each row gives the share of each class, first by edits, then by static instructions, then by executed instructions (each group sums to 100).

### 2.1 Per pipeline

```
== per pipeline
key            edits  local% str% oth%  (edits | static | executed)
O2              2021  17.0 69.9 13.1 | 37.9 44.8 17.4 | 24.9 60.3 14.9
speed           9736   6.8 83.5  9.7 | 16.0 72.7 11.3 | 14.6 77.1  8.3
```

### 2.2 Sub-classes (edits, static instructions, executed instructions)

```
== O2: sub-classes (edits, static, executed)
structural/control-flow     1083  53.6%   1272  31.8%    200k  40.4%
structural/licm              329  16.3%    518  12.9%     98k  19.8%
local/verified               183   9.1%    556  13.9%     96k  19.4%
other/remove                 170   8.4%    193   4.8%     11k   2.3%
local/fact-guarded           161   8.0%    959  24.0%     27k   5.5%
other/coupled                 73   3.6%    484  12.1%     60k  12.1%
other/local                   11   0.5%      0   0.0%       0   0.0%
other/insert                  11   0.5%     18   0.5%    2409   0.5%
total                       2021          4000            495k

== speed: sub-classes (edits, static, executed)
structural/control-flow     4259  43.7%   5103  32.9%    577k  39.4%
structural/inline           3165  32.5%   5327  34.3%    410k  27.9%
other/remove                 548   5.6%    631   4.1%     47k   3.2%
structural/licm              422   4.3%    605   3.9%     89k   6.1%
other/coupled                363   3.7%   1097   7.1%     73k   4.9%
local/verified               362   3.7%   1191   7.7%    139k   9.5%
local/fact-guarded           304   3.1%   1291   8.3%     76k   5.2%
structural/rotate            281   2.9%    243   1.6%     54k   3.7%
other/local                   16   0.2%      0   0.0%       0   0.0%
other/insert                  16   0.2%     29   0.2%    1818   0.1%
total                       9736           16k           1.47M
```

Record kinds inside each sub-class. A block merge writes one `merge` and one `remove`, plus one `move` per statement. Jump threading writes one `retarget` per branch, and pruning writes one `unreachable` per block:

```
== O2: record kinds per sub-class (edits)
other/coupled              replace 73
other/remove               remove 170
local/verified             replace 183
local/fact-guarded         replace 161
structural/control-flow    retarget 486, unreachable 472, move 65, merge 22, remove 21, replaceStmt 17
structural/licm            insert 105, local 89, replace 88, retarget 31, block 16
other/local                local 11
other/insert               insert 11

== speed: record kinds per sub-class (edits)
structural/inline          block 1659, local 1036, remove 235, inline 235
structural/control-flow    unreachable 1259, move 1148, retarget 800, merge 518, remove 517, replaceStmt 17
other/coupled              replace 363
other/remove               remove 548
local/verified             replace 362
local/fact-guarded         replace 304
structural/licm            insert 133, local 110, replace 109, retarget 47, block 23
structural/rotate          replaceStmt 192, unreachable 89
other/local                local 16
other/insert               insert 16
```

### 2.3 Per pass (summed over the positions a pass has in the pipeline)

```
== O2: per pass
key            edits  local% str% oth%  (edits | static | executed)
subst            102   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
simplify         140 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
constprop        141 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
dce              118   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
cfg             1058   0.0 99.9  0.1 |  0.0100.0  0.0 |  0.0100.0  0.0
fold              43 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
licm             329   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
bce               26   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
lvn               44   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
strength          20 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0

== speed: per pass
key            edits  local% str% oth%  (edits | static | executed)
inline          3165   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
cfg             4234   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
subst            662   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
simplify         258 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
constprop        258 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
dce              216   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
fold             104 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
licm             422   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
rotate           281   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
bce               26   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
lvn               64   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
strength          46 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
```

### 2.4 Per project

```
== O2: per project
key            edits  local% str% oth%  (edits | static | executed)
across-calls       4   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
algebra           11  54.5  0.0 45.5 | 72.2  0.0 27.8 | 72.2  0.0 27.8
blend              9  33.3 55.6 11.1 | 45.5 50.0  4.5 | 47.1 52.5  0.3
bounds-lab        40  10.0 90.0  0.0 | 10.6 89.4  0.0 | 12.3 87.7  0.0
bounds-offset      7  14.3 85.7  0.0 | 27.3 72.7  0.0 | 30.0 70.0  0.0
bounds-param       3  33.3 66.7  0.0 | 33.3 66.7  0.0 | 35.1 64.9  0.0
bounds-two        13   7.7 92.3  0.0 |  9.5 90.5  0.0 | 10.9 89.1  0.0
branches          12   8.3 83.3  8.3 | 27.3 63.6  9.1 | 19.0 65.1 15.9
bytecode-vm      205   0.5 97.6  2.0 |  0.8 93.5  5.7 |  1.9 86.8 11.3
call-chain         1 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
calls              2   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
checksum          11   9.1 90.9  0.0 | 10.5 89.5  0.0 | 11.8 88.2  0.0
chess-search     764  17.0 76.6  6.4 | 39.3 53.4  7.3 | 47.0 50.3  2.7
constants          8  62.5  0.0 37.5 | 76.0  0.0 24.0 | 76.0  0.0 24.0
dead-code         24  16.7 58.3 25.0 | 26.9 50.0 23.1 | 25.0 45.0 30.0
diagnostics        3  33.3  0.0 66.7 | 33.3  0.0 66.7 | 33.3  0.0 66.7
div-checks         6  66.7  0.0 33.3 | 66.7  0.0 33.3 | 54.5  0.0 45.5
div-magic          2 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
early-exit        12  16.7 83.3  0.0 | 15.0 85.0  0.0 | 12.3 87.7  0.0
f32-dsp           82  25.6 67.1  7.3 | 43.4 48.4  8.2 | 42.5 43.8 13.7
first-steps        4  75.0  0.0 25.0 | 85.7  0.0 14.3 | 85.7  0.0 14.3
fixed-point        9  55.6  0.0 44.4 | 50.0  0.0 50.0 | 40.9  0.0 59.1
fragments          9  33.3 55.6 11.1 | 45.5 50.0  4.5 | 47.1 52.6  0.3
gcd                1 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
heat-lab          13   7.7 92.3  0.0 | 13.3 86.7  0.0 |  5.9 94.1  0.0
histogram         17   5.9 94.1  0.0 |  5.4 94.6  0.0 |  6.4 93.6  0.0
licm-nested       10  20.0 80.0  0.0 | 11.1 88.9  0.0 | 10.0 90.0  0.0
licm-traps         1 100.0  0.0  0.0 |100.0  0.0  0.0 |100.0  0.0  0.0
lz-roundtrip      79   5.1 57.0 38.0 |  1.7 19.3 79.1 |  3.3 22.2 74.6
match-enum         6   0.0 83.3 16.7 |  0.0 83.3 16.7 |  0.0 68.8 31.3
my-analysis       12  16.7 83.3  0.0 | 33.3 66.7  0.0 | 92.0  8.0  0.0
my-first-pass      8   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
nested-loops       5  40.0 60.0  0.0 | 28.6 71.4  0.0 | 23.9 76.1  0.0
orders            36  38.9 22.2 38.9 | 45.9 16.4 37.7 | 53.9 29.0 17.2
params-demo        9  33.3 55.6 11.1 | 45.5 50.0  4.5 | 47.1 52.6  0.3
pressure           8   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
ramp              14  21.4 71.4  7.1 | 17.4 73.9  8.7 | 15.4 75.2  9.4
regalloc-lab       8  25.0 25.0 50.0 | 36.7  6.7 56.7 | 36.5 31.0 32.5
regex-nfa        252   4.4 90.5  5.2 |  7.2 82.9 10.0 |  8.9 89.1  2.0
sha-chacha       206  37.9 19.4 42.7 | 79.4  8.3 12.3 | 32.1 41.4 26.5
sort              13   7.7 92.3  0.0 | 13.3 86.7  0.0 |  6.8 93.2  0.0
start-here        17  23.5 76.5  0.0 | 36.0 64.0  0.0 | 39.9 60.1  0.0
strength          14  28.6 64.3  7.1 | 35.7 60.7  3.6 | 19.8 75.5  4.7
strings           24   8.3 91.7  0.0 | 11.1 88.9  0.0 | 12.2 87.8  0.0
ui-gallery        11  54.5 36.4  9.1 | 77.8 16.7  5.6 | 69.4 22.1  8.5
value-numberin     5  20.0  0.0 80.0 |  3.1  0.0 96.9 |  3.3  0.0 96.7
wrong-shift       11   9.1 90.9  0.0 |  9.5 90.5  0.0 | 10.6 89.4  0.0
```

```
== speed: per project
key            edits  local% str% oth%  (edits | static | executed)
across-calls      69   0.0 91.3  8.7 |  0.0 80.9 19.1 |  0.0 80.9 19.1
algebra           11  54.5  0.0 45.5 | 72.2  0.0 27.8 | 72.2  0.0 27.8
blend             12  25.0 66.7  8.3 | 41.7 54.2  4.2 | 42.1 57.6  0.3
bounds-lab        58   6.9 82.8 10.3 |  7.7 76.9 15.4 |  8.7 75.5 15.8
bounds-offset     10  10.0 90.0  0.0 | 20.0 80.0  0.0 | 21.6 78.4  0.0
bounds-param       6  16.7 83.3  0.0 | 20.0 80.0  0.0 | 21.4 78.6  0.0
bounds-two        18   5.6 83.3 11.1 |  7.1 78.6 14.3 |  8.1 77.3 14.7
branches          12   8.3 83.3  8.3 | 27.3 63.6  9.1 | 19.0 65.1 15.9
bytecode-vm      205   0.5 97.6  2.0 |  0.8 93.5  5.7 |  1.9 86.8 11.3
call-chain       135   0.7 90.4  8.9 |  1.3 83.1 15.6 |  1.2 84.5 14.3
calls             96   6.3 81.3 12.5 |  4.8 70.2 25.0 |  3.3 70.6 26.0
checksum          16   6.3 81.3 12.5 |  7.4 74.1 18.5 |  8.1 72.8 19.0
chess-search    7260   5.4 86.4  8.2 | 11.6 79.2  9.2 | 12.0 83.3  4.7
collatz            3   0.0100.0  0.0 |  0.0100.0  0.0 |  0.0100.0  0.0
constants          8  62.5  0.0 37.5 | 76.0  0.0 24.0 | 76.0  0.0 24.0
dead-code         24  16.7 58.3 25.0 | 26.9 50.0 23.1 | 25.0 45.0 30.0
diagnostics        3  33.3  0.0 66.7 | 33.3  0.0 66.7 | 33.3  0.0 66.7
distinct          55   0.0 89.1 10.9 |  0.0 85.3 14.7 |  0.0 85.3 14.7
div-checks         6  66.7  0.0 33.3 | 66.7  0.0 33.3 | 54.5  0.0 45.5
div-magic          5  40.0 60.0  0.0 | 84.6 15.4  0.0 | 59.6 40.4  0.0
early-exit        17  11.8 76.5 11.8 | 10.7 71.4 17.9 |  8.6 72.4 19.1
f32-dsp          129  16.3 76.0  7.8 | 26.1 62.1 11.8 | 19.6 64.2 16.2
first-steps       51  17.6 64.7 17.6 | 29.5 50.8 19.7 | 29.5 50.8 19.7
fixed-point       55  18.2 56.4 25.5 | 16.9 53.5 29.6 | 12.7 55.1 32.2
fragments         12  25.0 66.7  8.3 | 41.7 54.2  4.2 | 42.1 57.6  0.3
gcd                4  25.0 75.0  0.0 | 33.3 66.7  0.0 | 35.3 64.7  0.0
heat-lab          19   5.3 94.7  0.0 | 10.0 90.0  0.0 |  4.8 95.2  0.0
histogram         22   4.5 86.4  9.1 |  4.0 76.0 20.0 |  4.7 75.2 20.1
licm-nested       16  12.5 87.5  0.0 |  9.1 90.9  0.0 |  8.4 91.6  0.0
licm-traps         4  25.0 75.0  0.0 | 33.3 66.7  0.0 | 39.6 60.4  0.0
lz-roundtrip     192   3.1 74.0 22.9 |  1.6 62.0 36.4 |  2.6 67.1 30.3
match-enum         6   0.0 83.3 16.7 |  0.0 83.3 16.7 |  0.0 68.8 31.3
my-analysis       16  12.5 87.5  0.0 | 23.1 76.9  0.0 | 39.1 60.9  0.0
my-first-pass      8   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
nested-loops      11  18.2 81.8  0.0 | 18.2 81.8  0.0 | 16.5 83.5  0.0
orders            39  35.9 28.2 35.9 | 44.4 19.0 36.5 | 49.2 35.1 15.7
params-demo       12  25.0 66.7  8.3 | 41.7 54.2  4.2 | 42.1 57.6  0.3
pressure           8   0.0  0.0100.0 |  0.0  0.0100.0 |  0.0  0.0100.0
ramp              19  15.8 68.4 15.8 | 13.8 69.0 17.2 | 11.9 69.9 18.1
regalloc-lab      33   6.1 69.7 24.2 | 15.5 49.3 35.2 |  5.0 73.8 21.2
regex-nfa        288   3.8 90.3  5.9 |  6.9 83.0 10.1 |  8.5 89.2  2.3
sha-chacha       541  19.6 59.7 20.7 | 53.5 37.1  9.4 | 22.0 70.0  8.0
sort              19   5.3 94.7  0.0 | 10.0 90.0  0.0 |  5.4 94.6  0.0
start-here        89  13.5 73.0 13.5 | 16.8 66.4 16.8 | 14.6 68.3 17.1
strength          19  21.1 63.2 15.8 | 27.8 55.6 16.7 | 14.3 65.2 20.4
strings           34   5.9 82.4 11.8 |  8.0 76.0 16.0 |  8.6 74.8 16.6
ui-gallery        37  29.7 64.9  5.4 | 44.6 51.8  3.6 | 27.5 69.1  3.4
value-numberin     8  12.5 37.5 50.0 |  2.9  5.9 91.2 |  3.1  6.0 90.9
wrong-shift       16   6.3 81.3 12.5 |  6.7 73.3 20.0 |  7.3 72.2 20.5
```

collatz and distinct are absent from the O2 table, because O2 changes neither of them.

## 3. Verified-rule coverage of the local rewrites

```
== O2: local rewrites 344; matched by a verified rule 183 (53.2 %), static 36.7 %, executed 78.0 %; citing a rule in the record: 0
  firings: not-lt 62, mul-pow2 47, pow2-mul 19, fold-shl 19, fold-sub 13, fold-mul 9, add-zero 4, not-gt 3, mul-one 2, mul-zero 2, fold-eqz 2, not-le 2, sub-zero 1, sub-self 1, not-ge 1, fold-add 1, fold-gt 1, not-ne 1
  weakest strength per edit: proof 71, by-construction 43, reduced-width+argument 69
== speed: local rewrites 666; matched by a verified rule 362 (54.4 %), static 48.0 %, executed 64.8 %; citing a rule in the record: 0
  firings: mul-pow2 143, not-lt 72, fold-shl 54, fold-sub 33, pow2-mul 28, fold-mul 13, fold-add 9, zero-add 9, add-zero 6, not-gt 5, not-le 4, mul-one 2, mul-zero 2, fold-eqz 2, zero-mul 2, sub-zero 1, sub-self 1, not-ge 1, div-one 1, fold-gt 1, not-ne 1
  weakest strength per edit: proof 176, by-construction 102, reduced-width+argument 83, exhaustive 1
```

- **Citing:** no edit record names a rule (0 of 344 and 0 of 666). The rule-table passes compile their tables into a `Tx.rewrite` visitor that records no citation; IRWB-008 proposed `Tx.cite`, which was never built.
- **Matching:** every fold and simplify edit is re-derived exactly by its table (545 of 545), so for these passes matching is as good as a citation would be, at a re-derivation cost IRWB-008 measured at about 11 ms for the whole corpus.
- **Strength of the evidence** behind the matched edits (weakest rule per edit, O2): 71 `proof`, 43 `by-construction` (fold: the evaluator's own value), 69 `reduced-width+argument` (the comparison inversions `not-lt`, …, the most frequent rule).
- **The rest, ranked** (shapes of the local rewrites no verified rule matches, and of the other value replacements; edits and executed instructions):

```
== O2: shapes of the local rewrites no verified rule matches, and of the other value replacements (top 20 by edits)
  153     24k  local/fact-guarded constprop: const-read
   29     31k  other/coupled subst: get → get
   13    2342  local/fact-guarded strength: rem-pow2
   10    1240  local/fact-guarded strength: div-pow2
    6     13k  other/coupled subst: get → add(get, #)
    4     144  other/coupled lvn: add(get, #) → get
    4    2928  other/coupled subst: get → add(get, get)
    4    6024  other/coupled lvn: (several records on one field)
== speed: shapes of the local rewrites no verified rule matches, and of the other value replacements (top 20 by edits)
  284     69k  local/fact-guarded constprop: const-read
  207     43k  other/coupled subst: get → get
   27    3056  local/fact-guarded strength: rem-pow2
   22    3177  local/fact-guarded strength: div-pow2
   15    7955  other/coupled subst: get → add(get, #)
   12     144  other/coupled lvn: add(get, #) → get
   10     167  other/coupled subst: get → add(#, shl(get, #))
    9     663  other/coupled subst: get → add(shl(get, #), get)
```

The rules that would raise coverage most, in order:

1. **`const-read`: `get(l) → const c` when every reaching definition of `l` assigns `c`.** It covers all of constprop's edits: 141 of the 161 unmatched local rewrites in O2 and 258 of 304 in speed, so it would bring coverage to 94.2 % and 93.1 %. The shape table counts windows, not edits (153 and 284), because one edit can rewrite several reads in one tree. The rule itself is trivial; what it needs is a checkable certificate that the cited definitions are exactly the reaching ones (IRWB-002 item D4; IRWB-008's design, "rules with fact hypotheses").
2. **`div-pow2` and `rem-pow2` under a range hypothesis `x ≥ 0`.** These cover the remaining 20 (O2) and 46 (speed) edits, which have 23 and 49 windows. They can be verified once with the range guard, as IRWB-008 sketched for `strength`.
3. **Outside the local class, the largest family of value replacements is `subst` on copies, `get → get`** (29 O2 edits with 31k executed instructions; 207 speed edits, mostly argument copies left by inlining), followed by `subst` of small expressions and `lvn`'s `e → get(vn)`. Each is one rule on a single-assignment view (substituting a definition into its only use; sharing two equal pure expressions), and none is a single-tree rule on `typed.blocks`. On the SSA view of IRWB-006, these 73 (O2) and 363 (speed) coupled edits would be the next candidates to become local.

## 4. Other units: applications, functions, changes

Per-record shares depend on record granularity: a block merge writes one record per moved statement, and pruning writes one per block. Analysis 05 (`scripts/05-units-and-applications.mjs`, `various/05-units-and-applications.txt`) recounts the shares in two other units, and the tool counts a third, functions:

```
O2: units 559 (structural grouped per application, function and sub-class): local 40.6 %, structural 21.6 %, other 37.7 %
O2: published applications 199
  no local edit                   122 (61.3 %)  subst 26, dce 18, cfg 47, licm 13, bce 10, lvn 8
  all local/verified               58 (29.1 %)  simplify 40, fold 18
  all local (some fact-guarded)    19 (9.5 %)  constprop 16, strength 3
speed: units 909 (structural grouped per application, function and sub-class): local 30.4 %, structural 30.0 %, other 39.6 %
speed: published applications 294
  no local edit                   213 (72.4 %)  inline 16, cfg 54, subst 59, dce 20, licm 13, rotate 33, bce 10, lvn 8
  all local/verified               60 (20.4 %)  simplify 41, fold 19
  all local (some fact-guarded)    21 (7.1 %)  constprop 18, strength 3

== O2: changed functions by their only non-local sub-class: (two or more) 45, structural/control-flow 39, (none: all local) 13, other/remove 3, structural/licm 2
== O2: changed functions containing each non-local sub-class: structural/control-flow 71, other/remove 41, other/coupled 29, structural/licm 17, other/local 10, other/insert 10
== speed: changed functions by their only non-local sub-class: (two or more) 91, structural/control-flow 8, (none: all local) 7, structural/rotate 4, other/remove 2
== speed: changed functions containing each non-local sub-class: structural/control-flow 87, other/remove 78, other/coupled 70, structural/rotate 59, structural/inline 48, structural/licm 21, other/local 13, other/insert 13
== O2: changed functions 102; every edit local 13; every edit local/verified 13
== speed: changed functions 112; every edit local 7; every edit local/verified 7
```

## 5. What the numbers mean for programme A

**The hypothesis, as stated, does not hold for the pipelines as they are.** Most value edits are local rewrites: of O2's 417 `replace` records outside licm, 344 are local. But value edits are a minority of all edits. Counted by records, local rewrites are 17 % of O2 and 7 % of speed. Counted by changes, they are 41 % and 30 %. Weighted by executed instructions, they are 25 % and 15 %. Most of what O2 changes is control-flow cleanup, and most of what speed changes is inlining and the cleanup after it.

**Programme A can still pay at the level of pass applications.** 58 of O2's 199 published applications (29 %) and 60 of speed's 294 (20 %) contain only edits that a verified rule re-derives exactly. For those applications, re-deriving the edits could replace the sampled meaning check entirely; this is IRWB-008's "version 3" contract, which samples only the residual. With a certified `const-read` rule, another 16 (O2) and 18 (speed) constprop applications would join them.

**At the level of whole functions it does not pay yet.** Only 13 of the 102 functions O2 changes (7 of 112 under speed) have only local edits, though all of those are verified. For the rest, the blockers come in this order:

1. control-flow edits, in 71 of the 102 functions;
2. dead-statement removal, in 41;
3. coupled substitutions and value numbering, in 29;
4. licm, in 17.

For a function-level argument assembled from rules, the next rule families would therefore be:

1. **Control-flow normalization** (`cfg`): constant branches, jump threading, merging a block into its only predecessor, pruning unreachable blocks. These are semantics-preserving by simple simulation arguments that need no facts about values (except "branch on a constant", which cites the constant). Rules over the CFG rather than over value trees would cover most of the control-flow sub-class: 53.6 % of O2's records, all from `cfg` except `bce`'s 26, which need a range fact.
2. **Dead definitions** (`dce`): removing `set l = e` under liveness, with `e` pure. One rule with a liveness hypothesis covers 8.4 % of O2's records.
3. **Substitution and sharing on a single-assignment view** (`subst`, `lvn`): see section 3.

**Limits of the measurement:**

- **Unit dependence.** The record-count shares depend on how finely each pass writes records (section 4). The edit and change counts bracket the answer (17 to 41 % local in O2), and the weights give a third view.
- **Weights are attributions, not savings.** An edit's weight is the instructions of the statements it touches, not the instructions it saves. A moved statement weighs its instructions, though moving it changes none of them. Two records on one statement count it twice. Executed weights come from 10 seeded cases per function, not from benchmarks, and use the default backend options; `speed`'s backend options (chains, coalesce, homes) are not applied.
- **Fact-guarded rewrites are classified by shape and cited fact.** The facts are not re-checked; the meaning contract and the analyses' own checks are what make them true.
- **Matching relies on determinism.** Verified coverage is measured by re-derivation, which is exact for the deterministic table passes. A pass that applied a rule in a different order would need citations instead.
- **Register allocation and the other backend transformations** make no `typed.blocks` edits, so these tables cannot show them.
- **Scope.** The corpus only (50 projects, O2 and speed). Candela, which IRWB-007 and IRWB-008 measured separately, is not included; IRWB-008 counted 838 rule-table edits on its O2, but its shares are not measured here.

## 6. Framework changes

None in `src/framework/`. One change in `src/typed/`:

- `src/typed/analyses.ts` now exports `IMPURE`, the set of operators that make a tree impure, which was a private constant before. The classifier's purity guard for rule matching on plain trees (the `pure` guard of `sub-self`, `mul-zero`, …) must agree with `isPure`, so it reads the same set instead of keeping a copy.

Proposed, not built (it would change O2's records, which are frozen for parity):

- `Tx.cite` and a `cite` option for `compileRules`, so that a `replace` record lists the rules it applied. D3b would then read the citation and re-derive only to check it.

## 7. Left out, and why

- Pipelines other than O2 and speed. `tools/edit-classes.mjs --pipelines` accepts any list.
- Candela, which is not a corpus project.
- Re-checking cited facts, which belongs to the stage that builds fact-guarded rules.
- A transformation-instance unit (one cfg merge, one licm hoist). Analysis 05's grouping per application, function and sub-class is the simpler approximation; an exact instance unit would need passes to record instance ids.

## Later

- `Tx.cite` with citing variants of simplify and fold.
- `const-read` with a reaching-definitions certificate; `div-pow2` and `rem-pow2` with a range hypothesis.
- CFG normalization rules (constant branch, jump threading, block merge, pruning) and a dead-definition rule, verified on their own terms.
- Classification on the SSA view, where `subst` and `lvn` replacements become single-tree rewrites.

## 8. Reproducing

```
npm run build
node --test tests/typed/edit-classes.test.mjs
node tools/edit-classes.mjs --json various/03-edit-classes-corpus.json > various/03-edit-classes-corpus.txt
node scripts/05-units-and-applications.mjs various/03-edit-classes-corpus.json
```

The corpus run took 23.7 min wall (267 s CPU) on the shared machine. Most of that time is lowering and running each revision for the executed weights; `--no-weights` skips them.

Other code calls `classifyApplication(before, after, pass, edits)`, `classifyRevisions(revisions, { weights, inputs })` and `tally(rows, by, col)` from `src/typed/edit-classes.ts`, or `census(ids, pipelines, opts)` from `tools/edit-classes.mjs`.
