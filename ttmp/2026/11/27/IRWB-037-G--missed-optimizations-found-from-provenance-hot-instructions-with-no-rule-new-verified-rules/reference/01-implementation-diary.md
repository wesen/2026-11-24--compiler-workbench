---
Title: Implementation diary
Ticket: IRWB-037-G
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Diary of IRWB-037-G
LastUpdated: 2026-11-27T12:57:32.583509852-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: set up and measure again

- Read the contracts and IR READMEs, `define-pass.ts`, `strategies.ts`, `passes.ts`, D1's report and
  `attribute.ts`, the rule files (`rules/form.ts`, `compile.ts`, `verify.ts`, `simplify.ts`) and the tests that
  pin them. `npm ci`, `npm run build` (no `node_modules` or `dist` in the worktree).
- `scripts/01-benchmarks.mjs` measures the three benchmarks as their tickets did
  (`various/01-benchmarks-before.json`): regex 6,933 (default options) and 5,405 (tuned) against the
  reference's 6,628; LZ 159,079 and 156,782 against 156,405; chess 11,021,307 and 10,038,193 against
  10,827,760. D1 had already closed most of the regex gap the brief quotes (8,040).
- `scripts/08-corpus-measure.mjs` (D1's script with a reference column) ran in the background into
  `various/08-corpus-before.json` before any pass changed. Totals: O2 1,090,271, `speed` 867,770 (default
  options), which are D1's "after" totals.

## Step 2: read the hot code by hand

- `scripts/02-hot-listing.mjs` prints the head revision block by block with the instructions of each statement
  and their counts. In the regex matcher the same `if (state >=u 9)` runs three times per iteration on one
  `state`, `row = 5 * state` is followed by `if (row >=u 45)`, and `t43 = (load == 1)` is stored and then tested
  in the next block. All of these statements have the origin `ingest`.

## Step 3: the gap to the reference, without a source map

- `scripts/03-probe-reference-debug.mjs`: the reference compiler returns the image, entries and signatures.
  There is no map from instructions to source.
- `scripts/04-spectrum.mjs` joins the two images by execution count instead: for each count n, the instructions
  that ran n times in each. Regex: the classes differ by one or two instructions each (n = 64: 29 against 27;
  n = 72: 9 against 8; n = 32: 15 against 22 in our favour).
- Reading both sides of a class: the reference repeats the same bounds checks. It keeps constants in registers
  and ends its loops in one branch, which are our `homes` and `chains` options.
- Result: the join works, and it shows that the reference has no rule we lack. The candidates had to come from
  provenance.

## Step 4: the tool (`src/typed/missed.ts`, `tools/missed.mjs`)

- `hotShapes(head, calls)` credits executed instructions to statement shapes and node patterns, with the passes
  named in each site's origins. `scripts/05-probe-origins.mjs` showed that an entity has one origin entry, the
  pass that made it, so the label is the set of `via` over the statement and its tree.
- First table for regex: `if geu(x, #)` is 1,742 of 6,933 instructions, 30 sites, all untouched.
- `scripts/07-corpus-shapes.mjs` sums the tables over the corpus and counts rule firings: 43.1% of 653,178
  instructions at statements no pass touched; `set x` 56,172; `if geu(x, #)` 19,432; 13 of 27 simplify rules
  never fire under `speed`.

## Step 5: design, committed (badf42a)

- Three pass changes (test threading in cfg, decided checks in bce, copies in constprop) and a rule experiment.

## Step 6: first implementation, inside the existing passes, and why it was undone

- Built the three as phases of cfg, bce and constprop (and a memory-reading case in subst). Regex went to
  6,179 and LZ to 147,978.
- `node --test tests/typed/*.test.mjs`: 9 failures. They pin the book's numbers and listings for Blend, Checksum
  and Collatz under O2 (88 bytes and 451 instructions, the `why` tree of `s:blend.15`, the copy `t7 = i`).
  The new phases improve exactly these programs (Collatz under O2: 7,461 to 5,367).
- O2 and the passes it names are held to the book by tests, so I moved the phases out: four passes of their own
  (`thread`, `guards`, `copies`, `subst-mem`), named only by `speed`. The pass parameters I had added to the old
  passes went away again, except `subst`'s `loads`, which is off unless `subst-mem` sets it.
- After that the typed tests had one failure, the pin `speed.slice(2, -2) == O2+`, which I replaced by "speed
  without the new names is still inline, inline, O2+, rotate, cfg".

## Step 7: the ablation harness

- `scripts/09-ablation.mjs` runs variants of a pass list over the corpus. Its `old` variant reproduces the
  baseline totals (867,770 and 792,800), so the comparison is against the same compiler.
- `scripts/10-snapshot.sh` copies `dist/` and `tools/` so a long run is not disturbed by a rebuild. (D1's
  diary says a started process keeps its modules; the copy also protects the start.)
- First full run: thread -25,884, copies -13,780, guards -4,974, subst-mem -166 (default options, each alone).
  `copies` alone is +4,271 under the tuned options.

## Step 8: tests, and two corrections they forced

- `tests/typed/guards.test.mjs`, `tests/typed/missed.test.mjs`, `tests/framework/scoped.test.mjs`.
- `subst-mem` first required the reader to be the next statement. The lifted code has `t = load; r = 0; if (t
  == 5)`, so the rule became "no store, zeroing or call between".
- The test of the guard facts expected one `because`; the loop test narrows `state` too, so there are two.

## Step 9: a defect in bce, found while reading it (not changed)

- bce accepts a dominating `i < buf.length` when the index has the same set of reaching definitions at the
  branch and at the check. `scripts/13-probe-bce-same-defs.mjs` is a loop whose only assignment to `i` lies
  between the two: the sets are equal, the values are not. bce removes the check; the meaning check rejects
  the pass (16 of 40 cases disagree). So the gate holds, and the pass is unsound without it.

## Step 10: what the tables showed next

- chess: `chessOnBoard_t2 = ((at & 15) < 8); goto J` was not threaded. J becomes a block that only tests
  only after the outer `&&` is gone and cfg has merged. `thread` now decides a constant arm itself and runs a
  second time after strength (-1,587 on the corpus over one run).
- chess: `dense / 8` with `dense` counting from 0 to 63 stayed a division. `scripts/14-probe-chess-shapes.mjs`:
  `typed.ranges` has `dense` in [-2^31, 63] there. The inner loop's head widens `dense` while the outer loop is
  still rising, the increment then overflows the interval, and the lower bound is gone. `guards` got an
  induction rule for phis (a counter that only goes up starts at its entry value) and reduces `x / 2^k` and
  `x % 2^k` under its own facts.
- `copies` restricted to copies all of whose reads can be replaced was worse (default options) and did not fix
  sha-chacha under the tuned options, so it reads through any read it can. `scripts/15-per-function.mjs`:
  the sha-chacha cost is in `chacha20Block`, 34 spills against 19.
- A second `lvn` before rotate would save 1,010 on five projects, and lvn throws `absent` on regex-nfa there.
  Not added.

## Step 11: rules

- `scripts/11-rule-candidates.mjs`: ten candidates from the node patterns. Seven sound, three refused with
  counterexamples at negative x. Added to simplify's table for a measurement: 61 + 4 firings, 192 instructions
  in one project.
- `scripts/16-rules-after-guards.mjs`: candidates for the shapes guards leaves, as a table pass after the last
  subst-mem: chess-search 286,239 to 278,850. Three rules became the table `identities` and the pass of that
  name. `scripts/17-identities-evidence.mjs` records their evidence with the options of the other tables.

## Step 12: final measurements and checks

- `scripts/08-corpus-measure.mjs` after: `speed` 867,770 to 789,710 (default options) and 792,800 to 724,721
  (tuned); 30 projects change, none higher, none rejected; O2 identical in every cell.
- `scripts/01-benchmarks.mjs` after: regex 6,052 and 4,868; LZ 147,978 and 140,194; chess 9,252,728 and
  8,172,948.
- `scripts/17-identities-evidence.mjs`: the two rules without a proof were checked on all 2^32 inputs (563 s and
  729 s on the loaded machine); the third has a symbolic proof.
- `scripts/18-verify.sh`: parity 8,286 of 8,286, both reference checks 8,286 of 8,286. The IRWB_FULL test in
  `speed.test.mjs` runs O2+, rotate, cfg and not `speed`, so `scripts/21-speed-full-check.mjs` checks `speed`
  itself: 368 revisions accepted, 16,572 of 16,572 decided image cases agree.
- One workbench test pinned the number of passes (15); it is 20 now.
- The ablation with 17 variants was still on chess-search after 50 minutes on the shared machine (load average
  17 to 23). I stopped it and split it: the per-pass variants on all projects, with chess-search in its own
  process, and the parameter and order variants on the other 49 projects. `scripts/20-ablation-table.mjs` merges
  the files, and `old` and `all` reproduce the totals of script 08.
- A mistake on the way: `pkill -f 09-ablation.mjs` also matched the shell that ran it and killed my own command.
  The edit it carried had not run; I redid it.
- `scripts/23-fill-report.py` fills the report's numbers from the JSON outputs.

## What I would check first when reviewing

- `src/typed/guards.ts`: the dominance argument in the header, the counter induction in `guardPlan`, and
  `narrowBy` for `ltu` and `geu`.
- `tests/typed/guards.test.mjs`: the negative cases (an index assigned after its check, a counter that goes both
  ways, a store between a load and its reader).
- `various/19-corpus-table.txt` and `various/21-speed-full-check.log`.
