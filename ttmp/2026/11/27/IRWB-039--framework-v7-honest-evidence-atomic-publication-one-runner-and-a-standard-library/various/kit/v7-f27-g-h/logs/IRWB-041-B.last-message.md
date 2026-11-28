Done. All acceptance criteria are checked on the final commit.

## Ticket and report
- Ticket: `ttmp/2026/11/27/IRWB-041-B--f27-tix-passes-keep-their-meaning-gate-inside-strategy-plans/` (closed, tasks complete)
- Report: `.../reference/01-report.md` · Diary: `.../diary/01-implementation-diary.md` · Probe: `.../scripts/01-gate-in-plans.mjs`

## What changed (commit `0308613`)
- `src/tensor/passes.ts` — `TixPass` interface; each pass declares its meaning relation (`inline`: `exact`, `split-sum`: `tolerance`), attached after `definePass` so a spread (like the test's `r3.wrong`) keeps the declaration.
- `src/tensor/contract.ts` — `gateContract(relation)`: the meaning gate as a transformation contract — an `ensures` invariant binding input, origin (r0) and output into `meaningGate`, with the probe's one adaptation (JSON round trip on evidence whose `undefined` field the manager's encoder refuses).
- `src/tensor/index.ts` — `optimizeTix` gates with the *declared* relation instead of choosing by pass name; new `tixAlgorithm(pass, { origin })` rides the gate through the bridge's existing `contract`/`contractInputs` options.
- `tests/tensor/r3-tix-in-plans.test.mjs` — F27's `todo` removed, assertions unchanged.
- Commit `072572a` — ticket diary, report, probe and docmgr bookkeeping.

## Acceptance results
- **The test:** `F27: a wrong Tix pass is rejected inside a strategy plan; correct passes are accepted` — passes, `todo` removed.
- **Baselines:** `02-baselines.mjs check` after `npm run build` → `no differences`.
- **Suites:** typed 183 pass / 0 fail / 3 todo (other steps) / 2 skipped; framework 238 / 0 / 4 todo; workbench 24 / 0 / 1 skipped; tensor (non-GPU) 45 / 0 / 0 todo. Node's "failing tests" list contains only the todo tests of F33-F38.
- `npm run check` clean; no `src/framework/`/`src/workbench/` change, so no site build; `format:check` flags only 9 pre-existing files, none of mine.

## Notes
- No framework change was needed — the bridge's `contract`/`contractInputs` options were sufficient. The relation lives on the Tix pass rather than in `PassSpec` because this step has no framework scope; it can move there if a later step adds a framework-level declared relation.
- Each `tixAlgorithm` owns a private `AnalysisManager` (as in the probe); threading a shared manager through would need a caller that wants it.
- Nothing in the brief or the test looked wrong. One process note: my first tensor run used a bare glob and also executed the `*-gpu.test.mjs` files (they passed/skipped); I re-ran the seven non-GPU files explicitly for the reported counts.

**Last commit:** `072572a`
