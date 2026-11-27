Done. The working tree is clean and the last commit holds the complete result.

## IRWB-035-E — final summary

**Ticket, design and report**
- Ticket: `ttmp/2026/11/27/IRWB-035-E--a0-what-share-of-the-optimizer-s-edits-are-local-value-rewrites/`
- Design: `design-doc/01-design-edit-classification.md` (committed before any implementation)
- Final report: `design-doc/02-final-report-a0-edit-shares.md`; all tables in `various/03-tables.txt`, census JSON per project in `various/02-*.json`, diary in `log/01-implementation-diary.md`

**Headline shares** (50 corpus projects, 11,757 edits; classification is a pure function of the pass name, the edit records and the two revisions — the "motion test" separates pure value rewrites from licm/lvn/inline bookkeeping):

| pipeline | by edit count (local/structural/other) | by instructions affected |
|---|---|---|
| O2 (2,021 edits) | **19.5% / 72.1% / 8.4%** | **48.1% / 48.5% / 3.4%** |
| speed (9,736 edits) | **10.2% / 84.1% / 5.6%** | **26.5% / 70.4% / 3.1%** |

Local rewrites are 78% (O2) and 88% (`speed`) of *value* edits; the rest of the edit mass is `cfg` branch plumbing, inlining and motion. By instructions touched, local rewrites are about half of O2's optimizer work.

**Verified-rule coverage of local rewrites:** 46.3% on O2 (183/395), 36.3% on `speed` (362/997) re-derive exactly from the verified tables (`mul-pow2` 190 and `not-lt` 134 are the top firings); zero are unexplained. The remaining 54%/64% is exactly **three fact-backed rule shapes** — constprop's reaching-constant (399), subst's single-use copy (382), strength's non-negative range (66) — which would take coverage to 100% of local rewrites, confirming IRWB-008 §25's list. The `other` class (dce/subst dead-statement removals) is small and per-site provable.

**The classifier is a tool:** `src/typed/edit-class.ts` (`classifyApplication`, `rederive`), no `Tx`/pass code shared, tested in `tests/typed/edit-class.test.mjs` (5 tests); census re-runs via `scripts/02-classify-corpus.mjs` + `scripts/03-tables.mjs`.

**Framework changes: none** — the edit records, rule tables and the image's per-instruction `covers` already carried everything; the three surprising edit shapes the corpus revealed (lvn's chained replaces, licm's hoist-of-a-hoist, pruned blocks) were resolved inside the classifier's decision procedure.

**Validation:** `npm run build` clean; `tests/typed` 154 pass/0 fail, `tests/framework` 234 pass/0 fail, `tests/workbench` 24 pass/0 fail (3 pre-existing skips); prettier on every file touched.

**Last commit:** `8eef7bf`
