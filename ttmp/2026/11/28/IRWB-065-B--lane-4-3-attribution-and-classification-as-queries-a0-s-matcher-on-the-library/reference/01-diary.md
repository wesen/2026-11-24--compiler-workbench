---
Title: 'Diary: attribution, provenance and classification as queries (lane 4.3, IRWB-065-B)'
Ticket: IRWB-065-B
Status: active
Topics:
    - framework
    - derivation
    - ir
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "One step per significant action: captured before-states, the premises survey that settles 203 against 395, the framework query module, the three adapters, the performance trap, and the acceptance runs."
LastUpdated: 2026-11-28T00:00:00-05:00
WhatFor: "Following what lane 4.3 did and why, in order, with the commands and the failures."
WhenToUse: "When reviewing IRWB-065-B, or when re-running or extending its checks."
---

# Diary

## Step 1 — Prompt context, and reading the guide

### Prompt Context

> Your task: attribution and classification as queries (phase 4, item 4.3). Read the R3 synthesis … migration step
> "Attribution and classification as queries" and section **K2 · Derivation**, after the guide. The D1 tables in
> IRWB-034-G's report predate four passes that have since joined `speed`: capture today's output of its tools before
> you change anything, and reproduce that.
>
> Three tools explain what the optimizer did by re-deriving it from IR trees, instead of reading the records the
> passes now write: D1's instruction attribution (`attributeSteps`), D2's provenance tool (`hotShapes`), A0's edit
> classifier (`classifyApplication`, `rederive`, `sameTree`).
>
> 1. **Attribution as a query** … **Check:** the D1 tables reproduce exactly (run its script before and after).
> 2. **Classification as a query** … Settle 203 against 395 …
> 3. **One matcher:** `edit-classes.ts` still carries a copy of the rule matcher; move it onto `src/stdlib/term`.
> 4. Delete what the queries replace (re-derivation code), and say what remains and why.
>
> [the acceptance list, the read-only coordinator files, the scope list, the commit convention, and "never use
> `git stash`" follow verbatim in the ticket brief; quoted once here]

### What I did

Read the intern guide (`IRWB-064--*/design-doc/01-*.md`, sections 1–3 and 8 read in full), then the three tools:
`src/typed/attribute.ts`, `src/typed/missed.ts`, `src/typed/edit-classes.ts`, and the record modules
`src/framework/ir/derivation.ts`, `correspondence.ts`, `src/typed/tx.ts` (how a `Tx` records steps), `program.ts`
(`Revision`), and `src/stdlib/term/terms.ts` (the matcher to port onto). Created the ticket with `docmgr ticket
create --ticket IRWB-065-B --topics framework,derivation,performance`.

### Why

Lane 4.3 changes three tools' evidence, and the acceptance is exact reproduction of two tables, so the before-state
has to be captured on the unmodified build before anything else.

### What worked

`npm ci` (6 packages), `npm run build` (tsc, ~7 s). The worktree had no `dist/` and no `node_modules/`.

### What didn't work

Nothing yet. Note for later steps: `docmgr ticket create` made the directory, and a `mkdir -p ttmp/…/IRWB-065-B*/{…}`
with `{a,b}` brace expansion created a literal directory named `IRWB-065-B*` (the glob matched two entries). Removed
with `rmdir`; the lesson is to use the full slug.

### What I learned

The records exist and are complete: every Typed `Tx` pass records `Edit.steps` (indices into `Revision.derivation`),
the runner computes the correspondence from the derivation (`correspondenceFromDerivation`), and `lowerToImage`
returns its cross-IR correspondence (`Lowered = { image, correspondence }`). So D1 does not need to read `covers` by
hand.

### What warrants a second pair of eyes

Nothing yet.

### Code review instructions

No code changed in this step.

## Step 2 — The before-state: D1's and D2's tables

### What I did

Wrote `scripts/01-d1-tables.sh` — IRWB-034-G's `04-attribution-tables.sh` with the output directory moved into this
ticket (the coordinator's ticket is read-only, and so is another ticket's `various/`) — and ran it as `before`. Wrote
`scripts/03-d2-tables.sh` — IRWB-037-G's `06-missed-benchmarks.sh` — and ran it as `before`.

```sh
sh scripts/01-d1-tables.sh before   # 1.9 s
sh scripts/03-d2-tables.sh before   # 2 m 4 s
```

`various/d1-before-fib.txt` (151 lines) and `d1-before-checksum.txt` (173 lines) end at r10 with 6,301 and the
decisions table the guide quotes (`+256 subst-mem: replace`, `-48 guards: replaceStmt (always false: …)`,
`-439 cfg: retarget`, …). `various/d2-before-{regex,lz,chess}.txt` are 151/163/167 lines.

### Why

The acceptance for item 1 is that the tables are identical afterwards, and for D2 that its output is unchanged.

### What worked

Both scripts ran on the unmodified build, so the reference is today's tool, not the report's (the report's Fibonacci
run ended at r6 with 6,349 instructions; four passes have joined `speed` since).

### What didn't work

Nothing.

### What I learned

The `speed` pipeline has 18 revisions for regex-nfa under the tool's settings, 10 for bytecode-vm.

### Code review instructions

Read `scripts/01-d1-tables.sh` and `scripts/03-d2-tables.sh`: they are the two acceptance checks, and they write into
`various/`.

## Step 3 — The premises survey: what 203, 393 and 395 are made of

### What I did

Wrote `scripts/02-premises.mjs`: for every O2 `replace` edit that cites steps, classify each premise as a guard, a
domain fact, an entity of the input revision, or an entity this application made (and which step made it).

```text
premise kinds per edit (an edit counts once per kind it cites):
  141  constprop input s
   43  fold      input v
    1  fold      made v by {"rule":"fold-mul","table":"fold"}
    1  fold      made v by {"rule":"fold-shl","table":"fold"}
   83  licm      made s by {"decision":"set"}|{"decision":"insert"}
    7  lvn       input v
   14  lvn       made s by {"decision":"set"}|{"decision":"insert"}
   68  simplify  guard
   67  simplify  input v
   20  strength  fact
   51  subst     input s
```

### Why

The brief asks to settle 203 against 395 and to explain the 393. That needs the evidence: which premises the two
`fold-add` records cite, and what makes `licm` and `lvn` structural.

### What worked

The survey settles it in one table. The two `fold` records that IRWB-056-B read as structural cite a **value** the
application computed (`fold-add` over the product of `fold-shl`: projects `constants` and `orders`). Every premise
that makes `licm` (83) and `lvn` (14) structural is a **statement** the application inserted (`set`/`insert`).

### What didn't work

Nothing.

### What I learned

The distinction A0's header draws is exactly the one that appears here: `local` is about **locals** (a variable and
the statement that sets it), so a statement the application placed is out of bounds and a value it computed is not.
Under that ground the count is 395 (simplify 140, fold 43, strength 20, constprop 141, subst 51).

### What warrants a second pair of eyes

That the ground is "the input revision plus the values this application computed", not "plus anything it made". The
evidence is the premise kinds above; a reviewer should check no `licm`/`lvn` premise is a value (none is).

### Code review instructions

`scripts/02-premises.mjs` re-runs in ~60 s. Read its `--verbose` output for the two `fold-add` records.

## Step 4 — The design note

### What I did

Wrote `design-doc/01-design-note-attribution-provenance-and-classification-as-queries.md` before changing code: the
input domain, six decisions each with the simpler alternative it rejects, the settlement of 203/395, what remains,
and a "Later" list.

### Why

The brief asks for a short design note before the code, and for decision records that name the alternative.

### What worked

Writing the "input domain" section first forced two decisions into the open: pseudo-entities in the weight map
(`frame`, `backend`) and a chain with a gap.

### What didn't work

—

### What I learned

The cheapest correct home for the queries is one new module with two functions, not a class hierarchy: the weight is
given per revision, the chain is given once, and both queries are walks.

### Code review instructions

Compare the design note's section 4 with the code: (a) groups not steps, (b) the correspondence is the join, (c)
identity is carried by an antecedent that is the entity itself, (d) the decision text stays the edit records', (e)
classification reads `Edit.steps`, (f) `rederive` survives as an audit only.

## Step 5 — `src/framework/ir/attribution.ts`, and D1 on it

### What I did

Wrote the query module and rewrote `attributeSteps`' join on it:

- `creditChain(links, weightsAt, { entities })`: for each link, the connected components of its correspondence, each
  group's weight on both sides, the derivation steps that name it (`by`, `premises`), the entries' reasons and
  notes, and the entities of the first revision its weight came from (`sources`, by walking the antecedents back).
- `measureSites` now pushes the emulator's per-instruction counts through the **lowering's correspondence** instead
  of reading `covers` by hand.
- The row's decision text is still the edit records' (`<pass>: <kinds> (<note>)`), because that is what the tables
  print; each row now also carries the derivation's `by`.

Two iterations of diffing against `d1-before-*.txt`:

1. First run: notes missing (`licm: insert` instead of `licm: insert (hoisted out of loop:…)`), the `cfg: remove`
   and `dce: remove` rows gone, `cfg: retarget` groups 46 → 44, `because` empty for `cfg: retarget`.
2. Second run: 2 lines differ per table — the `because` of two `licm: insert` rows had one extra element
   (`s:runVm.143`).

### Why

Item 1: the join and the why must come from the records.

### What worked

The component-based join needs no `origin[0].from` at all: Typed's entries are single-source, so a component is the
same group `groupOf` built. The notes are the entries' notes (`stepEntries` copies the step's note), which is why the
`origin[0].note` walk could go.

### What didn't work

- **Notes:** I kept only `e.note` from the edit records, but the note of an inserted statement is on its step, not on
  the edit. Fixed by reporting the entries' notes in `Credit.notes`.
- **Missing rows:** the rows for a removed statement came out empty because I keyed the "named entities" option by
  the wrong revision: an edit of revision `j` names statements of revision `j - 1` (a `remove`) as well as of `j`.
  Fixed by adding each named statement to the revision it exists in (`namedAt`).
- **`because` column:** the old column is the *edits'* `because` plus, for a statement the pass made, the statement's
  own `because`. The entry's `because` aggregates several steps' premises, so it carries one extra element (the
  statement the hoisted value read). Fixed by reading the premises of the step(s) that **produce** a new statement,
  which is the derivation's own answer to "why does this statement exist".

### What I learned

`stepEntries` aggregates by antecedent, so an entry's `because` is not one entity's reasons; the derivation step is
the finer record, and both are needed depending on the question.

### What was tricky

The two `removed` groups that vanished were not a grouping problem at all but an indexing one (`named[8]` vs
`named[9]`), which the diff showed as "cfg: retarget 46 → 44" — a shape that looks exactly like over-joining.

### What warrants a second pair of eyes

`stepRows`' site text and sort order are reproduced by a global sort (`rev`, then `delta`, then first site); the old
code sorted within a step. They agree on both tables.

### Code review instructions

`diff various/d1-before-fib.txt various/d1-after-fib.txt` (expect no output). Then read `measureSites` (weights via
the correspondence) and the `entities` option in `attributeSteps` (a statement an edit names takes part even with no
weight).

## Step 6 — D2's provenance as a query, and the four rules it took to be exact

### What I did

Wrote `scripts/04-provenance.mjs` to compare, for all 2,714 statements of the three programs D2's tables were made
on, the old label (`origin.via` of the statement and every value under it) with a candidate query, and iterated.

| Candidate | Statements differing (of 2,714) |
|---|---|
| every entry whose `to` names the entity, by the entry's relation | 521 |
| … skipping entries whose `from` holds the entity | 4 |
| … crediting a new entity to its **link's label** | 0 |

The 521 were `inline` and `rotate` self-mappings: both passes map unchanged entities with their own label, and the
correspondence records survival, not change (`derivation.ts`'s header says so). The 4 were `inserted` entries, whose
relation is not a pass name — the link's label is.

Then `hotShapes`' `provenanceOf` was replaced by `changedBy`, and `tools/missed.mjs` passes the chain. `hotShapes`
now refuses a head revision above r0 without a chain, so no caller can silently get `ingest` for everything.

### Why

Item 1's second half ("D2's provenance where it re-derives"), and the acceptance "D2's hot-shape output unchanged".

### What worked

`scripts/04-provenance.mjs` ends at `2714 statements, 0 differ` in 26 s — a much cheaper check than the 8-minute
table run.

### What didn't work

My first `changedBy` **followed the antecedent** of a new entity and collected its lineage's labels, which is a
different question: it gave `rotate+simplify` where `origin.via` gives `rotate`, because the value `rotate` made was
made from a value `simplify` had made. The tables' first `after` run showed that as ~30 changed lines. The fix is the
rule now in the module's header: the walk stops at the link that made the entity, because "which passes touched this
code" is about the code present now, not about every pass that ever made an ancestor.

### What I learned

The old label's exact semantics is "the pass that made each entity now present, union over the statement's subtree,
or `ingest` when none". A query reproduces it once identity-carrying entries are read as survival.

### What was tricky

That `rotate` and `inline` write a relation for entities they did *not* change is invisible in the correspondence
unless one asks whether an entry maps an entity to itself.

### What warrants a second pair of eyes

`changedBy`'s stop rule, and the `hotShapes` guard for a chainless head above r0.

### Code review instructions

`node scripts/04-provenance.mjs` (expect 0 differ), then `sh scripts/03-d2-tables.sh after` and `cmp` the three
files against `various/d2-before-*.txt`.

## Step 7 — The performance trap: a query per site, on an unprepared chain

### What I did

Nothing yet — this step records a failure. After `changedBy` became a plain function, `scripts/04-provenance.mjs`
timed out after 900 s (it had taken 40 s), and the D2 table run took 8 m 35 s and produced wrong labels.

### Why

`hotShapes` asks for one site's provenance per statement, and each call indexed the whole chain again: O(statements ×
chain × entries).

### What worked

Restructuring the module into a prepared query — `recordChain(links)` returning `{ credit, changedBy }`, with the
union-find and the carried sets built once and the label walk memoized per (entity, revision) — brings the probe to
26 s and the tables back to the old cost.

### What I learned

A query over records is only usable if the indexing is amortized: the library's own `traceEntity`/`whyEntity` take a
chain per call and are linear in it, which is fine for one question and wrong for one question per site.

### What didn't work

The first version of the prepared query kept the old per-statement recursion in `hotShapes`, which is what the timeout
was.

### Code review instructions

`recordChain`'s memo is keyed by `${revision}:${entity}` and shared across calls: check it cannot be poisoned by a
different set of `entities` (it cannot — the answer depends only on the entity and the revision).

## Step 8 — Classification as a query, and settling 395

### What I did

- `Application` gained `derivation` and `correspondence`; `classifyApplication` classifies a `replace` by the steps
  its edit cites: all `local` under the in-place policy → `local`, else `structural/motion`; `local/rule` when a cited
  step names a rule (table, rules and weakest evidence from the steps and the rule listing); `local/fact` when a cited
  step names a non-guard premise; `local/uncited` otherwise. An application that recorded no steps (`inline`) and is
  not caught by the inline check answers `other/unrecorded`.
- `localityGround(before, after, source?, made?)`: the input revision's entities **plus the values this application
  made** (including a tree an earlier step computed and a later step folded away, which is in neither revision, hence
  the `made` list from the steps).
- `sameTree` is the library's `structuralEqual` over a tree signature; `normalize`'s template instantiation is the
  library's `instantiate` with a `Build` over `Tree`; the file's own handle/instantiate copy is gone. `rederive` and
  `normalize` stay as the **audit** `tests/typed/rules.test.mjs` uses, declared as such in the header.
- Deleted the `placed`/`reads` check — the tree-level test for "B reads a local this application placed", which is
  what the query now answers — and the `origin` walk for the `because` of a made value.

### Why

Items 2, 3 and 4.

### What worked

`scripts/09-o2-classify.mjs` over the whole O2 corpus: **395 local** (constprop 141, simplify 140, subst 51, fold 43,
strength 20), 1,774 edit records, 50 projects — A0's number, and the same 395 the step-level query gives.

### What didn't work

The first run gave 393: my ground added the values **present in the after revision** that the input did not have, but
the two `fold-add` premises name `v:poly.30`, which the same application had already folded away, so it is in neither
revision. Fixed by taking the `produces` of the application's own steps.

Both existing edit-classes tests failed first with `other/unrecorded`, because the test built `Application` without
the revision's records. That is the intended behaviour (no records, no claim), and the tests now pass the records.

### What I learned

The classifier and the step-level query must share one ground, or the two numbers drift. `tests/typed/
derivations.test.mjs` now imports `localityGround` instead of building its own set.

### What was tricky

The `because`/`shape` text for `local/fact` now comes from the steps' premises instead of the values' `origin
.because`; the shapes still match, and `local/uncited`'s exact string (`div(get,#) -> shr(get,#)`) is unchanged.

### What warrants a second pair of eyes

`other/unrecorded` is a new `sub` value. It is reached only by an application that recorded no steps and did not
inline; the corpus has none, so it is a guard, not a class in the tally.

### Code review instructions

`node scripts/09-o2-classify.mjs` (expect `395 local`, fold 43). `node --test tests/typed/edit-classes.test.mjs
tests/typed/derivations.test.mjs tests/typed/rules.test.mjs`.

## Step 9 — The framework test, and a hole it showed in the step matching

### What I did

Wrote `tests/framework/attribution.test.mjs` on a synthetic two-link chain (six tests: components, weight
distribution and `sources`, `frame`-style ids, caller-named entities without weight, `changedBy` with
self-mappings, a chain gap refused). Then `tests/typed/attribute.test.mjs`'s new test, asserting that the
`simplify` row of `first-steps` under O1 names `simplify/mul-pow2`.

### Why

Item 1's "the D1 tables reproduce" is a table check; the tests need to say what the rows now *are*.

### What didn't work

The new D1 test failed: `by` was `[]` for the `simplify` row. `creditChain` attaches a step to the group whose
entities it names, and the group is the **statement** while `mul-pow2`'s steps name **values** under it. The
licm rows had worked because licm's steps name statements.

### What worked

The edit record is what ties them: an edit names the statement and cites the steps (`Edit.steps`). The adapter
now unions the query's `by` with the cited steps of the edits that name the group — the guide's own proposal
("the decision name from the derivation steps those entries' edits cite").

### What I learned

A step's site is a value tree, a weight's site is a statement; only a record that names both can join them, and
that record is the edit.

### What warrants a second pair of eyes

Two sources for `AttributionRow.by` (the query's entity match and the edits' citations). They answer the same
question at different granularity; a reviewer should check the union reads as one answer, not as two.

## Step 10 — The suites, the baselines, the site

### What I did

```sh
npm run build && npm run check
node --test tests/typed/*.test.mjs        # 201 pass, 0 fail
node --test tests/framework/*.test.mjs    # 279 pass, 0 fail
node --test tests/workbench/*.test.mjs    # 24 pass, 0 fail
node --test tests/stdlib/*.test.mjs       # 67 pass, 0 fail
node --test $(ls tests/tensor/*.test.mjs | grep -v gpu)   # 63 pass, 0 fail
node ttmp/2026/11/27/IRWB-039--*/scripts/02-baselines.mjs check   # no differences
node tools/build-site.mjs                 # dist/site built, 50 projects
```

Re-ran both table scripts on the final code: all five files identical to their `before` versions.

### Why

The acceptance list.

### What worked

Everything, first time at this commit. Two existing tests needed the records passed to `classifyApplication`
(`tests/typed/edit-classes.test.mjs`) and the chain passed to `hotShapes` (`tests/typed/missed.test.mjs`) —
both are the intended interface change, and both are updated in place.

### What didn't work

`npm run format:check` still lists six files (`framework/core/data.ts`, `framework/ir/store.ts`,
`typed/{candela-render,evaluate,ir,model}.ts`): they were unformatted before this ticket. The four files this
ticket changed pass.

### What I learned

The four tests that had to change (`edit-classes`, `missed`, `derivations`, `attribute`) are exactly the ones
that call the changed interfaces; nothing else in the suites noticed, which is good evidence that the tools
are leaf tools.

### Code review instructions

`various/acceptance.txt` has the transcript. The two table scripts are the checks to re-run after a rebase.

## Step 11 — Deleting what the queries replace, and the report

### What I did

Deleted the last dead pieces of the old classifier (`reads`, `treeBound`), rewrote the file header to describe
the query and to say what `rederive` is for now (the audit), updated the design note's API section to the
prepared query, and wrote `reference/02-report-*.md` with the file-by-file change, the acceptance table, what
remains and why, and what I left out.

### Why

Item 4, and the brief's "end with a report".

### What worked

`wc -l`: `attribute.ts` 263 (was 236), `missed.ts` 256 (was 236), `edit-classes.ts` 567 (was 518, of which
`localityGround`, `ruleMatch` and the doc are new; the matcher copy and the `placed`/`reads` test are gone),
`attribution.ts` 375 new.

### What didn't work

—

### What I learned

The new code is larger than what it replaced, and the report says why: the query is generic (chain validation,
union-find, backward traces, provenance) and the adapters kept their interfaces. The deleted parts were three
variant readers of one fact.

### What warrants a second pair of eyes

The scope question in the report: `src/framework/ir/index.ts` (lane 4.7's file) does not export the new module
yet, and `derivation.ts`'s doc for `locality`'s `input` still describes the narrower ground.
