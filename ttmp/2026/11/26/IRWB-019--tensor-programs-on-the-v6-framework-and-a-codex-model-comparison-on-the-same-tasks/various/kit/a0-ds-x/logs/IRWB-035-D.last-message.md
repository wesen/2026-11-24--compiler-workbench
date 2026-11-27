Done. Working tree clean, everything committed.

## Ticket, design, report

- Ticket: `ttmp/2026/11/27/IRWB-035-D--what-share-of-the-optimizer-s-edits-are-local-value-rewrites-a-classifier-and-a-corpus-measurement-for-programme-a/`
- Design (committed first, `efc21af`): `design-doc/01-design-classifying-o2-and-speed-edits-as-local-value-rewrites-structural-or-other.md`
- Report: `design-doc/02-report-what-share-of-o2-and-speed-s-edits-are-local-value-rewrites.md`
- Diary: `diary/01-implementation-diary.md`; scripts `scripts/01`–`08`; recorded tables `various/05-tables.txt`, `various/07-report-figures.txt`, `various/05-classification.json`, probe logs.

## Headline shares (50 corpus projects, both pipelines on every project; 11,757 edit records, 0 unexplained)

| pipeline | local | structural | other | local share |
|---|---|---|---|---|
| O2 | 395 | 1,626 | 0 | **19.5 %** of records |
| speed | 997 | 8,739 | 0 | **10.2 %** of records |

By executed instructions touched: local is 8.6 % of O2's and 2.7 % of `speed`'s edit weight; restricted to content-changing edits (value replaced, statement created/removed/replaced, i.e. excluding branch/block bookkeeping) the local share is **40.0 % in O2** and **10.4 % in `speed`**. Median per-project local share 25.0 % (O2) / 16.7 % (speed).

## Verified-rule coverage of local rewrites

- O2: 183 of 395 (**46.3 %**) cite a table rule (`fold` 43, `simplify` 140); 212 (53.7 %) are cited fact-guarded shapes: read-to-constant 141, read-to-single-definition 51, div/rem-pow2 23.
- speed: 362 of 997 (**36.3 %**) verified; 635 fact-guarded: read-to-constant 264, read-to-single-definition 325, div/rem-pow2 49.
- All cited rules carry `sound` evidence; no citation is `sampled`. Three premise-carrying rules — one per fact shape, each with a premise the pass already computes (`reaching`, `liveness`, `ranges`) — would take local coverage to 100 %.

## Framework changes

**None.** The classifier (`src/typed/edit-classes.ts`, with `tests/typed/edit-classes.test.mjs`) uses only what the framework already records: `RevisionReport.edits`, the two artifacts, value `origin.because` citations, the rule tables and `RULE_EVIDENCE`. The report notes two observations for later (lowering cost dominates per-revision weighting; `Tx.rewrite` keeps no intermediate trees).

Validation on the final tree: build OK, framework 234/234, typed 156 pass 2 skipped, workbench 24 pass 1 skipped, `edit-classes` 7/7, `node tools/build-site.mjs` OK. Count independence checked corpus-wide (52 `(pipeline, pass, kind)` keys, 0 differ vs the count-40 census) and on 16 runs with head revisions compared.

**Last commit: `6e42f9a`**
