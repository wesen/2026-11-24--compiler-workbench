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

## Step 4 — Hold the edited work fixed across chess sizes

The intact-corpus runs change different functions. Chess edits invalidate five roots, and Candela edits invalidate one. I added a controlled chess comparison to isolate the incremental cost of extra unaffected IR.

### Prompt Context

See Step 1. Measure growth across sizes before deciding where the runtime belongs.

### What I did

I added `chess-controlled` to the same script. It selects an eligible function with no callers, builds nested call-closed subsets, and checks that exactly one meaning task and three analysis tasks execute per edit. It retains frame-array mode so the evaluator's memory layout and the closure-key inputs stay comparable.

### Why

The intact-corpus cost includes genuine variation in the edited program, but it cannot identify the effect of adding unaffected functions. Closed subsets reuse real chess functions without synthetic duplication.

### What worked

The focused graph extraction tests passed before commit `b09c44d`. A private tmux socket via escalation ran the controlled comparison and captured its exit status. The intact comparison loaded Candela in 4,987.91 ms and reached measured edits.

### What didn't work

`node "$ticket/scripts/01-e1.mjs" chess-controlled` initially stopped with `AssertionError [ERR_ASSERTION]: expected three distinct chess sizes`. Extending the subset in source order could pull in a large transitive closure before reaching the midpoint. I ordered the extension candidates by closure size and selected the smallest possible frame-array carrier when needed.

### What I learned

The ordinary origin has program-wide evaluator state as well as function parts. A valid controlled slice must preserve both call resolution and the frame-array flag.

### What was tricky

Subset construction changes the set of roots checked. The selected edited function has no callers anywhere in full chess, so adding functions cannot enlarge the set of invalidated meaning roots.

### What warrants a second pair of eyes

Check the closed subset construction, and interpret this control alongside the original whole-program runs.

### Code review instructions

Run `node "$ticket/scripts/01-e1.mjs" chess-controlled` after building and inspect the assertion on executed meaning tasks.

## Step 5 — Decide from the matched and intact measurements

The controlled run confirmed that the runtime reused unaffected work and still grew with size. The intact Candela run completed, and its much lower runtime/current ratio showed a genuine benefit under that workload. The gate asks for the runtime's own per-edit cost to stay flat or fall as size rises, so I chose to move it to labs.

### Prompt Context

See Step 1. Apply R3's adoption gate after measuring both paths.

### What I did

I retained the per-edit JSONL from both campaigns and added `scripts/02-summarize.mjs` to compute medians and min/max ranges. The intact campaign finished with six timed pairs per program, and the controlled campaign with six per chess size.

### Why

The median and the paired log expose variability without hiding outliers. The controlled comparison holds the affected roots constant while the intact run reports actual programs and workloads.

### What worked

The controlled runtime medians were 138.27, 200.96 and 222.67 ms/edit, with current medians 389.81, 492.85 and 817.26 ms/edit. Every controlled edit executed three analysis tasks and one meaning task. Candela completed at 683.90 ms/edit runtime and 18,454.00 ms/edit today by the median. All checked facts and case totals matched. The controlled process exited 0 in tmux.

### What didn't work

The runtime showed a speedup, but its absolute controlled cost increased with size. The ranges overlap and the controlled run overlapped the tail of the Candela run, so the data supports the direction of the decision more strongly than a precise growth coefficient.

### What I learned

The intact chess and Candela latencies partly reflect different counts of invalidated roots. The same edited function and root count are needed to distinguish that effect from size scaling.

### What was tricky

Both the fixture size and accepted meaning are faithful to the corpus. Set formation, closure-key derivation, runtime cache checking, and whole-artifact invariant overhead still count.

### What warrants a second pair of eyes

Review the R3 gate interpretation against the drop in the relative ratio and the rise in absolute latency.

### Code review instructions

Compare the two raw JSONL files with the output of `node "$ticket/scripts/02-summarize.mjs"`.

## Step 6 — Move the query runtime after the decision

The lab compiler kept its existing engine and tutorial with updated imports. The generic framework core now exports the data and type primitives.

### Prompt Context

See Step 1. Apply the move supported by the measured result.

### What I did

I moved runtime, query and record modules into labs. I moved the runtime and policy tests and split out two tests that exercise portable core data only. I transferred the runtime tutorial into the labs conformance test. The benchmark now loads the runtime from its final path.

### Why

Keeping the lab engine preserves the conformance examples. Splitting the data tests preserves the core's coverage boundary. The framework barrel has no reference back to labs.

### What worked

`npm run build` succeeded. `find src/framework -name '*.ts' -exec wc -l {} + | tail -1` printed `9714 total`, down 3,018 lines from the pre-change count. The call-chain smoke run checked all facts and totals through the relocated engine.

### What didn't work

The pilot's snapshot failure in Step 2 came from omitted benchmark registration descriptions, which the runtime database expects as data. I supplied those descriptions. The benchmark still counts executed task bodies so snapshot serialization stays outside the measured cost.

### What I learned

The production compiler path and the framework's standalone transaction protocol can remain independent of the lab engine.

### What was tricky

Tests named for the core mixed runtime behavior with two portable canonical-data checks. I preserved those checks in the framework and kept the runtime cases together in labs.

### What warrants a second pair of eyes

Look for any import of a moved module through the older framework barrels, and compare the moved tests with their original assertions.

### Code review instructions

Review `src/framework/core/index.ts`, `src/labs/{runtime,query,records}.ts`, and `tests/framework/core-data.test.mjs`. Run the lab suite and the call-chain smoke probe.

## Step 7 — Run the acceptance commands

I built the site and ran the frozen baseline oracle and each requested suite. The moved lab tests were an additional suite.

### Prompt Context

See Step 1 and the acceptance list in the request. Preserve the baseline and exercise each migrated import.

### What I did

I ran `npm run build`, `npm run check`, `node tools/build-site.mjs`, and the coordinator's read-only `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check`. I used `node --test --test-concurrency=2` on each requested file list and the labs suite, explicitly dropping files ending in `-gpu.test.mjs`.

### Why

The site uses the framework source catalog. The baseline checks outputs outside the changed engine path. Separate suite runs keep pass and skip totals auditable.

### What worked

TypeScript and the site build passed. The baseline printed `no differences`. Framework, labs, workbench, stdlib, and non-GPU tensor completed without a failure. The relocated benchmark smoke run exited 0.

### What didn't work

The first zsh wrapper passed `"${files:#*-gpu.test.mjs}"` as one argument. Node printed `Could not find 'tests/framework/conformance.test.mjs tests/framework/contracts.test.mjs …'` and ran no files in that attempt. I built the list with an explicit suffix comparison and passed `"${files[@]}"`, which supplied each file separately.

### What I learned

The default workbench suite marks one Candela test opt-in. The Typed suite also contains opt-in Candela tests. Default skipped tests are reported as skips, not as passes.

### What was tricky

The GPU file exclusion applies only to test file selection. CPU-side CUDA lowering and source tests are part of the requested tensor suite and ran.

### What warrants a second pair of eyes

Review the raw baseline output and per-suite counts in the report.

### Code review instructions

Build once, then run the explicit file lists in the report. Do not invoke the repository-wide `npm test` command or any GPU test.
