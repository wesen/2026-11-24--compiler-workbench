# Tasks

## DONE

- [x] Read the intern guide and the R3 `terms` row; the lane's sources and the tests that pin behaviour
- [x] Design note before code (`design/01-…md`)
- [x] `src/stdlib/term/`: signature, structural key/hash/equality/size, patterns/templates, `match`/`instantiate`, rule index and first match, `verifyRule` over generated cases
- [x] Typed's rule tables match and instantiate through the library over Typed's signature (`src/typed/rules/compile.ts`, `src/typed/edit-classes.ts`)
- [x] Typed's verifier runs its enumeration methods through the library's interface (`src/typed/rules/verify.ts`)
- [x] Tix's `inline` and `split-sum` as rules over the expression signature (`src/tensor/rules.ts`, `src/tensor/passes.ts`)
- [x] F40: the merged statement's correspondence entry says `merged`; the pinning test updated
- [x] The decision point measured (50 projects, O2, interleaved): −0.28 % of compile time, the port stands
- [x] Tests in `tests/stdlib/term.test.mjs`; baselines `no differences`; the five suites; `npm run check`; the site

## TODO (later lanes)

- [ ] F41: `ir/derivation.ts` could map a `merged` step, so a derivation and the correspondence agree (report §"Framework gaps")
- [ ] The LVN/LICM keys, `sameTree`'s other copy and A0's matcher copies on the library's equality and hash (left out: they change what the caches key on, and the baselines pin their output)
