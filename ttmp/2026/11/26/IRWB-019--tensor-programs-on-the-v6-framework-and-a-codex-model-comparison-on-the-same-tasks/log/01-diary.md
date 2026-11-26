---
Title: Diary
Ticket: IRWB-019
DocType: log
Topics: [tensor, gpu, compiler, ir, agents, verification]
Status: active
---

# Diary: tensor programs on the v6 framework, and a Codex model comparison

## Goal

Start a second domain on the IR framework in `src/framework/`: tensor programs written in Tix, an index-notation language, compiled eventually to CUDA on an NVIDIA GB10 (`manuel@bling.local`). The domain exists to test and improve the framework. Every change it forces in `src/framework` is a finding. The stages are designed and implemented by Codex agents, run as a matrix of models and reasoning efforts on the same briefs, so that the same tasks give a model comparison.

## Step 1: setting up stage 1 and a research round on a 2×2 model matrix

The user's request (verbatim): "yes. all 3. Keep your own ongoing diary and vault report as they go, and have them write their own tickets / designs (which you should review) and then diary and ultimate vault report. as before. Experiment with some sol high and astra agents on the same tasks as well, to see how well they compare. don't hesitate to run multiple rounds, different agent matrixes, this is science. The harder the tasks / the more interesting the results / the more novel the compiler work, the better."

"All 3" approves three decisions from the previous turn:
- the code goes in `src/tensor/`, next to `src/typed/`, sharing `src/framework`;
- the input language is index notation (Tix);
- Codex designers are launched now.

The user had earlier ruled out Python as the input language ("I don't want to support python lol").

### Probes before the briefs
- **Laptop:** Intel Iris Xe only; PyTorch 2.11, CPU only. With an index language and an f64 evaluator as the oracle, the track needs no Python.
- **bling:** NVIDIA GB10, sm_121, 121 GB unified memory, aarch64, CUDA 13.0 `nvcc`, no torch. An axpy compiled in 0.59 s and ran correctly at 147.5 GB/s.
- **Codex sandbox to bling:** with `sandbox_workspace_write.network_access=false`, `ssh` fails with "Could not resolve hostname bling.local". With `=true`, it prints `bling` and `NVIDIA GB10`. The CUDA stage must pass that setting.

### Design of the experiment
- **Matrix:** gpt-6.2-sol and gpt-6.2-astra, each at medium and high effort, one agent per cell. Ticket letters are assigned at random (`various/results/*-config-key.json`), so the judge cannot tell configurations apart.
- **Same context for all:** the policy (`developer_instructions`, now also in `~/.codex/config.toml`) plus the worktree-isolation line. Base `19ad269`, before IRWB-019 exists, so no agent sees this ticket.
- **Stage 1 (IRWB-020-A..D):** the Tix front end, its IR as a v6 artifact, f32 and f64 evaluators, a meaning contract with exact and tolerance relations, two checked passes (`inline`, which is bit-exact, and `split-sum`, which reassociates), and a six-program corpus.
  - The brief fixes the language core (grammar, precedence, the reduction-body rule, the f32 meaning) and a three-function API (`compileTix`, `runTix`, `optimizeTix`), so that the four implementations can be scored by one hidden suite.
  - It also carries the lessons of IRWB-018: what is and is not already checked, named scope instead of a broad ban, the sandbox EPERM note, and the repository's conventions.
  - Turn 1 is design only. I review, the same session revises and implements, and each agent then writes its vault report draft.
- **Research round r1 (IRWB-021-A..D), design only:** can a compiler derive streaming attention (online softmax, the FlashAttention form) from the plain Tix attention program by a sequence of checked rewrites? The design must settle the rules, the missing IR construct (a reduction with a non-scalar state), the checking, the generality, and a falsifiable GPU experiment. It runs now because it depends on no code.

### Hidden acceptance suite
`scratchpad/t1-acceptance/acceptance.test.mjs`, outside the repository until the implementations are done. It checks:
- f32 bit-exactness and f64 closeness for the six programs, against hand-written JavaScript that follows the brief's rules literally;
- the reduction-body rule, precedence and unary minus, `max(a, b)` as a call;
- lexicographic order of a two-index reduction, with magnitudes chosen so that the order matters;
- several functions in one program;
- four compile errors with `line:col`;
- `optimizeTix` with `inline` (bit-identical) and `split-sum` (within 1e-4 of f64).

It has not yet been run against an implementation. If all four implementations disagree with it on the same test, the reference is the first suspect.

### Commits
- `d340dfe`: ticket, stage-1 brief and launcher.
- `fc06d50`: the r1 brief and launcher.

Both rounds were launched at about 13:5x. All eight agents started with the intended model and effort, according to the log headers.

## Step 2: the remote CUDA runner, Pi as a third factor, and the Codex design results

### The remote CUDA runner (`8c3eca3`, `ceee771`)
`tools/cuda-remote.mjs <dir> [--timed] [-- args]` copies a directory holding `main.cu` and its inputs to `bling:~/irwb-cuda/<hash>/`. The hash is the SHA-256 of the files and the architecture, so identical inputs compile once. It compiles with `nvcc -O3 -arch=sm_121`, runs `./prog args`, and brings `out/` back. `--timed` runs under `flock ~/irwb-cuda/.gpu.lock`, so concurrent agents do not disturb each other's timings.
- Test: an f32 map over 1,000 elements compiled in 0.52 s and ran with correct outputs (`y[999] = 500.5`).
- A rerun skipped the compile.
- `runMs` is about 370 ms, mostly CUDA context start-up; the kernel takes 1.3 ms.

I wrote this rather than leaving it to the stage-2 agents, so that every configuration has the same transport and the same lock.

### Pi as a third factor
The user asked: "oh, also compare how running gpt-6.2 sol/astra in the pi coding agent (different system prompt) compares", then "add that to your matrix".

- Pi 1.5.1 (`pi -p`, `--model openai-codex/gpt-6.2-sol|astra`, `--thinking medium|high`), with `--no-extensions --no-mcp`. The policy is passed with `--append-system-prompt`. Pi has no sandbox.
- **Pi's system message is a different object from Codex's.** Measured in a probe session, its sections are: preamble 126 characters, tools 274, rules 589, docs 1,320, the appended policy 1,346, skills 27,543, cwd. The harness's own text is about 2.3K characters, against Codex's 27,750-character system prompt. It has neither the coding rules nor the writing rules that IRWB-018 traced the over-engineering to.
- **The matrix is now harness × model × effort** (2×2×2), with eight agents per task. Pi tickets are E to H, assigned at random (`*-config-key.json`, now with a `harness` field).
- **Kit additions** (vault `91acd15`): `12-launch-pi-round.sh`, `13-resume-pi-round.sh`, `14-extract-pi-sessions.mjs`. Each was tested on a scratch repository before use.
- **A failed first launch:** `S=ttmp/.../IRWB-019*/scripts/...` does not expand the glob in a zsh assignment ("No such file or directory"). The relaunch used `$(ls …)`. The earlier exit monitor had failed for the same family of reason, a zsh "no matches found" on not-yet-existing files, and was re-armed under `bash -c` with `nullglob`.

### Codex designs (turn 1)

| round | item | minutes | tool calls | commands | skill files read | design words |
|---|---|---:|---:|---:|---|---:|
| t1-sm | IRWB-020-C | 5.2 | 17 | 15 | docmgr, diary | 2,588 |
| t1-sh | IRWB-020-A | 8.2 | 22 | 42 | docmgr, diary + 2 references | 2,876 |
| t1-am | IRWB-020-B | 4.7 | 13 | 10 | docmgr, diary | 2,577 |
| t1-ah | IRWB-020-D | 7.4 | 29 | 15 | none | 2,765 |
| r1-sm | IRWB-021-D | 4.9 | 20 | 31 | docmgr, diary + references | |
| r1-sh | IRWB-021-B | 6.1 | 18 | 32 | docmgr, diary + references | |
| r1-am | IRWB-021-C | 4.2 | 15 | 11 | none | |
| r1-ah | IRWB-021-A | 7.9 | 27 | 19 | none | |

- Every agent made one commit, inside its own ticket.
- Astra read no skill file in three of four cells; Sol read them in all four.
- Judging and reviewing wait for the Pi cells, so that all eight documents of a task are scored and reviewed together.

## Step 3: the Pi designs, xhigh added (12 cells), the backlog and the playbook draft

### Pi design results (turn 1)

| round | item | minutes | tool calls (read / bash / edit / write) | skill files read | design words |
|---|---|---:|---|---|---:|
| t1-pi-sm | IRWB-020-F | 6.0 | 50 (21 / 10 / 17 / 2) | docmgr, diary, git-commit-instructions, … | 2,832 |
| t1-pi-sh | IRWB-020-G | 6.1 | 44 (25 / 9 / 10 / 0) | docmgr, diary, git-commit-instructions, … | 2,827 |
| t1-pi-am | IRWB-020-E | 3.4 | 19 (12 / 6 / 1 / 0) | diary, docmgr, git-commit-instructions, … | 1,815 |
| t1-pi-ah | IRWB-020-H | 5.0 | 32 (24 / 5 / 0 / 3) | docmgr, diary, investigation-entry, git-commit-… | 2,937 |
| r1-pi-sm | IRWB-021-H | 4.8 | 31 | docmgr, diary, git-commit-instructions, … | |
| r1-pi-sh | IRWB-021-G | 6.3 | 42 | docmgr, diary, investigation-entry | |
| r1-pi-am | IRWB-021-F | 3.4 | 14 | docmgr, diary, investigation-entry | |
| r1-pi-ah | IRWB-021-E | 4.9 | 20 | docmgr, diary, investigation-entry | |

- **Skills: a harness × model interaction.** Under Codex, Astra read no skill file in three of four cells. Under Pi, Astra read docmgr and diary in all four. Pi's catalogue tells the model to "Use the read tool to load a skill's file when the task matches its description". The harness's instruction appears to matter more than the model here.
- **Pi agents read through the `read` tool** (12 to 25 reads) and run few shell commands (5 to 11). Codex agents run everything through shell commands. Three of four Pi stage-1 agents also loaded `git-commit-instructions`, which no Codex agent read.
- **Every Pi agent made exactly one commit, inside its ticket.** Pi has no sandbox, so this is the isolation line alone.
- **The first attempt failed without effect** (the glob in an assignment, step 2). The relaunch ran all eight.

### xhigh
The user asked: "ok, add xhigh to the matrix". There are four new cells per task: Codex and Pi, each with Sol and Astra at xhigh. The tickets are I to L, assigned at random:
- t1: L = Codex Sol, I = Codex Astra, K = Pi Sol, J = Pi Astra;
- r1: I = Codex Sol, J = Codex Astra, K = Pi Sol, L = Pi Astra.

`scripts/07-launch-xhigh-design.sh` (`9484654`) runs them with `AGENT_TIMEOUT=7200`. All eight started with the intended settings (log headers and session `thinking_level_change`). Judging and review wait for them, so that each task's twelve designs are scored together.

### The backlog and the playbook draft
- The user asked for the research tasks in "some kind of 'things we can work on' file, for the v6 framework/workbench", and then for "information on what is meant to explain wat you currently know, what research is needed, etc...".
  - `BACKLOG.md` at the repository root (`1e5a236`, restructured in `6694039`) has an index, then one entry per item: what we know (measurements and sources), what we don't know, approach, measure, dependencies.
  - It covers the tensor stages T1 to T8, Typed research D1, D2, B1, B2, A0, A1, C1 and E1, twelve framework fixes (F1 to F12), and methodology (M1 to M5).
- The user asked: "also keep a playbook draft as you go, updating it as you refine or extend your techniques".
  - Vault `e6fc169`: `Research/playbooks/agents/PLAYBOOK - Comparing Coding-Agent Configurations on the Same Design-and-Implement Tasks.md` (`status: draft`).
  - The preference is recorded in memory, alongside the diary and report cadence.

## Step 4: Claude cells, and coordinator scripts to keep the overhead small

### The user's instructions while away
- "I'm gonna go swim, so blast through all this stuff, research, improve, keep an eye on overengineering an dimproving prompting for the sol agents, and in fact, also launch a bunch of claude opus (low medium high extra high) and fable (low medium high xhigh) as well, but be a bit more restrained on those."
- "like, don't launch a whole fleet, keep an eye on usage".
- "don't forget to update documents as they go, since we have so much going on. whatever scripts you can write to make your job easier and more token efficient is good too" / "(like when keeping an eye on the agents, etc...)".

### Claude cells
- **A headless run was blocked.** `claude -p --model claude-fable-5-2 --effort low --dangerously-skip-permissions --output-format json …` was denied by the auto-mode classifier as "[Undermining Oversight]". I did not try to route around it.
- **The sanctioned route** is the coordinator's Agent tool, with `model` and `effort`. Effort is allowed here because the user named the levels.
- **Restraint:** four cells, on t1 only:
  - Opus 5.5 at medium (IRWB-020-N) and xhigh (M);
  - Fable 5.2 at medium (P) and xhigh (O).
  
  They span both models' effort ranges. `low` and `high` are left for later if usage allows. No Claude cells run in r1.
- **Setup:** I created each worktree at `19ad269`. Each brief is in a file outside the repository (`scratchpad/claude-briefs/`), so an agent pointed at it does not wander into IRWB-019's keys and rubrics. The prompt itself is three lines that point at the brief. The agent ids are stored in `t1-config-key.json`, for `SendMessage`.
- **Confounds:**
  - Claude Code's subagent prompt, rather than its CLI prompt;
  - the policy in the task text, rather than in the system prompt;
  - "start every command with `cd <worktree> && `", because subagent shell state does not persist.

### Scripts (`1216cd7`, `2a9b285`; vault kit `CODEX_EXTRA`)
- **`08-status.mjs [task]`:** one line per agent, across 28 agents, all harnesses. It shows state, commits, design words, lines added per area (`src/tensor`, `tests/tensor`, `corpus/tensor`, `src/framework`), other paths touched, and the last commit subject. It replaces about ten ad-hoc commands per check.
- **`09-judge-pack.sh <task> <dir> <rubric>`:** writes missing `heads.json` (Claude cells), runs the kit's blind pack, renames the key to `blind-key-<task>.json` (the kit writes a fixed name), and copies in the rubric and the brief with the ticket id neutralized.
- **`10-dispatch-turn.sh <task> <turn> <template> [reviews] [--only …] [--network]`:** builds one prompt per agent from a template, with `<REVIEW>` filled from that agent's blind review. It resumes Codex cells with `02-` and Pi cells with `13-`, and writes the Claude cells' prompts for `SendMessage`.
- **The kit's `01`/`02` take `CODEX_EXTRA`,** for example `-c sandbox_workspace_write.network_access=true`, which the GPU stage needs.
- **`various/prompts/t1/turn2.md`** (`0d8cd78`): the review, then revise (keeping and justifying any disagreement), implement, check (own tests; framework tests if the framework changed; never `npm test`), and the final message.

## Step 5: the "Astra skips skills" finding was an extractor artifact; the first Claude designs

- **The artifact.** The user asked which skills, and how Astra managed without them.
  - The rollout of IRWB-020-D (Codex, Astra, high) shows `cat ~/.codex/skills/diary/SKILL.md` and `cat ~/.codex/skills/docmgr/SKILL.md` as `CommandExecution` events. They were issued inside one code-mode script, as an array mapped over `exec_command`. The regex extractor only matches `cmd: "…"`.
  - Recounted from the events, all twelve Codex cells read docmgr and diary, with reference files, on both tasks.
  - Astra runs more commands than Sol (71 to 84 against 43 to 48 at high and xhigh), batched several per tool call.
  - Steps 2 and 3 of this diary are wrong on this point. The kit's `04-` and `11-` are fixed (vault `a377c40`). IRWB-018's report numbers that depended on the old count were recounted and corrected (IRWB-018 step 12).
- **Claude designs, turn 1:**
  - IRWB-020-N (Opus, medium): 136K subagent tokens, 27 tool uses, 8 minutes.
  - IRWB-020-P (Fable, medium): 169K, 24, 13 minutes.
  - Both propose the same two framework changes, found by probing the built framework with a toy second domain, and both changes are in `src/framework/passes/define-pass.ts`:
    - `applyPass` always opens an IR edit, which throws "is not Rewritable" for an adapter without `rebuild`, even when the pass never edits;
    - checked application is async-only, while `optimizeTix` is synchronous, hence an `applyPassSync`.
  - Fable also measured that a fixed relative tolerance does not separate correct from wrong programs: correct programs reach 9.9e-3, wrong ones go down to 1.6e-6. It proposes a running first-order error bound instead.
- **Claude usage** is logged per turn in `various/results/claude-usage.json`.

## Step 6: research round r1 scored: a ceiling

A blind judge (Claude subagent, 202K tokens) scored the twelve r1 designs with `scripts/04-judge-rubric-r1.md`. It verified the mathematics rule by rule, re-ran every numeric example the documents quote, and checked its own quotes. I re-verified the quotes independently: 86 of 86. The kit's `07-verify-quotes.mjs` found 0 of 0, because it expects the t-rubric's quote layout; the check was done inline instead.

| cell | doc | words | M5 | M6 | M7 | over-eng. | overall | errors |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Codex Astra medium | E | 2,555 | 5 | 5 | 4 | 2 | 8 | 0 |
| Codex Astra high | J | 3,551 | 5 | 5 | 5 | 3 | 9 | 0 |
| Codex Astra xhigh | D | 3,587 | 5 | 5 | 5 | 4 | 9 | 0 |
| Codex Sol medium | H | 2,706 | 3 | 4 | 3 | 2 | 7 | 1 minor |
| Codex Sol high | C | 3,107 | 5 | 4 | 4 | 2 | 8 | 0 |
| Codex Sol xhigh | I | 3,067 | 5 | 4 | 4 | 2 | 8 | 0 |
| Pi Astra medium | G | 1,992 | 5 | 5 | 4 | 1 | 8 | 0 |
| Pi Astra high | B | 2,898 | 5 | 5 | 5 | 3 | 9 | 0 |
| Pi Astra xhigh | K | 4,112 | 5 | 5 | 5 | 4 | 9 | 0 |
| Pi Sol medium | L | 3,120 | 5 | 5 | 4 | 3 | 8 | 0 |
| Pi Sol high | A | 3,313 | 5 | 5 | 5 | 3 | 9 | 0 |
| Pi Sol xhigh | F | 3,874 | 5 | 5 | 5 | 3 | 9 | 0 |

- **M1 to M4 are 5 for all twelve.** No design got the core identity wrong. All handle the empty prefix with a tag rather than −∞, apply both rescale factors, and prove associativity on reachable summaries. The question has a well-known answer, so it saturates the rubric.
- **The differences are small, and each cell has one run:**
  - Pi 8.67 against Codex 8.17;
  - Astra 8.67 against Sol 8.17;
  - medium 7.75 against 8.75 for both high and xhigh.
- **Length and over-engineering rise with effort:** 2,593 → 3,217 → 3,660 words and 2.00 → 2.75 → 3.25.
- **The lowest cell is Codex Sol medium** (7, one minor error: it claims to reach softmax-then-contraction without an inlining rule).
- **The judge's strongest idea:** split the merge into two lemmas (rebase each block sum at its own maximum, then fold the pairs). Docs D, F, J and K do this, and K abstracts it to a scale-transport law, r(u,u) = 1 and r(u,v)·r(v,h) = r(u,h).
- **Methodology lesson:** a design-only research question with a known answer cannot separate configurations. A harder round needs an open question, or scoring by implementation. T5 (implement the derivation and measure GPU time) is the objective version of this one.

## Step 7: the Opus xhigh design, a false "rewritten on disk" claim, and a wrong test command in my brief

- **IRWB-020-M (Opus, xhigh):** 261K subagent tokens, 43 tool uses, 22 minutes, 5,443 words. It proposes the same two framework changes as the other Claude cells (lazy edit, `applyPassSync`) and a third: per-case measures in differential evidence, so that an accepted tolerance check can report its worst margin.
- **Its report said** "after my first write, something else reworded the design doc on disk into bullet form", and its diary step 3 says the same. I checked:
  - no hooks in `~/.claude/settings.json`;
  - no file-write hooks in any installed plugin;
  - no git hooks;
  - no other agent's command or tool call touched its worktree (all Codex and Pi command extracts, and the three other Claude transcripts).
  
  Its transcript shows one Write of the design (18:19:55, 528 lines, 112 bullet lines). At 18:20:12 it ran its own Python replacement of three passages, and the harness then reported "changed on disk". The committed file has 530 lines and 112 bullet lines, a 99% line match with that Write. **Nothing external changed the file.** The agent misread the notice its own edit caused, and wrote the misreading into its diary as fact. Its review will ask it to correct the diary.
- **The bug in my brief it found:** `node --test tests/framework/` fails on Node 24.18 ("Cannot find module '.../tests/framework'"); `node --test tests/framework/*.test.mjs` works. I gave all twelve OpenAI cells that command. `prompts/t1/turn2.md` now says `tests/tensor/*.test.mjs` and `tests/framework/*.test.mjs`, with the reason.
- **Claude usage so far (design turns):** 136K (Opus medium), 169K (Fable medium), 261K (Opus xhigh); Fable xhigh is still running.

## Step 8: stage-1 designs scored (16 designs, blind)

A blind judge (Claude subagent, 274K tokens) scored the sixteen t1 designs with `scripts/03-judge-rubric-t1.md`. I re-verified its quotes independently: 192 of 192. Scores are in `various/results/judge-scores-t1.json`, and the key in `blind-key-t1.json`.

| cell | doc | words | excess (R1–R6, R8) | over-eng. | fitness | A1 | A2 | A3 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Claude Fable medium | A | 4,940 | 13 | 3 | 9 | 5 | 5 | 5 |
| Claude Fable xhigh | I | 5,738 | 10 | 2 | 9 | 5 | 5 | 5 |
| Claude Opus medium | P | 4,052 | 10 | 2 | 8 | 5 | 5 | 5 |
| Claude Opus xhigh | L | 5,230 | 16 | 4 | 8 | 4 | 5 | 4 |
| Codex Astra medium | K | 2,509 | 5 | 2 | 8 | 5 | 4 | 5 |
| Codex Astra high | N | 2,670 | 7 | 2 | 8 | 5 | 4 | 5 |
| Codex Astra xhigh | D | 2,701 | 5 | 2 | 8 | 5 | 4 | 5 |
| Codex Sol medium | E | 2,510 | 8 | 3 | 7 | 4 | 4 | 5 |
| Codex Sol high | B | 2,764 | 7 | 4 | 7 | 5 | 4 | 5 |
| Codex Sol xhigh | O | 2,310 | 6 | 2 | 7 | 5 | 4 | 5 |
| Pi Astra medium | G | 1,747 | 6 | 3 | 7 | 5 | 4 | 5 |
| Pi Astra high | H | 2,836 | 11 | 4 | 8 | 5 | 4 | 5 |
| Pi Astra xhigh | M | 3,160 | 16 | 5 | 6 | 5 | 4 | 5 |
| Pi Sol medium | F | 2,748 | 14 | 5 | 7 | 5 | 4 | 4 |
| Pi Sol high | J | 2,739 | 13 | 5 | 6 | 5 | 3 | 4 |
| Pi Sol xhigh | C | 2,418 | 12 | 5 | 6 | 5 | 3 | 4 |

Means:
- **By harness:** Claude 2.75 / 8.50 (over-engineering / fitness), Codex 2.50 / 7.50, Pi 4.50 / 6.67.
- **By harness × model:** Codex Astra 2.00 / 8.00, Codex Sol 3.00 / 7.00, Pi Astra 4.00 / 7.00, Pi Sol 5.00 / 6.33.
- **By effort:** no consistent effect (medium 7.67, high 7.25, xhigh 7.33 fitness).

What the judge reported:
- **Semantic deviations were rare.** L's `max` rule rejects the valid `max(j) -x[i, j]`. E lets `x[i+0]` supply an extent.
- **The common contract weakness:** an abs+rel tolerance justified only as a heuristic. Only A, I, L and P justify their bound by an error argument or a measurement. C and J would let a correct `split-sum` on layernorm be rejected, because sampled eps ≤ 0 gives non-finite outputs.
- **The most common excess,** in 12 of 16: a general rational or linear shape solver for shape binding, which the corpus never needs. My brief's grammar allows affine dims in parameter types ("dim := affine expression of shape names and integers"), which invites a solver. The policy's "keep the input domain narrow" did not override the grammar. Other excess: coverage and budget failure rules, detailed counterexample evidence, NaN canonicalization, and in C, F and J a second synchronous contract verifier.
- **All 16 agree on the two framework gaps:** a synchronous entry point in `passes/define-pass.ts`, and the eager `beginEdit()`. Most found that `differential`/`runDifferential` carry both relations without change.

### Readings (one run per cell; suggestive)
1. **With the policy present, Pi over-engineers more than Codex** (excess 12.0 against 6.3; error conditions R1 4.7 against 3.0), although Pi lacks Codex's coding rule "handle the full range of supported inputs". The defensive defaults are partly the model's own. Something in Codex's context restrains them, plausibly the policy's rank as a developer message, or restraint elsewhere in Codex's prompt. This refines IRWB-018's attribution, which was measured without a policy.
2. **Sol is the weakest model in both harnesses.** This is the target for the prompting work (step 9).
3. **Claude designs are about twice as long, and score highest on fitness.** Their excess counts match Pi's, not Codex's.
4. **Unlike r1, this task separates configurations** (fitness 6 to 9). The fixed surface plus open choices (IR, contract, framework changes) left room for judgement.

### Claude implementations (usage restraint)
Only the two medium Claude cells implement: Opus N and Fable P. Medium is cheaper, and choosing by effort, not by score, avoids a best-of-two selection bias. The four Claude design turns cost 898K subagent tokens, and the judge 274K.

## Step 9: reviews checked, implementation dispatched, the Sol v2 round launched

- **The blind reviewer** (Claude subagent, 348K tokens, 73 tool uses) wrote one review per design, 315–349 words, following `scripts/06-review-protocol-t1.md`. It checked repository claims in a clean checkout at the base revision (`.claude/worktrees/review-19ad269`, no IRWB-019 files) and re-ran the split-sum rounding witnesses the designs quote.
- **I checked the four framework claims** most must-change items rest on, in the base checkout:
  - `applyPass` calls `view.beginEdit()` unconditionally (`src/framework/passes/define-pass.ts:204`).
  - The edit throws `ir.capability … is not Rewritable` without `rebuild` (`ir/transactions.ts:43`).
  - `ContractRegistry.register` throws "cannot be redefined" for a second object at the same id@version (`contracts/registry.ts:9`), and `applyPass` reports the throw as `contractRejected`.
  - `IRStore` throws `ir.unpublished` for an unknown revision of an artifact id it already holds (`ir/store.ts:52`), so the `store?` option some designs add breaks on native results.
  
  All four hold.
- **Blinding:** no review mentions another document. Each review's title named its own blind letter; the copies sent (`reviews-send/`) say "Review of your design". The reviews are archived in `various/results/reviews-t1/`.
- **Recurring review items:**
  - **Cut** a redundant inline-against-origin check (9 designs) and the general shape solver (12).
  - **Must change:** step budgets sized on the origin, which reject a correct `split-sum` (5); tests added to an existing framework test file (3); an unspecified positive `eps`, which makes layernorm non-finite and rejects a correct pass (B, C, G, J, M).
  - The reviewer found no must-change item in D (Codex Astra xhigh) or K (Codex Astra medium).
- **Implementation dispatched** with `10-dispatch-turn.sh t1 impl prompts/t1/turn2.md <reviews-send> --only …`:
  - the twelve Codex and Pi cells;
  - two Claude cells (Opus medium N, Fable medium P), sent by SendMessage.
  
  The Opus xhigh and Fable xhigh cells stop at design, for usage. Memory 46 GB free, 8 cores, so the agents will contend for CPU.
- **Sol prompting experiment (v2) launched:** the four Sol cells (Codex and Pi, medium and high) redesign stage 1 from the same base with `prompts/developer-instructions-v2.md`. v2 is v1 plus four rules aimed at what the judge counted:
  - support only the subset the corpus uses, and reject the rest with an ordinary error;
  - specify errors only by where they are detected and their message;
  - build one path per job;
  - justify every numeric threshold by an error argument or a measurement.
  
  Items Q–T (`scripts/11-launch-t1-v2.sh`). They will be judged blind in one session with the four v1 Sol designs, to avoid judge drift between sessions.

## Step 10: the hidden acceptance suite had an invalid test; the v2 designs are in

- **An invalid test in the suite.** Rereading the hidden suite against the brief before any implementation landed, the two-index reduction test used `y[q] = sum(i, j) x[i, j] * 1`. Here `q` has no use at all, and the brief says "an extent that cannot be inferred is a check error at compile time". A correct implementation must reject that program, so the test would have failed exactly the implementations that follow the brief.
  - Fixed: `y[q] = sum(i, j) x[i, j] * w[q]` with exact weights (1, −1, 0.5).
  - The test now asserts that its data distinguishes row-major from column-major accumulation. In plain JavaScript the two orders give 0 and −0.37.
- **The inline test did not exercise inlining.** The brief's `inline` substitutes "a pointwise statement with a single use". In softmax, layernorm and attention every pointwise statement has two or more uses, so only mlp could change.
  - Added two programs where inlining applies: a chain `t → u → sum`, and a transposed read `y[a, b] = t[b, a] / 7`, which catches a wrong subscript binding.
  - The corpus-program inline test is kept.
- **The suite also gained** a ragged `split-sum` case (matmul with K = 257, 7 and 1, in addition to 256) and a `log`/`min` test.
- v1 is kept as `acceptance.test.mjs.v1`. The suite stays in the scratchpad, outside the repository, until all implementations are done.
- **Lesson for the playbook:** a hidden suite needs the same reading against the brief as a design does. Writing it from memory of the brief introduced a test that contradicts a stated rule.
- **The four v2 Sol designs finished:** Q (Pi, medium) 1,921 words, S (Pi, high) 2,931, T (Codex, medium) 2,827, R (Codex, high) 2,664.
  - They are packed blind with the turn-1 v1 designs of the same four cells (A, C, F, G, taken from the t1 pack, not from the worktrees, which turn 2 is revising). The key is `results/blind-key-t1-v2.json`.
  - A judge scores all eight in one session. Its prompt adds, explicitly, the four scoring rules the first judge chose for itself (R2, R4, R5, R8), so the v1 designs are rescored under the same rules rather than compared with their first scores.

## Step 11: first acceptance results; the suite fix confirmed; the suite frozen

- **Two implementations pass all 25 hidden tests,** bit for bit: IRWB-020-B (Codex, Astra, medium, `343f7a8`) and IRWB-020-E (Pi, Astra, medium, `a0277f9`). They are independent implementations from different harnesses, and both match the hand-written references, which supports the references themselves.
- **The v1 suite would have failed both on the invalid test** found in step 10 ("a two-index reduction accumulates lexicographically": 22 of 23 passing). Both reject that program, as the brief requires: B with "2:5 Cannot infer extent", E with "2:31: cannot infer index extent".
- **The suite is frozen** from here: `acceptance.test.mjs` sha256 `ca81276f0939aade…` (v1: `ca4f792e16ed96a9…`). Adding tests after seeing results would fit the suite to the implementations.
- **If most implementations reach 25 of 25,** the suite is a floor, not a ranking. The planned objective comparison beyond it is a differential cross-check: random programs from the fixed core, run on every implementation bit for bit, with disagreements resolved against a hand reference. It uses only the brief, so it can be written now without looking at any implementation.

## Step 12: a differential cross-check, and the first divergence: name reuse

- **The cross-check** (`scratchpad/t1-acceptance/crosscheck.mjs`; committed with the suite when all implementations are done) was written from the brief alone, before looking at any implementation's code.
  - It generates random valid programs in the fixed core as syntax trees, prints them with minimal parentheses, and evaluates the trees directly under the brief's f32 rules. No parser is needed on the reference side.
  - Programs avoid domain errors by construction: `log` and `sqrt` take e·e + c, `exp` takes tanh(e)·2, and division is by e·e + 1 or by a shape value.
  - 60 programs × 3 cases, seed 7. The programs contain 88 reductions (23 over two indices), 103 calls and 62 unary minuses.
  - Each implementation runs in its own child process. The check records f32 bit agreement, f64 agreement (1e-9), and for `inline` and `split-sum`: accepted, and if accepted, whether the result still computes the same function. Both passes are correct on every program, so a rejection is a false rejection.
- **A generator bug found before use:** the grammar is ambiguous for `max(N, C) …` (a call on two shape values, or a reduction over two indices). The generator no longer puts a bare shape name into a call argument. N's implementation resolves the ambiguity explicitly ("a call when every name is a shape name"), and N lists it as a deviation.
- **Results so far:**

| item | cell | hidden suite (frozen) | suite variant | cross-check f32 / f64 | inline acc./kept | split-sum acc./kept |
|---|---|---|---|---|---|---|
| B | Codex Astra medium | 25/25 | 25/25 | 180/180 · 180/180 | 60/60 | 60/60 |
| E | Pi Astra medium | 25/25 | 25/25 | 180/180 · 180/180 | 60/60 | 59/59 |
| J | Pi Astra xhigh | 25/25 | 25/25 | 180/180 · 180/180 | 60/60 | 60/60 |
| P | Claude Fable medium | 22/25 | 25/25 | 180/180 · 180/180 | 60/60 | 60/60 |
| N | Claude Opus medium | 22/25 | 25/25 | 180/180 · 180/180 | 60/60 | 60/60 |

- **The divergence is name reuse.** The suite's mlp writes `y[i, x] = (sum(f) g[i, f] * w2[f, x]) + b2[x]`, and `x` is also mlp's input tensor.
  - Both Claude implementations reject this: P with "5:8: 'x' is a tensor and cannot be an index", N with "5:8: index x is a parameter".
  - The three OpenAI implementations accept it. The brief does not say whether index and tensor names may coincide; there is no syntactic ambiguity, since references always carry brackets.
  - The frozen suite's score stands, and the *variant* (`acceptance-variant-names.test.mjs`, which renames that one index to `e`) is reported next to it as a sensitivity check. All three of P's and N's failures are this one rule, and both pass 25/25 on the variant. **Lesson:** specify namespaces in a fixed core, and don't write test programs that depend on an unspecified rule.
- **E rejected a correct `split-sum` on one cross-check program** (program 39, no reason in the step). That program is well conditioned on the generated cases: f32 against f64 within 4e-7 relative. So this is a false rejection by E's contract on its own sampled cases.
- **Five independent implementations agree bit for bit with the tree-walking reference** on all 180 random cases. The fixed core's f32 meaning is precise enough to implement identically.
- **Claude usage:** P's implementation took 280K tokens, N's 237K. Total Claude subagent tokens in IRWB-019 so far: about 2.04M (designs 0.90M, implementations 0.52M, judges and reviewer 0.62M).

## Step 13: Sol policy v2 against v1, scored in one session; policy v3 launched

The judge (Claude subagent, 171K tokens) scored the four v1 and four v2 Sol designs blind in one session. Its quotes verify, 104 of 104. Scores are in `results/judge-scores-t1-v2.json`, the key in `blind-key-t1-v2.json`.

| Sol cell | excess v1 → v2 | R2 (non-finite) | over-eng. | fitness | A1 (fidelity) | words |
|---|---|---|---|---|---|---|
| Codex medium (C → T) | 12 → 5 | 6 → 3 | 3 → 1 | 7 → 7 | 4 → 4 | 2,510 → 2,827 |
| Codex high (A → R) | 10 → 7 | 4 → 3 | 3 → 2 | 8 → 7 | 5 → 3 | 2,764 → 2,664 |
| Pi medium (F → Q) | 14 → 10 | 7 → 4 | 4 → 2 | 8 → 8 | 5 → 3 | 2,748 → 1,921 |
| Pi high (G → S) | 13 → 14 | 4 → 5 | 3 → 3 | 8 → 7 | 5 → 3 | 2,739 → 2,931 |
| **mean** | **12.25 → 9.00** | 5.25 → 3.75 | **3.25 → 2.00** | 7.75 → 7.25 | 4.75 → 3.25 | 2,690 → 2,586 |

- **v2 reduces excess in three of four cells.** The Pi high cell is unchanged. Over-engineering falls by 1.25 points.
- **The fitness loss is my policy's fault.** v2's language rule gave as its example "affine expressions in parameter types that no program uses", to be rejected. But those are part of the brief's fixed grammar.
  - All four v2 designs restricted parameter dimensions to bare names.
  - The judge deducted fidelity (A1) for exactly that in A, D, E and H, the four v2 documents.
  - Without A1, v2's fitness equals v1's. A policy rule must not contradict a fixed specification. The agents followed the policy over the brief, which shows the policy's rank.
- **The largest remaining excess is non-finite handling** (R2: NaN encodings, finiteness checks, non-finite clauses in the tolerance check), although the brief says inputs are finite. v1's "state the domain and specify behaviour only within it" did not prevent it.
- **The judges disagree.** On the same four v1 documents, the first judge and this one differ by up to 4 excess items and 2 fitness points (for example Pi Sol high: fitness 6 then 8). Scores are comparable within a session, not across sessions. That is why the v1 documents were rescored here, and why v3 will be scored together with v1 and v2.
- **Policy v3** (`prompts/developer-instructions-v3.md`): v2 with the language rule replaced by "accept everything the brief fixes; cover it with the simplest method that works; where full generality would need machinery no example uses, reject that case with an ordinary error", plus "rely on the assumptions the brief states about inputs; do not specify checks, encodings or rules for inputs that violate them".
  - It runs on the same four Sol cells, items U–X (`scripts/13-launch-t1-v3.sh`).
  - The 12 Sol designs (v1, v2, v3) will be judged in one session.
- **F (Pi, Sol, medium) implementation:** 25/25 on the frozen suite, 25/25 on the variant, cross-check 180/180 bit-exact, `inline` and `split-sum` accepted and correct on all 60 programs.

## Step 14: the GPU machine over Tailscale; the Codex sandbox's network setting is not a boundary

- **The user pointed out that bling is on the tailnet.** `bling.local` (mDNS) now gives "No route to host", because this laptop is off the home LAN. `ssh manuel@bling` (MagicDNS, 100.117.186.55) works. The full name `bling.tail879302.ts.net` is not in `known_hosts`, so I use the short name and did not accept a new host key.
  - `tools/cuda-remote.mjs` now defaults to `manuel@bling`.
  - A test kernel squaring eight floats compiled in 470 ms and printed `0 1 4 9 16 25 36 49`.
  - `BACKLOG.md` and my memory note are updated.
- **Probe: ssh from a sandboxed Codex agent** (`codex exec --sandbox workspace-write`, Astra, low effort, one command):
  - **With `network_access=true`,** the command ran inside the sandbox without escalation, and printed `bling`.
  - **With `network_access=false`,** the agent requested `sandbox_permissions: "require_escalated"` on its first call, an approval-assessor sidecar approved it (the rollout `…ff3e…` contains "whose request action you are assessing"), and the command ran outside the sandbox.
  - So in this configuration the network setting decides whether an agent must ask, not whether it can reach the network. For T2, pass `--network` so that GPU runs stay sandboxed and need no approval.

## Step 15: G and K; false rejections come from fixed tolerances

- **G (Pi, Sol, high, `a989925`):** 25/25 frozen, 25/25 variant, cross-check 180/180 · 180/180, `inline` 60/60, `split-sum` 60/60.
- **K (Pi, Sol, xhigh, `24f830a`):** 25/25 frozen, 25/25 variant, cross-check 180/180 · 180/180, `inline` 60/60, **`split-sum` 55/60**.
  - The five rejected programs (31, 34, 43, 51, 54) are well conditioned on the generated cases: plain f32 is within 1.6e-7 of f64, scaled by max(1, |r|). E accepts all five.
  - K's tolerance relation is a fixed bound, |c − r| ≤ 2e-6 + 2e-5·|r| (`src/tensor/meaning.ts:119`), applied on its own sampled cases. A correct reassociation in a deeper reduction exceeds it.
  - The rejection reason exists internally ("cell i: f64 …, f32 …, bound …") but is not in `optimizeTix`'s steps.
- **The pattern so far:**
  - a bound derived from the computation (P's running error bound) accepts every correct `split-sum`;
  - fixed bounds reject some (K 5/60, E 1/60);
  - the review asked designs without a justified bound to justify it, and v2/v3 add "justify every numeric threshold by an error argument or a measurement".
