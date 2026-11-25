---
Title: f32 and Candela agent diary
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
    - Path: repo://src/typed/f32.ts
      Note: f32 semantics on IEEE bits, as RV32F computes them
    - Path: repo://src/typed/lift.ts
      Note: frontEndTape, local type inference, the new operations, value-record results
    - Path: repo://src/typed/ir.ts
      Note: operator signatures and the type checks of the validator; indexed rebuild and resolve
    - Path: repo://src/typed/evaluate.ts
      Note: f32 on bits, caddr, frame arrays, multi-value results, f32 case generation
    - Path: repo://src/typed/passes.ts
      Note: float-safe pass rules
    - Path: repo://src/typed/reference.ts
      Note: the reference compiler's image on the interpreter, ilp32f placement
    - Path: repo://tools/candela-oracle.mjs
      Note: evaluator at r0 against the reference image, per function
    - Path: repo://tools/candela-o2.mjs
      Note: O2 on Candela with the meaning check
ExternalSources: []
Summary: "Investigation diary of the subagent that extended typed.blocks with f32 values, addressing and value-record results, lifted the Candela gallery program from the tape, checked the evaluator against the reference compiler, and made the passes float-safe (inventory steps 1-4)."
LastUpdated: 2026-11-24T21:30:00-05:00
WhatFor: "Evidence trail and resume point for inventory steps 1-4 (analysis/03 §5-§6)."
WhenToUse: "Read before extending the f32 domain, writing the f32 backend (step 5) or the Candela specialization (step 6)."
---

# f32 and Candela agent diary

This is the diary of the subagent that implements steps 1–4 of `analysis/03` (the Candela inventory): typed values and their validator, a lifter from the front end's tape, f32 and addressing semantics in the evaluator, and float-safe passes. Steps 5 (the f32 backend) and 6 (specialization) belong to other work. The main implementation diary is `02-implementation-diary.md`; the backend agent's is `03-backend-agent-diary.md`.

## Step 1: Read the plan, set up, and measure what the front end really gives

This step read the inventory, the domain and the step-4 entry of the main diary, set up the worktree, and measured the front end on Candela before designing anything. Four measurements changed the plan. First, the inspection failure is not in the front end: the tape-level inspection events of `compileFunctions` work on all 332 functions. Second, 180 functions return value records as several results, which the inventory does not mention. Third, the front end's `localTypes` can miss temporaries, so local types must be inferred. Fourth, only the `stock` and `interactive` policies of the reference compiler work with the vendored core.

### Prompt Context
**User prompt (verbatim):** the delegating agent's brief (first paragraph): "You are extending a TypeScript compiler's middle end so it can lift, evaluate and optimize floating-point Typed programs — specifically the Candela path-tracer gallery program from the user's ds-js-os repository. Work only in your git worktree; commit there; do not push."

**Assistant interpretation:** Implement inventory steps 1–4 in `src/typed/`: typed values and validator, raw-tape lifter, f32 and addressing evaluator semantics, float-safe passes. Copy Candela into the corpus. Check the evaluator against the reference compiler's images. Run O2 on Candela with the meaning check. Keep the Compiler Workbench corpus parity (6986/14) and Blend's O2 revisions. Keep a diary.

**Inferred user intent:** The Typed chain can carry Candela, the program it exists for, with evidence that the meaning of f32 code is the target's, so that the backend (step 5) and the Candela-fact passes (step 6) build on a checked middle end.

**Commit (code):** none in this step.

### What I did
- `ln -s …/node_modules node_modules`; `npm test` gave 245/245.
- Read `analysis/03`, `log/02-implementation-diary.md` step 4, and all of `src/typed/`.
- Read `vendor/ds-js-os/compiler/typed/tape.js` (rows, pops and pushes, the pseudo-ops), the front end's inspection code and `compileFunctions` (`typed-wasm.js` §frontend/inspect.js, §frontend/compile.js), the Wasm encoder's expansions (`pushCheckedAddress`, `pushTruncate`, `pushMinMax`), the reference compiler's f32 lowering (`rv32/emit/floats.js` in `typed-rv32.js`), its `checkedAddress`, `ARRAY_ADDRESS`/`ARRAY_ZERO` cases and frame layout, and the interpreter's `run`, `fminmax`, `toInt` and `fcompare`.
- Probes (scratchpad, not committed): `probe1.mjs` (tape-level inspection on Candela), `probe2.mjs` (reference policies), `probe3.mjs` (local type inference against `localTypes`, multi-value shapes).

### Why
- The design of values, lifting and the oracle depends on what the front end and the reference compiler actually produce, so I measured before writing code.

### What worked
- `typedWasm.compileFunctions(src, 0, [], 1 << 22, undefined, onFunction, undefined, { inspect: { emit } })` emits 332 events with `target: "tape"`. Their operations equal `typedTape.decode(fn.code)` for all 332 functions (`event ops == decoded tape 332`), with source spans and the named locals and their types.
- Inference from the tape agreed with `fn.localTypes` on every frame local: `{ mism: 0, conflicts: 0, … }`.
- `typedRv32.compile(src, [], 1 << 22, { policy: 'stock' })` compiled Candela in 87 ms (image 312,740 bytes); `interactive` also worked.

### What didn't work
- The policies `default`, `balanced` and `kernel` (the gallery's own) fail with the vendored core: `the RV32 pass inline needs typed-rv32-inline.js; load it after typed-rv32.js`. The oracle uses `stock`, which runs no tape passes and is the plainest translation.
- The isolation guard refused shell heredocs and compound `git -C` commands ("this command is too complex to verify that it stays inside the worktree"). I wrote scripts with the Write tool and copied the Candela sources with `cp` from the other repository's clean working tree (its `git status --short` was empty at b19062b).

### What I learned
- **The inspection failure is the Wasm backend's, not the front end's.** `typedWasm.compile(…, { inspect })` re-describes each function by decoding the Wasm bytes it emitted (`describeWasmFunction` → `typedTape.decode(body, true)`). The expansions of `f32.min_num`, `f32.max_num`, `f32.to_i32` and `f32.to_u32` use Wasm's `f32.min` (0x96), `f32.max` (0x97 = 151), `select` (0x1b) and `i32.trunc_sat` (0xfc), which are not tape rows: hence `unknown tape opcode 151 at 12`. The existing lifter therefore lifts *Wasm* operations, in which every pseudo-op arrives expanded. A checked address, for example, arrives as a capacity load, a branch over `unreachable`, a shift and an add.
- **Value-record results.** A function whose result is a value record (`V3f`, `Hit`, `PathOut`, …) has `fn.results`, the leaf types, and returns them as several values (Wasm multi-value). 180 of 332 functions do; 855 calls take several results, which are then stored by `local.set` (618), returned (218) or end an `if` arm (19). The reference compiler returns them in a0–a7 and fa0–fa7 per class, with stack words beyond eight (`resultLocations`). Up to 26 leaves (23 f32) occur, and up to 35 parameters (30 f32).
- **`localTypes` is not a complete type map.** The front end marks f32 locals only through `local()` and `valueLocals()`; temporaries allocated with `this.nextLocal++` are not marked (for example a record literal's field temp, line 958 of typed-wasm.js). On Candela the inference found no disagreement, but the brief was right that types must come from the tape.
- f32 constants on the tape are their IEEE bits as a signed i32 (format "f"), already finite JSON.
- Frame arrays occur in 2 functions (`hitMesh` 192 bytes, `traceAll` 160); `text.literal_stores` does not occur in Candela.

### What was tricky to build
- Nothing yet; the measurements decided three designs. Values carry f32 as bits. Multi-value calls become an `eval` of the call plus `result` leaves. The tape lifter takes the front end's tape-level events when it can.

### What warrants a second pair of eyes
- The inventory's §3 says the inspection decoder fails "on an operation this program uses and the Compiler Workbench corpus does not". More exactly, it fails on the Wasm encoding of four f32 tape operations. The upstream issue to report is in `describeWasmFunction` (it decodes Wasm bytes with the tape's row table).

### What should be done in the future
- Report the `describeWasmFunction` decoding issue upstream in ds-js-os.

### Code review instructions
- Nothing to review in this step; the probes are in the session scratchpad.

### Technical details
- The tape's types: `I32 = 0x7f`, `F32 = 0x7d`, `VOID = 0x40`, `ANY = 0` (the local's, callee's or function's type).
- ilp32f (typed-rv32.js `argumentRegisters`): f32 in fa0–fa7, then the next free integer register (its bits), then a stack word at the caller's sp + 4k; integers in a0–a7, then stack words.

## Step 2: Typed values, operators and the validator

This step gave `typed.blocks` value types and the new operators, and made the validator check types. A value has `type: 'f32'` when its result is an f32 and no `type` otherwise. All of the corpus's tables are therefore unchanged, and so are their revision hashes. f32 operators have their own names, so that no i32 rule can match one by accident.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task 1 of the brief.
**Inferred user intent:** A validator that refuses mistyped tables, so a pass that breaks types is caught at rebuild.
**Commit (code):** 38571c7 — "IRWB-001 P4.2: f32 and addressing in typed.blocks; tape lifter; f32 evaluator; float-safe passes"

### What I did
- `src/typed/model.ts`: `ValueRec.type?: 'f32'`; `ValueOp` gains `fadd fsub fmul fdiv fmin fmax fcopysign fneg fabs fsqrt ffloor fceil ftrunc feq fne flt fgt fle fge f2i f2u f2bits i2f u2f bits2f caddr aaddr result tuple`; `StmtOp` gains `zero` (with `offset`, `bytes`); `FnRec` gains `results?` (leaf types) and `arrayBytes?`; `typeClass(type)`.
- `src/typed/f32.ts` (new): the f32 operators on bits (`F32_BINARY`, `F32_COMPARE`, `F32_UNARY`), `toBits`/`fromBits`, `F32_RESULT`, `F32_OPERANDS`, `F32_FOLDABLE`, `formatF32`.
- `src/typed/ir.ts`: `VALUE_SIGNATURES` (operand classes and result class per operator) and `checkTypes`, called by `validateBlocks`. `rebuildBlocks` copies `results` and `arrayBytes`.
- `src/typed/listing.ts`: f32 constants as the shortest decimal that reads back (`0.1f`, `-0f`, `nan`, `inf`); f32 operators as `+. -. *. /. <. …` and `fmin(a, b)`, `f2i(x)`; `caddr(buf, i)`, `frame+16`, `result#k`, `(a, b, c)` for a tuple, `loadf32[…]`, `zero frame+0, 192 bytes`.

### Why
- **Distinct operator names instead of `add` with a type.** With shared names, every rule written for i32 would have to check operand types. `simplify`'s `!(a < b) → a >= b` is the dangerous case: it is false for NaN, and with a shared `lt` it would fire on f32 operands unless guarded. Distinct names make the restriction hold by construction. The `type` field remains necessary for the polymorphic leaves: `const`, `get`, `load`, `call`, `result`.
- **f32 values as bits.** An f32 is its IEEE bits in a signed i32, in constants, locals, memory and results. Every NaN payload and the sign of zero are exact. The evaluator's locals stay an `Int32Array`, memory images need nothing new, and the tables stay finite JSON. `f32.load` and `f32.store` move the same bits as i32 ones, so they are `load` with `type: 'f32'` and a `store` of an f32 value.
- **`result` and `tuple` for value-record results.** A multi-result call is the whole value of an `eval` statement, and its leaves are `result` values (leaf k of the latest multi-result call in this frame). A record return is `return tuple(leaves…)`. The alternatives were statements that write several locals, or a list-valued `return`. Either would have changed the single-`local` model that every analysis assumes (`s.op === 'set'` and `s.local` appear in liveness, reaching definitions, ranges, dce, subst and lvn). `result` reads hidden state, so it is impure, and no pass moves it across a call.

### What worked
- The corpus's tables did not change: all 44 projects have the same r0 and O2-head revision hashes as before (Step 6).
- The validator refuses each mistyped table in `tests/typed/f32.test.mjs`: an i32 constant as fadd's operand (`operand 1 of fadd must be f32, not i32`), an f32 set into an i32 local, a function returning the wrong class (`toInt returns f32, not i32`), and an f32-typed comparison (`flt must have type i32`).

### What didn't work
- No failures in this step.

### What I learned
- `canonical()` sorts keys, so the position of `type` in a record does not affect hashes; only its presence does.

### What was tricky to build
- **Where a tuple or a multi-result call may appear.** The validator marks both with the result class `'none'`. A `'none'` value may not be an operand (checked through the set of all arguments), a set or a store, and an `eval` may hold one only if it is a call. A `return` in a function with `results` must return a tuple whose leaves have the result's classes.

### What warrants a second pair of eyes
- The validator does not check that a `result` leaf's type matches the latest multi-result call's leaf type. That needs the order of statements, and the lifter is the only producer.

### What should be done in the future
- A flow check for `result` leaves, if passes ever create them.

### Code review instructions
- `src/typed/ir.ts` `VALUE_SIGNATURES` and `checkTypes`; `src/typed/f32.ts`.
- `node --test tests/typed/f32.test.mjs`.

### Technical details
- Type classes: `'f32'` for f32; `'i32'` for every other Typed type (`i32 u32 bool buffer`, records, enums).

## Step 3: Lifting from the tape

This step added the tape front end and taught the lifter the new operations. `ingest(name, source, { tape: true, maxSourceLength })` lifts from `compileFunctions`. It uses the front end's tape-level inspection events by default, which give source spans and local names. With `spans: false` it decodes the raw tape and its ops have `at: null`. All 332 Candela functions lift both ways, validate and round-trip. Two quadratic loops in the adapter appeared at this size and were fixed.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task 2: a raw-tape lifter with the same stack discipline, the inspection path the default, and a both-ways comparison on the corpus.
**Inferred user intent:** Candela enters the chain without losing what the corpus has (source lines).
**Commit (code):** 38571c7 (as Step 2); the corpus copy is 92221ec — "IRWB-001 P4.2: the Candela gallery program as corpus (ds-js-os b19062b)".

### What I did
- `corpus/candela-gallery/`: the five sources and `app.json`, copied unchanged, with `VENDOR.json` (commit, original paths, bytes, sha256). `tools/candela.mjs` checks the digests and concatenates in `app.json`'s order.
- `src/typed/lift.ts`:
  - `frontEndTape(source, { maxSourceLength, spans })`;
  - `inferLocalTypes(f, signatures)`: parameters and named locals as declared; every other local from the type of what its `local.set`s store, by simulating the stack's types with the rows' pops and pushes, the callees' signatures and block types, until no local changes; conflicts throw `typeConflict`;
  - the lifter handles `f32.const` (imm = bits), the f32 tables `F32_BINOPS`/`F32_UNOPS`, `f32.load`/`f32.store`, `text.checked_address` (`caddr(get r, get p)`), `array.address` (`aaddr`), `array.zero` (`zero`), `text.literal_stores` (one `store16` per unit, as the Wasm encoding expands it), `if` with an f32 result (an f32 temporary), value-record calls and returns;
  - the stack discipline is CW's. Values that a store or a call may change are now loads, calls, checked addresses (their capacity load) and `result` leaves (the next call replaces them).
- `src/typed/vendor.ts`: `typedTape` (rows and `decode`) and the `compileFunctions`, `recordLayouts`, `enumLayouts`, `publicSignature` members of `typedWasm`; `tools/node-vendor.mjs` installs `typedTape`.
- `src/typed/ir.ts`: `rebuildBlocks` indexes relations by source and kind; the adapter's `resolve` uses an id index per native value.
- `tests/typed/tape.test.mjs`.

### Why
- **The tape-level events as the default for `tape: true`.** They are the same operations as the raw tape (equal for all 332 functions), plus spans and names. So nothing is lost relative to the raw path, and Candela keeps source lines. The raw path stays available (`spans: false`), as the brief asked; it is the fallback if inspection ever fails.
- **Leaves of a multi-result call stay on the stack as `result` values.** The alternative was to materialize every leaf into a temporary. That would make two statements per leaf (`t = result#k; x = t`), and subst could not merge them, because `result` is impure. Kept on the stack, a leaf is consumed directly (`x = result#k`, `return (result#0, …)`). Because `result` counts as a value a call changes, a leaf is materialized before the next call.

### What worked
- Candela: 332 functions, 2,409 blocks, 12,358 statements, 37,220 values, 40,916 ops, the same counts both ways. Lifting takes about 0.2–0.4 s, validation about 0.5 s.
- Raw and spans give identical tables apart from ops' `at` and temporaries' names and declared types (`withoutSpans` in the test).
- The Store round trip and the v6 projection round trip are exact on Candela.
- Operator counts match the inventory's table: `fmul` 2,050, `caddr` 559, `aaddr` 8, two `zero` statements, `fmax` 630, `fmin` 334, `fsqrt` 278. `f32.const` 4,010 on the tape gives 3,981 live constants (constants in unreachable code are pruned).
- The corpus lifted both ways: 24 projects give tables identical to the inspection path's, source positions included (only `frontEnd.wasmBytes` differs: no Wasm is built). The other 20 contain checked addresses, and for each the tape-lifted program agrees with the inspection-lifted one on 40 cases per function.

### What didn't work
- **The projection round trip on Candela did not finish.** The first probe ran more than 3 minutes without output; I stopped it (`TaskStop ble8g12lu`) and timed the pieces. Lifting took 359 ms and validation 123 ms (`probe5.mjs`). `project(blocksAdapter, nat)` alone took over 60 s (`probe6.mjs`, killed by `timeout 60`). The cause was v6's `project`, which calls `adapter.resolve(value, id)` for every entity, while our `resolve` was `blocksEntities(v).find(e => e.id === id)`. On 103,618 entities that is about 10^10 steps. `rebuildBlocks` had the same shape (`graph.relations.filter(...)` per entity). With both indexed, the projection takes 14–18 s and rebuild 0.4–1.8 s; what remains is the framework's canonical encoding and deep freezing of 235,000 records (`encode core/data.js` 5.8 s self time, `immutable` 1.2 s, the garbage collector 2 s).
- My first expectation in the both-ways test was `{ identical: 21, checked: 22 }`, which was a miscount of the probe's output; the test reported `{ identical: 24, checked: 20 }`, which matches the probe's lines.

### What I learned
- The corpus never exercised the adapter at scale: its largest program has a few hundred entities, so quadratic code in `resolve` and `rebuild` was invisible.
- `text.checked_address` takes local indices, not stack values. Lifting it as `caddr(get r, get p)` makes the existing flush before `local.set` protect it.

### What was tricky to build
- **Unreachable code in type inference.** After `br`, `return` or `unreachable`, the stack is polymorphic until the enclosing `else` or `end`. The inference skips operations there (it restores the block's height and its `dead` flag at `else`/`end`). Otherwise pops would underflow and assign wrong types.
- **Inference order.** A `local.get` of a local not yet typed pushes `?`; a `local.set` of `?` assigns nothing. Each round recomputes from the declared types using the previous round's results, so an early guess never becomes a false conflict.

### What warrants a second pair of eyes
- The both-ways identity holds only for programs without pseudo-ops. For checked addresses it is a meaning check (40 cases per function), not a structural one. The structural difference is deliberate: the tape's `caddr` is one trapping value, the Wasm expansion is a branch to a trap block, and `bce` recognizes only the latter. A `bce` for `caddr` (prove `position <u capacity` and replace it by an unchecked `receiver + 2·position`) would be the natural next pass.
- `block` and `loop` with a result type throw `unsupportedOp`; the front end does not emit them (only `if` has value types), and no program in either corpus has one.

### What should be done in the future
- The framework's projection costs about 15 s per revision of Candela, and `applyPass` projects input and output. Caching projections per artifact, or a cheaper `immutable` for adapter output, would make passes on Candela interactive; both are framework changes.

### Code review instructions
- `src/typed/lift.ts`: `frontEndTape`, `inferLocalTypes`, the new branches in `lift`, `memoryOrCall`, `returned`.
- `src/typed/ir.ts`: `rebuildBlocks` (`bySource`), `entityIndex`.
- `node --test tests/typed/tape.test.mjs` (about 20 s; the Candela projection round trip is most of it).

### Technical details
- `ingest(program, source, { tape?: boolean, spans?: boolean, maxSourceLength?: number })`. The default front end is unchanged; `frontEnd` also accepts `maxSourceLength` now, so `ingest('candela', src, { maxSourceLength })` reaches the inspection failure instead of the input limit.

## Step 4: f32 semantics in the evaluator, and the reference oracle

This step gave the evaluator f32, addressing, frame arrays and value-record results, and built the oracle: the Candela program compiled by `typed-rv32.js` and run on the reference interpreter. On every function the evaluator at r0 agrees with the reference image on generated cases: 33,179 of 33,200 cases agree and 21 hit a step limit, with 0 disagreements.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Tasks 3 and 5 (first half): evaluator semantics and the check against the reference compiler's images.
**Inferred user intent:** The evaluator is the meaning every pass is checked against, so it must compute exactly what the device computes.
**Commit (code):** 38571c7.

### What I did
- `src/typed/evaluate.ts`:
  - f32 operators through `f32.ts`, on bits; `caddr` loads the capacity, traps unless `position <u capacity`, and gives `(receiver + (position << 1)) | 0`; `aaddr` is the frame's array base plus the offset; `zero` fills the frame area;
  - frame arrays live in a 64 KiB stack area added above guest memory, only for programs that have frame arrays, so that an access past the image still traps in the corpus; a call with `arrayBytes` takes `(sp - arrayBytes) & -16`;
  - a multi-result call stores its leaves for the frame's `result` values; `return tuple(…)` returns the list; `agrees` compares lists element by element;
  - f32 parameters: `makeF32` (values in [-4, 4] 55%, [-1000, 1000] 20%, [0, 1] 15%, an edge value 7%, any bits 3%), the `{ floats: [n, m], range }` buffer spec (f32s as `getF32` reads them), and the edge sweep of Step 5.
- `src/typed/reference.ts` (new): `referenceCompile` (policy `stock`) and `referenceRun`. It places arguments per ilp32f, including f32 overflow into integer registers and stack words, using the interpreter's `registers` option with its callee-saved patterns and `ra = RETURN_TO_HOST`. It reads results from a0/fa0, from the leaves' registers, or from the stack words the callee writes. An `ebreak` or a memory fault is a trap, the instruction limit is inconclusive, and any other fault never agrees.
- `tools/candela-oracle.mjs`; `tools/candela.mjs` `candelaInputs`: Candela's kernel record `K` with row buffers of f32s in [0, 4], a scene index in 0–17, the per-hit fields in range; `skyBuild`/`cdlSky` get the 64×64×3 sky table.
- Tests: `f32.test.mjs` (operations on bits; every pair of edge values against the reference), `candela.test.mjs` (every Candela function against the reference, 8 cases each).

### Why
- **Bits, not numbers.** RV32F returns the canonical NaN `0x7fc00000` from arithmetic, but keeps payloads through `fsgnj*`, `fmin`/`fmax` with one NaN, loads and stores. JavaScript numbers cannot carry a payload reliably. On bits, every rule is exact, and the interpreter's results compare as integers.
- **`Math.fround` after each operation is the target's result.** `floats.js` says "Every rounding instruction names round-to-nearest-even statically, so frm never matters; a product and a sum are never fused". For + − × ÷ and √ of f32 operands computed in double, double rounding is innocuous (53 ≥ 2·24 + 2).
- **Floor, ceil and trunc** follow `FloatMethods.round`: `bits << 1 >= 0x96000000` (|x| ≥ 2^23, ∞ or NaN) returns x unchanged; otherwise the integer in that direction with x's sign (`fsgnj.s out, ft11, x`), so `ceil(-0.5)` is −0.
- **Stock policy as the oracle.** It is the plainest lowering of the tape, with no tape passes; the gallery's `kernel` policy needs modules that are not vendored.

### What worked
- Every pair of 21 f32 edge values (plus 9 i32 edges for integer parameters) on every one- and two-parameter fixture function agrees with the reference, as do 100 generated cases each: over 5,000 cases.
- Harness sanity: changing `fmul` to `fadd` in `mix` made 20 of 20 cases disagree; results included NaN (115), −0 (91) and ±∞ (47) among 28,500 f32 results of the scalar functions.
- Oracle, scalar functions only (`--scalar --count 20`): 163 functions, 3,260 cases, 3,260 agree.
- Oracle, all functions, random `K` (`--count 100 --random` behaviour, before `candelaInputs`): `{"functions":332,"cases":33200,"values":27878,"traps":5318,"agree":33196,"disagree":0,"inconclusive":4}`. But 52 functions only trapped, because random words are not valid row-buffer pointers.
- Oracle, all functions, with `candelaInputs`: `{"functions":332,"cases":33200,"values":31806,"traps":1373,"agree":33179,"disagree":0,"inconclusive":21,"faults":0,"allValueFunctions":330}`. `traceAll` (frame arrays) agreed on 100 value results, `hitMesh` on 61, and `renderPixel`, a whole path-traced pixel, on 99.

### What didn't work
- The first `reference.ts` did not type-check: `typedRv32.compile` was declared with three parameters (it takes `source, imports, maxSourceLength, options`), and `p.cls === 'f' … : p.word` did not narrow the location union. I fixed the `Vendor` declaration and tested `cls === 'stack'` first.
- With 1,024-f32 sky buffers, `skyBuild` and `cdlSky` still only trapped (100/100). `skyBuild` writes 64×64×3 = 12,288 f32s, so their `K` now gets a sky table of that size.
- My probe's count of NaN arguments was 0 for 20 cases per function. Every function restarts the generator at seed 7, so 20 cases never reached the edge branch's NaN; with 400 cases NaN appeared (4 of 1,200 arguments). This led to the edge sweep (Step 5).

### What I learned
- The interpreter's `run` takes integer arguments only (`x[10 + i] = args[i]`). f32 arguments and stack words need the `registers` and `fregisters` options, as ds-js-os's own `tests/compiler/values-helpers.mjs` does for registers.
- The evaluator and the reference interpreter disagree on nothing in Candela on these inputs. NaN propagation, −0, saturation, value-record returns with stack leaves, frame arrays and checked addresses all agree.

### What was tricky to build
- **Stack words for arguments and results.** The interpreter puts the stack above `memoryBytes`, and with `registers` it uses my sp. I lay out guest memory, then 64 KiB of stack, then the caller's stack words, with sp at their start (16-aligned). The callee's frame grows down into the stack area, and it writes result leaves beyond the eighth of a class at sp + 4k, which I read from `run.bytes`. Only the guest memory prefix is compared.

### What warrants a second pair of eyes
- The evaluator's frame addresses differ from the target's (its frames are in a different stack). A program that returned or stored a frame address would disagree; none does.
- Memory beyond the image: the interpreter allows accesses into its stack area, while the evaluator traps past the image (or past its own stack area). Both are traps in practice for random pointers, but they are not the same rule.

### What should be done in the future
- Run the oracle with the `kernel` policy once the inline, loops and kernel modules are vendored: that is the image the device runs.

### Code review instructions
- `src/typed/f32.ts`, `src/typed/evaluate.ts` (`evaluate`, `makeF32`, `casesFrom`), `src/typed/reference.ts`.
- `node tools/candela-oracle.mjs --count 100 --json` (about 40 s); `node --test tests/typed/f32.test.mjs tests/typed/candela.test.mjs`.

### Technical details
- `agrees(expected, got)` is unchanged except that results may be lists. A trap agrees with any trap; memory is compared over the expected image's bytes.

## Step 5: Float-safe passes, and an edge sweep in case generation

This step restricted each pass's rules by value type and showed with counterexamples that the meaning check catches the classic unsound f32 identities. With purely random cases, two of the four were caught only at 400 cases per function. So the first quarter of an f32 function's cases now sweeps the f32 edge values, and all four are caught at the default 40.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task 4: fold through `Math.fround` only, simplify's identities i32-only, strength and ranges i32-only, lvn/licm/subst type-agnostic with `isPure`/`hasEffect` classifying the new operators; tests with NaN, −0 and ∞ counterexamples.
**Inferred user intent:** O2 can run on Candela without silently changing its floating-point meaning.
**Commit (code):** 38571c7.

### What I did
- `fold`: i32 rules unchanged; f32 operators in `F32_FOLDABLE` (arithmetic and √ rounded to nearest even, sign operations, comparisons, min/max, `i2f`/`u2f`, reinterpretations) fold through the same bit functions as the evaluator. floor, ceil, trunc, `f2i` and `f2u` do not fold.
- `simplify`: a guard returns early for every f32 operator (its rules already name only i32 operators).
- `constprop`: the constant gets the local's type (an f32 local's constant is its bits; `init:` gives +0).
- `dce` uses `analyses.hasEffect` (it had a private copy); `hasEffect` includes `caddr`; `isPure` excludes `caddr` and `result`.
- `licm`: f32 operators and `aaddr` are invariant candidates; the hoisted local has the value's type.
- `lvn`: keys include immediates and the f32 type (`#f1065353216` is not `#1065353216`; `aaddr[0]` is not `aaddr[16]`); a tuple is never numbered; the `vn` local has the value's type.
- `subst`: `copyTree` keeps types. `strength` and `bce` already match only i32 operators. `evalRange` gives f32 values the full interval and f32 comparisons [0, 1].
- `tx.ts`: `MakeOptions.type`; `make` derives the type for `get` and f32 operators; `rewrite` keeps `type`; `sameTree` compares it.
- `casesFrom`: the edge sweep. In case k < min(15, count/4), each unspecified f32 parameter i takes `F32_EDGES[(k + i) % 15]`, ordered NaN, +∞, −∞, −0, +0, 1, −1, the smallest subnormal, the largest finite, the smallest normal, 0.5, 2^24, ±2^31, −(smallest subnormal). Functions without f32 parameters generate exactly as before.

### Why
- The rules that are unsound for f32 are exactly the ones whose meaning depends on algebra over reals: `x + 0 = x` (false for −0), `x · 0 = 0` (NaN, ∞), `x − x = 0` (NaN, ∞), `!(a < b) = a ≥ b` (NaN). Pure, trap-free f32 code can still be moved and shared: licm, lvn and subst do not change any operation's operands, only where or how often it is computed, and the target's f32 operations are deterministic (rounding is static).
- Not folding floor, ceil, trunc and the conversions to integers follows the brief literally ("never across ops whose result depends on rounding mode beyond RNE"). They are exact functions on bits and the evaluator implements them as the target does, so folding them would be sound. They are left for a later decision.

### What worked
- `tests/typed/f32.test.mjs`: O2 on the fixture keeps its meaning (100 cases per function). After O2 the listing still has `(x +. 0f)`, `(x *. 0f)`, `(x -. x)` and `!((a <. b))`. `0.1 + 0.2` folds to the f32 sum of the two rounded constants, `1 / 3` to `fround(1/3)`, and `floor(2.5)` stays. licm hoists `a *. b` out of `scale`'s loop into an f32 local `inv`.
- Four deliberately unsound passes are rejected with `contractRejected … disagree` at 40 cases; the counterexample of `x + 0 = x` is `addZero(-0)`.
- `math.typed` alone under O2: cfg, fold, dce, lvn and subst make 5 revisions, statements go from 301 to 252, and the head agrees with r0 on 5,400 cases. lvn shared `x -. x` in `sinf`'s NaN path (`vn = (x -. x); return (vn /. vn)`), which is valid because f32 operators are pure.

### What didn't work
- Before the edge sweep (`scratchpad/unsound.mjs`):
  ```
  subSelf 40 ACCEPTED
  subSelf 100 ACCEPTED
  subSelf 400 contractRejected … 1/11200 sampled cases disagree
  notLess 40 ACCEPTED
  notLess 100 ACCEPTED
  notLess 400 contractRejected … 3/11200 sampled cases disagree
  ```
  After it, all four are rejected at 40 (`subSelf 40 … 4/1120`, `notLess 40 … 1/1120`).
- The first fixture used `==`; the front end refused it (`expected bool, got f32` at 11:42): Typed's equality is `===`.

### What I learned
- A sampled meaning check is only as good as its distribution at the edges. For f32 the edges are where the unsound rules live, and a low edge probability (which the brief asked for) needs a deterministic sweep to give reliable evidence at small counts.

### What was tricky to build
- **Keeping i32 generation byte-identical.** The edge sweep must not consume the generator for i32 parameters differently. It applies only when the function has an f32 parameter, so no corpus function is affected. Within such a function, a swept parameter skips its `makeValue` call, which shifts the stream for later parameters of that case. That is fine, because those functions had no prior case sets to reproduce.

### What warrants a second pair of eyes
- The swept cases give every f32 parameter an edge value at once, so many of them produce NaN. They exist to meet NaN and ∞ reliably, not to cover ordinary values; the other three quarters of the cases do that.
- f32 values inside records and buffers (`K`'s fields, `floats` buffers) are never swept.

### What should be done in the future
- Decide whether `fold` may evaluate floor/ceil/trunc/`f2i`/`f2u` (sound on bits, conservative now).

### Code review instructions
- `src/typed/passes.ts` (`fold`, `simplify`, `constprop`, `dce`, `licm`, `lvn`, `copyTree`), `src/typed/analyses.ts` (`hasEffect`, `isPure`, `evalRange`), `src/typed/tx.ts`, `src/typed/evaluate.ts` (`casesFrom`).
- `node --test tests/typed/f32.test.mjs`.

### Technical details
- `F32_FOLDABLE` = `fadd fsub fmul fdiv fmin fmax fcopysign feq fne flt fgt fle fge fneg fabs fsqrt i2f u2f f2bits bits2f`.

## Step 6: The i32 corpus is unchanged

This step checked that none of the above changed the Compiler Workbench corpus. It holds byte for byte: every project's r0 and O2-head revision hashes and its pass sequence are the same as at the base commit, and the full parity test passes.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The parity constraint of the brief.
**Inferred user intent:** The f32 work costs the existing compiler nothing.
**Commit (code):** 38571c7.

### What I did
- Built the base commit in a scratch copy (`git archive HEAD` before my changes) and ran `scratchpad/revs.mjs` against both builds: per project, the r0 revision, the head revision of its pipeline, and the steps.
- `IRWB_FULL=1 node --test tests/typed/passes.test.mjs`; `npm test`.
- Timed three O2 pipelines (blend, checksum, orders) on both builds, alternating.

### Why
- The parity totals (6986/14) are a strong check, but they could survive a change that alters ids or provenance. Identical revision hashes rule that out.

### What worked
- `projects 44 identical r0+head+steps 44 diff []`.
- `IRWB_FULL=1`: `✔ P2.6: corpus parity (all projects) (67607.16628ms)`; the test asserts `{projects: 44, fns: 70, total: 7000, agree: 6986, inconclusive: 14}`. Blend's book revisions and the why tree tests pass.
- `npm test`: 256 tests, 255 pass, 1 skipped (`IRWB_CANDELA`), 0 fail.
- Speed: base 7.6 s and 6.5 s, new 7.1 s and 6.5 s for the three pipelines.

### What didn't work
- My first timing comparison looked like a 3× slowdown (`npm test` 84 s against 29 s before). Alternating runs showed the same speed; the difference was machine load (load average 4.56, with another agent working).

### What I learned
- On a shared machine, a single timing is not evidence; alternating runs of both builds are.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- Nothing beyond Steps 2–5.

### What should be done in the future
- N/A.

### Code review instructions
- `IRWB_FULL=1 node --test tests/typed/passes.test.mjs`; `npm test`.

### Technical details
- The base build: `git archive HEAD -o …/base.tar` before the first commit of this work, extracted into the scratchpad with `node_modules` linked.

## Step 7: The final oracle run, and Candela in the program host

This step reran the oracle on the final build (with the edge sweep and the sky-table inputs) and let the program host ingest from the tape. Every one of the 332 functions has value results that agree with the reference compiler's image, and no case disagrees.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Task 5, first half: counts of functions covered, decided cases and disagreements.
**Inferred user intent:** Evidence that the evaluator is the device's meaning for Candela.
**Commit (code):** 0d1bc1f — "IRWB-001 P4.2: the program host ingests from the tape; oracle limits; O2 progress"

### What I did
- `node tools/candela-oracle.mjs --count 100 --json` on the final build.
- `node tools/candela-oracle.mjs --count 10 --limit 5e6 skyBuild cdlSky fbm3 cdlRenderSpan traceAOV` for the functions that hit the limits.
- `Program` takes `options.ingest` (`{ tape: true, maxSourceLength }`); a test runs `mix` and `saturate` through `exec`.
- The listing separates a statement id of 13 or more characters from its text (`s:smoothstep.0 t4 = …`). Shorter ids, which includes all of the corpus's, print as before.

### Why
- The edge sweep changed the cases of every f32 function, so the counts of Step 4 had to be measured again.

### What worked
- 100 cases per function: `{"functions":332,"cases":33200,"values":31617,"traps":1368,"agree":32985,"disagree":0,"inconclusive":215,"faults":0,"allValueFunctions":330}` in 277 s (the machine was shared with the O2 run). 330 functions agree on at least one value result. 215 cases hit a step limit: `skyBuild` 100, `cdlSky` 100, `cdlRenderSpan` 9, `fbm3` 5, `traceAOV` 1.
- With a limit of 5·10^6 statements (5·10^8 instructions) those five agree on all 50 cases, 47 of them value results: `{"functions":5,"cases":50,"values":47,"traps":3,"agree":50,"disagree":0,"inconclusive":0}`.
- So every Candela function has value results that agree with the reference image, and no case of any function disagrees.
- `new Program('candela', source, { ingest: { tape: true, maxSourceLength } })` has status `ok`; `exec('mix', [1, 3, 0.5]).result` is the bits of 2, and `exec('saturate', [NaN])` the bits of 0.

### What didn't work
- No failures in this step.

### What I learned
- With the full sky table, `skyBuild` no longer traps: it runs 64 × 64 sky evaluations, which needs more than the default 2·10^5 statements.

### What was tricky to build
- Nothing.

### What warrants a second pair of eyes
- About 4% of the compared cases are traps (1,368). They agree with the reference, but a trap agrees with any trap, so they are weaker evidence than value results.

### What should be done in the future
- N/A.

### Code review instructions
- `tools/candela-oracle.mjs`; `node --test tests/typed/candela.test.mjs`.

### Technical details
- Results compare as bits (f32) and i32s, and value-record results leaf by leaf, with memory compared over the case image. The interpreter's limit is 100 instructions per evaluator statement.

## Step 8: Running O2 on the whole of Candela: first attempts, costs, and the step limit

This step started O2 on the whole Candela program with the meaning check against r0 after every pass. The first run was stopped: it had no progress output and used the build from before the edge sweep. The second run reports each pass. While it ran, I measured where a pass's time goes and whether the meaning check's default step limit loses evidence on Candela. It loses little (0.8% of cases). `runPipeline` now accepts a limit anyway.

### Prompt Context
**User prompt (verbatim):** see Step 1. The coordinator added mid-task: "Append a step at every milestone, including the Candela O2 runs now in progress … Commit the diary with the code, not only at the end."
**Assistant interpretation:** Task 5, second half: run O2 on Candela with the meaning check and report what each pass did; keep the diary current and committed.
**Inferred user intent:** Evidence that the optimizer keeps Candela's meaning, and a record of its cost at this size.
**Commit (code):** fe5a8fe — "IRWB-001 P4.2: runPipeline takes the meaning check's step limit; candela-o2 --limit, --final-limit, --save"

### What I did
- First run: `timeout 7000 node --max-old-space-size=8192 tools/candela-o2.mjs --json > scratchpad/o2-candela.json` (background task `bi7i8ofyy`). It printed nothing per pass, held 4.9 GB after 12 minutes, and had loaded the build from before the edge sweep. I stopped it (`TaskStop bi7i8ofyy`).
- `tools/candela-o2.mjs` now runs the pipeline one pass at a time through `runPipeline(r0, [name], { start })`. Each pass is still checked against r0. The tool writes `<pass> r<rev>|- <ms>` per pass to stderr.
- Second run: `timeout 9000 node --max-old-space-size=12288 tools/candela-o2.mjs --json` (task `bmpm7lntd`), still running at the time of writing.
- `scratchpad/reach.mjs` (with `--cpu-prof`): each analysis on Candela r0.
- `scratchpad/limits.mjs`: Candela r0 cases (40 per function, `candelaInputs`) evaluated at limits 2·10^4 and 2·10^5.
- `src/typed/project.ts`: `runPipeline(…, { limit })` passes the step limit to `optimizationContract`; it is absent by default, so the corpus's contracts are the same objects as before. `tools/candela-o2.mjs`: `--limit` (per pass), `--final-limit` (default 2·10^5), `--save head.json`.
- `node --test tests/typed/passes.test.mjs` after the change: 7/7.

### Why
- A run that can take an hour needs progress output and must use the final code; otherwise its numbers describe a build that no longer exists.
- The meaning check's default limit (2·10^4 statements per case) might have made deep functions such as `renderPixel` inconclusive in every check, which would have weakened the evidence for exactly the code the passes change most.

### What worked
- Passes so far (second run), with wall time per pass, each with its meaning check:
  ```
  cfg r1 111184 ms
  fold r2 175161 ms
  simplify r3 118581 ms
  constprop r4 152043 ms
  fold r5 151402 ms
  simplify - 55931 ms
  dce r6 150954 ms
  cfg r7 127302 ms
  licm r8 128146 ms
  lvn r9 130625 ms
  strength - 78608 ms
  ```
  No pass has been rejected so far.
- The step limit: at 2·10^4, 101 of 13,280 cases (0.76%) reach it, in 5 functions (`fbm3 renderPixel skyBuild cdlSky cdlRenderSpan`); at 2·10^5 still 87 do. So the default costs almost no evidence on Candela, and the run in progress needs no repetition for that reason.
- Analysis cost on Candela r0, one at a time: cfg 6,527 ms, dominators 6,573 ms, loops 6,563 ms, liveness 27,464 ms, reaching 30,585 ms. Building `reachView` for all 332 functions took 1,141 ms.

### What didn't work
- The first run, as above: no output, wrong build, stopped.

### What I learned
- **Framework overhead dominates.** Profiling the analyses gives `encode core/data.js` 38.0 s self time, its helper 17.6 s, `sha256` 11.9 s, `immutable` 5.9 s, the garbage collector 5.8 s and `deepFreeze` 3.3 s, against 0.6 s for `defLocal`, the hottest domain function. Every analysis record and artifact of 100,000 entities is canonically encoded, hashed and deep-frozen. A pass on Candela therefore costs about 2 minutes, whatever it changes (a pass that changes nothing still costs 56–79 s).
- The process holds 4–6 GB. Every revision is kept with its analyses, two projections are made per pass, and the meaning check's cases (332 functions × 40, with `K`'s row buffers) are built up front.

### What was tricky to build
- Nothing; the per-pass loop uses `runPipeline`'s existing `start` option, so it is the same check as one `runPipeline` call.

### What warrants a second pair of eyes
- The cost profile points at the framework (`core/data.ts`), not at the typed domain. Making Candela interactive would need cached projections or cheaper immutability for large artifacts. That is a framework change, outside this agent's brief.

### What should be done in the future
- A framework option to skip re-encoding and re-freezing values that the adapter has just produced and validated.

### Code review instructions
- `src/typed/project.ts` `runPipeline` (`limit`); `tools/candela-o2.mjs`.

### Technical details
- The per-pass contract is `optimizationContract({ inputs, count: 40, seed: 7 })`: 332 functions × 40 cases = 13,280 cases per pass, compared against r0.
