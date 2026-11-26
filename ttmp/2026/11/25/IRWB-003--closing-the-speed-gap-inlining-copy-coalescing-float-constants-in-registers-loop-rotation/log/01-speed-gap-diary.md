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
