---
Title: Diary
Ticket: IRWB-059
Status: active
Topics:
    - framework
    - compiler
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T01:39:50.034770109-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: ticket, plan, and the intern guide delegated

This step opens phase 4b of the v7 refactor (IRWB-039): the three phase-4 items that waited for derivations, plus one small fix. I created the docmgr ticket with the guide and diary documents and eight tasks. I delegated the intern guide to a fork of the coordinator, so it starts with the coordinator's context and reads the source itself; I review it and upload it. The agents' briefs will point to the guide.

### Prompt Context
**User prompt (verbatim):** "ok, yes, continue." (to: write the briefs and launch 4.6, 4.2, 4.8 and the small fixes). Then, mid-turn: "docmgr ticket + Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Then implement, commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill) (each subagent needs to keep their own diary)"
**Assistant interpretation:** Make a ticket for this round with an intern-level guide to the system and to the round's work, upload it to reMarkable, then run the round (agents implement, coordinator merges), with a detailed investigation-format diary here and one in every agent's ticket.
**Inferred user intent:** The round should be understandable to a newcomer from one document, and every actor's work should be traceable.

### What I did
- `docmgr ticket create-ticket --ticket IRWB-059 --title "v7 phase 4b: rules over a term signature, lowering as cross-IR transformations, staged choice" --topics framework,compiler`.
- `docmgr doc add`: `design-doc/01-intern-guide-…md`, `reference/01-diary.md`.
- Tasks: guide, upload, lanes 4.6, 4.2, 4.8 and F41, score and merge with the GPU suite, then update the handoff, backlog and design doc.
- A fork writes the guide. Its brief carries the user's request verbatim, the `textbook-authoring` style, and the skill's writing guidance with its second-pass review. It must verify every API and path against the source.

### Why
- **The guide before the briefs:** the agents can then read the same explanation the intern gets, instead of a coordinator summary.
- **A fork rather than a fresh agent:** the guide needs the whole v7 context (R3, phases 0–4a, the decision points). A fork has it; a fresh agent would need it restated.

### Lane plan (scopes kept disjoint)
| Lane | Ticket | Cells | Files | Decision point |
|---|---|---|---|---|
| 4.6 term rules (+ F40) | IRWB-060 | GLM high, DeepSeek xhigh | `src/stdlib/term/` (new), `src/typed/rules/`, Typed rule passes, `src/tensor/passes.ts` | rule path materially slower than the compiled visitor → share only the matcher and verifier |
| 4.2 cross-IR lowering | IRWB-061 | Fable | `transformation.ts` (`In`/`Out`), `src/typed/backend/`, `cuda-contract.ts` (not `modesOf`), `src/tensor/index.ts` | composed correspondence equals today's; images and CUDA unchanged |
| 4.8 staged choice | IRWB-062 | Sol low | `schedule.ts`, `cuda-source.ts`, `cuda-runtime.ts`, `modesOf` only | derived arms equal today's modes on the corpus |
| F41 one coverage check | IRWB-063 | Terra low | `ir/derivation.ts`, the manager's coverage function, `ir/correspondence.ts` | — |

`cuda-contract.ts` is shared by 4.2 and 4.8, split by function: 4.8 owns `modesOf`, and 4.2 the transformation and its wrapper. No lane runs GPU tests; the coordinator runs the GPU suite at merge.

### What should be done in the future
- After this round: 4.3 (attribution as queries, which settles 393 against 395) and 4.7 (the E1 benchmark: adopt the core runtime only if its per-edit checking cost falls with program size). Then the PR into `main`.

## Step 2: the guide reviewed and committed; five agents launched

The fork delivered the guide, about 8,500 words. I checked its structure and aligned one inconsistency with the lane brief, then committed it and tagged the base. All five cells and the reMarkable upload (a Haiku agent) are running.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Deliver the guide (ticket and reMarkable), then implement through the lanes.
**Commit (code):** `e01f5cb` — the intern guide; tag `v7-p4b-base`. Briefs and launcher are in `b73cdd0`.

### What I did
- **Read the fork's receipt.** The guide's sections are:
  1. the system, with two traces: Typed `first-steps` (O1) and Tix `softmax`;
  2. framework concepts 2.1–2.9;
  3. the library;
  4. the touched parts of Typed and Tix;
  5. the four lanes, each with problem, proposal, diagram, files, acceptance and decision point;
  6. validation;
  7. the API and file reference;
  8. open questions.

  Every name was read at `f341706`, and `docmgr validate frontmatter` passes.
- **Fixed one inconsistency:** the guide read "materially slower" (4.6) as 1.2×, while the brief fixes it at about 10% of the O2 compile time. I changed the guide to state the brief's number in both places.
- **Launched** `scripts/13-launch-p4b-lanes.sh 10800 terms staged coverage`, which started GLM and DeepSeek on terms (IRWB-060-A/B), Sol low on staged choice (062) and Terra low on coverage (063). Fable (IRWB-061) was started through the Agent tool on worktree `v7-lowering-fa-irwb-061`, using wrapper `prompts/lowering/claude/IRWB-061.md`.
- **Delegated the reMarkable upload** to a Haiku agent following the remarkable-upload skill: `/ai/2026/11/28/IRWB-059`, name "IRWB-059 Intern Guide - IR Workbench phase 4b".

### Why
- The guide went into the base commit, so every agent can read it from its own worktree.
- The upload goes to a small model, as the remarkable-upload skill prescribes for routine finalization.

### What worked
- All four Codex and Pi processes run in their worktrees (checked by `pgrep` and each process's `cwd`).

### What didn't work
- `grep … ttmp/2026/11/28/IRWB-059--*/design-doc/01-intern-guide-*.md` in zsh: `ugrep: warning: …: No such file or directory`. The glob was not expanded inside that command. I resolved the path with `ls` into a variable first.

### What I learned
- The fork's second pass corrected a claim of mine: in `first-steps` the shift comes from `simplify`'s `mul-pow2` after `fold` and `constprop` (O1), not from `strength`.

### What warrants a second pair of eyes
- Three things in the guide are proposals or readings, not observed facts: the type shapes (`Signature`, `CrossSpec`, `LaunchChoice`, `checkCoverage`), and the reading that `modesOf` covers every gate side whenever a program has two or more variants. The guide labels them so.

### Code review instructions
- Read the guide's section 5 against the briefs in `IRWB-039/various/prompts/{terms,lowering,staged,coverage}/common.md`.

## Step 3: lane 4.2 (lowering as cross-IR transformations) scored and merged

Fable (IRWB-061) finished in about 30 minutes. Both lowerings now run on the one runner as `CrossTransformation<In, Out>`, and same-IR passes keep their type and code path. The cell scored clean on its commit. I merged it by cherry-pick without conflicts, and every check passed on the working branch, including the GPU suite.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Score, review and merge lane 4.2.
**Commit (code):** cherry-picks `b9b7730`..`a79c485` (the cell's `fbf7abb`).

### What I did
- `BASEREF=v7-p4b-base scripts/07-score-lanes.sh v7-lowering-fa-irwb-061`. Result: build and tsc ok, no new Prettier issues, baselines 0 differences, typed 198, framework 272, workbench 24, tensor 55, stdlib 61, oracle 0, dirty 0.
- Read the diff stat. Sizes: `transformation.ts` +271/−69, `cuda-contract.ts` +177/−21, `define-pass.ts` +91/−7, `typed/backend/compile.ts` +102/−9. I also read `lowerToImage`.
- `git cherry-pick v7-p4b-base..v7-lowering-fa/irwb-061` (6 commits).
- Checks: build, tsc, Prettier (7 known files), the five suites, `02-baselines.mjs check`, `build:site`, then `node --test tests/tensor/*-gpu.test.mjs`.

### Why
- This was the only cell in its lane, and the review found no defect, so I merged it without a comparison.
- The GPU suite ran at merge because the lane changed how `runTixCuda` hands kernels to the runtime (it now passes the manifest), and the cell could not test that without a GPU.

### What worked
- The cell's acceptance:
  - a planted wrong image (one spill reload replaced by a nop) is rejected through `ensures` with cause `postcondition`, and nothing is published;
  - the Typed correspondence equals `imageCorrespondence` on 100 lowerings;
  - the composed Tix correspondence (statements → initial kernels → fuse → loops → emission) equals `kernelCorrespondence` on 24 lowerings;
  - `cudaSource()` output is byte-identical on 24 of 24.
- On the working branch, every check passed: tsc clean; suites typed 198, framework 272, workbench 24, stdlib 61, tensor CPU 55; baselines `no differences`; site builds; **GPU 23/23**.

### What didn't work
- No failures observed.

### What I learned
- **The default paths are still unchecked, but now they say so.** `lowerToImage` is a *pending* application: it records `rv32.image-agrees` as owed (`pending.reason`) and refuses a store. The checked path, `lowerImageChecked`, exists and is tested, but nothing in `src/` calls it. `cudaSource()` works the same way. The bypass became a recorded, declared choice; it did not become a check.
- The brief was wrong: `rv32.image-agrees` was never run by workbench views. Nothing in `src/` called it.

### What warrants a second pair of eyes
- **Speed:** `cudaSource()` went from 0.29 ms to 4.7 ms per lowering, because the old body memoized the schedule. The cell found no hot caller. The baselines script and the tensor tests call it often, but their run times stayed acceptable.
- **A second registry:** `cuda-contract.ts` runs `schedulePlan` on its own registry to collect the correspondences, because `scheduleFunction` drops the pass results. The cell estimates the fix at about three lines in `strategy.ts`, which is lane 4.8's file.
- **`pending` on a same-IR pass** also skips its preservation claims. No caller uses that today.

### What should be done in the future
- Decide where the checked lowering runs: for example, `Program`'s O2 path or the workbench's image view could call `lowerImageChecked`. Until then the compiler's own output is checked only in tests.
- Memoize the schedule in `lowerTixCuda`, or measure that no caller needs it.
- `TixIR.entities` lists statements while the adapter also lists functions and parameters; there should be one list (F41's area).
- After lane 4.8 merges: `scheduleFunction` should return the pass results, so the second registry can go.

### Code review instructions
- Start with `src/framework/passes/transformation.ts` (`transformation({ from, to })`, `CrossTransformation`, `options.pending`), then `src/typed/backend/compile.ts` (`imageLowering`, `lowerImageChecked`) and `src/tensor/cuda-contract.ts` (the composed correspondence).
- Validate: `node --test tests/framework/cross-transformation.test.mjs tests/typed/lowering.test.mjs tests/tensor/lowering.test.mjs`.

## Step 4: lanes 4.8, F41 and 4.6 scored and merged; F41 finished by the coordinator

The four Codex and Pi cells all exited 0 and scored clean on their commits. GLM's term cell had one unformatted file. I merged staged choice (Sol low), the coverage check (Terra low) and term rules (GLM), in that order, with no conflicts. Terra's cell left F41 half done, because the duplicate types lay outside its brief, so I finished it. On the working branch every check passes, GPU included.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Score, review, choose between the two term cells, merge, and validate at merge.
**Commit (code):** cherry-picks of `v7-staged-sl/irwb-062`, `v7-coverage-tl/irwb-063` and `v7-terms-g-h/irwb-060-a`; `b1e975d`, F41 completed.

### What I did
- `BASEREF=v7-p4b-base scripts/07-score-lanes.sh` on the four cells. Each: build and tsc ok, baselines 0 differences, all suites green, oracle 0, dirty 0. GLM 060-A had one new Prettier issue, in `src/framework/ir/derivation.ts`.
- Read the final messages and diff stats of both term cells.
- Cherry-picked staged choice, then the coverage check, then GLM's terms.
- Ran Prettier on `derivation.ts`.
- **F41:** made `DerivationCoverage` (`ir/derivation.ts`) and `CorrespondenceCoverage` (`contracts/types.ts`) aliases of `Coverage` in `ir/correspondence.ts`. `contracts/types.ts` now imports that type; the analysis manager already imported `checkCoverage` from `../ir`, so the layering does not change.
- Ran the full checks, the GPU suite included.

### Why: GLM's term cell over DeepSeek's
| | GLM high (060-A) | DeepSeek xhigh (060-B) |
|---|---|---|
| decision point (library path against the compiled matcher, O2, interleaved) | +3.4%, +5.2%, +2.7% over three runs: under 10%, library path kept | −0.28%: library path kept |
| F40 | one branch in `stepEntries` (`ir/derivation.ts`) maps a `merged` step to the statement that absorbed it. **Tix `inline` keeps its derivation**, and the correspondence is computed from it. | `inline` supplies `merged` entries and **no longer emits a `Derivation`**, which undoes K2 for Tix (its own report says "the K2 record for Tix does not [survive]") |
| scope | touched `ir/derivation.ts`, a documented exception | within scope; ran the `*-gpu` tests once by mistake (glob), and recorded it |
| library shape | `terms.ts`, `types.ts`, `verify.ts` (337 lines; the seeded `Rng` moved verbatim) | `signature.ts`, `pattern.ts`, `rules.ts`, `verify.ts` (91), and `tensor/rules.ts`; A0's matcher copy (`edit-classes.ts`) ported too |

DeepSeek's library is cleaner and ports one more client, but its F40 removes a derivation that phase 4.1 had just added. The derivation is meant to be the source the correspondence is computed from, so GLM's fix sits in the right place. **Follow-up:** port DeepSeek's `edit-classes.ts` change, A0's matcher on the library, from `v7-terms-ds-x/irwb-060-b`.

### What worked
- No conflicts, although lanes 4.2 and 4.8 both touched `cuda-contract.ts`: 4.8 changed only `modesOf`, as both briefs specified.
- Checks on the working branch:
  - tsc clean; Prettier flags 6 pre-existing files;
  - suites: typed 198, framework 273, workbench 24, stdlib 67, tensor CPU 63;
  - baselines `no differences`; site builds;
  - **GPU 23/23**.

### What didn't work
- IRWB-063's own final message: "F41 is incomplete: the original duplicate type declarations remain. Removing them requires edits to `contracts/types.ts` and `passes/define-pass.ts`, both excluded by the brief's scope." I finished it in `b1e975d`. Two aliases were enough; `define-pass.ts` needed no change, since it imports `DerivationCoverage`.
- The Codex sandbox again reported four failing test files, from subprocess EPERM; the escalated rerun passed.

### What I learned
- **The F40 brief was wrong.** After IRWB-056-B the correspondence is computed in the framework from the derivation, so "port 056-A's `passes.ts`" could not work. Both cells said so, and they resolved it in opposite places.
- **Staged choice (IRWB-062):**
  - the gate and the contraction variants are one ordered launch `select`;
  - the manifest carries the guards and arms, and `modesOf` derives the forcing modes from them;
  - unreachable arms and uncovered launches are diagnosed;
  - CUDA is byte-identical.

### What warrants a second pair of eyes
- GLM's `stepEntries` branch for `merged` changes what `correspondenceFromDerivation` produces for a step whose target existed before. IRWB-056-B pinned the old behaviour in `tests/framework/derivation.test.mjs`, and GLM updated two assertions there.
- The library's `verify.ts` (337 lines) holds the moved `Rng`. Check that nothing still imports Typed's old copy.

### What should be done in the future
- Port DeepSeek's A0 matcher change, as above.
- Make the checked lowering the default on some path (from step 3).
- `scheduleFunction` should return the pass results, so the second registry in `cuda-contract.ts` can go (from step 3).
- Remaining phase-4 items: 4.3, attribution and classification as queries (settles 393 against 395); 4.7, keep or delete (E1 benchmark). Then the PR.

### Code review instructions
- Term rules: start at `src/stdlib/term/terms.ts`, `src/typed/rules/compile.ts` (the library matcher over `ValueHandle`), and `src/tensor/passes.ts` (`split-sum` and `inline` as rules).
- Staged choice: `src/tensor/schedule.ts` (the launch `select` and its diagnostics), then `modesOf`.
- F41: `src/framework/ir/correspondence.ts` (`Coverage`, `checkCoverage`).
- Validate: `node --test tests/stdlib/term.test.mjs tests/tensor/terms.test.mjs tests/tensor/staged-choice.test.mjs tests/framework/correspondence-entities.test.mjs`.
