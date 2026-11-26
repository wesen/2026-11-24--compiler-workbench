---
Title: 'Intern guide: closing the speed gap with inlining, copy coalescing, constants in registers and loop rotation'
Ticket: IRWB-003
Status: active
Topics:
    - compiler
    - ir
    - candela
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/backend/compile.ts
      Note: 'compileFunction and finish: where variants are compared; options recorded in the image'
    - Path: repo://src/typed/backend/options.ts
      Note: 'backendDefaults and checkBackendOptions: the frozen options and the new extras'
    - Path: repo://src/typed/backend/regalloc.ts
      Note: 'linear scan with one interval per virtual register: where coalescing feeds in'
    - Path: repo://src/typed/backend/select.ts
      Note: 'block order, constants at every use, target-directed copies: what layout, homes and coalescing change'
    - Path: repo://src/typed/backend/variants.ts
      Note: per-function choice of options by the estimate
    - Path: repo://src/typed/evaluate.ts
      Note: 'evaluate and meaningKept: the semantics inlining must preserve (fresh zero locals, result leaves)'
    - Path: repo://src/typed/inline.ts
      Note: the inline pass as built (section 22)
    - Path: repo://src/typed/passes.ts
      Note: typedPass, dfe (the model for a program pass), PASSES and PIPELINES where inline, rotate and O3 register
    - Path: repo://src/typed/rotate.ts
      Note: the rotate pass as built
    - Path: repo://src/typed/tx.ts
      Note: 'Tx: origins, declared writes, commit; every edit of inline and rotate goes through it'
ExternalSources: []
Summary: 'For a new intern: the parts of the Typed to RV32 compiler that decide how many instructions a program executes, the measured gap to the reference compiler and its causes, and the design of the four changes that close it: an inlining pass, loop rotation with a block layout, copy coalescing and constant homes in the backend, behind a new O3 pipeline and default-off backend options.'
LastUpdated: 2026-11-26T01:10:00-05:00
WhatFor: Understanding and implementing IRWB-003, and reviewing it.
WhenToUse: Before changing src/typed/inline.ts, src/typed/rotate.ts, src/typed/backend/{coalesce,homes,layout,estimate}.ts, or the O3 pipeline.
---

# Intern guide: closing the speed gap

This guide explains one milestone of the IR Workbench project: making the code this compiler produces execute fewer instructions, so that it comes closer to the reference compiler from the PicoCalc toolchain. The compiler today is correct and small; it is also slower than the reference by a measured margin, for reasons that have been identified one by one. The milestone adds four transformations that address those reasons, and it does so without changing any number that the project's book or its tests depend on.

You should be able to read this guide without having read anything else in the repository, although the IRWB-002 intern guide (`ttmp/2026/11/24/IRWB-002--research-agenda-…/design-doc/01-…md`) goes into more depth on the framework. Part 1 explains the parts of the system that decide how many instructions a program executes. Part 2 shows where the instructions go today, with the measurements. Part 3 is the design of the four changes. Part 4 is the implementation and validation plan, with a reference of files and functions.

Three conventions hold throughout.

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `420d8e1`, the commit this milestone starts from. Line numbers drift; the symbol names next to them do not.
- **Numbers are measurements with a source.** Each one names the test, script or diary step it comes from. A number derived by counting instructions in a listing is called an *estimate* and shows the count.
- **"Proposed" marks what does not exist yet.** Everything in Part 1 and Part 2 exists in the code at `420d8e1`. The designs in Part 3 are what this milestone builds.

# Part 1: The parts of the system that decide speed

## 1. What the milestone is for

The compiler translates **Typed**, a statically typed subset of JavaScript, into machine code for **RV32**, the 32-bit RISC-V instruction set of the PicoCalc's processor. It is built on a framework, IR Workbench v6, in which every version of the program is an immutable artifact, every optimization is a pass with declared reads and writes, and every pass application is accepted only if the new program still means what the original meant. Section 4 explains that last check; it is the reason the transformations in this guide can be written without fear of silently producing a wrong program.

A second compiler exists for the same language: the reference compiler, vendored from the ds-js-os repository as `vendor/ds-js-os/compiler/typed/typed-rv32.js`. This project uses it only as an *oracle*: its images are run on the same inputs to check our evaluator and our images, and its instruction counts are the yardstick for ours. On the book's benchmarks, measured on the emulator with one fixed input each (`tests/typed/backend.test.mjs:511–515`; reproduced by `scripts/01-benchmark-probe.mjs`, output in `various/06-benchmarks-o2.txt`):

| benchmark | r0 (no passes) | ours after O2 | reference |
|---|---:|---:|---:|
| Blend | 531 | 451 | 383 |
| Checksum | 446 | 366 | 292 |
| insertion sort | 2,022 | 2,022 | 1,533 |
| Collatz | 1,590 | 1,590 | 1,486 |

On Candela, the 332-function path tracer that is the project's large program, the gap is of the same order. Over 100 generated cases per function, our O2 image executes 870.3 instructions per case against 747.7 for the reference compiler's `kernel` policy (IRWB-001, `various/experiments/f32-backend-01-candela-images.md`). Rendering a scene with a program specialized to that scene, ours takes 10,435 instructions per pixel on the scene B-01 and 22,851 on R-01, against 8,501 and 15,656 for `kernel` (IRWB-001 diary step 27).

The reference compiler does three things ours does not: it inlines calls, it rotates loops so that the loop test sits at the bottom, and it unrolls kernels. The analysis behind the Candela numbers (IRWB-001, f32 backend diary steps 8–10) found three causes on our side: calls that `kernel` inlines, f32 constants rebuilt at every use, and register copies that the allocator does not remove. This milestone addresses four items of the IRWB-002 research agenda:

- **E3, inlining**: replace a call by a copy of the callee's body.
- **G1, loop rotation and block layout**: make a loop iteration end in one conditional branch instead of a jump and a branch.
- **H2, copy coalescing**: give the two sides of a register copy the same register when that is safe, so the copy disappears.
- **Constants in registers**: build each constant once per function into a register, instead of at every use.

**What must not change.** The pipeline `O2`, the default backend options and the book's numbers are frozen. They are the evidence that this compiler reproduces the prototype it was ported from. Four checks must stay green and give identical results at the end of the milestone: `npm test`; `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs`; `node tools/parity.mjs`; and `ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs`, which prints the revision hashes of r0, of every O2 revision and of the O2 image for each of the 44 corpus projects. A changed hash in that last output means the freeze was broken. All new behaviour therefore goes into a new pipeline, `O3`, and into new backend options whose defaults leave every image exactly as it is.

## 2. The path from source text to executed instructions

```text
 main.typed                                 Typed source
    │  vendored front end: parse, type-check, emit a stack-machine tape
    ▼
 typed.blocks r0                            src/typed/lift.ts   lift(), ingest() :758
    │  passes, each checked against r0      src/typed/passes.ts, src/typed/program.ts
    ▼                                       (O2 today; O3 in this milestone)
 typed.blocks rN
    │  per function:                        src/typed/backend/
    │    select     tiles → machine code on virtual registers     select.ts:131
    │    allocate   virtual → physical registers (linear scan)    regalloc.ts:233
    │    finish     spill code, frame, prologue and epilogue      compile.ts:67
    │  then lay out functions, encode       compile.ts:321
    ▼
 rv32.image                                 the bytes, and per instruction what it implements
    │  run on the vendored RV32 interpreter  src/typed/backend/run.ts:74  runImage()
    ▼
 result, memory, instruction count
```

Two of the four changes act in the middle of this path, on `typed.blocks`: inlining and loop rotation are passes. The other two act inside the backend: coalescing is part of allocation, and constants in registers are part of selection. A fifth piece, the block layout, is a backend option that decides the order in which a function's blocks are emitted. The rest of Part 1 explains each stage at the level of detail these changes need.

## 3. The main IR: `typed.blocks`

`typed.blocks` is a control-flow graph whose statements hold expression trees. Its types are in `src/typed/model.ts`, its validator and projection in `src/typed/ir.ts`.

- A **function** (`FnRec`, `model.ts:123`) has parameter types, a result type, a list of **locals** and an ordered list of **blocks**. Locals are numbered from 0; the first `params.length` locals are the parameters. A local is a mutable variable, not a single-assignment value: `s` and `i` in a loop are assigned several times.
- A **block** (`BlockRec`, `model.ts:137`) has an ordered list of statement ids and a list of successor block ids. Its last statement is normally a terminator (`br`, `br_if`, `return` or `trap`). The first block of a function is its entry.
- A **statement** (`StmtRec`, `model.ts:146`) is one of eight operations: `set` (assign a local), `store`, `eval` (evaluate for effect), `br`, `br_if`, `return`, `trap`, `zero`. A statement refers to its value trees through the fields `value`, `cond` and `addr`, and to blocks through `to`, `then`, `else`.
- A **value** (`ValueRec`, `model.ts:166`) is a node of an expression tree: an operator, argument value ids, an optional immediate (`imm`) and an optional `type: 'f32'`. **A value has exactly one user**: trees are never shared. `get` reads a local (its `imm` is the local's index); `call` calls the function named by its `imm`.

Ids carry their function: `fn:blend`, `bb:blend.3`, `s:blend.7`, `v:blend.25`. New ids come from counters stored in the artifact (`Store.fresh`, `model.ts:232`), so running the same pass on the same revision allocates the same ids and produces the same revision hash.

Here is Blend after O2, as the listing prints it (`various/06-benchmarks-o2.txt`):

```text
function blend(work: buffer, n: i32, a: i32, b: i32): i32
bb:blend.0  -> [.1]
    s:blend.1    s = 0
    s:blend.2    i = 0
    s:blend.15   inv = ((a * b) + 64)
    s:blend.3    goto .1
bb:blend.1  -> [.2, .3]
    s:blend.4    if (i >= n) goto .2 else .3
bb:blend.2  -> []
    s:blend.14   return (s / 8)
bb:blend.3  -> [.4, .7]
    s:blend.5    t7 = i
    s:blend.6    if (t7 >=u load32[work+0]) goto .4 else .7
bb:blend.4  -> []
    s:blend.7    trap
bb:blend.7  -> [.1]
    s:blend.10   s = (s + (load16[(work + (t7 << 1))+4] * inv))
    s:blend.11   i = (i + 1)
    s:blend.12   goto .1
```

Notice three things that the rest of this guide comes back to. The loop test is in its own block, `bb:blend.1`, at the top of the loop, and the loop body ends with `goto .1`. The bounds check of `work.charCodeAt(i)` reads the buffer's capacity from memory (`load32[work+0]`) and copies `i` into a temporary `t7` first. And the check's failure path is a block of its own that holds only `trap`.

### 3.1 Calls, record results and frame arrays

Three constructs matter for inlining.

**Calls sit at the root of a statement.** In lifted code a call is the whole value of a `set`, an `eval` or a `return`: the lifter (`lift.ts:410`) assigns values to temporaries around calls instead of leaving a call inside a larger tree. Over Candela's 918 calls at r0, every one is in such a position (`scripts/02-candela-shapes.mjs`, `various/05-candela-r0-call-shapes.json`: `"calls":918,"rootCalls":918,"nestedCalls":0`), and the corpus's call projects look the same:

```text
function energy(a: i32, b: i32, c: i32): i32
bb:energy.0  -> []
    s:energy.0   t4 = sq(a)
    s:energy.1   t5 = sq(b)
    s:energy.2   t6 = sq(c)
    s:energy.3   e = ((t4 + t5) + t6)
    s:energy.4   t7 = clamp(e, 0, 5000)
    s:energy.5   return (t7 + ((a * b) * c))
```

**A function can return a record**, as a list of scalar leaves. Its `FnRec.results` lists the leaf types, and its return statements return a `tuple(…)` value. A call to such a function is the value of an `eval` statement, and the caller reads leaf *k* with a `result` value whose `imm` is *k*. In the evaluator, `result#k` reads "leaf *k* of the latest multi-result call in this frame" (`evaluate.ts:405`); the backend additionally requires the read to be in the same block as the call and before any other call (`select.ts:392–396`). 180 of Candela's 332 functions return records (`various/05-…`). `hash3` is one:

```text
function hash3(p__x: f32, p__y: f32, p__z: f32): V3f
    ...
    s:hash3.16   return (((u2f((x >>> 8)) *. k) -. 1f), ((u2f((y >>> 8)) *. k) -. 1f), …)
```

**A frame array** is a byte area in a function's stack frame (`FnRec.arrayBytes`), addressed with `aaddr off` and cleared with the `zero` statement. Two Candela functions have one (`various/05-…`).

### 3.2 Origins

Every statement, value, block and function carries `origin: Origin[]` (`model.ts:101`):

```ts
interface Origin { from: string; via: string; kind: 'recorded' | 'derived' | 'made';
                   rev?: number; because?: string[]; note?: string }
```

`from` is the entity the new one was made from, `via` the pass, `rev` the revision it was made in, and `because` the entities or facts that make the change valid. `Program.why(id)` (`program.ts:457`) follows `from` and `because` recursively through all stored revisions. That is how the workbench answers "why is this statement here?": for Blend's hoisted `s:blend.15 inv = ((a * b) + 64)`, `why` reaches source line 5 through `from`, and the loop fact through `because` (IRWB-002 guide §11). Inlining must keep this working: an inlined statement must lead `why` both to the callee statement it copies and to the call it replaced.

## 4. Passes, transactions and the meaning contract

### 4.1 Two ways to write a pass

Most passes are written with `typedPass(spec)` (`passes.ts:165`). The spec names the pass, the analyses it needs, the *write kinds* it may use (`values`, `stmts`, `locals`, `cfg`), the analyses it claims to preserve, and a `body`. The wrapper makes a mutable working copy of the input (`Store.from`), and **calls `body` once for every function**, each time with a fresh transaction `tx` for that function. If any transaction made an edit, it returns the new native value, the edit list and a correspondence between the two revisions.

A pass that must see the whole program at once is written with the framework's `definePass` directly. The only such pass today is `dfe`, dead-function elimination (`passes.ts:963–1045`). Its `run({ before, params })` builds its own store, removes functions, computes the correspondence itself and returns `{ native, correspondence, edits, report }`. It is wrapped with `typed: { …, program: true }` so that the strategy registry does not try to make per-function variants of it (`strategies.ts:116–118`). Inlining is a whole-program pass in this sense, because it reads one function (the callee) while editing another (the caller); `dfe` is its model.

### 4.2 The transaction

A pass body never edits the store's tables directly; it goes through `Tx` (`tx.ts:165`). Its methods create values (`const`, `make`, `get`), locals (`local`), statements (`set`, `stmt`), blocks (`block`), and place, move, replace or remove statements (`insert`, `move`, `replaceStmt`, `setField`, `remove`). Two rules make a transaction more than a convenience:

- **Declared writes are enforced.** Every method checks that the pass declared the write kind it is about to use and throws `TxError('undeclaredWrite')` otherwise (`tx.ts:179`). The framework later checks the same thing at the level of the projection's entity and relation kinds.
- **Every created entity gets an origin** (`tx.ts:187`): `from` is `opts.from` (or the value being rebuilt), `via` the pass name, `rev` the new revision number, and `because` from `opts.because`. A removal without a `because` is refused (`tx.ts:354`).

`tx.commit()` (`tx.ts:503`) recomputes every block's successors from its terminator and deletes blocks no path from the entry reaches.

### 4.3 What `applyPass` checks

`applyPass` (`src/framework/passes/define-pass.ts:190`) runs a pass and publishes nothing unless every stage succeeds: it freezes and hashes the result, diffs the two projections, refuses writes outside the declaration (`undeclaredWrite`), checks the contract the caller supplies (`contractRejected`), and checks each preservation claim (`preserveViolated`). `Program.apply` (`program.ts:248`) always supplies the **optimization contract** (`optimizationContract`, `passes.ts:221`), whose single condition is the invariant `typed.meaning-kept` (`meaningKept`, `evaluate.ts:564`).

### 4.4 The meaning contract

`typed.meaning-kept` generates cases (a function, arguments and an initial memory image) from r0, runs r0 and the candidate on each with the evaluator `evaluate` (`evaluate.ts:345`), and compares the outcomes with `agrees` (`evaluate.ts:531`): a trap agrees with any trap; otherwise the results and the memory written must be equal. By default it uses 40 cases per function, seed 7, and a step limit of 20,000 statements; a case that hits the limit on either side is *inconclusive* and decides nothing.

Two parameters matter here.

- **The comparison is always against r0**, the program as lifted, never against the previous revision. A transformation applied after ten others is judged by what the source means.
- **`roots`** restricts the comparison to the program's entries (`MeaningParams.roots`, `evaluate.ts:547`). A `Program` created with `options.entries` (`program.ts:98`) passes them (`program.ts:262`). Without entries, every function is compared, so a function may change only in ways that keep its own meaning, and no function may disappear. With entries, functions that only the entries call may change or vanish, which is what `dfe` needs. Candela's gallery has four entries: `cdlLayout`, `cdlInit`, `cdlSky`, `cdlRenderSpan` (`ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/12-candela-per-scene.mjs:19`).

Inlining interacts with both. Without entries, an inlined callee stays in the program and is still compared on its own cases; its body is also compared, inside its callers, through the callers' cases. With entries, `dfe` can remove a callee that no longer has a call site, and it is then checked only through the entries.

The evaluator also defines facts inlining must preserve. Every call gets fresh locals, all zero (`evaluate.ts:370`): a callee's local that is read before it is written reads 0. Calls may nest at most 64 deep (`evaluate.ts:368`). And every statement costs one step towards the step limit.

## 5. The backend in the detail the changes need

The backend works one function at a time (`compileFunction`, `compile.ts:288`): select, then allocate, then finish.

### 5.1 Selection

`select` (`select.ts:131`) walks the blocks **in the order of `f.blocks`** (`select.ts:736`) and tiles each statement's value tree onto *virtual registers*, numbered from 64 so they never collide with the 64 physical ones (x0–x31 are 0–31, f0–f31 are 32–63). Each local gets one virtual register for the whole function (`localReg`, `select.ts:142`). Three behaviours of the selector decide most of what this milestone changes:

- **Assignments are target-directed.** `set x = e` computes `e` straight into `x`'s register (`val(s.value, localReg[s.local])`, `select.ts:747`). When `e` is a plain `get y`, the result is a register copy: `addi vx, vy, 0`, marked `mv: true` (`move`, `select.ts:162`; `val` case `get`, `select.ts:520–526`). An f32 copy is `fsgnj.s vx, vy, vy`.
- **Constants are rebuilt at every use.** An i32 constant that fits 12 bits and has an immediate form is folded into the instruction (`addi`, `slti`, `lw` offsets). Otherwise `li` builds it into a register: one `addi` or a `lui` and an `addi` (`select.ts:147–155`). An f32 constant is built as its bits in an x register and moved across with `fmv.w.x` (`select.ts:502–514`): two or three instructions, at every use, including uses inside loops.
- **Branches and fall-through follow the block order.** For `br_if c then T else E` with the next block in order `N`, the selector emits one branch if `T` or `E` is `N`, and a branch plus a `j` otherwise (`branch`, `select.ts:629–667`). A `br T` emits `j T` unless `T` is `N` (`select.ts:787–789`). The only layout today is `'source'`: the order the blocks have in the IR.

### 5.2 Allocation

`allocate` (`regalloc.ts:233`) computes liveness over the machine code's basic blocks, builds **one interval per virtual register** from its first to its last occurrence, stretched over whole blocks where it is live in or out (`intervals`, `regalloc.ts:85`), and scans the intervals in start order. Each interval gets a free physical register that does not clash, preferring caller-saved registers (`t0–t4`; `a0–a7` in leaf functions; the f class similarly), then callee-saved ones (`s1–s11`, `fs0–fs11`). An interval that spans a call must take a callee-saved register. If none is free, the interval that ends last is spilled: it lives in a stack slot for its whole life (`regalloc.ts:299–315`). There is no live-range splitting.

**Hints** let a parameter prefer its argument register and a returned value `a0` (`select.ts:724–725`, `:799`; `regalloc.ts:294–298`). They are the only form of coalescing today, and they apply only to copies from or to a physical register.

### 5.3 Finishing

`finish` (`compile.ts:67`) rewrites virtual registers onto the allocation and inserts spill code (a reload before each use of a spilled register into the scratch `t5`/`t6` or `ft10`/`ft11`, a store after each definition). It builds the frame: from the bottom, the outgoing stack words of calls, the frame array area, the spill slots, and the saved registers (`ra` unless the function is a leaf, then every callee-saved register the allocation used). Two of its rules matter here:

- **A copy whose two sides got the same physical register is dropped** ("coalesced", `compile.ts:158–162`). This is why coalescing can be done by giving two virtual registers the same register: the copy then disappears without further work.
- **A jump to the label that follows is dropped** (`compile.ts:193–213`), so block order decides how many jumps survive.

### 5.4 The calling convention and frames

Calls follow ilp32f (`src/typed/ilp32f.ts`): integer arguments in `a0–a7`, f32 arguments in `fa0–fa7`, the rest in stack words; one result in `a0` or `fa0`; a record's leaves in `a0–a7`, `fa0–fa7` and stack words that the callee writes. A call therefore costs at least: a move per argument into its register, `jal ra`, a move of the result out of `a0`; in the callee, saving and restoring `ra` and every callee-saved register it uses, and adjusting `sp`. That fixed cost is what inlining removes, and it is a large share of a small callee's cost.

### 5.5 Images and their options

The result of the backend is an artifact of the IR `rv32.image` (`Rv32Image`, `image.ts:80`). It records the code as base64, one record per instruction with the IR entities it covers, and **the backend options it was compiled with** (`compile.ts:409`). The options come from `checkBackendOptions` (`options.ts:61`), which merges the caller's options over `backendDefaults` (`options.ts:29`), and the image validator requires exactly the keys of `backendDefaults` (`image.ts:171–172`). Since an artifact's revision is the hash of its value, adding a key to `backendDefaults` would change the revision of every image ever compiled, and with it the frozen output of `scripts/08`. Section 16.1 shows how new options avoid that.

## 6. How speed is measured

Three instruments measure instructions, each with a different scope.

- **The benchmark table.** `tests/typed/backend.test.mjs:505–537` runs five corpus functions on one fixed input each: our image at r0, our image after the project's pipeline, and the reference compiler's default image. `scripts/01-benchmark-probe.mjs` in this ticket runs the same cases with any pipeline and backend options, and prints the code.
- **Candela per case.** `tools/candela-image.mjs` lowers r0 and a saved O2 head, compiles the reference's `stock` and `kernel` images, and runs all four on 100 generated cases per function, comparing every result with the evaluator. It reports bytes, agreement and instructions per decided case.
- **Candela per pixel.** `ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/13-candela-per-scene-images.mjs` specializes the program to one scene (`specialize` on the field `K.scene`, a light cleanup, `dfe` from the four entries, optionally `O2+`), lowers it, renders the scene at stride 4 with our image and with the reference `kernel` image, and compares every output float. Instructions per pixel is the emulator's count for the frame divided by the number of pixels rendered.

The second and third instruments compare *frames* or *results* bit for bit against an independent implementation. That comparison is stronger than the meaning contract's 40 sampled cases: a pass that the contract accepted but that changes one pixel shows up here.

## 7. Candela per-scene programs

The gallery renders 18 scenes with one program. Five dispatcher functions read `K.scene` and branch to scene-specific functions (`s<k>_…`). Specializing on one value of that field turns each dispatch into one direct call, and `dfe` then removes every function no call reaches from the four entries: each scene keeps 135–147 of the 332 functions (IRWB-001 diary step 26). After `dfe`, 55 of the 131 non-entry functions of B-01 have exactly one static call site, 29 of them with at most 20 statements (IRWB-001 diary step 28, `scripts/14-candela-call-sites.mjs`). Those are the functions inlining removes at no cost in size: the call goes, the body moves to its one caller, and `dfe` deletes the original.

# Part 2: Where the instructions go

## 8. Blend, instruction by instruction

The O2 image of Blend, from `various/06-benchmarks-o2.txt`, with the IR statement each instruction implements:

```text
  addi t0, zero, 0          s = 0                          once
  addi t1, zero, 0          i = 0                          once
  mul  t2, a2, a3           inv = (a * b) + 64             once
  addi t2, t2, 64
bb.1:
  blt  t1, a1, bb.3         if (i >= n) goto .2 else .3    every iteration, and once at exit
bb.2:  srai … ; ret         return s / 8                   once (6 instructions)
bb.3:
  addi t3, t1, 0   ; copy   t7 = i                         every iteration
  lw   t4, 0(a0)            load32[work+0]                 every iteration
  bltu t3, t4, bb.7         the bounds check               every iteration
bb.4:  ebreak               trap
bb.7:
  slli t3, t3, 1            work + (t7 << 1)               every iteration (6 instructions)
  add  t3, a0, t3
  lhu  t3, 4(t3)            load16[…+4]
  mul  t3, t3, t2           … * inv
  add  t0, t0, t3           s = s + …
  addi t1, t1, 1            i = i + 1
  jal  zero, bb.1           goto .1                        every iteration
```

One iteration is 11 instructions; 40 iterations and the 11 instructions outside the loop give 451. The reference's 383 is 68 fewer. Two of the 11 are overhead this milestone can remove:

- **The `jal` back to the test.** If the test sat at the bottom of the loop, the iteration would end with one conditional branch back to the body. This is loop rotation plus a block order in which the exit follows the loop (sections 10 and 12). Estimate: 40 instructions.
- **The copy `t7 = i`.** `t7` and `i` never hold different values while both are needed: `t7` is last read in `s:blend.10`, and `i` changes only after it, in `s:blend.11`. They can share a register, and the copy disappears (section 13). Estimate: 40 instructions.

Both together give an estimate of 451 − 80 = 371, below the reference's 383. The capacity load `lw t4, 0(a0)` is a third candidate: nothing in the loop stores to memory, so it could be loaded once. That needs the memory-dependence analysis of agenda item A3, which is not part of this milestone.

Checksum has the same shape: 9 instructions per iteration, of which the `jal` and a copy `t3 = i` are overhead (`various/06-…`); removing both gives an estimate of 366 − 80 = 286 against the reference's 292.

## 9. Sort, Collatz and Candela

**Insertion sort** gains nothing from O2: 2,022 instructions at r0 and after O2. Its inner loop `while (j > 0 && work.charCodeAt(j - 1) > work.charCodeAt(j))` is lifted into a test block `bb:sort.4` (`if (j > 0) goto .5 else .6`), the `&&` is a temporary `t11`, and the body reads `j` through three copies (`t5 = j`, `t6 = j`, `t8 = j`) that sit in different blocks, so neither `lvn` nor `subst` removes them. Per inner iteration, the image executes the `jal` back to `bb:sort.4` and three copies that coalescing can remove (`various/06-…`, the sort listing).

**Collatz** also gains nothing from O2: 1,590 at r0 and after O2, against 1,486. Its loop, 111 iterations for `n = 27`, ends with `jal zero, bb.1` back to the test `x > 1`, and its iterations build i32 constants into registers: `1` for the test `x > 1` (which compares two registers) and `2` for `x % 2` on every iteration, and `3` for `3 * x` on the odd ones. Rotation removes the `jal`; constants in registers remove the `addi rd, zero, c` from the loop. The loop is `while (x > 1 && steps < 1000)`, and the `&&` is lifted as a temporary `t3` that two blocks assign: the header's test `x > 1` is not the loop's exit test, which comes one block later (`if !(t3) goto .5`). Section 10 returns to this shape.

**Candela** differs in what dominates. Our O2 image executes 4,043,187 more instructions than `kernel` over the decided cases (the net gap; 28,706,118 against 24,662,932). The functions where ours is slower account for 5,307,267 of them, and the ones where ours is faster win back 1,264,080 (`scripts/03-candela-gap-totals.mjs` on IRWB-001's `f32-backend-01-candela-images.tsv`, output in `various/07-candela-o2-gap-totals.txt`). Two functions hold half of the 5.31 million: `fbm3` with 1,816,438 and `cdlRenderSpan` with 870,470. `fbm3` calls `noise3` once per octave, and `noise3` calls `q_floor` three times, `q_fract` three times (each of which calls `q_floor` again) and `gnoise` eight times: 14 calls per `noise3`, against 8 in the `kernel` image, which inlines `q_floor` and `q_fract` (f32 backend diary step 8). Each call pays the convention of section 5.4: argument moves, `jal`, result move, and in the callee a frame and saved registers. The constants `3.0` and `2.0` in `noise3`'s smoothing polynomial, and `1.0` and `±2.1e9` in `q_floor`, are each rebuilt at every use in two or three instructions. And O2 makes 21 of Candela's functions *slower* than r0, the largest `fbm3` (+37,458 instructions), because the copies that `licm` and `lvn` introduce into loops cost a move each (f32 backend diary step 9).

The table below maps each measured cause to the change that addresses it.

| cause | evidence | change |
|---|---|---|
| a jump back to the loop test per iteration | Blend, Checksum, sort, Collatz listings | `rotate` pass and `layout: 'loops'` (§10, §12) |
| copies between locals that never hold different values at once | Blend `t7 = i`, sort `t5/t6/t8 = j`, licm/lvn copies in Candela | `coalesce` option (§13) |
| constants rebuilt at every use, in loops | Collatz `1, 2, 3`; f32 constants in `noise3`, `q_floor` | `homes` option (§14) |
| calls to small functions and to functions with one call site | `noise3`: 14 calls against 8; 55 single-site functions in B-01 | `inline` pass (§15) |

# Part 3: Design

> **After implementation.** Part 3 is the design as written before the code. Section 22 at the end records what was built, the measured results, and where the implementation departs from this design: the layout became its own option `chains` (not `layout: 'loops'`), the pipeline is named `speed` (not `O3`), and the layout is chosen per function by the estimate like the other options.

The milestone has five pieces: two passes on `typed.blocks` (`rotate` and `inline`) and three backend options (`layout: 'loops'`, `coalesce` and `homes`). Each can be turned on alone, measured alone and reviewed alone. The three backend options share one notion of where a function spends its time, the block frequencies of section 11, which the layout uses to order blocks and which the other two use to decide whether they pay.

## 10. Loop rotation as header duplication (`rotate`, proposed)

### 10.1 The idea

Three words name the blocks around a loop. The **header** is the block a loop's back edge jumps to; in lifted code it holds the loop test. The **latch** is the block that jumps back to the header, at the end of an iteration. The **preheader** is the block outside the loop that jumps into the header, once, when the loop starts. In Blend, `bb:blend.1` is the header, `bb:blend.7` the latch and `bb:blend.0` the preheader.

A loop as the lifter makes it has its test in the header, at the top. Every iteration executes the test, falls into the body, and ends with an unconditional jump from the latch back to the header:

```text
 before                                after
 pre:   …            goto head         pre:   …            if !(c) goto exit else body
 head:  if !(c) goto exit else body    body:  …
 body:  …                                     …            if !(c) goto exit else body
        …            goto head         exit:  …
 exit:  …
```

Rotation copies the test into every block that jumps to the header unconditionally. The preheader's copy is called the **guard**: it decides whether the loop runs at all. The latch's copy is the new bottom test: it decides whether the loop runs again. The header then has no predecessors and disappears.

This transformation is correct whatever the condition does, including reading memory or trapping, because it is *tail duplication*: each path that jumped to the header now executes a copy of the header's statements at exactly the point where it would have executed the original, and executes it once. No evaluation is added, removed or moved past another statement. (Presentations of rotation that require a pure condition evaluate the guard somewhere else, for example before code that was in the preheader; header duplication does not.)

### 10.2 Rules

`rotate` is a `typedPass` with `needs: { loops: 'loops' }`, `writes: ['stmts', 'values', 'cfg']`, and no preservation claims:

```text
rotate(f):
  for each header H of a loop of f (the loops fact, analyses.ts:207), each H once:
      require H is not f's entry block and H still exists
      require H.stmts = [ s ] with s.op = 'br_if'          # a header that is only its test
      require s.cond contains no 'call' and no 'result'     # keeps the result-leaf rule (§3.1)
      for each block P whose last statement is 'br H':
          c' <- a copy of the tree s.cond, with fresh value ids
          replace P's 'br H' by 'br_if c' then s.then else s.else'
              origin: from s, because [the loop's id, H], note 'loop test duplicated into P'
  tx.commit()                                               # H, now unreachable, is pruned
```

A header with more statements than its test is left alone in this milestone; all the measured loops have single-statement headers (`various/06-…`). A predecessor that reaches `H` through a conditional branch keeps that branch, so `H` survives; the transformation is still correct, and only the paths that ended in `br H` gain.

### 10.3 When the header's test is not the exit test

In Blend the header's test is the loop's exit test: one target leaves the loop, the other is the body. After rotation the body's first block is the new header, the guard is the only way in, and the loop is a natural loop as before.

In Collatz and in sort's inner loop the header tests the first half of an `&&` (section 9), and *both* of its targets are inside the loop. Duplicating that test into the preheader and the latch gives a loop that can be entered at two blocks. Such a loop is called *irreducible*: no single block dominates the others, so the `loops` fact, which finds natural loops from back edges to a dominating header (`analyses.ts:207–241`), no longer reports it.

This is valid and safe, for three reasons. The program computes the same thing, by the tail-duplication argument of 10.1. The dataflow solver widens at the target of every retreating edge of a depth-first search (`depthFirst`, `src/framework/dataflow/solver.ts:63`), and every cycle contains such an edge, so the interval analysis still terminates. And the passes that need natural loops (`licm`) simply find no loop there, so they do nothing to it. The consequence is about order: `rotate` runs after `licm` in O3. The backend does not depend on loop structure, except through block frequencies, which section 11 defines without natural loops for this reason.

### 10.4 What rotation alone does and does not buy

After rotation Blend's latch ends with `if (i >= n) goto .2 else .3`. In source order the latch is the last block of the function, so no target follows it, and `branch` emits `bge i, n, bb.2` and `j bb.3`: two instructions, the same as before. Rotation removes the jump only if the block that follows the latch is one of its targets. That is the job of the layout, which needs to know which blocks are hot.

## 11. Block frequencies and the cost estimate (proposed)

The backend has no profile. It estimates how often each block of a function executes per call, from the shape of the control flow alone, in `src/typed/backend/frequency.ts`.

### 11.1 Branch probabilities

A **strongly connected component** (SCC) of a function's CFG is a maximal set of blocks each of which can reach every other. An SCC with more than one block, or with a block that jumps to itself, is a *cycle*: a loop, reducible or not. For a block `b` ending in `br_if c then T else E`, the probability that it goes to each target is:

```text
prob(b -> T), prob(b -> E):
  T or E holds only 'trap'                     -> 0 to it, 1 to the other    (checks rarely fail)
  T in b's cycle, E outside it (or the reverse) -> 0.88 to stay, 0.12 to leave   (loops iterate)
  T in a cycle b is not in, E in none (or the reverse) -> 0.88 to enter it          (loops get entered)
  otherwise                                    -> 0.5 each
a block ending in 'br T' goes to T with probability 1
```

The numbers 0.88 and 0.12 are the loop-branch probabilities of Ball and Larus's static branch prediction; only their order matters for the uses below.

### 11.2 Frequencies

```text
freq(entry) = 1
freq(b)     = [b = entry] + Σ over predecessors p of b:  freq(p) · prob(p -> b)
```

The equations are solved by sweeping the blocks in reverse postorder until no frequency changes by more than 10⁻⁹, at most 200 sweeps, with each frequency capped at 10⁹ (a loop whose only exit is a trap has no finite solution). For Blend after rotation: the guard enters the loop with 0.88; the loop block `bb.3` has `freq = 0.88 + 0.88 · freq(bb.7)` and `freq(bb.7) = freq(bb.3)`, so both are 0.88 / 0.12 ≈ 7.33; the exit block `bb.2` gets 0.12 + 0.12 · 7.33 = 1.0; the trap block gets 0.

### 11.3 The cost estimate

```text
cost(function) = Σ over the finished code's instructions of freq(the IR block the instruction belongs to)
```

An instruction belongs to the IR block whose label most recently precedes it in the finished code. The prologue precedes the first block label and the epilogue follows the `exit` label; both count with the entry's frequency, 1. The estimate counts everything that executes: spill reloads and stores, saves and restores, copies and jumps that survived. It is used only to compare two compilations of the *same* function, never two functions.

The two options that change how registers are used decide with it, per function, in a fixed order:

```text
compileFunction(f, o):
  best <- compile(f, o without coalesce and homes)
  if o.coalesce:  v <- compile(f, best's choices + coalesce);  if cost(v) < cost(best): best <- v
  if o.homes:     v <- compile(f, best's choices + homes);     if cost(v) < cost(best): best <- v
  return best
```

A tie keeps the variant without the option, so a function in which an option changes nothing compiles exactly as without it. The layout is not decided this way: when `layout: 'loops'` is given, every variant uses it.

## 12. Block layout (`layout: 'loops'`, proposed)

`BackendOptions.layout` gets a second value, `'loops'`, which emits a function's blocks in an order computed from its control flow instead of the IR's order. The order changes nothing in what the program computes, only which branches fall through.

### 12.1 Algorithm

The layout is a greedy chain construction in the style of Pettis and Hansen, with the static frequencies of section 11 in place of a profile:

```text
layout(f):
  weight(b -> s) <- freq(b) · prob(b -> s)                 for every edge of every terminator
  chains <- one chain [b] per block
  for each edge (b -> s) by weight descending, then by position of b in f.blocks, then of s:
      if b is the last block of its chain, s is the first block of its chain,
         the chains differ, and s is not f's entry:
          append s's chain to b's chain
  order <- the entry's chain, then the other chains in the order of their first block in f.blocks
```

A chain is a sequence of blocks that will be emitted one after another, so linking `b` to `s` makes `s` the fall-through of `b`. Heavy edges are linked first, so edges inside loops become fall-throughs before edges that leave loops. A back edge can never be linked, because its target already starts the chain that ends with its source; the latch's next candidate is then its exit edge, which is what rotation needs.

On rotated Blend (frequencies from 11.2), the edges by weight are `bb.3 → bb.7` (7.33), `bb.7 → bb.3` (6.45), `bb.0 → bb.3` and `bb.7 → bb.2` (0.88 each), `bb.0 → bb.2` (0.12) and `bb.3 → bb.4` (0). The first links `bb.3, bb.7`; the back edge cannot be linked; `bb.0 → bb.3` gives `bb.0, bb.3, bb.7`; `bb.7 → bb.2` gives `bb.0, bb.3, bb.7, bb.2`; the trap block `bb.4` is a chain of its own and comes last:

```text
 bb.0:  … bge  i, n, bb.2        the guard falls into the body
 bb.3:  t7 = i; lw; bgeu t7, cap, bb.4
 bb.7:  … addi i, i, 1; blt i, n, bb.3     one branch per iteration
 bb.2:  return s / 8
 bb.4:  ebreak
```

### 12.2 Fall-through without a terminator

The evaluator lets a block without a terminator fall through to `succ[0]` (`evaluate.ts:476`), and with the source layout the selector relies on that successor being the next block. With `'loops'`, the selector emits `j succ[0]` for such a block when `succ[0]` is not next. All blocks in `various/06-…` end in a terminator; the rule makes the layout safe for the others.

## 13. Copy coalescing (`coalesce`, proposed)

### 13.1 When two registers can be one

A copy `d ← s` can be removed by giving `d` and `s` the same register, provided there is no point in the program where both are needed and they hold different values. The standard test, Chaitin's, is on *interference*: `d` and `s` interfere if one of them is defined at a point where the other is live afterwards, except at the copy itself, where they hold the same value by construction.

```text
interferes(x, y):
  exists an instruction i, other than a copy between x and y, such that
      (i defines x and y is live after i) or (i defines y and x is live after i)
```

For Blend's `t7 = i`: `t7` is defined by the copy and live until `s:blend.10`; `i` is defined at `i = 0` and at `i = i + 1`; at neither point is `t7` live, and at the copy they are equal. They do not interfere, and the copy goes.

### 13.2 Where it runs

Coalescing runs on the selected machine code, between `select` and `allocate`, in `src/typed/backend/coalesce.ts`:

```text
coalesce(code, fregs, hints, freq):
  live-after(i) for every instruction i     (backwards per machine block; machineBlocks, regalloc.ts:41)
  for every instruction i, every r defined by i, every q of r's class live after i, q != r:
      unless i is a copy (mv) whose source is q:  add an edge r -- q
  candidates <- every mv instruction rd <- rs with both virtual, both of one class, rd != rs
  sort candidates by the frequency of their block, descending (§11)
  for each candidate rd <- rs:
      a <- find(rd), b <- find(rs)
      if a != b and no edge between the members of a and of b:
          union(a, b); the union's edges <- edges(a) ∪ edges(b); keep one hint
  rename every virtual register r to find(r); drop every copy 'mv r <- r'
```

The rest of the backend is unchanged: the allocator sees fewer virtual registers, with longer intervals, and `finish` has fewer copies to emit. Copies from or to a physical register (parameters, call results, return values) are not candidates; hints already handle them (§5.2).

### 13.3 Why it can lose, and the guard

The allocator gives each virtual register one interval from its first to its last occurrence. Merging two registers merges their intervals, and a longer interval can cross a call (it must then take a callee-saved register, which costs a save and a restore per call of the function) or be spilled when neither part would have been. Under linear scan with whole intervals, coalescing is therefore not a guaranteed gain, and the cost estimate of 11.3 decides per function.

## 14. Constants in registers (`homes`, proposed)

### 14.1 The idea

A *constant home* is a virtual register that holds one constant for the whole function. It is built once, after the entry's parameter copies, and every use of the constant reads it. The candidates are:

- every f32 constant: each use otherwise costs two or three instructions (`lui`, perhaps `addi`, `fmv.w.x`), or one for `+0.0` (`fmv.w.x rd, zero`);
- every i32 constant that the selector builds with `li` into a fresh register because no immediate form applies: Collatz's `1` in `x > 1`, `2` in `x % 2`, `3` in `3 * x`. An i32 constant computed straight into an assignment's target (`x = 5`) is not a candidate, since a home would replace one `addi` by one copy.

### 14.2 Two selections

The selector does not know in advance which constants it will build into registers; that depends on the tile it chooses for each use. So `homes` selects twice:

```text
select with homes:
  first selection, recording each constant built into a register:
      key = (class, bits), and the frequency of the block it was built in (§11)
  chosen <- keys whose uses' frequencies add up to more than 1
            (used inside a loop, or more than once per call)
  second selection, with a new virtual register home(key) for each chosen key:
      after the parameter copies:  li t, bits ; fmv.w.x home, t     (f32)
                                   li home, value                    (i32)
      at each use:                 the home register (or a copy into an assignment's target)
```

### 14.3 "When registers allow"

A home is live from the entry to its last use, so in a function with many constants or many calls it competes for registers. If it spills, every use becomes a reload from the stack, which saves instructions but adds memory traffic; if it crosses a call, it needs a callee-saved register, which costs a save and a restore. The cost estimate decides (11.3): the variant with homes is kept only if it is cheaper.

Placing a home at the preheader of the loop that uses it, instead of at the entry, would shorten its interval. That is a refinement for the case where the measurements show homes refused because of register pressure; it is not part of the first implementation.

## 15. Inlining (`inline`, proposed)

### 15.1 The transformation

Inlining a call site replaces the call by a copy of the callee's body. In a CFG IR with mutable locals the steps are:

```text
inline(caller f, statement s at index k of block B, call c = g(a_0, …, a_n)):
  1. locals:   for each local l of g: a new local l' of f, of l's type, named g_<l.name>
  2. split:    C <- a new block; move B.stmts[k+1 …] to C; C.succ <- B.succ
  3. enter:    in B, at index k: p'_i = a_i for each parameter (the argument trees move here)
               l' = 0 for each non-parameter local of g live at g's entry
               br entry'
  4. copy:     for each block b of g: a new block b'; each statement and value tree copied with fresh ids,
               locals renamed l -> l', blocks renamed b -> b'
  5. returns:  each 'return e' in the copy becomes, by s's kind:
                 s = 'x = g(…)'     ->  x = e' ; br C        (s itself is removed)
                 s = 'eval g(…)'    ->  eval e' if e' has an effect ; br C   (records: 15.3)
                 s = 'return g(…)'  ->  return e'             (C is not needed)
  6. commit:   successors from terminators; unreachable blocks pruned
```

Step 3's zeroing reproduces the evaluator's fresh frame (section 4.4): without it, a callee inlined into a loop would see its locals' values from the previous iteration. Only locals that are live at the callee's entry need it, because only they are read before being written; the liveness fact of `g` gives them (`liveView(…).liveIn(entry)`, `analyses.ts:305`).

Step 5's first case writes the result straight into the caller's local instead of into a result local followed by a copy. It is valid because the callee's copied trees read only the renamed callee locals, never `x`.

### 15.2 Which call sites

```text
eligible(c in s, caller f, callee g):
  s.op in { set, eval, return } and c is the whole value of s     # 918 of 918 Candela calls
  g != f, and g is in no cycle of the call graph                  # Candela has none
  g has no frame array (arrayBytes)                               # 2 of 332 Candela functions
  the result-leaf rule (15.3) holds
  size(g) <= maxSize                                              # a small callee
     or (sites(g) = 1 and size(g) <= maxSingle)                   # its only call site
  size(f), counting what this application already inlined, + size(g) <= maxCaller
```

`size` counts statements. `sites(g)` counts static call sites in the input revision. The three limits are pass parameters, with initial defaults of 16, 200 and 3,000 statements, to be calibrated on the measurements. Callee bodies are always taken from the **input revision**, never from the working copy: one pass application inlines one level, deterministically, and a second application inlines the next. `O3` runs `inline` twice, which covers `noise3 → q_fract → q_floor`.

Calls inside a statement's tree, rather than at its root, are not inlined. Supporting them requires splitting the evaluation of the tree around the call, which is only valid when the parts evaluated before the call are pure; no such call exists in Candela or the corpus (section 3.1), so the extra rule is not worth its risk now.

### 15.3 Record results and the result-leaf rule

A record-returning callee is called by `eval g(…)` and its leaves are read by `result#j` values after the call. Inlining it:

```text
  r'_0 … r'_m      new locals, one per leaf type of g.results
  each 'return tuple(e_0, …, e_m)' in the copy  ->  r'_0 = e'_0 ; … ; r'_m = e'_m ; br C
  each 'result#j' that read this call            ->  get r'_j
```

The tuple's leaves are assigned in order, which keeps their evaluation order, and none of them reads an `r'`, so assigning them one after another equals returning them together. Which `result#j` values read this call follows from the evaluator's rule "the latest multi-result call in this frame": they are the `result` values in the statements after `s` in `B`, up to the next statement that makes a multi-result call.

The *result-leaf rule* protects reads that belong to another call. Splitting `B` at `s` moves the statements after `s` into `C`, and the inlined body may itself make multi-result calls. So a site is refused when a statement after `s` in `B`, before the next multi-result call, reads a `result` while `s` is not itself a multi-result call: that read belongs to an earlier call, and inlining would separate it from its call. In lifted code, leaves are read immediately after their call, so the rule refuses nothing in practice; it exists so that the pass cannot produce a program the backend rejects (`select.ts:392–396`).

### 15.4 Provenance

Every entity the pass creates has one origin:

| entity | `from` | `because` | `note` |
|---|---|---|---|
| a copied block, statement or value | the callee's entity it copies | the call value and the call statement | `inlined from g into f at s` |
| a parameter assignment `p'_i = a_i` | the call value | `fn:g` | `argument i of g` |
| a zero assignment `l' = 0` | the call value | `fn:g` | `g's local l starts at 0` |
| the continuation block `C` | `B` | the call value | `after the call to g` |
| a leaf read rewritten to `get r'_j` | the `result` value | the call value | (the rebuilt tree's note) |

`Program.why` on an inlined statement then walks `from` to the callee's statement, and from there to the callee's source line, and `because` to the call, and from there to the caller's source line. That is the requirement of the brief: `why` traces an inlined entity both to the call and to the callee. The framework's correspondence (`revisionCorrespondence`, `passes.ts:116`) groups each copy under its callee entity with the call in `because`, so `Program.whyChain` gives the same answer through the framework. The removed call statement gets a `removed` entry with the call and `fn:g` as its reason.

### 15.5 Declaration and contract

`inline` is a `definePass` in `src/typed/inline.ts`, like `dfe`, wrapped with `typed: { name: 'inline', writes: ['stmts', 'values', 'locals', 'cfg'], program: true }`. Its projection writes are the union of those four kinds: entities `local`, `block`, `stmt.*`, `value.*`; relations `declares`, `contains`, `uses`, `operand`, `reads`, `writes`, `succ`, `jump`. It changes no `fn` entity: locals and blocks are not attributes of the `fn` projection (`ir.ts:326–329`), and frame arrays, which would change `arrayBytes`, are excluded.

The pass makes no assumption about entries. Under the full contract (no entries), every function is still compared, the inlined callees included. Under Candela's entry-only contract, `dfe` after `inline` removes the callees that lost their last call site.

### 15.6 What inlining costs

A copied body is a copy: a callee with *k* statements and *n* inlined call sites adds about *k*·*n* statements. Under `maxSize` the copies are small; under `maxSingle` the original disappears after `dfe` when entries are known, so the program does not grow. Without entries nothing can be removed, and the image grows by the inlined copies. Image bytes are part of every measurement in Part 4.

## 16. Options, the O3 pipeline, and the workbench

### 16.1 New backend options that leave every image as it is

```text
backendDefaults     the nine frozen options, unchanged (options.ts:29)
backendExtras       { coalesce: false, homes: false }               (proposed)
layout              'source' (default) | 'loops'                   (one more value)
checkBackendOptions accepts both tables' names; the result holds an extra only when it differs from its default
image validator     allows the keys of both tables (image.ts:171–172)
```

With these rules an image compiled with the default options has the same `options` object as before, so its revision hash is unchanged and `scripts/08` prints the same lines. An image compiled with `{ coalesce: true }` records `coalesce: true`, so two images of one revision with different options are different artifacts, as they should be.

### 16.2 The pipeline

```text
O3 = inline, inline, then O2+ (cfg, fold, simplify, constprop, fold, simplify, dce, cfg,
                               licm, lvn, strength, bce, subst, subst, dce, cfg, subst),
     then rotate, cfg
```

`inline` runs first so that O2's passes see the inlined code: constant arguments propagate into the copied bodies, `licm` hoists out of loops that now contain the callee's arithmetic, and `dce` removes what the call site did not need. `rotate` runs after `licm`, because `licm` needs natural loops with a preheader (section 10.3). The final `cfg` merges the blocks that rotation leaves in straight lines. This order is a starting point; Part 4 measures alternatives.

O3 contains no `dfe`: `dfe` needs the program's entries and refuses to run without them, and corpus programs have none. Where entries exist, as for Candela's per-scene programs, the measurement scripts run `dfe` after O3.

O3 is meant to be used with the new backend options. The strategy metrics (`measure`, `strategies.ts:66`) compile with the default options, so a strategy that compares O2 and O3 by instructions sees the passes' effect only.

### 16.3 The workbench

- `PIPELINES` gains `O3`; the Pipeline view and the Strategies view list pipelines from it (`site-src/views.js:795`, `site-src/compiler.js:316`).
- `PASSES` gains `inline` and `rotate`; the strategy registry registers every pass (`strategies.ts:111`), and the Compiler view finds each pass's source by its `id: 'typed.<name>'` or `name: '<name>'` line (`src/workbench/workbench.ts:635–652`).
- `PRESETS` gains `O3` (the pipeline as one plan) and `fastest-O3` (the best of O2, O2+ and O3 by instructions).
- The RV32 view's backend options block (`site-src/views.js:1033`) gains a row for `coalesce`, `homes` and `layout`.

Two workbench tests enumerate passes and pipelines (`tests/workbench/strategies.test.mjs:106`, `:112`); they grow by the new names. Everything shown in a workbench tile stays within 72 columns (`TILE_WIDTH`, `src/typed/format.ts`); new pass descriptions and preset texts are written to fit.

## 17. Decisions

| decision | alternatives | reason | consequence |
|---|---|---|---|
| Inline only calls at a statement's root | split trees around nested calls | every Candela and corpus call is at a root (§3.1) | a nested call, should one appear, stays a call |
| Callee bodies from the input revision | from the working copy as it changes | deterministic: one level per application, the same ids every run | O3 needs `inline` twice for two levels |
| Rotation by header duplication, also when both targets are inside the loop | only exit tests; classic rotation with a moved guard | duplication is valid for any test; Collatz and sort have non-exit headers | rotated loops can be irreducible; `rotate` runs after `licm` |
| Layout in the backend | reorder `f.blocks` in a pass | the backend sees the final CFG, whatever ran last | `rotate` changes instructions only together with `layout: 'loops'` |
| Frequencies from SCCs and static branch probabilities | natural-loop depth | rotation can make loops irreducible (§10.3) | one notion of "hot" for layout, coalescing, homes and the estimate |
| Coalescing and homes behind a cost estimate | always on | linear scan with whole intervals can lose when intervals grow | an option can only make a function cheaper by the estimate |
| New options outside `backendDefaults` | add keys to the defaults | the image records its options; new keys would change every image hash | two tables of defaults |
| i32 constants included in homes | f32 only | Collatz builds i32 constants in every iteration (§9) | one mechanism for both classes |

# Part 4: Implementation and validation

## 18. Order of work

Each step ends with tests, a diary entry and a commit.

1. **Options plumbing** (`options.ts`, `image.ts`): `backendExtras`, the second layout value, validation. Check that default images are byte-identical and `scripts/08` unchanged.
2. **Frequencies, the estimate and the layout** (`src/typed/backend/frequency.ts`, `layout.ts`); the hook in `select` (`order`) and in `compileFunction` (the comparison of variants).
3. **Rotation** (`src/typed/rotate.ts`), registered in `PASSES`. Measure Blend, Checksum, sort, Collatz with `rotate` + `layout: 'loops'`.
4. **Coalescing** (`src/typed/backend/coalesce.ts`), hooked into `compileFunction`. Measure the benchmarks and Candela per case.
5. **Constant homes** (`src/typed/backend/homes.ts` and a small hook in `select`'s `val` for constants).
6. **Inlining** (`src/typed/inline.ts`), with tests on `calls`, `call-chain`, `across-calls`, a record-result fixture and provenance.
7. **O3, presets and the workbench row.**
8. **Measurements**: benchmarks, the corpus under O3 with the new options, Candela per case, Candela per pixel for B-01 and R-01 (and all 18 scenes if time allows).
9. **The frozen checks**, diffed against the baselines in `various/01–04`.

## 19. Validation

**Correctness of each new pass.** Every application of `inline` and `rotate` runs under the meaning contract: on the 44 corpus projects with the full contract, and on Candela with the entry-only contract. A rejection is a bug in the pass, not something to tune away. Tests pin:

- `inline` on `calls`: `energy` no longer calls `sq` or `clamp`, and agrees with r0;
- `inline` on a record-returning fixture: leaves read through new locals, the result agrees;
- `inline` on a callee that reads a local before writing it, inlined into a loop: the zeroing keeps the result;
- provenance: `why` on an inlined statement has the callee statement under `from` and the call under `because`; `whyChain` gives a non-empty answer;
- `rotate` on Blend: the header block is gone, both copies of the test exist, `why` on a copy names the loop.

**Correctness of each backend option.** Every image compiled with new options is checked against the evaluator: `imageAgrees` (`run.ts:365`) on the corpus with each option alone and all together; on Candela, `tools/candela-image.mjs`-style agreement on 100 cases per function, and frame comparison for the per-scene programs (every float bit-identical to the reference's frame).

**Acceptance** (from the brief):

- with O3 and the new options: Blend ≤ 400 and insertion sort below 2,022, with every check agreeing;
- Candela: the general image's instructions per case, and per-scene instructions per pixel for B-01 and R-01 against `kernel`, frames bit-identical;
- every new pass accepted by its contract on the corpus and on Candela, with provenance tested;
- the frozen outputs identical: `scripts/08` diffed against `various/01-baseline-corpus-revisions.txt`, the suites green.

## 20. Risks

- **Compile time on Candela.** `inline` copies bodies and O3 then runs O2 on a larger program. Full-program O2 takes about 19 minutes (IRWB-001 design-doc 05 §9). The measurement scripts save heads so that each pipeline runs once.
- **Step limits.** Inlining changes how many statements a case executes (parameter assignments are added, calls removed). A case near the 20,000-step limit can become inconclusive. Inconclusive cases decide nothing, so they cannot cause a wrong acceptance, but a check with fewer decided cases is weaker; the reports state the counts.
- **Call depth.** The evaluator traps beyond 64 nested calls. Inlining reduces depth, so a program that trapped for depth at r0 could stop trapping. Only recursive programs reach that depth, and recursive callees are not inlined.
- **The estimate's blind spots.** Its branch probabilities are fixed numbers, not a profile, so it can prefer a variant that is better inside loops and worse in a function called often outside them. It never compares across functions, and every choice it makes is visible in the image (the option is recorded, and per function the instructions can be diffed).

## 21. Reference

**Files this milestone adds** (proposed):

| file | contents |
|---|---|
| `src/typed/inline.ts` | the `inline` pass: eligibility, copying, record results, provenance |
| `src/typed/rotate.ts` | the `rotate` pass: header duplication |
| `src/typed/backend/layout.ts` | `layoutBlocks(st, f, freq)`: the chain layout (§12) |
| `src/typed/backend/coalesce.ts` | `coalesceCopies(code, fregs, hints, weight)`: interference and renaming (§13) |
| `src/typed/backend/homes.ts` | choosing constant homes from a first selection (§14) |
| `src/typed/backend/frequency.ts` | `blockFrequencies(st, f)` (§11.1–11.2) and `estimateCost(finished, freq)` (§11.3) |
| `tests/typed/inline.test.mjs`, `tests/typed/rotate.test.mjs`, `tests/typed/speed-backend.test.mjs` | the tests of §19 |

**Existing functions this milestone calls or changes:**

| symbol | file:line | role here |
|---|---|---|
| `Store`, `Store.from`, `toNative`, `fresh` | `model.ts:222`, `:254`, `:296`, `:232` | the working copy the passes edit |
| `Tx` | `tx.ts:165` | edits with origins and write checks |
| `typedPass`, `revisionCorrespondence` | `passes.ts:165`, `:116` | the pass wrapper; correspondence from origins |
| `dfe` | `passes.ts:963` | the model for a whole-program pass |
| `PASSES`, `PIPELINES` | `passes.ts:1116`, `:1133` | registration of `inline`, `rotate`, `O3` |
| `loopsOf`, `liveView`, `isPure` | `analyses.ts:207`, `:305`, `:59` | headers for rotation; liveness for zeroing; purity |
| `meaningKept`, `evaluate` | `evaluate.ts:564`, `:345` | the contract and the semantics inlining preserves |
| `Program.apply`, `Program.why` | `program.ts:248`, `:457` | applying under the contract; provenance |
| `select`, `branch`, `val` | `select.ts:131`, `:629`, `:498` | block order, constants, copies |
| `intervals`, `allocate` | `regalloc.ts:85`, `:233` | the allocator coalescing feeds |
| `finish`, `compileFunction`, `compileImage` | `compile.ts:67`, `:288`, `:321` | where the variants are compared |
| `checkBackendOptions`, `backendDefaults` | `options.ts:61`, `:29` | options plumbing |
| `validateImage` | `image.ts:158` | accepts the extra option keys |
| `strategyRegistry`, `PRESETS`, `measure` | `strategies.ts:98`, `:402`, `:66` | the workbench's strategies |

**Commands.**

```bash
npm run build && npm test
node ttmp/2026/11/25/IRWB-003--…/scripts/01-benchmark-probe.mjs --pipeline O3 \
     --options '{"coalesce":true,"homes":true,"layout":"loops"}' --show blend
node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs | diff - \
     ttmp/2026/11/25/IRWB-003--…/various/01-baseline-corpus-revisions.txt
```

## 22. Outcomes (after implementation)

This section was added after the milestone was implemented. It records what was built, where it departs from Parts 3 and 4, and what was measured. The diary (`log/01-speed-gap-diary.md`) has the commands and outputs behind every number.

### 22.1 What was built

| file | contents |
|---|---|
| `src/typed/rotate.ts` | `rotateSpec`, wrapped by `typedPass` in `passes.ts` as `rotate` |
| `src/typed/inline.ts` | `makeInline(correspond)`: the `inline` pass, a `definePass` like `dfe`; `passes.ts` calls it with `revisionCorrespondence` |
| `src/typed/backend/frequency.ts` | `blockFrequencies(st, f)`, `estimateCost(code, fr)` |
| `src/typed/backend/layout.ts` | `layoutBlocks(st, f, fr)`: chains by edge weight, ties to the IR's fall-through |
| `src/typed/backend/coalesce.ts` | `coalesceCopies(selection, fr)`: interference, union-find, renaming |
| `src/typed/backend/variants.ts` | `chooseVariant`: plain, then each requested option on top of the best, kept if the estimate is lower |
| `src/typed/backend/select.ts` | the block order under `chains`; `homes` and `onConst` hooks for constant homes |
| `src/typed/backend/compile.ts` | `compileFunction` compiles once under the defaults, else through `chooseVariant`; `variantChoices` |
| `tests/typed/speed.test.mjs`, `tests/typed/inline.test.mjs` | 8 + 7 tests (two run the whole corpus under `IRWB_FULL=1`) |

### 22.2 Departures from the design

- **`chains` instead of `layout: 'loops'`.** A frozen test (`tests/typed/backend.test.mjs:294`) asserts that `{ layout: 'loops' }` is refused. `layout` is unchanged; the frequency-based order is a third extra option, `backendExtras = { chains, coalesce, homes }`.
- **`speed` instead of `O3`.** A frozen test (`tests/workbench/strategies.test.mjs:74`) uses `O3` as its example of an unknown pipeline. The pipeline is `PIPELINES.speed`, with the passes of §16.2; the presets are `speed` and `fastest-all`.
- **The layout is chosen by the estimate too.** §11.3 said the layout is not decided by the estimate. Measured alone (Step 4 of the diary), it made six corpus projects slower, `strings` by 7%; with ties sent to the IR's fall-through and the layout kept per function only where the estimate prefers it, no project is slower.
- **No `homes.ts`.** Choosing homes needs only a recording selection and a filter; it lives in `variants.ts`, with two hooks in `select`.
- **Two enumeration assertions changed** in `tests/workbench/strategies.test.mjs`: 15 passes, and `speed` in the pipeline list.
- **The zeroing rule never fires on lifted code.** Typed initializes every local, so no non-parameter local is live at a lifted function's entry. The test removes an initialization first (§19's zeroing test).

### 22.3 Measurements

Benchmarks (instructions; every result agrees with the evaluator):

| benchmark | O2 (book) | speed, defaults | speed + chains + coalesce + homes | reference |
|---|---:|---:|---:|---:|
| Blend | 451 | 450 | 370 | 383 |
| Checksum | 366 | 325 | 286 | 292 |
| insertion sort | 2,022 | 1,985 | 1,824 | 1,533 |
| Collatz | 1,590 | 1,480 | 1,218 | 1,486 |
| value numbering | 570 | 569 | 451 | 695 |

The predictions of §8 (Blend 371, Checksum 286) were within one instruction.

Corpus (44 projects, 6,986 decided cases, each agreeing with r0; no project slower than O2 in any row):

| pipeline, options | instructions | vs O2 | bytes |
|---|---:|---:|---:|
| O2 | 910,718 | | 5,160 |
| speed | 843,371 | −7.4% | 4,812 |
| speed + chains | 803,917 | −11.7% | 4,640 |
| speed + coalesce | 810,170 | −11.0% | 4,588 |
| speed + homes | 802,506 | −11.9% | 4,764 |
| speed + all three | 728,450 | −20.0% | 4,356 |

Candela: see §22.4.

Frozen checks: `scripts/08` of IRWB-001 prints the same 44 lines; `tools/parity.mjs` is identical; the `IRWB_FULL` suites are identical except for times; `npm test` passes with 15 more tests.
