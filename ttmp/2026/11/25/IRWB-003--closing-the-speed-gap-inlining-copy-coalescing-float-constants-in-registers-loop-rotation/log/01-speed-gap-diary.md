---
Title: Speed gap diary (IRWB-003)
Ticket: IRWB-003
Status: active
Topics:
    - compiler
    - ir
    - candela
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of IRWB-003, closing the measured speed gap to the reference compiler with inlining, copy coalescing, constants in registers and loop rotation.
LastUpdated: 2026-11-25T23:30:00-05:00
WhatFor: Reconstructing what was done, measured and decided, and why.
WhenToUse: Before resuming or reviewing IRWB-003.
---

# Speed gap diary (IRWB-003)

## Step 1: Read the brief, the guides and the code; record the frozen baselines

This step loaded the skills, read everything the brief names, read the code that the four items touch, and recorded the baselines that must stay identical at the end. Nothing was changed in the code. The four baselines are green and saved in `various/`, and a probe script reproduces the benchmark table exactly.

### Prompt Context
**User prompt (verbatim):** "ask subagents to always commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). When a milestone is finished, write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill). [...] For each, create a ticket and design doc (if you don't have already) Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Then implement"
**Assistant interpretation:** The coordinator assigned me milestone IRWB-003 (the speed gap): write an intern guide in the ticket, upload it, implement inlining (E3), copy coalescing (H2), f32 constants in registers and loop rotation (G1) behind a new pipeline and new default-off backend options, measure against the reference compiler on the corpus and Candela, keep a detailed diary, commit at working increments, and write a vault report that the coordinator commits.
**Inferred user intent:** Close the measured instruction gap to the reference compiler without changing anything the book's numbers depend on, with every new transformation checked by the meaning contract and traceable by `why`.
**Commit (code):** none in this step.

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`.
- Read the IRWB-002 intern guide: Part 1 (sections 1–17), items E3, G1, H2, the roadmap and the glossary; IRWB-001 design-doc 05 §9; IRWB-001 diary steps 18–29; the f32 backend agent's diary steps 8–10.
- Read the code: `src/typed/model.ts`, `src/typed/tx.ts`, `src/typed/passes.ts` (typedPass, dfe, licm, lvn, subst, PASSES, PIPELINES), `src/typed/program.ts` (apply, pipeline, why), `src/typed/evaluate.ts` (evaluate, meaningKept), `src/typed/analyses.ts` (isPure, loops, liveness), `src/typed/ir.ts` (validator, projection), `src/typed/backend/{select,regalloc,compile,options,image}.ts`, `src/typed/ilp32f.ts`, `src/typed/reference.ts`, `src/typed/strategies.ts`, the workbench's option and pipeline code (`site-src/views.js`, `site-src/main.js`, `src/workbench/workbench.ts`), and IRWB-001 scripts 08 and 13.
- Built (`npm run build`) at 420d8e1 and recorded the baselines:
  - `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs > various/01-baseline-corpus-revisions.txt` (44 lines, 10.7 s);
  - `npm test > various/02-baseline-npm-test.txt`;
  - `node tools/parity.mjs > various/03-baseline-parity.txt`;
  - `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs > various/04-baseline-irwb-full.txt`.
- Wrote `scripts/01-benchmark-probe.mjs`: the benchmarks of `tests/typed/backend.test.mjs` "P2.6: the book's table" with a pipeline and backend options as arguments, and the listing and machine code of chosen functions.
- Wrote `scripts/02-candela-shapes.mjs`: per Candela function at r0, statements, calls, call sites, record results, frame arrays, recursion → `various/05-candela-r0-call-shapes.json`.

### Why
- The freeze is checked by diffing at the end, so the baselines have to be taken before the first edit, on the exact commit the branch starts from.
- The guide's design has to rest on the IR's real shapes, so I measured where Candela's calls sit before deciding how general the inliner must be.

### What worked
- `npm test`: `tests 325`, `pass 322`, `fail 0`, `skipped 3`, 62.2 s.
- `tools/parity.mjs`: `{"projects":44,"functions":70,"cases":7000,"decided":6986,"agree":6986,"inconclusive":14,"failures":0}`.
- IRWB_FULL: `tests 21`, `pass 21`, 21.7 s.
- The probe at O2 reproduces the table exactly:

  | benchmark | r0 | ours | ref | bytes |
  |---|---:|---:|---:|---:|
  | blend | 531 | 451 | 383 | 88 |
  | checksum | 446 | 366 | 292 | 52 |
  | sort | 2022 | 2022 | 1533 | 240 |
  | collatz | 1590 | 1590 | 1486 | 88 |
  | value-numbering | 690 | 570 | 695 | 92 |

- Candela at r0: `{"fns":332,"calls":918,"rootCalls":918,"nestedCalls":0,"recordResultFns":180,"frameArrayFns":2,"selfRecursive":[],"singleSite":220,"smallLeaves":95}`. Every call is the whole value of a `set`, `eval` or `return`.

### What didn't work
- `T=ttmp/2026/11/25/IRWB-003*; cat $T/index.md`: zsh does not expand a glob in an assignment (`No such file or directory`). Used `$(ls …)` or the full path.
- A first `npm run build && … git rev-parse HEAD` in one command was refused by the worktree guard ("names git in a form too complex to verify"); git now runs as its own command.

### What I learned
- **Blend's loop costs 11 instructions per iteration at O2** (from the probe's machine code): the head's `blt`, the copy `t7 = i`, the capacity `lw`, the `bltu`, six for the body (`slli add lhu mul add addi`), and the `jal` back to the head. 40 × 11 + 11 = 451.
- **The image records its options** (`compile.ts:409`, `options: o`), and the validator requires exactly the keys of `backendDefaults` (`image.ts:171–172`). A new key in `backendDefaults` would change every image revision, so new options need their own defaults table and must be left out of the image when they are off.
- **Tail-duplicating a loop header is valid whatever its condition reads**: each predecessor that jumped to the header now runs the copy at the same point of the execution, once. Purity matters only if a transformation changes how many times the condition runs.
- **The evaluator gives every call fresh locals** (`evaluate.ts:366`, `new Int32Array`), so an inlined callee's locals that are read before written must be set to zero where the inlined body starts.
- **`result#k` reads "the latest multi-result call in this frame"** (`evaluate.ts:394`), and the backend requires it in the call's block before the next call (`select.ts:392`). Splitting a block at a call must not separate a leaf read from its call.
- **Workbench enumerations are tests**: `tests/workbench/strategies.test.mjs:106` (13 passes) and `:112` (the pipeline names) will change when `inline`, `rotate` and `O3` are added.

### What was tricky to build
- Nothing was built in this step.

### What warrants a second pair of eyes
- The claim that frozen means "identical revisions and green suites", not "no test file changes": two enumeration assertions must grow by the new names.

### What should be done in the future
- Write the intern guide (next step), then implement in the order coalescing, rotation and layout, constants, inlining, each with tests and a commit.

### Code review instructions
- `node ttmp/2026/11/25/IRWB-003--…/scripts/01-benchmark-probe.mjs --show blend` prints the table and Blend's code.

### Technical details
- Baselines were taken on 420d8e11988fa12a80bc7b84019ec27ebac0f625 with `dist/` built from it.

## Step 2: The intern guide: a draft, a second reading, a revision, the upload

This step wrote the intern guide as `design-doc/01-intern-guide-…md` (docmgr design-doc), reread it as its reader, wrote review notes, revised it, and uploaded it to reMarkable. The second reading found that the draft's worked example of the block layout did not follow from its own algorithm, and that rotation of a header whose two targets are both inside the loop makes the loop irreducible; both changed the design, not only the prose.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** An intern-level analysis, design and implementation guide in the ticket, with prose, bullets, pseudocode, diagrams, API and file references; a second pass; the upload.
**Inferred user intent:** Someone new can understand the parts of the system involved and implement or review the milestone from the guide alone.
**Commit (code):** this step's commit (documentation and scripts only).

### What I did
- `docmgr doc add --ticket IRWB-003 --doc-type design-doc --title "Intern guide: closing the speed gap with inlining, copy coalescing, constants in registers and loop rotation"`.
- First draft: Part 1 (the IR, passes, Tx, the contract, the backend's selection, allocation, finish, ilp32f, images, measurements, Candela per-scene programs), Part 2 (Blend instruction by instruction; sort, Collatz, Candela), Part 3 (designs), Part 4 (order of work, validation, risks, reference).
- `scripts/03-candela-gap-totals.mjs` on IRWB-001's `f32-backend-01-candela-images.tsv` → `various/07-candela-o2-gap-totals.txt`.
- Review notes before revising (comprehension gaps first):
  1. The layout example (§11.1 of the draft) did not follow from its algorithm: with `weight = min(freq(b), freq(s))` and position tie-breaks, `bb.0 → bb.2` is linked before `bb.0 → bb.3` and the latch ends next to the trap block.
  2. The rotation rules assumed the header's test is an exit test. In Collatz and sort's inner loop both targets are inside the loop; the reader would ask whether duplication is still legal.
  3. Two notions of "hot": natural-loop depth for the estimate, another weighting for the layout.
  4. "latch", "preheader", "guard" used before definition.
  5. Collatz's `3` is built only on odd iterations.
  6. "about half of the total gap" was imprecise.
  7. O3 could be read as containing `dfe`, which refuses without roots.
  8. Evaluator line numbers off by two or three.
- Revised: Part 3 rewritten and spliced in with `scripts/04-splice-section.mjs`; new §11 "Block frequencies and the cost estimate" (SCC-based branch probabilities, frequencies by propagation) used by layout, coalescing, homes and the estimate; new §10.3 on non-exit headers; definitions in §10.1; corrected numbers and line references; cross-references renumbered with `sed`.
- `docmgr doc relate` with seven files; `docmgr task add` for eleven tasks.
- `remarquee upload bundle <guide> --name "IRWB-003 Intern Guide: Closing the Speed Gap" --remote-dir "/ai/2026/11/25/IRWB-003" --toc-depth 2 --non-interactive`.

### Why
- The layout algorithm is the piece that turns rotation into fewer instructions, so its worked example has to be executable by hand; a wrong example would send an implementer after a wrong algorithm.
- Allowing rotation of non-exit headers is what lets Collatz and sort's inner loop gain at all; the cost is irreducibility, which the guide must justify (`solver.ts:63`: widening at retreating-edge targets).

### What worked
- `OK: uploaded IRWB-003 Intern Guide: Closing the Speed Gap.pdf -> /ai/2026/11/25/IRWB-003`.
- `remarquee cloud ls /ai/2026/11/25/IRWB-003 --long` → `[f]	IRWB-003 Intern Guide: Closing the Speed Gap`.
- Gap totals: `{"net":4043187,"positive":5307267,"negative":-1264080}`; `fbm3` 1,816,438 and `cdlRenderSpan` 870,470, together 50.6% of the positive gaps.

### What didn't work
- A `python3 - <<'EOF'` heredoc was refused by the worktree guard ("too complex to verify"); I wrote the computation as `scripts/03-candela-gap-totals.mjs` instead.
- The first run of script 03 counted the TSV's `TOTAL` row as a function (`net` 8,087,148, twice the real one); it now skips that row.

### What I learned
- With weights from block frequencies times branch probabilities, rotated Blend lays out as `bb.0, bb.3, bb.7, bb.2, bb.4`, which makes the latch's back edge the taken branch: an estimated 10 instructions per iteration instead of 11.
- Every cycle of a CFG contains a retreating edge of any depth-first search, so the solver's widening (at retreating-edge targets) still terminates on irreducible loops.

### What was tricky to build
- Keeping the guide's numbers apart: measured (with a source), derived by counting (labelled estimates), and proposed.

### What warrants a second pair of eyes
- The guide's predictions (Blend 371, Checksum 286) are counts from listings, not measurements; Part 4 measures them.

### What should be done in the future
- After implementation, add an "Outcomes" section with the measured numbers and the departures from this design.

### Code review instructions
- Read the guide's Part 3; the worked layout example in §12.1 can be checked by hand against §11.

### Technical details
- Guide: ~700 lines; ToC depth 2 in the PDF.

## Step 3: Options plumbing that leaves every default image as it was

This step added the three new backend options without touching `backendDefaults`. An image records its options, and its validator requires exactly the keys of `backendDefaults`, so the new booleans live in a second table and appear in an image only when they differ from their defaults; `layout` got its second value. The corpus revisions are identical after the change.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** New behaviour behind default-off options; the frozen images must not change.
**Inferred user intent:** The book's numbers stay reproducible while the new options are measured.
**Commit (code):** the commit of Step 6.

### What I did
- `src/typed/backend/options.ts`: `BackendOptions.layout: 'source' | 'loops'`, optional `coalesce` and `homes`; `backendExtras = { coalesce: false, homes: false }`; `checkBackendOptions` accepts both tables' names, validates the extras as booleans, and deletes an extra that equals its default; `layout` accepts `'loops'`; `diffOptions` compares against both tables.
- `src/typed/backend/image.ts`: the validator allows the extras' keys.
- `src/typed/backend/index.ts`: exports `backendExtras`.
- `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs | diff - various/01-baseline-corpus-revisions.txt`.

### Why
- Adding `coalesce: false` to `backendDefaults` would put the key into every image's `options`, change every image revision, and break the freeze (`compile.ts:409`, `image.ts:171–172`).

### What worked
- `npx tsc` clean; the diff printed nothing (`IDENTICAL`).

### What didn't work
- Applying the edits with a Node script fed by a heredoc, in the same command as a `git diff`, was refused by the worktree guard ("this command is too complex to verify that it stays inside the worktree"). I made the edits with the Edit tool.

### What I learned
- The validator's "exactly these keys" rule makes an option set part of an image's identity; the extras keep that property for options that are on.

### What was tricky to build
- `checkBackendOptions` returns a frozen object that is also stored in the image; deleting extras at their default before freezing keeps the object identical to the old one, key for key.

### What warrants a second pair of eyes
- `diffOptions` now merges both tables per entry; it is used for labels only.

### What should be done in the future
- N/A.

### Code review instructions
- `src/typed/backend/options.ts` (`backendExtras`, `checkBackendOptions`); the test `IRWB-003 options` in `tests/typed/speed.test.mjs`.

### Technical details
- An image compiled with `{ coalesce: false }` has the same revision as one compiled with `{}` (asserted in the test).

## Step 4: Block frequencies and the layout; the first corpus measurement makes strings slower

This step built `src/typed/backend/frequency.ts` (branch probabilities from strongly connected components, frequencies by sweeps, the cost estimate) and `src/typed/backend/layout.ts` (chains by weight), hooked the layout into `select`, and wrote `scripts/05-corpus-options.mjs`, which checks a pipeline and options on the whole corpus against r0. The layout alone, without rotation, made 18 projects faster and 6 slower, `strings` by 7%. The cause was the tie-break; Step 5 fixes it and decides the layout per function by the estimate.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** G1's block layout, as the guide's §11–12 design it.
**Inferred user intent:** See Step 1.
**Commit (code):** the commit of Step 6.

### What I did
- `frequency.ts`: `targetsOf`; Tarjan's SCCs, iterative; `blockFrequencies(st, f)` (a target ending in `trap` gets 0; stay 0.88 against leave 0.12; enter 0.88; otherwise 0.5; Gauss-Seidel sweeps in reverse postorder, at most 200, tolerance 1e-9, cap 1e9); `estimateCost(code, fr)`.
- `layout.ts`: `layoutBlocks(st, f, fr)`.
- `select.ts`: `order` from `layoutBlocks` under `layout: 'loops'`; `const b = st.get(bid)` in place of `f.blocks[k]` (the same object in source order); a `j succ[0]` for a block without a terminator whose successor is not next, under `'loops'` only.
- `scripts/05-corpus-options.mjs`: per project, the head after a pipeline, lowered with the options, run against the evaluator of **r0** on 100 cases per function, so that the passes and the backend are checked in one comparison; instructions summed over the decided cases; `--base` for a second pipeline with default options.
- `node scripts/05-corpus-options.mjs --pipeline O2 --options '{"layout":"loops"}' --base O2 --json various/08-corpus-o2-layout-loops.json` (29 s).

### Why
- The layout is what turns rotation into fewer instructions; measuring it alone first separates its effect from rotation's.

### What worked
- Revisions under the default options: identical.
- `{"instructions":901925,"bytes":5164,"agree":6986,"decided":6986,"inconclusive":14,"disagree":0,"base":{"instructions":910718,"bytes":5160},"faster":18,"slower":["calls +158","div-checks +196","div-magic +8","histogram +519","ramp +47","strings +7670"]}`.
- Collatz's benchmark fell from 1,590 to 1,370 with the layout alone.

### What didn't work
- `strings` +7,670 instructions. Its `||` chains are 50/50 branches for the heuristic, and ties were broken by the IR position of the target. That picked the rare `t5 = 1` block as the fall-through of each test and left the common path (`t5 = (c == 101)`) ending in a `jal` (both codes printed by `scripts/06-variant-probe.mjs strings --options '{"layout":"loops"}' --code`).

### What I learned
- With no profile, a tie in the static weights carries no information, and the IR's own order is the better default: the lifter puts the evaluation of the next operand of `||` right after its test.

### What was tricky to build
- The iterative Tarjan: the parent's low-link is updated after the child is popped, from the child's final low-link.

### What warrants a second pair of eyes
- The layout's comparator treats weights within a relative 1e-9 as equal. Such a comparator is not transitive, but it is deterministic for a given input.

### What should be done in the future
- Done in Step 5: ties prefer the IR's fall-through, and the layout is chosen per function by the estimate.

### Code review instructions
- `src/typed/backend/frequency.ts`, `src/typed/backend/layout.ts`; the `order` lines in `select.ts`.

### Technical details
- Output: `various/08-corpus-o2-layout-loops.json`.

## Step 5: Coalescing, constant homes, and the choice per function by the estimate

This step built copy coalescing (`src/typed/backend/coalesce.ts`) and constant homes (two hooks in `select`), and a chooser (`src/typed/backend/variants.ts`) that compiles a function plainly and then with each requested option on top of the best so far, keeping a variant only when its estimated cost is lower. The layout's ties now prefer the IR's own fall-through. Under the default options the backend still compiles each function once, exactly as before. On the benchmarks each option alone and all three together agree with the evaluator; coalescing alone takes Blend from 451 to 411 and sort from 2,022 to 1,887.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** H2 (coalescing) and f32 constants in registers, "when registers allow".
**Inferred user intent:** See Step 1.
**Commit (code):** the commit of Step 6.

### What I did
- `coalesce.ts`: liveness per machine block, then per instruction; interference edges between virtual registers of one class (a definition interferes with everything live after it, except the source of a copy); candidates are virtual-to-virtual `mv` copies, hottest block first; union-find with member lists and the lower register as representative; renaming; copies that became `r <- r` dropped; hints and `localReg` renamed.
- `select.ts`: `SelectContext.homes` (keys `f:<bits>`, `x:<value>`) and `onConst(key, block, value)`; one register per home, defined after the entry's parameter copies and zeroing (`li`, and `fmv.w.x` for f32, with `why: 'constant home'`); `val(const)` returns the home, or for an f32 copies it into the target; for i32 only when no target is given and no immediate form applied.
- `variants.ts`: `chooseVariant(st, f, o, compile)`: plain (source layout), then `'loops'`, then `coalesce`, then `homes` (a recording selection first; the keys whose block frequencies add up to more than 1). A variant is kept if its estimate is lower by more than 1e-9.
- `compile.ts`: `compileFunction` builds one `once(opts, hooks)` closure; with the defaults it calls it once, otherwise `chooseVariant`; `FnCompilation.choice`; `variantChoices(blocks, options)` exported for scripts and tests.
- `layout.ts`: among equal weights, the edge to the IR's next block first.
- `scripts/06-variant-probe.mjs`: per function the choice, the estimates, the frequencies, the order, and the code.

### Why
- Linear scan with whole intervals can lose when two intervals merge or a home lives across calls; comparing finished code per function makes every option a non-loss by the estimate.
- The tie-break restores the IR's order where the estimate has no preference (Step 4).

### What worked
- Benchmarks after O2 (`scripts/01-benchmark-probe.mjs --options …`), every result `same`:

  | options | blend | checksum | sort | collatz | value-numbering |
  |---|---:|---:|---:|---:|---:|
  | none | 451 | 366 | 2022 | 1590 | 570 |
  | layout loops | 450 | 366 | 1977 | 1480 | 569 |
  | coalesce | 411 | 326 | 1887 | 1590 | 570 |
  | homes | 451 | 366 | 2022 | 1329 | 492 |
  | all three | 410 | 326 | 1842 | 1219 | 491 |

- Revisions under the default options: identical.

### What didn't work
- Collatz under `'loops'` went from 1,370 (Step 4) to 1,480. The probe shows why: the estimate chose `'loops'` (100.2 against 106.5 for the source order), but the heuristic rates `x > 1` 50/50, so the chains make the rare `t3 = 0` block the guard's fall-through. Step 4's 1,370 came from a tie that happened to favour the hot side. Both orders are correct; the static probabilities are the limit.

### What I learned
- Collatz's real exit test is `if !(t3)`, one block after its header, because the `&&` is lifted through a temporary assigned in two blocks. Jump threading over the constant `t3 = 0` would make the header an exit test; it is not part of this milestone's design.

### What was tricky to build
- A home must not be written by anything but its definition. The selector never writes a register that `val` returned (it already returns locals' registers directly), so returning a home is safe.
- The recording selection for homes runs with the layout and coalescing already chosen, so the counted uses are those of the final code.

### What warrants a second pair of eyes
- `coalesce.ts` treats only `rs1` and `rs2` as uses and `rd` as the definition (`usesOf` and `defsOf` of `regalloc.ts`); an instruction that read `rd` implicitly would break that, and the selector emits none.

### What should be done in the future
- Measure on Candela (f32 constants, licm and lvn copies), which the options were designed for.

### Code review instructions
- `src/typed/backend/{coalesce,variants}.ts`; `select.ts` (`homeReg`, `onConst`); `compile.ts` (`compileFunction`).

### Technical details
- `variantChoices(blocks, options)` returns `{ layout, coalesce, homes, cost: { plain, chosen } }` per function, or `null` under the defaults.

## Step 6: The rotate pass, the tests, and the corpus under O2+, rotate, cfg with every option

This step wrote `rotate` (`src/typed/rotate.ts`), registered it, wrote `tests/typed/speed.test.mjs`, and measured the corpus. Blend reaches 370 and Checksum 286, against the reference compiler's 383 and 292. Over the whole corpus, with O2+, `rotate` and `cfg` and all three options, instructions fall by 15.7% against O2, no project is slower, and every decided case agrees with r0.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** G1 loop rotation (the guide's §10).
**Inferred user intent:** See Step 1.
**Commit (code):** this step's commit.

### What I did
- `src/typed/rotate.ts`: `rotateSpec`, a `TypedPassSpec` (needs `loops`; writes `stmts`, `values`, `cfg`). A header that is only a `br_if` whose condition has no `call` or `result` is copied, with fresh value ids, origin from the header's test and `because: [loop id, header]`, into every block that ends in `br header`.
- `src/typed/passes.ts`: `import { rotateSpec } from './rotate.js'`; `export const rotate = typedPass(rotateSpec)`; `rotate` in `PASSES`.
- `tests/typed/speed.test.mjs`, 8 tests: the options; frequencies and layout on rotated Blend (`bb.3` = 0.88/0.12, the order, `blt t1, a1, bb.3`, no `jal zero`, 410); coalescing (one copy fewer, 370); homes on Collatz (`x:1`, `x:2`, `x:3`, 1,329); rotate on Blend (header gone, two copies, `why` to `s:blend.4` and line 4, `whyChain` relation `rotate`); rotate on Collatz (two-entry loop: the `loops` fact is empty, `strength` still runs, the image agrees); the benchmarks under everything; a corpus-wide test under `IRWB_FULL=1`.
- `tests/workbench/strategies.test.mjs`: 13 → 14 passes, and `rotate`'s source is `src/typed/rotate.ts`.
- `scripts/05-corpus-options.mjs --pipeline '[…O2+…, "rotate", "cfg"]' --options '{"layout":"loops","coalesce":true,"homes":true}' --base O2 --json various/09-corpus-o2plus-rotate-all-options.json`.

### Why
- `rotate.ts` exports a spec instead of calling `typedPass` itself: `passes.ts` imports it to register it, and `typedPass` reads `ENTITY_WRITES`, a `const` of `passes.ts` that is still uninitialized while `rotate.ts` loads inside that import.

### What worked
- `node --test tests/typed/speed.test.mjs`: 8 of 8; with `IRWB_FULL=1`: 8 of 8, the corpus test 28.7 s.
- Corpus: `{"instructions":767343,"bytes":4976,"agree":6986,"decided":6986,"inconclusive":14,"disagree":0,"rejected":[],"base":{"instructions":910718,"bytes":5160},"faster":36,"slower":[]}`.
- Benchmarks (probe), O2+ then rotate and cfg: Blend 410 with the layout alone, 370 with all three options; Checksum 286; sort 1,959 with the layout alone.
- `p.apply('rotate')` on Blend after O2+: `{"edits":3,"kinds":{"replaceStmt":2,"unreachable":1},"check":"40/40"}`.

### What didn't work
- The first `rotate.ts` called `typedPass` at load time and imported a helper module that did not exist; I rewrote it before the first build, as described under Why.
- `01-benchmark-probe.mjs --pipeline '[…]'` failed with `[unknownPipeline] no pipeline "[…]"` (the list was passed as a name); scripts 01, 05 and 06 now parse a JSON list.

### What I learned
- After rotating Collatz's non-exit header, `p.fact('loops')` is `[]`, and `strength`, which needs the interval analysis, still runs: the solver's widening at retreating edges covers the irreducible cycle.

### What was tricky to build
- `tx.replaceStmt` takes `from` from its options when one is given, so the copy's origin names the header's test (`s:blend.4`) rather than the replaced `br`; that is what lets `why` reach the loop test's source line.

### What warrants a second pair of eyes
- A replaced `br` gets no correspondence entry of its own, as with `cfg`'s `replaceStmt`; `makeCorrespondence` completes it as removed.

### What should be done in the future
- The inline pass and O3; then Candela.

### Code review instructions
- `src/typed/rotate.ts`; `node --test tests/typed/speed.test.mjs`; `IRWB_FULL=1 node --test tests/typed/speed.test.mjs`.

### Technical details
- A header shared by several back edges is processed once (`done`).

## Step 7: A frozen test pins `layout: 'source'`; the block order becomes its own option, `chains`

The full suite failed once after Step 6, in a frozen test: `tests/typed/backend.test.mjs:294` asserts that `{ layout: 'loops' }` is refused. Extending `layout` with a second value, as the guide designed, would have meant editing a test the freeze protects. I left `layout` exactly as it was and made the frequency-based block order a third extra option, `chains`. After the rename the full suite passes and the corpus revisions are identical. Steps 4–6 above say `layout: 'loops'`; they describe what was built at the time, and the measurements in them are unchanged by the rename.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** `npm test` must stay green and identical; prefer not to edit frozen tests.
**Inferred user intent:** The book's behaviour, including which options the backend refuses, stays as it was.
**Commit (code):** this step's commit.

### What I did
- `npm test` → `✖ P2.4: options are validated with the prototype's codes`; the test's line 294 is `refuse({ layout: 'loops' }, 'badArgument', /layout is 'source'/)`.
- `options.ts`: `layout` back to `'source'` only, with its old message; `backendExtras = { chains: false, coalesce: false, homes: false }`; `chains` validated like the other extras.
- `select.ts` (`const loops = o.chains === true`), `variants.ts` (`chains` in place of the layout value; `VariantChoice.chains`), `compile.ts` (`if (!o.chains && !o.coalesce && !o.homes) return once(o, {})`).
- `tests/typed/speed.test.mjs`: `chains: true` everywhere; `{ layout: 'loops' }` is now asserted to be refused.
- `npm test`; `scripts/08 | diff - various/01-…`.

### Why
- A new option that defaults off changes nothing a frozen test observes; a new value of an existing option changes what that option accepts.

### What worked
- `npm test`: `tests 333`, `pass 330`, `fail 0`, `skipped 3`.
- `REVISIONS-IDENTICAL`.
- `node --test tests/typed/speed.test.mjs tests/typed/backend.test.mjs`: 22 of 22.

### What didn't work
- See above: the first full run after Step 6: `ℹ tests 333 ℹ pass 329 ℹ fail 1`.

### What I learned
- The frozen surface includes refusals, not only numbers.

### What was tricky to build
- Nothing beyond the rename.

### What warrants a second pair of eyes
- The guide (§12, §16.1) still names the option `layout: 'loops'`; its outcomes section records the rename.

### What should be done in the future
- The guide's outcomes section: list this departure.

### Code review instructions
- `git diff 420d8e1 -- src/typed/backend/options.ts`: `layout` is unchanged.

### Technical details
- Option names in a refusal's fix line now read `registers, fuse, immediates, divmagic, useRanges, order, spill, hints, layout, chains, coalesce, homes`; the frozen test matches only their start (`/fix: options: registers, fuse/`).

## Step 8: The inline pass

This step wrote `inline` (`src/typed/inline.ts`), a whole-program pass like `dfe`, and its tests. On the `calls` project it removes all four calls of `energy` in one application, the contract agrees on 120 of 120 cases, and `why` on an inlined statement reaches both the callee's return (`s:sq.0`, source line 2) and the removed call (`s:energy.2`, line 6). On the f32 convention fixture it turns record results into locals and leaves no leaf read behind, and the image agrees with the evaluator with and without the new backend options.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** E3 as the guide's §15 designs it: single-site and small callees, record results, parameters as locals, provenance, the contract, entry-only programs.
**Inferred user intent:** See Step 1.
**Commit (code):** the commit of Step 9.

### What I did
- `src/typed/inline.ts`: `makeInline(correspond)` returns a `TypedPass` (`definePass` with `id: 'typed.inline'`, needs `liveness`, writes entities `local`, `block`, `stmt.*`, `value.*` and relations `declares`, `contains`, `uses`, `operand`, `reads`, `writes`, `succ`, `jump`; `typed.program: true`). Per caller, sites at the root of `set`, `eval` and `return`; per site: new locals `g_<name>`; a continuation block with the rest of the block; argument assignments; `0` for the callee's non-parameter locals live at its entry; copies of the callee's blocks (callee bodies always from the input revision); each `return` rewritten by the site's kind; leaf reads after a record call rewritten to `get g_r<j>` up to the next record call; the new blocks placed after the call's block, in the callee's order, then the continuation.
- Refusals: callees in a call-graph cycle, with a frame array, with `zero` or `aaddr`, with a return that is not their declared result, or whose leaf reads do not follow their call in the same block; a caller whose own leaf reads do not; a site after which a leaf read belongs to an earlier call (the result-leaf rule).
- Limits (params, defaults `maxSize` 16, `maxSingle` 200, `maxCaller` 3,000 statements).
- `src/typed/passes.ts`: `import { makeInline } from './inline.js'`; `export const inline = makeInline(revisionCorrespondence)`; `inline` in `PASSES`.
- `scripts/07-inline-probe.mjs <project> [--before …] [--params …] [--after …] [--why]`.
- `tests/typed/inline.test.mjs`, 7 tests (registration; `calls` with provenance; the f32 record fixture through the backend; limits and frame-array refusal; entry-only contract and `dfe`; zeroing; the corpus under the new pipeline with `IRWB_FULL=1`).

### Why
- `makeInline` takes the correspondence function as an argument so that `inline.ts` imports only types from `passes.ts`: a runtime import would form a cycle in which `passes.ts` reads `inline` before `inline.ts` has run, whenever `inline.ts` is loaded first.
- Callee bodies from the input revision make one application one level of inlining, deterministic regardless of the order callers are visited in.

### What worked
- `node scripts/07-inline-probe.mjs calls --why`: `{"pass":"inline","rev":"r1","edits":34,"changed":true,"kinds":{"local":12,"block":14,"remove":4,"inline":4},"ms":67.13,"check":"120/120"}`.
- `why` of `s:energy.16 t6 = (sq_x2 * sq_x2)`: `via: inline`, `note: inlined from sq into energy at s:energy.2`, `from: s:sq.0 return (x * x)` ← `op:sq#3 end (line 2)`, `because: [v:energy.8 sq(c) (detached), s:energy.2 t6 = sq(c) (removed@r1, call 0 (line 6))]`.
- `node --test tests/typed/inline.test.mjs`: 7 of 7; with `IRWB_FULL=1`: 7 of 7, the corpus test 44.1 s.

### What didn't work
- First test run: 2 of 7 failed. (1) `6 !== 3`: each callee `return` becomes two statements (`set` and `br`), both with `from: s:sq.0`; the test now counts the `set`s. (2) `[notCompiled] prog:limits did not compile: recursive call cycle: fact -> fact`: the Typed front end refuses recursion, so the cycle rule cannot be shown on a Typed program; the test shows the frame-array refusal instead.
- The zeroing test as first written did not exercise zeroing: Typed initializes every local, so lifted code reads none before writing it, and the pass made no zero assignment (checked: the list of statements with note `starts at 0` was `[]`). The test now first applies a small user pass that removes `last`'s `t = 0` (valid: a fresh frame holds 0); `t` is then live at `last`'s entry, the inlined copy in `sum`'s loop gets `last_t = 0`, and the contract agrees. Without the zeroing, `last(k & 1)` for even `k` would return the previous call's `7 + i`.

### What I learned
- In lifted code, no local is live at a function's entry except parameters, so zeroing never fires on lifted programs; it matters only after a pass removes an initialization.
- After `inline` and O2, the parameter copies (`sq_x = a`) remain: O2 has no copy propagation, and `subst` only substitutes a temporary read once. The backend's `coalesce` removes the corresponding `mv`s.

### What was tricky to build
- The evaluator's leaf reads are frame-wide ("the latest multi-result call in this frame", `evaluate.ts:405`): after inlining, a record call inside the copied body runs in the caller's frame. The pass therefore requires every leaf read of the caller and the callee to follow its call in its own block (the backend's rule, `select.ts:392–396`), and rewrites the reads of an inlined record call up to and including the next record call's arguments.

### What warrants a second pair of eyes
- `inlineSite` mutates block statement lists directly and records `remove`, `replace` and `inline` edits itself; `tx.commit()` derives successors and prunes. The copied blocks always end with a terminator (an explicit `br` where the callee's block fell through), so the source layout's fall-through assumption is never needed for them.

### What should be done in the future
- Copy propagation in a pass pipeline would remove the parameter copies before the backend.

### Code review instructions
- `src/typed/inline.ts` (`inlineSite`, `inlineCaller`, `refuseCallee`, `leavesStayPut`); `tests/typed/inline.test.mjs`.

### Technical details
- Provenance table as built: copies `from` the callee entity, `because [call value, call statement]`; argument assignments `from` the call value, `because [fn:g]`; zero assignments the same, note `g's local l starts at 0`; continuation `from` the call's block, note `after the call to g`; the branch into the copy `from` the call statement; rewritten leaf reads `from` the `result` value, `because [call value]`.

## Step 9: The `speed` pipeline (not `O3`), presets, the workbench options row; corpus and benchmarks

This step added the pipeline, the presets and the RV32 options row, and measured. The pipeline is named `speed`, not `O3` as the brief suggested: a frozen workbench test asserts that `O3` is an unknown pipeline. Under `speed` and the three options, the corpus runs 728,450 instructions against O2's 910,718 (−20.0%), in 4,356 bytes against 5,160, with no project slower and every case agreeing with r0; Blend runs in 370 and insertion sort in 1,824.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "The workbench must offer the new pipeline and options (presets, `PIPELINES`, the strategy registry)"; npm test identical.
**Inferred user intent:** See Step 1.
**Commit (code):** this step's commit.

### What I did
- `PIPELINES.speed = ['inline', 'inline', …O2+…, 'rotate', 'cfg']` (first named `O3`).
- `PRESETS`: `speed` (the pipeline as one plan) and `fastest-all` (the fewest instructions among O0, O1, O2, loops, O2+ and speed; the strategy metrics compile with the default backend options).
- `tests/workbench/strategies.test.mjs`: 14 → 15 passes, `inline`'s source in `src/typed/inline.ts`, `speed` after `O2+` in the pipeline list.
- Workbench: `backendExtras` exported through `src/workbench/index.ts` and `site-src/wb.js`; `wb.backendOptions()` includes the extras; `site-src/main.js` starts the UI state with them; `site-src/views.js` filters and counts options against both tables and has a row "Speed, chosen per function by the estimate" with toggles `chains`, `coalesce`, `homes`. `npm run build:site`: `dist/site built in 462 ms: app.js 2325 KiB …`.
- `scripts/05-corpus-options.mjs --pipeline O3 --options '{"chains":true,"coalesce":true,"homes":true}' --base O2 --json various/10-corpus-o3-all-options.json` (the same pipeline, before the rename).
- `scripts/01-benchmark-probe.mjs --pipeline O3 --options …` with `{}` and the three options.

### Why
- `tests/workbench/strategies.test.mjs:74`: `assert.throws(() => wb.strategy.choose('x', { a: 'O3' }), e => e.code === 'unknownPipeline' …)`. Naming the pipeline `O3` would make that frozen refusal pass the choose and fail the test; `speed` keeps it.

### What worked
- Corpus: `{"pipeline":"O3","options":{"chains":true,"coalesce":true,"homes":true},"instructions":728450,"bytes":4356,"agree":6986,"decided":6986,"inconclusive":14,"disagree":0,"rejected":[],"base":{"instructions":910718,"bytes":5160},"faster":39,"slower":[]}`.
- Benchmarks (every result `same`):

  | pipeline, options | blend | checksum | sort | collatz | value-numbering |
  |---|---:|---:|---:|---:|---:|
  | O2, defaults (book) | 451 | 366 | 2022 | 1590 | 570 |
  | speed, defaults | 450 | 325 | 1985 | 1480 | 569 |
  | speed, all three | 370 | 286 | 1824 | 1218 | 451 |
  | reference compiler | 383 | 292 | 1533 | 1486 | 695 |

- `npm test`: `tests 340`, `pass 337`, `fail 0`, `skipped 3` (baseline 325/322/0/3; 15 new tests).
- `scripts/08 | diff`: `REVISIONS-IDENTICAL`.

### What didn't work
- `node --test tests/workbench/strategies.test.mjs` with the pipeline named `O3`: `✖ wb.strategy: project files in the short form, presets and pipelines, at tile width … Missing expected exception.` and the pipeline enumeration. Renamed; the enumeration grows by `speed`.
- A test-fixing Node script fed by a heredoc was refused by the worktree guard; edits made with the Edit tool.

### What I learned
- Frozen tests pin names as well as numbers: `layout: 'loops'` (Step 7) and `O3` are both refused by name in them.

### What was tricky to build
- The UI's option state starts from the defaults and counts every key that differs from them; the extras had to be in both the initial state and the comparison table, or `chains: false` would show as "1 changed".

### What warrants a second pair of eyes
- `fastest-all` judges by instructions with the default backend options (`measure`, `strategies.ts:66`), so it sees the passes' effect only; under the defaults `speed` is barely faster than O2+ (rotation needs `chains`).

### What should be done in the future
- A strategy metric with backend options, so that a preset can choose by the speed the options give.

### Code review instructions
- `src/typed/passes.ts` (`PIPELINES.speed`), `src/typed/strategies.ts` (`PRESETS`), `site-src/views.js` (`ALL_DEFAULTS`, `optionsBlock`).

### Technical details
- Outputs: `various/10-corpus-o3-all-options.json`.
