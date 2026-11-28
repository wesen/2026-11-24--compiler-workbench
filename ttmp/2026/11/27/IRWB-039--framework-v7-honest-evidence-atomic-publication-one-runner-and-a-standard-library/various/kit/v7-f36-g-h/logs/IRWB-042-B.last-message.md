All done. Working tree clean, everything verified on the final commit.

## Final message

**Ticket and report**
- Ticket: `ttmp/2026/11/27/IRWB-042-B--f36-and-f38-bce-compares-ssa-names-lvn-runs-twice/`
- Report: `.../IRWB-042-B.../reference/02-report.md` (diary: `.../reference/01-implementation-diary.md`)

**What changed**
- `src/typed/passes.ts` — **bce** (F36): needs `typed.ssa` instead of `reaching`; `nameOf` resolves index and buffer through copy chains, and the pass now compares **SSA names** (one name = one value) instead of equal reaching-definition sets; the branch's index must still be a direct `get` so the ranges fact describes the tested value; `isLength` simplified.
- `src/typed/passes.ts` — **lvn** (F38): a recorded `seen` occurrence is live exactly while its value is still in its statement's tree (`live`); a dead entry (its tree was rebuilt around a value an earlier merge of the same run replaced) is refreshed to the current occurrence instead of calling `tx.replace` on a dead id.
- `tests/typed/d2-defects.test.mjs` — removed the two `todo` options (F37 stays, another step).
- Ticket: probes `scripts/01-04`, evidence logs `various/02-09`, diary, report, changelog.

**Evidence for the mechanisms** (probes in the ticket): F36 — reaching sets of `i` are equal at guard and check (`s:walk.0 s:walk.5`) while the SSA names differ (`i.2` loop-header phi vs `i.4` if-join phi); F38 — the second lvn on regex-nfa meets exactly one dead entry, `v:regexMatch.587` at `s:regexMatch.246` (the id from the old error), refreshed to `v:regexMatch.585` at `s:regexMatch.251`; corpus-wide, a second `lvn` (before `rotate` in `speed`, after the first in `O2`) on every project: 0 thrown, 0 rejected, nothing slower, 4 combinations faster.

**Acceptance results** (all on the final source)
- F36 and F38 tests pass without `todo`.
- Baselines: `02-baselines.mjs check` → **no differences** (image hashes, sizes, instruction counts at both seeds, per-pass edit census, all corpus projects under r0/O2/speed; all Tix CUDA/`optimizeTix`). No project slower — nothing changed at all.
- Suites: typed 188 tests, 185 pass, 0 fail, 2 skipped, 1 todo (F37); framework 242, 238 pass, 0 fail, 4 todo (F33–F35); workbench 25, 24 pass, 1 skipped, 0 fail; tensor (no gpu) 45, 44 pass, 1 todo (F27), 0 fail.
- `npm run check` clean; `build-site.mjs` not needed (no `src/framework/` or `src/workbench/` change).

**Left out / notes**
- lvn does not re-match a rebuilt tree under its new id (its structural key changed when the replaced sub-value became `@t`) — one possible extra merge per dead entry; sound to leave out.
- bce still requires the branch to read the index directly (a copy at the branch would break the ranges argument); the check side may be any copy chain — strictly more sound coverage than before.
- Nothing in the brief looked wrong; the proposed F36 fix ("compare values, SSA names") applied directly. My first F38 fix sketch (track replaced ids, look for one in the recorded value's subtree) was incomplete — it missed a replaced *ancestor* — and was replaced by the exact statement-tree check before the final commit.
- 9 unrelated `src/**` files fail `prettier --check` but were unformatted before this step; I formatted only `src/typed/passes.ts`.

**Last commit:** `3104030`
