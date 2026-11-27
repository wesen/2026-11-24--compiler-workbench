# Tasks

## Done

- [x] Re-measure regex / LZ / chess and the corpus against the reference compiler (`scripts/01`, `05`)
- [x] Find the shapes: op histogram (`scripts/03`), hot sites with provenance (`scripts/02`), hot shapes
      corpus-wide (`scripts/06`)
- [x] Design (`design/01`), committed before any change
- [x] `bce` reads affine indices: linear forms over the values the reaching definitions name (`src/typed/linear.ts`)
- [x] `ranges` transfer maps bottom to bottom (the analysis defect the proof uncovered)
- [x] Check the change as passes are checked: meaning contract on every pipeline step, `tests/typed/bce-offset.test.mjs`
- [x] Measure the corpus under `O2` and `speed` before/after; regex, LZ, chess re-measured
- [x] Rule discovery from hot unimproved shapes; no rule added, with the counts and the reason
- [x] Report (`reference/02`) and diary (`reference/01`)

## Later

- [ ] An unsigned (or sign-aware) bound in `ranges`, so `i + 1 < len` proves `i < len` (the second check in
      `bounds-offset`)
- [ ] A fact-driven pass for `rem(x, 2^k)` under non-negativity in tests (`chess-search`'s `lt(rem(x, 16), 8)`)
- [ ] A layout choice made after allocation, so the rotated-latch `j`s go without disturbing spills
- [ ] `bcm` rewritten on `src/typed/linear.ts`
