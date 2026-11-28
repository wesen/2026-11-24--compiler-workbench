Done. Final state verified on commit `1031b8b`.

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-045-C--f33-publish-a-pass-s-result-only-after-it-is-accepted/`
- Report: `.../reference/02-report-f33-publication-only-after-acceptance.md`
- Design: `.../design-doc/01-publish-a-pass-result-only-after-it-is-accepted.md`; diary: `.../reference/01-implementation-diary.md`; probes: `.../scripts/01-publication-before-acceptance.mjs`, `.../scripts/02-accepted-publication.mjs`

## What changed, file by file

- `src/framework/ir/store.ts` — added `IRStore.publish(next, { base?, generation?, acceptance? })`; `#publish` takes an optional base (head advance under CAS, or a lineage opening under `retain`'s rule), and the acceptance's synchronous `commit()` runs inside the publication window.
- `src/framework/passes/define-pass.ts` — `prepareNative` opens the candidate on a private store (no store parameter); `applyPass` captures the input's generation, runs the contract with `{ deferCommit: true }`, wraps the preservation loop plus the single publication in one `try` and rolls the deferred evidence back on any rejection; `publishAccepted` publishes once (head advance / lineage opening / plain `commit()` without a store).
- `src/framework/ir/README.md` — one clause naming `store.publish`.
- `tests/framework/r3-defects.test.mjs` — the two `F33:` tests lose their `todo` option; assertions untouched.

## Acceptance results

- Test: both `F33:` tests pass (`tests 4, pass 2, fail 0, todo 2` for F34/F35).
- Baselines: `no differences from .../various/baselines/main.json` (timing line moved, never compared).
- Suites: framework 242/240 pass/0 fail/2 todo (F34,F35); typed 188/183/0/2 skipped (`IRWB_CANDELA=1`)/3 todo (F36–F38); workbench 25/24/0/1 skipped (`IRWB_FULL=1`); tensor (7 non-GPU files) 45/44/0/1 todo (F27). `npm run check` clean; `node tools/build-site.mjs` built (app.js 3097 KiB, 50 projects).

## Left out / disagree with

- No domain code passes a store, so the accepted publication path is exercised by tests and scripts only (listed under `Later`).
- "A stale head is its own outcome" is delivered as `IRError('ir.stale-edit'/'ir.lineage')`, not a new `PassError` code — say so if a catchable pass code was meant.
- The second F33 test asserts `status !== 'accepted'`, which rollback and "never committed" both satisfy; I rolled back (`rolled-back`, printed by script 01) and did not strengthen the assertion.
- Prettier was not run on `store.ts`/`define-pass.ts`: both were already unformatted at HEAD; my additions follow local style.
- Analyses of a rejected candidate from the preservation recompute remain in the manager's analysis memo (keyed by revision) — memo, not evidence; dropping them needs a manager API the brief doesn't name.

Last commit: `1031b8b`
