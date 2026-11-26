---
Title: IRWB-018 diary
Ticket: IRWB-018
Status: active
Topics:
    - research
    - workbench
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological diary of the analysis of the Codex design agents' over-engineering and the two interventions.
LastUpdated: 2026-11-26T12:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-018 diary

## Step 1: what the Codex agents were shown, from their native rollouts

The user asked why the six Codex design agents (IRWB-012..017, gpt-6.2-sol, medium) over-engineered their designs: "analyze the transcript of the subagent sto figure out what migt have led them to this complexity (I think for exampe around which skills they loaded and how things are phrased)". The report is to be about "having codex subagents design out features and learning about their behaviour and trying to improve their penchant for overcautious overengineering".

I read the six native rollouts directly, because the go-minitrace verbs no longer run on this build. Every session saw the same four pieces of context; only the worktree paths differ.

### Prompt Context
**User prompt (verbatim):** "ok, analyze the transcript of the subagent sto figure out what migt have led them to this complexity (I think for exampe around which skills they loaded and how things are phrased). Then  write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). Commit and push the bsidian vault when done (go-go-parc vault). The report is about having codex subagents design out features and learning about their behaviour and trying to improve their penchant for overcautious overengineering"

### What I did
- **Located the rollouts** by the session ids in the `codex exec` logs: `~/.codex/sessions/2026/11/26/rollout-…-01a2187d-*.jsonl`. Of the 11 files that day, 3 are approval-assessor sidecars, found with the skill's `grep -c "whose request action you are assessing"`. Source lists are in `various/sources/`.
- **Converted the six work sessions** with `go-minitrace convert codex`; the run record is `various/results/convert-run-record.json`.
- **Tried the docmetrics profile.** Every verb failed with `TypeError: Object has no member 'RuntimeArchives'`. The installed go-minitrace (`dev`) has replaced `mt.db().RuntimeArchives()` and raw `db.query` with a source and query builder. I did not port the verbs, which are the user's skill files.
- **Wrote `scripts/01-extract-codex-sessions.mjs`.** From each rollout it extracts the system prompt, the skills catalogue, the multi-agent block, AGENTS.md, every `exec_command` string from the code-mode `exec` tool, the paths read, and the assistant commentary.
- **The shared context**, identical across sessions except for worktree paths:
  - the system prompt: 27,750 characters;
  - the skills catalogue: 46,817;
  - the multi-agent role block: 2,511;
  - the global AGENTS.md: 5,049, written for Go projects.
- **Reasoning is unreadable.** Each session has 13 or more reasoning items, all encrypted, with no summaries.

### What I learned
- **Skills.** All six loaded exactly `docmgr/SKILL.md` and `diary/SKILL.md`, the two my brief named. Some also loaded `diary/references/*` or `docmgr/references/milestones.md`. None loaded `ticket-research-docmgr-remarkable` (whose description says "intern guides" and which has `references/writing-style.md`), `textbook-authoring` or `revise-document-for-understandability`, although Codex has all three. Its `diary` and `docmgr` skills are byte-identical to Claude's.
- **System prompt, Coding Style (a):** "Handle the full range of supported inputs, including data created before the change. If an operation can fail partway, be retried, or run concurrently, keep the resulting state consistent." This matches the docs' wide input domains and their guarantees that nothing is written before an error.
- **System prompt, writing rules:**
  - "NEVER use contrastive framing such as 'X, not Y'";
  - "Do not compare to an unsolicited alternative the user did not directly ask about";
  - "In prose, do not use semicolons";
  - "Carefully follow these instructions when writing in documents".

  A design doc that may not weigh alternatives cannot argue for the simpler one.
- **System prompt, completion pressure:** "Make sure that you have accounted for every part of the user's request"; "Before calling work complete, check each deliverable".
- **AGENTS.md** is Go and web guidance, irrelevant here. Its one general rule argues against complexity: "Don't add backwards compatibility layers or adapters unless explicitly asked".
- **The IRWB guides were skimmed.** Agents touched them with 2–6 commands each, mostly `rg -m 6`. The exception is IRWB-015, which `git show`ed guides from other agents' unmerged branches (`69ae7a0`, `d0e6415`) through the shared `.git`.

## Step 2: content metrics, and the approval sidecars

### What I did
- **Wrote `scripts/02-content-metrics.mjs`**, keyword-family shares, counts and markers per 1,000 prose words, and ran it on the six Codex docs and five Claude-written guides (IRWB-003, 006, 007, 008, 010). Output: `various/results/baseline/content-metrics.json`.
- **Read the three approval sidecars.** Each assessed the agent's `git add … && git commit` and returned `allow`, for example `{"risk_level":"low","user_authorization":"high","outcome":"allow"}`.

### What I learned
| measure | Codex docs | Claude-written guides |
|---|---|---|
| contrast markers per 1,000 words | 0–0.9 (four docs exactly 0) | 1.28–2.22 |
| semicolons per 1,000 words | 0–1.17 | 6.3–12.2 |
| sentences about error contracts | 6.0–17.9% | 3.4–7.4% |
| sentences about testing | 15.7–23.3% | 3.6–16.8% |
| words per sentence | 14.0–15.7 | 18.4–23.9 |

The families are keyword matches ("case" also matches "in this case"). They select candidates; they don't prove intent.

**Correction to IRWB-001 diary step 38.** That step worried that `approval: on-request` would make a command needing escalation fail in `exec` mode. In fact Codex's `approvals_reviewer = auto_review` assessed and allowed the three commits that needed it.

## Step 3: two interventions launched (round 2: revised brief; round 3: self-review)

### What I did
- **Round 2:** `various/prompts/00-common-round2.md`. It is the baseline brief plus a "Design policy" section, one rule per cause found in steps 1–2:
  - valid inputs only, and traps are allowed;
  - the narrowest input domain the experiment allows;
  - for each significant decision, name the simplest alternative (this solicits the comparison the system prompt otherwise forbids);
  - features that don't exist yet go on a one-line "Later" list;
  - a scalar constant is a scalar parameter;
  - only the tickets the program directly exercises;
  - propose small infrastructure changes instead of designing around them;
  - probe any feature before relying on it;
  - a target of 1,500–2,500 words;
  - work only from the agent's own worktree.

  The per-program specs are unchanged. The worktrees are `codex2-irwb-0NN` from `d521d97`, the baseline's repository state without the baseline prompt files.
- **Round 3:** the six baseline sessions resumed (`codex exec resume <id>`) in their own worktrees, with a generic prompt (`various/prompts/round3-self-review.md`): "Re-read your design document as a skeptical senior engineer whose goal is the simplest design that still serves the experiment…". It names no categories.
- **The launcher** is `scripts/03-launch-rounds-2-and-3.sh`. All 12 runs go at once; each log header shows `gpt-6.2-sol`, `medium`, and a sandbox that includes `.git`.

### What warrants a second pair of eyes
- **The round-2 rules come from my own review's categories.** Round 2 therefore tests whether stating them as generic policy changes the design, not whether the model finds them on its own. Round 3 is the test of the latter.
- **The "work only from your worktree" rule is a new control.** Without it, round-2 agents could read the baseline designs on the `codex/` branches, as IRWB-015 read other branches.
