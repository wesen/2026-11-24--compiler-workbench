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

## Step 8: global AGENTS.md cleanup, round 4 (the policy as developer_instructions), and the policy in the Codex config

The user asked: "ok, clean it up. All my AGENTS.md are a bit old so don't take them too seriously. remove the bootstrap part. and then yes do it. and then actually start implementing and watching what the subagents do, because I suspect they will still overindex on testing and overcautious frameworking". "Yes do it" answered my offer to run the six-agent round with the policy as `developer_instructions`. Round 4 kept the baseline brief exactly (`diff` against `00-common.md`: identical) and moved only the general part of the policy into a developer message. The question was how much of round 2's effect a project-independent instruction carries.

### What I did
- **Rewrote `~/.codex/AGENTS.md`** (backup `~/.codex/AGENTS.md.2026-11-26.bak`). Bootstrap was removed and the docmgr path corrected. The rest was grouped under "Everywhere", "Go repositories (a `go.mod` at the root)" and "Web front ends". This is a confound for round 4, whose global AGENTS.md is no longer the Go-only one.
- **Added `DEV_INSTRUCTIONS_FILE`** to the kit's `01`/`02` launchers. The file is passed as `-c developer_instructions=<JSON string>`; a JSON string is also a valid TOML basic string. Tested with quotes and backslashes against the stub `codex`.
- **Ran round 4** (`d91f3e3`, `scripts/07-launch-round4.sh`, base `d521d97`). It used `prompts/developer-instructions-round4.md`, the general block plus one isolation line. All six exited 0, with one commit each and nothing outside their tickets. The extracted skills catalogue starts with the policy in all six. IRWB-017's context differs only by an extra `mcp__playwright` line in its tool list.
- **Blind-judged round 4 against round 2** with a second judge instance. It used the same rubric plus the counting conventions from the first judging, and a new pack (seed 44). The judge's 52 quotes were verified verbatim by `07-verify-quotes.mjs`.

### Results

| round | over-engineering | fitness | R1+R2 | R3 | R5 | R7 yes | R8 | words | testing % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (judge 1) | 6.33 | 6.67 | 28 | | | | | 3,419 | 19.7 |
| round 2 (judge 1) | 1.00 | 8.67 | 0 | | | | | 2,064 | 16.8 |
| round 2 (judge 2) | 1.17 | 8.83 | 0 | 3 | 0 | 2 | 2 | 2,064 | 16.8 |
| round 4 (judge 2) | 3.00 | 7.33 | 0 | 4 | 5 | 4 | 12 | 2,832 | 20.9 |

- **The general layer removes the error contracts completely.** R1 and R2 are 0 in round 4, as in round 2. In the content metrics, error-contract sentences fall to 5.0%, against 10.9% in the baseline.
- **The remaining excess is the scope the project brief controlled.** That is extra input profiles (R8, 12), measurement plans beyond the primary metric (R5, 5) and designing around a missing piece (R7, 4 of 6). The general block deliberately lacks the brief's "leave out alternate input profiles and measurement methodology" line and its word target.
- **Judge 2 reproduces judge 1 on round 2** within 0.17 points, so the two scales are comparable.
- **Testing share is not reduced by either policy.** It is 16.8% in round 2 and 20.9% in round 4, against 19.7% in the baseline.

### The policy in the Codex config
I added the general block to `~/.codex/config.toml` as top-level `developer_instructions` (backup `~/.codex/config.toml.2026-11-26.bak`, it parses with `tomllib`). A fresh low-effort session (`01a218e0-7dee-7da2-baa2-e51f32c270b6`, run with stdin closed) has the policy in developer message 1. A first attempt without `< /dev/null` hung on "Reading additional input from stdin...".

## Step 9: the implementation round (six Codex implementers)

### Prerequisites
- **`6ad38d0`:** `project.json`'s `ingest` and `entries` reach `Program.fromProject`, `ingestProject`, `runPipeline` (`roots`), the browser `kernelFor`, and `tools/parity.mjs`. Four tests are in `tests/typed/project-meta.test.mjs`. My first version of the test misused the API (`exec('entry', 3)` instead of `[3]`, `check().map` instead of `check().fns`). The 26 tests in the six nearest suites pass.
- **`77ad469`:** merged the six round-2 design branches (ticket directories only, checked) as the designs to implement.
- **`a76ead3`:** the brief `prompts/impl/common.md`.
  - Implement as designed and record deviations.
  - Run only your own tests, never `npm test` or Candela.
  - Do not modify `src/`, `tools/`, other projects or existing tests.
  - The brief says nothing about test volume, on purpose.

  Developer instructions: the policy plus an isolation line.
- **`11-snapshot-round.mjs`,** added to the vault kit (`2a10c6e`), snapshots every five minutes:
  - lines per category from `git diff --numstat` plus untracked files;
  - test cases, assertions, helper functions;
  - edits under `src/` and `tools/`;
  - from the live rollout: minutes, test runs and the latest commentary.

### Results (`various/results/impl-metrics.json`)

| item | min | source + | test + | harness + | test/source | test blocks | asserts | test runs | bookkeeping cmds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| IRWB-012 VM | 5.9 | 58 | 231 | 21 | 3.98 | 3 | 35 | 2 | 4 |
| IRWB-013 SHA/ChaCha | 7.5 | 245 | 170 | 33 | 0.69 | 2 | 18 | 2 | 11 |
| IRWB-014 LZ | 5.9 | 86 | 177 | 12 | 2.06 | 2 | 18 | 3 | 9 |
| IRWB-015 regex | 4.8 | 101 | 136 | 10 | 1.35 | 2 | 19 | 3 | 13 |
| IRWB-016 DSP | 5.7 | 77 | 267 | 27 | 3.47 | 3 | 23 | 4 | 11 |
| IRWB-017 chess | 8.7 | 625 | 51 | 272 | 0.08 | 4 | 12 | 4 | 16 |

- **Nothing outside scope.** No agent touched `src/` or `tools/`. Three added their id to `corpus/projects/index.json`, which the brief allowed.
- **All checks passed in the agents' own runs.** `tools/parity.mjs` agreed on every case in all six: 100, 200, 400, 100, 300 and 200 cases.
- **Test volume follows the design.** The designs' oracle sections prescribe the matrix (for example IRWB-012's 442-combination replay, and IRWB-016's binary64 oracle with a −100 dB bound). No implementation added layers beyond its design.
- **One matrix, six times.** All six test files check the evaluator, RV32 images, the `speed` pipeline, the reference compiler and a workbench run. Five of six built the same private helpers for this: `evalCase`/`imageCase`/`checkedSpeed`/`assertCompleted` and the like, 4 to 17 functions per file.
  - Three layers duplicate corpus-wide tests that already cover every project: image agreement at r0 (P2.4), reference agreement (P2.6) and the O2 pipeline (parity).
  - The agents could not know this. Nothing in the repository says what the corpus-wide tests cover, and the brief kept them away from those tests.
- **Four of six worked around `tools/reference-check.mjs` ignoring its project argument.** The brief forbade fixing `tools/`, so this was the right call under the brief, and they recorded it as a deviation.
- **Bookkeeping is the largest command class** (4 to 16 commands, about a third), more than tests (2 to 4 runs).
- **Optimizer measurements:**
  - `speed` makes the VM slower (Fibonacci 7,678 → 9,286 instructions; checksum 6,874 → 8,218), against 75 and 74 for the hand-specialized loops.
  - Regex: 8,040 after `speed`, against 6,628 with the reference compiler.
  - LZ: 157,682 against 156,405.
  - Chess: 10.08M, below the reference's 10.83M.
  - SHA: 220.4 → 124.4 instructions per byte; ChaCha 120.2 → 53.1.
  - Scalar specialization does almost nothing: FFT length 4,065 → 4,064; LZ `chainLimit` 54,993 → 54,959.

## Step 10: integration: eight corpus-wide failures, their causes, and a resumed fix-up turn

Merging the six implementations (`4cfbf5f` to `fea7941`) was clean except `corpus/projects/index.json`. My first resolver tried to parse the diff3 conflict text as JSON and failed. The second took the union of `order` from stages `:2` and `:3`. The full suite under the memory cap gave 397 tests: 386 pass, 8 fail, 3 skipped.

### The failures
1. **Stale totals:** P2.4 (44 → 50 projects, 70 → 135 functions), A1 (`[70, 794]` → `[135, 3322]`), P4.2 (20 → 22 checked tape lifts), wb scripts (46 → 52), `build:site` (44 → 50 projects). Every per-function assertion in them passed.
2. **Loaders that ignore `ingest`:** P2.3 (`evaluate-analyses.test.mjs`, which also read only `main.typed`) and the P2.4 loader in `backend.test.mjs`. Both failed with `unknown tape opcode 252`.
3. **P2.6: 100 disagreements, all `f32-dsp`'s `dot3`.** Every `got` equalled the first argument's bits. The test built the reference image with `imageFromCode(id, r.image, r.entries)`, without `r.signatures`, so `runImage` read `a0` for an ilp32f function that returns in `fa0`. This was a gap in the test harness, exposed by the first corpus entry that takes f32 scalars. With signatures, 8,286 of 8,286 decided cases agree.
4. **Tile widths:** `.typed`/`.js` files up to 108 columns (the limit is 80), `project.json`/`notes.md` over 73. `tools/format-corpus.mjs` refused chess's `notes.md`: `wrapProse` re-wraps an already-wrapped list item line by line, drops the continuation indent, and splits the item. This bug is pre-existing and not fixed here.

### What I did
- **`d2e198f`:** fixed 1 to 3 in the tests (loaders honor `ingest`; P2.6 passes `signatures`; totals updated).
- **Resumed each implementer for the widths** (`87f583c`, `scripts/09-resume-impl-format.sh`, `prompts/impl-fmt.md`) rather than reformatting their Typed code myself. I reverted my own formatter run in the main checkout first, so their commits would merge cleanly.
  - All six fixed their files in 0.9 to 3.8 minutes.
  - All six had to rerun `format.test.mjs` outside the sandbox, because it spawns `node` (EPERM).
  - Chess also updated its test for moved lines.
- **Merged the fixes** (`411a278`). The full suite is now 397 tests: 394 pass, 0 fail, 3 skipped.

### What I learned
- **A repository's conventions belong in a repo AGENTS.md, together with the list of checks a new project must pass.** The 80-column rule and the coverage of P2.4, P2.6 and parity were invisible to agents told not to run corpus-wide tests. They would have needed one paragraph.
- **Keeping agents off shared code moves the cost to integration.** Every workaround the agents recorded (reference-check, loader, widths) reappeared there. A narrow "you may fix X" in the brief is cheaper than a ban on `tools/`.

## Step 11: follow-up research directions, and the GPU machine

The user asked what compiler-framework research to give Sol next, pointing at the earlier A–E programme, and then said they want to try a different language or backend for CUDA/GPU work "to use / test / improve our v6 framework", using `manuel@bling.local`.

- **Laptop:** Intel Iris Xe only, PyTorch 2.11 CPU. `torch.export(...).run_decompositions()` of a LayerNorm + attention + MLP block gives 40 Core ATen nodes with 11 distinct operators (`view` 16, `permute` 6, `addmm` 5, `expand` 4, `bmm` 2, `add` 2, `native_layer_norm`, `_softmax`, `gelu`, `div`, `getitem`).
- **bling:** NVIDIA GB10 (sm_121), 121 GB unified memory, aarch64, CUDA 13.0 `nvcc`, no torch or triton. An axpy in a `mktemp -d` compiled in 0.59 s and ran correctly (`y[3]=34`), 1.37 ms for 2^24 floats, 147.5 GB/s; the directory was removed afterwards.
- **Proposed to the user:** a tensor → CUDA domain on the same `src/framework`, with every framework change as the primary metric, tickets G1 to G4. Awaiting their decisions on code location, a torch install on bling, and launching designers.
