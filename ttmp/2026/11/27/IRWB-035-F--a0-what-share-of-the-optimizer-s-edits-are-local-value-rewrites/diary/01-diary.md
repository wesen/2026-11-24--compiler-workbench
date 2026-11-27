---
Title: Diary
Ticket: IRWB-035-F
Status: active
Topics:
    - compiler
    - rewrite-rules
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:08:36.713535285-05:00
WhatFor: ""
WhenToUse: ""
---

## Step 1: reading, ticket, design

The task came from the coordinator as a prompt file (`IRWB-019/.../prompts/typed/a0/claude/IRWB-035-F.md`, not in this worktree); its request, summarized: classify every edit the O2 and `speed` pipelines make on the corpus as local rewrite, structural or other, measure the shares per pass, pipeline and project by edit count and by affected instructions, measure how many local rewrites cite or match a verified rule and which rules would cover the rest, and leave the classifier as a tool with a test.

Read the contracts and IR READMEs, `define-pass.ts`, `strategies.ts`, `passes.ts`, `tx.ts`, `rules/compile.ts`, `rules/form.ts`, the simplify and fold tables, the backend image format (`covers`) and `heat`, and IRWB-008's edit census script and its result (394 of 394 simplify/fold edits re-derivable). Findings that shaped the design:

- Edit records are per `Tx` operation; a `replace` record gives `from`/`to` value ids; the justification of a new value lives in its origin (`origin[0].because`), not in the record.
- No edit record cites a rule: IRWB-008's `Tx.cite` was a proposal and was never built. "Cites" is therefore zero today; "matches" is measured by re-derivation with the same matcher (`firstMatch`).
- Image instructions carry `covers` (a value and its statement), so instructions can be attributed to statements and statements to edits.
- Register allocation is backend work and makes no `typed.blocks` edit.

`npm run build` took 3 min 19 s wall (18.7 s user): the machine's load average was about 35. The worktree has no `node_modules`; `tsc` resolves from the main checkout's `node_modules` above it.

Design committed as 42b7411 (`design-doc/01-design-classifying-the-optimizer-s-edits-as-local-structural-or-other.md`), with probe 01 (`scripts/01-probe-edit-kinds.mjs`: edit kinds per pass and the cost of one lowering plus seeded run per revision) started in the background.

## Step 2: classifier, tool, test (2ff1979)

Wrote `src/typed/edit-classes.ts` (rules D1 to D5 of the design, windows, shapes, `rederive` with the passes' own `firstMatch` on plain trees, the fact-guarded catalog, statement weights from `covers` and seeded runs, `classifyRevisions`, `tally`), `tools/edit-classes.mjs` (`census` plus the printed tables) and `tests/typed/edit-classes.test.mjs`. One small change outside the new files: `src/typed/analyses.ts` now exports its `IMPURE` operator set, so the classifier's purity guard on plain trees uses the same set as `isPure` instead of a copy.

Two amendments to the design found while writing the code:

- A `replace` record whose `from` is a value made by an earlier record of the same application (or whose `to` a later record replaced again) cannot be read as one tree pair; it is classified other/coupled under D3a, as part of a multi-record change.
- `cites` is a field of every row: the rules the record itself names. It is always absent today.

`node --test tests/typed/edit-classes.test.mjs`: 5 of 5 pass (9.7 s).

Failure, recorded: probe 01 never ran. The command line ended in `tee ttmp/2026/11/27/IRWB-035-F*/scripts/../various/...`, and zsh aborts the whole command when a glob matches nothing (`no matches found`), which it did because the path through `scripts/..` was globbed before `various/` existed in that form. The background task's output was only that error; the wait I attached to it watched nothing. The corpus tool now measures the same thing, so the probe is rerun afterwards only for its edit-kind table.

The corpus run (`node tools/edit-classes.mjs --json various/02-edit-classes-corpus.json`) started at 10:16; at 10:27 it had used 3.5 min of CPU at about 33 % of a core, with 2.6 GB resident: the machine is shared with other agents' test runs.

## Step 3: first corpus run, two fixes, rerun

The first full run (`various/02-edit-classes-corpus.{txt,json}`, 804 s wall) classified 11,757 edits (O2 2,021, speed 9,736), with no gate rejection and no project skipped. Its checks held: all 545 fold/simplify `replace` edits re-derived by their verified table (IRWB-008's result, re-measured on O2 and speed), and no new statement was left without an edit to weigh it (unattributed weight 0 for every pass).

Two findings led to changes (commit after 2ff1979):

- Two `strength` edits in chess-search (speed) fell to other/unmatched-value with shape `rem(div(a, #), #) → and(shr(a, #), #)`: strength rewrites `(x / 2^j) % 2^k` in one tree, so the window is the whole nested pair, and the catalog matched only its root. `factShape` now matches a shape whose operand is itself rewritten by a catalog shape and returns the shapes outermost first (`['rem-pow2', 'div-pow2']`); the test covers it, including the case without a cited range fact.
- The tool now prints the record kinds inside each sub-class and, per pipeline, what keeps changed functions from being all local. The record kinds showed what the per-record shares are sensitive to: a block merge writes one `move` per statement, so speed's control-flow class is 1,148 moves and 1,259 `unreachable` records.

Analysis 05 (`scripts/05-units-and-applications.mjs`, on the JSON only) measures that sensitivity: counting each structural change once per application, function and sub-class, O2's local share is 40.6 % of 559 units instead of 17.0 % of 2,021 records. It also counts pass applications by the classes of their edits: 58 of O2's 199 published applications (29.1 %) consist only of verified local rewrites.

The rerun with the fixes writes `various/03-edit-classes-corpus.{txt,json,log}`; the required test suites run alongside it (`various/04-tests.log`).

## Step 4: final run, tests, report

The rerun (`various/03-edit-classes-corpus.{txt,json,log}`) took 23.7 min of wall time, using 267 s of CPU at 19 % of a core while the test suites ran beside it. Its results match the first run, except for the two chess-search strength edits, which are now local/fact-guarded (`rem-pow2` over `div-pow2`). The O2 per-project table is byte-identical to run 02's.

Required suites: `node --test tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs` reported 415 tests, 412 passed, 0 failed, 3 skipped, in 16.4 min (`various/04-tests.log`). `tools/build-site.mjs` was not run, because nothing under `src/framework/` or `src/workbench/` changed.

One mistake was caught while writing the report. The shape ranking counts windows, not edits: one constprop edit can rewrite several reads. The first draft quoted the coverage `const-read` would reach as 97.7 % and 97.0 %, computed from window counts (153 and 284). In edits the figures are 141 and 258, so the coverage is 94.2 % (O2) and 93.1 % (speed). The report now gives the edit-based figures and explains the difference.

Report: `report/01-report-the-share-of-local-rewrites-in-o2-and-speed.md`.
