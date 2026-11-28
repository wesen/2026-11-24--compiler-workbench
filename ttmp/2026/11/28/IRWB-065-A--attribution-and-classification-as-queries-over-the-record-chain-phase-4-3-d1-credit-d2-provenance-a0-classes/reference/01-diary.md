# Diary — IRWB-065-A: attribution and classification as queries (phase 4.3)

## Step 1 — the ticket, the brief, the reading

**Prompt Context.** Ticket IRWB-065-A, "a framework concept applied to Typed, with a fixed check". The task (quoted from the brief):

> Your task: attribution and classification as queries (phase 4, item 4.3). Read the R3 synthesis migration step "Attribution and classification as queries" and section K2 · Derivation. … Three tools explain what the optimizer did by re-deriving it from IR trees, instead of reading the records the passes now write: D1's instruction attribution (`src/typed/attribute.ts`, `attributeSteps`), D2's provenance tool (`src/typed/missed.ts`, `hotShapes`), A0's edit classifier (`src/typed/edit-classes.ts`: `classifyApplication`, `rederive`, `sameTree`). … 1. Attribution as a query … Check: the D1 tables reproduce exactly (run its script before and after). 2. Classification as a query: both A0 policies as queries over the same records, with no class field. Settle 203 against 395 … 3. One matcher: `edit-classes.ts` still carries a copy of the rule matcher; move it onto `src/stdlib/term` … 4. Delete what the queries replace (re-derivation code), and say what remains and why.

**What I did.** Read the intern guide (IRWB-064's design doc), the R3 synthesis migration step and K2 panel, then the four files in scope plus their producers and consumers: `tx.ts` (how `Edit.steps` and the derivation steps are written), `passes.ts` (`published`, `revisionCorrespondence`, every pass body), `derivation.ts` (`locality`, `stepEntries`), `correspondence.ts` (`makeCorrespondence` fill, `composeCorrespondence`, `traceEntity`, `whyEntity`), `image.ts`/`compile.ts` (`coverEntries`, `lowerToImage` returning the blocks→image correspondence), and the tests (`derivations`, `edit-classes`, `attribute`, `missed`, `rules`). Created this ticket with docmgr.

**Why.** The brief's check is exact reproduction of today's D1 output, so every equivalence I rely on (origin-based join ↔ correspondence entries; origin note/because ↔ entry note/because; A0's locals walk ↔ the locality query over cited steps) has to be understood before the rewrite, then verified by differential probes.

**What I learned.**
- Every Typed pass except `inline` runs a derived `Tx`: each edit record cites derivation steps (`Edit.steps`), and each step carries `by` (rule or decision), site, premises, note. `inline` builds its own correspondence (`makeInline(revisionCorrespondence)`) and writes no derivation — so D1's query must read the *correspondence* (which the runner computes from the derivation for every other pass), not the derivation alone.
- `makeCorrespondence` fills identity (`retained`) entries, so the join D1 does via `origin[0].from` is answerable from the recorded correspondence: an entity of the revision after that the source also has joins itself; a new one joins the antecedent of its entry, when that is a site.
- `select.ts` builds each instruction's `covers` as `[value, stmt]` — at most one statement per instruction — so "the first cover that is a statement" is order-independent and derivable from the lowering correspondence.
- `published` (passes.ts) drops steps whose products left the output, re-indexing `Edit.steps`; rule chains keep their intermediate steps because a later step consumes them.

**What was tricky.** The guide proposes naming D1's decisions from the derivation steps the edits cite; but the printed decision labels (`cfg: retarget`, `licm: insert (hoisted out of loop:…)`) are built from edit *kinds*, which no derivation step records. Exact reproduction therefore pins the label format to the edit records; what the query replaces is the *join* (origin walk) and the *reasons* (origin note/because → correspondence entry note/because, which are the derivation's own words).

**What warrants a second pair of eyes.** My reading that "the D1 tables reproduce exactly" refers to today's tool output (the guide says the report's tables predate four passes that joined `speed`).

**Code review instructions.** Nothing changed yet; review the plan in the design note (next step) against the brief's four items.

## Step 2 — the design note, and the before-state captured

**What I did.** Wrote the design note (`design-doc/01-...md`): one framework query module (`src/framework/ir/attribution.ts`) with a credit query (D1) and a provenance query (D2); classification (A0) as queries over the cited derivation steps with `locality`; `rederive` kept as an audit with its template instantiation moved onto `src/stdlib/term`. Captured the before-state with three probes: `scripts/01-attribution-tables.sh` (D1's two tables, byte-for-byte as IRWB-034-G's script builds them), `scripts/02-missed-benchmarks.sh` (D2 on the three programs IRWB-037-G ran it on), and `scripts/03-a0-counts.mjs` (A0's counts both ways).

**What worked.** The A0 counts reproduced the guide's story exactly (`various/03-a0-counts-before.txt`): G's `classifyApplication` 395, the scoped query 203, the in-place query 393, and the only two disagreements are the two `fold` records the guide names.

**What didn't work.** `03-a0-counts.mjs` first failed with `ERR_MODULE_NOT_FOUND`: I wrote the `tools/` imports three levels up instead of six (the ticket's `scripts/` is `ttmp/2026/11/28/<ticket>/scripts/`). Fixed by counting the directory levels; same fix for the `dist/` imports.

**Why.** The reproduction checks need a reference produced by the *old* code; capturing it before any change is the only way to get one.

**What I learned.** `scripts/04-the-two-fold-records.mjs` shows the two records exactly as the guide predicted: `constants edit:r3.0` cites [fold-shl (makes `v:poly.30`), rebuild, fold-add (premises `["v:poly.30","v:poly.4"]`)] — the premise is the same application's own rule-chain intermediate. A0's header ("B reads no local this application created…"; chains classified by net change) makes these local; the count A0 meant is 395.

**Code review instructions.** Read the design note against the brief's four items; check the two record listings in `various/04-the-two-fold-records.txt`.

## Step 3 — the framework query module

**What I did.** New `src/framework/ir/attribution.ts`, next to `derivation.ts`: `creditLink(link, before, after)` — joins the two revisions' sites through the link's correspondence (a site both have joins itself; a new site joins the single-source entry that produced it, when that source is a site; anything else stands alone), distributes the two weight maps over the groups, aggregates the naming records (`{key, note, because, entities}`) that name each group's sites; and `provenanceLabels(chain)` — for each entity of the last revision, the pass of the link that last changed it: an entry that maps an entity to itself means it survived the link (also when the entry maps it to siblings — the inline-copy case), anything else means that link's pass made it.

**Why.** Both questions are about the record chain alone; the domain adapters should only supply weights, site-ness, and its records' translation. The join rule is the correspondence-entry reading of what `groupOf` computed from `origin[0].from` (`tests/typed/derivations.test.mjs` already checks the derivation-computed correspondence equals the origin-based one on every O2 revision).

**What was tricky.** `provenanceLabels`' two-step entry lookup (`from.includes(current)` first, then any entry with that target): a merged entry `[a]→[b]` and the retained `[b]→[b]` can both name `b`, and the entity's own survival must win, or a statement that merely *spawned* copies would look rewritten.

**What warrants a second pair of eyes.** The naming records' `key` is Typed's edit kind; the module is domain-independent only in that the domain translates. An alternative was passing the derivation's `byText` instead — rejected because the printed decision labels are pinned by the reproduction check to edit kinds (no step records a kind).

## Step 4 — D1 as a query; the first reproduction run and the entry-aggregation defect

**What I did.** Rewrote `src/typed/attribute.ts` as an adapter: `measureSites` pushes emulator counts onto statements through the lowering correspondence's `covered-by` entries (an instruction implements at most one statement, `select.ts` builds `[value, stmt]`, so "first cover that is a statement" is order-independent); `stepRows` becomes `creditLink` plus formatting. `AttributedRevision` gains the recorded `correspondence` (and `derivation`). Ran the D1 tables.

**What didn't work (a failure and its fix).** First run: the two tables differed in exactly two rows — `licm: insert (hoisted out of loop:…)` gained `s:runVm.143`/`s:runVm.144` in `because`. Cause: I had taken the new site's note and reasons from the *correspondence entry*; but `stepEntries` groups by antecedent, and the entry that maps the hoisted statement's antecedent also maps the sibling `get` the pass made (its premises name the hoisted statement), so the entry's `because` is all of the group's. Fix: the query now reads the reasons of a new site from the *derivation step that produced it* (`link.derivation`), which is per-entity and matches the origin's note/because exactly; a link with no derivation (Typed: `inline`) falls back to the entry.

**What worked.** After the fix: `attribution-before-{fib,checksum}.txt` and `-after-` are byte-identical.

**What I learned.** The reproduction check is sharp: it caught an aggregation difference of one extra `because` string in two rows out of ~90.

**What warrants a second pair of eyes.** The entry fallback for underived links can aggregate notes when a naming record names a new site — see step 7 for why the corpus never hits it.

**Code review instructions.** Diff `src/typed/attribute.ts` against HEAD; the only behavior-bearing changes are `measureSites`' site lookup and `stepRows`' delegation.

## Step 5 — D2's provenance as a query; the audit's first catch

**What I did.** `src/typed/missed.ts`: `hotShapes` gains a `chain` option; the per-statement provenance label — the walk over `origin.via` of the statement and every value under it — is now `provenanceLabels` over the chain (`'ingest'` for entities no link changed). `tools/missed.mjs` passes `p.revisions`. The three D2 benchmark outputs (`various/06-missed-*-after.txt`) are byte-identical to `-before-`.

Then the audit test (in `tests/typed/derivations.test.mjs`, reusing its O2 corpus): `rederive` on each rule-licensed chain's net trees against the rules the cited steps name.

**What didn't work (a failure and its fix).** The audit failed on `call-chain r1 v:f.10 -> v:13`: the steps cite `mul-pow2` twice, the tables fire it once. Cause: one rule *firing* makes several derivation steps — `mul-pow2` on `x * 2` makes the constant and the shift, one step each, all under `withRule`. My `fired` list counted steps, so every multi-entity firing was double-counted (the old `rederive` counts firings). Fix: `firedRules(steps)` reconstructs firings as maximal runs of rule steps sharing the same site (`consumes`, the matched tree): all entities of one firing are made at one site, and a later firing — even of the same rule at another node — reads another.

**What I learned.** The derivation's unit (a made entity) is finer than the rule engine's unit (a firing); the query has to say which it counts, or the audit is meaningless.

**Code review instructions.** `tests/framework/attribution.test.mjs` (synthetic chains), the `provenanceLabels` walk, and `firedRules`' run rule.

## Step 6 — A0 as queries; 395 settled

**What I did.** `src/framework/ir/derivation.ts` gains `inPlaceInput(derivation, sourceEntities)`: the input revision's entities plus what the application's own rewrite chains only remade — products of `rebuild` steps and of *rule* steps — but not locals it created, statements it inserted, or values it made outside a rule chain. `tests/typed/derivations.test.mjs` now asserts **395** for in-place (fold 43, not 41) with the justification written in the test. `src/typed/edit-classes.ts`: `classifyApplication`'s replace branch reads the class off the cited steps (`locality`, in-place) and the sub-class off the steps (`rule` / non-guard premise → `fact` / `uncited`); the `placed`-locals walk and `reads` are deleted; a replace citing no steps (an application without a derivation) is `other/unrecorded`. The private `instantiate` is deleted: `normalize` builds through `stdlib/term`'s `instantiate` with a `Build` over plain trees (the 060-B move, written against `terms.ts`'s API).

**What worked.** `tests/typed/edit-classes.test.mjs` passes unchanged in its expectations (BY_PASS per-pass classes on six projects under `speed`), which is the strongest statement that the query and the old tree walk agree on every class the tests pin; a new test pins the no-derivation case.

**Why the input set takes rule products only.** A premise that is a `licm`-hoisted value or an inserted statement is something the application *placed into the program* (structural, as its premises cite the inserted statement); a rule chain's intermediate is part of the chain's net change, which is what A0 classifies. Empirically the two readings differ only on the two `fold` records (probe 03 before/after).

**What warrants a second pair of eyes.** Whether `inPlaceInput` belongs in `derivation.ts` (my call: it is the in-place policy's other half, next to `locality`, which IRWB-056-B put there) — the brief's scope names "a query module next to derivation.ts", and lane 4.7's brief forbids *that* lane from touching `derivation.ts`, which reads as this lane's to edit.

## Step 7 — the differential probe: old against new, on the whole corpus

**What I did.** `scripts/06-differential.mjs`: `git archive HEAD src`, esbuild-bundle the *old* `attribute.ts`, `missed.ts`, `edit-classes.ts` (one bundle, so the old emulator's vendor slot is shared), and run both tools on the same revisions of every corpus program: D1 (attribution JSON), D2 (hotShapes JSON), A0 (classification JSON), per application.

**What didn't work (three failures and their fixes).** (1) `esbuild` resolved to `lib/main.js`, which is the API, not the CLI — empty output; fixed by resolving `esbuild/package.json` and using `bin/esbuild`. (2) The old bundle's emulator needs the vendored RV32 interpreter in *its* bundled copy of the vendor module — `installVendor()` installs into the new dist's; fixed by exporting `setVendor` from the same bundle and calling it with the same globals. (3) A corpus call overran the 2e4 instruction limit (`hotShapes: window did not finish`); fixed by skipping calls that don't finish for both tools.

**What worked.** **O2: 336 comparisons, 0 differences. speed: 510 comparisons, 0 differences** (`various/06-differential-{O2,speed}.txt`) — D1, D2 and A0 byte-identical between old and new on every corpus program, both pipelines.

**What I learned.** `scripts/07-inline-coverage.mjs`: the `speed` runs contain 16 inline revisions with edits, so the underived link *was* covered — and inline never names a *new site* with its edit records (its `inline`/`remove`/`local` records name the call statement and the local, not the copies), so the entry-aggregation fallback from step 4 is unreachable on the corpus. The `origin` fields inline still writes are its *correspondence source* (`makeInline(revisionCorrespondence)`), not a second account D1 reads.

**What warrants a second pair of eyes.** The probe bundles HEAD — after my commits, "HEAD" will include this ticket; anyone re-running it later must pass the pre-change commit (`git archive <sha> src`).

## Step 8 — the acceptance runs

**What I did.** After `npm run build` (clean) and `npm run check` (clean): the five suites, the baselines oracle, the D1/D2 tables re-run, `tools/build-site.mjs` (framework changed), and Prettier on the files I touched.

**What worked.**
- D1 tables: identical (`attribution-before-*` vs `-after-*`); D2 benchmarks: identical (`06-missed-*-before` vs `-after-`).
- `tests/typed/*.test.mjs`: 202 tests, 200 pass, 0 fail, 2 skipped (pre-existing skips, not introduced here). `tests/framework`: 276 pass. `tests/workbench`: 25 tests, 24 pass, 1 skipped (pre-existing). `tests/stdlib`: 67 pass. `tests/tensor` without `*-gpu`: 63 pass.
- `02-baselines.mjs check`: **no differences**.
- `tools/build-site.mjs`: builds (3,229 KiB app, 50 projects, 17 chapters).

**What didn't work.** `npm run format:check` reports four files I did not touch (`candela-render.ts`, `evaluate.ts`, `ir.ts`, `model.ts`) as unformatted — pre-existing at HEAD, left alone; the five files this ticket changes all pass Prettier.

## Step 9 — the report and the bookkeeping

**What I did.** Re-ran the D1 and D2 scripts on the final code and re-diffed against the before-outputs (identical). Wrote `reference/01-final-report.md` (the file-by-file account, the checks with their numbers, the 203/395 settlement, what remains and why, what was left out), checked the four tasks, and updated the changelog with the five file notes.

**Why.** The brief asks for a report in the ticket; the re-run closes the gap between "outputs captured mid-work" and "outputs of the last commit".

**What I learned.** The two D1 tables and the three D2 outputs are small enough to attach in full; the corpus differential's value is the count and the zero, recorded in the report.

**Code review instructions.** Read the report against the brief's acceptance list; then review `src/framework/ir/attribution.ts` (the queries' contracts are its comments), the diff of the three Typed tools, and the two test changes that carry decisions (395 with its justification in `tests/typed/derivations.test.mjs`; the audit test).
