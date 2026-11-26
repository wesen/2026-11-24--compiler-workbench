---
Title: A stack-machine bytecode VM for specialization
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
    - Path: repo://corpus/reference.md
      Note: Corpus project and input specifications
    - Path: repo://src/typed/evaluate.ts
      Note: Generated cases, meaning comparisons and statement limit
    - Path: repo://src/typed/lift.ts
      Note: Tape lifting of frame arrays and checked text accesses
    - Path: repo://src/typed/program.ts
      Note: Program ingest options and checked pipelines
    - Path: repo://src/typed/project.ts
      Note: Project metadata and raw artifact ingest
    - Path: repo://src/workbench/projects.ts
      Note: Browser loader already forwards the ingest setting
    - Path: repo://tools/reference-check.mjs
      Note: Reference RV32 image comparison
ExternalSources: []
Summary: Design for a small Typed stack VM with fixed bytecode fixtures, a JavaScript oracle, and RV32 instruction counts.
LastUpdated: 2026-11-26T10:58:08.161132782-05:00
WhatFor: ""
WhenToUse: ""
---

# A stack-machine bytecode VM for specialization

## Goal

Add one corpus project, `bytecode-vm`, whose Typed program interprets two small stack-machine programs. Specializing an interpreter on a fixed bytecode program gives a compiled version of that program. This is the first Futamura projection. The bytecode lives in an input buffer so general execution still fetches, decodes and dispatches instructions at runtime. The two fixtures share the same interpreter and keep their numeric inputs dynamic.

The dispatch loop makes the program counter and stack pointer live across branches. Repeated code fetches, local accesses and pushes and pops give the compiler address arithmetic, bounds checks and memory traffic to work on. Start with an ordinary interpreter that loads from its arrays each time the bytecode asks it to. A scalar top-of-stack cache or threaded dispatch would remove work that the experiment is meant to expose.

- **IRWB-003** supplies the `speed` pipeline and backend copy coalescing for the dispatch loop and its live scalar state.

## Typed interpreter

The only Typed function in the corpus project is `runVm(code: buffer, entry: i32, n: i32, seed: i32): i32`. Allocate `stack = new Int32Array(4)` and `locals = new Int32Array(4)` once on entry. Set `locals[0] = n` and `locals[1] = seed`. Arrays start at zero, so local 2 is initially zero and local 3 can hold a temporary. Initialize the scalar next-free stack index `sp = 0` and code-unit index `pc = entry`. The array payloads total 32 bytes before frame alignment or spills. Each fixture uses at most two operand slots. Four slots keep the arrays small while leaving room for minor fixture edits. Array indexing keeps the VM's indexed state and checked accesses visible. Four scalar locals would need a second dispatch for every indexed local access.

Use `while (true)` and an `if` / `else if` chain on the fetched `i32` opcode. Use the decimal opcode values in the table, with mnemonic comments. An enum match would express the chain directly if the selector already had enum type. The fetched code unit is an integer, so the integer chain requires no conversion or extra decoding. Keep the stack operations in the arms. A helper that pushes or pops would need access to both the frame array and its changing index. In ordinary arithmetic arms, decrement `sp` to read the right operand, decrement it again to read the left operand, then write the result at `stack[sp]` and increment `sp`.

Each instruction occupies two u16 text-buffer cells, an opcode followed by an operand. Fetch with `code.charCodeAt(pc)` and `code.charCodeAt(pc + 1)`, then advance `pc` by two before the arm runs. Jump operands are absolute code-unit offsets into the shared buffer. Use zero for unused operands. A variable-width encoding would save space on arithmetic and halt, but it puts instruction-length bookkeeping into the dispatch experiment. Two cells per instruction also leave two adjacent checked loads for the optimizer to inspect.

| Opcode | Mnemonic | Effect |
| --- | --- | --- |
| 0 | `HALT` | Return `stack[sp - 1]`. |
| 1 | `PUSH k` | Push the zero-extended u16 operand as an i32. |
| 2 | `LOAD i` | Push `locals[i]`. |
| 3 | `STORE i` | Pop a value into `locals[i]`. |
| 4 | `ADD` | Pop right, then left, and push `left + right`. |
| 5 | `SUB` | Pop right, then left, and push `left - right`. |
| 6 | `MUL` | Pop right, then left, and push `left * right`. |
| 7 | `JZ target` | Pop a value and set `pc = target` if it is zero. |
| 8 | `JUMP target` | Set `pc = target`. |

Arithmetic wraps to signed i32. At a valid call the entry and every jump land on instruction boundaries, each stack and local access fits its array, and execution reaches `HALT` with one value on the stack. The corpus supplies those properties through the fixtures and scalar ranges. Keep any fallback return needed by Typed outside the valid path. The interpreter does not change the code buffer. The only public result is its return value.

## Bytecode and generated inputs

The first fixture computes seeded Fibonacci. Start with `a = 0` in local 2 and `b = seed` in local 1. While local 0 is nonzero, save `a + b` in local 3, copy `b` to `a`, copy the temporary to `b`, then decrement local 0. Return `a`. The second fixture initializes `h = seed` in local 1 and repeatedly updates it with `h = h * 33 + remaining` for `remaining = n, n - 1, ..., 1`. Return `h`. This rolling checksum uses a generated sequence of words. Supplying another buffer of words would add a guest memory opcode and a relation between the count and the data length. Fibonacci alone would exercise the loop but leave multiplication and deliberate wrapping untested.

Concatenate the two fixtures into one immutable 64-cell image with entries 0 and 34. Local 0 counts down exactly once per trip and the branch to each halt bypasses the body when `n = 0`. Each program stays in its own region. Choosing a scalar entry in a shared image uses the existing fixed-buffer and numeric choice specs. Choosing between two separate arrays would require a buffer-valued choice spec, since the current `oneOf` generator coerces its choice to an integer.

The following `project.json` contains the complete fixture encoding. The first two lines of `cells` are Fibonacci, whose exit is at 30. The last two are checksum, whose exit is at 60. Set `focus` to the line holding the opcode fetch once the source is laid out.

```json
{
  "title": "Bytecode VM",
  "group": "Programs",
  "about": "A stack interpreter running seeded Fibonacci and a rolling checksum.",
  "sources": ["main.typed"],
  "pipeline": "speed",
  "ingest": { "tape": true },
  "inputs": {
    "runVm": {
      "code": {
        "cells": [
          2, 0, 7, 30, 2, 2, 2, 1, 4, 0, 3, 3, 2, 1, 3, 2,
          2, 3, 3, 1, 2, 0, 1, 1, 5, 0, 3, 0, 8, 0, 2, 2, 0, 0,
          2, 0, 7, 60, 2, 1, 1, 33, 6, 0, 2, 0, 4, 0, 3, 1,
          2, 0, 1, 1, 5, 0, 3, 0, 8, 34, 2, 1, 0, 0
        ]
      },
      "entry": { "oneOf": [0, 34] },
      "n": [0, 12],
      "seed": [-8, 8]
    }
  }
}
```

Fibonacci executes `15n + 4` guest instructions and checksum executes `13n + 4`, counting the final taken test and the halt. At `n = 12` they execute 184 and 160 instructions respectively. Budget 64 evaluated IR statements per guest instruction and another 128 for entry and exit. The larger case then has a projected bound of 11,904 statements against the 20,000 limit used by `meaningKept`. The budget includes opcode comparisons and checked-access branches. It is a sizing estimate. Verify it with the r0 listing and measured evaluator steps for both entries over the bounded domain. Require every case to finish under the actual pass-check limit at r0 and through `speed`.

## Ingestion and project files

A Node probe loaded the vendored front end through `tools/node-vendor.mjs` and used an in-memory `projectSource` with fixed cells, two numeric entry choices and a scalar range. Its two frame arrays, `while (true)`, `charCodeAt`, indexed reads and writes, and integer dispatch compiled through `new Program(..., { ingest: { tape: true } })`. The lifted IR showed frame zeroing, checked text addresses and unsigned array index checks. For eight generated cases the evaluator returned the expected values in 34 statements each. The r0 and `speed` RV32 images and the reference compiler's image agreed on the results and memory. A bare `loop` gave `unknown local loop`. The default project ingest on the `while` probe gave `unknown tape opcode 252 at 8`, where the Wasm inspection path encounters the frame zeroing encoding.

Use the existing browser project metadata `ingest: { "tape": true }` handled by `src/workbench/projects.ts`. Make the small loader change to honor the same `IngestOptions` in `Program.fromProject` and `ingestProject`, so Node corpus tools and browser projects agree on how to lift the source. Add a focused loader regression using the two-array probe. A global switch to tape would change the IR shape of existing projects. The project setting is enough for this workload.

Put the interpreter in `corpus/projects/bytecode-vm/main.typed`, the configuration in `project.json`, and the opcode table, labeled fixture disassemblies and playground instructions in `notes.md`. Add `scripts/explore.js` for a fresh project run that applies `speed` and shows results and instruction counts at both entries. Follow `sort` for the script layout and `checksum` for source focus. `tools/corpus.mjs` discovers the project directory automatically. Add it to the order in `corpus/projects/index.json` only to place it explicitly in the browser list.

## Oracle and measurement

Write a test-local JavaScript reference VM using a `switch`, normal JavaScript stack `push` and `pop`, and four independent local slots. Consume the same numeric cell sequence and entry offset. Use `| 0` for add and subtract and `Math.imul` for multiplication. Return the signed result and the number of dispatches, including the halt. Direct Fibonacci and checksum formulas are enough to sanity-check the fixture outputs. The reference VM also checks the bytecode encoding and supplies the executed-bytecode denominator. Check the zero-iteration case, one trip and the upper bound for both entries, with negative, zero and positive seeds. Require the reference instruction counts to match the formulas above. At `n = 12, seed = 8`, the signed results should be 1,152 for Fibonacci and 1,298,667,478 for checksum.

Generate cases from the project input specs with `casesFrom`, and explicitly replay the small valid domain of 442 entry/count/seed combinations for the VM-specific test. For each, compare the JavaScript oracle with the evaluator and RV32 image at both r0 and the final `speed` revision. Require the same signed i32 result, normal completion and unchanged input bytes. Keep the ordinary checked `speed` pipeline, which compares every changed pass against r0 on generated cases. Use the reference compiler's image in a second comparison, following `tools/reference-check.mjs`. Keep the same fixture bytes for every engine. Update whole-corpus totals in `tests/typed/backend.test.mjs` as needed when the project joins the existing set.

Measure RV32 emulator `steps` divided by the JavaScript oracle's executed bytecode instructions for the same call. Report the general r0 and `speed` ratios and a hand-specialized comparison for each fixture at `n = 12, seed = 8`. Use the same backend options for all three images, with `coalesce: true` to exercise copy coalescing. Use a separate in-memory project for the hand-specialized code. Give it one Typed loop per fixture with just `n` and `seed` as parameters, and compile it with the same `speed` pipeline and backend options as the general optimized image. First compare each hand-specialized result with unspecialized r0 for the same fixture and scalar inputs. Normalize its emulator steps by the unspecialized oracle's bytecode count. This provides a fixed-code comparison with the current compiler. The scalar and record-field bindings in `src/typed/specialize.ts` cannot bind the contents of the code buffer.

## Implementation order

1. Wire the tape setting through the two Node-facing entry points and verify that the project opens through the browser and Node loaders.
2. Add the opcode interpreter and the two fixture entries. Check results and opcode counts with the independent JavaScript VM and verify the evaluator step budget.
3. Run the checked pipeline and both RV32 compiler paths. Add the exploration script and record the general and hand-specialized ratios in the project notes.

## Later

- **IRWB-007** would specialize on the contents of `code` and a fixed scalar entry to residualize dispatch.
- **IRWB-010** motivates exploring superinstructions such as fusing a load of a local, push of a constant and add when the sequence has a single entry.
