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
**Commit (code):** see the commit after this step ("IRWB-006: intern guide, diary steps 1–3, baseline").

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
**Commit (code):** see the commit after this step ("IRWB-006 B1: simplify and fold use the rule tables …").

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
