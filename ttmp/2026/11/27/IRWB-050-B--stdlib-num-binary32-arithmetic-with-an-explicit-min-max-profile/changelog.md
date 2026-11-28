# Changelog

## 2026-11-27

- Initial workspace created
- Moved binary32 arithmetic from `src/typed/f32.ts` into `src/stdlib/num/` (`binary32.ts`), with min/max as a named
  IEEE 754-2019 profile (`minmax.ts`): `minimumNumber` for Typed's RV32F, `minimum` for Tix's `Math.max`/`Math.min`.
  `src/tensor/evaluate.ts` now calls the library; `Math.max`/`Math.min` deleted there.
- `tests/stdlib/num.test.mjs`: 6 tests over both profiles, both representations and both clients.
- Baselines `no differences`; `tests/{typed,framework,workbench,stdlib,tensor}` pass; `npm run check` and
  `tools/build-site.mjs` clean.
- Measured the evaluator before/after (interleaved, CPU time): 1.02×–1.30× of the old time on softmax and attention
  at f32 and f64, inside this shared machine's own spread; the primitive itself is 13.3 ns/pair against `Math.max`'s
  2.4 ns/pair, with the plain-call overhead accounting for the difference.
