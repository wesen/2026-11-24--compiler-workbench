---
Title: f32 backend agent diary
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
    - Path: repo://src/typed/backend/encode.ts
      Note: RV32F encodings, f register names, the decoder's F words
    - Path: repo://src/typed/backend/select.ts
      Note: f32 tiles, ilp32f calls and returns, caddr, aaddr, zero, result leaves
    - Path: repo://src/typed/backend/regalloc.ts
      Note: two register classes in the linear scan
    - Path: repo://src/typed/backend/compile.ts
      Note: frames with an outgoing area, arrays, f spills and f saves
    - Path: repo://src/typed/backend/run.ts
      Note: runImage and imageAgrees with f32 arguments and results
    - Path: repo://src/typed/ilp32f.ts
      Note: the ilp32f argument and result locations, shared by the backend's runner and reference.ts
    - Path: repo://tests/typed/f32-backend.test.mjs
      Note: encodings, edge values, conventions, spills, the fs check, relaxation, Candela (IRWB_CANDELA=1 for 100 cases and the O2 head)
    - Path: repo://tools/candela-image.mjs
      Note: our images and the reference's on the same cases; bytes and instructions per function
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/various/experiments/f32-backend-01-candela-images.md
      Note: the final measurement (r0, O2, stock, kernel; 100 cases per function)
ExternalSources: []
Summary: "Investigation diary of the subagent that extended the RV32 backend with RV32F (task owi2, design-doc 05 §4): every Candela function compiles at r0 and at the O2 head and agrees with the evaluator on 100 cases per function; the i32 corpus is unchanged by revision."
LastUpdated: 2026-11-24T23:55:00-05:00
WhatFor: "Evidence trail and resume point for the f32 backend (P4.5)."
WhenToUse: "Read before reviewing or extending the backend's f32 lowering, its register classes, or the Candela image numbers."
---

# f32 backend agent diary

Steps are chronological, oldest first. This diary belongs to the subagent that the coordinator delegated task owi2 (P4.5, the f32 RV32F backend) to. The main diary is `02-implementation-diary.md`; the earlier backend agent's is `03-backend-agent-diary.md`, the f32 middle end's is `04-f32-candela-agent-diary.md`.

## Step 1: Read the brief and the code; start O2 on Candela in the background

This step read design-doc 05, the f32 agent's diary, the whole backend, the evaluator, `f32.ts`, `reference.ts` and the reference compiler's f32, call and frame code, and measured the shapes Candela's IR gives the backend. Because O2 on Candela takes about 36 minutes and does not depend on the backend, I started it first, from a snapshot of the build, so that later rebuilds cannot change what it loads.

### Prompt Context
**User prompt (verbatim):** the coordinator's brief, first paragraph: "You are extending the RV32 backend of a TypeScript compiler so that it compiles single-precision float (f32) code, and Candela's 332-function renderer in particular. The repository is `/home/manuel/code/wesen/2026-11-24--compiler-workbench`. You work in your own git worktree, branched from `irwb-001/import-v6-prototype` at c3689c1 or later. Commit on your branch at sensible points. Do not push, and do not merge into other branches."

**Assistant interpretation:** Task owi2 of design-doc 05 §4: lower every f32 operator and the new constructs (`caddr`, `aaddr`, `zero`, multi-value calls and returns, stack words), add an f register class to the allocator, F-extension encodings, and extend `runImage`/`imageAgrees` to f32 arguments and results. Keep the i32 corpus byte for byte. Measure Candela at r0 and at the O2 head against the evaluator and the reference compiler's `stock` and `kernel` policies.

**Inferred user intent:** Candela's optimizations can be measured in instructions on the target, not only in statements, and the backend stays the book's backend for i32 programs.

**Commit (code):** none in this step.

### What I did
- Read `design-doc/05-…` (§1, §4, §8), `log/04-f32-candela-agent-diary.md`, `src/typed/backend/*`, `src/typed/{f32,evaluate,reference,model}.ts`, `tools/candela*.mjs`, `tests/typed/{backend,candela,f32}.test.mjs`.
- Read the vendored reference compiler (`vendor/ds-js-os/compiler/typed/typed-rv32.js`): `REGISTER_CLASSES`, `argumentRegisters`, `resultLocations`, the instruction table's RV32F rows (lines 158–167), `checkedAddress` (349), `FloatMethods` (836–967), the call and return code (`call`, `returnValue`, `outgoingWords`, `callerStack`, 719–826) and the frame layout in `lower` (1386–1480). Read the interpreter's `run` (`bench/host/rv32-interp.js`), including its RV32F decoding and its calling-convention checks.
- `ln -s …/node_modules node_modules`; `npm run build` (3 s).
- Probe `scratchpad/probes/shapes.mjs` (not committed): Candela's operators, statements and signatures as the backend sees them.
- Copied `dist tools corpus vendor package.json` to `scratchpad/o2run/` and started, from there:
  `timeout 9000 node --max-old-space-size=12288 tools/candela-o2.mjs --json --save scratchpad/candela-o2-head.json > scratchpad/o2-candela.json 2> scratchpad/o2-candela.err` (background task `byfsir3x1`).

### Why
- The O2 head is the middle end's output; the backend cannot change it. Starting it at once saves 36 minutes of waiting later. The snapshot keeps the run on the c3689c1 build while I rebuild `dist/` in the worktree.

### What worked
- The shapes (from `shapes.mjs`):
  - 332 functions; at most 492 locals and 35 parameters in one function; frame arrays in `hitMesh` (192 bytes) and `traceAll` (160 bytes).
  - 40 functions take stack arguments under ilp32f (for example `neeAt` with 5 integer and 30 f32 parameters), and 93 return some leaves in stack words (`lobeNone`: 3 integer and 23 f32 leaves).
  - Statements: 9,222 `set`, 718 `br_if`, 647 `return`, 428 `eval`, 276 stores of f32 values, 9 of i32, 12 `store16`, 2 `zero`, 6 `trap`.
- The O2 run reports its first passes at the speed the f32 agent measured: `cfg r1 107426 ms`, `fold r2 131999 ms`, `simplify r3 118048 ms`.

### What didn't work
- My first probe command used a shell heredoc to write the script; the worktree guard refused it ("this command is too complex to verify that it stays inside the worktree"). I write scripts with the Write tool from now on.
- `git -C <main checkout> worktree list` was refused as well (the guard keeps git inside this worktree).

### What I learned
- **The interpreter checks only x registers across calls.** `CALLEE_SAVED` in `rv32-interp.js` is `[2, 3, 4, 8, 9, 18…27]`: sp, gp, tp, s0–s11. Nothing checks fs0–fs11. A backend that forgot to save an fs register would only show up as a wrong result in a caller. I will add that check for the entry function in the image runner.
- **The interpreter honours static rounding modes.** `rounding(rm)` uses the instruction's rm field, and frm only for rm = 7. So `fcvt.w.s …, rtz` and `fadd.s …, rne` mean what they say regardless of fcsr.
- **Result leaves stay in the block of their call.** The lifter flushes the operand stack at every `if`, `block` and `loop`, and materializes a `result` leaf before the next call. So a `result#k` is read in the same block as its call, before any other call. In a function that calls, no allocatable register is an argument register, so the leaves can be read straight from a0–a7 and fa0–fa7 without copies.
- The reference compiler supports frames over 2,032 bytes (`large`, with s0 = sp + 2032 as a second base). Our backend refuses them (`frameTooLarge`); whether Candela needs them depends on how many values spill.

### What was tricky to build
- Nothing yet.

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Nothing to review in this step.

### Technical details
- ilp32f, as `argumentRegisters` and `resultLocations` define it: integers in a0–a7, f32 in fa0–fa7, each class in order; an f32 argument beyond fa7 takes the next free integer register (its bits); an argument with no register left takes stack word k at the caller's sp + 4k. Result leaves: a0–a7 and fa0–fa7 per class, then stack words that the callee writes at the caller's sp + 4k.
- RV32F rows of the reference (f7 = word >>> 25): fadd 0x00, fsub 0x04, fmul 0x08, fdiv 0x0c, fsqrt 0x2c, fsgnj* 0x10 (f3 0, 1, 2), fmin/fmax 0x14 (f3 0, 1), feq/flt/fle 0x50 (f3 2, 1, 0), fcvt.w[u].s 0x60 (rs2 0, 1), fcvt.s.w[u] 0x68 (rs2 0, 1), fmv.x.w 0x70, fmv.w.x 0x78; flw opcode 0x07, fsw 0x27, f3 = 2.

## Step 2: A baseline of the i32 corpus's images, the encoder, and the shared ilp32f module

Before changing anything I recorded the image revision of every corpus project, at r0 under six option sets and after O2, so that "the i32 corpus is unchanged" can be checked by hash, not only by the totals. Then I wrote the first two pieces: RV32F encodings and decodings in `encode.ts`, and `src/typed/ilp32f.ts`, the calling convention factored out of `reference.ts` so that the reference oracle and the backend's runner place arguments and read results with one piece of code.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The encoding part of the brief ("F-extension encodings in `encode.ts`") and the convention code the brief says to reuse ("Reuse its convention code").
**Inferred user intent:** One definition of ilp32f, so a disagreement between our image and the reference image cannot come from two readings of the convention.
**Commit (code):** in the commit of Step 4 (the pieces do not compile on their own).

### What I did
- `scratchpad/probes/baseline.mjs`: for each of the 44 projects, `lowerToImage(r0, o)` for `{}`, `{registers: 2}`, `{order: 'callee'}`, `{hints: false}`, `{spill: 'current', registers: 3}` and `{fuse: false, immediates: false, divmagic: false}`, then O2 and the default image; it prints the revisions and O2 bytes. Saved as `scratchpad/baseline-c3689c1.json` (100 s).
- `encode.ts`:
  - `REGS` has 64 names: x0–x31, then f0–f31 (`ft0`–`ft7`, `fs0`, `fs1`, `fa0`–`fa7`, `fs2`–`fs11`, `ft8`–`ft11`). Indices below 32 are unchanged.
  - `decodeFloat`: flw, fsw (with `memory`, `base`, `offset`, `reg` like lw and sw) and every OP-FP word of the reference's table. The rounding mode is printed unless it is dynamic (`fadd.s fa0, fa0, fa1, rne`); `fsgnj*` with equal sources prints as `fmv.s`, `fneg.s`, `fabs.s`.
  - `FLOAT_OPS` (funct7, funct3 or the instruction's `rm`, rs2 and operand classes), `operandClasses`, flw and fsw. `encodeOne` now refuses any register field of the wrong class or a virtual register (`internal`).
  - Pools: `F_CALLER` ft0–ft9, `F_ARGS` fa1–fa7 then fa0, `F_CALLEE` fs0–fs11; `FT10`, `FT11` are the f spill scratch. `MInsn` gains `rm`, `caller` (an access at the caller's sp, whose offset the frame size completes) and `pins` (see Step 3).
- `src/typed/ilp32f.ts` (new): `argumentLocations`, `resultLocations`, `stackWords`, `needsConvention`, `placeCall`, `readResults`, `changedSavedF`. `reference.ts` now calls `placeCall`/`readResults`; its behaviour is unchanged (the same layout: guest memory, 64 KiB of stack, the caller's stack words at sp).
- `npx tsc --noEmit`: clean.

### Why
- **Physical f registers are 32 + n,** as in the reference compiler, so `r >> 5` gives a physical register's class and virtual registers stay at 64 and above. Every existing test that indexes `REGS` below 32 still holds.
- **The class check in `encodeOne`.** An allocator bug that puts an f value in an x register would otherwise encode a wrong but valid word. Now it fails the compile.

### What worked
- Baseline: 44 projects, O2 images totalling 5,160 bytes (the book's number).

### What didn't work
- No failures in this step.

### What I learned
- `COMPARE` in `listing.ts` contains the f32 comparisons, so the selector must route them before its i32 comparison code.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- The decoder's text for rounding modes (`, rne`) is my choice; GNU objdump prints `rne` too when the mode is static, and omits `dyn`.

### What should be done in the future
- N/A.

### Code review instructions
- `src/typed/backend/encode.ts` (`decodeFloat`, `FLOAT_OPS`, `encodeOne`), `src/typed/ilp32f.ts`, `src/typed/reference.ts`.

### Technical details
- fsw is the S format with opcode 0x27: `(instruction.s(2, rs1, rs2 & 31, imm) & ~0x7f) | 0x27`.

## Step 3: Merge of the coordinator's branch (framework performance, O2+)

The coordinator asked me to merge `irwb-001/import-v6-prototype` at 93da6cc, which makes the framework 3–5× faster on Candela with no hash changes, and adds `O2+` to `PIPELINES`. The merge touched none of my files.

### Prompt Context
**User prompt (verbatim):** the coordinator, mid-task: "For information: commit 93da6cc on `irwb-001/import-v6-prototype` makes the framework 3–5× faster on Candela, with no hash changes. Every corpus revision and image revision is identical. […] Merge the branch when convenient before your Candela O2 or image runs. Also note `O2+` in `PIPELINES` (O2 then `subst`). Record the merge in your diary as a step."
**Assistant interpretation:** Merge that branch into mine now; use the faster framework for the Candela image runs.
**Inferred user intent:** Candela experiments on this branch get the framework speed-up.
**Commit (code):** 621845e — "IRWB-001 P4.5: merge irwb-001/import-v6-prototype (93da6cc: framework performance, O2+)"

### What I did
- `git merge --no-ff -m "…" irwb-001/import-v6-prototype` with my uncommitted work in the tree (no file in common: the merge changed `src/framework/core/data.ts`, `src/framework/ir/{adapters,common}.ts`, `src/typed/passes.ts`, two strategy tests and ticket files).

### Why
- The image runs project Candela's revisions and lower large images; they benefit directly.

### What worked
- The merge was clean (ort strategy).

### What didn't work
- N/A.

### What I learned
- The O2 run of Step 1 was then at `dce r6` after about 14 minutes, on the c3689c1 build. Since the merge leaves every revision hash the same, its head is the head the merged build would produce, so I let it finish instead of restarting it.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- The claim "same head" rests on the coordinator's statement that hashes are unchanged; I check it when I load the saved head (its `rev` and the statement counts must match diary 04 step 9: r13, 9,479 statements).

### What should be done in the future
- N/A.

### Code review instructions
- `git show 621845e --stat`.

### Technical details
- N/A.

## Step 4: Lowering, two register classes, frames; the corpus unchanged and Candela at r0 compiling and agreeing

This step wrote the lowering of every f32 operator and of the new constructs, the f register class in the allocator, the frame with an outgoing area and an array area, class-aware spill code, and ilp32f runs in `runImage`. The i32 corpus's images are identical by revision under seven option sets. The fixture agreed with the evaluator on 2,800 of 2,800 cases at the first run, and every Candela function compiled at r0 into 189,216 bytes, with 3,300 of 3,300 decided cases agreeing at 10 cases per function.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The lowering, allocation and image-check parts of the goal.
**Inferred user intent:** See Step 1.
**Commit (code):** 9e96e22 — "IRWB-001 P4.5: the f32 RV32F backend: f register class, ilp32f calls and returns, caddr, aaddr, zero, F encodings; ilp32f.ts shared with reference.ts"

### What I did
- `select.ts`:
  - virtual registers of class f (`fregs`), a class-aware `move` (`addi rd, rs, 0` or `fsgnj.s rd, rs, rs`);
  - the f32 tiles of the table in the file's header (design-doc 05 §4.1), `round` as the reference's `FloatMethods.round` with virtual registers instead of t5, t6 and ft11;
  - f32 constants: `fmv.w.x rd, zero` for +0, else the bits by `li` into an x register and `fmv.w.x`;
  - `caddr`: `lw cap, 0(r)`, `bltu p, cap, L`, `ebreak`, `L:`, then `slli` and `add` (or one `addi` for a constant position);
  - `aaddr` as `addi rd, sp, 4·outgoing + c`, and an `aaddr` address folded into the load or store (`sw v, c(sp)`);
  - `zero`: `sw zero` per word up to 64 bytes, else a three-instruction loop;
  - calls under ilp32f (`argumentLocations`): moves into a0–a7 and fa0–fa7, `fmv.x.w` for an f32 beyond fa7, `sw`/`fsw` into the outgoing words; a single result from a0 or fa0;
  - record results: after the call the leaves stay where they return. `result#k` reads the register itself (a0–a7, fa0–fa7) or loads its outgoing word. The selector refuses (`unsupported`) a `result#k` that is not in the block of its call or comes after another call;
  - `return (…)`: stack leaves first (`sw`/`fsw` at the caller's sp, marked `caller`), then the register moves, marked `pins`. A leaf read from a register that another leaf's move writes is copied first;
  - entry: parameters from their ilp32f locations (an f32 in an x register through `fmv.w.x`, a stack word through `lw`/`flw` marked `caller`); f32 locals live on entry zeroed with `fmv.w.x v, zero`;
  - the outgoing area: before selection, the most stack words any call of the function needs (`stackWords`).
- `regalloc.ts`: `allocate(…, fregs)` scans the x intervals with the x pools and then the f intervals with the f pools, with the same loop. The parameter reservation uses the copy's source register (`m.rs1`, which is a0 + i for every integer parameter). A `pins` write of register r at index i forbids r to every interval with start < i < end.
- `compile.ts` `finish`: slots above `4·outgoing + arrays`; fs registers saved and restored with `fsw`/`flw`; f spills through ft10 and ft11; a copy with a spilled side is a single `flw` or `fsw`; a `caller` access gets `frame` added to its offset, through t6 (loads) or t5 (stores) = sp + frame when the sum exceeds 12 bits. `ImageFn.sig` is recorded for a function that needs ilp32f (`needsConvention`).
- `image.ts`: `ImageSig` and its validation. `run.ts`: `runImage(…, { sig, counts })` through `placeCall`/`readResults`, with fs0–fs11 patterns checked after the call (a change is a fault); `imageAgrees` passes the program's signature and `counts: false`; `imageFromCode(…, signatures)`.
- Commands: `npm run build`; `node scratchpad/probes/baseline.mjs $PWD > scratchpad/baseline-f32.json` and a comparison with Step 2's file; `node scratchpad/probes/fixture.mjs "" down scale ne`; `node --max-old-space-size=8192 scratchpad/probes/candela-r0.mjs 10`; `node --test tests/typed/backend.test.mjs tests/typed/f32.test.mjs tests/typed/candela.test.mjs`.

### Why
- **Result leaves read in place.** In a function that calls, no allocatable register of either class is an argument register (a0–a7 and fa0–fa7 are pooled only in leaves), so nothing but the next call or the return writes them. The lifter puts every `result#k` in its call's block before the next call (Step 1), and the selector checks that. So a leaf costs nothing until it is used, and a pass-through return (`return (result#0, …, result#25)` of a callee with the same leaf types) is a sequence of identity moves, which disappear.
- **`pins` instead of a general physical-register liveness.** Only a record return writes several physical registers in a row while virtual registers are still live (in a leaf function, where they may live in a0–a7 or fa0–fa7). Marking those writes keeps every other allocation decision, and so every corpus image, as it was. Marking all writes of physical registers would also have forbidden a0 to intervals that merely span a single return in the linear order (the interval hull), which changes corpus allocations.
- **The cheaper f32 spill copy only for f32.** The same single `lw`/`sw` for an i32 copy with a spilled side would change the corpus images under small register budgets (`registers: 1` in the tests, `registers: 2` in my baseline).
- **The signature in the image only where needed.** An integer function's `ImageFn` is unchanged, so the corpus images keep their revisions; an f32 function's image says how to call it, so the workbench's `runImage` calls work without knowing the program.

### What worked
- The corpus: `projects 44 differ 0 [] 5160`: the r0 image revision under all six option sets and the O2 image revision are identical to Step 2's for every project.
- The fixture: `true {"total":2800,"agree":2800,"disagree":0,"inconclusive":0}` (100 cases for each of 28 functions, 496 bytes).
- Candela r0: lifting and projecting 13.4 s, `compileImage` 7.5 s, 189,216 bytes for 332 functions; `{"cases":3320,"agree":3300,"disagree":0,"inconclusive":20,"values":3154}` (evaluator limit 2·10^5 statements, image limit 2·10^7 instructions).
- `node --test tests/typed/backend.test.mjs tests/typed/f32.test.mjs tests/typed/candela.test.mjs`: 22 tests, 21 pass, 1 skipped (`IRWB_CANDELA`).
- No Candela frame exceeds 2,032 bytes, so no large-frame form is needed.

### What didn't work
- `npx tsc --noEmit` reported `Cannot find name 'FT11'` in `compile.ts` once (a missing import); fixed.
- I had also changed `ImageIR`'s description to say RV32IMF and reverted it: a description is not hashed as far as I know, but the brief's first acceptance criterion is easier to argue with nothing in the IR definition changed.

### What I learned
- `floor` in the fixture compiles to the reference's sequence exactly: `fmv.s ft0, fa0; fmv.x.w t0, fa0; slli t0, t0, 1; lui t1, 0x96000; bgeu t0, t1, …; fcvt.w.s t0, fa0, rdn; fcvt.s.w ft1, t0, rdn; fsgnj.s ft0, ft1, fa0`.

### What was tricky to build
- **Keeping the i32 selection byte-identical.** The image revision depends on every instruction, and the allocation on the numbering of virtual registers (intervals tie-break on it). Each i32 path therefore makes the same `fresh()` calls in the same order as before: locals first, then each value's operands before its destination, the call's result register after the call. The new code paths are entered only for f32 types, `caddr`, `aaddr`, `result`, tuples, stack words and `zero`.
- **Target-directed f32 sequences.** `round` writes its destination first (the copy of x) and reads x afterwards. If the destination is x's own local the copy is skipped; otherwise both are live at once and receive different registers. Every other multi-instruction sequence writes its destination last.

### What warrants a second pair of eyes
- The `result#k` rule depends on the lifter's guarantee and on passes not moving `result` values across calls (they are impure). The selector fails loudly if it is broken, rather than reading a clobbered register.
- The fs0–fs11 check covers only the function the host calls; an internal callee that clobbered an fs register would show up only as a wrong result.

### What should be done in the future
- The interval hull (no holes) is conservative for `pins`: a value live in a block before and after a record return in linear order is refused that return's registers, even where it is not live at the return.

### Code review instructions
- `src/typed/backend/select.ts` (`call`, `leaf`, `returnTuple`, `round`, `float`, the entry), `regalloc.ts` (`allocate`, `scan`, `pins`), `compile.ts` (`finish`), `run.ts` (`runImage`).
- `node --test tests/typed/backend.test.mjs`; the baseline comparison in Step 2's probe.

### Technical details
- Frame, from sp upward: outgoing stack words (4·W bytes), frame arrays (`arrayBytes`), spill slots, saved registers (ra, then s and fs registers ascending), 16-aligned.
- f pools: non-leaf `ft0–ft7, ft8, ft9, fs0, fs1, fs2–fs11`; leaf `ft0–ft9, fa1–fa7, fa0, fs0–fs11`; `order: 'callee'` puts the fs registers first; `registers: n` takes the first n of each class.

## Step 5: The reference policies all load; a convention fixture; the tests; the Candela image tool

This step found that every reference policy, `kernel` included, now compiles Candela with the vendored pass groups. It added a second fixture for the conventions (record results with stack leaves, a pass-through and a swapped return, f32 arguments in x registers and stack words, fs registers across calls, frame arrays, checked f32 buffers), the test file `tests/typed/f32-backend.test.mjs`, and `tools/candela-image.mjs`, which measures our images and the reference's on the same cases.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Acceptance items 3–5: images against the evaluator and the reference image, the numbers, the tests.
**Inferred user intent:** See Step 1.
**Commit (code):** in the commit after this step (with the measurements of Steps 6 and 7).

### What I did
- `scratchpad/probes/policies.mjs`: `referenceCompile(candela, { policy })` for `stock`, `interactive`, `default`, `balanced`, `kernel`.
- `tests/typed/f32-backend-fixture.mjs` (`CONVENTION_FIXTURE`, 16 functions) and `tests/typed/f32-backend.test.mjs` (6 tests):
  1. every F encoding against its disassembly (and one word, `fadd.s ft0, ft1, ft2, rne` = 0x00208053, against its value); refusals of a wrong-class or virtual register and of a missing rounding mode;
  2. the scalar fixture: `imageAgrees` at 100 cases, every pair of 23 f32 edge values (and 8 i32 edges) on the one- and two-parameter functions, and 30 exact bit results (NaN saturation of `fcvt.w.s`, `fmin.s` with one NaN, ±0 order, payloads through `fsgnjn.s`, canonical NaN from arithmetic, ceil(−0.5) = −0, floor of ≥ 2^23 and of a NaN, `fcvt.s.wu` of 2^32 − 1); the floor sequence itself;
  3. the convention fixture: `imageAgrees` at 100 cases; the leaf placement in `big`, `bigSum`, `passBig`; `many` and `wide` (x registers, then stack words); fs saves in `keep`; zeroing (eight `sw zero`, and the loop); a checked read out of range traps; our image against the reference's `stock` image on 40 cases per function, and the reference image through `imageAgrees`;
  4. f spills (`registers: 1`), `registers: 2, spill: 'current'`, `order: 'callee'`, `hints: false` all agree; `machineCode` names f virtual registers `vfN`; a hand-assembled `fmv.w.x fs0, zero; ret` is a fault;
  5. Candela r0: 332 functions compile, fewer bytes than the reference's `stock`, 3 cases per function agree;
  6. `IRWB_CANDELA=1`: 100 cases per function at r0, and at the O2 head if `IRWB_CANDELA_HEAD` names a file saved by `tools/candela-o2.mjs --save`.
- `tools/candela-image.mjs`: compiles r0 (and a saved head with `--head`), the reference's images (`--policies`, default `stock,kernel`, as `imageFromCode(…, signatures)`), and runs every image on the same cases. Each of our images is judged by the evaluator of the revision it was lowered from, a reference image by the evaluator of r0, and our images also against the `stock` image. It sums instructions over the cases that every image and evaluator finished, and reports bytes, agreements and instructions per case per function and in total (`--json` writes all rows). `--invariant` also runs `rv32.image-agrees` through the `AnalysisManager`.
- Started `node --max-old-space-size=8192 tools/candela-image.mjs --count 100 --json scratchpad/image-r0.json` (task `bsodi34ym`).

### Why
- **A second fixture for the conventions.** The scalar fixture has only one- and two-parameter functions; none of its calls carries a record or a stack word. Candela exercises all of them, but its failures would be hard to read; the fixture makes each convention a small, named case.
- **Our image against the reference image directly,** besides both against the evaluator: the two compilers share no code except the vendored encoders' formats and `ilp32f.ts`, so an agreement there is an independent check of the convention.
- **The tool's own loop rather than only `imageAgrees`.** The invariant gives a verdict and counterexamples, but no per-function instruction counts and no reference images on the same cases.

### What worked
- All five policies compile Candela: `stock` 312,740 bytes (138 ms), `interactive` 260,540, `default` 501,664, `balanced` 501,012, `kernel` 434,996 (833 ms); 332 entries and 332 signatures each. The f32 agent's diary (04, Step 1) had found that only `stock` and `interactive` worked, before the pass groups were vendored.
- The convention fixture: `true {"total":1600,"agree":1600,"disagree":0,"inconclusive":0}` (1,780 bytes).
- Tool smoke test (`--count 10 --only mix,frameOf,hitMesh,traceAll,renderPixel,lobeNone,neeAt,evalMaterial`): 80 of 80 cases agree for r0, `stock` and `kernel`, 0 disagreements against `stock`; instructions per case r0 907.7, `stock` 1,458.6, `kernel` 792.7.
- `node --test tests/typed/f32-backend.test.mjs`: 5 pass, 1 skipped (after the fix below).

### What didn't work
- The first run of the test file failed on my own assertion in test 3: I expected `bigSum` to add leaves straight from fa0 and fa1 (`fadd.s …, fa0, fa1`). At r0 the lifter stores each leaf into a temporary (`t15 = result#2`), so the image copies each leaf once (`fmv.s ft9, fa0`, …). The assertion now checks those copies; reading leaves in place shows at the O2 head, where `subst` has merged the temporaries.
- The default Candela test took 36.8 s, mostly `lowerToImage`'s correspondence, which the test does not need; it now builds the artifact from `compileImage` directly.

### What I learned
- `mix` compiles to the same four instructions under our backend and the reference's `kernel` policy (`fsub.s`, `fmul.s`, `fadd.s fa0, fa0, …`, `ret`).
- In a function that calls, parameters are copied out of fa0–fa7 (the argument registers are not allocatable there) and copied back for a call: `swapTwice` spends four `fmv.s` before its call. This is the i32 allocator's rule carried over; see Step 6.

### What was tricky to build
- **Comparing images on one set of cases.** `runImage` takes the signature from the image (`ImageFn.sig`) or from the caller; a reference image gets its signatures from the reference compiler's `signatures` list, so both images place the same arguments the same way.

### What warrants a second pair of eyes
- A trap agrees with any trap (Compiler Workbench's verdict), so the trap cases are weaker evidence; the tool counts them apart (`traps`).

### What should be done in the future
- N/A.

### Code review instructions
- `tests/typed/f32-backend.test.mjs`, `tests/typed/f32-backend-fixture.mjs`, `tools/candela-image.mjs`.
- `node --test tests/typed/f32-backend.test.mjs`; `node tools/candela-image.mjs --count 10 --only mix,hitMesh`.

### Technical details
- Instructions per case = Σ steps over the decided cases / their number; a case is decided when every evaluator and every image finished within its limit (2·10^5 statements, 2·10^7 instructions).

## Step 6: fa0–fa7 for f values in functions that call

Step 5 showed every parameter of a calling function copied out of its fa register and back. Design-doc 05 §4.2 pools fa0–fa7 only in leaf functions, as the i32 allocator does with a0–a7. This step lets an f interval in a calling function take an fa register where a liveness analysis of the physical fa registers shows it free. Only the f class changes, so the corpus images are again identical; Candela r0 shrinks by 3.1%.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** An allocation improvement inside the brief's register-class design (it adds to the f pools of calling functions; the x class is untouched).
**Inferred user intent:** Instruction counts that measure the compiler, not a missed register.
**Commit (code):** 719e1d6 — "IRWB-001 P4.5: f values may use fa0-fa7 in functions that call, where a liveness of those physical registers leaves them free"

### What I did
- `select.ts`: a `call` records the registers its arguments are in (`MInsn.uses`); a `jexit` records the registers the return reads (a0, fa0, or the record's leaf registers).
- `regalloc.ts` `physicalOccupancy(code, F_ARGS)`: liveness of fa0–fa7 over the machine blocks (a bit mask per instruction). A register is read by rs1, rs2 and `uses`, and written by rd; a call writes all eight. Prefix counts give "occupied (live in or written) at some position in [a, b]" in constant time.
- `allocate`: in a function that calls, the f pool is ft0–ft9, fa1–fa7, fa0, fs0–fs11. An interval x may take fa_k unless fa_k is occupied strictly inside x, or fa_k is live after x's first position and that position is not a copy from fa_k (then both hold one value). The existing parameter reservation and `pins` still apply. Intervals that cross a call still need a callee-saved register.
- Commands: `npm run build`; `node scratchpad/probes/fixture.mjs scratchpad/conv.typed swapTwice keep`; `node scratchpad/probes/fixture.mjs ""`; the baseline comparison (`scratchpad/baseline-shared.json`); `node scratchpad/probes/candela-r0.mjs 10`.

### Why
- **Liveness, not the interval rule.** An argument register is written by every call and by the moves before it, and read by the call, the return and the copies after it. Those are physical events the virtual intervals do not see. Computing where each fa register holds a value is the smallest model that makes sharing safe.
- **Only the f class.** The same rule for a0–a7 would change the corpus's integer images (the book's numbers), which acceptance 1 forbids.

### What worked
- Corpus: `projects 44 differ 0 5160`.
- Convention fixture: 1,780 → 1,680 bytes, `true {"total":1600,"agree":1600,…}`; scalar fixture unchanged at 496 bytes, 2,800 of 2,800.
- `swapTwice` is now `jal ra, …; fmv.s ft0, fa1; fmv.s fa1, fa0; fmv.s fa0, ft0` (the parameters stay in fa0 and fa1 until the call), against eight copies before.
- Candela r0: 189,216 → 183,324 bytes; `{"cases":3320,"agree":3300,"disagree":0,"inconclusive":20,"values":3154}`.

### What didn't work
- No failures. The r0 measurement started in Step 5 (task `bsodi34ym`) runs the build before this change; I keep its numbers as the "before" and measure again on the final build.

### What I learned
- `keep` still copies each call result twice (`fmv.s ft0, fa0; fmv.s fs3, ft0`): at r0 a call result goes into a temporary and then into the named local; `subst` at O2 removes the temporary.

### What was tricky to build
- **The endpoints of an interval.** At its first position x is written; if fa_k is still needed after that, x may not live there, except when the write copies fa_k (a parameter's copy, a result leaf's copy). At its last position x is read; a write of fa_k there is harmless (the instruction reads x first), and fa_k live at the last position means it was live just before, which an inner position or the first-position rule already catches. Interval ends at a block's end plus 0.5 include the block's last instruction.

### What warrants a second pair of eyes
- `physicalOccupancy` treats a call as writing all of fa0–fa7 and reading only its argument registers; a callee reading an fa register that is not an argument would be a convention violation, so this is the convention itself.
- The intervals are hulls, so the rule is conservative across holes.

### What should be done in the future
- The same analysis for a0–a7 in the x class, as a separate, book-changing decision (it changes the corpus's numbers).

### Code review instructions
- `src/typed/backend/regalloc.ts` (`physicalOccupancy`, `clashes`, `scan`), `src/typed/backend/select.ts` (`uses` on `call` and `jexit`).
- `node --test tests/typed/f32-backend.test.mjs`.

### Technical details
- Occupied(r, p) = r ∈ liveIn(p) ∪ def(p); clash(x, r) = ∃p ∈ (start, end): occupied(r, p), or r ∈ liveOut(start) and code[start] is not `fmv.s x, r`.

## Step 7: The test suites, r0 at 100 cases, the O2 head; branch relaxation

This step collected four results. The full test suite passes. The `IRWB_FULL=1` corpus tests pass. Candela r0 agrees at 100 cases per function, and so do the reference's `stock` and `kernel` images. O2 on Candela finished with the head diary 04 reported. That head first failed to compile with a branch out of range, which led to branch relaxation. After it, every function compiles at the O2 head and agrees.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Acceptance 1 (the i32 corpus) and 2 (every function compiles at r0 and at the O2 head); the first half of 3.
**Inferred user intent:** See Step 1.
**Commit (code):** e3e91b1 — "IRWB-001 P4.5: branch relaxation (a conditional branch beyond ±4 KiB becomes an inverted branch over a jal); every Candela function compiles at the O2 head"

### What I did
- `npm test` (on 719e1d6), background task `bz0uwa3v0`.
- `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs` (task `b3cb8e6mf`).
- The r0 run of Step 5 (`tools/candela-image.mjs --count 100`, task `bsodi34ym`, on 9e96e22, before Step 6) finished.
- The O2 run of Step 1 (task `byfsir3x1`) finished and saved `scratchpad/candela-o2-head.json` (16,319,658 bytes).
- `node tools/candela-image.mjs --count 10 --policies stock --head scratchpad/candela-o2-head.json`, which failed (below).
- `compile.ts` `relaxBranches`, applied to every function's finished code: a conditional branch whose target is outside −4096…4094 bytes becomes the inverted branch to a new label `farN` right after a `jal zero, target` (note "a branch target beyond ±4 KiB"); repeated until nothing changes. An unknown target is left for the encoder to report. Exported from the backend's index.
- A test: an `if` arm of 300 f32 statements (about 8 KiB) relaxes its branch and agrees on 20 cases; `relaxBranches` on hand-made code (a branch 5,000 bytes back becomes `bge` over `j`; a near branch is unchanged).
- The baseline comparison again, and `node --test tests/typed/backend.test.mjs tests/typed/f32-backend.test.mjs`.

### Why
- **Relaxation after finishing, per function.** Displacements are known only once spill code, the frame and the exit sequence are in place. Branches never leave their function (calls are `jal` with ±1 MiB), so each function can be relaxed on its own before layout.

### What worked
- `npm test`: `tests 309`, `pass 307`, `fail 0`, `skipped 2` (the two `IRWB_CANDELA` tests), 53 s.
- `IRWB_FULL=1`: 21 of 21, among them "P2.6: the book's table against the reference compiler, and 5160 bytes against 7628" and "P2.6: corpus parity (all projects)".
- Candela r0 at 100 cases per function (build 9e96e22): `{"functions":332,"cases":33200,"decided":32985,"values":31617,"traps":1368,"bytes":{"r0":189216,"stock":312740,"kernel":434996},"agree":{"r0":32985,"stock":32985,"kernel":32985},"disagree":{"r0":0,"stock":0,"kernel":0},"inconclusive":{"r0":215,"stock":215,"kernel":215},"vsStock":{"r0":0},"perCase":{"r0":944.7,"stock":1598.6,"kernel":747.7},"ms":1012598}`. So our image, the `stock` image and the `kernel` image each agree with the evaluator on every decided case, and our image agrees with `stock` on every case both decided. The 215 inconclusive cases are the ones the f32 agent found (`skyBuild`, `cdlSky`, `cdlRenderSpan`, `fbm3`, `traceAOV` at the 2·10^5-statement limit).
- O2: `rev 13`, `head {"blocks":1970,"stmts":9479,"values":29963,"locals":10466}`, as in diary 04 Step 9; no pass rejected; final check `{"total":33200,"agree":33184,"disagree":0,"inconclusive":16}` (limit 2·10^5); pipeline 2,540 s and final check 222 s on the loaded machine (load average about 8).
- After relaxation, the head at 10 cases per function: `"bytes":{"r0":183324,"o2":151748,"stock":312740}`, `"agree":{"r0":3300,"o2":3300,"stock":3300}`, `"disagree"` 0 for all, `"vsStock":{"r0":0,"o2":0}`, `"perCase":{"r0":919.1,"o2":854,"stock":1574.8}`.
- The corpus: `projects 44 differ 0 5160` again; backend and f32-backend tests 20 pass, 1 skipped.

### What didn't work
- The O2 head did not compile:
  ```
  BackendError: [branchRange] branch of -4512 bytes is out of range
    code: 'branchRange',
  ```
  At r0 no branch was that long; after O2 one is (cfg merges blocks, and licm and lvn make loop bodies longer). Fixed by relaxation.
- The first relaxation test used a `for` loop with an 8 KiB body and found no long branch: the lifter places the loop's exit block right after its header (`blt t0, a0, 0xc` jumps 8 bytes), and the back edge is a `jal`. An `if` arm does need the long forward branch.
- My unit check `relaxBranches(code.slice(-100))` expected 100 instructions and got 102: the slice dropped the target label, and the first version relaxed a branch to an unknown label. It now leaves such a branch alone.

### What I learned
- The reference's `kernel` policy agrees with the evaluator on all 32,985 decided cases at 100 per function. That is the acceptance measurement of task gxe6 (design-doc 05 §6), obtained here in passing.
- At r0, our image runs 59% of the `stock` image's instructions and 126% of the `kernel` image's (944.7 against 1,598.6 and 747.7), in 60% of `stock`'s bytes and 43% of `kernel`'s.

### What was tricky to build
- Nothing beyond the label bookkeeping: a relaxed branch moves every later instruction, so the loop recomputes positions until no branch changes.

### What warrants a second pair of eyes
- The corpus never needs relaxation (it would have failed before), so relaxation cannot change a corpus image; the baseline comparison confirms it.

### What should be done in the future
- N/A.

### Code review instructions
- `src/typed/backend/compile.ts` `relaxBranches`; the test "a branch beyond ±4 KiB is relaxed".

### Technical details
- B-type range: −4096…+4094 bytes. A relaxed site costs one extra word: `b<inverted> rs1, rs2, farN; jal zero, target; farN:`.

## Step 8: The opt-in Candela test passes at r0 and at the O2 head; formatting; where kernel wins

This step ran the `IRWB_CANDELA=1` test, which checks `rv32.image-agrees` through the framework's `AnalysisManager` at 100 cases per function, on r0 and on the saved O2 head. It passed. In parallel the final measurement (Step 9) ran. I formatted my TypeScript with the repository's Prettier settings and looked at where the reference's `kernel` policy beats our r0 image.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Acceptance 3 through the image check itself (not only the tool's loop), and acceptance 5's opt-in test.
**Inferred user intent:** See Step 1.
**Commit (code):** 31df57c — "IRWB-001 P4.5: prettier on the backend and ilp32f.ts (formatting only; corpus image revisions unchanged)"

### What I did
- `IRWB_CANDELA=1 IRWB_CANDELA_HEAD=scratchpad/candela-o2-head.json node --max-old-space-size=12288 --test tests/typed/f32-backend.test.mjs` (task `bky99iuas`, build e3e91b1).
- `npx prettier --check` on my files: six were not in the repository's style (`.prettierrc.json`); the base `select.ts` of c3689c1 was. `npx prettier --write src/typed/backend/*.ts src/typed/ilp32f.ts src/typed/reference.ts`; removed a leftover `void t` in the selector's parameter loop.
- The baseline comparison and `node --test tests/typed/f32-backend.test.mjs` after formatting.
- From Step 7's r0 rows (`scratchpad/image-r0.json`): functions ranked by Σ instructions (ours − kernel); `scratchpad/probes/show.mjs noise3` (our and the kernel's code, calls counted).

### Why
- The tool and the invariant use the same verdict (`agrees`), but only the invariant is what a pass contract would use; the acceptance names `imageAgrees`.

### What worked
- `✔ P4.5: Candela images agree on 100 cases per function at r0 and at the O2 head (IRWB_CANDELA=1) (335526.161309ms)`; 7 of 7 tests pass.
- After formatting: `projects 44 differ 0 5160`; f32-backend tests 6 pass, 1 skipped.
- Where the gap to `kernel` is (r0, Step 7's build): 6.50 million instructions over the decided cases in total, of which `fbm3` 2.00 million and `cdlRenderSpan` 1.51 million, then the scenes' material and SDF functions (`s16_mat_0` 0.25 million, …). Our image wins on the record-returning dispatchers (`s15_evalMaterial` 215.1 against 407.0 instructions per case, `hitEmission` 391.5 against 574.8, `noHit` 60 against 157) and on leaves such as `hitAABB` (32 instructions, no frame, against 51 with a 208-byte frame).
- `noise3`, which `fbm3` calls in its loop: our image makes 14 calls (`q_floor` ×3, `q_fract` ×3, `gnoise` ×8), the `kernel` image 8 (`q_floor` and `q_fract` are inlined).

### What didn't work
- No failures.

### What I learned
- The kernel policy's advantage on Candela's hot code is inlining (its `inline` pass group), which belongs to the middle end; our O2 has no inline pass. The backend's own code is as good or better where no call is involved.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- The test prints no counts, only the verdict (0 disagreements and the minimum agreement); the counts come from the tool in Step 9, which uses the same verdict on the same cases.

### What should be done in the future
- An inline pass in the middle end (for small leaf callees like `q_floor`, `q_fract`) would close most of the gap to `kernel`; that is outside the backend.

### Code review instructions
- `IRWB_CANDELA=1 IRWB_CANDELA_HEAD=<head.json> node --test tests/typed/f32-backend.test.mjs` (about 6 minutes; the head from `node tools/candela-o2.mjs --save <head.json>`).

### Technical details
- The opt-in test's check: `imageAgrees({ count: 100, inputs: candelaInputs(st), limit: 2e5, imageLimit: 2e7 })`, seed 7.

## Step 9: The numbers: r0, the O2 head, stock and kernel on 100 cases per function

This step is the final measurement. Our r0 and O2 images and the reference's `stock` and `kernel` images ran on the same 100 cases per function. No image disagrees with the evaluator on any case, and our images agree with `stock` on every case both decided. The O2 image is 48.5% of `stock`'s bytes and runs 54.4% of its instructions. Against `kernel` it is 34.9% of the bytes and runs 116.4% of the instructions.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Acceptance 3 and 4: zero disagreements on 100 cases per function with the reference image as a second oracle; bytes and instructions per case, per function and in total, at r0 and at O2, against `stock` and `kernel`.
**Inferred user intent:** See Step 1.
**Commit (code):** this step's commit (the run used build e3e91b1; 31df57c after it only reformats).

### What I did
- `/usr/bin/time -v node --max-old-space-size=12288 tools/candela-image.mjs --count 100 --head scratchpad/candela-o2-head.json --policies stock,kernel --json …/various/experiments/f32-backend-01-candela-images.json --table …/f32-backend-01-candela-images.tsv` (task `b2z3nsqme`).
- `tools/candela-image-summary.mjs` (new): a Markdown summary of the JSON (totals, ratios, the largest gaps and wins against `kernel`), written to `various/experiments/f32-backend-01-candela-images.md` with the command and build.

### Why
- The JSON keeps every function's row (bytes, agreements, instructions per decided case of every image); the TSV is the per-function table; the Markdown is the readable summary.

### What worked
- Totals (32,985 of 33,200 cases decided by every image and evaluator; 31,617 values, 1,368 traps):

  | image | bytes | agree | disagree | inconclusive | instructions | per case |
  |---|---:|---:|---:|---:|---:|---:|
  | r0 | 183,324 | 32,985 | 0 | 215 | 30,380,140 | 921.0 |
  | O2 | 151,748 | 32,990 | 0 | 210 | 28,706,118 | 870.3 |
  | stock | 312,740 | 32,985 | 0 | 215 | 52,730,673 | 1,598.6 |
  | kernel | 434,996 | 32,985 | 0 | 215 | 24,662,932 | 747.7 |

- Against `stock` (the second oracle): `"vsStock":{"r0":0,"o2":0}`.
- Ratios: r0/stock bytes 58.6%, instructions 57.6%; r0/kernel 42.1% and 123.2%; O2/stock 48.5% and 54.4%; O2/kernel 34.9% and 116.4%; O2/r0 82.8% and 94.5%.
- O2 against r0 per function: 180 functions run fewer instructions, 21 more; the largest increase is `fbm3` (+37,458 instructions over its decided cases), then `s15_sdf_0` (+4,600), `s16_bumpN_1` (+4,144).
- Largest gaps to `kernel` at O2: `fbm3` 1.82 million instructions, `cdlRenderSpan` 0.87 million, `s16_mat_0` 0.21 million (Step 8: inlining).
- Wall clock 22 min 26 s on the shared machine, 1.54 GB maximum resident.
- Against Step 7's r0 (before Step 6): 189,216 → 183,324 bytes and 944.7 → 921.0 instructions per case (−2.5%) from sharing fa0–fa7.

### What didn't work
- My first waits used `until ! pgrep -f "<pattern>"` loops; `pgrep -f` matched the loop's own command line, so they never ended. I stopped them (`TaskStop`) and waited on the output file instead.

### What I learned
- O2 helps the backend less than its statement count suggests (−23% statements, −5.5% instructions, −17% bytes). Most removed statements were constant assignments that were cheap anyway, and the licm and lvn copies cost a move each where the allocator does not coalesce them.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- "Decided" is the intersection over all four images and both evaluators. That is why O2 alone decides 5 cases more (32,990) than the common set (32,985).

### What should be done in the future
- See Step 10.

### Code review instructions
- `ttmp/2026/11/24/IRWB-001--ir-workbench/various/experiments/f32-backend-01-candela-images.{md,tsv,json}`; `node tools/candela-image-summary.mjs <json>`.

### Technical details
- Cases: `casesFrom(r0 store, fn, { count: 100, seed: 7, inputs: candelaInputs })`; the same cases for every image.

## Step 10: Where this differs from design-doc 05, and what is open

This step closes the task. It runs the final validation on the last commit and lists what I did differently from design-doc 05 §4, and why, together with what remains open.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The report's "what differs from design-doc 05, and why" and "open issues".
**Inferred user intent:** The coordinator can merge the branch and plan the per-scene kernels (ckco) on it.
**Commit (code):** this step's commit.

### What I did
- `npm test`; `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs` on the final code (results in What worked).

### Why
- The final code differs from the measured build only by formatting (31df57c) and tools; the suites confirm it.

### What worked
- `npm test` on 31df57c plus the tools: `tests 310`, `pass 308`, `fail 0`, `skipped 2` (the two `IRWB_CANDELA` tests), 67 s.
- `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs`: 21 of 21, including "P2.6: the book's table against the reference compiler, and 5160 bytes against 7628" and "P2.6: corpus parity (all projects)".

### What didn't work
- N/A.

### What I learned
- Differences from design-doc 05 §4:
  1. **fa0–fa7 in calling functions (Step 6).** The design pools fa0–fa7 only in leaves. The f class also uses them in functions that call, wherever a liveness of the physical fa registers leaves them free. The x class is allocated exactly as the design says (and as the book does).
  2. **Record-result leaves are read in place (Step 4).** The table says "ilp32f result locations"; it does not say whether leaves are copied out. They are read straight from a0–a7, fa0–fa7 and the outgoing words, and the selector refuses a `result#k` after another call.
  3. **Branch relaxation (Step 7)** is new; the O2 head needs it.
  4. **`rv32.image` records `fns[f].sig`** for functions that need ilp32f, so `runImage` can call them without the program. Integer functions have none, so corpus image revisions do not change.
  5. **`runImage` checks fs0–fs11** after the call it makes, because the interpreter checks only x registers.
  6. **`src/typed/ilp32f.ts`** holds the convention for the backend's runner and `reference.ts`.
  7. **Frames over 2,032 bytes** (the reference's large-frame form) are not implemented, because no Candela function needs one at r0 or at the O2 head.
  8. **The kernel policy works.** The design expected `kernel` numbers only "if the vendored inline, loops and kernel pass groups load". They do, and `kernel` agrees with the evaluator on all 32,985 decided cases, which is task gxe6's measurement.
- Open issues:
  - The gap to `kernel` (116% of its instructions at O2) is mostly inlining (`fbm3` → `noise3` → `q_floor`, `q_fract`), a middle-end pass this compiler does not have.
  - f32 constants are materialized at every use (`lui`/`addi` and `fmv.w.x`), inside loops too. The reference keeps constants in registers ("constant homes").
  - O2 makes 21 functions slower than r0 (Step 9). Their copies from licm and lvn are not coalesced.
  - a0–a7 are still not shared in calling functions, because sharing them would change the book's integer images.
  - The fs check covers only the entry function. Internal calls are checked only through the results.
  - The O2 head file (16 MB) is not committed. `node tools/candela-o2.mjs --save <file>` makes it again (about 40 minutes before the merged framework speed-up; the coordinator measured 3–5× faster).
  - I did not update the ticket's `tasks.md` and `changelog.md`. The coordinator edits them on its branch; the task to tick is owi2.

### What was tricky to build
- See Steps 4, 6 and 7.

### What warrants a second pair of eyes
- `physicalOccupancy` and `clashes` in `regalloc.ts` (Step 6), and the `result#k` rule in `select.ts` (Step 4), are the two places where correctness depends on reasoning about physical registers outside the virtual-register intervals.

### What should be done in the future
- An inline pass for small leaf callees; constant homes for f32 constants in loops; coalescing of copies (or a check of whether the backend should treat `vn`/`inv` copies as moves).

### Code review instructions
- Start at `src/typed/backend/select.ts` (header table), then `regalloc.ts`, `compile.ts` (`finish`, `relaxBranches`), `run.ts` (`runImage`), `src/typed/ilp32f.ts`; tests in `tests/typed/f32-backend.test.mjs`.

### Technical details
- Branch commits: 9e96e22, 621845e (merge), cf9d11d, 719e1d6, e327c75, e3e91b1, 1a40b2b, 31df57c, dc39d94, and this step's.
