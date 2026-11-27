---
Title: Diary
Ticket: IRWB-034-F
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:11:27.986597019-05:00
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
The task is the brief `IRWB-034-F` (D1: why `speed` makes the bytecode VM slower), handed to this session as a
prompt file by the coordinator. Its text is not repeated here; its requirements are summarized in the design doc.

## Step 1: Setup, two probes, and the design

The worktree had no `node_modules`; `npm ci` and `npm run build` in the worktree (no other directory used). Then
two probes before writing the design, so the design could say what the attribution must explain.

### What I did
- `scripts/01-pass-prefix.mjs`: applies `speed` one pass at a time on the bytecode VM and counts both fixtures
  (n = 12, seed = 8, `coalesce: true`) after each pass. Output (fib, checksum, spills, saved, insns):
  r0 7678 6874 0 0 210; after cfg/fold/cfg 6688 5968 0 0 206; **after licm 9287 8219 0 10 226**; final
  9286 8218. `inline` and `rotate` change nothing.
- `scripts/02-licm-listing.mjs`: IR and counted image before and after licm. Nine back edges into
  `bb:runVm.3`; `typed.loops` gives nine loops with one id `loop:runVm@bb:runVm.3`; licm makes nine
  preheaders and redirects the other latches through them. After cfg: one block of 15 `addi rd, sp, k` plus a
  jump, 184 executions per Fibonacci run.
- `scripts/03-corpus-measure.mjs`: per-project instructions under r0, O2, speed (10 cases per function, seed 7,
  from r0), default backend and `coalesce: true`, plus a count of loop heads shared by several back edges at
  licm's input. Baseline run started in the background into `scripts/results/03-baseline.{log,json}`.
- Design doc written: attribution by lineage through correspondence plus edit logs, earliest-decision credit and
  debit, exact sum identity; fix = licm merges loops by head.

### Why
- The prefix replay is cheap and tells which pass; it is kept as the independent cross-check of the attribution.

### What worked
- The probes pinned licm at once; the IR listing shows the mechanism.

### What didn't work
- Nothing failed. Note: `sharedHeads` measured at r0 was 0 for the bytecode VM (r0's latches jump through
  blocks that cfg threads later); the probe now measures at the O2 prefix before licm, where it is 1.

### What I learned
- O2 has the same slowdown (bytecode VM default backend: r0 39,954, O2 47,076 over the metric's cases).
- Typed correspondence records new entities and removals; an in-place edit (a retarget) appears as `retained`
  with no reason, so the edit log must be read too.

### What should be done in the future
- Merge loops in `typed.loops` itself (version 2), see the design's Later list.

## Step 2: The attribution, the merge fix, and its first measurements

Wrote `src/typed/attribution.ts` (`attributeInstructions`, `attributeSteps`) and `Program.attribute`, then the
licm fix (`loopsByHead` in `src/typed/passes.ts`). Commit 73f047c.

### What I did
- `scripts/04-attribute-vm.mjs` prints the decision table, the per-pass sums, the replay cross-check and the
  step-by-step attribution. Before the fix (`results/04-before-fix.txt`): whole chain r0 14,552 -> r7 17,504
  (both fixtures), nets sum to 2,952 exactly. Step by step, the licm step is +4,850: 15 rows
  `r4 licm [loop:runVm@bb:runVm.3, s:runVm.<set>]`, each credited 344 (= 172 + 172 or 184 + 160 executions,
  once per guest instruction) and debited 12-124 (the address it replaced in one opcode arm), the preheader
  jumps +344, `frame runVm` +40 (ten saves and ten restores, twice).
- First version credited only the whole chain by earliest decision. Its per-pass sums differ from the replay
  (r3 cfg +2 vs replay -342, r7 cfg +342 vs -2): the earliest-change rule gives a removal to the pass that first
  retargeted the jump, and cfg at r7 "moves" the head's statements into the merged preheader chain. The sums are
  still exact; the split between passes is a different question. Added `attributeSteps`, which applies the same
  function to each consecutive pair, so each step's nets sum to the replay's difference by construction.
- Fix: licm groups `facts.loops` by head (union body, union assigned, preheader recomputed). After it
  (`results/04-after-merge.txt`, `results/05-after-merge.txt`): coalesce speed fib 6,382, checksum 5,710; O2 the
  same; default backend 6,383 / 5,711. Each hoist now credited 2 (once per call).
- `tests/typed/attribution.test.mjs`: 4 tests, pass (22 s).
- Added an assertion to `tests/typed/bytecode-vm.test.mjs` that speed is not slower than r0 per call. It failed:
  `speed 178 > r0 166, entry=0, n=0, seed=3`. At n = 0 (four dispatches) the fixed cost of 15 hoisted frame
  addresses and 10 callee saves is not earned back. 39 of the 442+100 calls, all n = 0.
- `scripts/06-guard-variant.mjs` (the guard alternative = speed without licm here): n=12 6,688 / 5,968, n=0
  148. Merge wins at n = 12 by 306 / 258, loses at n = 0 by 30.

### Why
- The n = 0 result points at the 15 hoisted copies of two expressions (`frame+0` thirteen times, `frame+16`
  twice): each takes its own register for the whole loop.

### What worked
- The attribution reproduced the licm term from the records alone, and split it per hoist.

### What didn't work
- `results/` was first `out/`, which `.gitignore` ignores; renamed. The background run 03-after-merge had its
  JSON path under `out/`, so its final write fails; its log has every row.

### What should be done in the future
- See step 3 (hoist each distinct expression once).

## Step 3: Hoisting each expression once (tried, measured, not kept), and the final runs

Tried the remedy for the n = 0 case: licm reuses one local per invariant expression shape within a loop. It
helped the VM and five other projects, but made one project slower under `coalesce: true`, so the committed fix
is the merge alone. The experiment is kept as `scripts/09-licm-hoist-once.patch`.

### What I did
- With the patch: VM n=12 6,349 / 5,677, n=0 145 (r0 166), saved registers 0 (`06-guard-variant.mjs`).
- Corpus (`results/03-after-dedupe.log` vs `03-baseline.log`, `scripts/07-compare.mjs`): bytecode-vm,
  chess-search, lz-roundtrip, regex-nfa, sha-chacha better under O2 and speed with both backends; **orders
  worse with coalesce** (O2 1,030 -> 1,078, speed 1,021 -> 1,069), better with the default backend.
  Totals O2 default 1,124,912 -> 1,090,245.
- Parity with the patch: `tools/parity.mjs` 8286/8286, 0 failures; `reference-check --o2` 8286/8286.
  `tests/typed/*.test.mjs`: 155 tests, 151 pass, 2 fail (the two VM count pins, as expected).
- Diagnosed orders with the attribution (`scripts/08-attribute-project.mjs orders O2 '{"coalesce":true}' licm`):
  with the patch the row `r7 licm [loop:kernel@bb:kernel.1] {replace}` keeps 58 executions of
  `addi t3, t2, 0` (the copy `a = inv`, the local now read twice so subst cannot remove it); without it
  the same row is -116 with no credit (`results/08-orders-{dedupe,merge}.txt`).
- Reverted the patch; final runs on the merge-only build: corpus, typed tests, parity, reference check.
- Updated `corpus/projects/bytecode-vm/notes.md` (its measurement table and the paragraph saying speed was
  slower); the program and its inputs are unchanged.

### Why
- The brief asks for no regression in the other projects; the patch has one, so it stays an experiment.

### What worked
- The attribution explained a regression in a project it was not built for, in one run.

### What didn't work
- Hoist-once: `orders` under coalesce, above.

### What should be done in the future
- Hoist-once together with a copy-forwarding step for the reads of the shared local (or subst that handles a
  local with two readers) would keep the gain without the `orders` copy.

## Step 4: Final runs on the merge-only build, report

### What I did
- Corpus (`results/03-final.log`): identical to `03-after-merge.log` on every project; against the baseline only
  bytecode-vm and regex-nfa change, both faster. Totals, default backend: O2 1,124,912 -> 1,107,836, speed
  892,944 -> 876,743; without the VM: O2 1,077,836 -> 1,075,211, speed 845,868 -> 844,118.
- `tools/parity.mjs`: 8,286/8,286 decided agree, 0 failures. `tools/reference-check.mjs --o2`: 8,286/8,286.
- `tests/typed/*.test.mjs`: 155, 152 pass, 2 skipped, 1 fail: `format: every corpus file ... fits a tile`,
  `corpus/projects/bytecode-vm/notes.md: 74` (my rewritten paragraph). Rewrapped at 70 columns; format test
  5/5. `tests/workbench/*.test.mjs` on the final build: 24 pass, 1 skipped, 0 fail. Framework 234/234 (it does
  not load the typed passes).
- Report written: `analysis/01-report-why-speed-made-the-bytecode-vm-slower-and-the-fix.md`.

### What didn't work
- In step 2 I measured the pre-fix O2 numbers by `git stash push src/typed/passes.ts` and `git stash pop` in
  this worktree. The stash stack is shared with other worktrees; the pop restored my own change (the build
  after it gave the fixed counts and `git diff` showed only my hunk), but a WIP commit would have been the
  safe way.
