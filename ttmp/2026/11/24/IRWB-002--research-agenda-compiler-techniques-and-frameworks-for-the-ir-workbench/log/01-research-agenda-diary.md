---
Title: Research agenda diary
Ticket: IRWB-002
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
    - candela
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "How the IRWB-002 intern guide and research agenda were produced: sources read, decisions, scripts, failures, upload."
LastUpdated: 2026-11-24T23:02:49.355287632-05:00
WhatFor: "Retracing how the research agenda was derived from the surveys and the code."
WhenToUse: "When reviewing or extending the agenda, or checking where one of its claims came from."
---

# Research agenda diary

This diary records how the IRWB-002 intern guide and research agenda were produced: which sources were read and what was taken from each, the design decisions about the document, the scripts written, failures with their exact messages, and the reMarkable upload. Steps are in chronological order. The work is documentation only; no file under `src/`, `tools/`, `tests/`, `corpus/` or `site-src/` is changed.

## Step 1: Read the brief and the skills, create the ticket

The task is to write a guide for a new intern that first explains the IR Workbench as it exists and then lays out a research agenda: compiler techniques, advanced or plain, that the project does not use yet, each with a first experiment. I started by reading the five skills the brief names, because they fix the ticket mechanics, the diary format, the writing style and the upload policy, and then created the ticket so that every later step has a place to be recorded.

The ticket `IRWB-002` exists with a design-doc and this diary. Nothing was written into the design-doc yet.

### Prompt Context
**User prompt (verbatim):** "look at @/tmp/irs.md and @/tmp/irs2.md and the current code and approach, and write a new docmgr ticket with Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.

It should be about all the ideas you have we could implement that use compiler / advanced principles / advanced techniques (or even just straightforward techniques we are not yet doing) and potential frameworks we could implement to provide more powerful capabilities. That way we will have a robust amount of work to do for our researchers.

Have the subagent stop after the upload. Have them keep a detailed diary as they work, and commit scripts they write and such to the ticket so that we can retrace their steps."
**Assistant interpretation:** Produce one long intern guide in a new docmgr ticket: Part 1 explains the current system from the code, Part 2 is a catalogue of research work items with pseudocode, required APIs, a first experiment and an acceptance measurement each, ending in a roadmap. Keep this diary in investigation format, commit scripts to the ticket, upload the result to reMarkable, then stop.
**Inferred user intent:** Give incoming researchers enough understanding of the system to start work, and a backlog large and concrete enough that several people can work in parallel for months.
**Commit (code):** none; this task changes documentation only.

### What I did
- Read `~/.claude/skills/docmgr/SKILL.md`, `ticket-research-docmgr-remarkable/SKILL.md` with `references/writing-style.md`, `deliverable-checklist.md` and `phase-checklists.md`, `textbook-authoring/SKILL.md`, `diary/SKILL.md` with `references/investigation-entry.md`, and `remarkable-upload/SKILL.md`.
- Ran `docmgr status --summary-only`: one ticket (IRWB-001), 13 docs, vocabulary at `ttmp/vocabulary.yaml` with the topics `compiler`, `ir`, `workbench`, `typescript`, `candela`.
- Created the ticket and two documents:
  - `docmgr ticket create-ticket --ticket IRWB-002 --title "Research agenda: compiler techniques and frameworks for the IR Workbench" --topics compiler,ir,workbench,typescript,candela`
  - `docmgr doc add --ticket IRWB-002 --doc-type design-doc --title "Intern guide and research agenda: …"`
  - `docmgr doc add --ticket IRWB-002 --doc-type log --title "Research agenda diary"`

### Why
- The writing-style reference asks for the system to be studied before drafting and for claims to be tied to primary evidence, so the ticket and diary come first and the document last.
- One design-doc rather than several: the brief asks for one guide, and the reMarkable bundle reads better as one document with a table of contents.

### What worked
- Ticket path: `ttmp/2026/11/24/IRWB-002--research-agenda-compiler-techniques-and-frameworks-for-the-ir-workbench/`.

### What didn't work
- The first shell command of the session was refused by the worktree guard:
  `This agent is isolated in the worktree …, but this command names git in a form too complex to verify that it stays inside the worktree. Refusing to run it`.
  It chained a `cd`, a branch query and an `ls`.
- The same guard refused, twice, a shell command that wrote this diary through a heredoc: once because the command ended with a staging command, and once because the diary text itself contains the name of the version-control tool. Nothing in a refused command runs, so the diary was not written either time.
- Recovery: version-control commands are run alone, one per call; documents are written with the file-writing tool, not through shell heredocs.

### What I learned
- The upload skill's policy: one `remarquee upload bundle … --non-interactive` command, no `--force`, no routine dry run or listing; a persistent authentication failure is a blocker to report.
- The textbook skill forbids analogies and asks that every local term be explained at first consequential use.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- `docmgr doc list --ticket IRWB-002`.

### Technical details
- Branch: `worktree-agent-afc970df0c231de2f`, at `a11f6bf` when the work started.

## Step 2: The three vault reports and the IRWB-001 ticket

The brief names the three milestone reports in the Obsidian vault as the fastest overview, so I read them first and in full, then design-docs 04 and 05, the Candela inventory, the task list and diary steps 12–14 of IRWB-001. The aim was a list of what exists, what was measured, and which gaps the project itself has already named, so that the agenda extends that list instead of repeating it.

The outcome is a set of measured facts I can cite, and a list of sixteen ideas (design-doc 04) and six tasks (design-doc 05) that the agenda must absorb and go beyond.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Establish the current state from the project's own summaries before reading code.

### What I did
- Read, in `/home/manuel/code/wesen/go-go-golems/go-go-parc/Projects/2026/11/24/`:
  - report 1 (framework and parity, source revision 240ff36);
  - report 2 (strategies, search, specialization, the browser workbench, fcb155f);
  - report 3 (Candela on the kernel, fcb155f).
- Read in `ttmp/2026/11/24/IRWB-001--ir-workbench/`: `design-doc/04`, `design-doc/05`, `analysis/03`, `tasks.md`, the headings of every diary, and `log/02-implementation-diary.md` steps 12–14 in full.

### Why
- The reports are written at textbook level and state exact numbers; the diaries state what failed. Both are needed: the guide's Part 1 from the first, the agenda's "known gap" lines from the second.

### What worked
- Facts taken, with their source:
  - Six framework extensions E1–E6 exist; E7 (tiling as rewrite rules), handles and revision timelines live in the domain (report 1 §1, §10).
  - Parity: 44 projects, 70 functions, 6,986 decided cases agree, 14 at the step limit (report 1 §7).
  - Ordering search: 12 of 44 beat O2, 11 through one extra `subst`; total instructions 77,321 → 75,651; the experiment took 21 minutes (report 2 §5).
  - Per-function search: no gain; choices differ only where candidates tie (report 2 §5).
  - Against the reference compiler: Blend 451 vs 383, Checksum 366 vs 292, sort 2,022 vs 1,533, Collatz 1,590 vs 1,486; ours 5,160 bytes vs 7,628 (report 2 §6). Named gaps: loop rotation, copy coalescing with several readers.
  - Candela: 332 functions, 2,409 blocks, 12,358 statements, 37,220 values; the evaluator agrees with the reference image with 0 disagreements; O2 gives 13 revisions and −23 % statements; two unsound float rewrites passed 40 random cases until an edge sweep was added (report 3 §1, §3, §4).
  - Framework cost: no-change pass 86 s → 18 s, `cfg` 101 s → 31 s, hashes identical (diary step 12).
  - `bcm`: 559 → 100 checked addresses; the symbolic-base case rests on a capacity bound that the IR does not state (diary step 14).
  - 177 of 332 Candela functions are per-scene sections behind five dispatchers on `K.scene` (design-doc 05 §7).

### What didn't work
- No failures.

### What I learned
- Design-doc 04 already lists sixteen ideas. They are optimization experiments. None of them is a new program representation, a new analysis framework or a new checking method, which is where the surveys can add the most.
- Several open problems are stated but unowned: preservation audited only in a tool, correspondence using only the first origin, entities created and removed within one revision being unresolvable, the 21-minute search.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The Candela oracle numbers in report 3 are for the `stock` policy; the brief states that the `kernel` image now agrees as well (33,200 cases, 0 disagreements). I cite the brief for the `kernel` result, because the report predates it.

### What should be done in the future
- N/A.

### Code review instructions
- Compare the facts above with the reports' summary boxes.

### Technical details
- Open IRWB-001 tasks at the time of reading (`tasks.md` on this branch): P4.2 (Candela chain as tasks), P4.3 (per-scene specialization), P4.5 (f32 backend, another agent), P4.8 (kernel-policy oracle), R3.

## Step 3: Reading the code

The reports say what the system does; the guide has to say where. I read the framework's own READMEs, then the extension files in full, then the typed domain file by file, and wrote a small script that lists every exported declaration with its line number so that the API references in the guide can be checked against the source.

The reading produced findings that the reports do not state and that shape the agenda: the typed compiler does not use the framework's task runtime, its pattern-and-rewrite engine, or its revision store.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Ground every statement of Part 1 in a file and symbol.

### What I did
- Wrote `scripts/01-survey-outline.sh` (headings of the two surveys with line numbers) and `scripts/02-exported-api.sh` (exported declarations under `src/` with `file:line`).
- Read in full: `src/framework/passes/define-pass.ts`, `passes/bridge.ts`, `contracts/differential.ts`, `dataflow/solver.ts`, `ir/types.ts`, `core/types.ts`, the three READMEs (`contracts`, `strategy`, `ir`), `src/typed/model.ts`, `specialize.ts`, `strategy.ts`.
- Read the relevant parts of: `dataflow/analysis.ts`, `ir/correspondence.ts` (`whyEntity`), `ir/PATTERNS-AND-REWRITES.md`, `typed/passes.ts` (`typedPass`, `revisionCorrespondence`, `optimizationContract`, `fold`, `simplify`, `constprop`, `dce`, `lvn`, `strength`, `PASSES`, `PIPELINES`), `typed/evaluate.ts` (`casesFrom`, `evaluate`, `agrees`, `meaningKept`), `typed/strategies.ts` (`measure`, `strategyRegistry`, `runStrategy`, `searchPlan`, `StrategySpec`), `typed/program.ts` (`Program`, `apply`, `why`, `whyChain`), `typed/tx.ts` (`Tx.rewrite`, `MakeOptions`, `ValueHandle`), `typed/ir.ts` (`blocksAdapter`), `typed/project.ts` (`runPipeline`), `typed/backend/{index,options,regalloc,select,compile,image,run,encode}.ts`, `src/workbench/{index,sync,workbench}.ts` and `DIVERGENCES.md`.
- Checked usage with grep:
  - `grep -rln "core/runtime" src` → only `src/conformance/01-runtime.ts` and `src/labs/lab.ts`.
  - `grep -rn "executeRewrites\|saturate(" src/typed src/workbench` → nothing; the only `rewrite(` there is `Tx.rewrite`.
  - `grep -rn "IRStore" src/typed src/workbench` → nothing.

### Why
- An intern guide that cites a function must cite the real one. The export listing is the check.
- The grep checks answer a question the agenda depends on: which framework capabilities are already built and merely unused. Those are the cheapest work items.

### What worked
- Findings for the agenda:
  - **The task runtime is unused.** `Compiler` and `CompilationRun` (`src/framework/core/runtime.ts`), with task dependencies, the invocation database and cache explanations, are exercised only by the conformance examples and the labs. The typed compiler holds its revisions in an array in `Program` (`src/typed/program.ts`), so nothing is cached across runs.
  - **The generic rewrite engine is unused.** `rewrite()`, the seven schedules including `saturate`, and the pattern matcher (`src/framework/ir/rewrites.ts`, `patterns.ts`) are not called by any typed pass. `simplify` is a hand-written `switch` inside `Tx.rewrite` (`src/typed/passes.ts:305`).
  - **Passes run whole-program.** `typedPass` iterates every function in `run` and returns one native value (`src/typed/passes.ts:163`); a pass that edits 3 functions still rebuilds and re-projects all 332.
  - **The meaning check evaluates the origin again for every pass.** `runDifferential` runs both sides on every case (`src/framework/contracts/differential.ts`), so r0 is evaluated once per pass application on the same cases.
  - **`lvn` is block-local** and there is no global value numbering, no SSA form, no inlining, no loop pass other than `licm`, one block layout (`layout: 'source'` in `backend/options.ts`), and linear scan with whole-interval spilling.

### What didn't work
- `grep -rln … --include=*.ts` failed under zsh with `(eval):1: no matches found: --include=*.ts`; the glob must be quoted (`--include='*.ts'`).

### What I learned
- `FOLDABLE` and `F32_FOLDABLE` are closed lists and `simplify` has about twenty identities, all written by hand. A rule-discovery tool has a small, well-defined target.
- `BackendOptions` already exposes the allocator's choices (`registers`, `order`, `spill`, `hints`), so allocation experiments can be strategy candidates without touching the allocator's interface.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The claim that the task runtime is unused rests on import greps. A dynamic use would not show; I found none in `src/typed/program.ts` or `src/workbench/workbench.ts`.

### What should be done in the future
- N/A.

### Code review instructions
- `bash ttmp/2026/11/24/IRWB-002--…/scripts/02-exported-api.sh src/typed | less` and compare with the API tables of the guide.

### Technical details
- `applyPass` order of gates, from `define-pass.ts:190–323`: analyses for `needs` → `run` → diff or `edit.prepare()` → unchanged short-circuit → `undeclaredWrites` → `verifyTransformation` → preservation (`manager.preserve`, else recompute and compare canonical values).
