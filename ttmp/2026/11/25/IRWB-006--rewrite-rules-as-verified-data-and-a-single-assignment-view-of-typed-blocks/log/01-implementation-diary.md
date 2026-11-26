---
Title: Implementation diary
Ticket: IRWB-006
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological, step-numbered investigation diary of IRWB-006: simplify (and fold) as rule tables with identical revisions, a rule verifier with recorded evidence, and an SSA view of typed.blocks validated against reaching definitions, with SCCP as its first consumer."
LastUpdated: 2026-11-25T23:30:00-05:00
WhatFor: "Resume point and evidence trail for IRWB-006 (items B1, B2, A1 and a first A2 experiment)."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Implementation diary

Steps are chronological, oldest first. Every number in a step is a measurement from the command shown in it. Scripts are in `../scripts/`, measurements in `../various/`.

## Step 1: Set up the worktree and record the frozen baseline

The milestone starts from commit `420d8e1` on a fresh worktree branch. Before reading or changing anything, the worktree must build, and the fingerprint of the compiler's output that every later change is compared against must be recorded: each corpus project's r0 revision, each O2 revision, and the O2 image's revision. This step does both. The build works after linking the main checkout's `node_modules` into the worktree; the baseline has 44 lines, one per project.

### Prompt Context
**User prompt (verbatim):** "ask subagents to always commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). When a milestone is finished, write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). [...] For each, create a ticket and design doc (if you don't have already) Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Then implement"
(This is the user's request as relayed verbatim in the coordinator's brief for IRWB-006. The brief itself, from the coordinating agent, assigns items B1, B2 and A1 of the IRWB-002 agenda, the frozen gates, the code-placement rules and the acceptance measurements.)
**Assistant interpretation:** Own milestone IRWB-006: write an intern guide for it, upload it, then implement rules as verified data and an SSA view, keeping O2 and the book's numbers bit-identical; diary every significant action; finish with a vault report.
**Inferred user intent:** Move the compiler from hand-written rewrites and per-query analyses toward rules that can be listed and verified once, and a sparse representation that later items (SCCP, GVN, rule discovery, exact checking) can build on, without disturbing the parity that makes the port trustworthy.
**Commit (code):** none in this step.

### What I did
- `ln -s /home/manuel/code/wesen/2026-11-24--compiler-workbench/node_modules node_modules` in the worktree root. The root `.gitignore` has `/node_modules` (no trailing slash), so the symlink is ignored; `git status --short` printed nothing afterwards.
- `npm run build` (tsc): 2.9 s wall, no errors.
- `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs > various/01-baseline-corpus-revisions.txt`: 10.3 s wall, 44 lines. `sha256sum` of the file: `7f6c45598945a9c5d0275230593ab078baa01133a3b3ec1d21c4ab387d55537f`.
- Created this diary and the design doc with `docmgr doc add --ticket IRWB-006 --doc-type log|design-doc`, and fifteen tasks with `docmgr task add`.

### Why
- Every later change to a shared pass must be diffed against an output recorded before any change, on the same machine and commit. Recording it first removes any doubt about what "identical" is compared with.

### What worked
- The build and the baseline. The first three lines of the baseline:
  ```text
  across-calls 811ef589b3da 811ef589b3da,91e24eda152a,d267fe99f315 139d2bc722fc
  algebra 228a7e23e69f 228a7e23e69f,15815efe71b5,032a7376ff87,0410a2f6970a,6ec2a617c3c3,a8b378ce7135,a7eb3b0f13e3 24d26910699d
  blend 2a3b3eb1f8a7 2a3b3eb1f8a7,fad91c0fd44e,8c5226a95809,e55271c4fec9,1997637b6c94,a470579cf9ca,707852c20def 87f1da0e9ba7
  ```

### What didn't work
- A first inspection command that chained `mkdir`, `cd` and a heredoc into the scratchpad was refused by the worktree isolation check ("this command is too complex to verify that it stays inside the worktree"). Scratch scripts are now written with the editor tool and run with a plain `node <path>` from the worktree root.

### What I learned
- The worktree has no `node_modules` and no `dist`; the symlink is the cheapest way to build without a network install.

### What was tricky to build
- Nothing yet.

### What warrants a second pair of eyes
- The symlink must never be committed. `.gitignore`'s `/node_modules` covers it; `node_modules/` alone would not, because a symlink is not a directory to git.

### What should be done in the future
- Diff `08-corpus-revisions.mjs` against this file after every change to a shared pass, and at the end.

### Code review instructions
- `diff <(node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs) ttmp/2026/11/25/IRWB-006--*/various/01-baseline-corpus-revisions.txt` after `npm run build`.

### Technical details
- Each line is `project r0 revs(O2, comma-separated, r0 first) image`, each hash cut to 12 hex digits. A revision hash covers the whole native value, including every origin's `from`, `via`, `rev`, `because` and `note` and the id counters, so equal hashes imply equal `why` trees.

## Step 2: Read the system and decide the shape of the three items

This step reads the IRWB-002 guide (Part 1, items A1, A2, B1, B2, D3, §22) and the code the items touch: `simplify` and `fold` (`src/typed/passes.ts:279–373`), `Tx` (`src/typed/tx.ts`), the analyses (`src/typed/analyses.ts`), the dataflow solver (`src/framework/dataflow/solver.ts`), the framework's pattern language and rewrite engine (`src/framework/ir/patterns.ts`, `rewrites.ts`), and the consumers of `PASSES`, `PIPELINES` and `ANALYSES`. The outcome is a set of design decisions, each forced by something in the code; they go into the guide.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Understand exactly what the hand-written passes do, down to id allocation order, before designing a table that must reproduce them byte for byte.
**Inferred user intent:** A design that can actually meet "identical revisions", not one that is close.
**Commit (code):** none in this step.

### What I did
- Read `simplify` case by case and listed its 16 return sites with their exact provenance: which return an existing operand id (no new entity), which call `tx.const`/`tx.make` with `note(text)` (`because` = the constant operands, in order), and which pass only `{ note }` (the eight comparison inversions).
- Read `Tx.rewrite` (`tx.ts:431`): bottom-up rebuild, the visitor sees the rebuilt node, `this.cur` is the origin `from` of anything made inside the visitor, ids come from `st.fresh('v:<fn>')`, whose counters are stored in the artifact.
- Ran a scratch script (`O2` on Blend, printing fold, simplify and constprop edits). Blend's only `simplify` edit at r3 is `s:blend.4  if !((i < n)) ...` → `if (i >= n) ...` (`edit:r3.0`, `v:blend.8` → `v:blend.35`).
- Grepped consumers: `ANALYSES` is listed by `Program.analyses`, `wb` and asserted to be exactly six names in `tests/workbench/strategies.test.mjs:111`; `PASSES` is iterated by `Program.actions()`, the strategy registry and `tools/audit-preservation.mjs`.
- Read `blocksAdapter` (`ir.ts:505`): it has `rebuild` and `operation`, so the framework matcher can see value trees as `op` nodes.

### Why
- "Identical revisions" is a byte-level requirement. The counters are part of the artifact, so even an id allocated and then dropped would change the hash; the order of allocation inside a replacement (`tx.make('shl', a.id, tx.const(log2(k)), …)` allocates the constant before the shift) must be reproduced.

### What worked
- The decisions below are all forced by code that was read:
  1. **B1 applies rules through `Tx.rewrite`, not through the framework's engine.** The engine (`executeRewrites`) publishes one artifact per application and its edits allocate ids outside the store's counters and write no Typed `origin`; it cannot reproduce today's revisions, and one artifact per application is the 18 s-per-pass projection cost on Candela multiplied by the number of rewrites. The rule *form* is data that can also be converted to the framework's `NodePattern`, so the framework matcher remains usable for listing and cross-checks.
  2. **The rule table is ordered per root operator.** `simplify` is a `switch` on `v.op` with first-match order inside each case; a table indexed by root operator, tried in table order, reproduces it.
  3. **The SSA analysis gets a new name (`typed.ssa`) and stays out of `ANALYSES`.** Adding it would change the six-name list a test asserts and every listing of analyses. Passes that use it compute it on their working copy, as the views do.
  4. **SSA is the Cytron construction** the brief asks for (dominator tree from the existing `dominatorsOf`, dominance frontiers, iterated-frontier phi placement, renaming over the dominator tree), not Braun's, with a virtual entry definition (`param:i`, `init:i`) per local so that the correspondence with reaching definitions is one to one.
  5. **The new pass (SCCP) and its pipeline live in new files** and run through `Program.apply(passObject)`, which accepts a `TypedPass` (`program.ts:230`); registering them in `PASSES`/`PIPELINES` is a separate, optional step (it would change `actions()` and the strategy registry).
- The reaching-definitions solver visits reachable blocks only and joins the boundary at the entry with the entry's predecessors (`solver.ts:115–125`), so SSA over the dominator tree (reachable blocks) with a virtual entry edge describes the same relation.

### What didn't work
- No failures in this step.

### What I learned
- `fold` keeps `rem(MIN, -1)` unfolded although `binop` returns 0 for it: the guard is conservative for `rem`. A verifier must accept a conservative guard and say so.
- The validator types every operand (`ir.ts:158–180`), so an i32 operator never has an f32 constant operand; a pattern that matches "a constant" without a type is equivalent to "an i32 constant" on valid programs.
- `simplify`'s f32 guard (`F32_OPERANDS.has(v.op) || F32_RESULT.has(v.op)`) excludes no operator that any of its cases names; the table is equivalent without it, and keeps it as a declared property of the rule set.

### What was tricky to build
- Nothing built yet; the trap is the provenance detail: `note(text)` puts *all* constant operands in `because` (both when both are constant, which happens in the `loops` pipeline, where `simplify` runs before any `fold`).

### What warrants a second pair of eyes
- Decision 5: whether the coordinator wants `sccp` and its pipeline registered in `PASSES`/`PIPELINES` after the merge with IRWB-003, which adds passes there too.

### What should be done in the future
- Write the guide around these decisions; then implement B1 first, because its equivalence check is the cheapest strong evidence in the milestone.

### Code review instructions
- `src/typed/passes.ts:279–373` (`fold`, `simplify`), `src/typed/tx.ts:431–480` (`Tx.rewrite`), `src/framework/dataflow/solver.ts:110–140` (entry boundary, reachable blocks).

### Technical details
- `simplify`'s return sites, in order: add k=0 → a; add ka=0 → b; sub k=0 → a; sub pure a ≡ b → const 0 ("x - x"); mul k=1 → a; mul ka=1 → b; mul k=0 ∧ pure a → 0 ("x * 0"); mul ka=0 ∧ pure b → 0 ("0 * x"); mul pow2 k → a << log2 k; mul pow2 ka → b << log2 ka; div k=1 → a; or/xor/shl/shr/shru k=0 → a; and k=0 ∧ pure a → 0 ("x & 0"); and k=−1 → a; eqz(cmp) → inverse cmp (8 operators, note only); eqz(eqz(x)) with x a comparison → x.

## Step 3: Write the intern guide, reread it as its reader, upload it

The guide (`design-doc/01-intern-guide-…md`, 867 lines after revision) has five parts: the system as it is (typed.blocks, Tx and its rewrite traversal, provenance, the gates, analyses, the framework rule engine), the rule form and its compiler (B1), the verifier and its methods with their strength (B2), the SSA view (A1) with SCCP as its consumer, and the implementation plan with tests and acceptance. After the first draft I reread it as a newcomer would and checked its factual claims against the code by running a scratch script on Blend; the revision fixed one wrong claim and six gaps. The guide is on the reMarkable.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Deliver the intern guide before implementing, stored in the ticket and uploaded.
**Inferred user intent:** A document a new intern can learn the milestone from and implement against.
**Commit (code):** ab96bd4 — "IRWB-006: intern guide (rules as verified data, SSA view), diary steps 1-3, corpus revision baseline"

### What I did
- Wrote the guide with the design decisions of Step 2, every existing API with its line number at `420d8e1`, proposed APIs marked **Proposed**, ASCII diagrams (CFG and dominator tree of Blend, module dependencies), pseudocode for `Tx.rewrite`, the rule compiler, frontier computation, phi placement, renaming, the SSA/reaching check and SCCP.
- Checked the guide's Blend facts with a scratch script (`ingestProject('blend')`, `cfgOf`, `dominatorsOf`, `reachView`): locals `0:work(p) 1:n(p) 2:a(p) 3:b(p) 4:scale 5:s 6:i 7:t7`; reverse postorder `bb.0 bb.1 bb.3 bb.5 bb.7 bb.4 bb.2`; idom as in the guide's diagram; `reachingAt(s:blend.5, 6) = [s:blend.11, s:blend.2]`. Across all 70 corpus functions at r0: 400 local names, none containing `.`, no duplicates, no unreachable block, no entry block with a predecessor.
- Checked `executeRewrites` (`rewrites.ts:512–530`): each application calls `current.beginEdit(...)` and `edit.prepare()`, i.e. builds a provisional artifact per application.
- Second pass, review notes before revising (comprehension gaps first, then corrections):
  1. Technical correction: §6 printed `reachingAt(s:blend.5, i)` as `[s:blend.2, s:blend.11]`; the code returns `[s:blend.11, s:blend.2]`, and the second argument is a local index, not a name. Fixed, with a note that the result is a set.
  2. Correction: §4 said the `why` tree is a function of "the revision"; `Program.lookup` resolves removed ids through earlier revisions, so it is a function of the chain. Fixed.
  3. Gap: a reader of Part 2 could not see how B1, B2 and A1 relate. Added an orientation paragraph and a diagram at the start of Part 2.
  4. Gap: §10 did not say why the f32 early return of `simplify` can be dropped. Added.
  5. Design correction: §10 put firing counts into the pass's report; that would change the pass's result. Changed to a caller-supplied table.
  6. Gap: §12 decided against the framework engine by argument only. Added the pattern cross-check measurement (`toNodePattern` + `searchPattern` against the compiled matcher).
  7. Gap: §14 did not say how a repeat (`same x`) or a constant variable counts in the effects check. Added.
  8. Gap: §15 gave methods but not which rule gets which. Added the 27-rule assignment table.
  9. Gap: §18 did not say whether the virtual-entry and unreachable cases occur. Added the corpus scan result.
  10. Gap: §24 had no workbench entry point for the rules listing and no picture of the import structure (the cycle risk). Added `wb.rules()` and the dependency diagram.
- `docmgr validate frontmatter --doc …`: "Frontmatter OK". `docmgr doc relate --ticket IRWB-006` with four key files.
- `remarquee upload bundle <guide> --name "IRWB-006 Intern Guide: Rules as Data and SSA" --remote-dir "/ai/2026/11/25/IRWB-006" --toc-depth 2 --non-interactive`: `OK: uploaded IRWB-006 Intern Guide: Rules as Data and SSA.pdf -> /ai/2026/11/25/IRWB-006`. `remarquee cloud ls /ai/2026/11/25/IRWB-006 --long --non-interactive`: `[f]	IRWB-006 Intern Guide: Rules as Data and SSA`.

### Why
- The brief orders guide, upload, then implementation. Writing the design first also forces the id-allocation and provenance details to be stated before code exists, which is where an "almost identical" implementation would fail.

### What worked
- All checked facts matched the code except the set order in item 1.

### What didn't work
- No failures. The upload needed no reauthentication.

### What I learned
- The corpus has no structural edge cases for SSA (unreachable blocks, loops at the entry); the tests will need a synthetic case for the virtual-entry phi.

### What was tricky to build
- Stating the strength of each verification method without overclaiming: exhaustive at 8 bits says nothing about 32 bits by itself (`x * 256 → 0`), so the guide requires width-generic rules and a written argument per rule that uses it.

### What warrants a second pair of eyes
- §15's claim that a degree-one polynomial over ℤ/2³² that vanishes everywhere has zero coefficients (shown by evaluating at 0 and at unit vectors), which the symbolic method's "proof" label depends on.

### What should be done in the future
- If the implementation's SSA names for Blend differ from §20's prediction, record it in the diary; the uploaded guide labels them a prediction.

### Code review instructions
- Read the guide's Part 2 §10 and Part 4 §20 against `src/typed/tx.ts:431` and `src/typed/analyses.ts:140–187`.

### Technical details
- Uploaded PDF name: `IRWB-006 Intern Guide: Rules as Data and SSA`, folder `/ai/2026/11/25/IRWB-006`.

## Step 4: The rule form, the rule compiler, and both tables; corpus equivalence

This step implements B1's core: the rule form (`src/typed/rules/form.ts`), the compiler from a table to a `Tx.rewrite` visitor (`compile.ts`), the 27-rule `simplify` table (`simplify.ts`), the 40-rule `fold` table (`fold.ts`), a verbatim copy of the two hand-written bodies (`handwritten.ts`), and passes built from each under the original specs (`rules/passes.ts`). `passes.ts` is not touched yet. On the corpus the table passes reproduce the hand-written ones exactly: 1,232 comparisons, 0 differences.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** B1: simplify's identities, and fold's cases if practical, as a listable table whose pass produces identical revisions; keep the hand-written pass until the diffs prove it.
**Inferred user intent:** Rules that are data without any change to what O2 produces.
**Commit (code):** c9f43d6 — "IRWB-006 B1: rule form, rule compiler to a Tx.rewrite visitor, simplify and fold as rule tables; corpus equivalence 1232/1232 identical"

### What I did
- `form.ts`: the `Pat`/`Guard`/`Num`/`Tpl`/`Rule`/`RuleSet` types, builders (`v`, `kv`, `c`, `same`, `op`, `rule`, `ruleSet`), a run-time well-formedness check (`checkRule`: bound-once variables, declared types, guards on bound variables, `pow2`/`noTrap` only on constant variables, the left side a pattern and the right side a template), one-line text (`ruleText`), and `toNodePattern` to the framework's pattern language.
- `compile.ts`: `matchPat`, `guardHolds`, `evalOp` (eqz, `f32Op` for `F32_FOLDABLE`, else `binop`), `instantiate` (children first, provenance on the outermost made value only), `indexRules` (by root operator, table order), `compileRules(rules, firings?)`, `tableBody`.
- `fold.ts` builds one rule per operator: `fold-eqz`, one per `F32_FOLDABLE` operator (arity from `VALUE_SIGNATURES`), one per integer operator of fold's `FOLDABLE` list with `noTrap` on `div` and `rem`.
- `scripts/01-rules-equivalence-corpus.mjs`: for each of the 44 projects and each pipeline containing `simplify` or `fold` (`O1`, `O2`, `O2+`, `loops`, `checks`), run the pipeline with the passes of `passes.ts` under the meaning contract; at each `simplify`/`fold` step apply the table pass and the hand-written copy to the same input and compare revision hash, canonical edit list and canonical correspondence entries. It also counts firings in O2.
- `npx prettier --write "src/typed/rules/*.ts"`; `npm run build`.

### Why
- Comparing at each step against the same input, rather than running two full chains, is equivalent by induction (equal inputs and equal outputs at every step give equal chains) and costs half.
- The edit list and the correspondence are compared besides the hash because the edit `text` is not part of the revision.

### What worked
- `node scripts/01-rules-equivalence-corpus.mjs --json various/02-rules-equivalence-corpus.json --firings various/03-rule-firings-corpus-o2.json`:
  ```text
  {"projects":44,"pipelines":["O1","O2","O2+","loops","checks"],"compared":1232,"stepsThatChanged":210,"differ":0,"ms":61664}
  O2 firings: {"simplify":{"add-zero":4,"mul-one":2,"mul-pow2":15,"mul-zero":2,"not-gt":1,"not-lt":32,"not-ne":1,"sub-self":1,"sub-zero":1},
               "fold":{"fold-add":1,"fold-gt":1,"fold-mul":9,"fold-shl":1,"fold-sub":6}}
  ```
  616 `simplify`/`fold` steps, each compared twice (table, hand-written copy); 210 of them changed the program.

### What didn't work
- First build: `src/typed/rules/simplify.ts(26,24): error TS2345: Argument of type 'Tpl' is not assignable to parameter of type 'OpPat'`, then, with a generic `op<A>`, `Argument of type '{ readonly constVar: string; }' is not assignable to parameter of type '{ readonly var: string; }'` (inference fixed `A` from the first argument). Resolved by giving `op` one signature whose result is assignable to both `OpPat` and `Tpl`, and checking at run time in `checkRule` that the left side is a pattern and the right side a template.

### What I learned
- In O2 over the corpus, 9 of the 27 `simplify` rules fire and 18 never do (`zero-add`, `one-mul`, `zero-mul`, `pow2-mul`, `div-one`, the five zero-right rules, `and-zero`, `and-ones`, `not-ge`, `not-le`, `not-eq`, `not-ltu`, `not-geu`, `not-not`); `not-lt` (32) and `mul-pow2` (15) dominate. Only 5 of the 40 `fold` rules fire.

### What was tricky to build
- Provenance reproduction. `because: 'const-args'` must be the constant operands of the *matched node*, not the constants the pattern names, and only the outermost made value carries `because` and `note`; the inner `log2` constant of `mul-pow2` has neither. `instantiate` passes `{}` to inner values, which `tx.make` pops as its options object (it has no `id`), so the call shapes are identical to the hand-written ones.

### What warrants a second pair of eyes
- The comparison's sensitivity: equal results prove nothing if the check could not see a difference. The rules test (later step) must include a mutated table that the same comparison rejects.

### What should be done in the future
- Candela equivalence (running), then the switch in `passes.ts`.

### Code review instructions
- `src/typed/rules/compile.ts` (`instantiate`, `provenance`), `src/typed/rules/simplify.ts` against `src/typed/passes.ts:307–373`.
- Re-run: `npm run build && node ttmp/2026/11/25/IRWB-006--*/scripts/01-rules-equivalence-corpus.mjs` (about 62 s).

### Technical details
- Rule counts: `simplify` 27 (add 2, sub 2, mul 6, div 1, zero-right 5, and 2, comparison inversions 8, not-not 1); `fold` 40 (eqz 1, f32 20, i32 19), checked with `node -e` over the built tables.

## Step 5: Candela equivalence, then the switch of simplify and fold to the tables

The corpus check of Step 4 is strong but small; Candela is 332 functions with f32 throughout. This step runs O2 on Candela once and, at each of its four `simplify`/`fold` steps, applies the table pass and the hand-written copy to the same input revision. All four steps are identical in revision hash, edit list and correspondence. With every compared revision identical on both workloads, `simplify` and `fold` in `passes.ts` now use the tables; the corpus revisions after the switch equal the baseline line for line.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "Switch simplify to the table only if every revision is identical" (corpus r0→O2 and Candela O2).
**Inferred user intent:** No behaviour change from turning code into data.
**Commit (code):** 711a9a2 — "IRWB-006 B1: simplify and fold use the rule tables (corpus and Candela O2 identical; gates green, revisions = baseline); B2 semantics, verifier and candidate rules"

### What I did
- `scripts/02-rules-equivalence-candela.mjs`: ingest Candela from the tape, then O2 pass by pass with `applyPass` and a single `AnalysisManager`, without the per-pass meaning checks (they do not change a pass's output, and O2 on Candela has no rejected pass); at `fold` and `simplify` steps also apply `tablePass(name, firings)` and `R.*Handwritten` to the same input and compare.
- `node --max-old-space-size=12288 scripts/02-rules-equivalence-candela.mjs --json various/04-rules-equivalence-candela.json` (background, alone on Candela).
- Switch: in `src/typed/passes.ts`, `fold.body = tableBody(FOLD_RULES.rules)` and `simplify.body = tableBody(SIMPLIFY_RULES.rules)`; removed the now-unused `FOLDABLE` set and the `f32Op`, `F32_FOLDABLE`, `SYMBOL` and `binop` imports; added imports of `tableBody`, `FOLD_RULES`, `SIMPLIFY_RULES`. The comments say where the hand-written bodies went (`rules/handwritten.ts`). `isPow2` and `log2` stay: `strength` and `div-to-shift` use them.
- `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs > various/06-corpus-revisions-after-switch.txt; diff various/01-baseline-corpus-revisions.txt various/06-…` → no output (`IDENTICAL`).
- Started `scripts/03-frozen-gates.sh various/07-gates-after-switch` in the background (build, the test files with `--test-concurrency=3`, `IRWB_FULL=1` passes and backend, parity, revisions diff).

### Why
- One Candela process, one pipeline run, both variants compared at the same inputs: the cheapest run that still covers every `simplify`/`fold` application of Candela's O2.

### What worked
- Candela (6 min 53 s wall, 438.7 s user):
  ```text
  cfg r1 14025 ms
  fold r2 15702 ms {"table":{"revision":true,"edits":true,"corr":true,"ms":15932},"handwritten":{"revision":true,"edits":true,"corr":true,"ms":18170}}
  simplify r3 19287 ms {"table":{"revision":true,"edits":true,"corr":true,"ms":14302},"handwritten":{…true…,"ms":11552}}
  constprop r4 21630 ms
  fold r5 15404 ms {"table":{…true…,"ms":17062},"handwritten":{…true…,"ms":14940}}
  simplify - 12274 ms {"table":{…true…,"ms":10700},"handwritten":{…true…,"ms":10949}}
  … 13 revisions in all, r0 cd36346ea7c4 → head b33d1737c725, differ 0
  ```
  Edits: fold r2 676, simplify r3 48, fold r5 114, the second simplify none.
- Firings on Candela's O2: simplify `add-zero` 1, `mul-pow2` 39, `not-le` 4, `not-lt` 12 (56 firings for 48 statement edits: one edit can carry several rewrites in one tree); fold `fold-add` 430, `fold-shl` 430, `fold-fmax` 285, `fold-fmin` 199, `fold-fsqrt` 196, `fold-fmul` 139, `fold-fsub` 122, `fold-fdiv` 106, `fold-fadd` 98, `fold-sub` 69, `fold-or` 4, `fold-eqz` 3.
- Corpus revisions after the switch: identical to the baseline (44 lines).

### What didn't work
- A combined command (`npm run build && … ; diff … && echo; git diff --stat`) was refused by the worktree isolation check because it contained `git` in a compound form; re-run as separate commands.

### What I learned
- Pass time on Candela is dominated by the framework (projection, hashing, diff): the table and the hand-written `simplify` take 10.7–14.3 s and 10.9–11.6 s for the same work, within run-to-run noise of each other. The rule compiler's dispatch is not a measurable cost at this scale.
- The 13 revisions and the r0 hash `cd36346e…` match the IRWB-002 guide's Candela numbers (§16, §3), so this run is the official O2 chain.

### What was tricky to build
- Nothing new; the switch is a two-line change because the table passes were built under the original specs.

### What warrants a second pair of eyes
- The Candela comparison ran without meaning checks. That is valid because the compared quantity is each pass's output on a fixed input, which the contract does not influence; it would not be valid for a pipeline with a rejected pass.

### What should be done in the future
- After the gates: B2's recorded evidence.

### Code review instructions
- `git show` of the switch commit for `src/typed/passes.ts` (two bodies, imports, one removed constant).
- Re-run: `node --max-old-space-size=12288 ttmp/2026/11/25/IRWB-006--*/scripts/02-rules-equivalence-candela.mjs` (about 7 min).

### Technical details
- `various/04-rules-equivalence-candela.json` has every step with revision prefix, edits and timings; `various/04-…log` the progress lines.
- Gates after the switch (`various/07-gates-after-switch/summary.txt`, status 0): the test files 325 tests, 322 pass, 0 fail, 3 skipped (the three environment-gated Candela tests: `IRWB_CANDELA=1` twice, `IRWB_FULL=1` once); `IRWB_FULL=1` passes + backend 21 of 21; parity `{"projects":44,"functions":70,"cases":7000,"decided":6986,"agree":6986,"inconclusive":14,"failures":0}`; corpus revisions identical (44 lines). The switch is commit 711a9a2.

## Step 6: The rule verifier: semantics at any width, eight methods, candidate rules

B2 needs the meaning of a rule's two sides independent of any program, and methods whose strength can be stated. This step adds `src/typed/rules/semantics.ts` (the i32 operators at any width, the f32 operators on bits, rule sides compiled to closures over a slot array), `src/typed/rules/verify.ts` (`verifyRule` with structural, by-construction, symbolic-linear, bitwise-w1, exhaustive-w8, random-32, f32-special and exhaustive-32 methods) and `src/typed/rules/candidates.ts` (seven deliberately unsound rules and two sound f32 rules). In fast mode every table rule verifies as sound and every unsound candidate is rejected; one exhaustive 2³² check takes 50 s.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Each rule carries evidence that it is sound for every input of its declared types; methods at reduced width (with a transfer argument), symbolic for linear rules, random plus boundary at 32 bits, special care for f32; unsound candidates rejected in a test.
**Inferred user intent:** Rules that are trusted because they were checked once, with the strength of each check stated honestly.
**Commit (code):** 711a9a2 (semantics, verifier, candidates; committed with the switch).

### What I did
- `BIN`: one function per i32 operator `(a, b, w)`, wrapping to w bits, masking shift counts with `w - 1`, trapping division at `-2^(w-1) / -1`; `binopW` looks it up. `TRAP = 2^32` keeps outcomes numeric. `compileSide` builds closures; a template constant `{ eval }` uses `evalOp` (fold's own function) at 32 bits and `opW` below, so a fold rule's two sides are computed by two implementations.
- `verifyRule`: structural first (dropped, duplicated or reordered variables need `pure`; types from `VALUE_SIGNATURES`), then by-construction for fold rules (the replacement is the evaluator's value of the matched operator; the guard must exclude every trapping input, checked exhaustively at 8 bits and on crossed boundary values at 32), symbolic-linear (normal forms `c₀ + Σ cᵢ·xᵢ` over ℤ/2³² with `Math.imul`, once per guard instance), bitwise-w1, exhaustive-w8 for width-generic rules, random-32 or f32-special (boundary or special values crossed, then N random assignments), and exhaustive-32 for small domains always and for one full 32-bit variable on request. A counterexample from any method rejects the rule; the strength is the strongest passed method (`argumentFor` supplies the order-law argument for rules built only of comparisons and `eqz`).
- Scratch run of every rule with `{ random: 1e4 }` (fast mode), then `div-one` with `exhaustive32: true`.

### Why
- Closures over slots instead of a tree interpreter: an exhaustive 2³² loop must cost a few nanoseconds per input.
- Evaluating fold's replacement with `evalOp` rather than `BIN` turns an otherwise tautological check into a comparison of `BIN` (written for the verifier) with `binop` (the evaluator's).

### What worked
- Fast mode: all 27 `simplify` rules sound: 11 `proof` by symbolic-linear (one instance each, except 31 for `mul-pow2` and for `pow2-mul`), 4 `proof` by bitwise-w1, 8 `reduced-width+argument` (65,536 cases at 8 bits each), `not-not` `exhaustive` (domain {0, 1}), and `div-one`, `shr-zero`, `shru-zero` `sampled` until exhaustive-32 runs. All 40 `fold` rules `by-construction` (67,840 guard checks each for the binary i32 operators).
- Unsound candidates, all rejected: `div-pow2-shr` at 8 bits `{x: -127, k: 2}` (lhs −63, rhs −64); `mul-zero-impure` structurally ("x is dropped (1 on the left, 0 on the right) without pure(x)"); `fadd-pos-zero` `{x: -0}` (lhs +0); `fsub-self` `{x: +∞}` (lhs canonical NaN); `not-flt` `{a: 0, b: NaN}`; `fadd-neg-zero` `{x: 0x7fc00001}` (lhs 0x7fc00000).
- `div-one` with `exhaustive32: true`: 4,294,967,296 inputs in 50,213 ms, sound, strength `exhaustive`.

### What didn't work
- `fmul-pos-zero` was first rejected *structurally* (it drops `x` without `pure`), which hid the value counterexample it exists to show. Gave it `pure(x)`; the structural case is `mul-zero-impure`'s job.
- A `python3` heredoc that rewrote `semantics.ts` was refused by the worktree isolation check; the same changes were made with the editor tool.

### What I learned
- The guide predicted `x = −1, j = 1` as the counterexample of `div-pow2-shr`; the verifier reports the first one in its enumeration order at 8 bits, `x = −127, k = 2`. Both are counterexamples; the test checks the property (negative `x`, sides differ), not a particular value.
- The meaning check's `F32_EDGES` has only the canonical NaN, so on those values `x + (−0) → x` holds; only NaNs with other payloads refute it.

### What was tricky to build
- Keeping one implementation of the width-generic operators: a first version had `binopW` as a `switch` and the closures calling it; the table `BIN` serves both, so the 32-bit equality test with `binop` covers what the exhaustive loops use.

### What warrants a second pair of eyes
- `structuralProblem`'s order rule compares the first-occurrence order of impure variables only; a rule that reorders two pure variables passes, which is intended.
- Strength `by-construction` is relative to the evaluator; each fold record's detail says so.

### What should be done in the future
- Record the evidence with 10⁶ random assignments and exhaustive 2³² runs (`scripts/04-verify-rules.mjs`), then the tests.

### Code review instructions
- `src/typed/rules/verify.ts` (`verifyRule`, `structuralProblem`, `lin`), `src/typed/rules/semantics.ts` (`BIN`, `compileSide`).

### Technical details
- Boundary i32 values (`boundaryI32`): 48 values (0, ±1, ±2, ±3, the extremes and their neighbours, 2^j and neighbours for j = 2, 5, …, 29, alternating bit patterns, byte and half-word edges). f32 specials (`F32_SPECIALS`): 25 bit patterns including 0x7fc00001, 0x7f800001 (signalling), 0x7fffffff, 0xffc00000 and 0xff800001.

## Step 7: The SSA view, validated on the corpus and on Candela r0; a name collision found on Candela

`src/typed/ssa.ts` implements the guide's Part 4: dominance frontiers from `dominatorsOf` with a virtual entry, minimal phi placement, renaming over the dominator tree with an iterative walk, the mapping back (names → set statements and value trees, entry definitions, phis; gets → names; sets → names), `ssaAnalysis` (`typed.ssa`, not in `ANALYSES`), `ssaView`, `deadPhis` and `checkSsa`. On the corpus it agrees with reaching definitions everywhere. On Candela the first run found 5 mismatches and 10 violations, all in one function, caused by two locals with the same name; after the fix Candela r0 agrees everywhere.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** A1: dominator tree, frontiers, phis, renaming, a mapping back, validation against reaching definitions on every corpus function and Candela r0.
**Inferred user intent:** A sparse representation that is trustworthy because it is checked against the analysis it replaces.
**Commit (code):** a74063b — "IRWB-006 A1/A2: typed.ssa … agrees with reaching definitions on every corpus revision and Candela r0; sccp and O2-sccp outside the registries; framework pattern cross-check; diary steps 6-9"

### What I did
- `scripts/05-ssa-check-corpus.mjs`: every project, O2, every revision (r0 included): `typed.reaching`, `typed.ssa` and `typed.liveness` through a fresh `AnalysisManager`, then `checkSsa` and `deadPhis` for every function. The first run iterated `p.revisionList()`, which has hashes and no artifacts, and checked nothing (`"revisions": 0`); fixed to `p.revisions`.
- `scripts/06-ssa-check-candela.mjs`: Candela r0 (tape); `typed.reaching` and `typed.ssa` each computed three times through fresh managers (timings); `checkSsa` on all 332 functions.
- Fix in `ssaOf`: a local whose name another local of the function shares is named `<name>#<index>.<n>`.

### Why
- Validating at every O2 revision, not only at r0, exercises the shapes passes produce (merged blocks, hoisted `inv` locals, value-numbering `vn` locals).

### What worked
- Corpus (`various/09-ssa-check-corpus.json`): at r0, 70 functions, 794 gets, 1,033 (definition, use) pairs, 1,004 names, 228 phis of which 115 dead, 0 mismatches, 0 violations. Over all 194 revisions: 306 function instances, 3,329 gets, 4,392 pairs, 996 phis (509 dead), 0 unreachable blocks, 0 mismatches, 0 violations. Time over all revisions: `typed.ssa` 556 ms, `typed.reaching` 667 ms.
- Blend at r0: the phis, names and use mapping that the guide (section 20) predicted before any code existed are exactly what `ssaOf` produces (`bb:blend.1`: `s.2 = φ(bb:blend.0: s.1, bb:blend.7: s.3)`, `i.2`, `t7.1`; `reachingDefs('i.2')` = `[s:blend.11, s:blend.2]`); `tests/typed/ssa.test.mjs` asserts them.
- Candela r0 after the fix (`various/10-ssa-check-candela.json`): 332 functions, 2,409 blocks, 14,598 gets, 16,800 pairs, 23,850 names, 4,245 phis (2,840 dead, 67 %; at most 1,877 in one function), 0 unreachable blocks, 0 entry loops, 0 mismatches, 0 violations. `typed.reaching` 5,341 / 3,287 / 3,040 ms; `typed.ssa` 1,270 / 1,162 / 1,210 ms; the check 879 ms. Fact sizes as JSON: reaching 10,718,740 bytes, ssa 3,400,010 bytes (3,399,774 before the fix).

### What didn't work
- First Candela run (kept as `various/10a-ssa-check-candela-before-name-fix.json`): `"mismatches": 5, "violations": 10`, all in `asinPositive`, for example
  ```text
  "v:asinPositive.58 reads local 4 but its name z.1 is of local 1"
  "z.1 (bb:asinPositive.1) does not dominate its use in bb:asinPositive.4"
  mismatch at s:asinPositive.8: reaching [s:asinPositive.7], ssa [s:asinPositive.1]
  ```
  Locals 1 and 4 are both named `z`; `fresh` produced `z.1` for both, and the second definition overwrote the first in `names`. The corpus scan of Step 3 had found no duplicate names (400 locals), so the assumption "names are unique within a function" held there and not on Candela. After the fix the name count rose from 23,848 to 23,850.

### What I learned
- Two thirds of minimal SSA's phis on Candela are dead (2,840 of 4,245); a consumer that iterates over phis would profit from pruning by liveness.
- Neither the corpus nor Candela has an unreachable block or a loop at the entry, so the virtual-entry phi path is exercised only by the synthetic test (Step 9).

### What was tricky to build
- The renaming walk must fill a successor's phi arguments before descending into dominator-tree children, and must pop exactly what the block pushed; the iterative version pushes an exit frame carrying the pushed locals, then the children in reverse order.

### What warrants a second pair of eyes
- `checkSsa` compares sets of definition ids; phi arguments are keyed by predecessor, so an argument order is not a property it can get wrong.

### What should be done in the future
- A pruned variant (phis only where the local is live in) if a consumer needs it.

### Code review instructions
- `src/typed/ssa.ts` (`ssaOf`, `checkSsa`); re-run `node ttmp/2026/11/25/IRWB-006--*/scripts/05-ssa-check-corpus.mjs` (36 s) and `node --max-old-space-size=12288 …/06-ssa-check-candela.mjs` (28 s).

### Technical details
- The timings were taken while another script of this milestone (the evidence run) used one core; they are wall-clock times of single runs, not benchmarks.

## Step 8: SCCP on the SSA view, measured against constprop

`src/typed/sccp.ts` is the first consumer of the SSA view: Wegman–Zadeck SCCP (a lattice value per name, executable edges), a pass `sccp` that replaces constant reads like `constprop` does, and a pipeline `O2-sccp` (O2 with each `constprop` replaced by `sccp`), run through `Program.apply` by `runPasses`, outside `PASSES` and `PIPELINES`. On the guide's example it finds `y = 7` where `constprop` finds only `x`. On the corpus its reads are a strict superset of `constprop`'s, and `O2-sccp` brings `constants` from 70 to 40 instructions, the O2-applied-twice result, with no project slower.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** At least one consumer of the SSA view, e.g. an SCCP prototype measured against constprop, in a new pipeline, not O2.
**Inferred user intent:** Evidence that the view pays for itself.
**Commit (code):** a74063b — "IRWB-006 A1/A2: typed.ssa … agrees with reaching definitions on every corpus revision and Candela r0; sccp and O2-sccp outside the registries; framework pattern cross-check; diary steps 6-9"

### What I did
- Scratch run on `function f(n) { let x = 1; let y = 0; if (x === 1) { y = 7; } else { y = 9; } return y + n; }`. A first version with `==` failed in the front end: `LiftError: expected bool, got i32` (Typed wants `===`).
- `scripts/07-sccp-corpus.mjs`: (1) per project, the O2 revision just before the first `constprop` (after `cfg, fold, simplify`), then `constprop` and `sccp` on it under the meaning contract; the reads each made constant are the `from` of the constants it created. (2) Whole pipelines `O2`, `O2-sccp`, `O2+` and O2 twice, each pass under the contract, then `measure` (statements, image bytes, emulator instructions over 10 seeded cases per function).

### Why
- Comparing at the same input separates "finds more constants" from "the pipeline happens to end differently".

### What worked
- Example: `constprop` gives `if (1 == 1) …` only; `sccp` also gives `return (7 + n)`, whose constant has origin `{"because":["fact:sccp(f)@r0","s:f.3"],"from":"v:f.7","via":"sccp"}`.
- Corpus (`various/11-sccp-corpus.json`, 116 s): reads made constant at the same input: `constprop` 28, `sccp` 31; only-`constprop` 0, only-`sccp` 3 (all in `constants`, 3 against 6). Pass time summed over the 44 projects: `constprop` 1,231 ms, `sccp` 1,272 ms.
- Pipelines, totals over 44 projects (instructions summed over 10 cases per function; one case hits the step limit in every pipeline and is charged 200,000):

  | pipeline | statements | bytes | instructions | rejected |
  |---|---:|---:|---:|---:|
  | O2 | 709 | 5,160 | 278,296 | 0 |
  | O2-sccp | 708 | 5,148 | 278,266 | 0 |
  | O2+ | 695 | 5,104 | 276,656 | 0 |
  | O2 twice | 693 | 5,092 | 276,626 | 0 |

  `constants`: O2 70, O2-sccp 40, O2+ 70, O2 twice 40. Better under O2-sccp: `constants` only; worse: none.

### What didn't work
- Nothing beyond the `==` of the scratch example.

### What I learned
- On this corpus SCCP's advantage is concentrated in one project: the other projects' constants are already found by `constprop`, and `O2+`'s extra `subst` matters more for instructions. The two are independent; `O2-sccp` followed by `subst` is the obvious next combination.

### What was tricky to build
- `because`: a constant must cite what justifies it, which is the `set` statements reached through phi arguments on *executable* edges only (the dead arm's `y = 9` is not cited), plus the fact reference.

### What warrants a second pair of eyes
- `sccpOf` evaluates only the operators `fold` folds and treats every other operator (loads, calls, `caddr`, floor, ceil, trunc, conversions to integers) as ⊥, so it never claims a constant `fold` could not produce.

### What should be done in the future
- `O2-sccp` followed by `subst`, and SCCP on Candela (not run: the brief limits Candela to the equivalence and SSA checks).

### Code review instructions
- `src/typed/sccp.ts` (`sccpOf`, `contributing`, `sccp`); `node ttmp/2026/11/25/IRWB-006--*/scripts/07-sccp-corpus.mjs` (about 2 min).

### Technical details
- `measure` is `src/typed/strategies.ts:66`; `my-analysis` contributes the one case at the step limit.

## Step 9: The framework's pattern language cross-checked against the compiled matcher

The guide's decision (Step 2) was to apply rules through `Tx.rewrite` and only convert patterns to the framework's `NodePattern`, for search and display. This step measures the second half: whether the framework's `searchPattern` sees the same matches as the compiled matcher for every rule of both tables, and what it costs. Every exact pattern agrees; the one pattern with a structural repeat matches far more in the framework, which is the expected difference between `sameAs` and structural equality.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The brief says the framework's rule engine may be used as is; evaluate it and record why it is or is not used.
**Inferred user intent:** No parallel rule machinery without a measured reason.
**Commit (code):** a74063b (with Steps 7 and 8)

### What I did
- `scripts/08-framework-pattern-crosscheck.mjs`: for every corpus project, r0 and O2's revision after `cfg, fold` (71 distinct revisions; some projects' `cfg, fold` change nothing), `openIR(art, blocksAdapter)`, then for each of the 67 rules `searchPattern(view, toNodePattern(rule).pattern, { maxSteps: 1e7, maxMatches: 1e6 })`, counting distinct match roots, and `matchPat(rule.lhs, …)` over every value (no guards on either side). Timed both.
- `node …/scripts/08-framework-pattern-crosscheck.mjs --json …/various/12-framework-pattern-crosscheck.json` (51.7 s wall clock).

### Why
- The conversion `toNodePattern` is what makes the rule tables searchable in the framework's terms (and in the workbench's pattern tools); a silent disagreement would make that search misleading.

### What worked
- `"revisions": 71, "rules": 67, "differ": []`: every exact pattern has the same match count in both. 13 rules have matches; the exact ones total 141 (e.g. `not-lt` 58, `mul-pow2` 48, `pow2-mul` 11, `fold-mul` 8, `fold-sub` 5).
- `"superset": [{"rule": "sub-self", "framework": 74, "compiled": 1}]`: the converted `sub(x, x')` binds `x'` as a capture without the structural-equality condition (the framework's `sameAs` would demand the *same entity*, which never occurs in a tree with one user per value), so it matches every `sub` of two subtrees; the compiled `same` matches one. `toNodePattern` reports this pattern as `exact: false`.
- Cost: framework 47,425 ms, compiled matcher 641 ms, for the same 71 × 67 searches.

### What didn't work
- Nothing failed.

### What I learned
- The framework's search costs about 74 times the compiled matcher here. From the code (not profiled), the likely reasons are that it starts from every entity of the projected graph (blocks, statements, locals, functions as well as values) and records evidence per match. That is the right trade for interactive search and the wrong one for a pass that runs on every revision.

### What was tricky to build
- Counting distinct roots: the script counts `new Set(roots)`, so a root reported more than once counts once.

### What warrants a second pair of eyes
- The cross-check ignores guards on both sides; it compares pattern shape only, which is what the conversion claims to preserve.

### What should be done in the future
- If the workbench gains a "where does this rule apply" view, it can use `searchPattern` with the converted pattern and filter by the rule's guards; for `sub-self`, a predicate condition for structural equality would make the conversion exact.

### Code review instructions
- `src/typed/rules/form.ts` (`toNodePattern`); `scripts/08-framework-pattern-crosscheck.mjs`.

### Technical details
- Decision recorded (task qkls): rules are applied by the compiled visitor; the framework's engine is not used for application, for three reasons — its edits do not allocate through `Tx` (no Typed origins, ids outside the counters), it publishes one artifact per application, and its repeat semantics differ (this step, measured).

## Step 10: Recorded evidence, the rules listing, the tests

The evidence run (`scripts/04-verify-rules.mjs`, 10⁶ random assignments, exhaustive 2³² checks on) took 66.6 minutes and wrote `src/typed/rules/evidence.ts` and `various/08-rule-evidence.json`. Every table rule is sound with the expected strength, every unsound candidate is rejected, and the two sound f32 candidates are exhaustive. With the evidence in place, the rules test (9 tests), the SSA test (6 tests) and `wb.rules()` (both tables at 72 columns) pass.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** B2's "each rule carries recorded evidence" and "a test with a deliberately unsound rule"; the workbench listing (tiles are 72 columns).
**Inferred user intent:** Evidence that is checked in, pinned to the rule it was computed for, and visible where rules are shown.
**Commit (code):** see the commit after this step.

### What I did
- Started `(time node …/scripts/04-verify-rules.mjs) > …/various/08-rule-evidence.log 2>&1` in the background before Step 7, then built SSA, SCCP and the cross-check while it ran.
- The run spent most of its time on the two sound f32 candidates (`fneg-fneg`, `fabs-fneg`), whose exhaustive 2³² check went through `opW` (an array per call). While it ran I changed `compileSide` to call `F32_UNARY`/`F32_BINARY`/`F32_COMPARE` directly at 32 bits; a scratch benchmark of `fneg-fneg`'s closures alone went from 795 ms to 411 ms per 2²⁴ inputs. The running process kept the old code. `scripts/11-f32-candidates-exhaustive.mjs` timed both candidates in a fresh process with the new code (`various/14-…log`).
- To build and test SSA before the evidence existed, I wrote a placeholder `evidence.ts` (empty record); the run overwrote it. The rules test failed on the placeholder exactly where expected (3 tests: evidence present, fast re-run agreement, listing shows `none`), and passed after.
- `npx prettier --write` on the generated file and the new sources, `npm run build`, `node --test tests/typed/rules.test.mjs`, and `wb.rules()` through `createWb()` (`various/15-wb-rules-listing.txt`).
- Replaced an awkward assertion on `fmul-pos-zero`'s counterexample with the property: the replacement is +0 and the original is not.

### Why
- Pinning by fingerprint: a test compares each record's `fingerprint` with `ruleFingerprint(rule)`, so editing a rule without re-running the verifier fails the test suite.
- The "fast re-run agreement" test re-verifies every table rule with 2,000 random assignments and requires the same verdict and, except where only exhaustive-32 distinguishes, the same strength; it keeps `evidence.ts` honest against changes to the verifier.

### What worked
- Totals (`various/08-rule-evidence.json`): `simplify` 15 proof, 4 exhaustive, 8 reduced-width+argument; `fold` 40 by-construction; unsound candidates 7 of 7 rejected; f32 candidates 2 sound, exhaustive.
- Times in the recorded run: proved rules 48 ms (`add-zero`) to 3,781 ms (`pow2-mul`); `fold` 18.7 s for all 40; exhaustive checks `div-one` 131,445 ms, `shr-zero` 170,119 ms, `shru-zero` 236,482 ms (with other milestone scripts sharing the machine); `fneg-fneg` 941,672 ms, `fabs-fneg` 2,487,554 ms; whole run 3,997,858 ms (`time`: 3,481.76 s user, 1:06:38 wall clock).
- Fresh process with direct f32 calls: `fneg-fneg` 306,203 ms, `fabs-fneg` 622,828 ms, both sound and exhaustive.
- `node --test tests/typed/rules.test.mjs`: 9 of 9 pass (the subset equivalence test 23.8 s). `tests/typed/ssa.test.mjs`: 6 of 6.
- `wb.rules()`: two tables, widest line 72 columns; `simplify` ends `27 rules: 15 proof, 4 exhaustive, 8 w8+argument`, `fold` ends `40 rules: 40 by evaluator`; `wb.rules('nope')` fails with `unknownRuleSet` and the fix `rule sets: simplify, fold`.

### What didn't work
- The evidence run took 67 minutes, most of it on two candidate rules outside the tables. The f32 candidates' exhaustive checks dominate: in the long-running process the same check cost about three times what it cost in a fresh one, even before the direct-call change. I did not profile it; the likely cause is that one process compiled closures for all 76 rules first. The table rules' evidence does not depend on those two candidates.

### What I learned
- `fneg` and `fabs` are single bit operations (`a ^ SIGN`, `a & 0x7fffffff`), so 71 ns per input in the fresh run is the cost of the verifier's loop, not of f32 arithmetic. An exhaustive f32 check of a richer rule would cost more; 2³² is the practical limit for one f32 variable.

### What was tricky to build
- Keeping the build green while the evidence did not yet exist: `listing.ts` and the workbench import `evidence.ts`, so the placeholder had to type-check (`Readonly<Record<string, RuleEvidence>>`).

### What warrants a second pair of eyes
- `evidence.ts` is generated and 2,086 lines after formatting; review the generator (`scripts/04-verify-rules.mjs`) and spot-check records rather than reading it.

### What should be done in the future
- Profile the exhaustive loop if more f32 rules need exhaustive evidence.

### Code review instructions
- `src/typed/rules/listing.ts` (`rulesListing`, `evidenceLabel`), `src/workbench/workbench.ts` (`rules`), `tests/typed/rules.test.mjs`.

### Technical details
- Evidence options recorded in the file: `{"random":1000000,"seed":7,"exhaustive32":true}`.

## Step 11: Final frozen gates

With the evidence recorded and every new test passing, the frozen gates were run on the final source. Everything is green and the corpus revisions are identical to the baseline recorded at the start.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** O2, its passes' results and the book's numbers stay frozen: the test files, the full passes and backend tests, parity, and the corpus revision diff.
**Inferred user intent:** Nothing this milestone added changes what the compiler already did.
**Commit (code):** see the commit after this step.

### What I did
- While the evidence was still running, `scripts/10-frozen-gates-part.sh various/13-gates-final` (the gates that do not import `evidence.ts`): `IRWB_FULL=1` passes and backend, `tools/parity.mjs`, and the corpus revisions against `various/01-baseline-corpus-revisions.txt`.
- After the evidence and the rebuild: `node --test --test-concurrency=3 "tests/**/*.test.mjs"` into `various/13-gates-final/gate-npm-test.log`.

### Why
- Splitting the gates saved waiting time; the three gates of the first part depend on the passes, the backend and the evaluator, none of which changed after they ran (only `evidence.ts`, the listing and the tests did).

### What worked
- `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs`: 21 tests, 21 pass, 65.4 s.
- Parity: `{"projects":44,"functions":70,"cases":7000,"decided":6986,"agree":6986,"inconclusive":14,"failures":0}`.
- Corpus revisions: IDENTICAL to the baseline (44 lines).
- Test files: 340 tests, 337 pass, 0 fail, 3 skipped (the environment-gated Candela tests), 114.8 s. 340 = 325 before this milestone + 9 (rules) + 6 (ssa).
- `various/13-gates-final/summary.txt` collects these.

### What didn't work
- Nothing.

### What I learned
- Nothing new; the gates confirm that `passes.ts`'s only change (Step 5) is still invisible in every frozen number.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- The test files ran with `--test-concurrency=3` instead of `npm test`'s default, to share the machine; the set of test files is the same (`tests/**/*.test.mjs`), and `npm test`'s build step was run separately.

### What should be done in the future
- After the coordinator merges IRWB-003 (new passes in `passes.ts`), re-run `tests/typed/rules.test.mjs` with `IRWB_FULL=1`: the table/hand-written comparison runs every pipeline, including any new ones that contain `simplify` or `fold`.

### Code review instructions
- `various/13-gates-final/summary.txt`, `scripts/10-frozen-gates-part.sh`.

### Technical details
- Source for the gates: a74063b plus the working tree that became 2c8bfd3. Steps 10 and 11 were committed in 2c8bfd3 — "IRWB-006 B2: recorded evidence for every table rule (15 proof, 4 exhaustive, 8 reduced-width+argument, 40 by construction), unsound candidates rejected in a test; wb.rules() at 72 columns; final gates green; diary steps 10-11".

## Step 12: The vault report

Milestone entry. The deep-dive report is written in the vault, with three figures generated from the recorded measurements, and reread against this diary and the files in `various/`. It is not committed: the brief says not to commit or push the vault.

- **Report:** `/home/manuel/code/wesen/go-go-golems/go-go-parc/Projects/2026/11/25/PROJECT REPORT - IR Workbench - Rewrite Rules as Verified Data and a Single-Assignment View - Rule Tables With Identical Revisions, Evidence per Rule, and SSA Checked Against Reaching Definitions - A Technical Deep Dive.md` (frontmatter in the shape of the 2026/11/24 reports; `source_revision: 2c8bfd3`).
- **Figures:** `python3 -I scripts/09-report-figures.py various/16-figures`, copied to `Projects/2026/11/25/_assets/irwb006-evidence-strength.png`, `irwb006-ssa-candela.png`, `irwb006-sccp-constants.png`; looked at each.
- **Reread corrections:** the hand-written `simplify` has sixteen rewriting `return` statements (not "sites"); 141 exact-pattern matches in the cross-check (not 142, which included `sub-self`'s one); parity's 14 inconclusive cases are the ones at the step limit (`tests/typed/passes.test.mjs:76`); only two of IRWB-001's four float rewrites passed the meaning check before the edge-value sweep (report 3); claims about *why* `fold` fires on Candela and about the f32 loop's cost were replaced by the counts and by "not profiled"; the SSA fact size is the after-fix 3,400,010 bytes.
- **Style:** textbook register, no analogies; mermaid diagram of the SSA construction; tables for methods, evidence, candidates, SSA checks and SCCP.
