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
