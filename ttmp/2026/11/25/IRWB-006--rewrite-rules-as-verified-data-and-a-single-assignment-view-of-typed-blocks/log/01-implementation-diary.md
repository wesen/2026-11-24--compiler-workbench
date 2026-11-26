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
