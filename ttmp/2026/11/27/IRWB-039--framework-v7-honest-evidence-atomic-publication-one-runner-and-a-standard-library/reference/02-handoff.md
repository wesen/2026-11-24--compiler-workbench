---
Title: Handoff - resuming the v7 refactor and the agent-driven workflow
Ticket: IRWB-039
DocType: reference
Topics: [framework, handoff]
Status: active
---

# Handoff: resuming the v7 refactor and the agent-driven workflow

This document is for a colleague who takes over the IR Workbench work from the coordinator (Claude Code with the user) on 2026-11-28. It covers four things: what the project is, where the work stands, how a round of agent work is run, and the rules that have accumulated. Read it once, then the documents in "Read first", then the latest diary step.

## 1. What this project is

The IR Workbench is a compiler research framework written in TypeScript (Node 24). Every optimization is a checked transformation. A *meaning contract* compares a pass's output with its input on generated cases. Every edit carries a *correspondence* back to the IR it came from. The result is published to an IR store only after every obligation passes.

Two compilers are built on the framework, and they are its test cases:
- **Typed** is a small statically typed language compiled to 32-bit RISC-V (`src/typed/`, corpus `corpus/projects/`, 50 projects).
- **Tix** is an index-notation tensor language compiled to CUDA (`src/tensor/`, corpus `corpus/tensor/`). It runs on a remote NVIDIA GB10.

The framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`) sits above a standard library of named compiler algorithms (`src/stdlib/`).

**v7** is the refactor that the R3 review designed. Four agents reviewed the framework after the Typed and Tix experiments; their synthesis proposed six concepts (K1–K6) and a library. The plan for it is ticket IRWB-039.

Most implementation work is done by coding agents (Codex, Pi, Claude) in parallel git worktrees. The coordinator writes briefs, launches cells, scores each cell on its commit, reviews the diffs, and merges by cherry-pick. How well each model does on which kind of task is itself one of the research questions.

## 2. Where things are

| What | Where |
|---|---|
| Repository | `/home/manuel/code/wesen/2026-11-24--compiler-workbench`, remote `git@github.com:wesen/2026-11-24--compiler-workbench.git` (public) |
| Working branch | `irwb-001/import-v6-prototype`. All merged work lands here, and it is GitHub's default branch. |
| `main` | Pushed once, at `c07a1e4` (phase 3 merged). **Do not advance it directly.** The user asked for a PR, working branch → `main`, when v7 is done (section 9). |
| Tags | `v7-p0`, `v7-p1-base`, `v7-p1`, `v7-p2-base`, `v7-p2`, `v7-p3`, `v7-p4-base`: the base and result of each phase |
| Agent branches | `v7-<task>-<config>/irwb-NNN[-X]`, all pushed. Unmerged cells are kept as the record of the comparison. |
| Worktrees | `.claude/worktrees/v7-<task>-<config>-irwb-NNN[-x]` |
| v7 ticket | `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` |
| Earlier experiment ticket | `ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/`, which holds the R3 synthesis in `various/r3-synthesis/` |
| Project origin | `ttmp/2026/11/24/IRWB-001--ir-workbench/` (diaries in `log/`) |
| Backlog | `BACKLOG.md` at the repository root, with fixes F1–F39 and the research stages (tensor T*, Typed A*/B*/D*) |
| Vault (Obsidian, its own git repo) | `/home/manuel/code/wesen/go-go-golems/go-go-parc`: project reports in `Projects/2026/11/2*/`, playbooks in `Research/playbooks/` |
| GPU machine | `ssh manuel@bling` (Tailscale short name; `bling.local` only on the home LAN). GB10, `sm_121`, CUDA 13 `nvcc`. Tests reach it through `tools/cuda-remote.mjs`. |

## 3. Read first, in this order

1. **The v7 plan:** `IRWB-039/design-doc/01-the-v7-refactor-plan-phases-decision-points-and-who-does-what.md`. It covers the phases, the decision points, and who does what.
2. **The v7 diary:** `IRWB-039/reference/01-diary.md`. Steps 1–8 record what was run, scored and merged, and why; the latest step is the current state.
3. **The R3 synthesis:** `IRWB-019/various/r3-synthesis/index.html`, published at https://claude.ai/artifact/GJoGirJU2XaKCR83mvcQAQ (private; open the local file if you cannot). Sections K1–K6, "The standard library" and "The migration" are the specification behind every phase-4 brief.
4. **`BACKLOG.md`:** the open fixes and the research stages after v7.
5. **The agent-briefing playbook:** `Research/playbooks/PLAYBOOK - Briefing and Launching Coding Agents Without Over-Engineering.md` in the vault. It holds the policy text given to every agent, the brief structure, the launch commands for Codex, Pi and Claude, staffing guidance with this ticket's results, and the hazards.
6. **The two experiment playbooks**, `Research/playbooks/agents/` in the vault:
   - `PLAYBOOK - Comparing Coding-Agent Configurations on the Same Design-and-Implement Tasks.md`;
   - `PLAYBOOK - Measuring and Reducing Over-Engineering in Agent-Written Designs.md`.

   Their launch and analysis scripts are in `Research/playbooks/agents/scripts/agent-design-review/` (start with its `README.md`).
7. **The latest project reports** in the vault, for depth: `Projects/2026/11/27/PROJECT REPORT - IR Workbench - What Forty Implementations Say About the Framework - R3 Synthesis - A Technical Deep Dive.md`, and the IRWB-019 report next to it.

## 4. Where v7 stands

| Phase | Content | Status |
|---|---|---|
| 0 | absorb the T6, A0 and B1 merges | done (`v7-p0`) |
| 1 | honest evidence (F34), atomic publication (F33), coverage-checked correspondence (F35), Tix gates in plans (F27), Typed defects F36–F38; probes as tests, baselines | done (`v7-p1`) |
| 2 | standard library: `flow` (liveness, solver), `graph`, `lattice`, `affine`, `num` | done (`v7-p2`, plus the solver move) |
| 3 | one runner with a synchronous and an asynchronous driver; every pass a `Transformation`; contracts and strategy plans under both drivers | done (`v7-p3`) |
| 4 | eight items, each behind a decision point | in progress (below) |

**Phase 4:**

| Item | Status |
|---|---|
| 4.1 derivations (K2) | **merged** (IRWB-056-B, DeepSeek). Rule-citing records 0 → 183; correspondence from steps equals today's on all 547 O2 and `speed` applications; both A0 policies are queries over the records (203 and 393; the 2-record gap from 395 is explained in its test); cost 0.99× |
| 4.2 lowering as cross-IR transformations | **merged** (IRWB-061, Fable): `CrossTransformation<In, Out>`; both lowerings on the runner; composed correspondences equal today's. The default paths (`lowerToImage`, `cudaSource()`) are *pending* applications: the check is recorded as owed, and nothing in `src/` calls the checked path (`lowerImageChecked`) yet |
| 4.3 attribution and classification as queries | **merged** (IRWB-065-A, GLM): `src/framework/ir/attribution.ts`; D1 and D2 reproduce byte for byte (whole-corpus differential: 0 differences); A0's 203 and 395 are both queries |
| 4.4 fusion and scheduling as decide/eligible/prepare (K6) | **merged** (IRWB-057, Fable). The unification held, and the extent-17 counterexample is rejected. |
| 4.5 `solveFor` and `pe` | **done, partly withdrawn** (IRWB-058, Sol low). `solveFor` is merged with SCCP as its client. The decision point fired for `pe`: B1's specializer restated on it is 652 lines against a 324-line limit, so `unfold` is withdrawn and B1 stays as it is. |
| 4.6 rules over a term signature | **merged** (IRWB-060-A, GLM): `src/stdlib/term/`; Typed's matcher and verifier and Tix's `inline` and `split-sum` on it; cost +3–5%, under the 10% gate; F40 done |
| 4.7 keep or delete the rewrite engine, the transaction layer and the 1,237-line core runtime | **decided** (IRWB-066, Sol low): the runtime and the graph rewrite engine moved to `src/labs/` (tests in `tests/labs/`); transactions and traversal kept (the runner uses them). The E1 benchmark is in its ticket. **Open:** the cell read R3's gate as absolute cost falling with size; on the relative reading the runtime passes (2.8–3.7× on chess, 27× on Candela). The user decides whether to adopt it. |
| 4.8 staged choice | **merged** (IRWB-062, Sol low): one launch `select` for gates and variants; `modesOf` derives the arms; CUDA byte-identical |

The cleanup lane (IRWB-055, Terra low) is merged: `steps.ts` moved into `core`, one identity algorithm, one plan builder.

**Where things stood at handoff:** v7 phase 4 is closed (IRWB-064 diary step 3): every item is merged or withdrawn at its decision point, and the v7 PR into `main` is open. Two decisions are with the user: the 4.7 gate reading, and whether the checked lowering runs on a default path.

## 5. How a round works

Each round is one or more *lanes* (tasks). A lane has one or more *cells*, one agent configuration each. Every step below has a script in `IRWB-039/scripts/`.

1. **Write the brief.** Each lane has a directory `various/prompts/<task>/`:
   - `common.md` holds the task;
   - one empty `<ITEM>.md` per cell;
   - a config key, `various/results/<task>-config-key.json`, gives per cell its round name, model, effort, harness (`codex`, `pi`, `claude-code-subagent`) and tools.

   `scripts/10-write-briefs-p4.py` is the latest generator and shows the structure. The standard header comes from an earlier brief, then the task, then the acceptance and the repository facts. Every brief must state:
   - the acceptance: the step's own tests, `02-baselines.mjs check` printing `no differences`, the five suites, and tsc;
   - the scope: the files it may touch and the files other lanes are changing now. **Make lane scopes disjoint.**
   - that the coordinator's ticket is read-only;
   - that a test asserting the behaviour being changed must be updated, and the change reported;
   - that scripts go in the agent's ticket `scripts/`;
   - never `git stash`, and no GPU tests unless the lane is the only GPU user.
2. **Tag the base and launch.**
   - `git tag -f v7-pN-base`, then a launcher such as `scripts/11-launch-p4-lanes.sh <timeout-seconds> <task>...`. It creates worktrees from `BASE` and starts each Codex or Pi cell through the vault kit (`01-launch-codex-round.sh`, `12-launch-pi-round.sh`) with `various/prompts/developer-instructions-v4.md` as the standing policy.
   - **Never edit a launcher while it runs;** copy it to a new number.
   - Claude cells run as Claude Code subagents (the Agent tool, model `fable` or `opus`). Create their worktree with `git worktree add -b <branch> <path> <base>` and run `npm ci` in it. Then write a wrapper prompt that holds the policy and the brief (see `various/prompts/fusion/claude/IRWB-057.md`), and point the agent at that file.
   - Logs and sessions land in `various/kit/<round>/`; `logs/exits.txt` gets one line per finished cell.
3. **Wait.** Watch `exits.txt` with a background loop rather than polling by hand.
4. **Score each cell on its commit, never on its final message.**
   - `BASEREF=<base-tag> scripts/07-score-lanes.sh <worktree-name>...` appends one JSON line per cell to `various/results/lanes-scores.jsonl`.
   - It checks build, tsc, Prettier (beyond 7 known files; the scorer's list still names `differential.ts`, which is now formatted), baselines, the five suites, files touched in the coordinator's ticket (`oracleFilesTouched` must be 0), and dirty state.
   - Run scorers one at a time: they are heavy.
5. **Review the diff.** Tests cannot see what matters most: interface choices, implicit scope, state left behind, an agent editing the oracle. Read the final message in `various/kit/<round>/logs/<ITEM>.last-message.md`, then the diff of every design-bearing file. When two cells pass, choose by what the review shows, and record why in the diary.
6. **Merge by cherry-pick,** `git cherry-pick <base>..<cell-branch>`. Never a merge commit and never `git stash`. Conflicts so far have only been unions in `src/stdlib/index.ts` and comment blocks; resolve them by keeping both sides.
7. **Check on the working branch:**
   - `npm run build && npm run check`;
   - the five suites, each as `node --test tests/<dir>/*.test.mjs` (tensor without `*-gpu`);
   - `node <ticket>/scripts/02-baselines.mjs check`;
   - `npm run build:site`;
   - the GPU suite `node --test tests/tensor/*-gpu.test.mjs`, only when no agent holds the GPU.
8. **Scan, then push.**
   - The repository is public. Scan the diff since `c07a1e4` for secrets and for the user's private strings before every push. Pass the private patterns in an environment variable (`SCAN_PRIVATE='…'`), never written into a script: a scan that contains the string publishes it.
   - Then `git push origin irwb-001/import-v6-prototype <tags> <cell-branches>`.
9. **Record.**
   - Add a diary step: what ran, the scores, what was merged and why, the checks, the follow-ups. Use the investigation format, with exact numbers and errors.
   - Update `BACKLOG.md` statuses.
   - Commit with the trailer `Co-Authored-By: …` as in the existing history.

## 6. Who to use for what (evidence from IRWB-039)

| Kind of task | Use | Evidence |
|---|---|---|
| Specified fix, with a test of the correct behaviour that must flip and a baseline that must not move | Pi GLM 5.3 high or DeepSeek 4.1 Flash xhigh; Codex Terra low (`gpt-6.1-terra`) for small ones | phase 1: GLM and DeepSeek passed 7 of 7 tasks, Terra 5 of 7 |
| Library extraction (moving code under an interface) | two cheap cells per lane, choose by review | phase 2: 8 of 8 cells passed, and review decided |
| Open design question | a spike of 2–3 strong cells (Codex Sol or Astra at low, Fable), judged on measurements | phase 3: all three converged on one runner with two drivers |
| One-implementer migration of shared core code, or a design-bearing domain change | Fable (Claude Code subagent) | phase 3 migration in 28 minutes; K6 fusion and scheduling in 25 minutes |
| Experiment with a sharp decision point | Codex Sol low | IRWB-058 measured the gate and withdrew `unfold` honestly |

- The strong-model work is the preparation: turning a design question into a test that must flip, a baseline that must not move, and the probe that shows the defect.
- Pi cells take 30–75 minutes, Terra 4–25. LunaRoute ends a single streamed response at 20 minutes, so avoid max-effort Pi cells on long tasks.
- One run in the matrix showed the main hazard: a cell (GLM) rewrote the coordinator's baseline file to make its check pass. Every brief since forbids touching the coordinator's ticket, and the scorer checks it.

## 7. Standing rules

These come from the user during the project; keep them.

- **Theory first.** Domains use framework concepts. Machinery a domain builds for itself is a smell to report, never to leave unremarked. Missing concepts go into the framework, domain-independent and stated in standard theory: lattices and fixpoints, dependence analysis, rewriting, translation validation, partial evaluation.
- **Library admission:** a named algorithm, two clients, an executable test. Code is moved, not copied; the old copy is deleted.
- **Baselines are the oracle.** Images, instruction counts, edit records, CUDA source and Tix revisions stay byte-identical unless the step is meant to change them, and then each difference is explained. Re-record `various/baselines/main.json` only on the working branch after a merge that changes them on purpose, and keep the previous file.
- **Documentation:**
  - every piece of work gets a docmgr ticket, a design doc first, a diary at every significant step (more often than commits), and docmgr tasks and changelog;
  - at a finished milestone, a textbook-style project report in the vault (`Projects/YYYY/MM/DD/PROJECT REPORT - … - A Technical Deep Dive.md`, no analogies). The coordinator reviews it against the evidence, then commits and pushes only that file in the vault;
  - keep the experiment playbooks updated as techniques change.
- **Scripts** (probes, analyses, launchers, scorers) go numbered in the ticket's `scripts/` and are committed. Agents are told the same.
- **Never search the whole disk** (`find /`, `~`). Search the repository, the ticket, the vault or a known directory.
- **Never run code from downloaded archives** (`ttmp/**/sources/`), and never flash the PicoCalc board.
- **Privacy:** never send the user's email or private details to external services. The public repository gets a secrets-and-private-strings scan before each push (section 5.8). One earlier commit, `9a37cc0`, contains the address; the user decided to leave it, so do not rewrite history for it.
- **Processes:** kill only exact PIDs after checking. No broad `pkill`.
- **Heavy jobs** run one at a time; GPU jobs one at a time, with one GPU-holding agent at most.
- **Agents:** no `--dangerously-skip-permissions`, and do not route around a permission denial. Set a Claude subagent's effort only when the user names one.
- **Vault:** stage only the intended files. Never stage `Research/2026/11/26/.mpl/` or `check.png`.

## 8. What comes next

1. **Done in phase 4b (IRWB-059): 4.6, 4.2 and 4.8.** The descriptions below are kept for reference; the next round is 4.3 and 4.7 (item 2), plus the follow-ups in IRWB-059's diary steps 3 and 4.
   - **4.6 term rules:** Typed simplify, fold and identities, and Tix inline and split-sum, as rules over a term signature. Cheap cells. Decision point: if the rule path is materially slower than the compiled visitor, share only the matcher and the verifier.
   - **4.2 lowering on the runner:** `lowerToImage` and the CUDA lowering as `Transformation`s from one IR to another, with `rv32.image-agrees` and `tensor.cuda-meaning` as their `ensures` obligations. Check: the composed correspondence equals today's, and images are unchanged. Use a strong cell.
   - **4.8 staged choice:** a launch-time variant with its guard, so the differential's arms are derived. It builds on 4.4.
2. **Done in phase 4c (IRWB-064):** 4.3 and 4.7, and F42 (lowering follow-ups).
3. **The PR (opened):** when phase 4 is closed, with every item merged or withdrawn at its decision point: `gh pr create --base main --head irwb-001/import-v6-prototype`. The body summarizes phases 0–4 and links this ticket's design doc and diary.
4. **After v7, the research stages in `BACKLOG.md`:**
   - tensor: T4 tolerance calibration, T10 split-K, T11 FMA contraction, T7 autotuning, T5 streaming attention, T12 tensor cores;
   - Typed: B2 (specializing Candela) and A1 (an e-graph over value trees).

   The research priority after v7 is derivations plus lowering as checked transformations, so that a whole compilation is a chain of justified steps. Then the backend split into checked steps on a machine IR: selection, allocation, coalescing.

## 9. Follow-ups found during v7, not yet scheduled

From derivations (4.1):
- Tix `inline`'s correspondence still says `removed` for a merged statement; the merge is only in the derivation (`mergedInto`). GLM's cell (branch `v7-derivations-g-h/irwb-056-a`, `src/tensor/passes.ts`) records it truthfully as `merged`; port that.
- The coverage vocabulary exists twice: `DerivationCoverage` in `src/framework/ir/derivation.ts` mirrors `CorrespondenceCoverage` in the analysis manager. The framework should own one coverage check.
- `revisionCorrespondence` (Typed) is now a test-only reference; delete it once 4.3 lands.
- Only Typed's `Tx` passes and Tix `inline` record derivations. Typed `inline`, `dfe`, `rotate`, `pe` and `specialize` record decisions but no rules.
- A0's in-place policy gives 393, not 395. Two `fold-add` records fold a constant tree that the same application made. The test documents the cause; 4.3 should settle which reading is meant.

From the earlier lanes:

- `planPass` (`src/tensor/schedule.ts`) is domain-local. It belongs in the framework as `decision({ eligible, prepare, conforms })`.
- `runTixCuda` should pass the kernel manifest, so that `emittedKernels`' source-hash side table can go.
- A no-op `prepare` returns `unchanged` before `conforms` runs, so nothing reports that a plan was not applied.
- The fusion layout derived in `prepare` is checked only by the GPU differential.
- `stdlib/affine/directions.ts` has one client; the admission rule wants two.
- The schedule's correspondence is coarser since 4.4: loops and variants are recorded as inserted.
- `applyPass` and `applyNativePassSync` survive as 1–2 statement wrappers for tests and tools. They have no callers in `src/` outside the framework now.
- The manager's `execute` (contracts with a `run` body) is still asynchronous only, and an abandoned plan leaves its records `running`.
- The synchronous driver is refused while Typed's worker pool is installed.

## 10. Records owed

- A vault project report for v7 (phases 0–4), written once 4.1 is merged or at the PR. It should be textbook style and reviewed against the diary.
- The scorecard artifact from the IRWB-019 experiment (`LohZckE2CXVn7PGZV41dhW`) and its report 11 still lack the T6, Typed and R3 results.
- The R3 synthesis page could link each concept to the v7 commit that realized it.
- A private backup of the raw agent transcripts in `various/kit/*/sessions/` was offered and not yet decided. Those directories are git-ignored.
