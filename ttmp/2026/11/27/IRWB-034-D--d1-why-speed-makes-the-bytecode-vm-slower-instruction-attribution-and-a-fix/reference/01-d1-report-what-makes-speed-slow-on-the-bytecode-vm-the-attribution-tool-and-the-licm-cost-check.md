---
Title: 'D1 report: what makes speed slow on the bytecode VM, the attribution tool and the licm cost check'
Ticket: IRWB-034-D
Status: review
Topics:
    - compiler
    - ir
    - performance
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/attribution.ts
      Note: the attribution tool
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/passes.ts
      Note: licm cost check
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/tests/typed/attribution.test.mjs
      Note: tests
    - Path: abs:///home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/attribution.mjs
      Note: CLI
    - Path: src/typed/attribution.ts
      Note: the attribution tool (new) — credits executed instructions to passes and r0 roots
    - Path: src/typed/backend/run.ts
      Note: runImage's per-word counts, the input of the attribution
    - Path: src/typed/passes.ts
      Note: the licm cost check, the lazy preheader and the `skip` records
    - Path: src/typed/program.ts
      Note: the revision chain with one correspondence per pass
    - Path: tests/typed/attribution.test.mjs
      Note: the tool's tests (four; totals, r0 identity, a kept hoist, the bytecode VM's refusals)
    - Path: tools/attribution.mjs
      Note: the CLI over the attribution tool, for any corpus project
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T14:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# D1 report: what makes `speed` slow on the bytecode VM

Ticket IRWB-034-D. Design: `design-doc/01-d1-design-…md` (with a "Revision after measuring" section for the part
the measurements changed). Diary: `log/01-implementation-diary.md`. Scripts and their outputs: `scripts/`, with the
generated tables in `scripts/out/`.

## 1. The cause, from the compiler's own records

`speed` publishes seven revisions for the bytecode VM — `cfg fold cfg licm subst subst cfg`; `inline` changes
nothing (the program has one function), `constprop`, `dce`, `lvn`, `strength`, `bce`, `rotate` change nothing.
`licm` is the only pass whose output adds instructions, and the attribution says exactly which decisions:

- `typed.loops` reports **nine natural loops with the same head** `bb:runVm.3` (one per back edge after `cfg`
  splits the dispatch chain), none with a unique preheader. `licm` created a preheader for each and hoisted the
  opcode arms' frame addresses (`sp + 0`, `sp + 16`) into them.
- The hoisted statements are executed **172–184 times** each — once per dispatch — while the statements they were
  taken from ran **12, 48, 60, 74 or 97 times**. Three arms (`s:runVm.101`, `.107`, `.112`: the SUB and MUL paths
  and the STORE path) are not even executed by the Fibonacci fixture, so their hoists are pure added work.
- Net, measured at `n = 12, seed = 8`: fib 7,678 → 9,286 (+1,608), checksum 6,874 → 8,218 (+1,344).

The mechanism in one sentence: a preheader runs once per **entry** into a natural loop, the computation it replaces
runs once per **iteration**, and with nine back edges to one head the other eight back edges are "exits" of each of
the nine loops, so every preheader runs on every dispatch. The hoist is not merely neutral: it is charged to the
common path and saves only on the rare path.

Ablation confirms the pass choice (`speed` without `licm` = 6,688 / 5,968, `licm` alone on r0 improves 7,678 →
7,192) but cannot say which decision; the table below is what the attribution adds.

## 2. The attribution tool

`src/typed/attribution.ts`, called from `tools/attribution.mjs`, tested by `tests/typed/attribution.test.mjs`.

**Method.** Every executed RV32 instruction maps to a `typed.blocks` statement through the image's `covers`, every
entity carries an `origin` record naming the pass that made it (`via`, `rev`, `note`), and every published revision
carries an `EntityCorrespondence` to the one before it. So:

1. `chainOf(program)` gives the revisions; `lineageOf(steps)` composes the correspondences into a backward map per
   step, so any entity of the head can be traced to the r0 statements it descends from (`rootsOf`, and
   `statementsOf`, which reports a value as the statement that computes it).
2. `attributeRun(lineage, at, run)` credits each image instruction's execution count to
   `(statement, pass, r0 roots)`; the pass is the statement's `origin.via` for a statement a pass made, and the last
   edit record that named the statement (`retarget`, `replace`, `move`, …) for one the front end made but a pass
   reshaped. Prologue, frame and epilogue instructions land in a `fn:NAME` bucket so frame growth is visible.
3. The credits must add up to the run: `total` equals `runImage(...).steps` on both fixtures
   (7,678 / 9,286 before the fix), and `unattributed` is reported, not silently dropped (0 for both fixtures).
4. `deltaBetween(r0, head)` compares the two ends per r0 statement and credits each difference to the pass that
   changed it; the deltas sum exactly to `head − r0` (asserted in the test).

### The decisions and the instructions credited to each (bytecode VM, `speed`, before the fix)

`fib` (`entry 0`), from `scripts/out/decision-table.md`:

| hoisted statement (licm) | insns at the head | from (r0 statement, the opcode arm) | r0 | head | Δ |
| --- | ---: | --- | ---: | ---: | ---: |
| `s:runVm.146` | 184 | `s:runVm.39` (PUSH's `stack[sp] = …`) | 370 | 480 | +110 |
| `s:runVm.147` | 184 | `s:runVm.34` | 222 | 332 | +110 |
| `s:runVm.149` | 184 | `s:runVm.53` (ADD's second pop) | 240 | 376 | +136 |
| `s:runVm.150` | 184 | `s:runVm.48` | 144 | 280 | +136 |
| `s:runVm.152` | 184 | `s:runVm.72` (ADD's store) | 60 | 232 | +172 |
| `s:runVm.153` | 184 | `s:runVm.67` | 48 | 220 | +172 |
| `s:runVm.154` | 184 | `s:runVm.61` | 48 | 220 | +172 |
| `s:runVm.156` | 184 | `s:runVm.92` (SUB's store) | 60 | 232 | +172 |
| `s:runVm.157` | 184 | `s:runVm.87` | 48 | 220 | +172 |
| `s:runVm.158` | 184 | `s:runVm.81` | 48 | 220 | +172 |
| `s:runVm.160` | 184 | `s:runVm.112` (MUL arm, not executed) | 0 | 184 | +184 |
| `s:runVm.161` | 184 | `s:runVm.107` (MUL arm, not executed) | 0 | 184 | +184 |
| `s:runVm.162` | 184 | `s:runVm.101` (STORE arm, not executed) | 0 | 184 | +184 |
| `s:runVm.164` | 184 | `s:runVm.121` (JZ's pop) | 65 | 236 | +171 |
| `s:runVm.144` | 172 | `s:runVm.26` (PUSH's `stack[sp] = operand`) | 48 | 208 | +160 |

Rolled up: **`licm` +2,555, `fold` −368, `cfg` −232, `subst` −184, front end −163 → +1,608**, which is the whole
regression (the instructions by pass at the head are `source 6538, licm 2748`).
For the checksum fixture (`entry 34`): `licm` +2,207, `fold` −320, `cfg` −244, `subst` −160, front end −139 →
+1,344, with the same fifteen hoists executed 136–160 times (`source 5842, licm 2376`).

After the fix, nothing is credited to `licm` at all: the pipeline is `cfg fold cfg licm subst subst`, `licm`
records 16 `skip` decisions for 15 distinct values, and the differences are `cfg` and `fold` and `subst` only.

## 3. The fix

`src/typed/passes.ts`, the `licm` pass. A hoist out of loop `L` is kept only when both hold:

1. **`L`'s head has a single back edge.** With several (the VM has nine) the natural loops are fragments of one
   loop, and a preheader runs once per *re-entry* rather than once per iteration.
2. **The defining block `D` dominates `L`'s latch.** Every iteration that reaches the back edge computes `D`, so
   the hoist saves on every iteration.

Then `count(D) ≥ count(iterations) ≥ count(entries) − (entries that leave before the latch)`: the hoist can lose at
most one execution per entry — the zero-trip cost every LICM pays — and it cannot lose in proportion to the trip
count, which is what the VM did (arm 12, preheader 172). No profile and no threshold is involved; both checks are
structural.

Two supporting changes in the same pass:

- **The preheader is created lazily**, only when at least one hoist survives. Before, `licm` left nine empty
  preheader blocks in the VM, each with a `br` executed on every dispatch, and 18 `retarget` edits.
- **Every refused hoist is recorded**: `tx.record('skip', {stmt, value, block, why})`, one per value, with
  `why: "bb:runVm.3 is the head of 9 natural loops: the preheader of … runs once per re-entry"` or
  `"not certain to execute on every iteration of …"`. That is the record the next stage ("missed optimizations from
  provenance") can query, and the attribution shows the decision as taken-not-made.

Result at `n = 12, seed = 8` (the ticket's measurement):

| fixture | r0 | `speed` before | `speed` after |
| --- | ---: | ---: | ---: |
| Fibonacci | 7,678 | 9,286 | **6,688** |
| checksum | 6,874 | 8,218 | **5,968** |

Both are below r0 (`tests/typed/bytecode-vm.test.mjs` prints `7678 / 6688 / 75` and `6874 / 5968 / 74` against the
hand-specialized image).

### The rule I tried first, and why it is not the one that ships

The first guard was "`D` dominates **every exit** of the loop", which gives `count(D) ≥ count(entries)` outright.
It is too strong, and the corpus said so: it also requires dominating the bounds-check **trap** and the **return**
exits, which every Typed loop has, so it refused Blend's `a * b + scale` (the running example of the spec, whose O2
image is pinned at 88 bytes / 451 instructions by `tests/typed/backend.test.mjs`) and every hoist in `licm-nested`
(the project that exists to show hoisting through two loops: 1,678 → 2,677, i.e. back to r0). Ten typed tests and
one workbench test failed on it. `scripts/out/corpus-compare-first-rule.md` keeps the numbers.

The second attempt ("no exit of `L` may reach its head") recovered Blend but still refused `licm-nested`, because a
nested loop's exit does reach the head again through the outer loop, and that re-entry is a *real* entry. Counting
back edges at the head distinguishes the two: the VM's head has nine, a nested loop's inner head has one.

## 4. Instructions per corpus project, O2 and `speed`, before and after

50 projects (`scripts/05-corpus.mjs --count 10`, whole JSON in `scripts/corpus-before.json` and
`scripts/corpus-after2.json`; only the projects that changed are listed, full table in
`scripts/out/corpus-compare.md`). Instructions are `strategies.measure`'s seeded counts (10 generated cases per
function, seed 7); the meaning checks ran on 10 cases per pass.

| project | O2 before | O2 after | Δ | speed before | speed after | Δ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bytecode-vm | 47,076 | 33,965 | −13,111 | 47,076 | 33,965 | −13,111 |
| chess-search | 424,927 | 423,801 | −1,126 | 329,320 | 327,910 | −1,410 |
| licm-nested | 1,678 | 1,777 | **+99** | 1,631 | 1,730 | **+99** |
| lz-roundtrip | 37,654 | 31,932 | −5,722 | 28,925 | 29,284 | **+359** |
| regex-nfa | 47,739 | 39,217 | −8,522 | 41,147 | 37,383 | −3,764 |
| **total (50 projects)** | **1,124,912** | **1,096,530** | **−28,382 (−2.5%)** | **892,944** | **875,117** | **−17,827 (−2.0%)** |

r0 is unchanged by construction: 1,123,009 before and after. No pass was rejected in any project under either
pipeline after the change.

Two projects regress and are reported as measured, not argued away:

- `licm-nested` +99 (+5.9%, still 33% below its r0 of 2,677). `a * b + 7` is invariant in both loops; it used to
  hoist to the outer preheader (executed once), now it stops at the inner preheader (executed once per outer
  iteration = 11 times), because the inner body does not dominate the outer latch when `cols` can be 0.
- `lz-roundtrip` `speed` +359 (+1.2%, still 13% below its r0 of 33,646) while its O2 improves by 5,722: the
  `inline`-first shape of `speed` changed which hoists are certain to execute.

Projects where `O2` or `speed` exceeds r0 after the fix: `div-magic` (729 → 769 / 759) and `sha-chacha` (O2
239,636 → 240,190). Both were already there before this change and neither involves `licm`.

## 5. Framework changes, each with its reason

Nothing under `src/framework/` changed: the correspondence records, the `origin` chain and the typed `Edit` records
were enough to attribute every instruction, and `applyPass`/`definePass` needed nothing new. The framework changes
this ticket makes are inside the typed domain:

| change | file | reason |
| --- | --- | --- |
| new attribution module (`chainOf`, `lineageOf`, `attributeRun`, `deltaBetween`, `deltaByPass`) | `src/typed/attribution.ts` | the tool the ticket asks for: credits instructions to decisions, reusable by the next stage |
| CLI over it, for any corpus project | `tools/attribution.mjs` | so the tool is a command, not a script in a ticket |
| `licm` needs `dom: 'typed.dominators'` | `src/typed/passes.ts` | the cost check needs dominance; the pass now declares what it reads |
| `licm` keeps a hoist only with a single back edge and latch dominance; preheader created lazily | `src/typed/passes.ts` | the defect: a preheader on the path of every other back edge runs once per re-entry |
| `licm` records a `skip` per refused hoist | `src/typed/passes.ts` | the compiler's own record of a decision not taken, for the next stage and for the attribution |
| tests for the tool | `tests/typed/attribution.test.mjs` | totals, r0 identity, a kept hoist (Blend), the VM's refusals |
| one expectation updated: `licm.needs` now includes the dominators | `tests/workbench/strategies.test.mjs` | the test pins the pass declaration, which legitimately changed |

`node tools/build-site.mjs` still builds (the browser bundle does not import the new module, and `passes.ts` is
already bundled).

## 6. What was measured, and what was only argued

Measured:

- the attribution tables above (totals check out, the deltas equal the whole difference, gaps 0);
- the VM's instruction counts at `n = 12, seed = 8` from the emulator, before and after, and the exhaustive
  442-case agreement in `tests/typed/bytecode-vm.test.mjs`;
- instructions per corpus project under O2 and `speed`, before and after (50 projects, both JSON files committed);
- meaning: every pass's contract check in the sweeps (10 cases per pass), `node tools/parity.mjs`
  (`{"projects":50,"functions":135,"cases":8300,"decided":8286,"agree":8286,"inconclusive":14,"failures":0}`),
  `node tools/reference-check.mjs --o2`
  (`{"against":"our O2 images","functions":83,"decided":8286,"agree":8286,"inconclusive":14}`), and the suites
  `tests/typed` (155 tests), `tests/framework` (234), `tests/workbench` (25).

Argued, not measured:

- that the two-part check cannot increase the execution count in proportion to the trip count (the
  `count(D) ≥ count(iterations) ≥ count(entries) − early exits` argument). It rests on the natural-loop and
  dominator facts the pass reads from its input revision, not on a run;
- that "no regression in the other projects" holds: the corpus *totals* improved by 2.5% (O2) and 2.0% (`speed`),
  and two projects got slightly worse — stated above with their numbers. There is no per-project proof;
- the claim that the book's Blend numbers imply the guard must keep non-dominating hoists: measured as test
  failures, interpreted as a constraint.

## 7. What did not work (kept, because the next stage will hit the same walls)

- **Ablation as attribution.** Leaving one pass out tells you *which pass* (licm) but not which decision, and it
  cannot be reused for "why did this instruction cost 40 instructions".
- **Exit dominance as the guard.** Too strong for traps; broke Blend and `licm-nested`; the first corpus sweep
  (`scripts/corpus-after.json`) records the cost (O2 total 1,098,211 instead of 1,096,530 — the trap-hoisting loss,
  concentrated in `licm-nested`, `nested-loops`, `f32-dsp`).
- **Closure ("no exit reaches the head") instead of back-edge counting.** Refuses nested loops, whose exits reach
  the head through the outer loop.
- **A predictive cost model per decision, checked against the emulator.** Not built: predicting a decision's
  instruction count would be a second implementation of what the attribution measures, and the rule that fixes the
  bug needs no prediction. The tool *is* the cost measurement; the rule is the argument.

## 8. Later

- `licm-nested`'s +99: hoisting across a nest when the inner loop is certain to run (the inner latch of a loop whose
  entry is unconditional). That needs a trip-count or "runs at least once" fact; not built here.
- `typed.loops`/`cfg`: nine natural loops for one dispatch loop is the underlying shape problem. A loop tree (merge
  the back edges that share a head) would let `licm` see one loop and one preheader; that is a pass of its own.
- Pass-level versioning: typed passes all carry version `'1'`, and `licm`'s decisions changed. Bumping it would
  invalidate serialized strategy plans (`typed.licm@1`), so it is a separate change.
- `f32-dsp` reports one unattributed instruction (an image instruction covering an entity the head revision no
  longer holds); worth a look when the tool is next used in anger.
- The corpus projects' `notes.md` still show the pre-fix tables (bytecode-vm: "7,678 / 9,286"); the corpus is out of
  scope for this ticket.
- Profile-directed hoisting (feed the meaning check's case frequencies into a `licm` cost model) is now a small step
  from the tool, since the tool already maps instructions to decisions.
