# Changelog

## 2026-11-28

- Initial workspace created
- Library `src/stdlib/term/` (signature, pattern, rules, verify) and the index exports
- Typed: the tables match and instantiate through the library; `edit-classes.ts` loses its own copy; the verifier's two enumeration methods run through `verifyRule`
- Tix: `src/tensor/rules.ts` (expression signature, `split-sum` and `inline` as rules); both passes built on it
- F40: `inline` supplies `merged` correspondence entries, `mergedInto` reads them; `tests/typed/derivations.test.mjs` updated
- Decision point: the library path is not slower (−0.28 % of O2 compile time); the port stands
- Tests `tests/stdlib/term.test.mjs`; report `reference/02-report.md`
