Done. Ticket and report are on branch `v7-lattice-ds-x/irwb-048-b`, working tree clean.

## Paths
- Ticket: `ttmp/2026/11/27/IRWB-048-B--the-standard-library-s-lattices-moved-from-the-framework-s-dataflow-layer-with-sccp-as-the-second-client/`
- Report: `.../reference/02-report-the-lattices-in-the-standard-library.md`
- Diary: `.../reference/01-implementation-diary.md`; probes in `.../scripts/` (`01-flat-json-constraint.ts`, `02-sccp-flat-lattice-equivalence.mjs`, `03-sccp-corpus.mjs` + `.before/.after.txt`)

## Changed, one line each
- `src/stdlib/lattice/lattices.ts` (new): `Lattice<V>` + set, flat, interval (up-to widening with thresholds), map lattices + `lattice` aggregate, moved verbatim; new header with the laws, the "same lattice" criterion, and a library-local `Json` (the library may import nothing outside `src/stdlib/`).
- `src/stdlib/index.ts`: exports the lattice module, records it under "what exists now".
- `src/framework/dataflow/lattices.ts`: 157 lines → 10, one `export * from '../../stdlib/lattice/lattices.js'`.
- `src/typed/sccp.ts`: `Lat = Flat<Const>`, `meet = flatLattice<Const>().join`, and the W‑Z top/bottom reversal fixed at all six uses (its old `TOP` was the lattice's bottom).
- `tests/stdlib/lattice.test.mjs` (new): 17 tests — join laws on *every* triple of each finite element domain (8/5/16/16 values), bottom identity, widening an upper bound of both arguments, widening chains that stabilize, encode/decode round trip, the threshold cases, and the framework re-export being the same functions (one copy).
- `tests/framework/layering.test.mjs`: import rule now "nothing outside `src/framework` except `src/stdlib/`" — the old rule forbids exactly the re-export the brief requires.
- `tests/typed/ssa.test.mjs:102`: one assertion on the lattice element's shape (`{k:'const',v:7,t:'i32'}` → `{value:{v:7,t:'i32'}}`); the asserted fact is unchanged.

## Acceptance
- My tests: 17/17 pass (`node --test tests/stdlib/lattice.test.mjs`).
- Baselines after `npm run build`: `no differences from .../various/baselines/main.json`.
- Suites (explicit files, `*-gpu` excluded): stdlib+framework 267 pass / 0 fail; workbench 24 pass / 0 fail / 1 pre-existing skip (`IRWB_FULL=1`); typed 186 pass / 0 fail / 2 pre-existing skips (`IRWB_CANDELA=1`); tensor (7 non-gpu files) 45 pass / 0 fail. Total 522 pass, 0 fail.
- `npm run check` clean; `node tools/build-site.mjs` builds (131 source files); prettier clean on every file this step touched.
- Extra evidence: `scripts/02` shows the library flat lattice agrees with SCCP's old lattice on all 25 pairs of join/equal (under old‑⊤→`BOT`, old‑⊥→`TOP`); `scripts/03` shows all 50 corpus projects accept `sccp` and verify, 155 constants over 15 projects, with per-project fingerprints **identical** to a run against the pre-change sources.

## Left out / disagree with the brief
- The framework now depends on `src/stdlib/` (one way). If "framework imports nothing outside itself" was meant to stay true, it contradicts the required re-export; I relaxed that test assertion instead of adding an adapter, and said so in the report.
- Widening is checked on each lattice with `widen = join` for the finite-height ones (their chains terminate because they are finite); only the interval lattice has a real `widen`. Adding `widen` to the `Lattice` interface itself belongs to the solver step, which is out of scope.
- The interval `widen` is defined on an ascending pair inside `[min,max]`; inputs outside that range (my first, wrong test case) are not inputs of that lattice and do not satisfy the upper-bound property.

Last commit: `ad84bc4`
