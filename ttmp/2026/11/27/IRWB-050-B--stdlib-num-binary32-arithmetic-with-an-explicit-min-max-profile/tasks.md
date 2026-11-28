# Tasks

## TODO

- [x] Read `src/stdlib/index.ts` (admission rule, layering) and the two clients' min/max rules
- [x] Create the ticket; write the evaluator speed probe and measure the build *before* the change
- [x] `src/stdlib/num/minmax.ts`: the rule once over `FloatOrder<T>`, profiles `minimumNumber` and `minimum`
- [x] `src/stdlib/num/binary32.ts`: bit representation, `BITS`, `binary32(profile)` operation set
- [x] `src/typed/f32.ts`: build the opcode tables from `binary32('minimumNumber')`, delete the old copies
- [x] `src/tensor/evaluate.ts`: `minmax('minimum', NUMBERS)`; delete `Math.max`/`Math.min`
- [x] `src/stdlib/index.ts`: re-exports and the `num/` line
- [x] `tests/stdlib/num.test.mjs`: both profiles on the special values, the trap inputs, both representations, both clients
- [x] Baselines (`02-baselines.mjs check`) and the five suites; `npm run check`; `tools/build-site.mjs`
- [x] Measure the evaluator before (saved build) against after, interleaved, and the primitive's per-pair cost
- [x] Design doc, diary and report

## DONE

- `num` module delivered with two clients on it and byte-identical baselines.

## LATER

- The integer helpers `src/stdlib/index.ts` still lists under `num/` (saturating and wrapping arithmetic) need a name
  of their own now that `num/` is binary32 — see the report.
