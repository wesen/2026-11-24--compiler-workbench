---
Title: Diary
Ticket: IRWB-035-G
Status: active
Topics:
    - typed
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:08:30.131734081-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

IRWB-035-G (task A0): measure what share of the edits `O2` and `speed` make on the corpus are local value rewrites, and leave the classifier as a tool with a test.

## Step 1: reading, and the first probe of the edit records

The task (summarized from the brief; the brief file is `various/prompts/typed/a0/claude/IRWB-035-G.md` of the coordinator's ticket): classify every edit of the O2 and `speed` pipelines on the corpus as local rewrite, structural or other; give the shares per pass, pipeline and project by edit count and by affected instructions; give the verified-rule coverage of the local rewrites; make the classifier a callable tool with a test.

I read the contracts and IR READMEs, `define-pass.ts`, `strategies.ts`, `passes.ts`, `tx.ts`, `inline.ts`, `rotate.ts`, `rules/compile.ts`, `rules/form.ts`, and the measurement part of IRWB-008's guide with its census script. IRWB-008 already counted edits per pass and re-derived every `simplify` and `fold` edit; it classed by pass name, did not cover `speed` (inline, rotate), and did not weight by instructions.

### What I did
- `npm ci`, `npm run build` in the worktree (no `node_modules` at the start).
- `docmgr ticket create-ticket --ticket IRWB-035-G`, a design doc and this diary.
- `scripts/01-probe-edit-records.mjs`: both pipelines on all 50 projects, per (pipeline, pass, kind) the fields of the records and whether `from`/`to`/`stmt` are in the revision before or after. Output: `various/01-probe-edit-records.txt`.

### What I learned
- No step was rejected; all 50 projects run under both pipelines. The run took 585 s (load average about 30 on the shared machine).
- Edit records have no rule name. `because` of a `replace` record is empty except for `licm`; the reasons are in the origins of the made values.
- 3 of 1,138 `replace` records under `speed` have a `from` that is in neither revision: chains on one statement field (`lvn` 2, `licm` 1).
- `toNative` keeps only live entities, so intermediate trees are gone.
- Image instructions carry `covers` (a value and its statement), which gives an instruction count per entity.

### Decisions
- Classify from the records and the two revisions, not from the pass name. A (pass, kind) table is simpler but says nothing for user passes and cannot find edits that match a rule without coming from a table; the test uses that table as a cross-check.
- A `replace` is local when its new tree reads only locals the input revision defines. That puts `constprop`, `strength` and the `replace` of `subst` in the local class with the reason `fact`, and `licm`/`lvn` replacements in structural. Tables give the local share with and without `fact`.
- Re-derivation reuses `firstMatch` and `numOf` of `rules/compile.ts` over plain trees instead of a second matcher.

### Commit
`4a4cacc` design and probe.

## Step 2: the classifier, its test, the corpus script

`src/typed/edit-classes.ts` (`classifyApplication`, `instructionWeights`, `rederive`, `normalize`, `tallyInto`), `tests/typed/edit-classes.test.mjs` (4 tests), `scripts/02-classify-corpus.mjs` (one JSON row per edit) and `scripts/03-tables.mjs` (tables from the JSON).

### What failed or changed
- `tsc`: `'e.stmt' is of type 'unknown'` in an `in` expression; cast.
- The first shape function descended only while exactly one operand differed, so a `strength` edit that rewrote a `div` and a `rem` in one tree printed as `add(_,_) -> add(_,_)`. It now collects every pair of subtrees where the trees part.
- On five projects every changed value and statement was claimed by an edit, so the attribution rules needed no residual bucket.

### One change outside the new file
`IMPURE` in `src/typed/analyses.ts` is now exported, so the tree guard `pure` uses the operator set of `isPure`.

### Commit
`466d334` classifier, test, corpus script.
