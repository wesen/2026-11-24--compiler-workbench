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
ExternalSources: []
Summary: "Investigation diary of the subagent that extends the RV32 backend with RV32F (task owi2, design-doc 05 §4), so that every Candela function compiles to an image that agrees with the evaluator."
LastUpdated: 2026-11-24T22:40:00-05:00
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
