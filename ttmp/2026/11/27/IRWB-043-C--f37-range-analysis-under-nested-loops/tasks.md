# Tasks

## DONE

- [x] Reproduce the lost lower bound (`scripts/01`), find the head that widens it (`scripts/02`, `05`)
- [x] Fix `typed.ranges` with the unstable-component rule; thread the region into the framework's `widen`
- [x] F37 test without `todo`; `guards` `counter` test updated to the corrected facts
- [x] Baselines, parity, four suites, `npm run check`, `build-site`
- [x] Measure the threshold-widening alternative (`scripts/08`)
- [x] Analysis doc (`analysis/01`) and this report (`analysis/02`)

## TODO

- [ ] Later: a `mapLattice`-level "widen only these keys" helper, once a second analysis needs it
- [ ] Later: a framework `cycles(graph)` helper, second use = `src/typed/backend/frequency.ts`'s private Tarjan
- [ ] Later: a wrapping-aware i32 add in `evalRange` so an extreme upper bound does not cost the lower one
