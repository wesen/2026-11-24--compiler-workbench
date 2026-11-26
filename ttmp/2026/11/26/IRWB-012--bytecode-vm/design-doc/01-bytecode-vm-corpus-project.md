---
Title: Bytecode VM corpus project
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
      Note: Existing Typed frame arrays and explicit stacks
    - Path: repo://corpus/reference.md
      Note: Corpus project format, case specifications and image APIs
    - Path: repo://src/typed/evaluate.ts
      Note: Generated inputs, evaluator budget and r0 equivalence check
    - Path: repo://src/typed/lift.ts
      Note: Tape ingestion and lowering for text and frame arrays
    - Path: repo://src/typed/project.ts
      Note: Shared project metadata and Node ingestion entry point
    - Path: repo://src/typed/specialize.ts
      Note: Existing binding contract for scalar parameters and fields
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and RV32 comparison harness
ExternalSources: []
Summary: A bounded stack VM corpus project for dispatch, bounds checks, and bytecode specialization.
LastUpdated: 2026-11-26T11:54:30.450033879-05:00
WhatFor: ""
WhenToUse: ""
---

# Bytecode VM corpus project

Build one corpus project, `bytecode-vm`, that runs a small stack machine on RV32IMF. Run the same interpreter with two bytecode buffers and keep the numeric input and checksum data dynamic. When the bytecode is fixed, every reachable bytecode address identifies a known operation and immediate. Residualizing those operations and their edges yields compiled code for the guest program, an example of the first Futamura projection. The comparison is RV32 instructions per guest instruction for the same bytecode and dynamic input.

## Supported inputs

The entry is `run(code: buffer, data: buffer, n: i32): i32`. The initial corpus supports the exact Fibonacci and checksum fixtures below and the directed signed-immediate case `[1,65535,0,0]`. For Fibonacci, use `n` from 0 through 12 and an empty data buffer. For checksum, use `n` from 0 through 12 and a 12-cell data buffer of arbitrary u16 values. The signed-immediate case takes `n = 0` and empty data. Supply ordinary disjoint buffers via the workbench case allocator. Both buffers are read-only. Success returns one signed i32 and leaves guest memory unchanged. Guest stack and local arrays live in the Typed frame.

These fixtures start at instruction 0, use valid branch targets and locals, and halt with one stack word. The host owns their construction. Arbitrary bytecode, invalid inputs, validation at guest runtime, and resource exhaustion behavior are outside the supported domain. Adding a runtime verifier or fuel counter would exercise additional branches unrelated to these bounded workloads.

## Encoding and interpreter

Each guest instruction has two u16 cells, an opcode followed by an operand. The PC and branch targets are instruction ordinals. Fetch with `code.charCodeAt(2 * pc)` and `code.charCodeAt(2 * pc + 1)`, then advance `pc` before executing the operation. A taken jump replaces the incremented PC. Unused operands are zero. The simpler one-cell encoding would pack the operand into the opcode word and add masking or constrain immediates. Two cells keep decoding obvious and give the optimizer distinct code loads to study. Use `{ "cells": [...] }` to preserve the numeric words.

| Opcode | Name | Operation |
| --- | --- | --- |
| 0 | HALT | Return the top stack word. |
| 1 | CONST | Sign-extend the operand from 16 bits and push it. |
| 2 | LOAD | Push local at operand index. |
| 3 | STORE | Pop into local at operand index. |
| 4 | ADD | Pop right then left and push their wrapping i32 sum. |
| 5 | SUB | Pop right then left and push wrapping `left - right`. |
| 6 | JZ | Pop a word and jump to the operand if the word is zero. |
| 7 | JMP | Jump to the operand. |
| 8 | READ | Pop index and push `data.charCodeAt(index)`, zero-extended. |
| 9 | MUL | Pop right then left and push their wrapping i32 product. |

Declare `const stack = new Int32Array(8)` and `const locals = new Int32Array(4)` inside `run` (48 bytes total before backend alignment). Zero initialization gives both fixtures their zero-valued accumulators. Copy `n` into `locals[0]` and start `sp = 0` and `pc = 0`. `sp` counts live words. Push by storing at `stack[sp]` and incrementing. Pop by decrementing and then loading `stack[sp]`. Declare distinct temporary names in handlers where the parser requires it. For ADD call `wordAdd(a: i32, b: i32): i32`, a plain `return a + b`. It gives the inliner a real call while PC, SP and buffer pointers remain live. Inlining it in the source would remove that measurement. Keep the two arrays local since Typed array names cannot be passed as values. Avoid a top-of-stack cache, hand-hoisted checks, or fused opcodes in the baseline.

Use an `i32` if/else chain in a loop, ending the supported executions by returning in HALT. A guard such as `while (pc * 2 < code.length)` exposes the fetch-bound relation to analysis. Typed `match` requires an enum, whereas `charCodeAt` produces an `i32`. Introducing a decoder that turns each integer into an enum would duplicate dispatch. Dynamic array indexes get unsigned bounds guards from the front end and text accesses lift to checked addresses. The lifter represents frame allocation/access using `zero` and `aaddr`. The fixtures peak at two live operands. The larger fixed stack gives the baseline ordinary VM storage while retaining observable dynamic-index checks.

## Guest programs

Assembly below uses whitespace-separated instructions, `L0` through `L3` for locals, and labels resolved to zero-based instruction ordinals. Pack the fixtures once and verify the encoding with the JS oracle. These two programs cover a carried pair of numbers, a data-dependent load, wrapping arithmetic, and both outcomes of a conditional branch with ten opcodes total.

```text
fib, 19 instructions (38 cells)
  CONST 1  STORE L2
test (2):
  LOAD L0  JZ done
  LOAD L1  LOAD L2  ADD  STORE L3
  LOAD L2  STORE L1  LOAD L3  STORE L2
  LOAD L0  CONST 1  SUB  STORE L0  JMP test
done (17):
  LOAD L1  HALT

checksum, 16 instructions (32 cells)
test (0):
  LOAD L0  JZ done
  LOAD L0  CONST 1  SUB  STORE L0
  LOAD L1  CONST 31  MUL  LOAD L0  READ  ADD  STORE L1
  JMP test
done (14):
  LOAD L1  HALT
```

Fib returns F(n) with F(0) = 0 and F(1) = 1. Checksum visits `data[n-1]` through `data[0]`, updating `acc = 31 * acc + cell` modulo 2³² after each read. This checksum exercises signed wraparound and values above 32767 without using floats. The directed two-instruction case returns −1.

## Corpus project and generated cases

Use `corpus/projects/bytecode-vm/main.typed` for the interpreter and helper, `project.json` for input specs and pipeline, and `notes.md` for fixture assembly, scope and how to run the comparison. Put the independent JS VM in `scripts/oracle.js`, following the workbench function-body convention. Have it consume plain cells and numbers and return `{ result, guestSteps }`, including HALT. A Node test can load the same script body from the project files and pass its inputs through `args`. Put the paired workbench demonstration in `scripts/compare.js`, using the project script runner to call the oracle and showing result, guest steps, image steps and their ratio. That uses the existing project script model without introducing a separate module loader or a second project. Register `bytecode-vm` under Programs and include it near `gcd` in the corpus order. Fill in `focus` with the actual line of the opcode fetch once the file exists.

Proposed `project.json`, with Fibonacci as the built-in case family.

```json
{
  "title": "Bytecode VM",
  "about": "Run a small stack machine and inspect the cost of dispatch.",
  "group": "Programs",
  "sources": ["main.typed"],
  "ingest": { "tape": true },
  "pipeline": "O2",
  "inputs": {
    "run": {
      "code": { "cells": [1,1,3,2,2,0,6,17,2,1,2,2,4,0,3,3,2,2,3,1,2,3,3,2,2,0,1,1,5,0,3,0,7,2,2,1,0,0] },
      "data": { "cells": [] },
      "n": [0,12]
    },
    "wordAdd": {
      "a": { "oneOf": [0,1,-1,2147483647,-2147483648] },
      "b": { "oneOf": [0,1,-1,2147483647,-2147483648] }
    }
  }
}
```

Run an additional fresh instance of the same project source with just the `inputs.run` entry replaced by the checksum spec. Keep `wordAdd` specs in both runs because the checker normally generates cases for each function. Numeric `oneOf` works for the helper. An independent random buffer would overwhelmingly generate invalid bytecode, and current case specs have no choice among whole buffer literals. A fixed spec per fixture gets valid cases through the normal gate without extending the generator.

```json
{
  "code": { "cells": [2,0,6,14,2,0,1,1,5,0,3,0,2,1,1,31,9,0,2,0,8,0,4,0,3,1,7,0,2,1,0,0] },
  "data": { "buffer": [12,12], "cell": [0,65535] },
  "n": [0,12]
}
```

**Project loader prerequisite.** The browser already reads `ingest.tape` in `src/workbench/projects.ts`. Forward the same typed setting in `Program.fromProject` and `ingestProject`, and route corpus-wide test loaders that ingest raw source through the project-aware path. Keep the existing default for other projects. The simplest alternative, relying on the default Wasm inspection path, fails with `unknown tape opcode 252 at 8` on a two-array probe. The same probe through `Program` with `ingest: { tape: true }` accepted the arrays, dynamic indexes, u16 fetch, call, branch loop and generated cells. Its result was 65,547 in the evaluator, reference image and the checked `speed` image. The probe executed 33 IR statements, 98 reference RV32 instructions and 73 workbench `speed` instructions with `chains`, `coalesce` and `homes` enabled. These were feature checks on a small input. [Project loading](../../../../../../src/typed/project.ts) · [Browser project loading](../../../../../../src/workbench/projects.ts) · [Lifter](../../../../../../src/typed/lift.ts)

## Checks and budgets

The independent VM uses a JS `switch`, an ordinary JS array with push/pop, and four zeroed locals. Read code and data cells from the supplied arrays, sign-extend CONST with `operand >= 32768 ? operand - 65536 : operand`, coerce add/sub with `| 0`, and use `Math.imul` for multiplication. Count dispatches in JS. The reference VM can enforce a host-only limit of 186 dispatches to detect mistakes in the fixtures. Anchor it with direct Fibonacci values at 0, 1, 2 and 12 (0, 1, 1 and 144) and checksum examples at `n = 0` (0) and `n = 2` with leading cells `[2,5]` (157). Add directed buffers with high cells, repeated cells, and an ordered sequence. Exhaust the 13 possible lengths for each fixture on the directed data and check the signed-immediate case. The helper gets directed i32 overflow checks. A direct Fibonacci or checksum function alone would miss decoding, opcode semantics and the trace length needed for normalization.

On each generated case, decode the actual allocated input cells from case memory for JS. Check the result against Typed r0 and require successful runs and unchanged input memory. For each fixture run `O2` and `speed` from fresh r0 with checks enabled. The pass gate uses `casesFrom` and `meaningKept` to compare each changed revision with r0, normally on 40 cases per function at seed 7. For the test sweep use 100 cases per function at seed 7 per fixture in each image comparison. Feed identical `args` and initial memory to the r0 evaluator, the workbench RV32 images and the independently compiled reference RV32 image, following `tools/reference-check.mjs`. Require exact signed i32 results and unchanged guest bytes, and zero traps, faults and inconclusives on all supported inputs. Record the fixture, input tuple, seed and case number for any disagreement. JS checks the program semantics while the reference image additionally checks lowering and ABI behavior. [Evaluator and case generator](../../../../../../src/typed/evaluate.ts) · [Reference image harness](../../../../../../tools/reference-check.mjs)

Fib executes `6 + 15*n` guest instructions (186 max) and checksum executes `4 + 14*n` (172 max), counting HALT. Each guest dispatch expands into several IR statements, and the 20,000 limit counts executed statements including helper calls, even when they return inside one caller statement. Budget 100 for setup and 80 per dispatch initially, giving 14,980 at the maximum. Treat the estimate as provisional. Measure actual max `steps` at r0 and across accepted revisions for the directed length sweep and generated cases, at the normal limit. Target at most 15,000 for headroom. If measured cost exceeds that target, lower the shared `n` cap and update the fixture specs, counts and directed cases together. A larger check budget would make this a less useful per-pass corpus example. Keep the emulator's separate instruction limit at 200,000 and require successful termination there too.

## Specialization experiment and measurements

Use the same fixture and concrete case for every row. Start with general r0, general O2, general speed with default backend options, and general speed with `chains: true, coalesce: true, homes: true`. Separate revisions from backend settings so the comparison can see which kind of change affects the result. Inspect the fetch and dispatch branches, surviving bounds guards, spill counts and frame size. Record image bytes and total emulator instructions. Count from entry to return, including initialization and calls, and divide by the original JS guest count for each input. For an aggregate use total RV32 steps divided by total guest steps across those cases. A raw total alone would confound different guest trace lengths.

For a specialized measurement available with today's compiler, prepare a manually residualized Typed source **in the benchmark harness**, labeled as such. Use one source per bound fixture, retaining the `run(code, data, n)` call shape and leaving `data` and `n` dynamic. Treat each known guest PC as one known handler, resolve fixed jumps, and collapse fixed-depth stack slots into named i32 locals. The Fibonacci residual is the counter loop carrying the two Fibonacci words. The checksum residual is the same decreasing-index loop carrying an accumulator and reading data on each trip. Keep the same i32 operations and pass/backend settings as the paired general run. Use the exact code-cell vector as the harness precondition, and compare the residual evaluator and image against the unspecialized r0, JS result and original guest bytes on that fixture's cases before timing. Reuse the JS guest count for the residual even though it has no dispatcher. Binding a numeric pointer with `typed.bindings` would fix an address while leaving its contents unknown. The manual residual measures what removing dispatch could buy now. [Current binding implementation](../../../../../../src/typed/specialize.ts) · [Speed pipeline](../../../../../../src/typed/passes.ts)

| Work | What to inspect |
| --- | --- |
| IRWB-003 | Inline `wordAdd`, inspect loop rotation and register homes for PC/SP and live arguments, and compare redundant copies and repeated constants. |
| IRWB-006 | Follow PC, SP and local-index definitions across dispatch merges in the SSA view. Inspect rule-table effects on arithmetic and address calculations. |
| IRWB-008 | Candidate exact-checking exercises are 32-bit identities in a straight-line handler and bounds proofs based on known PC and stack heights. Generated agreement is evidence for the tested cases. |
| IRWB-010 | Start with adjacent `LOAD; LOAD; ADD; STORE` and `CONST; MUL` windows at known guest PCs. Compare their arithmetic with a combined residual block and track any proof obligations for reordered or removed accesses. |
| IRWB-011 | All outcomes are integer and exact. The project gives a control workload for experiments with tolerance contracts elsewhere. |

### Later

- IRWB-007 automatic specialization needs immutable buffer-content bindings, constant-load folding and residual control flow for known PCs. Check each generated residual against unspecialized r0 under the exact bytecode binding.
- IRWB-008 exact checking of a fused handler needs a checked rule and a proof of its applicability to the matched window, including any guard on observable accesses.
- IRWB-010 automated dispatch fusion or rewrite search can consume the same windows when search and proof integration are available.

A separate hand-optimized corpus project, sieve and sort are omitted from the first implementation. Two short fixtures and the manually residualized measurement already cover the requested comparison.

## Implementation order

1. Forward the tape opt-in through the shared project paths. Test that a tiny frame-array project opens with spans in the browser and through the Node corpus tools.
2. Build and test the JS oracle and fixture cells, including direct expected results and guest counts. Then implement `main.typed` with the ordinary dispatch chain and inspect r0 to identify its code and array checks.
3. Add project metadata, notes, the workbench script and the Node harness. Run both input specs through checked pipelines, all three execution paths, and the budget sweep.
4. Add the manually residualized comparison to the harness. Validate its agreement first, then capture the paired per-case instruction counts and document how to reproduce them.
