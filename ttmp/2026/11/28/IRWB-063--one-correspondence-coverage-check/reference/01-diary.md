---
Title: Diary
Ticket: IRWB-063
Status: active
Topics: [framework, compiler]
DocType: reference
---

# Diary

## Step 1: Read the guide and define the work

I read the intern guide and created the ticket and design note before code changes.

### Prompt Context

> F41, one coverage check for correspondences: make one type and one check over EntityCorrespondence in correspondence.ts, used by both the manager and derivation code, and delete the duplicate. Preserve tests and baselines, run the specified non-GPU suites and site build, keep a detailed diary and commit on the current branch.

### What I did

Read the guide, docmgr and diary skills; created IRWB-063 with docmgr; inspected the existing coverage code and wrote the design.

### Why

The manager checks declared entries, while derivation checks raw entries for nonempty and completed entries for side coverage; retaining this distinction preserves behavior.

### What worked

The ticket was created at the requested date. The guide explicitly describes F41 and the applicable checks.

### What didn't work

No command failed. The brief excludes contracts/types.ts although it contains one of the two types; the guide includes that file. Asked for clarification.

### What I learned

Derivation completion accounts for every entity, so checking nonempty after completion would change behavior.

### What was tricky

The scope conflict prevents deleting the duplicate contract type without permission.

### What warrants a second pair of eyes

Whether the proposed split between raw and completed entries precisely preserves coverage semantics.

### Code review instructions

Read the design note, then compare both original callers and their tests with the shared check.

## Step 2: Share the policy check and test it

Implemented a common check and connected both callers, preserving their error messages and derivation's completion semantics. Added direct policy tests.

### Prompt Context

See step 1.

### What I did

Added `checkCoverage` and `Coverage` in the IR correspondence module, replaced both checks, and tested the policies including an empty entry and empty sides. Ran targeted tests and began acceptance checks.

### Why

One implementation prevents policy drift; error translation stays with each caller.

### What worked

`node --test tests/framework/derivation.test.mjs tests/framework/r3-defects.test.mjs` passed two files; `node --test tests/framework/correspondence-entities.test.mjs` passed.

### What didn't work

`npm run check` failed: `src/framework/passes/define-pass.ts(24,8): error TS2305: Module '"../ir/derivation.js"' has no exported member 'DerivationCoverage'.` The initial `npm run build` emitted the same diagnostic on completion. The excluded pass file imports that type, so requested permission to update the import and use.

### What I learned

The type has another consumer outside the listed scope. Tests run against emitted JavaScript despite TypeScript diagnostics, so passing tests cannot establish a clean build.

### What was tricky

The coverage check takes uncompleted entries for derivation nonempty and completed entries otherwise.

### What warrants a second pair of eyes

The scope exception and its effect on the neighboring lane.

### Code review instructions

Review the shared check, the two caller adaptations, and the direct policy cases.

## Step 3: Restore a buildable scoped checkpoint

Restored the original derivation type declaration while waiting for the scope decision. This leaves the single-type objective incomplete but avoids a broken build.

### Prompt Context

See step 1.

### What I did

Kept the existing type declaration in derivation.ts and retained the shared runtime check. Rebuilt with `npm run build`.

### Why

The existing pass imports the type from derivation; changing that pass is explicitly outside the brief's scope.

### What worked

`npm run build` completed successfully after restoring the declaration.

### What didn't work

The first build and type check failed as recorded in step 2. No other failure in this step.

### What I learned

A clean build is possible within scope, but removing both duplicate declarations needs changes in two excluded files.

### What was tricky

A type alias would preserve the old API but the user's global instructions prohibit unrequested compatibility layers.

### What warrants a second pair of eyes

The scope conflict and the temporary incomplete type consolidation.

### Code review instructions

Check that the existing derivation type is retained as a temporary constraint and the shared check preserves behavior.

## Step 4: Validate and document the scoped checkpoint

The baseline was unchanged; sandbox subprocess restrictions caused four suite files to fail, and an escalated rerun passed them.

### Prompt Context

See step 1.

### What I did

Ran build, type check, site build, the baseline comparison, targeted coverage tests, and the requested non-GPU suite. Reran the four failing files with escalation and wrote the report.

### Why

These checks establish behavior and identify sandbox failures without changing existing assertions.

### What worked

`npm run build`, `npm run check`, and `node tools/build-site.mjs` succeeded. The baseline command printed `no differences`. The combined suite passed 79 of 83 files; the four rerun files passed 15 tests with one conditional skip.

### What didn't work

The combined `node --test tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs tests/stdlib/*.test.mjs $(rg --files tests/tensor -g '*.test.mjs' -g '!*-gpu.test.mjs')` reported four failures. Direct runs of format, workbench/candela and workbench/site showed `Error: spawnSync /home/manuel/.nvm/versions/node/v24.18.0/bin/node EPERM`; reference-check reported `SyntaxError: Unexpected end of JSON input` after its subprocess produced no output. `node --test tests/typed/format.test.mjs tests/typed/reference-check.test.mjs tests/workbench/candela.test.mjs tests/workbench/site.test.mjs` with escalation passed.

### What I learned

Tests which spawn Node need the brief's requested escalation in this sandbox.

### What was tricky

The test runner's compact combined output hid the underlying errors, requiring direct runs.

### What warrants a second pair of eyes

The unresolved type consolidation and excluded files in the report.

### Code review instructions

Review the report and compare the scope against both type consumers before completing the consolidation.
