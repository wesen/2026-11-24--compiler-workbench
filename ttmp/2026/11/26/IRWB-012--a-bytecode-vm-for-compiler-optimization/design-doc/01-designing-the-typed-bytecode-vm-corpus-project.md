---
Title: Designing the Typed bytecode VM corpus project
Ticket: IRWB-012
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/candela-gallery/kernel.typed
      Note: Explicit stacks using fixed frame arrays
    - Path: repo://corpus/reference.md
      Note: Project and generated input specification
    - Path: repo://src/typed/evaluate.ts
      Note: Case generation, evaluator budget and pass equivalence
    - Path: repo://src/typed/lift.ts
      Note: Typed frontend operations lifted into checked workbench IR
    - Path: repo://src/typed/specialize.ts
      Note: Current scalar and field specialization bindings
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and emulator comparison
    - Path: repo://vendor/ds-js-os/compiler/typed/typed-wasm.js
      Note: Typed parser and lowering for frame arrays, buffers and match
ExternalSources: []
Summary: A fixed-fuel Typed stack VM for comparing general and bytecode-specialized RV32 images on Fibonacci and checksum fixtures.
LastUpdated: 2026-11-26T10:35:17.400230226-05:00
WhatFor: ""
WhenToUse: ""
---

# Designing the Typed bytecode VM corpus project

A small stack interpreter makes the cost of running a program through another program visible. The general VM reads its instruction stream, branches on the opcode, checks indices, and moves values between an operand stack and local variables. If a specializer knows the instruction stream, it can resolve the fetch, dispatch, and jump targets at compile time while leaving the input data dynamic. The resulting RV32 code computes the bytecode program directly, an instance of the first Futamura projection.

Build one corpus project, `bytecode-vm`, with two bytecode fixtures. Fibonacci exercises conditional and backward jumps and repeatedly transfers values between locals and the stack. A rolling checksum uses the same VM to read data and perform arithmetic, with changing input length and values. Both fixtures share one Typed entry point. Keep the original interpreter straightforward so that its dispatch and stack traffic remain visible in the IR.

## Typed entry point and value layout

```text
vmRun(code: buffer, data: buffer, out: buffer): i32
```

Use separate caller buffers. The first two are read through `.length` and `.charCodeAt(i)`. The host supplies bytecode as numeric u16 cells, including zero and high-bit operands. Each guest instruction occupies two cells. The first is an ASCII opcode number and the second is its unsigned 16-bit operand. The program counter `pc` is an instruction index. Fetch at `2 * pc` and `2 * pc + 1` after checking `0 <= pc < code.length / 2`. Code has 2–128 cells and an even length. Branch operands are absolute instruction indices. A fixed width makes every in-range instruction index an instruction boundary.

Declare `const stack = new Int32Array(16)` and `const locals = new Int32Array(8)` once per call in `vmRun`. Both start zeroed. `sp` is the first free stack position. Use `i32` locals for `sp`, `pc`, the decoded operands, and the remaining fuel. Limit data to 16 u16 cells. The output buffer has exactly two u16 cells. On success, pop the result and write its low and high halves with `setCharCodeAt`, using `value & 65535` and `value >>> 16`. Return status zero. The host reconstructs the signed result using `(lo | (hi << 16)) | 0`. Every guest error returns a nonzero status before any output write. This lets the test compare every i32 result, including values whose bits coincide with a status code.

The Typed parser gives arrays fixed literal sizes and keeps them in the declaring function's frame. Array names cannot be passed as arguments. Keep all push and pop logic in `vmRun`. A scalar-only helper such as `vmCellIndex(pc: i32): i32` is optional for an inlining experiment. If added, give the helper its own input spec because the pass check visits every function by default. The [Candela kernel](../../../../../../corpus/candela-gallery/kernel.typed) uses this frame-array and explicit-stack pattern. The [Typed frontend](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js) parses array declarations, indexed accesses, and text operations. The [lifter](../../../../../../src/typed/lift.ts) handles `array.address`, `array.zero`, u16 loads and stores, and the control flow behind checked accesses.

### Dispatch and instruction set

Initialize `pc = 0`, `sp = 0`, and `fuel = 192`. At the start of each iteration, check fuel and then the current PC. Decrement fuel once, fetch both cells, and increment `pc`. Use one `if` / `else if` chain on the numeric opcode with a final error branch. The frontend's `match` requires an enum, as in [Match enum](../../../../../../corpus/projects/match-enum/main.typed), while the buffer read yields an integer. Keep each opcode arm in one block of source and let successful arms fall through to the next loop iteration.

| Opcode | Cell | Operand | Effect |
| --- | ---: | --- | --- |
| `P` | 80 | literal | Push the zero-extended operand. |
| `L` | 76 | local index | Push the selected local. |
| `S` | 83 | local index | Pop and store into the selected local. |
| `A` | 65 | ignored | Pop right, then left. Push `left + right`. |
| `D` | 68 | ignored | Pop right, then left. Push `left - right`. |
| `M` | 77 | ignored | Pop right, then left. Push `left * right`. |
| `J` | 74 | target | Assign the operand to `pc`. |
| `Z` | 90 | target | Pop a condition. Assign the operand to `pc` if the condition equals zero. |
| `I` | 73 | ignored | Pop an index, read that cell from `data`, and push its unsigned value. |
| `N` | 78 | ignored | Push `data.length`. |
| `H` | 72 | ignored | Pop the top value, publish it, and return success. |

Add, subtract, and multiply wrap modulo 2³² and leave an i32. Emit zero for ignored operands when encoding fixtures. `H` may leave deeper operands in the private stack. Count `H` as one guest instruction.

Use ordinary, explicit validation to give invalid guest code defined outcomes. At entry, check output length, code length, then data length. Use the following order within a dispatch arm where applicable. After opcode recognition check stack requirements, then the local index or the popped data index. Check jump targets on the next iteration via the PC guard, so an invalid untaken target is harmless. A push on a full stack or a pop from an insufficiently deep stack gives a stack error. For `I`, popping once creates the space for the push. For an arithmetic arm, check depth at least two, decrement and read for each pop, then write and increment for the push. Use a counted `while (fuel > 0)` with a fuel error after the loop to express the precedence of fuel exhaustion over the next PC check. The 192nd instruction can successfully halt.

| Status | Meaning |
| ---: | --- |
| 0 | Guest halted successfully. |
| 1 | Output length differs from two. |
| 2 | Code is empty, odd-length, or longer than 128 cells. |
| 3 | Data exceeds 16 cells. |
| 4 | Fuel exhausted before the next fetch. |
| 5 | Unknown opcode. |
| 6 | PC outside the instruction stream, including fall-through. |
| 7 | Operand stack underflow or overflow. |
| 8 | Local index outside 0–7. |
| 9 | Popped data index outside the data buffer. |

The Typed frontend still emits checks around dynamic frame-array and buffer accesses. The explicit guest guards provide the error statuses, and the emitted checks provide candidates for bounds-check elimination. The JavaScript oracle should treat a Typed trap, calling-convention fault, or evaluator/emulator limit as a failed case even if the guest input is invalid.

## Bytecode fixtures

Assemble the following annotated listings in a host-side fixture builder during implementation. Strip comments, require two cells per instruction, resolve labels to instruction indices, and range-check u16 operands. Retain these disassemblies and the emitted arrays together in the project's tests or notes so changes to workloads and performance remain reproducible.

```text
Fibonacci                                   Rolling checksum (reverse order)
00 P 0    ; data[0] is n                     00 P 0
01 I                                        01 S 1    ; accumulator
02 S 0    ; iterations remaining            02 N
03 P 0                                      03 S 2    ; index one past next cell
04 S 1    ; a                               04 L 2    ; loop
05 P 1                                      05 Z 18
06 S 2    ; b                               06 L 2
07 L 0    ; loop                            07 P 1
08 Z 22                                     08 D
09 L 1                                      09 S 2
10 L 2                                      10 L 1
11 A                                        11 P 31
12 S 3    ; next                            12 M
13 L 2                                      13 L 2
14 S 1                                      14 I
15 L 3                                      15 A
16 S 2                                      16 S 1
17 L 0                                      17 J 4
18 P 1                                      18 L 1    ; done
19 D                                        19 H
20 S 0
21 J 7
22 L 1    ; done
23 H
```

Fibonacci returns `F(n)` with `F(0) = 0` and `F(1) = 1`. It executes `11 + 15*n` instructions including the final test and halt. Use `n = 0…10` for generated cases, at most 161 instructions. The checksum starts at zero and walks from the last data cell to the first, updating `acc = (31 * acc + cell) mod 2^32`. It executes `8 + 14*length` instructions, at most 176 for generated lengths 0–12. Both listings have peak stack depth two. Use Fibonacci at 0, 1, and 10 with results 0, 1, and 55. For the checksum, use empty data with result 0 and `[1, 2, 3]` with result 2946. Add `P 65535; P 65535; M; H` as a directed wraparound case with signed result −131071 and output cells `[1, 65534]`.

## Corpus project and generated cases

Place the implementation in `corpus/projects/bytecode-vm/`. Use `main.typed` for the entry point and dispatch loop, `notes.md` for the opcode table, fixture disassembly and workbench walkthrough, and `scripts/explore.js` for the workbench comparison. Keep the independent JS oracle and fixture builder in the Node test harness for the project. Workbench scripts are function bodies with injected handles, so the walkthrough should present a few reproducible fixture calls and inspect their IR and RV32 images. Use the Node test harness for the complete differential sweep. Directory discovery in [corpus.mjs](../../../../../../tools/corpus.mjs) picks up the project automatically. Place its ID next to `sort` and `histogram` in the explicit order in [projects/index.json](../../../../../../corpus/projects/index.json) for the browser. See [Corpus API](../../../../../../corpus/reference.md), [Strings](../../../../../../corpus/projects/strings/project.json), and [Sort](../../../../../../corpus/projects/sort/project.json).

Use Fibonacci for the default checked `speed` pipeline. Set `focus` to the first dispatch arm's actual source line after implementing `main.typed`. The following example gives the input spec verbatim and uses 1 as a temporary focus value.

```json
{
  "title": "Bytecode VM",
  "about": ["A stack interpreter for Fibonacci and rolling-checksum bytecode."],
  "group": "Programs",
  "sources": ["main.typed"],
  "pipeline": "speed",
  "inputs": {
    "vmRun": {
      "code": {
        "cells": [
          80,0,73,0,83,0,80,0,83,1,80,1,83,2,76,0,90,22,
          76,1,76,2,65,0,83,3,76,2,83,1,76,3,83,2,
          76,0,80,1,68,0,83,0,74,7,76,1,72,0
        ]
      },
      "data": { "buffer": [1, 1], "cell": [0, 10] },
      "out": { "cells": [43690, 21845] }
    }
  },
  "scripts": { "explore": { "about": "Inspect the VM dispatch and its RV32 cost", "fresh": true } },
  "focus": 1
}
```

For the checksum, set `code` to `{ "cells": [80,0,83,1,78,0,83,2,76,2,90,18,76,2,80,1,68,0,83,2,76,1,80,31,77,0,76,2,73,0,65,0,83,1,74,4,76,1,72,0] }` and `data` to `{ "buffer": [0,12], "cell": [0,65535] }`. Keep the output spec. Start a fresh Program from the same source and this alternate input spec, and run every checked pipeline from r0 on it. Run the published generic image on both fixtures as well. These specs keep executable bytecode and its matching data domain together. In [evaluate.ts](../../../../../../src/typed/evaluate.ts), `casesFrom` generates each parameter independently and `oneOf` coerces the selected value to a scalar. Use fixed `cells` per fixture and explicit tuples for extra cases.

### Evaluator budget

The pass contract counts executed IR statements, including branches and stores, with a limit of 20,000 per case. Guest fuel counts dispatches. Use an initial sizing envelope of 80 evaluator statements per dispatch plus 256 for setup and exit. At 192 dispatches that gives 15,616 statements. The estimate allows for the entire opcode chain, repeated checks, and temporary assignments. It needs confirmation from the actual lifted CFG and from counters. A loop such as `J 0` exercises the entire fuel budget but should be supplemented by a long, legal loop through a late dispatch arm and a checked data access.

At implementation, count the longest feasible per-dispatch statement path in r0 and sample `steps` in r0 and after each changing pass. Include the largest generated input for both fixtures and the explicit exhaustion fixtures. Require zero inconclusives and a maximum of 16,000 evaluator statements in this acceptance sweep. If the measured path breaks the envelope, first reduce fixture ranges and the fuel cap together, keeping headroom for the longest successful fixture, then repeat the sweep. Frame setup and teardown are included in the measurement where the engine counts them. RV32 instructions have a separate run limit, 200,000 in the reference harness, and should be recorded independently.

## Oracles and checks

Write the JavaScript reference VM directly from the instruction table, using a JS `switch`, an array with `push` and `pop`, and eight zero-initialized locals. Use `| 0` for add/subtract and `Math.imul` for multiply. Decode u16 cells by numeric index and implement the same validation order and fuel accounting. Return `{ status, out, executed }`, including HALT in `executed`. Keep the JS executor independent of the Typed source, generated IR and optimizer. Test the JS oracle itself using the golden outcomes above.

For every generated case and directed case, start each engine with a fresh copy of the same input memory. In Node, use `casesFrom` for checked case generation, `benchCase` for explicit inputs, and `readBuffer` with the case's memory-item addresses to recover full buffers. The convenience `p.exec` buffer display truncates long buffers. Compare the status, both output cells, and the original code and data cells. On guest errors verify the output sentinel is intact. Exercise odd and empty code, bad output size, oversized buffers, unknown opcode, fall-through, taken and untaken invalid branches, full and empty stack, local 7 versus 8, negative data index via subtraction, the last valid data index and the one-past-end index. Use `J 0` for exhaustion. Also run a checksum at length 16 and check that the oracle expects fuel exhaustion before the normal halt. To check the inclusive fuel boundary, run Fibonacci with n = 12 after inserting `J 24` at instruction 23 and moving `H` to 24. Its 192nd instruction halts with 144. Include a variant with one more jump before the halt to check that the next fetch never occurs.

Run the following gates during implementation.

1. Check JS against r0 in the evaluator and against the reference compiler's image on the emulator. [reference-check.mjs](../../../../../../tools/reference-check.mjs) shows how to compile and run a single image with the vendor reference compiler. Its default path compares that image against the Typed evaluator on generated inputs. The project test should assert the counters and fail on either disagreement or inconclusive results.
2. Run `O2` and `speed` on fresh programs with per-pass checks enabled. Inspect the pipeline report for rejected passes as well as the final revision. `meaningKept` compares every changing pass with r0, by default on 40 cases per function with seed 7. `agrees` compares return values and observable memory on normal completion and treats any two traps as agreeing. The guest errors use ordinary status returns, so their statuses and buffers can be checked exactly. Exercise directed case tuples before and after optimization through the project harness. Keep a reproducible record of the first counterexample with the fixture, inputs, revision, pass, engine and seed.
3. Lower r0 and the checked O2 and speed heads to RV32 and run the same direct comparisons with JS. Count zero unresolved cases before reporting any timing. When specialized images are available, run them under the declared code binding and compare both with general r0 and JS. Run a same-length program with one changed cell through the specialization router to confirm it does not select the specialized image for different code.

## Specialization and speed experiments

Bind the bytecode's exact length and ordered u16 cells at the entry boundary, with the guarantee that the buffer is immutable for the call and distinct from the writable output. Never bind the data buffer or its length. The current [specialize pass](../../../../../../src/typed/specialize.ts) and [Program.assume](../../../../../../src/typed/program.ts) bind numeric parameters or record fields. A fixed `cells` spec is test configuration. It provides no compiler proof that a buffer always contains those bytes, and a numeric binding on a pointer cannot supply that proof. Full bytecode specialization depends on the constant-memory work in [IRWB-007](../../IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/index.md).

With a constant-memory proof, propagate `pc` along each guest edge until the next fetch becomes known. Reuse residual blocks at guest loop headers. For a `Z` whose condition still depends on input, retain a conditional branch between the two known successors. This should eliminate dynamic dispatch and most code bounds checks while letting data reads remain dynamic. At guest PCs with a proven constant stack depth, look for stack slots that can become scalars or registers. Fuel and guest errors are part of the ABI, so their removal needs a proof over the admitted domain. For example, specializing checksum bytecode alone still admits length 16 and must preserve fuel exhaustion there. Cap code growth and fall back to the generic entry for unsupported specialization or different code. A host that selects variants can compare the length and complete cell sequence once before the call, or select using an already verified immutable artifact. Run the existing checked general path even while the specialized path is pending. A future hand-written ceiling may be a separate project implementing the fixture algorithms with direct locals and preserving observable results for the measured cases.

| Ticket | What to look for |
| --- | --- |
| IRWB-003 | Compare `speed` with O2. Inspect the loop header and latch after rotation, dispatch layout, frame and spill counts, register homes for `pc`, `sp` and fuel, and materialization of hot constants. Look at inlining if the scalar decode helper is present. |
| IRWB-006 | Inspect join values for `pc`, `sp` and loop state in SSA. Compare fold/simplify rule activity on address arithmetic before and after constants become visible. |
| IRWB-007 | Compare generic and residual code for both bound code streams, with variable data. Track the disappearance of instruction fetches and dispatch branches independently of stack improvements. |
| IRWB-008 | Use exact evidence where available for rule-derived arithmetic rewrites. Keep sampled end-to-end checks for dispatch, memory, fuel and control-flow edits whose equivalence still needs evidence. |
| IRWB-010 | Try discovering and verifying a straight-line fusion such as `L a; L b; A; S c`. Check jump entries into the sequence, stack headroom, local validity, fuel, and intermediate error behavior before treating it as one superinstruction. Use the pure address and arithmetic expressions to exercise rule discovery and equality saturation. Inspect short straight-line RV32 windows after dispatch is gone for machine-level superoptimization. |
| IRWB-011 | The VM uses exact integers. Its return bits and output cells provide a strict control workload alongside experiments using tolerance contracts for floats. |

Measure one fresh emulator call per case and image. The primary metric is **executed RV32 instructions / executed guest instructions**. Read the numerator from the emulator run's `steps`. Use the independently counted guest instructions from JS for the denominator in every variant, including a residual image with no dispatch loop. Include the VM's prologue and result writes. If a specialization guard runs in the measured image it counts, and if a host resolves the binding beforehand record that separately. Report total RV32 instructions, guest instructions, the ratio, and image/function bytes for each fixture and case, for the general r0, O2, speed, and available specialized variants. Compare matched tuples such as Fibonacci 0, 5 and 10, or checksum length 0, 4 and 12. For a pooled number use `sum(RV32 steps) / sum(guest steps)` over the same successful cases. Record backend options, input seed, and compiler revision and hold them fixed for the main comparison. Use dynamic instruction heat and IR/assembly inspection to attribute changes in code fetches, dispatch branches, spills and bounds checks. Report errors and limit cases in the correctness results.

Related designs include the [IRWB-003 speed guide](../../../25/IRWB-003--closing-the-speed-gap-inlining-copy-coalescing-float-constants-in-registers-loop-rotation/design-doc/01-intern-guide-closing-the-speed-gap-with-inlining-copy-coalescing-constants-in-registers-and-loop-rotation.md), the [IRWB-006 SSA and rules guide](../../../25/IRWB-006--rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks/design-doc/01-intern-guide-rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks.md), and the [IRWB-008 exact checking guide](../../IRWB-008--exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-as-the-standard-for-new-pipelines/design-doc/01-intern-guide-exact-checking-for-edits-that-cite-verified-rules-and-version-2-of-the-meaning-check-for-new-pipelines.md). The [research agenda](../../../24/IRWB-002--research-agenda-compiler-techniques-and-frameworks-for-the-ir-workbench/design-doc/01-intern-guide-and-research-agenda-the-ir-workbench-as-it-is-and-the-compiler-techniques-and-frameworks-to-build-next.md) describes the proposed general specializer (E4), equality saturation and machine windows (B4–B5), and tolerance contracts (D6). In this checkout, [IRWB-010](../../IRWB-010--sketch-rewrite-search-on-ssa-and-verified-rules-rule-discovery-equality-saturation-a-window-superoptimizer/index.md) and [IRWB-011](../../IRWB-011--sketch-image-level-contracts-for-float-freedom-tolerance-contracts-judged-on-rendered-frames/index.md), like IRWB-007, provide ticket indexes rather than standalone design documents.

## Implementation sequence

1. Build the host fixture encoder, check its arrays against the listings, and verify the independent oracle with the golden and malformed cases.
2. Implement the Typed ABI and dispatch. Start with `P` and `H`, add local and arithmetic operations, then fetch branches and data reads. Bring up r0 against JS and the reference RV32 image. Review the lifted controls and the frame stores for the intended source pattern.
3. Add corpus metadata, notes, and the fresh exploration script. Test both generated case specs, the directed cases, and the evaluator budget at every changed revision. Record general image counts before changing anything for specialization.
4. When constant-memory bindings can express the fixed code artifact, run the same checks and measurements on separately bound Fibonacci and checksum images. Compare their assembly with the general images and keep the generic VM as the baseline.
