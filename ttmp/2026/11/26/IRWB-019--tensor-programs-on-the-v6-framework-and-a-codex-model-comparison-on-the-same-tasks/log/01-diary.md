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

## Step 16: all fourteen implementations evaluated; the T2 base; the report turn

All fourteen implementations are in. `scripts/14-impl-summary.mjs` gives the table below (`results/impl-summary-t1.json`).
- **Turn-2 cost:** wall minutes, commands (Codex `CommandExecution` events; Pi `bash` calls; Claude tool uses) and generated output tokens.
- **Minutes are not comparable across cells:** fourteen agents shared 8 cores.

| item | cell | suite | variant | xcF32 | inline | split | srcLines | testLines | tests | framework | minutes | commands | outputTokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IRWB-020-P | claude/fable/medium | 22/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1717 | 621 | 33 | +168/-55 | 15.4 | 27 | - |
| IRWB-020-N | claude/opus/medium | 22/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1674 | 260 | 20 | +193/-36 | 16 | 52 | - |
| IRWB-020-D | codex/astra/high | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 972 | 343 | 19 | +86/-28 | 63.3 | 87 | 30585 |
| IRWB-020-B | codex/astra/medium | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 917 | 212 | 11 | +85/-27 | 9.8 | 42 | 21563 |
| IRWB-020-I | codex/astra/xhigh | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1086 | 338 | 14 | +140/-71 | 62.9 | 66 | 32774 |
| IRWB-020-A | codex/sol/high | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1336 | 374 | 21 | +102/-34 | 67.8 | 45 | 46309 |
| IRWB-020-C | codex/sol/medium | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1380 | 414 | 17 | +132/-47 | 62.5 | 31 | 38880 |
| IRWB-020-L | codex/sol/xhigh | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1278 | 550 | 23 | +112/-45 | 64.7 | 39 | 43876 |
| IRWB-020-H | pi/astra/high | 25/25 | 25/25 | 180/180 | 60/60 | 59/60 | 1004 | 282 | 15 | +32/-19 | 56 | 23 | 24512 |
| IRWB-020-E | pi/astra/medium | 25/25 | 25/25 | 180/180 | 60/60 | 59/60 | 805 | 275 | 12 | +85/-26 | 9.9 | 17 | 19613 |
| IRWB-020-J | pi/astra/xhigh | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1067 | 288 | 19 | +118/-0 | 13.4 | 19 | 25215 |
| IRWB-020-G | pi/sol/high | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1279 | 451 | 17 | +123/-37 | 58.5 | 22 | 44488 |
| IRWB-020-F | pi/sol/medium | 25/25 | 25/25 | 180/180 | 60/60 | 60/60 | 1300 | 334 | 18 | +105/-29 | 56.1 | 20 | 37985 |
| IRWB-020-K | pi/sol/xhigh | 25/25 | 25/25 | 180/180 | 60/60 | 55/60 | 1317 | 465 | 21 | +177/-81 | 57.6 | 17 | 42416 |

- **Correctness is uniform.**
  - Every implementation agrees bit for bit with the tree-walking reference on all 180 random cases, and with f64 on all 180.
  - Every `inline` result is bit-identical.
  - Every accepted `split-sum` computes the same function.
  - Twelve pass the frozen suite 25/25. The two Claude cells pass 22/25, failing only on name reuse, and pass the variant 25/25.
- **What separates them:**
  - false rejections of a correct `split-sum`: K 5/60 (fixed abs+rel bound), E 1/60 and H 1/60 (both program 39, both Pi Astra);
  - the name-reuse rule (N, P);
  - size and cost.
- **Size follows the model more than the harness:** Astra writes 805–1,086 lines of `src/tensor`, Sol 1,278–1,380, Claude 1,674–1,717. Framework diffs range from +32/−19 (H) to +193/−36 (N).
- **No implementation changed files outside the allowed scope.**

### The T2 base: IRWB-020-B (Codex, Astra, medium)
The criteria, in order:
1. every objective check passes;
2. the smallest framework change;
3. the smallest source.

Nine cells meet (1): A, B, C, D, F, G, I, J, L. B and D tie on (2), at +85/−27 and +86/−28; B wins on (3) with 917 lines against 972.
- B's design (K in the t1 judge pack) was one of the two in which the reviewer found no must-change item. The judge gave it fitness 8 and over-engineering 2.
- **I read B's framework diff.** It adds `applyNativePassSync(pass, before, gate, params)` with a caller-supplied synchronous gate. It moves the native-result steps into `prepareNative` and `enforceWrites`, which `applyPass` now shares. It refuses passes with `needs`, `preserves` or their own contract.
- **It does not make `applyPass`'s edit lazy.** The async path still throws for an adapter without `rebuild`. That is the minimum the fixed API needs; the gap stays listed in the backlog.
- B is merged after its report turn.

### The report turn (turn 3, `prompts/t1/turn3.md`)
- Each implementer receives its own evaluation results (`results/turn3-results/<item>.md`, written by `scripts/15-turn3-results.mjs`), with the source of up to two programs it falsely rejected. It must not change code.
- It must diagnose each failure with `file:line`, then write `reference/02-report.md` (2,000–3,500 words) covering the design, the checks and the results, including failures.
- The turn measures something new: whether each configuration reports its own failures faithfully, and whether it disputes the name-reuse result or accepts it.
- The worst-case conditioning quoted in each text is computed per agent: 3.7e-7 for program 39, 1.6e-7 for K's five.
- **Dispatch:** the twelve Codex and Pi cells by `10-dispatch-turn.sh` (which now accepts per-item `<RESULTS>` files); N and P by SendMessage.
- **The suite and the cross-check** are committed after the report turn, so that the reports are written without them.

## Step 17: B merged; the report turn's diagnoses; the right denominators

- **B merged** into `irwb-001/import-v6-prototype` (`98b04da`), with no conflicts; main had not touched `src/framework` or the tensor paths since `19ad269`. Full suite after the merge: 414 tests, 411 pass, 0 fail, 3 skipped (was 394 pass). B's report turn changed no code (`e970be0`, report 2,775 words, one diagram, "Failure causes: none").
- **A correction to step 16:** only four implementations made `applyPass`'s edit lazy (I, K, N, P), although all sixteen designs proposed it. J changed no existing framework file; it added `passes/sampled-sync.ts`. Report 11 §7 was corrected.
- **The denominators** (N pointed out that "accepted 60/60" includes programs a pass cannot change). From the sources:
  - `split-sum` applies to 32 of the 60 programs (a one-index `sum`);
  - `inline` applies to 15 (a pointwise statement with exactly one use, not the result);
  - all six rejected programs are among the 32.
  
  The false-rejection rates are K 5/32, E 1/32, H 1/32. No `inline` rejections.
- **The diagnoses (turn 3).** Every agent with a failure found its cause with `file:line`. The causes are of three kinds:
  - **N and P (Claude):** both accepted the suite's verdict. P: "The suite's result is right and the failure is mine" (`check.ts:123-124`). N: "The evaluation's verdict is right, and the restriction was mine" (`check.ts:121-122`).
    - Both explain that the grammar keeps tensor names (before `[`) and index names (inside brackets) apart, and that only the shape/index separation is needed (to tell `max(N, D)` from a reduction).
    - Neither applied the fix, as instructed. Both wrote a repro script.
    - P raised a further rule the brief leaves open: `sum(j) a[i, j] + sum(j) b[i, j]` parses, by the reduction-body rule, as a nested reduction that rebinds `j`. P's checker rejects the shadowing. Neither the suite nor the random programs exercise it.
  - **E and H (Pi, Astra), program 39:** on their own sampled inputs (E: C = 4, N = 5), the program cancels, and the *original* f32 result already exceeds the bound against f64. E's original error is 1.20e-5 against a bound of 5.93e-6 (`contract.ts:84-85`). The rewritten program is bit-identical to the original at the failing elements.
    - Both call it "a real accuracy violation, not a rewrite regression". That is accurate about the program. But the pass was correct and is rejected, so the contract cannot accept a correct pass on an ill-conditioned origin.
    - N's design ("inconclusive" when the origin's own f32 result fails the bound) and P's running error bound handle exactly this case.
    - My turn-3 text said the program is well conditioned "on the evaluation's inputs", which was true for mine. Conditioning depends on the inputs.
  - **K:** its sampled domain includes zero-size extents. An empty `max` gives −∞ in both programs (31), and division by C = 0 gives +∞ (34). Its gate treats identical infinities as a mismatch (`meaning.ts:117`).
    - The brief says inputs are finite but is silent on zero extents.
    - K diagnosed two of five and said, correctly, that the other three had no source or counterexample: I had included only two sources.
- **Claude usage:** the two report turns took 300K (P) and 258K (N), most of it reading the long context. Total Claude subagent tokens so far: about 2.84M.

## Step 18: Sol policies v1, v2 and v3 in one session; the hidden material released

A judge (Claude subagent, 203K tokens) scored the twelve Sol designs (four cells × three policies) blind in one session. Its quotes verify, 123 of 123. Scores are in `results/judge-scores-t1-v3.json`, the key in `blind-key-t1-v3.json`.

| Sol cell | excess v1 / v2 / v3 | over-eng. | fitness | A1 (fidelity) |
|---|---|---|---|---|
| Codex medium | 6 / 4 / 5 | 3 / 2 / 3 | 8 / 7 / 8 | 4 / 3 / 4 |
| Codex high | 7 / 3 / 6 | 4 / 2 / 3 | 9 / 7 / 7 | 5 / 2 / 4 |
| Pi medium | 8 / 6 / 6 | 4 / 3 / 3 | 8 / 6 / 8 | 5 / 2 / 4 |
| Pi high | 7 / 7 / 6 | 4 / 4 / 3 | 8 / 6 / 8 | 5 / 2 / 4 |
| **mean** | **7.00 / 5.00 / 5.75** | **3.75 / 2.75 / 3.00** | **8.25 / 6.50 / 7.75** | 4.75 / 2.25 / 4.00 |

- **v2 removes the most excess and costs the most fidelity.** It narrows the fixed grammar (bare-name parameter dimensions), and A1 falls by 2.5 points.
- **v3 keeps most of the reduction and recovers most of the fidelity.**
  - Excess falls by one or two items in every cell against v1. Over-engineering falls by one point in three of four cells.
  - Fitness is within 0.5 of v1 on average, and equal in three of the four cells.
  - v3 is the best trade-off of the three, but its gain over v1 is small: about one rubric point of over-engineering, with one run per cell.
- **What no policy wording removed:** contract statuses and evidence formats nobody asked for ("a function with no sampled case cannot be accepted", in 11 of 12), and non-finite handling.
  - R2 is 1 in all twelve documents: v3's "rely on the stated input assumptions" did not remove it.
  - That is partly my rubric instruction "count each kind at most once per document", which made R2 binary and removed its sensitivity. The previous session, with uncapped counts, showed R2 falling from 5.25 to 3.75 under v2.
- **The direction agrees across the two sessions** (v2 below v1 in excess and in fitness), and the magnitudes differ. In-session comparison is the only sound one.
- **The global Codex policy** (`~/.codex/config.toml`) stays at v1. v3's evidence is small and the change would affect every Codex session; this is the user's call.
- **The hidden material is now in the ticket** (`various/hidden-t1/`):
  - the frozen suite (sha256 `ca81276f0939aade…`), its invalid v1, the name-reuse variant, `crosscheck.mjs` and `programs.json`;
  - the results (`results/acceptance-t1*.json`, `crosscheck-t1.json`, `crosscheck-applicable.json`).
- **All fourteen reports are written** (2,456–4,072 words, each with a Mermaid diagram), and no agent changed evaluated code. Each report states its own results, including failures. K, for example: "This is a false rejection of those rewrites if the goal is to preserve the program's behavior".
- **Claude usage:** total Claude subagent tokens in IRWB-019, about 2.97M.

## Step 19: stage 2 (CUDA lowering) launched on twelve cells

- **Base:** branch `t2-base` at `1880fc4`. It is stage 1 as merged (B's branch, which sits on `19ad269`) plus `tools/cuda-remote.mjs` with the Tailscale default. It does not contain the IRWB-019 ticket, so the agents cannot see the keys, reviews, hidden material or results.
- **Rules stage 1 left open (F16), probed on B and stated in the brief as the base implements them:**
  - an index may share a tensor's name (`y[x] = x[x] * 2` gives 2, 4, 6) or a shape name's;
  - a repeated reduction index nests and shadows (`sum(j) a[i, j] + sum(j) b[i, j]` gives 63 = (1 + 30) + (2 + 30));
  - a zero extent makes `sum` 0 and `max` −∞;
  - `max(N, C) - x[i, 0]` is a call on two shape values.
- **The brief** (`prompts/t2/common.md`):
  - lower each Tix function to CUDA C, one kernel per statement and one thread per output element, with each reduction a sequential loop in the f32 meaning's order;
  - run it through the tool on the GB10;
  - check the lowering with a contract whose candidate runs remotely. The agent decides the relation, exact or tolerance, and must establish it by probing (flags, the implementation of each operation and intrinsic);
  - design batching and evidence reuse for an expensive asynchronous engine;
  - measure kernel time at fixed sizes, given in the corpus's own shape names.
  
  The fixed API additions are `cudaSource`, `runTixCuda` (with `gpuMs` from CUDA events) and `checkLowering`.
  
  The question I expect to separate designs, and did not state: CUDA's `+ − * /` and `sqrt` are correctly rounded in IEEE mode, so with contraction off and the transcendentals in double, a one-thread-per-element backend can be bit-exact with the f32 meaning.
- **Matrix:** the twelve Codex and Pi cells (Sol or Astra, medium, high or xhigh), policy v1, items IRWB-022-A…L (`results/t2-config-key.json`, seed 20261135).
  - Codex runs with `sandbox_workspace_write.network_access=true`, so that its ssh stays inside the sandbox.
  - No Claude cells in stage 2, to save usage (about 2.97M Claude subagent tokens so far).
- `scripts/16-launch-t2-design.sh`; `08-status.mjs` now takes each round's base from `heads.json`.
- **Bling before the launch:** load 0.06, 20 cores, 1.1 TB free.

## Step 20: twelve stage-2 designs; the stage-2 evaluation written before reading them

- **All twelve T2 design agents exited 0.** Designs run 1,739–3,516 words (`08-status.mjs t2`); Pi Astra xhigh (G) is the longest and Pi Astra medium (H) the shortest. Packed blind, seed 29 (`results/blind-key-t2.json`). The only ticket ID left in the documents is the base's, IRWB-020-B, which the brief tells every author to read.
- **The rubric** (`scripts/17-judge-rubric-t2.md`) keeps R1–R8 and A1–A5, and its counts are "each kind once per document". A1 checks fidelity to the fixed mapping and API. A2 checks the relation claim: for exact, which operations are correctly rounded, the flags, and each intrinsic; for tolerance, the reference and the bound. The judge also records each design's relation.
- **The review protocol** (`scripts/18-review-protocol-t2.md`): the same four parts. The reviewer may check GPU-arithmetic claims on bling with a few short runs, in a scratch directory.
- **The evaluation** (`scratchpad/t2-eval/t2-eval.mjs`, sha256 `4ecd3fb2b84bb596…`, committed when stage 2 is done) was written before any design was read. Its reference is B's validated f32 interpreter; the random programs carry their own reference bits. It measures:
  - bit-exact GPU results and the largest scaled difference from f32 and f64, on the corpus (small sizes), after `optimizeTix`, and on 20 random programs;
  - `checkLowering` verdicts on 16 programs, and whether a claimed `exact` holds;
  - `gpuMs` and bit agreement at the brief's sizes.
  
  A plumbing run on B (no CUDA API) reported every step as missing and cached the large f32 references. Their first computation took 547 s in the stage-1 interpreter.

## Step 21: stage-2 designs scored; every design chose tolerance

A blind judge (Claude subagent, 205K tokens) scored the twelve T2 designs with `scripts/17-judge-rubric-t2.md`. Its quotes verify, 84 of 84. Scores are in `results/judge-scores-t2.json`.

| cell | doc | words | excess | R7 | over-eng. | fitness |
|---|---|---:|---:|---|---:|---:|
| Codex Astra medium (A) | G | 2,079 | 3 | no | 1 | 9 |
| Codex Astra high (K) | J | 2,645 | 4 | no | 2 | 9 |
| Codex Astra xhigh (L) | E | 2,539 | 2 | no | 1 | 9 |
| Codex Sol medium (J) | I | 2,489 | 9 | no | 4 | 7 |
| Codex Sol high (I) | F | 2,296 | 10 | yes | 4 | 6 |
| Codex Sol xhigh (B) | A | 2,421 | 3 | no | 2 | 8 |
| Pi Astra medium (H) | C | 1,670 | 4 | yes | 2 | 7 |
| Pi Astra high (D) | H | 2,574 | 6 | yes | 2 | 8 |
| Pi Astra xhigh (G) | D | 3,398 | 7 | no | 3 | 9 |
| Pi Sol medium (F) | K | 2,441 | 7 | yes | 3 | 8 |
| Pi Sol high (E) | B | 2,619 | 7 | no | 3 | 8 |
| Pi Sol xhigh (C) | L | 2,753 | 7 | no | 3 | 8 |

Means (over-engineering / fitness / excess):
- **Harness × model:** Codex Astra 1.33 / 9.00 / 3.0, Codex Sol 3.33 / 7.00 / 7.3, Pi Astra 2.33 / 8.00 / 5.7, Pi Sol 3.00 / 8.00 / 7.0.
- **Model:** Astra 1.83 / 8.50, Sol 3.17 / 7.50.
- **Effort:** no consistent effect.

Readings:
- **Astra over-engineers less than Sol in both harnesses, as in T1.** Codex Astra is the best cell in both stages.
- **The harness effect from T1 does not hold for Sol.** Codex Sol is now the weakest group, below Pi Sol. T1's "Codex restrains the model's defaults" holds for Astra only. With one run per cell, the Sol difference between harnesses is within the judge variation measured in step 13.
- **Every design chose the tolerance relation, and the judge finds the arithmetic claims sound:**
  - under the default flags nvcc contracts a·b + c into an FMA;
  - `__fadd_rn`, `__fmul_rn` and `__fdiv_rn`, and `sqrtf` under the default `-prec-sqrt=true`, are correctly rounded and equal `Math.fround` of the double result;
  - `expf`, `logf` and `tanhf` differ from the rounded JS functions on about 20–30% of inputs.
- **Four designs (A, F, I, L) probed double-precision `exp`, `log` and `tanh` rounded to f32 and found no mismatch apart from NaN bit patterns.** That is the evidence for an exact lowering, and none of them took it:
  - A and L treat it as sampled evidence only;
  - F and I reject exactness because NaN payloads differ, which the f32 meaning does not define;
  - no design argued for exactness up to NaN class, which an exhaustive check over all 2³² f32 inputs could establish for the unary functions.
  
  The evaluation measures bit-exactness regardless of the relation each design claims.
- **The common excess:** repeated timed runs with median and range (all 12), tests of failure, retry and malformed-reply paths (11), and merging concurrent identical checks onto one in-flight promise (7).
- **Framework and tool changes:**
  - **tool:** a private remote working directory per call, with a per-key compile lock and atomic publishing of the binary;
  - **framework:** ten designs leave `src/framework` unchanged and use `defineTransformation` with `differential.decide`. D and J propose a batch-only differential spec without the synchronous run/compare, and H works around the same gap with a throwing stub.

## Step 22: stage-2 reviews checked; implementation dispatched

- **The blind reviewer** (Claude subagent, 267K tokens, 60 tool uses) wrote twelve reviews, 308–348 words each. It worked in the clean `t2-base` checkout and compiled into the scratchpad.
  - **One GPU probe:** under CUDA 13's default lazy module loading, a kernel's first CUDA-event interval includes its load. I reran the probe: 0.101 ms on the first launch against 0.003 ms on later ones, and 0.005 ms after an explicit `cudaFuncGetAttributes`. So a one-case `runTixCuda` that does not load its kernels before the start event puts start-up into `gpuMs`, which the fixed API excludes. That was a must-change in nine designs.
  - **One local measurement:** on the stage-1 tolerance cases, the f32 interpreter's own error against f64 uses at most 25% of the stage-1 budget (conv2d 0.247), before and after the passes. So the stage-1 bound, which most designs adopt for the lowering, does not reject a correct lowering of the corpus.
- **I checked its framework claim:** the differential spec already has `baselineKey`, `subjectKey` and an asynchronous `decide` (`src/framework/contracts/differential.ts:57-69`). So designs that built their own case batching or verdict memo duplicate existing machinery.
- **Recurring cuts:** engine-identity stamps (verdict reuse is process-local), shared GPU locks for untimed runs, in-flight coalescing, and full-size f64 comparisons. The batch-only differential variant (D, J) is judged a needed, minimal framework change.
- **Blinding:** no review mentions another document. The titles ("Review of doc A") were replaced with "Review of your design"; my first substitution missed them because of the missing hyphen, and the dispatch used the corrected copies. The reviews are archived in `results/reviews-t2/`.
- **Dispatched:** the twelve Codex and Pi cells, `10-dispatch-turn.sh t2 impl prompts/t2/turn2.md <reviews-send> --network`.
- **Claude total in IRWB-019:** about 3.44M subagent tokens.

## Step 23: the exactness question, settled exhaustively; first stage-2 evaluation

- **The probe** (`various/exact-probe/`):
  - **GPU side:** for every one of the 2³² f32 bit patterns, `(float)exp((double)x)`, `(float)log(...)` and `(float)tanh(...)` are computed with NaN canonicalized. Each chunk of 2²⁰ results is hashed as h = Σ bits(yᵢ)·(2i + 1) mod 2³². This took 1.5 s for all three functions.
  - **JavaScript side:** the same hash of `Math.fround(Math.exp(x))` etc. (`compare.mjs`, 8 worker threads, 156 s).
  - **Result: all 3 × 4,096 chunk hashes agree.** A single differing result changes a chunk's hash, because 2i + 1 is invertible mod 2³². So on the GB10 (CUDA 13.0), the double-precision functions rounded to f32 equal the f32 meaning's `Math.fround(Math.f(x))` for every f32 input, NaN compared as a class.
- **Consequences:**
  - A stage-2 lowering can be bit-exact with the f32 meaning, checked under the exact relation. It needs no contraction (`-fmad=false` or `__fmul_rn`/`__fadd_rn`), the default correctly rounded division and `sqrt`, and the transcendentals in double.
  - Two caveats:
    - the f32 meaning is defined through JavaScript's `Math` functions, so this holds for V8 in Node 24.18 and is not a property of the language;
    - `max` and `min` must reproduce `Math.max`/`Math.min` on signed zeros, which `fmaxf` does not guarantee.
  - All twelve designs chose tolerance. Four had sampled exactly this comparison and found no non-NaN mismatch.
- **The first stage-2 evaluation, A (Codex, Astra, medium):**
  - Stage-1 suite 25/25. API complete.
  - **Bit-exact** with the f32 meaning on every program that uses only `+ − * /` and `sqrt`: matmul, layernorm and conv, at small and full size (262,144/262,144 matmul elements, 4,194,304/4,194,304 layernorm). So A does not contract.
  - **Not exact** where `exp` or `tanh` appear (softmax, attention, mlp). The scaled differences are ≤ 9e-8 at small sizes and 2.2e-5 at full size in mlp. A uses the single-precision intrinsics; the double versions would have made it exact.
  - **After `inline` + `split-sum`:** the same pattern.
  - **Random programs:** 16/20 bit-exact.
  - **`checkLowering`:** accepted 16/16 (tolerance), about 6 s each.
  - **`gpuMs` at full size:** matmul 0.255 ms, softmax 0.448, layernorm 0.480, attention 1.394, mlp 0.819, conv 0.351.

## Step 24: stage-2 evaluations of B and J; an exact backend checked as tolerance; an evaluator exit bug

- **All twelve stage-2 implementations pass the frozen stage-1 suite** (25/25) and export the three new functions.
- **B (Codex, Sol, xhigh)** has the same pattern as A: bit-exact on the corpus programs without transcendentals (3/6, and 3/6 at full size), 16/20 random programs, `checkLowering` 16/16 (tolerance).
- **J (Codex, Sol, medium) is bit-exact everywhere measured:** corpus 6/6, after `inline` + `split-sum` 4/4, random 20/20, and every element at full size (6/6). Its `cudaSource` shows why:
  - explicit `__fadd_rn`, `__fmul_rn` and `__fsub_rn`, so nothing can contract;
  - `tix_exp`, `tix_log` and `tix_tanh` as `__double2float_rn(exp((double)x))` etc., exactly the construction step 23 proved equal to the f32 meaning on all 2³² inputs;
  - its own `tix_max`.
  
  Yet its `checkLowering` reports `tolerance`, a two-rule bound against f64. **The implementation is exact; the relation it claims and checks is the weaker one.**
- **An evaluator bug, mine:** `withTimeout` left its 5- and 10-minute timers pending, so a finished worker stayed alive until the last timer fired. That cost time only; no result changed.
  - The fix: clear and `unref` the timers, and exit after writing stdout (sha256 now `88cc4659…`).
  - A, B and J ran with the old exit; the remaining nine with the new.

## Step 25: all twelve stage-2 implementations evaluated; the stage-3 base

All twelve pass the frozen stage-1 suite (25/25) and export the full stage-2 API. The evaluation (`scratchpad/t2-eval/t2-eval.mjs`, results in `results/eval-t2.json`) gives:

| item | cell | corpus exact | after passes | random | full size | checkLowering | s/check | matmul ms | attention ms | mlp ms |
|---|---|---|---|---|---|---|---:|---:|---:|---:|
| K | codex · astra · high | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 4.0 | 0.26 | 1.51 | 1.02 |
| A | codex · astra · medium | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 6.0 | 0.26 | 1.39 | 0.82 |
| L | codex · astra · xhigh | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 4.0 | 0.23 | 1.41 | 0.98 |
| I | codex · sol · high | 6/6 | 4/4 | 20/20 | 6/6 | 16/16 tolerance | 2.5 | 0.20 | 1.81 | 1.05 |
| J | codex · sol · medium | 6/6 | 4/4 | 20/20 | 6/6 | 16/16 tolerance | 3.1 | 0.23 | 7.31 | 1.03 |
| B | codex · sol · xhigh | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 4.9 | 0.24 | 1.58 | 1.00 |
| D | pi · astra · high | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 3.8 | 0.17 | 1.74 | 0.78 |
| H | pi · astra · medium | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 3.0 | 0.20 | 1.43 | 1.01 |
| G | pi · astra · xhigh | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 3.2 | 0.25 | 1.57 | 1.00 |
| E | pi · sol · high | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 3.1 | 0.20 | 1.75 | 0.83 |
| F | pi · sol · medium | 3/6 | 1/4 | 16/20 | 3/6 | 16/16 tolerance | 3.1 | 0.22 | 1.83 | 0.95 |
| C | pi · sol · xhigh | 6/6 | 4/4 | 20/20 | 6/6 | 16/16 tolerance | 3.9 | 0.21 | 1.48 | 1.15 |

- **Correctness is uniform again.** Every lowering computes the program, and every `checkLowering` accepts all 16 programs under tolerance, at 2.5–6.0 s per check (remote).
- **Three are bit-exact with the f32 meaning on every measured case** (J, C, I: all Sol). They use round-to-nearest intrinsics (`__fadd_rn`, `__fmul_rn`), so nothing contracts, and `exp`, `log` and `tanh` in double, rounded. Step 23 proved that construction equal to the f32 meaning on all 2³² inputs.
- **The other nine are bit-exact except where `exp` or `tanh` appear.** They use the single-precision intrinsics, about 1 ulp off, and up to 2.2e-5 scaled at full size in mlp.
- **No implementation claims the exact relation.** J, C and I are exact by construction and check themselves under tolerance.
- **Model:** Sol built the exact backends (3 of 6 Sol cells, 0 of 6 Astra cells). Astra wrote less code: +391–498 lines of tensor source against Sol's +607–744.
- **Framework:** ten change nothing in `src/framework`. K and G add a batch differential (+21/−5 and +30/−10, with a new framework test).
- **Tool:** eleven change `tools/cuda-remote.mjs`, by +16/−12 (L) up to +133/−92 (B), mostly private run directories and compile locks. H leaves it unchanged.
- **Kernel times are close across cells:** matmul 512³ 0.17–0.26 ms; attention 1.4–1.8 ms, except J at 7.3 ms; mlp 0.8–1.15 ms.

### The stage-3 base: IRWB-022-I (Codex, Sol, high)
All twelve pass every check the brief stated. Stage 3 (fusion) gains most from a base whose lowering is bit-exact, because then fused kernels can be checked under the exact relation. So the criteria are, in order:
1. bit-exact with the f32 meaning on every measured case (J, C, I);
2. the smallest framework change (none for all three);
3. the smallest tool change (I: +104/−80, against C +116/−86 and J +126/−79);
4. the smallest tensor source (I: +607, against J +633 and C +708).

I wins on 3 and 4. Its *design* was the worst-scored in stage 2 (over-engineering 4, fitness 6, R7 yes), so design scores did not predict implementation quality, as in stage 1. I's tool change is read before the merge, because the tool is shared.

## Step 26: the stage-2 report turn; I merged; how efficient the generated code is

- **The report turn** (`prompts/t2/turn3.md`, per-item results from `scripts/19-t2-results.mjs`) ran in all twelve cells.
  - Every cell committed exactly one report commit and touched no path outside its ticket.
  - Every report exists: 2,750 to 3,260 words, each with a Mermaid diagram.
- **The relation question, every answer correct:**
  - **The three exact cells** (C, I, J) each said their tolerance is *not* the strongest relation their evidence supports, and that exact f32, with NaN compared as a class, is.
    - I found why "as a class" is needed: `__fsqrt_rn(-2⁻¹⁴⁹)` gives `0x7fffffff` on the GB10 and `0xffc00000` in Node. Both are NaN.
  - **The nine single-precision cells** each said tolerance is the strongest relation for the emitter they shipped, because `expf` and `tanhf` differ. Most noted that my exhaustive result supports exact for a double-precision emitter.
    - D, G and F each ran one untimed probe that swapped in the double call, and saw every mismatch disappear.
    - K and L proposed a conditional contract: exact where only matching operations occur.
- **Merge:** `2e035c6` merges IRWB-022-I. `tools/cuda-remote.mjs` conflicted add/add with the copy on this branch, and I resolved it to I's version.
  - `1534fad` restores the header lines on the Tailscale host and the sandbox, which I's version had dropped.
  - `npm test`: 427 tests, 424 pass, 0 fail, 3 skipped.
  - I's report is published as vault report 13, with a provenance note.
- **A mistake of mine:** looking for a kit script, I ran `find / -name …`, which scanned the disk for two minutes until I stopped it. The user objected; it's now a memory rule (search only known directories).
- **Efficiency** (`various/eff-probe/main.cu`; cuBLAS in pedantic FP32 math, no TF32; median of 20 event-timed runs; under the GPU lock):

  | Reference | Measured |
  |---|---|
  | cuBLAS SGEMM, matmul 512³ | 0.0329 ms (8.15 TFLOP/s) |
  | cuBLAS, attention's two GEMMs | 0.0177 + 0.0216 ms |
  | cuBLAS, mlp's two GEMMs | 0.0423 + 0.0475 ms |
  | cuBLAS SGEMM 4096³ | 19.2 TFLOP/s (practical FP32 peak) |
  | streaming `y = 2x`, 64 MB in and out | 244 GB/s |
  | streaming `y = 2x`, at the softmax size (32 MB moved) | 0.143 ms |

  Set against the merged base I's kernels (the evaluator's single runs):
  - **matmul:** 0.197 ms, so 1.36 TFLOP/s: 6.0× cuBLAS, 7% of the practical peak.
  - **mlp:** 1.051 ms, so 1.02 TFLOP/s: 11.7× cuBLAS's two GEMMs.
  - **attention:** 1.81 ms (I's own warm median 1.05) against 0.039 ms for cuBLAS's two GEMMs.
  - **conv:** 0.83 TFLOP/s.
  - **softmax and layernorm:** 0.785 and 0.563 ms. One kernel per statement moves about 100 MB, a bound of 0.41 ms; a fused single pass moves 32 MB, a bound of 0.143 ms.
  - **The nine single-precision backends** are at a median 0.475 ms for softmax, 1.16× the unfused bound.
  - **What exactness costs:** the double transcendentals make softmax about 1.65× slower (medians 0.785 against 0.475) and mlp and attention 7–15% slower. matmul, conv and layernorm show no consistent difference.
  - **Caveat:** the evaluator's `gpuMs` are single runs in fresh processes, and differ from I's warm medians by up to 2× (attention, conv).

## Step 27: round R2, creativity and scientific depth (four models); the model scorecard artifact

- **The user's request** (verbatim): "ok let's try something different, let's make a pass and comparison across models (sol, astra in codex, opus fable) on creativity and scientific prowess, and ask them to come up with design documents on all possible compiler work they would do to make tix best in class, they can research all they want, test all they want, etc... then score on ingenuity, creativity, advanced science. design doc and diaries and all that"
- **The round** (`prompts/r2/common.md`, `scripts/20-launch-r2.sh`, `results/r2-config-key.json`). The question: what compiler work would make Tix best in class? Research and experiments are allowed; product code stays unchanged; deliverables are a ranked design document, a diary and commits.
  - **Cells:** IRWB-023-A is Codex · Sol · high; B is Codex · Astra · high; C is Opus and D is Fable, as Claude Code subagents at their default effort. Their effort is left unset because the user named no level this time, so the efforts do not match; report it as a caveat.
- **Base:** `r2-base` at `12bc661`, which is I's tip `ff1c4e7` plus the tool header fix. It has no `BACKLOG.md` and no IRWB-019 ticket, so no agent sees my queue or analysis, and the ideas are their own.
- **Policy r2** (`developer-instructions-r2.md`) keeps only the probe rule and the isolation rule.
  - v1 says "describe only what can be built with the current code" and "prefer the smallest deliverable". Those would cap a creativity round, and a policy outranks the brief (§6 of report 11).
  - The global Codex config carries v1, which `-c developer_instructions` overrides.
  - The Claude cells get the same two rules at the top of their brief (`scratchpad/claude-briefs/`).
- **Research for Codex:** `codex exec` has no `--search`, but `-c web_search=live` works in `exec` mode. One probe confirmed it ("web search: site:arxiv.org/abs/1706.03762 …"). Network access stays on for `ssh`. Timeout: 3 hours.
- **Judging, planned before reading any design:** two blind judges from different model families, a Claude subagent and Codex · Sol, with web access to check citations, scoring ingenuity, creativity, scientific depth, evidence, correctness and padding. Then I verify the load-bearing claims and experiments myself. The cross-family pair is meant to expose self-preference: the stage-1 and stage-2 judges were Claude only.
- **The scorecard artifact,** at https://claude.ai/artifact/LohZckE2CXVn7PGZV41dhW, uses the Data type, with every figure traced to a data file.
  - `scripts/21-scorecard-data.mjs` builds five JSON files (designs, implementations, kernels, references, R2 cells). Each embeds the script's own code. The page source is in `various/scorecard/index.html`.
  - It shows the per-model summary, the design scatter per stage, Sol's policy session, implementation sizes, the twelve stage-2 backends, speed against cuBLAS and bandwidth, and the R2 cells (running).
  - **A bug, found by the type's check** ("not_a_number" ×12 in the implementation chart): the Pi cells' model ids are `openai-codex/gpt-6.2-…`, so my lookup table mapped them to nothing, and 12 rows had no model.
    - The fix: match the model by name, and throw on any unmapped cell.
    - My earlier per-model answer to the user was unaffected, because it stripped the prefix with a regex.

## Step 28: round R2 finished; the blind pack; two cross-family judges

- **All four cells finished well inside their three hours.** Each stayed inside its ticket and left a clean worktree:

  | cell | minutes | design words | commits | other measures |
  |---|---|---|---|---|
  | A (Codex · Sol · high) | 23 | 6,974 | 3 | 64 commands, 5 web calls, 63K output tokens |
  | B (Codex · Astra · high) | 31 | 6,968 | 5 | 132 commands, 11 web calls, 72K output tokens |
  | C (Opus) | 62 | 10,392 | 19 | 553K subagent tokens, 161 tool uses |
  | D (Fable) | 16 | 5,583 | 6 | 185K subagent tokens, 24 tool uses |

  Claude usage in IRWB-019 is now 4.18M subagent tokens in total (`results/claude-usage.json`).
- **Convergence, and a caveat about my brief.** A, B and D all centred on running the exact f32 order in parallel, and C on exact-meaning scheduling. My brief's facts section led with the bit-exact result, so the convergence may be partly anchoring. Report it with the scores.
- **Claims to verify after judging,** from the final messages only, not the designs. They are load-bearing:
  - D: a mutant `mlp` that sums over the wrong index is accepted by the merged stage-1 gate, because the case generator sets some shape symbols equal.
  - C: the stage-1 gate accepts an all-zero output at small scale, and the current sample shapes exercise no tile; exhaustively verified fast `exp` and `tanh`; 3.76× on the corpus, bit-identical.
  - B: exact attention 1.046 → 0.757 ms; certified exponentials over every nonpositive f32 input.
  - A: exact tiling 3.80× at 512³; a dyadic guard for INT8 contraction.
- **The blind pack** (`scripts/23-pack-r2.mjs`, seed 13: doc-A=D, doc-B=A, doc-C=C, doc-D=B; key in `results/blind-key-r2.json`). Each whole ticket is copied, with ticket ids, branch and worktree names and model, vendor and harness names replaced.
  - The first run leaked: the Claude cells' diaries quote my launch wrapper and its scratchpad path. Both are now replaced, and the leak scan reports nothing.
  - The default seed's shuffle was the identity, so I switched to seed 13.
- **The judges,** given the same prompt (`scratchpad/judge-r2-out/prompt.md`) and the rubric `scripts/22-judge-rubric-r2.md`, which I wrote before reading any design:
  - a Claude subagent (Opus, default effort);
  - Codex · Sol · high, read-only, with live web search.
  
  Both may read the r2-base worktree to check claims about the code, and neither runs GPU jobs.
- **Scorecard:** the R2 cells show as done, with minutes and design words. The check passes.

## Step 29: the Claude judge's scores; the Codex judge stalled on stdin; four load-bearing claims reproduced

- **The Claude judge** (Opus, 310K subagent tokens, 14 minutes; `results/r2-judges/claude-opus.md`). Mapped through the blind key:

  | model | overall | ingenuity | creativity | depth | evidence | correctness | grounding | padding |
  |---|---|---|---|---|---|---|---|---|
  | **Opus** | **9** | 8 | 7 | 8 | 9 | 7 | 9 | 3 |
  | Fable | 8 | 8 | 8 | 7 | 8 | 7 | 8 | 2 |
  | Astra | 7 | 8 | 7 | 8 | 9 | 9 | 8 | 4 |
  | Sol | 6 | 6 | 5 | 7 | 7 | 9 | 8 | 5 |

  Padding is lower-is-better.
  - The two Claude cells rank first and second under a Claude judge. That is the self-preference the second judge tests, so these scores stay provisional.
  - The judge reproduced the local experiments it could, and found errors in Fable's and Opus's documents:
    - Opus wrote "no schedule can parallelize the fold", which is refuted by Fable and Astra, who both built a bit-identical parallel fold.
    - Two documents misquote Kapre and DeHon.
    - Several documents miss KLEE-FP and KLEE-CL as prior art.
    - Fable's 33× is measured against an unstaged one-thread baseline.
- **The Codex judge** sat for 14 minutes on "Reading additional input from stdin…". `codex exec` reads extra prompt input from a non-terminal stdin, and a command run inside a backgrounded shell inherits an open one. The kit's launcher escapes this because its jobs run with `&`, which gives them /dev/null. I stopped it and relaunched with `< /dev/null`. This goes in the playbook.
- **Four load-bearing claims, reproduced by me** (`results/r2-verify/`):
  - **Fable: the merged stage-1 gate accepts a wrong mutant.** Rerunning `05-normal-form-proof.mjs` gives `sampledGateAccepted: true` for `mlp` summed over O instead of D, with differing outputs at D = 4, O = 2.
    - Root cause, read in `src/tensor/contract.ts:25-36`: sorted symbols with sizes cycling [3, 5, 7], so D = O in every case. Logged as BACKLOG F21. Opus's absolute-tolerance finding is F22.
  - **Opus: exhaustively verified fast `exp` and `tanh`.** Rerun on the GB10 from a copy: 0 mismatches over 4,294,967,296 inputs for each (0.59 s and 0.46 s). The reference is stage 2's double routine, which step 23 proved equal to the f32 meaning.
  - **Astra: exact attention.** Its benchmark rerun on the GB10 gives medians of 1.050 ms (generated) against 0.760 ms (three kernels), 1.38× faster. The GPU output hash `1a7e0197…` equals the Node interpreter's, which I recomputed myself (38 s).
  - **Sol: exact tiling.** Its benchmark rerun gives the 512³ exact tile at 0.0537 ms against 0.2092 ms for the ordered kernel (3.9×), all 262,144 words equal. The guarded INT8 route is also exact but slower than the FP32 tile.
- **Convergent findings across cells** (BACKLOG T6 updated):
  - An exact tiled 512³ matmul takes 0.054–0.058 ms in three independent cells, 1.6–1.75× cuBLAS. My hypothesis of exact parity with cuBLAS at 512³ is refuted.
  - cuBLAS at 4096³ equals a sequential FMA fold bit for bit (Fable and Opus).
  - A parallel fold that stays bit-identical to the sequential one (Fable's parity transducer; Astra's even-translation certificate) was found by two cells. The judge found no published version.

## Step 30: the Codex judge reverses the Claude judge; a pack bug of mine; both judges rerun

- **The Codex judge** (Sol, high; `results/r2-judges/run1-codex-sol.md`), mapped through the key:

  | model | Claude judge, run 1 | Codex judge, run 1 | Codex judge's errors | Claude judge's errors |
  |---|---|---|---|---|
  | Astra | 7 | **9** | 1 | 0 |
  | Sol | 6 | 8 | 3 | 0 |
  | Fable | 8 | 7 | 7 | 4 |
  | Opus | **9** | 6 | 12 | 3 |

  - **Each judge ranks its own family's two documents first and second,** a complete reversal.
  - **Within each family, the two judges agree:** Opus over Fable under the Claude judge, Astra over Sol under the Codex judge. Across families, each judge ranks the other family's documents in the same order (Claude judge: Astra over Sol; Codex judge: Fable over Opus).
  - **Correctness is where they agree** in direction. Both find the Codex documents more correct (Claude judge 9 and 9 against 7 and 7; Codex judge 9 and 8 against 4 and 5). The Codex judge found 23 errors against the Claude judge's 7, and many look substantive and checkable. For example:
    - Fable's normalizer collapses the literals `0` and `-0`;
    - Fable's "2.49× over the fixed tolerance" compares against the sequential f32 fold where the gate uses the f64 origin;
    - Opus's batch invariance fails for `y[i,j] = x[i,j] + M`;
    - Opus's residue recipe in the document differs from its code;
    - Opus's "three kernels" for attention omits a transpose launch.
- **A pack bug, mine.** `23-pack-r2.mjs` copied files by an extension list that matched `.json` but not `.jsonl`. It dropped 8 result logs each from Sol and Astra and 5 from Opus, and none from Fable. The Codex judge deducted for "cited results missing" (Sol #3, Opus #12, Astra #1), so the error was not neutral across documents.
  - The fix: copy any file without NUL bytes, under 5 MB. Repacked with seed 13 (same letters); file counts now equal the tickets (16, 26, 55, 90); no leaks.
  - Both judges are rerunning fresh on the complete pack (`claude-2.md`, `codex-sol-2.md`).
  - Run 1 stays as a record. The family reversal appears even with the bug: the Codex judge ranked Sol second although Sol lost logs and Fable lost none. With run 2, it also gives each judge's run-to-run variance.
- **For the playbook:** a blind pack must be checked for completeness (file counts against the source), not only for leaks. And a cross-family judge pair is necessary: a single-family judge would have produced a confident ranking that the other family reverses.

## Step 31: round R2 judged (four judge runs); the family effect; errors adjudicated

- **The second runs on the complete pack** (`results/r2-judges/run2-*.md`); analysis in `scripts/24-r2-analysis.mjs` and `results/r2-scores.json`:

  | model | Claude r1 | Claude r2 | Codex r1 | Codex r2 | mean | errors listed (C1, C2, X1, X2) |
  |---|---|---|---|---|---|---|
  | Astra | 7 | 7 | 9 | 9 | **8.0** | 0, 0, 1, 1 |
  | Opus | 9 | 8 | 6 | 7 | 7.5 | 3, 5, 12, 10 |
  | Fable | 8 | 7 | 7 | 7 | 7.25 | 4, 3, 7, 8 |
  | Sol | 6 | 6 | 8 | 8 | 7.0 | 0, 1, 3, 3 |

- **The family effect** is larger than any model difference:
  - the Claude judge scores its own family 1.5 points higher (8.0 against 6.5);
  - the Codex judge 1.75 points higher (8.5 against 6.75);
  - averaged over both judges, the largest gap between models is 1.0.
  
  Within a judge, run-to-run changes are at most 1 point per model; 5 of 8 are 0. So each judge is consistent with itself and biased by family.
- **What the judges agree on:**
  - **Errors.** In all four judge runs, the two Claude designs have more listed errors than the two Codex designs (7–19 against 0–4). I re-checked three of the Codex judge's errors against the Claude designs, and all three hold:
    - Opus's batch invariance fails for `y[i] = x[i] + N`: in the merged interpreter, `y[0]` is 6 at N = 1 and 7 at N = 2;
    - Opus's `ratio > K_NORM` never flags a NaN;
    - Fable's "2.49× the fixed tolerance" uses the sequential f32 sum as reference, where the gate uses the f64 origin (`contract.ts:68`).
    
    The Claude judge was the lenient one: 16 errors over two runs, against 45 for the Codex judge.
  - **Creativity.** Both judges score Sol lowest ("least distant from the standard fusion playbook"). Creativity means over the four runs: Fable 8, Astra 8, Opus 7.75, Sol 6.25.
  - **Evidence.** Astra is highest under both judges (9.25 mean). The Codex judge in run 2 gave Astra evidence 10, Sol 9 and Opus 9 once the logs were present.
- **My reading:**
  - Astra (Codex, high) produced the best-evidenced and most correct design, with the most original single mechanism, the fitted, exhaustively certified `exp`. It ranks first on the cross-family mean.
  - Opus produced the broadest and most ambitious design, with the most errors and overclaims.
  - Fable produced the most original theoretical idea (the parity transducer) in the shortest time (16 minutes).
  - Sol produced the most conventional plan.
  - The differences between models are smaller than the judge's family effect. Only the error counts, and the reproduced experiments, are free of it.
- **Claude usage:** 4.80M subagent tokens in total. This round used the two cells (0.74M) and two judge runs (0.62M).
- **The scorecard** has a new section, "How the two judges scored the creativity round", with the four judge runs per model, the dimension means, error totals, the family effect and the retest spread. Every number is drawn from `r2_scores`; the check passes.

## Step 32: the gate fixes (F17, F21), v3 as the global Codex policy, and the Codex re-judging of stages 1 and 2

The user settled the four open decisions, and I did all three that needed work. The gate is now exact for the CUDA lowering and can tell every pair of shape symbols apart. The global Codex policy is v3. Stages 1 and 2 were re-judged by a Codex judge, and the stage-1 scores turn out to depend on the judge's family as strongly as R2's did.

- **The user's decisions** (verbatim): "4. yes 3. yes 2. does pi vs codex matter? 1. yes", then "but first, answer", then, about the T3 matrix, "let's just do codex, for now, and eave pi aside."
- **Pi against Codex, from the existing data** (same model and policy, three cells per group):
  - Designs: Codex is better for Astra in both stages, by about one point on over-engineering and fitness. For Sol the sign flips between stages.
  - Implementations: no harness effect on correctness, size, time, exactness or kernel speed.
  - So T3 runs Codex Sol and Codex Astra at medium effort, plus Opus and Fable.
- **F21** (`250626e`): `cases()` cycled sizes 3, 5, 7 over the sorted shape symbols, so in `mlp` (D, H, N, O) D = O in every case. The "mixed" assignment now gives every symbol a different size. The empty-extent cases, previously only in the CUDA contract, are in the meaning gate too. They are compared, but only a case with every extent nonempty counts as coverage; without that rule, the existing test whose nonempty cases are all NaN was accepted, and its test failed.
  - New test: Fable's D/O mutant on top of the real `inline` is rejected, and genuine `inline` is accepted. It fails on the previous build ("Missing expected exception").
- **F17** (`885601f`): `checkLowering` compares f32 words against the current revision's f32 meaning (signed zeros and infinities included, NaN as a class) and reports `exact`. Invariant version 2. A new test checks that one ulp is rejected and a different NaN word is accepted.
- **Validation on main after both:** tensor tests 21/21, GPU tests 10/10 (all six corpus programs, before and after optimization, accepted as exact), frozen stage-1 suite 25/25, `npm test` 426 pass, 0 fail, 3 skipped, and the stage-2 hidden evaluation on main exact everywhere ("check accepted 16/16 [exact]").
- **v3 as the global Codex policy:** `~/.codex/config.toml`'s `developer_instructions` replaced with v3, without the experiment's isolation line. Backup: `~/.codex/config.toml.bak-2026-11-26-before-v3`. The TOML parses and its top-level keys are unchanged.
- **The Codex re-judging** (Sol, high, read-only sandbox, same packs, rubrics and base revisions as the Claude judging; `results/judge-scores-t{1,2}-codex.json`):

  | | Claude judge | Codex judge |
  |---|---|---|
  | Stage 1, the 4 Claude designs: fitness / over-engineering | 8.50 / 2.75 | 5.25 / 7.00 |
  | Stage 1, the 12 OpenAI designs: fitness / over-engineering | 7.08 / 3.50 | 8.92 / 2.08 |
  | Stage 1, rank correlation (Spearman) of fitness / over-engineering | -0.29 / 0.33 | |
  | Stage 2, all 12 OpenAI designs: rank correlation | 0.62 / 0.60 | |

  Within one family, the judges mostly agree (stage 2). Across families they disagree, and on stage 1 their fitness rankings are weakly opposed. The stage-1 headline, "Fable's designs were the fittest", holds only under the Claude judge. Under the Codex judge, Astra's are (9.17 against Fable's 5.50).
- **Scorecard:** the designs dataset carries both judges (`judge` column). The design scatter has a judge selector, and the models table shows both judges side by side. The lede names each judge's leader, and the caveat now states the family effect. The check passes.
- **Backlog:** F17 and F21 marked done, T3's cells recorded, M6 notes v3 as the global default (`23e87fc`).

## Step 33: R1 and R2 on two more model families through Pi (R1b, R2b)

The user asked for the two research rounds on DeepSeek and GLM through Pi. Neither family is the family of either judge, so these cells are scored by two out-of-family judges: the cleanest comparison the experiment has had.

- **The user's request** (verbatim): "ok let's actually on R1, R2 try out pi coding agent tests with deepseek-4.1-flash high / xhigh / max, glm-5.3-flash high / max, glm-5.3-flash high / max ."
  The GLM entry appears twice. Pi also offers `glm-5.3`, the model without "flash", which may be what the second meant. I launched the unambiguous five configurations and asked.
- **Probes:**
  - **The provider is an extension.** Both models come from the LunaRoute provider, which is a Pi extension (`@lunaroute/pi-extension` 0.18.0). With `--no-extensions` alone, Pi lists no DeepSeek model. With `--no-extensions --no-mcp -e <the extension>`, all six model and thinking-level combinations answered a probe. The extension also brings a `web_search` tool and four image tools.
  - **Tools are pinned with `--tools`.** `--tools read,bash,edit,write` gives exactly Pi's four built-in tools, the set the original R1 Pi cells had. Adding `web_search` gives the R2 cells web research, as the R2 brief asks (Codex had `web_search=live`, the Claude cells WebSearch and WebFetch).
  - **The thinking levels:** the cached catalogue (`~/.pi/agent/models-store.json`) maps DeepSeek's high, xhigh and max to three distinct levels. GLM 5.3 Flash (and GLM 5.3) maps only low, high and max to distinct levels: its `xhigh` becomes `high` or nothing. So the user's levels are exactly each model's distinct ones. Pi records the requested level in every session.
- **The cells** (`results/r1b-config-key.json`, `results/r2b-config-key.json`; launcher `scripts/25-launch-r1b-r2b-pi.sh`):

  | config | model | thinking | R1b item | R2b item |
  |---|---|---|---|---|
  | ds-h | DeepSeek 4.1 Flash | high | IRWB-021-M | IRWB-023-E |
  | ds-x | DeepSeek 4.1 Flash | xhigh | IRWB-021-N | IRWB-023-F |
  | ds-max | DeepSeek 4.1 Flash | max | IRWB-021-O | IRWB-023-G |
  | gf-h | GLM 5.3 Flash | high | IRWB-021-P | IRWB-023-H |
  | gf-max | GLM 5.3 Flash | max | IRWB-021-Q | IRWB-023-I |

- **The same bases, policies and briefs as the originals:**
  - R1b: base 19ad269, v1 policy, a two-hour cap (as R1's xhigh cells).
  - R2b: base 12bc661, the R2 policy, a three-hour cap.
  - The only brief change: R2b's common.md says the GPU machine is shared with four other agents (R2 said three).
- **A false start of mine:** I first launched the cells in a background command with a 10-minute timeout, which the harness might enforce and so kill the cells. I stopped it within seconds, confirmed that no Pi process remained and the ten worktrees were clean at their bases, removed the partial logs, and relaunched without a timeout.
- **GLM 5.3 added** on the user's answer ("glm-5.3 yeah"): high and max in both rounds (IRWB-021-R and -S, IRWB-023-J and -K), launched about 20 minutes after the first ten, with `ONLY=` on the launcher. The two R2b cells' brief (`prompts/r2b-2`) says six other agents share the GPU machine, which is true from then on. The first five R2b cells were told four, which was true when they started. Fourteen cells in all: seven per round.
