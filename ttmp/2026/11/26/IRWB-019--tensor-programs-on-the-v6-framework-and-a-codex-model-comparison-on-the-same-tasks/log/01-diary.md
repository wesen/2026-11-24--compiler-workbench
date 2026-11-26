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
