---
Title: Diary
Ticket: IRWB-066
Status: active
Topics:
    - framework
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T03:39:31.993544428-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1 — Establish scope and design

I read the phase 4c guide, located its phase 4b companion, and checked the R3 gate and BACKLOG E1 against the implementation. The caller audit found active framework dependencies that narrow the extraction.

### Prompt Context

> ## Your task: the E1 benchmark, and keep, move or delete the unused engines (phase 4, item 4.7)
> Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`) migration step "Keep or move the rewrite engine, the transaction layer and the 1,237-line core runtime" and `BACKLOG.md` item **E1** (incremental checking per function), after the guide.
>
> R3 found three framework parts that no domain uses (probe 03/05): the **core runtime** (`src/framework/core/runtime.ts`, `query.ts`, `records.ts`; about 1,237 lines: queries with dependency tracking and early cutoff), the **rewrite engine** (`src/framework/ir/patterns.ts`, `rewrites.ts`, `traversal.ts`) and the **transaction layer** (`src/framework/ir/transactions.ts`). Their callers are the test domain in `src/labs/`, `src/conformance/`, framework tests, and `src/typed/rules/form.ts` (it builds a `NodePattern` for listing rules), and `src/framework/ir/view.ts` (`View.edit`, `walk`, `subgraph`, which no caller uses). Typed has its own transaction (`src/typed/tx.ts`), and rules now match through `src/stdlib/term`.
>
> 1. **The E1 benchmark** (in your ticket's `scripts/`): an edit stream on large corpus programs (chess, and Candela if it loads in time), applying small edits one at a time to programs of increasing size, measuring the cost of checking each edit (re-running the analyses and checks it invalidates) today, and with the core runtime's queries keyed by function part (early cutoff). Report cost per edit against program size.
> 2. **Decision point (R3):** adopt the runtime only if its per-edit checking cost falls with program size. If it does not, the runtime does not earn its place in the core.
> 3. **The change the measurement supports:**
>    - Runtime: adopt it on the path the benchmark measured, or move it out of `src/framework/core/` (to `src/labs/` with its conformance tests) or delete it.
>    - Rewrite engine and transaction layer: no measurement decides them; R3's evidence is that no domain uses them. Move `form.ts`'s listing onto `src/stdlib/term`, then move the engine and transactions with the test domain that uses them (`src/labs/`), keeping their tests passing, unless you find a domain use.
>    - Record what you moved, deleted or kept, with the numbers, and the framework's line count before and after.

### What I did

I created the ticket and three documents with docmgr. I wrote the measurement design before changing TypeScript. I counted 12,732 lines in framework TypeScript and inspected imports and actual method calls.

### Why

E1 needs a before/after comparison of checking the same edits with the same semantics. The move needs actual call-site evidence, especially around `View`.

### What worked

`node -v` printed `v24.18.0`. Ticket and document creation succeeded. The escalated `npm ci` installed six packages and audited seven.

### What didn't work

The initial `npm ci` failed at esbuild's `node install.js` with `Error: spawnSync …/node_modules/esbuild/bin/esbuild EPERM`. I reran the same command with escalation.

### What I learned

The transformation runner resolves `ctx.edit` through `view.beginEdit()`. Traversal implements six additional view queries beyond walk and subgraph.

### What was tricky

The brief's `View.edit` is actually `View.beginEdit`. Moving those dependencies to labs would invert the dependency direction.

### What warrants a second pair of eyes

Check that the benchmark compares function-local facts, and that its meaning dependencies include callers.

### Code review instructions

Start at the design note, then inspect `src/framework/passes/transformation.ts` and `src/framework/ir/view.ts`.

## Step 2 — Probe the benchmark loop

I used short corpus runs to verify the edit and query APIs before starting the full measurement. The pilot covered assembly, artifact validation, runtime reuse and equality of the observed analysis and meaning results.

### Prompt Context

See Step 1. Establish that the two benchmark paths bring the same results up to date.

### What I did

I wrote `scripts/01-e1.mjs`, ran `npm run build`, and ran the script with `first-steps`, `bytecode-vm`, and then `bytecode-vm call-chain` as arguments.

### Why

Small programs expose input assumptions and runtime overhead while keeping feedback short. A three-seed campaign resets differential cache identity and pairs every timed edit.

### What worked

On bytecode-vm the script checked 40 cases per edit, ran all three analysis tasks and one meaning task, and matched the whole-program facts and totals. Call-chain has two eligible sites, both in `g`, and the resulting runtime check executes for two roots.

### What didn't work

- `node "$ticket/scripts/01-e1.mjs" first-steps` stopped with `AssertionError [ERR_ASSERTION]: first_steps: only 0 editable sites`. I selected call-chain as the smaller corpus input.
- `node "$ticket/scripts/01-e1.mjs" bytecode-vm` reached `Compiler.snapshot` and stopped with `Error: IR data cannot contain undefined`. I instrumented executed task bodies directly. Their counters measure the work performed without serializing the runtime database.
- `node "$ticket/scripts/01-e1.mjs" bytecode-vm call-chain` stopped with `AssertionError [ERR_ASSERTION]: call_chain: only 2 editable sites`. I retained both distinct sites and ran two edits per seed across all projects for balance.
- `tmux has-session -t irwb066` returned `error connecting to /tmp/tmux-1000/default (Operation not permitted)`. The initial benchmark runs as a tracked tool process.

### What I learned

The meaning check supplies whole-program baseline outcomes and already replays closure verdicts. Function-level tasks avoid asking for each replayed verdict again, but still scan the task frontier. Project size and evaluation work are distinct. Bytecode-vm has one function and considerably more IR than call-chain's three.

### What was tricky

Separate artifacts for the two arms must share unchanged records only within each arm. Copying every edit independently would destroy the function part's identity reuse.

### What warrants a second pair of eyes

Review the chosen edit sites, and distinguish analysis reuse from differential replay and runtime task overhead.

### Code review instructions

Run `npm run build` and `node "$ticket/scripts/01-e1.mjs" call-chain bytecode-vm`. Check the executed counters and verdict assertions.

## Step 3 — Extract graph matching and rewriting

The labs now own graph patterns and the rewrite scheduler. Typed's listing renders the term pattern it already verifies and executes. The shared IR still owns its transaction and traversal operations.

### Prompt Context

See Step 1. The graph engine move follows the caller audit independently of the runtime benchmark.

### What I did

I moved `patterns.ts` and `rewrites.ts`, removed the framework re-exports, moved their two tutorials and lab-focused test files, and switched Typed's `patText` to the stdlib `Pattern` type. I replaced the obsolete conversion assertions with tests for term repeats and unchanged rule listing.

### Why

Typed's matcher distinguishes structural repetition from entity identity. Rendering the original term shape avoids converting it to a graph pattern that can lose that distinction. Moving keeps the graph behavior exercised by the labs and conformance examples.

### What worked

After the conformance import fix, `npm run build` passed. The escalated command `node --test --test-concurrency=2 tests/labs/*.test.mjs tests/typed/rules.test.mjs tests/framework/conformance.test.mjs` passed 79 tests with zero failures.

### What didn't work

The first `npm run build` reported `src/conformance/02-ir-manipulation.ts(7,3): error TS2305: Module '"../framework/ir/index.js"' has no exported member 'capture'.` It also reported missing `entity`, `op`, `pattern`, `matchAll`, `explainMatch`, `rewrite` and `innermost`, followed by callback types it could no longer infer. That tutorial used barrel imports missed by the first path-based search. Moving both graph tutorials and importing the labs modules fixed the build.

The sandboxed `git add` and `git commit` at the prior checkpoint both reported `fatal: Unable to create '…/.git/worktrees/v7-engines-sl-irwb-066/index.lock': Read-only file system`. The escalated retry created `b44f442`.

### What I learned

`IRView` declares walk and subgraph in `types.ts`, and `readIR` binds both in `readers.ts`. Even if their direct callers move, the rest of the view traversal API and its shared implementation are still framework dependencies.

### What was tricky

The rewrite scheduler continues to use the framework's read-only view and mutation-only transaction protocols. Its implementation moves to the caller side of that boundary.

### What warrants a second pair of eyes

Check the direction of lab imports and the coverage of the updated Typed listing assertions.

### Code review instructions

Review `src/labs/patterns.ts`, `src/labs/rewrites.ts`, `src/typed/rules/form.ts` and the moved tests. Run the focused commands above.
