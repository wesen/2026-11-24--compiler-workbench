# IRWB-034-D implementation diary

Ticket: `ttmp/2026/11/27/IRWB-034-D--d1-why-speed-makes-the-bytecode-vm-slower-instruction-attribution-and-a-fix/`
Stage: D1 (research and implementation, one session). Branch: `d1-ds-x-irwb-034-d` of the IR Workbench worktree.

## Step 1: Reading the records before writing any code

### Prompt Context
**User prompt (verbatim):** "D1: why `speed` makes the bytecode VM slower … Find the cause from the compiler's
own records, not by guessing … Then fix it in the compiler … The attribution is a tool, not a one-off … Make it a
function or tool other code can call, with a test."
**Assistant interpretation:** establish the cause from compiler records, build a reusable attribution tool, fix the
pass, measure, and write the design, report and scripts into a new ticket.
**Inferred user intent:** stop guessing about a regression; make the provenance machinery answer "which decision
cost these instructions", then use it to fix the decision rather than the pipeline.
**Commit (code):** `88fc3f8` — "IRWB-034-D: ticket, probes 01-03 and the design (attribution tool, licm cost check)"

### What I did
- Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`,
  `src/typed/strategies.ts`, `src/typed/passes.ts`, `ttmp/2026/11/26/IRWB-012--bytecode-vm/`, and
  `corpus/projects/bytecode-vm/`.
- Installed and built: `npm ci --prefer-offline` (node_modules is not shared between worktrees), `npm run build`.
- `scripts/01-reproduce.mjs`: reproduced 7,678 / 9,286 (fib) and 6,874 / 8,218 (checksum) at n = 12, seed = 8, and
  printed every executed instruction beside its `covers`.
- `scripts/02-ablation.mjs`: left one pass out at a time. `speed` without `licm` = 6,688 / 5,968 — better than r0.
- `scripts/03-licm-shape.mjs`: dumped the loops `licm` saw and the correspondence its hoists produced.

### Why
The ticket forbids guessing. `image.insns[].covers` names the `typed.blocks` statement each instruction implements,
each revision carries an `EntityCorrespondence`, and each entity carries an `origin` record. That is enough to
credit instructions to decisions; the ablation is only there to confirm which pass to look at.

### What worked
- `speed` publishes 7 revisions for the VM: `cfg fold cfg licm subst subst cfg`. `inline` does nothing (one
  function), so the ticket's guess list ("an inline, an unroll, a hoist…") narrows to one: a hoist.
- The hoisted instructions are visible: 13 `addi t, sp, 0|16` executed 172–184 times each, each with
  `covers=v:runVm.N,s:runVm.NNN` and the statement's origin note `hoisted out of loop:runVm@bb:runVm.3`.
- `typed.loops` finds **9 natural loops with the same head** `bb:runVm.3`, one per back edge created by `cfg`.
  `licm` created 9 preheaders and hoisted the opcode arms' address computations into them.

### What didn't work
- `01-reproduce.mjs` first failed with `TypeError: Cannot read properties of undefined (reading 'map')`:
  `lowerToImage(...).image` is an `Artifact<Rv32Image>` whose `.insns` is on `.value`. Fixed by unwrapping.

### What I learned
- The regression is not "LICM is bad": `licm` alone on r0 improves the VM (7,678 → 7,192). It is the *placement*:
  a preheader that runs on every dispatch replacing a computation that ran on 12 of them.

### What was tricky to build
- Telling "which pass" from "which decision". The origin record gives the pass (`via`), the revision and the note,
  which is what the attribution tool uses; the ablation alone would have stopped at the pass.

### What warrants a second pair of eyes
- Nothing yet; the fix is still a plan at this step.

### What should be done in the future
- Generalise the preheader construction: one logical loop with nine back edges is a CFG shape `licm` was not
  written for. A loop-tree pass would merge them; that is bigger than this ticket.

### Code review instructions
Run `node scripts/01-…`, `02-…`, `03-…` from the ticket directory.

### Technical details
`dist/typed/backend/run.ts::runImage` returns per-word `counts`; `heat()` attributes them to statements but not to
passes. The attribution tool adds the correspondence composition on top of the same `covers`.

## Step 2: The attribution tool

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** make the credit "instruction → decision" a callable function with a test, not a
one-off script.
**Inferred user intent:** the next stage ("missed optimizations from provenance") must reuse it.
**Commit (code):** see Step 4's commit (the tool, its test and the CLI landed together).

### What I did
- New `src/typed/attribution.ts`: `chainOf(host)`, `lineageOf(steps)` (composes the correspondences into a backward
  map per step, with `rootsOf`, `statementsOf`, `touchedBy`, `gaps`), `attributeRun(lineage, at, run)`,
  `deltaBetween(base, next)`, `deltaByPass(deltas)`.
- `scripts/04-attribution.mjs` prints the table for a project end to end.

### Why
A `Credit` needs three things the records already hold: the statement, the pass whose origin record placed it, and
the r0 statements it descends from. For a *retained* statement whose cost changed (`cfg` retargeting a branch), the
origin is still the front end's, so the tool also reads the last edit record that named the statement
(`Credit.touchedBy`, matched against an allow-list of changing edit kinds) — that is what turns "+184 at
`s:runVm.11`" into `cfg` instead of `source`.

### What worked
- Totals are checked, not assumed: for both fixtures the credits sum to `run.steps` exactly (7,678 / 9,286 before the
  fix), and the deltas sum to `head − r0` (1,608 and 1,344). `lineage.gaps === 0`.
- The table before the fix: `instructions by pass at the head: source 6538, licm 2748`; `delta by pass:
  licm +2555, fold −368, cfg −232, subst −184, source −163`. The 15 licm rows are the 15 hoisted `inv` temps,
  each +172/+184 per fixture.
- Mapping a root that is an r0 *value* to the statement that computes it (`statementsOf`) was necessary: without it
  the delta rows keyed on values and never paired with the use-site rows.

### What didn't work
- First version keyed delta rows by "roots" that could be value ids, so a hoist's +184 and the use site's −36 never
  met. Fixed by normalising roots to r0 statements.
- A removed statement has no credit at the head, so its instructions were credited to `source`. Added
  `Attribution.gone` (the last edit record naming a statement that is no longer there) so `fold`, `subst` and `cfg`
  get their removals. One row (183 instructions of the VM's fib run: `s:runVm.139`) is still credited to the front
  end: that block was dropped by `commit`'s reachability pruning, not by a recorded edit. Reported, not hidden.

### What I learned
- The delta table is what makes the attribution answer the ticket's question; the absolute table alone would show
  "licm holds 2,748 instructions" without saying whether that is good or bad.

### What was tricky to build
- Compose-only-from-the-right-direction: the chain's correspondence maps *after → before*, so tracing a final
  statement back is a single backward walk, and a split (one value → a hoisted `set` plus a new `get`) arrives as one
  entry with several `to` ids.

### What warrants a second pair of eyes
- `deltaBetween` splits a credit with several roots evenly (integer shares with the remainder on the first roots).
  That keeps the sum exact but is arbitrary for merges; on the corpus the VM has none.

### What should be done in the future
- `f32-dsp` reports `unattributed: 1` for the first generated case; worth finding out which instruction covers an
  entity the head revision no longer holds.

### Code review instructions
`src/typed/attribution.ts`, `tests/typed/attribution.test.mjs`, `tools/attribution.mjs`;
`node --test --test-isolation=none tests/typed/attribution.test.mjs`.

### Technical details
`attributeRun` reads `run.counts[offset >>> 2]`, keys by `covers.find(c => c.startsWith('s:')) ?? covers[0]`, and
falls back to a function bucket (`fn:runVm`) for prologue/epilogue instructions, so the frame changes show up too.

## Step 3: The guard, and the tests that said "too strong"

### Prompt Context
**User prompt (verbatim):** see Step 1 ("Then fix it in the compiler: a guard, a cost check, or a better decision").
**Assistant interpretation:** refuse the hoists that can cost more than they save.
**Inferred user intent:** the bytecode VM at or below r0 under `speed`, no regression elsewhere, parity clean.

### What I did
- `src/typed/passes.ts::licm`: `needs` gains the dominators analysis, the preheader is created lazily (only when a
  hoist survives), each refused hoist records `tx.record('skip', {stmt, value, block, why})`.
- First rule: hoist only when the defining block dominates **every exit** of the loop.
- Ran `tests/typed/*`, `tests/framework/*`, `tests/workbench/*`.

### Why
The count argument: a preheader executes once per *entry*, the definition once per *iteration*; exit dominance gives
`count(D) ≥ count(entries)`, so the hoist can never lose.

### What worked
- The bytecode VM: `speed` 9,286 / 8,218 → **6,688 / 5,968** (r0 is 7,678 / 6,874), `licm` credits 0 instructions,
  15 distinct values refused. `node --test tests/typed/bytecode-vm.test.mjs` passes.

### What didn't work
- Ten typed tests failed, all about **Blend** and one about `licm-nested`:
  `P2.6: after O2 the images match the book: Blend 88 bytes / 451` → `448 !== 370`;
  `strategies: chooseBest picks O2 for Blend` → the winning chain lost `licm`;
  and the sweep showed `licm-nested 1678 → 2677` (i.e. back to r0) and `nested-loops +292`, `f32-dsp +280`.
  Exit dominance also demands dominating the *trap* and *return* exits, and every Typed loop has a bounds-check trap
  inside it, so the guard refuses exactly the hoists the book's examples are about.

### What I learned
- The book's O2 numbers for Blend (88 bytes / 451 instructions) are pinned by `tests/typed/backend.test.mjs`; a fixed
  pass must keep them. The guard has to distinguish the VM's defect from a normal hoist, not forbid hoisting.

### What was tricky to build
- Naming the defect: an exit that jumps back to the head is another back edge, i.e. the "loop" is one of several
  natural loops sharing a head, and its preheader runs once per **re-entry**. Ten of eleven failing tests recovered
  once the rule became "the head has a single back edge", the eleventh (`licm-nested`) still failed, because a
  nested loop's exit does reach its head (through the outer loop) and re-entry there is a real entry.

### What warrants a second pair of eyes
- Whether the two-part rule (single back edge, definition dominates the latch) is the right invariant, or whether
  `typed.loops` should not report nine loops for one dispatch loop in the first place.

### What should be done in the future
- Hoisting across a loop nest (`a * b + 7` invariant in both loops of `licm-nested`) now stops at the inner
  preheader: +99 instructions on that project. A rule that hoists to the outer preheader when the inner loop is
  certain to run would recover it; see the report's "Later" list.

### Code review instructions
`src/typed/passes.ts` (function `licm`), `tests/typed/backend.test.mjs`, `tests/typed/speed.test.mjs`,
`tests/workbench/strategies.test.mjs` (one expectation updated: `licm.needs` now includes `dom: typed.dominators@1`).

### Technical details
The back-edge count is taken from the pass's **input** graph (`f.blocks[].succ` before any retargeting), because the
hoists themselves change the head's predecessors and would hide the defect from later loops of the same head.

## Step 4: Measurement, tests and the corpus

### Prompt Context
**User prompt (verbatim):** see Step 1 ("Measure and report: the attribution … the fix … instructions per corpus
project under O2 and `speed`, before and after").
**Assistant interpretation:** measure everything the report claims; argue only what cannot be measured.
**Inferred user intent:** numbers a reviewer can reproduce, and a record of which claims are argued.

### What I did
- `scripts/05-corpus.mjs`: 50 projects × {O2, speed} × the pipeline's own meaning checks (10 cases per pass),
  instructions measured with `strategies.measure` (10 generated cases per function, seed 7). Ran it **before**
  (`scripts/corpus-before.json`) and twice after (`corpus-after.json` with the first rule, `corpus-after2.json` with
  the final one).
- `scripts/06-compare.mjs`: the before/after table and the regression flags.
- `node tools/parity.mjs`, `node tools/reference-check.mjs --o2`, `node tools/build-site.mjs`,
  `tests/typed/*.test.mjs` (155), `tests/framework/*.test.mjs` (234), `tests/workbench/*.test.mjs` (25).
- New `tools/attribution.mjs` (the CLI for the tool) and `tests/typed/attribution.test.mjs` (4 tests).

### Why
The ticket asks for per-project numbers under both pipelines before and after, and for parity. The corpus sweep is
the only way to see whether a conservative rule costs anything elsewhere.

### What worked
- Totals: r0 1,123,009 (unchanged, as it must be); O2 1,124,912 → **1,096,530** (−28,382, −2.5%);
  speed 892,944 → **875,117** (−17,827, −2.0%). bytecode-vm O2 and speed 47,076 → 33,965 (−27.9%), below r0's 39,954.
  Projects where O2 or speed exceeds r0 after the fix: `div-magic` and `sha-chacha` (O2), both already there before
  and both unrelated to `licm`. No pass was rejected in any project.
- All suites green; the site builds (the attribution module is not imported by the bundle, but `passes.ts` is).

### What didn't work
- Two projects regress under the final rule: `licm-nested` 1,678 → 1,777 (+99, +5.9%, still 33% under r0) and
  `lz-roundtrip` under `speed` 28,925 → 29,284 (+359, +1.2%, still 13% under r0).
- The first corpus sweep (the exit-dominance rule) is kept in the ticket as `corpus-after.json` because it shows what
  the too-strong rule cost: `licm-nested` back to r0, `nested-loops` +292, `f32-dsp` +280.

### What I learned
- A 5-minute corpus sweep is cheap enough to run per candidate rule; the two-rule design came out of it, not out of
  reasoning about the tests.

### What was tricky to build
- Keeping the sweeps honest: the first before-sweep ran while I edited `src/`, so `npm run build` had to wait for it
  (a running Node process keeps the modules it imported, but a rebuild mid-run is not a risk worth taking).

### What warrants a second pair of eyes
- Whether `lz-roundtrip`'s `speed` regression (+359 with O2 −5,722) is the same "nested/inline shape" effect, and
  whether recovering `licm-nested` (+99) is worth a third rule.

### What should be done in the future
- See the report's "Later" list: loop-tree/back-edge merging in `typed.loops` or `cfg`; hoisting across nests;
  profile-directed hoisting; the corpus projects' `notes.md` tables still show the pre-fix numbers (out of scope
  here: the corpus is not to be changed).

### Code review instructions
Re-run the sweeps with `node scripts/05-corpus.mjs --count 10 --out …` (about 7 minutes before the fix, 1.5 after),
compare with `node scripts/06-compare.mjs`, and read `scripts/corpus-before.json` / `scripts/corpus-after2.json`.

### Technical details
The corpus totals are dominated by chess-search and sha-chacha; the percentages above are over 50 projects,
1.12M / 0.89M instructions, 10 generated cases per function.
