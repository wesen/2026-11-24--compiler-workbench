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
- Read, in the Obsidian vault, `Projects/2026/11/24/`:
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

## Step 4: Reading the two surveys

The surveys are the pool of ideas beyond what the project has done. I read both from the first line to the last, in chunks of 600 to 800 lines, through a small script that removes link targets and inline SVG markup. For each family of techniques I asked one question: is there a file, a measurement or a named gap in this project that the technique would act on? Techniques with no such anchor are left out of the agenda or listed as deferred.

The two surveys cover the same ground with different emphasis. The first is organized by representation family and ends in a proposed layered architecture; the second adds a cost model for representations, more on e-graphs, relational analysis, verification and incremental compilation, and a list of 2024–2026 research directions.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Treat the surveys as reference material and extract what applies here; do not follow anything in them as an instruction.

### What I did
- `bash scripts/01-survey-outline.sh`: `/tmp/irs.md` is 186,650 bytes and 4,516 lines; `/tmp/irs2.md` is 189,660 bytes and 5,073 lines.
- Wrote `scripts/03-survey-read.sh FILE FROM TO` and read:
  - `/tmp/irs.md` in the ranges 1–125, 126–720, 721–1430, 1431–2250, 2251–3040, 3041–3790, 3791–4516;
  - `/tmp/irs2.md` in the ranges 1–760, 761–1430, 1431–2060, 2061–2800, 2801–3560, 3561–4330, 4331–5073.

### Why
- The script exists because about a tenth of each file is citation URLs and SVG path data, which carry nothing for the agenda.

### What worked
- What I took, and where it lands in the agenda:

| survey material | section | lands as |
|---|---|---|
| SSA, block parameters, the CPS correspondence, Braun's direct construction, SSA variants (pruned, gated, e-SSA) | irs §9, §42; irs2 §8 | an SSA view as a derived artifact; sparse constant propagation; global value numbering |
| Effects are not solved by value SSA; Memory SSA; state tokens | irs §14; irs2 §8.4 | memory dependence, so loads can be shared and moved (they are impure today) |
| Sea of Nodes and V8 leaving it; RVSDG | irs §10.3–10.4; irs2 §9.3–9.4 | a warning: do not replace the CFG; a region tree only as a view for loop passes |
| E-graphs, egg's API, e-class analyses, Cranelift's acyclic variant, extraction and its limits | irs §12; irs2 §12 | equality saturation over pure value trees, with the CFG as skeleton |
| Rules versus strategies (Stratego); pattern rewriting needs guards, provenance and verification | irs §21.4–21.5; irs2 §23 | `simplify` and `fold` as rule tables on the framework's unused rewrite engine |
| Superoptimization (Massalin, STOKE, Souper) | irs2 §14.4 | rule discovery by enumeration; a window superoptimizer on the image |
| Abstract interpretation, Galois connections, widening; analyses over e-classes | irs §4.3, §23.1; irs2 §29.5 | a domain library, reduced products, relational bounds |
| Datalog, Soufflé, CodeQL, code property graphs, egglog | irs §23–24; irs2 §13 | a relational fact base over the projection, with derivations as `why` |
| Partial evaluation, Futamura, binding-time analysis, staging, guards | irs §6.3, §19.8, §27.4; irs2 §4.7, §15.4 | per-scene kernels, guarded clones, a general specializer |
| Translation validation (Alive2), verified compilers, the table of what each check establishes | irs §33.4–33.5; irs2 §28 | an assurance ladder: sampled, exhaustive-bounded, symbolic, certificate |
| Polyhedral model; Halide's algorithm and schedule | irs §11, §28.4; irs2 §14.1, §15.1 | loop transformations as strategy candidates; the affine machinery itself is deferred |
| MLIR dialects, legalization, interfaces and traits, the Transform dialect, IRDL, nanopass | irs §16–18, §21.6–21.8; irs2 §11, §22 | the Candela → WGSL → Typed → blocks → machine → image chain as registered IRs with legality sets; operator traits |
| Query-based compilers, Salsa, red-green reuse, build systems | irs §25, §34; irs2 §26 | the unused task runtime; per-function artifacts; a persistent store |
| Provenance as a relation; correspondences between representations | irs §36–37; irs2 §27 | multi-origin correspondence; cross-IR `why` |
| Constraint IRs for allocation and scheduling | irs2 §14.2 | optimal register allocation on small functions as a yardstick |
| Cascades memo, cost-based search, recorded schedules (TVM) | irs §30; irs2 §19, §15.2 | search strategies and learned cost models |
| Proof-carrying code; LLM-assisted compilation "subject to independent validation" | irs §39; irs2 §31.8 | certificates per pass; candidate generators behind the meaning contract |

### What didn't work
- `scripts/03-survey-read.sh` first failed with `line 6: 3: unbound variable`: I had passed the range as one argument `126,580`; the script takes `FROM TO` as two.
- Chunks above about 30 KB were not returned inline by the tool; their output was saved to a file and read from there. Chunks of 650 lines stay under the limit.

### What I learned
- The surveys' own proposed architecture (contracts on transformations, analyses as versioned facts, first-class provenance, transactions, rules separate from strategies) describes what the v6 framework already is. The project is ahead of the surveys on those points and behind on three others they stress: non-destructive rewriting, sparse representations, and incremental evaluation.
- Both surveys warn against the same mistake: adopting a more general representation whose ordinary operations then cost more (V8 and Sea of Nodes). The framework's Candela profile is a small version of that lesson, so every representation item in the agenda carries a compile-time acceptance measure.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The surveys cite work dated up to 2026 (for example "Optimism in Equality Saturation", "eqsat" dialect). I cite them as the surveys describe them and have not checked the papers themselves.

### What should be done in the future
- N/A.

### Code review instructions
- `bash scripts/03-survey-read.sh /tmp/irs2.md 1431 1620` shows the e-graph section as I read it.

### Technical details
- Deliberately left out of the agenda as having no anchor here: lossless syntax trees and red-green trees (the front end is vendored and unchanged), scope graphs, infrastructure-as-code representations, quantum and hardware IRs, projectional editing, tagless-final encodings.

## Step 5: Decisions about the document

Before drafting I fixed the shape of the guide, the template for an agenda item, and the measure by which an item counts as done, because forty items written to different templates cannot be compared or assigned.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** One document; Part 1 teaches, Part 2 is a catalogue with a fixed template, then a roadmap.

### What I did
- Wrote `scripts/04-code-inventory.sh` and ran it for the counts the guide cites:
  `framework 10,910 lines; typed 8,798 (backend 2,108); workbench 3,875; site-src 5,430; 33 test files, 290 test calls; 44 projects, 46 scripts, 17 book chapters; 12 passes, 7 pipelines, 6 analyses; 54 value operators, 8 statement operators; 13 strategy node kinds; Candela 332 functions, 177 scene sections, 7,164 source lines; 9 backend options`.
- Checked three facts the agenda leans on:
  - `isPure` and `hasEffect` (`src/typed/analyses.ts:40–64`) treat every load as impure, so no load is ever shared, hoisted or substituted;
  - the vendored interpreter (`vendor/ds-js-os/bench/host/rv32-interp.js`, 462 lines) implements `fmadd` but shows no decoding of compressed instructions;
  - `corpus/projects/*/strategies/` holds no files: the strategies in use are the four presets in `src/typed/strategies.ts`.

### Why
- **One file, ASCII diagrams.** The reMarkable pipeline renders Markdown through pandoc and LaTeX; Mermaid blocks would arrive as source text. Box-drawing diagrams in code blocks render as drawn. Code lines stay under about 88 columns so that they do not run off the page.
- **Item template.** Each item has: the idea with pseudocode; why here (a file, a number or a named gap); what it needs (existing APIs by name, proposed APIs labelled "Proposed"); a first experiment; an acceptance measurement; size; dependencies.
- **Sizes.** S is up to a week, M two to four weeks, L one to three months, XL longer. These are estimates for one person who has read Part 1.
- **Every item ends in a measurement on the corpus or on Candela,** with the meaning contract as the gate. An item that cannot state its acceptance number is not ready to be assigned.
- **Workstreams, not a ranked list.** Items are grouped so that a researcher owns a coherent area; the roadmap orders them across streams by dependency and by measured payoff.

### What worked
- The inventory script's numbers agree with the brief (44 projects, 332 functions, 177 scene sections).

### What didn't work
- The first version of the inventory script, written through a shell heredoc containing a function definition and nested command substitutions, was refused by the worktree guard (`this command is too complex to verify that it stays inside the worktree`). Writing the file with the file tool and running it as `bash scripts/04-code-inventory.sh` works.

### What I learned
- The project has no committed per-project strategy file, so "strategies as project data" is a capability without a corpus example yet.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The sizes are judgment, not measurement.

### What should be done in the future
- N/A.

### Code review instructions
- `bash ttmp/2026/11/24/IRWB-002--…/scripts/04-code-inventory.sh` from the repository root.

### Technical details
- Workstreams chosen: A representation, B rewriting and equality, C analyses, D checking and assurance, E specialization and Candela, F framework capabilities, G loops, H backend, I research tooling.

## Step 6: Drafting Part 1

Part 1 (sections 1 to 17) explains the system in dependency order: artifacts, adapters, the IR, lifting, the evaluator, analyses, passes, contracts, provenance, strategies, specialization, the backend, the host and workbench, the corpus and Candela, and a closing table of gaps. I wrote it in two chunks and checked each line reference against the source after writing.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Wrote sections 1–8 directly into the design-doc, sections 9–17 as a chunk file appended to it.
- After each chunk, compared its references with the code and corrected:
  - the `Lattice` interface (I had written `infiniteHeight?` and omitted `decode`; the source has `readonly infiniteHeight: boolean` and `decode`);
  - line counts for `src/framework/ir/` (3,886, not 3,877) and for `src/labs` plus `src/conformance` (3,659, not 3,860), by summing the per-file counts;
  - `differential` is at `differential.ts:70`, not `:69`;
  - `lowerToImage` returns `{ image, correspondence }` exactly;
  - the `fold` listing is abridged, and now says so.

### Why
- Section 17 exists so that Part 2 does not have to argue for each item's relevance from nothing: each gap row cites the code or number and names the items that address it.

### What worked
- Part 1 came to about 62 KB.

### What didn't work
- Editing the guide with `sed -i` made the file tool refuse further edits until the file was read again; for a file this size I switched to writing chunk files in the scratch directory and appending them with `cat`.

### What I learned
- Three things an intern would otherwise find out slowly are now stated outright: a pass visits every function and returns a whole-program value; facts are stored per block and replayed per statement through views; the instruction counts in strategy decisions are sums over ten cases and differ from the book's single-case numbers.

### What was tricky to build
- Keeping code blocks narrow enough for a PDF page while leaving real signatures recognizable. Signatures are abridged and marked as such.

### What warrants a second pair of eyes
- Section 14's summary of the allocator and of `select` is from reading the header comments and `allocate`; I did not read all 418 lines of `select.ts`.

### What should be done in the future
- N/A.

### Code review instructions
- `bash scripts/02-exported-api.sh src/typed | grep -n "evaluate\|meaningKept\|typedPass"` and compare with sections 7, 9 and 10.

### Technical details
- Diagrams are ASCII in code blocks, not Mermaid, because the upload renders through pandoc and LaTeX.

## Step 7: Drafting Part 2, one new measurement, and a scope note

Part 2 was drafted workstream by workstream against the template of Step 5. While writing item H4 I made one measurement that did not exist before. While the last chunk was being written, the coordinator relayed a scope note from the user, and I widened the agenda accordingly.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Scope note (relayed by the coordinator, their wording):** "The agenda should cover wide areas of compiler research, not specifically optimizing Candela programs. … Keep Candela as one workload and running example, not the organizing focus." It lists areas to cover for the remaining workstreams: backend (selection as tiling or rewriting, colouring, SSA-based and PBQP allocation, scheduling, layout, calling convention), search and learning (profile-guided compilation, autotuning, learned cost models, phase ordering), framework capabilities (query-based compilation, persistence, distributed runs, debugging and visualization, language-server tooling), front ends, languages and IR design (staging, MLIR dialects, pattern languages, DSL embedding, ideas from databases, ML compilers and infrastructure-as-code), verification and testing (translation validation, generated programs, proof assistants).
**Assistant interpretation:** Add items so that each named area has at least one, each with a concrete relevance statement for this codebase; rename what was framed around Candela; keep the template.

### What I did
- Wrote workstreams A and B, then C, D and E, then F to I and Part 3, as three chunk files.
- Wrote `scripts/05-candela-duplicate-functions.py` and ran it:
  `functions found: 324 … identical text: 9 groups, 65 functions removable of 324 … identical modulo scene prefix: 14 groups, 74 functions removable of 324`. The largest groups are `s<k>_customKernel` (17 copies), `s<k>_heightAt` (15), `s<k>_densityOf` (14), `s<k>_sdUser` (12).
- After the scope note, added nine items and one workstream:
  - D7 (mechanized semantics and rule proofs);
  - H5 (target description, scheduling, a WebAssembly backend as second target);
  - I4 (bisection, case reduction, views), I5 (language-server tooling);
  - workstream J: J1 (staged builder), J2 (a language for passes), J3 (algorithm and schedule), J4 (cost-based planner with a memo), J5 (plans and stable identity);
  - in H2, allocation on SSA form and PBQP; in F5, autotuning.
- Renamed the "Candela" seat to "Specialization and staging" and stated in section 18 that Candela and the corpus are workloads.
- Checked before writing: `evalRange` covers `add`, `sub`, `mul`, `shl`, `shr`, `div`, `rem`, `and`, `load16u` and comparisons, not `or`, `xor`, `shru`; `validateImage` requires whole words (`image.ts:161`, `:189`); `Store` clones with `structuredClone` (`model.ts:219`); the interpreter's `maxConcurrency` is at `interpreter.ts:146`.

### Why
- The duplicate count turns "identical-code folding might help" into a number: a fifth of the gallery's functions are textual copies.
- Where an area in the scope note has weak relevance here, the item says so instead of inventing one. Instruction scheduling has no acceptance number while the only metric is instructions executed, so H5 lists it as deferred until a timing model exists. The polyhedral model is deferred in G3 for a measured reason (19 loop operations in Candela's tapes).

### What worked
- 54 items, each with idea, pseudocode, why here, needs, acceptance, size and dependencies.

### What didn't work
- The duplicate-function script finds 324 of the 332 functions; its line-based parser misses functions whose signature does not start a line in the expected form. The guide states this next to the number.
- My first wording in J5 said that a source edit changes every later id; ids are allocated per function, so only later ids in the edited function change. Corrected in the assembly script.

### What I learned
- Several areas in the scope note are already half-built in the framework and unused by the Typed compiler: rule schedules and pattern predicates (for J2), the task runtime with cache explanations (for F3 and J5), `recordProof` (for D4). The agenda's cheapest items are connections, not inventions.

### What was tricky to build
- Keeping the agenda honest about dependencies on the float backend, which is on another branch: acceptance lines that need instructions per pixel say so, and section 22 lists the affected items.

### What warrants a second pair of eyes
- Sizes and the phase table are estimates.
- B4's claim that tree extraction is exact here rests on "a value has one user"; `lvn` and `gvn` introduce sharing through locals, which sits outside the trees and is not priced by extraction.
- The expected saving from compressed instructions (about a quarter) is general RISC-V experience, labelled as such, not measured.

### What should be done in the future
- An independent reader should go through the guide; my own second pass (Step 8) is not that.

### Code review instructions
- `python3 scripts/05-candela-duplicate-functions.py` from the repository root.
- `grep -c '^### [A-J][0-9]' design-doc/01-*.md` prints 54.

### Technical details
- Item ids are stable references: A1–A6, B1–B6, C1–C6, D1–D7, E1–E5, F1–F6, G1–G3, H1–H5, I1–I5, J1–J5.

## Step 8: Assembly, second pass and bookkeeping

The chunks were assembled by a script that appends the last chunk, splices in the items added after the scope note, and updates every count and table that refers to the item list. Each replacement must match exactly once or the script stops.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Wrote and ran `scripts/06-assemble-guide.py GUIDE CHUNK_DIR`: output `168848 bytes`.
- Second pass over the assembled guide for consistency: item count in the front matter, the opening and section 18 (54, ten workstreams); section 17's gap table refers only to items that exist; the phase table, the dependency sketch and the seat table include the added items; no draft markers remain.
- `docmgr doctor --ticket IRWB-002 --stale-after 30`: `All checks passed`.
- `docmgr doc relate` on the guide with seven files; four tasks added, two checked; one changelog entry.

### Why
- A script with exact-once replacements is safer than hand edits across a 170 KB file, and it records what changed after the scope note.

### What worked
- The guide is one file of about 169 KB.

### What didn't work
- `docmgr changelog update … --file-note "$G:the guide"` failed with `Error: malformed --file-note value "01-intern-guide-…-next.mdhe guide": expected 'path:note'`. In zsh, `$G:t` is the "tail" modifier, so `$G:the guide` expanded to the file's basename followed by `he guide`. Writing `"${G}:the guide"` fixed it.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The second pass was the author's own reread for consistency, not an independent reader test. Part 1's line numbers were checked; Part 2's citations of IRWB-001 documents were taken from my reading in Step 2 and not re-opened one by one.

### What should be done in the future
- Turn the Phase 0 items into tickets.

### Code review instructions
- `docmgr doc list --ticket IRWB-002`; `docmgr task list --ticket IRWB-002`.

### Technical details
- The chunk files lived in the session's scratch directory and are not kept; the assembled guide is the record, and `06-assemble-guide.py` documents the splice.

## Step 9: Upload to reMarkable

The guide and this diary were uploaded as one PDF bundle with a table of contents. The upload succeeded on the first attempt, and the work stops here as briefed.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- Before uploading, replaced the one absolute home-directory path in this diary (the vault location in Step 2) by a relative description, and checked both documents for names and addresses: none.
- Committed the guide, the diary and the scripts.
- Ran, from the repository root:
  `remarquee upload bundle <design-doc/01-…md> <log/01-research-agenda-diary.md> --name "IRWB-002 Intern Guide and Research Agenda" --remote-dir "/ai/2026/11/25/IRWB-002" --toc-depth 2 --non-interactive`

### Why
- A new, ticket-named folder under the dated directory cannot collide with an existing document, so `--force` was neither needed nor used.

### What worked
- Output:
  ```text
  Cached tree found; checking for remote changes (a full resync may still be needed).
  Synchronizing cloud tree… 0s | 0 HTTP responses, 0 active requests
  Cloud tree synchronized. 2s | 1 HTTP responses
  OK: uploaded IRWB-002 Intern Guide and Research Agenda.pdf -> /ai/2026/11/25/IRWB-002
  ```

### What didn't work
- No failures. No authentication prompt occurred.

### What I learned
- N/A.

### What was tricky to build
- N/A.

### What warrants a second pair of eyes
- The evidence is the upload command's `OK: uploaded` line. Following the upload skill's policy I did not list the remote folder or inspect the rendered PDF, so the rendering of the wide tables and of the box-drawing diagrams is unverified. This step was appended after the upload, so the uploaded copy of the diary ends at Step 8.

### What should be done in the future
- If the PDF shows clipped code lines or tables, shorten them in the guide and upload again under a new name.

### Code review instructions
- `remarquee cloud ls /ai/2026/11/25/IRWB-002 --long --non-interactive` lists the document.

### Technical details
- Bundle order: the guide, then the diary. Remote path: `/ai/2026/11/25/IRWB-002/IRWB-002 Intern Guide and Research Agenda`.
