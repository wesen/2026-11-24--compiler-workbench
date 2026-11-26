
### Per operator

| | mutants | equivalent | killed (default) | wrong, accepted (default) | kill rate (default) | wrong, accepted (strong) | kill rate (strong) |
|---|---:|---:|---:|---:|---|---:|---|
| swap | 215 | 5 | 210 | 0 | 97.7 % .. 100.0 % | 0 | 97.7 % .. 100.0 % |
| const | 474 | 25 | 409 | 40 | 88.1 % .. 91.1 % | 4 | 95.9 % .. 99.1 % |
| cmp-flip | 106 | 0 | 106 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| cmp-weaken | 149 | 88 | 59 | 2 | 47.2 % .. 96.7 % | 0 | 48.8 % .. 100.0 % |
| drop-check | 31 | 27 | 4 | 0 | 17.4 % .. 100.0 % | 0 | 17.4 % .. 100.0 % |
| check-range | 30 | 26 | 3 | 1 | 13.0 % .. 75.0 % | 1 | 13.0 % .. 75.0 % |
| shift | 110 | 1 | 109 | 0 | 99.1 % .. 100.0 % | 0 | 99.1 % .. 100.0 % |
| hoist-trap | 21 | 20 | 1 | 0 | 5.0 % .. 100.0 % | 0 | 5.0 % .. 100.0 % |
| drop-store | 8 | 0 | 8 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| total | 1144 | 192 | 909 | 43 | 83.1 % .. 95.5 % | 5 | 86.6 % .. 99.5 % |

### Per project

| | mutants | equivalent | killed (default) | wrong, accepted (default) | kill rate (default) | wrong, accepted (strong) | kill rate (strong) |
|---|---:|---:|---:|---:|---|---:|---|
| across-calls | 5 | 0 | 5 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| blend | 24 | 5 | 19 | 0 | 90.5 % .. 100.0 % | 0 | 90.5 % .. 100.0 % |
| bounds-lab | 80 | 13 | 61 | 6 | 77.2 % .. 91.0 % | 1 | 83.5 % .. 98.5 % |
| bounds-offset | 36 | 8 | 27 | 1 | 75.0 % .. 96.4 % | 0 | 77.8 % .. 100.0 % |
| bounds-param | 19 | 3 | 15 | 1 | 83.3 % .. 93.8 % | 0 | 88.9 % .. 100.0 % |
| bounds-two | 22 | 3 | 18 | 1 | 81.8 % .. 94.7 % | 0 | 86.4 % .. 100.0 % |
| branches | 43 | 3 | 37 | 3 | 92.5 % .. 92.5 % | 0 | 100.0 % .. 100.0 % |
| call-chain | 12 | 0 | 12 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| calls | 12 | 2 | 10 | 0 | 83.3 % .. 100.0 % | 0 | 83.3 % .. 100.0 % |
| checksum | 13 | 2 | 10 | 1 | 76.9 % .. 90.9 % | 0 | 84.6 % .. 100.0 % |
| collatz | 30 | 4 | 26 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| constants | 7 | 1 | 6 | 0 | 85.7 % .. 100.0 % | 0 | 85.7 % .. 100.0 % |
| dead-code | 5 | 0 | 5 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| diagnostics | 4 | 0 | 4 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| div-checks | 19 | 4 | 15 | 0 | 78.9 % .. 100.0 % | 0 | 78.9 % .. 100.0 % |
| div-magic | 26 | 1 | 23 | 2 | 92.0 % .. 92.0 % | 0 | 100.0 % .. 100.0 % |
| early-exit | 14 | 1 | 12 | 1 | 85.7 % .. 92.3 % | 0 | 92.9 % .. 100.0 % |
| first-steps | 5 | 0 | 5 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| fixed-point | 23 | 4 | 16 | 3 | 69.6 % .. 84.2 % | 2 | 73.9 % .. 89.5 % |
| fragments | 24 | 5 | 18 | 1 | 85.7 % .. 94.7 % | 0 | 90.5 % .. 100.0 % |
| gcd | 5 | 0 | 5 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| heat-lab | 87 | 23 | 63 | 1 | 72.4 % .. 98.4 % | 0 | 73.6 % .. 100.0 % |
| histogram | 48 | 13 | 34 | 1 | 70.8 % .. 97.1 % | 0 | 72.9 % .. 100.0 % |
| licm-nested | 20 | 2 | 16 | 2 | 88.9 % .. 88.9 % | 0 | 100.0 % .. 100.0 % |
| licm-traps | 11 | 1 | 9 | 1 | 90.0 % .. 90.0 % | 0 | 100.0 % .. 100.0 % |
| match-enum | 32 | 6 | 26 | 0 | 86.7 % .. 100.0 % | 0 | 86.7 % .. 100.0 % |
| my-analysis | 16 | 1 | 14 | 1 | 87.5 % .. 93.3 % | 0 | 93.8 % .. 100.0 % |
| my-first-pass | 4 | 0 | 4 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| nested-loops | 18 | 2 | 14 | 2 | 87.5 % .. 87.5 % | 0 | 100.0 % .. 100.0 % |
| orders | 36 | 5 | 30 | 1 | 90.9 % .. 96.8 % | 0 | 93.9 % .. 100.0 % |
| params-demo | 25 | 4 | 20 | 1 | 90.9 % .. 95.2 % | 0 | 95.5 % .. 100.0 % |
| pressure | 6 | 0 | 6 | 0 | 100.0 % .. 100.0 % | 0 | 100.0 % .. 100.0 % |
| ramp | 22 | 4 | 16 | 2 | 76.2 % .. 88.9 % | 1 | 81.0 % .. 94.4 % |
| records | 19 | 4 | 15 | 0 | 78.9 % .. 100.0 % | 0 | 78.9 % .. 100.0 % |
| regalloc-lab | 45 | 5 | 39 | 1 | 92.9 % .. 97.5 % | 0 | 95.2 % .. 100.0 % |
| sort | 87 | 23 | 63 | 1 | 72.4 % .. 98.4 % | 0 | 73.6 % .. 100.0 % |
| start-here | 55 | 11 | 42 | 2 | 80.8 % .. 95.5 % | 0 | 84.6 % .. 100.0 % |
| strength | 33 | 6 | 25 | 2 | 75.8 % .. 92.6 % | 1 | 78.8 % .. 96.3 % |
| strings | 69 | 13 | 54 | 2 | 91.5 % .. 96.4 % | 0 | 94.9 % .. 100.0 % |
| ui-gallery | 33 | 5 | 27 | 1 | 90.0 % .. 96.4 % | 0 | 93.3 % .. 100.0 % |
| value-numbering | 23 | 1 | 21 | 1 | 95.5 % .. 95.5 % | 0 | 100.0 % .. 100.0 % |
| wrong-shift | 27 | 4 | 22 | 1 | 81.5 % .. 95.7 % | 0 | 85.2 % .. 100.0 % |
| total | 1144 | 192 | 909 | 43 | 83.1 % .. 95.5 % | 5 | 86.6 % .. 99.5 % |

### Classes and methods (default)

- equivalent-presumed / sample+unconstrained: 142
- equivalent-spec / sample+unconstrained: 24
- equivalent-spec-proved / exhaustive: 26
- survived-wrong / deep-sample: 3
- survived-wrong / exhaustive: 1
- survived-wrong / exhaustive-diverges: 9
- survived-wrong / sample: 6
- survived-wrong / sample-diverges: 24

### Wrong mutants accepted by default

- bounds-lab.total const -1 `1` (sample-diverges): diverges: limit 200000, baseline 103 steps args [1024]
- bounds-lab.window const -1 `1` (sample-diverges): diverges: limit 200000, baseline 77 steps args [1024,30]
- bounds-lab.pairs cmp-weaken gt `(i >= load32[a+0])` (sample): expected 96088, got 97870 args [1024,1040]
- bounds-lab.pairs check-range len+1 `if (t5 >=u load32[b+0]) goto .8 else .11` (sample): expected trap, got 365339 args [1024,1072]
- bounds-lab.pairs const -1 `1` (sample-diverges): diverges: limit 200000, baseline 187 steps args [1024,1072]
- bounds-lab.tail const -1 `1` (sample-diverges): diverges: limit 200000, baseline 148 steps args [1024]
- bounds-offset.rises const -1 `1` (sample-diverges): diverges: limit 200000, baseline 142 steps args [1024]
- bounds-param.prefix const -1 `1` (sample-diverges): diverges: limit 200000, baseline 49 steps args [1024,9]
- bounds-two.dot const -1 `1` (sample-diverges): diverges: limit 200000, baseline 60 steps args [1024,1040]
- branches.sign const -1 `0` (sample): expected -1, got 0 args [-1]
- branches.sign const +1 `0` (sample): expected 1, got 0 args [1]
- branches.grade const -1 `80` (exhaustive): expected 2, got 3 args [79]
- checksum.total const -1 `1` (sample-diverges): diverges: limit 200000, baseline 173 steps args [1024]
- div-magic.digitsum cmp-weaken lt `(v <= 0)` (exhaustive-diverges): diverges: limit 200000, baseline 34 steps args [-100000]
- div-magic.digitsum const -1 `0` (exhaustive-diverges): diverges: limit 200000, baseline 34 steps args [-100000]
- early-exit.find const -1 `1` (sample-diverges): diverges: limit 200000, baseline 69 steps args [1024,3]
- fixed-point.qmul const +1 `128` (sample): expected 21688, got 21689 args [-3503,-1585]
- fixed-point.qmul const -1 `32767` (deep-sample): expected 32766, got 32767 args [-3442,-2437]
- fixed-point.qmul const +1 `-32768` (deep-sample): expected -32767, got -32768 args [-2095,4004]
- fragments.blend const -1 `1` (sample-diverges): diverges: limit 200000, baseline 125 steps args [1024,17,-813,45]
- heat-lab.sort const -1 `1` (sample-diverges): diverges: limit 200000, baseline 1194 steps args [1024]
- histogram.histogram const -1 `1` (sample-diverges): diverges: limit 200000, baseline 317 steps args [1024,1056]
- licm-nested.table const -1 `1` (exhaustive-diverges): diverges: limit 200000, baseline 11 steps args [1,0,-20,-20]
- licm-nested.table const -1 `1` (exhaustive-diverges): diverges: limit 200000, baseline 15 steps args [1,1,-20,-20]
- licm-traps.ratio const -1 `1` (exhaustive-diverges): diverges: limit 200000, baseline 9 steps args [1,-50,-3]
- my-analysis.f const -1 `0` (sample-diverges): diverges: limit 200000, baseline 134 steps args [29,1]
- nested-loops.grid const -1 `1` (exhaustive-diverges): diverges: limit 200000, baseline 11 steps args [1,0,-9]
- nested-loops.grid const -1 `1` (exhaustive-diverges): diverges: limit 200000, baseline 15 steps args [1,1,-9]
- orders.kernel const -1 `1` (sample-diverges): diverges: limit 200000, baseline 114 steps args [1024,12,3]
- params-demo.blend const -1 `1` (sample-diverges): diverges: limit 200000, baseline 125 steps args [1024,17,-813,45]
- ramp.ramp const -1 `65535` (deep-sample): expected 74896, got 74896 args [1024,4681]
- ramp.ramp const -1 `1` (sample-diverges): diverges: limit 200000, baseline 89 steps args [1024,4081]
- regalloc-lab.accum const -1 `1` (sample-diverges): diverges: limit 200000, baseline 73 steps args [1024,5]
- sort.sort const -1 `1` (sample-diverges): diverges: limit 200000, baseline 394 steps args [1024]
- start-here.smooth const -1 `1` (sample-diverges): diverges: limit 200000, baseline 247 steps args [1024,23,-8]
- start-here.peak const -1 `1` (sample-diverges): diverges: limit 200000, baseline 135 steps args [1024]
- strength.meter const -1 `1000` (sample): expected 256, got 250 args [1024]
- strength.meter const -1 `1` (sample-diverges): diverges: limit 200000, baseline 221 steps args [1024]
- strings.vowels const -1 `1` (exhaustive-diverges): diverges: limit 200000, baseline 877 steps args [1024]
- strings.digits const -1 `1` (sample-diverges): diverges: limit 200000, baseline 174 steps args [1024]
- ui-gallery.sum const -1 `1` (sample-diverges): diverges: limit 200000, baseline 57 steps args [1024,4]
- value-numbering.halves const -1 `1` (exhaustive-diverges): diverges: limit 200000, baseline 9 steps args [1]
- wrong-shift.bucket const -1 `1` (sample-diverges): diverges: limit 200000, baseline 173 steps args [1024]

### Wrong mutants accepted by strong

- bounds-lab.pairs check-range len+1 `if (t5 >=u load32[b+0]) goto .8 else .11` (sample): expected trap, got 365339 args [1024,1072]
- fixed-point.qmul const -1 `32767` (deep-sample): expected 32766, got 32767 args [-3442,-2437]
- fixed-point.qmul const +1 `-32768` (deep-sample): expected -32767, got -32768 args [-2095,4004]
- ramp.ramp const -1 `65535` (deep-sample): expected 74896, got 74896 args [1024,4681]
- strength.meter const -1 `1000` (sample): expected 256, got 250 args [1024]
