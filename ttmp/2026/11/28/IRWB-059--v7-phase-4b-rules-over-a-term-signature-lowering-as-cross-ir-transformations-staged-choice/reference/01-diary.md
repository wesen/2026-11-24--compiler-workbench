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
