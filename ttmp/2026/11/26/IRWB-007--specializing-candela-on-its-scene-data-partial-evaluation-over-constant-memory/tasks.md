# Tasks

## TODO
- [x] Intern guide written, second reading done, uploaded to reMarkable (this round) <!-- t:j5d7 -->
- [ ] Phase 0: measuring harness: binding-time profile of any revision in tools/ (reproduces measurement 3 on r0; 0 K ops, 0 differing floats on the per-scene revision) <!-- t:h6j5 -->
- [ ] Phase 1: typed.memory fact, memoryFacts builder, assumeMemory (cells specs, one-pixel spans), static no-store check, memory-sccp (ptr values, folded load and caddr); acceptance: 0 constant-position U and K-word reads left, real-row contract accepts, frames bit-identical, instructions per pixel vs 8,267.7 <!-- t:zaq6 -->
- [ ] Phase 2: inline small readers, fns write kind + tx.cloneFunction + clone pass with memo table, unroll constant-trip loops; acceptance: no oRow call with a static index, clones and bytes reported, ops vs gen bound <!-- t:r4yf -->
- [ ] Phase 3: BVH walk as polyvariant program points with per-state stack values and generalization; acceptance: walk replaced by box-test tree (B-01 2 blocks, R-01 8), 0 BV loads per pixel, falsifier 1 (B-01 > 6,000 instructions per pixel) checked <!-- t:hx1o -->
- [ ] Phase 4: The Trick on r.obj at finishHit and on the light index; generalization at the bounce head; acceptance: ops vs data bound, 0 X loads in finishHit, bytes within budget <!-- t:wtaa -->
- [ ] Phase 5: all 18 scenes as chooseBest candidates under the bytes budget, hand-staging experiment (one material as data), hypothesis judged per section 23 <!-- t:gjtu -->
