You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`, each project a Typed program with its own `project.json`; the workbench UI in `src/workbench/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`), which your task does not touch.

Every Typed optimization is a checked pass. The meaning contract compares a pass's output with the program before it on generated cases, the RV32 backend runs images in an emulator and counts executed instructions, and every edit carries a correspondence back to the IR before it. The pipelines (O0, O1, O2, `loops`, O2+, `speed`) are named strategies in `src/typed/strategies.ts`. The reference compiler and its parity checks are in `vendor/` and `tools/parity.mjs`, `tools/reference-check.mjs`.

Read first: `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, and the tickets under `ttmp/2026/11/24/` to `ttmp/2026/11/26/` that your task names.

Your ticket is <ID>. This is a **research and implementation stage**, in one session of up to three hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.

## Your task (B1): specialize the bytecode VM on its bytecode, a first Futamura projection
The bytecode VM (`corpus/projects/bytecode-vm/`, ticket `ttmp/2026/11/26/IRWB-012--bytecode-vm/`) runs a bytecode program from a buffer. Hand-specialized loops for its two programs take 75 and 74 instructions, against 7,678 and 6,874 for the general VM. The existing specialization (IRWB-009 and IRWB-010, `src/typed/specialize.ts`) binds scalar values and fields, not memory, and binding scalars here gains almost nothing.

- **Specialize on a constant buffer:** a host promise that a buffer's contents are fixed, checked as the field binding is checked, and a binding-time analysis that propagates it through loads from that buffer.
- **Specialize the dispatch loop** on a known program counter: when to unroll it, how to stop, and how the result stays checked by the meaning contract.
- **Measure how much of the gap** to the hand-specialized 75 and 74 instructions automatic specialization closes, and what it costs in code size.
- **New approaches are welcome,** for example polyvariant specialization with a size budget, or a check that the promise holds at run time. Report what worked and what did not.

## Measure and report
- the binding-time analysis and the dispatch-loop specialization, with their checks;
- instructions and code size of the specialized VM for both programs, against the general VM and the hand-specialized loops;
- what stops the specialization, and where it falls short;
- the framework changes, each with its reason;
- which results you measured and which you only argued.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Run `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs` and `tests/workbench/*.test.mjs` before your last commit. Do not run the full suite (`npm test`): other agents share this machine. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them. If you change anything under `src/framework/` or `src/workbench/`, also check that `node tools/build-site.mjs` still builds (the browser bundle cannot import Node built-ins).
- **Scope:** you may change `src/typed/`, `tests/typed/`, `tools/` where the task needs it, and `src/framework/` where the framework does not fit, with each change and its reason recorded as a primary result. Do not change `src/tensor/`, the corpus's programs or their expected results, unless your task says so.
- **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `<ID>:`, as you go, so that your last commit always holds working code. Do not push.
- **Outside your worktree,** use nothing.

## Final message
- the ticket, design and report paths;
- the instructions and code size for both programs: general, specialized, hand-written;
- the framework changes;
- the last commit hash.
