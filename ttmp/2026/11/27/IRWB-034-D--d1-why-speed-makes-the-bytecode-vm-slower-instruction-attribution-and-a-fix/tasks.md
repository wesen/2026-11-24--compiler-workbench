# Tasks

## DONE

- [x] reproduce the regression and locate the pass from the compiler's records (scripts 01–03)
- [x] write and commit the design (design-doc/01)
- [x] build the attribution tool `src/typed/attribution.ts` + CLI `tools/attribution.mjs`
- [x] test the tool (`tests/typed/attribution.test.mjs`, 4 tests)
- [x] fix `licm` (single back edge + latch dominance, lazy preheader, `skip` records)
- [x] bytecode VM at `n = 12, seed = 8`: 7,678/6,874 (r0) vs 9,286/8,218 before, 6,688/5,968 after
- [x] corpus sweep under O2 and `speed`, before and after (50 projects, JSON + comparison committed)
- [x] parity (`tools/parity.mjs`), `tools/reference-check.mjs --o2`, `tools/build-site.mjs`
- [x] `tests/typed` (155), `tests/framework` (234), `tests/workbench` (25)
- [x] write the report (reference/01) and the diary (log/01)

## TODO

- [ ] later: hoist across a loop nest when the inner loop is certain to run (licm-nested +99)
- [ ] later: a loop tree for back edges that share a head (nine natural loops for one dispatch loop)
- [ ] later: pass-level versions for typed passes (licm's decisions changed, the version did not)
- [ ] later: the one unattributed instruction in f32-dsp
- [ ] later: update the corpus projects' notes.md tables (out of scope here)
