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

## Step 4: rounds 2 and 3 finished; metrics, cut lists, and the blind pack

All 12 runs exited 0. Each made one commit, touched only its ticket and left a clean tree. Round 2's rule against reading other branches held: the only branch command any of them ran was `git branch --show-current`.

### What I did
- **Round 2 heads:** `codex2/irwb-0NN`. **Round 3 heads:** `0985c7f`, `3010f02`, `2ad5c47`, `c28b445`, `06bdc7e`, `e1c1ff5`. The baseline commits stay recorded in the IRWB-001 review.
- **Rollouts.** Round 2 wrote six new work rollouts and seven approval sidecars (`various/sources/round2-*.txt`). Round 3 appended a second turn to each baseline rollout. I split that turn into its own file at the second `task_started`, keeping `session_meta`, and extracted all three rounds with `scripts/01` (the regex now accepts `codex2-`).
- **Blind pack:** `scripts/04-blind-pack.mjs` writes 18 docs under shuffled names, seeded, with frontmatter and round 3's appended cuts section stripped. The key is `various/results/blind-key.json`.
  - **Bug fixed:** the first version matched `cut` inside "Exe*cut*ive summary" and cut baseline IRWB-014 to 10 words. The pattern now takes whole words and only the last matching heading.
- **Judge:** a fresh general-purpose agent, sandboxed to the pack directory, scores against `scripts/05-judge-rubric.md`.
- **Content metrics:** `various/results/content-metrics-rounds.json`.

### What I learned
| round | mean words | error-contract sentences | no-write guarantees | minutes | node probes |
|---|---:|---:|---:|---:|---|
| baseline | 3,419 | 10.9% | 2.0 | 5.7–8.6 | 0, 1, 0, 5, 0, 6 |
| round 2 (brief) | 2,064 | 3.9% | 0 | 6.8–9.3 | 8, 8, 6, 4, 4, 1 |
| round 3 (self-review) | 1,657 | 8.7% | 0 | 2.6–4.1 | — |

- **Round 2 found the framework gaps.** All four frame-array designs (012–015) found the tape requirement. Chess proposed the `entries` wiring ("Small loader change") with two checked entries and measured statement counts: pinned en passant perft 9,206; promotion search 12,054–12,953 at budget 2; opening perft over 20,000. Status codes appear 1–3 times per doc and fuel not at all. "Simplest alternative" shows up only as hypothetical "would" clauses: 0–1 uses of the word "alternative" and contrast markers at 0–0.56 per 1,000 words. The system prompt's writing rules still shape the prose.
- **Round 3 shortened more but kept more of the error contract.**
  - The VM dropped its status codes and output buffer but kept fuel.
  - LZ kept the escape token and the policy buffer.
  - Chess kept the per-function fixture regime: "The stock checks need coherent inputs for every function."
  - Some cuts simplified the program itself: regex lost grouping, SHA lost multi-block input, the DSP lost a filter section. The judge's A4 score should show whether that cost optimization value.
- **Tokens.** Output per run is 13.5–26.8K, and reported reasoning 1.7–5.2K. Most of the 1.7–4.1M total is cached input.

## Step 5: blind judge results and figures

A fresh agent scored the 18 shuffled docs against `scripts/05-judge-rubric.md`. It worked only from the pack directory and was told nothing about rounds or the hypothesis. Its scores are in `various/results/judge-scores.json`, and every quote is verified verbatim by script, by the judge itself.

### What I learned
| round | over-engineering (0–10) | fitness (0–10) | R1 error values | R2 memory-on-error | R3 domain widening | R4 self-guard tests | A1 implementability | A4 optimization value |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 6.33 | 6.67 | 16 | 12 | 17 | 61 | 4.50 | 4.50 |
| round 2 (revised brief) | 1.00 | 8.67 | 0 | 0 | 0 | 0 | 4.83 | 4.67 |
| round 3 (self-review) | 3.17 | 7.33 | 3 | 4 | 11 | 23 | 4.67 | 4.67 |

R1–R4 are summed over the six docs; the other columns are means.

- **I spot-checked the judge.** Baseline VM (G): 9 error values, which matches my count (10 statuses including success).
- **R7 ("designed around a missing piece") was marked yes on two round-2 docs.** Both quote the `oneOf` scalar-only limit (VM: "would require a buffer-valued choice spec"; chess: "would require extending the current input generator"). Chess round 2 also proposes forwarding `entries` through `ProjectMeta` and `Program.fromProject`. So even the leanest designs run into the input-generator limit.
- **Simplifying did not cost optimization value:** A4 went from 4.50 to 4.67 in both rounds.
- **Alternatives:** round 2 weighs them, at 1.37 "would … but" constructions and 0.57 "simpler/easier" per 1,000 words. Baseline and round 3 have 0 of each.
- **Figures** (`scripts/06-figures.py`, dataviz reference palette slots 1–3, validated with a worst adjacent CVD ΔE of 12.6): `various/figures/irwb018-rounds.png` and `irwb018-style-markers.png`.

### What warrants a second pair of eyes
- **The rubric's R items come from my review.** Round 2 was told rules covering the same categories, so its zeros are partly built into the comparison. The less circular evidence:
  - fitness and A1/A4, which a design that went too far would lose;
  - the discoveries the rubric does not measure: tape ingest found in 4 of 4 frame-array designs, and the `entries` wiring proposed.
- **The judge is not fully blind.** Round-2 docs have "Later" sections and similar lengths, and the judge is a Claude model, as I am.

## Step 6: vault report 10 and the playbook with a reusable script kit

The report is written, its claims are checked, and it is pushed. While I worked, the user asked for more: "also write a playbook in the parc vault (look for the playbook locations) about how to run this kind of judging / review and also store scripts in there that might be useful. that way we can redo this kind of optimizing prompting for say, models that tend to overengineer, in other projects".

### What I did
- **Report:** `go-go-parc/Projects/2026/11/26/PROJECT REPORT - IR Workbench - Codex Agents as Designers - …md`, with figures `_assets/irwb018-rounds.png` and `irwb018-style-markers.png`. Vault commit `4941518`, pushed.
- **Corrections before committing,** each checked against the sources:
  - only chess measured its sizes; the regex agent's run was a feature probe, not sizing;
  - round-2 probe counts are 1 to 8, not 4 to 8;
  - three baseline runs used `node`, not two;
  - five integer programs carry the integer-only tolerance-ticket row, not four;
  - the measurement-record phrasing appears in five designs, not six;
  - I removed the claim that the judge found no algorithm too large, because the rubric does not score algorithm size;
  - I verified that every agent's second command searched for `AGENTS.md`.
- **Playbook location.** Playbooks live in `Research/playbooks/<area>/PLAYBOOK - ….md` with `scripts/<name>/`, following `infra/`. I created `Research/playbooks/agents/PLAYBOOK - Measuring and Reducing Over-Engineering in Agent-Written Designs.md` and `Research/playbooks/agents/scripts/agent-design-review/`:
  - `00`: env;
  - `01`/`02`: fresh and resumed Codex rounds, recording `heads.json`;
  - `03`: rollouts, turn cutting, sidecars by time window;
  - `04`: context extraction;
  - `05`: content metrics with replaceable families;
  - `06`: blind pack;
  - `07`: quote verification;
  - `08`: aggregate;
  - `09`: figures;
  - `10`: contamination check;
  - five templates;
  - a README.

  Vault commit `e2692e1`, pushed.
- **Tests on the IRWB-018 data,** in the scratchpad (`kit-test/`):
  - `03`/`04` reproduce the extraction: baseline tool calls 21, 22, 20, 29, 23, 27, and the same minutes;
  - `06` reproduces the pack's word counts exactly;
  - `08` reproduces the report's table;
  - `07` finds 183 of 183 judge quotes;
  - `10` reports round 2 clean.

  The launchers were tested with a stub `codex` in a throwaway repo: worktrees, logs and `heads.json` all work, and the resumed round records its new heads.

### What didn't work at first
- **The baseline turn wasn't cut off.** The first `03` used a resumed baseline rollout whole: IRWB-012 showed 29 calls, where its baseline turn has 21. `03` now always cuts to the requested turn, by default turn 1.
- **`07` reported 9 of 183 quotes missing.** It had stripped every bracketed span, including regex classes like `[c-a]` in the documents. It now drops a bracketed span only when the document does not contain it.
- **`10` flagged `~/.codex/skills/` paths** for a round named `codex`. A branch reference now has to follow whitespace, a quote, `:` or `=`.
- **The probe count overstated probing.** `04`'s "probes" counted `python3` heredocs that edit files, so the field is now `interpreterRuns`.

### Corrections ledger
- **Diary step 4** said round 2 wrote "seven approval sidecars". With sidecars assigned by time window, round 2 had 5 and round 3 had 2. The round-3 resumes started in the same minute, in other worktrees.
- **The playbook's first draft** said Claude Code subagents live inside the parent transcript. They have their own `<session>/subagents/agent-<id>.jsonl`. Fixed before commit.

## Step 7: the transcript-doc-friction-analysis skill updated from the go-minitrace repo

The user asked: "update the analysis skill, i think there should be an upated on in ~/code/wesen/go-go-golems/go-minitrace".

### What I did
- **Found the newer copy.** `go-minitrace/skills/transcript-doc-friction-analysis` was last changed in `395d27a` (2026-11-18), in "Cut over query execution and publish the local JS API". Its verbs use `mt.sources().runtimeArchives()` and `db.execute(mt.sql\`…\`)`. All five verbs run on the installed binary (built 2026-11-24) over the IRWB-018 archives, with no errors.
- **Merged instead of copying.** The installed copy (2026-09-10) had refinements the repo lacks:
  - version-aware help checks;
  - sideloads and probes treated as candidates, not proof;
  - "An opinion/report request does not authorize edits";
  - caveats on compaction and on Codex adapter observations;
  - the September content-quality finding.

  The merge keeps the repo's API, `unknown_outcomes` and completeness content, and re-applies those refinements.
- **Added what this ticket verified:**
  - the Codex resume trap (turns appended to one rollout; sidecars assigned by time window);
  - a pointer to the go-go-parc agent-design-review playbook for instruction experiments;
  - interpretation item 8: Codex injects AGENTS.md as the first user message, which `episodes` opens as an empty first episode, and Codex reasoning is encrypted.
- **Installed it** in `~/.claude/skills` and `~/.codex/skills` (backups in the scratchpad). The standard profile runs from the installed path: 5 of 5 verbs, 0 errors.

### What should be done next
- **Not changed, with the user's agreement pending:**
  - the go-minitrace repo's own copy, which would need the merged refinements as a change there;
  - `go-minitrace-transcript-analysis` (3 files differ);
  - `daily-log` (8 files differ).
