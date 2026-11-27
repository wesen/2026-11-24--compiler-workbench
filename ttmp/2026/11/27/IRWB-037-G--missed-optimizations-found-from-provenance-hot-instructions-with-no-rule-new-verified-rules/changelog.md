# Changelog

## 2026-11-27

- Initial workspace created
- Baseline measured; `hotShapes` and `tools/missed.mjs`; design committed (badf42a)
- Passes `thread`, `guards`, `copies`, `subst-mem` in `speed`; `walkDominatorTree` and `ScopedMap` in the
  framework (814ba6c). First built inside cfg, bce and constprop; moved out because O2 is pinned to the book
- `thread` decides constant arms and runs twice; `copies` reads through any read it can (98e70b3)
- `guards` proves loop counters non-negative and reduces `x / 2^k`, `x % 2^k`
- Table `identities` (three rules) and its pass, with recorded evidence (22bf2f7)
- Final measurements, checks, report
