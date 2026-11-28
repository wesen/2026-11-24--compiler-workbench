Done. F27 is complete, committed, and the tree is clean.

## Ticket and report
- Ticket: `ttmp/2026/11/27/IRWB-041-C--f27-tix-passes-keep-their-meaning-gate-inside-strategy-plans/`
- Report: `.../reference/01-report-f27-tix-meaning-gate-in-strategy-plans.md`
- Diary: `.../diary/01-diary-f27-tix-meaning-gate-in-strategy-plans.md`
- Probe: `.../scripts/01-probe-tix-gate-in-plans.mjs`

## Changed, file by file
- `src/tensor/passes.ts` — `pass(name, relation, transform)` and `TixPass = Pass<Module, {}> & { relation }`; `inlinePass` declares `'exact'`, `splitPass` `'tolerance'` (added with `Object.freeze({...definition, relation})` since `PassSpec` has no such field and `definePass` freezes).
- `src/tensor/contract.ts` — `Relation` exported; `meaningGateContract(relation)` builds (cached per relation) the gate as an `ensures` invariant over input/origin/output plus a transformation binding it, with the R3 probe's one adaptation (evidence through a JSON round trip).
- `src/tensor/index.ts` — new `tixAlgorithm(pass, { origin, manager?, onResult? })` passing `contract`/`contractInputs` to `passAlgorithm`, refusing a pass with no declared relation; `optimizeTix` now gates with `definition.relation` (still synchronous, still `applyNativePassSync`).
- `tests/tensor/r3-tix-in-plans.test.mjs` — removed `todo: 'F27'` only; assertions untouched.

## Acceptance
- Target test: passes, `tests 1 / pass 1 / fail 0 / todo 0`.
- Baselines after `npm run build`: `no differences` (timing line 0.527 → 1.66 ms, informational and not compared).
- `tests/tensor/*` (minus `*-gpu`): 45 pass, 0 fail, 0 todo. `tests/framework/*` + `tests/workbench/*`: 262 pass, 0 fail, 4 todo (F33 ×2, F34, F35), 1 skipped. `tests/typed/*`: 183 pass, 0 fail, 3 todo (F36, F37, F38), 2 skipped.
- `npm run check` clean; `node tools/build-site.mjs` not needed (no `src/framework/` or `src/workbench/` change).

## Notes / left out
- `npm run format:check` reports 9 pre-existing unformatted files outside `src/tensor/` (e.g. `src/framework/core/data.ts` is already unformatted at HEAD~1); only `src/tensor/index.ts` among my files needed Prettier, and it is clean.
- No framework change: `relation` is not a `PassSpec` field (that is the phase-3 spike's question); `optimizeTix` still uses `applyNativePassSync` and the by-name pass lookup, a synchronous plan driver being a later step.
- The stock bridge is still ungated for a Tix pass handed to it directly — that is unchanged by design; the fix is that Tix's own algorithm supplies the contract. I found nothing wrong in the brief or the test.

Last commit: `3ca3bf6` (`IRWB-041-C: diary, report and ticket docs`); the code commit is `4ce816a`.
