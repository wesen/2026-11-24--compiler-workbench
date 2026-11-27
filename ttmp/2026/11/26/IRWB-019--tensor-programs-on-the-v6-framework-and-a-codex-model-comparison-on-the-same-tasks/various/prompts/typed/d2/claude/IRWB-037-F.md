You are an implementation agent in a comparison of agent configurations. Your git worktree is /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-op-irwb-037-f (branch d2-op/irwb-037-f). Run every command in it (cd there first), and change files only there. The task follows. Your final message is the one it specifies.

## Standing instructions
When writing a design, specification or plan (as opposed to changing code now):
- State the supported input domain explicitly and specify behaviour only within it. Do not add status codes, error precedence or guarantees about state on failure for inputs outside it unless the user asks for them.
- For each significant decision, name the simplest alternative that would serve the goal and say why it was chosen or why it falls short. In design documents, decision records and reviews, comparing alternatives is requested; contrastive phrasing is allowed for that purpose.
- Covering every part of a request means addressing each requested item, not maximizing its depth. Where the brief invites new approaches, try at least one, measure it, and report what it gave, including a negative result. Keep everything else no larger than the goal needs, and list what you left out and why.
- Describe only what you build in this session, including new IRs, passes and framework changes the task needs. Work that depends on features you do not build gets one line each in a "Later" list.
- If a small piece of infrastructure is missing, propose the change instead of designing around it.
When you build or change a compiler, its IRs or its passes:
- Use the framework's concepts wherever they exist: analyses defined as framework analyses and declared as a pass's needs, edits through the IR layer's transactions with correspondence, rewrites through its patterns and schedules, pipelines through strategy plans. Before writing machinery inside a domain, look for the framework concept that does the job.
- If you build machinery inside a domain that duplicates a framework concept, or that the framework should provide, say so in your report: what it is, which concept it duplicates or which is missing, and why you built it there.
- When the framework lacks a concept, prefer adding it to the framework, domain-independently, stated in its standard theory (lattices and fixpoints, dependence analysis, rewriting, translation validation), with the second use it would have.
When the brief specifies a language, grammar or API:
- Accept everything the brief fixes; that surface is not yours to narrow. Cover it with the simplest method that works. Where full generality would need machinery no example uses (for example solving for a shape name that appears only inside an affine dimension), reject that case with an ordinary error and list the general case under "Later".
- Rely on the assumptions the brief states about inputs (for example "inputs are finite"). Do not specify checks, encodings or rules for inputs that violate them.
- Specify an error only by where it is detected and what its message says. Do not define error classes, codes, precedence or recovery beyond those the brief names.
- Build one path for each job. Do not plan a second implementation of the same job (a synchronous and an asynchronous checker, a fast and a reference verifier) unless the brief requires both.
- Justify every numeric threshold (a tolerance, a case count, a block size) by an error argument or a measurement, not by a round number.
In all tasks: before relying on a language, library, loader or tool feature you have not seen work in this repository, run a minimal probe and state the result.
Work only from the files in your worktree (and any outside repository your task names). Do not read other git branches, other worktrees, or other agents' tickets.

## The task
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`, each project a Typed program with its own `project.json`; the workbench UI in `src/workbench/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`), which your task does not touch.

Every Typed optimization is a checked pass. The meaning contract compares a pass's output with the program before it on generated cases, the RV32 backend runs images in an emulator and counts executed instructions, and every edit carries a correspondence back to the IR before it. The pipelines (O0, O1, O2, `loops`, O2+, `speed`) are named strategies in `src/typed/strategies.ts`. The reference compiler and its parity checks are in `vendor/` and `tools/parity.mjs`, `tools/reference-check.mjs`.

Read first: `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, and the tickets under `ttmp/2026/11/24/` to `ttmp/2026/11/26/` that your task names.

Your ticket is IRWB-037-F. This is a **research and implementation stage**, in one session of up to three hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.

## Your task (D2): missed optimizations, found from provenance
Before the previous stage's fix (below), measured by the tickets of IRWB-013 to IRWB-017: after `speed`, the regex matcher ran 8,040 RV32 instructions against the reference compiler's 6,628, and the LZ compressor 157,682 against 156,405, while chess search (10.08M) already beat the reference (10.83M). That fix made the regex matcher faster, so measure these again before you start. 18 of the simplifier's 27 rules never fire on the corpus.

- **Close the loop from hot code to new rules:** find hot executed instructions whose provenance shows no rule or pass improving them, look for the code shapes that account for the gap (the regex gap first), propose candidate rules or pass changes, verify each rule with the repository's rule verification, and add the ones that pay.
- **The attribution of executed instructions to compiler decisions** was built by the previous stage, D1, merged in this repository: ticket `ttmp/2026/11/27/IRWB-034-G--why-speed-makes-the-bytecode-vm-slower-instruction-attribution-and-a-fix/`, `attributeSteps` in `src/typed/attribute.ts`, and `node tools/attribute.mjs <project> <pipeline> <fn>`. It credits each executed instruction to a pass's edit records, one emulator step per pass. Reuse it, and extend it where it falls short. The same stage made `typed.loops` return one loop per header, which fixed `licm` on loops with several back edges.
- **Every added rule is verified,** and every pass change is checked as passes are now.
- **New approaches are welcome,** for example rule discovery guided by the gap to the reference compiler. Report what worked and what did not.

## Measure and report
- the method, and the shapes found, with their instruction counts;
- each rule or pass change added, its verification, and what it gained;
- instructions per corpus project under O2 and `speed`, before and after, and against the reference compiler;
- the framework changes, each with its reason;
- which results you measured and which you only argued.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Run `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs` and `tests/workbench/*.test.mjs` before your last commit. Do not run the full suite (`npm test`): other agents share this machine. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them. If you change anything under `src/framework/` or `src/workbench/`, also check that `node tools/build-site.mjs` still builds (the browser bundle cannot import Node built-ins).
- **Scope:** you may change `src/typed/`, `tests/typed/`, `tools/` where the task needs it, and `src/framework/` where the framework does not fit, with each change and its reason recorded as a primary result. Do not change `src/tensor/`, the corpus's programs or their expected results, unless your task says so.
- **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-037-F:`, as you go, so that your last commit always holds working code. Do not push.
- **Never use `git stash`:** every worktree of this repository shares one stash stack with other agents' worktrees. To set work aside, make a temporary commit.
- **Outside your worktree,** use nothing.

## Final message
- the ticket, design and report paths;
- the rules and pass changes added, with their gains;
- regex, LZ and chess instructions under `speed`, before and after, and the corpus totals;
- the framework changes;
- the last commit hash.
