---
Title: Backend agent diary
Ticket: IRWB-001
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: log
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/backend/select.ts
      Note: Instruction selection by tiling value trees (port of backend.js select)
    - Path: repo://src/typed/backend/regalloc.ts
      Note: Machine-code liveness, intervals and linear scan (port of machineBlocks/intervals/allocate)
    - Path: repo://src/typed/backend/compile.ts
      Note: Frames and spill rewriting (finish), layout and encoding into the native image, lowerToImage, machineCode
    - Path: repo://src/typed/backend/image.ts
      Note: rv32.image native type, validator, ImageIR, imageAdapter, imageCorrespondence
    - Path: repo://src/typed/backend/run.ts
      Note: runImage on the vendored emulator, heat, diffImages, imageStatus, imageFromCode, imageAgrees
    - Path: repo://tests/typed/backend.test.mjs
      Note: Book parity at r0, corpus-wide image check, oracle comparison, encoders, options, faults, IR and correspondence
    - Path: repo://src/typed/ir.ts
      Note: Outside the backend; resolve indexed per value (separate commit 4d16a12)
ExternalSources: []
Summary: "Diary of the subagent that ported Compiler Workbench's RV32 backend (backend.js) to src/typed/backend, with rv32.image as a v6 IR and the image check as an E5 differential invariant."
LastUpdated: 2026-11-24T19:55:00-05:00
WhatFor: "Evidence trail and review guide for P2.4 (the RV32 backend) of IRWB-001."
WhenToUse: "Read before reviewing or extending src/typed/backend, or when an image number disagrees with the book."
---

# Backend agent diary

Steps are chronological, oldest first. This diary belongs to the subagent that the main implementation agent delegated the backend to; the main diary is `02-implementation-diary.md`.

## Step 1: Read the brief, the prototype and the ported layers; decide the shape of rv32.image

This step set up the worktree and read everything the port depends on before writing code. The prototype's backend is 536 lines in one IIFE. It reads the program through `WB.factOf` (liveness and ranges), writes instruction entities into the program's store, and runs images through `G.typedRv32Interp`. The ported layers replace each of those: `livenessAnalysis.solveArtifact` and `rangesAnalysis.solveArtifact` with `liveView`/`rangeView`, a native image value instead of store entities, and `requireVendor('typedRv32Interp')`. The outcome was a module split and a native format for `rv32.image`, decided before any code was written.

One constraint fixed the shape of `covers`: v6's `validateGraph` refuses any relation whose endpoint is not an entity of the same graph (`Dangling relation …`). An image graph cannot point at typed.blocks ids, so `covers` stays an attribute (a list of source ids), and the cross-IR link is a v6 `EntityCorrespondence` built by a helper that sees both artifacts.

### Prompt Context
**User prompt (verbatim, the delegating agent's brief):** "You are porting the RV32 backend of a JavaScript compiler prototype (\"Compiler Workbench\", CW) into a TypeScript compiler framework. Work only in your git worktree; commit there; do not push."

**Assistant interpretation:** Port `backend.js` faithfully to `src/typed/backend/*.ts`, so that the prototype's numbers reproduce. Represent images as a v6 IR with an adapter and a correspondence helper. Add `lowerToImage` and an `imageAgrees` differential invariant. Test parity with the book, corpus-wide agreement, encoders, options and faults. Keep a diary in this format and keep `npm test` green.

**Inferred user intent:** The combined workbench needs a backend whose images are first-class v6 artifacts, checkable against the evaluator, with provenance from instructions back to statements, values and source lines. It should be built on the already-ported model, IR, evaluator and analyses rather than beside them.

### What I did
- `ln -s /home/manuel/code/wesen/2026-11-24--compiler-workbench/node_modules node_modules`; `npm test` → `tests 232`, `pass 232`, `fail 0`.
- Read `sources/.../engine/backend.js` in full, the backend-related parts of `api.js` (`compile`, `asmDiff`, `check`, `imageHandle`, `referenceImage`, `backendOptions`, `WB.ERRORS`), `evaluator.js`'s `WB.check` (limits 2e4 on the evaluator and 2e5 on the emulator, inconclusive on limits), `base.js` (`WorkbenchError`, `didYouMean`), and `test/projects.mjs` (how sources are concatenated and how reference images are built).
- Read the ported `model.ts`, `ir.ts`, `evaluate.ts`, `analyses.ts`, `listing.ts`, `vendor.ts`, `tools/node-vendor.mjs`, the framework's `differential.ts`, `correspondence.ts`, `adapters.ts` (`validateGraph`, `project`), `ir/types.ts`, `contracts/definitions.ts`, `core/data.ts` (`canonical` rejects `undefined`) and `dataflow/analysis.ts` (`solveArtifact` is synchronous).
- Read `vendor/ds-js-os/bench/host/rv32-interp.js` (the user's own code): `run(program, entry, args, memoryBytes, {limit})` takes the program object `{image, entries, relocations, imports}`, returns `{trap, result, steps, counts, bytes}` and throws `Rv32Fault` for limits, out-of-memory accesses and calling-convention violations.
- Grepped the book (`src/book/*.md`) for bytes and instruction counts, and collected every number stated at r0 (chapters 1, 11, 12, 14 and 15).

### Why
- A native image that is finite JSON is required by `createIRArtifact` (`immutable` goes through `canonical`). So the code is base64, every optional field is omitted rather than set to `undefined`, and the prototype's `ms` (compile time) is left out because it would make the revision hash depend on timing.
- The correspondence takes every entity of both projections as its universes (not only the covered ones), because `composeCorrespondence` requires the intermediate universes to be equal. A pass chain r0 → rN composed with rN → image then works.

### What worked
- Every ported layer offered exactly what the backend needs. Nothing in `analyses.ts` or `evaluate.ts` had to change for the port itself.

### What didn't work
- No failures in this step.

### What I learned
- `liveView(...).liveIn(b)` iterates in sorted order (the set lattice encodes sorted), while the prototype's `live.in.get(entry)` iterates in insertion order. The only effect is the order of the entry instructions that zero locals live on entry. No corpus function has such an instruction at r0 (checked in Step 3), so no number here can depend on it.
- The interpreter's type in `vendor.ts` declares the first `run` parameter as `Uint8Array`. It actually takes the program object.

### What was tricky to build
- Nothing yet; the decisions above are the step's output.

### What warrants a second pair of eyes
- Whether `covers` as an attribute plus `imageCorrespondence` is the right reading of the brief's "a `covers` relation of category `provenance`". The image adapter declares no `covers` relation kind, because there is nothing in its own graph for such a relation to point at.

### What should be done in the future
- N/A for this step.

### Code review instructions
- Compare `src/typed/backend/image.ts`'s header comment with `validateGraph` in `src/framework/ir/adapters.ts`.

### Technical details
- Module split: `errors.ts` (`BackendError` with the prototype's codes, `didYouMean`), `encode.ts` (encoders, `divisionMagic`, `REGS`, `decode`, `MInsn`, `encodeOne`), `options.ts` (defaults, `checkBackendOptions`), `select.ts`, `regalloc.ts`, `compile.ts` (`finish`, `compileImage`, `lowerToImage`, `machineCode`), `image.ts`, `run.ts`, `index.ts`.

## Step 2: Port selection, allocation, frames and encoding; reproduce the book's r0 numbers

This step wrote the whole backend in one pass, with each algorithm kept line-for-line with the prototype: the tiles, the target-directed assignment, branch fusion, the division checks and their removal by ranges, magic division, the interval construction with block stretching, linear scan with hints and fixed argument registers, spill rewriting through t5/t6, the frame layout, the jump-to-next cleanup and the dropping of an unreachable exit. The first run of Blend printed 96 bytes and 531 instructions, and 116 bytes with `fuse`, `immediates` and `divmagic` off. Those are the book's three Blend numbers.

A wider measurement then reproduced every other r0 number the book states. The reference compiler, needed only as an oracle, did not load with its default policy. The `interactive` policy, which uses no tape passes, does load.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Make the port produce the prototype's images, then measure them against the book.
**Inferred user intent:** Parity first. A port whose numbers drift cannot be trusted as the base for the O2 passes.
**Commit (code):** 4bb0369 — "IRWB-001 P2.4: RV32 backend for typed.blocks, rv32.image IR and the image check"

### What I did
- Wrote `select.ts` (tiles, `compare`, `divide`, `val`, `branch`, the entry sequence), `regalloc.ts` (`machineBlocks`, `intervals`, `allocate`), `compile.ts` (`finish`, `compileImage`), `image.ts`, `run.ts`, `options.ts`, `errors.ts`, `encode.ts`, and formatted them with `npx prettier --write "src/typed/backend/*.ts"`. `npx tsc -p tsconfig.json --noEmit` passed on the first try.
- `scratchpad/blend.mjs` printed the Blend listing and ran it on 40 cells with n = 40, a = 3, b = 5.
- `scratchpad/measure.mjs` measured the book's other numbers, the option variants, and the reference compiler's sizes.

### Why
- A per-instruction pc array replaces the prototype's `m.pc = pc` mutation; the layout is the same.
- `layout` is validated (`'source'` only) and the five boolean options must be booleans. The prototype accepted any value for these and ignored it. This is stricter, and is documented in `options.ts`.

### What worked
- Blend r0 listing (abridged): `blt t2, a1, 0x2c` (fused loop test), the `srai/srli/add/srai` sequence for `s / 8`, `addi t3, t2, 0 (copy)`, `lw t4, 0(a0)`, `bltu t3, t4, 0x3c`, `ebreak (unreachable)`, `lhu t3, 4(t3)`, `mul t4, a2, a3`, `jal zero, 0x10`. That is 24 instructions, with no frame and no spills.
- Measured against the book (all at r0):

  | number | book | measured |
  |---|---|---|
  | Blend image bytes | 96 | 96 |
  | Blend instructions, 40 cells, n = 40 | 531 | 531 |
  | Blend bytes, fuse/immediates/divmagic off | 116 | 116 |
  | Checksum bytes / instructions, 40 cells | 64 / 446 | 64 / 446 |
  | Insertion sort, 10 reversed | 2022 | 2022 |
  | Collatz, n = 27 | 1590 | 1590 |
  | Value numbering, n = 40 | 690 | 690 |
  | licm-nested before licm, rows = cols = 10 | 955 | 955 |
  | digitsum(987654321) with / without divmagic | 76 B, 107 / 60 B, 71 | 76 B, 107 / 60 B, 71 |
  | safeShare useRanges on / off | 56 B, no ebreak / 92 B, three | 56 B, 0 / 92 B, 3 |
  | sevenths | `lui t0, 0x92492`, `addi t0, t0, 1171`, mulh, add, shift | same |
  | Calls image: default / order callee / hints off | 212 / 252 / 220 | 212 / 252 / 220 |
  | energy frame and saves | ra + s1–s5, 32 bytes | same |
  | call-chain: h / g, f | no frame / ra, s1, s2 in 16 | same |

- Blend after O2 (88 bytes, 451 instructions) is left as a `test.todo`: the O2 passes are not ported yet.

### What didn't work
- The first attempt to run the scratch script with an inline heredoc in a compound command was refused by the harness: `This agent is isolated in the worktree …, but this command is too complex to verify that it stays inside the worktree. Refusing to run it`. I wrote scripts to the scratchpad with the Write tool and ran them with plain `node <path>` instead.
- `typedRv32.compile(source, [])` failed: `Error: the RV32 pass inline needs typed-rv32-inline.js; load it after typed-rv32.js`. The vendored reference compiler is only its core bundle; the pass groups `typed-rv32-inline.js`, `-loops.js` and `-kernel.js` are not in `vendor/ds-js-os`. `typedRv32.compile(source, [], undefined, { policy: 'interactive' })` (no tape passes) works. Its sizes are therefore not the book's: 7392 bytes over 44 projects, against the book's 7628 for the default policy at the prototype's ds-js-os commit. Its instruction counts also differ (Blend 497 vs the book's 383). It is still a valid oracle for results.

### What I learned
- The book's r0 numbers are fully determined by the backend algorithms, the lifter and the analyses' facts. Reproducing them confirms the earlier ports of the lifter, liveness and ranges as well (useRanges decides safeShare's 56 against 92 bytes).

### What was tricky to build
- `finish`'s coalescing rule: when both sides of a copy are spilled, the copy collapses to `rd = rs1 = t5`, but the store into the destination's slot must still be emitted. The book (chapter 15) describes the bug this guards against: `let j = i` in Insertion sort never reached `j`'s slot. The port keeps the fixed form (`if (n.mv && n.rd === n.rs1) { if (spillDef !== null) out.push(store(...)); continue; }`).
- The exit-dropping rule: the instruction just before the `exit` label must itself be a terminal, with no label between them (chapter 13's third bug). The port keeps `before = final[exitAt - 1]` and checks `['ret', 'j', 'ebreak']`.

### What warrants a second pair of eyes
- `select.ts` `branch()` and `compare()`: the swap and invert tables are the prototype's, but they are easy to get subtly wrong in a retype.
- `regalloc.ts` `okFor`: argument registers are reserved until each parameter's copy, and intervals that cross a call may only take callee-saved registers.

### What should be done in the future
- Re-measure Blend after O2 (88 bytes, 451 instructions) and the chapter 14 diff (r0 against r6: 11 same, 13 removed, 11 added) once the O2 passes are ported; the `test.todo` marks the spot.
- Vendor the reference compiler's pass groups if its default-policy numbers (383 for Blend, 7628 bytes in total) should be reproduced.

### Code review instructions
- Start with `src/typed/backend/select.ts` side by side with `backend.js` lines 94–268, then `regalloc.ts` with lines 270–342 and `compile.ts` `finish` with lines 345–392.
- `node --test --test-name-pattern="book" tests/typed/backend.test.mjs` runs the parity tests.

### Technical details
- Native image: `{ formatVersion: 1, program, source: {artifact, revision} | null, options | null, bytes, code (base64), entries, fnOrder, fns: {name, entry, bytes, insns, frame?, saved?, spills?, regs?, vregs?, leaf?}, insns: [{id, fn, offset, op, word, text, sym, covers, why?, target?, label?, callee?}] }`. Instruction ids are `insn:FN+0xOFF` (relative to the function's entry), as in the prototype but without its `@rN` tag, because the artifact revision now identifies the image.

## Step 3: rv32.image-agrees over the corpus and the oracle; tests; a quadratic projection

This step turned the measurements into tests and ran the image check everywhere. `imageAgrees` is a `differential()` invariant with ports `{ program: BlocksIR, image: ImageIR }`, memoized per parameter set like `meaningKept`. Over all 44 corpus projects (70 functions, 40 cases each, seed 7, project.json inputs), it decided 2796 cases, all agreeing, with 4 inconclusive and no disagreement. Run on reference-compiler images instead, it gave the same result.

The new test file made the suite five times slower: 32.7 s against about 6 s. The cause was outside the backend. `blocksAdapter.resolve` scans all entities on every call, and v6 projection resolves every entity, so each `openIR` on typed.blocks is quadratic. An index per immutable value, in a separate commit, brought the full suite to 6.8 s.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Tests for parity, corpus agreement, encoders, options, faults and optionally the oracle; keep `npm test` green.
**Inferred user intent:** A check that would catch a regression in any backend stage, and a suite that stays fast enough to run all the time.
**Commit (code):** 4bb0369 — "IRWB-001 P2.4: RV32 backend for typed.blocks, rv32.image IR and the image check"; 4d16a12 — "IRWB-001: index typed.blocks entities for resolve"

### What I did
- `scratchpad/agree.mjs` ran `imageAgrees` over every project: on our images, and with `ref` on `imageFromCode` wrappers of the reference compiler's output.
- `scratchpad/inconc.mjs` listed the inconclusive cases: `my-analysis` `f` cases 2, 27, 37, 39 (args `[-6, 0]`, `[-10, 0]`, `[-194, 0]`, `[-40, 0]`). With `flag` false, `b = x + 1 ≤ 0`, so `while (a < 100) a = a + b + 1` never ends, and both sides hit their limits. Inconclusive is the right verdict for these.
- Wrote `tests/typed/backend.test.mjs` (12 tests, one of them a `todo`): Blend parity; the other r0 numbers; the corpus check; the oracle (reference images agree with the evaluator, and with our images on results for nine projects); the encoder/decoder round trip and `divisionMagic(3|5|7)`; options; a hand-assembled image (`addi s1, s1, 1; ret`) that faults and therefore disagrees, plus a missing entry that counts as a fault; memoization and inconclusive limits; the v6 projection, serialization and validator refusals; the correspondence and a `traceEntity`; heat, diffs, machine stages and `imageStatus`.
- `scratchpad/timing.mjs` timed lowering stages on Sort; then I indexed `resolveImageEntity` in `image.ts`, and in a separate commit indexed `blocksAdapter.resolve` in `src/typed/ir.ts`.

### Why
- The reference compiler is the independent oracle the brief offers. Checking its images against our evaluator exercises the evaluator and the cases. Comparing its results with ours is a check that does not route through our own evaluator.
- I kept the ir.ts change separate so it can be reviewed or dropped on its own. It is outside the brief's directories, but it is a seven-line change, changes no behaviour, and the backend's tests are what exposed the cost.

### What worked
- Corpus: `{ fns: 70, total: 2800, decided: 2796, inconclusive: 4 }`, all agreeing (about 9.8 s before the index). Reference images: the same counts (4.3 s).
- After both commits: `npm test` → `tests 244`, `pass 243`, `fail 0`, `todo 1`, `duration_ms 6840`; `npx prettier --check "src/typed/**/*.ts" tests/typed/backend.test.mjs` → clean.
- Timing on Sort before → after the index: blocks artifact 233.8 → 51.7 ms, liveness 222.2 → 53.9 ms, ranges 205.6 → 56.7 ms; image artifact 23.7 → 6.8 ms after indexing the image adapter.

### What didn't work
- First test run: `✖ P2.4: heat, diffs, machine stages and image status` with `AssertionError [ERR_ASSERTION]: every executed instruction has a line` / `532 !== 531`. My assertion was wrong, not the code. `heat` counts an instruction on every line its covered value derives from, as the prototype does, and one Blend instruction covers a value spanning two lines. I changed the test to check that every executed instruction has at least one line and that the per-line sum is at least 531.
- Second run: `assert.ok(h.byStmt.get('s:blend.10') === 40 * 8)` failed. `s:blend.10` covers seven instructions (0x3c–0x54), not eight; I fixed the expectation to `40 * 7`.
- Full suite before the index: `duration_ms 32713` (P2.1's round-trip test alone took 7.5 s under contention).

### What I learned
- The image check over the whole corpus is cheap: the evaluator and the emulator take well under a second together. Nearly all the cost is v6 projections of typed.blocks: one for the artifact, one per `solveArtifact`, and more for the correspondence and the manager's validation.

### What was tricky to build
- `agrees(expected, got)` is typed for `RunResult`, whose `counts` is a `Map`; an image run's counts are a `Uint32Array`. Passing `{ ...got, counts: null }` keeps the verdict function unchanged and typed without a cast.
- A function missing from an image would make `runImage` throw `unknownFunction` and abort the whole differential. `imageAgrees` turns it into a fault result (`no entry "f" in the image`), so it is a recorded disagreement.

### What warrants a second pair of eyes
- `imageCorrespondence`: every covered source entity gets one `covered-by` entry to all instructions listing it, and each function gets a `retained` entry. `makeCorrespondence` then completes the rest as `removed` (blocks, locals, front-end ops, constants folded into immediates, local reads) or `inserted` (instructions that cover nothing: parameter copies, zeroed locals). `removed` is v6's word for "no counterpart in the target", not "deleted by an optimization". A reviewer may prefer a richer mapping for folded values, to the instructions of the user that absorbed them.
- The ir.ts index returns shared entity objects from `resolve`. The framework copies them (`validateEntity` → `immutable`), but a caller that mutated a resolved entity would corrupt the cache.

### What should be done in the future
- Port O2, then fill in the `test.todo` (88 bytes, 451 instructions) and add the chapter 14 diff numbers and the chapter 15 tables (Pressure after O1, Values across calls after O2).
- Consider a `defineTransformation` for lowering (`typed.blocks` → `rv32.image`, ensuring `rv32.image-agrees`), so that a pipeline can treat the backend like any other checked step.

### Code review instructions
- Start with `src/typed/backend/run.ts` `imageAgrees` next to `meaningKept` in `src/typed/evaluate.ts`, then `image.ts` `validateImage` and `imageCorrespondence`.
- Validate with `npm test`, or just `npm run build && node --test tests/typed/backend.test.mjs`.

### Technical details
- `imageAgrees` defaults: count 40, seed 7 (xorshift32 `rng`), evaluator limit 2e4, emulator limit 2e5 (the prototype's `WB.check` limits); id `rv32.image-agrees`, version `1+<fnv1a of the canonical parameters>`.
- Reference images: `imageFromCode(program, code, entries)` builds a valid `rv32.image` (no covers, `source: null`, `options: null`, no allocation facts) from any compiler's bytes. The test builds them with `typedRv32.compile(source, [], undefined, { policy: 'interactive' })`.
- Changes outside `src/typed/backend/**` and `tests/typed/backend*.test.mjs`: `src/typed/ir.ts`, where `blocksAdapter.resolve` is now indexed per value (commit 4d16a12, +7/−1 lines).
