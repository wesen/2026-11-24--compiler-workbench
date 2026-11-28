# Changelog

## 2026-11-28

- Initial workspace created

## 2026-11-28

- Ticket created for lane 4.3 (IRWB-065-B): attribution, provenance and classification as queries.
- D1's and D2's tables captured before any change (`various/d1-before-*.txt`, `various/d2-before-*.txt`).
- `src/framework/ir/attribution.ts`: `recordChain` with `credit` and `changedBy`.
- `src/typed/attribute.ts`, `src/typed/missed.ts`, `src/typed/edit-classes.ts` rewritten on it; the matcher copy
  moved onto `src/stdlib/term`; the re-derivation code the queries replace deleted.
- Settled 203 against 395 at 395 (`localityGround`: the input revision and the values the application computed).
- Acceptance: tables identical, baselines `no differences`, five suites green, tsc clean, site builds.
