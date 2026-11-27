---
Title: Measurement report
Ticket: IRWB-036-B
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/tx.ts
      Note: Source and projection IDs for new locals
    - Path: repo://tests/typed/specialize.test.mjs
      Note: Specialization regressions
    - Path: repo://ttmp/2026/11/27/IRWB-036-B--specializing-the-bytecode-vm/scripts/02-measure.mjs
      Note: Reproducible per-entry RV32 measurements
    - Path: repo://ttmp/2026/11/27/IRWB-036-B--specializing-the-bytecode-vm/various/04-split-results.txt
      Note: Final instructions, code sizes and disassembly
ExternalSources: []
Summary: Both compiled programs run in 77 RV32 instructions and occupy 48 bytes each.
LastUpdated: 2026-11-27T09:44:15.302845452-05:00
WhatFor: ""
WhenToUse: ""
---

# Compiling two programs by specializing their interpreter

With the bytecode and entry fixed, the compiler produces a three-block scalar loop for each program. At n=12 and seed=8 both execute 77 RV32 instructions. Fibonacci returns 1,152 and checksum returns 1,298,667,478. The generated code keeps the four-argument VM calling convention. Count and seed remain dynamic.

## Measured results

Each cell gives **executed instructions / emitted machine-code bytes**. Every column uses the same coalescing backend. Each hand loop was compiled separately with the checked speed pipeline. The general column is the same r0 image used at two entries. The other VM columns contain a single specialized entry each.

| Program | General r0 | Entry binding only | Buffer + entry, raw | After speed | After live-range splitting and cleanup | Hand loop |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fibonacci | 7,678 / 840 | 7,679 / 844 | 535 / 328 | 164 / 76 | **77 / 48** | 75 / 40 |
| Checksum | 6,874 / 840 | 6,875 / 844 | 511 / 320 | 139 / 64 | **77 / 48** | 74 / 36 |

The fraction of the dispatch gap removed is (general − specialized) / (general − hand), or **99.974%** for Fibonacci and **99.956%** for checksum. Keeping both automatic images uses 96 bytes, against 840 bytes for the shared interpreter and 76 bytes for both hand loops. These sizes count machine code only. They exclude the host, bytecode data and compiler artifacts.

## What was specialized

The host passes a typed.bindings artifact to Program.specialize. Bind code to the complete u16 sequence using a parameter binding whose value is an object with a cells array. Bind entry to an integer in the same artifact. The generator allocates a real buffer with that length and those contents. Subsequent revisions keep those input specifications. A binding identifies contents independently of the guest address. The revision-qualified outer fact and original entity IDs accompany the residual edits.

The partial evaluator starts at the original entry block. Its static environment holds known i32s, identities of bound buffers, and offsets in the private frame. A get consults that environment. An assignment updates it or emits a dynamic assignment. Integer arithmetic uses the existing evaluator operations. For a checked u16 fetch, both the receiver identity and index must be known and the index must be in bounds to replace the load. A dynamic or statically failing index keeps its run-time check. The same rule folding a character from a table folds each opcode and operand here.

At entry 34 the interpreter reads cells 34–35 as LOAD 0 and cells 36–37 as JZ 60. The word holding n is dynamic. The check on that word emits a branch to the versions for PC 60 and PC 38. Following the JUMP back to 34 reconnects to the previous block version. Neither this algorithm nor the split pass contains guest opcode definitions, entry offsets, the multiplier, or either hand loop.

A version consists of an original block and its static facts for live-in locals. A memoized version becomes an edge. A new version is enqueued once. Processing stops after all reachable versions have successors or terminate. This gave 244 versions for Fibonacci and 222 for checksum before cleanup. With 82 original blocks and 64 cells, the default budget was 5,248 states. A caller can cap these using the maxStates option. The default allows one copy of every input block for each cell of the longest bound image, with one allowance for an empty image. Distinct PCs motivate this scaling. Other static locals can create more combinations, so exceeding the budget declines the whole specialization. The ordinary VM revision remains available.

The VM explicitly zeros its two private arrays at entry. A known aligned word of that storage becomes a mutable residual local. Stack depth and local indices become static along these paths. Promotion thereby removes their accesses and checks while preserving n, seed and intermediate arithmetic as run-time values. Stores are accepted only at proven private words. Calls, other possibly aliasing effects, escaping frame addresses and dynamic frame offsets decline the transformation. Bound buffer parameters must retain their original pointer, and internally called entries are refused because the external promise would say nothing about an internal caller.

## Cleanup experiment and remaining gap

The first checked speed pipeline merges dispatch paths and discards dead work. Running subst by itself until stable afterwards changed the IR and saved zero machine instructions on both programs. Several guest operations write the same stack slot, and subst requires a single defining assignment.

The opt-in split-local-ranges pass gives a fresh name to a definition whose entire remaining lifetime lies inside a block. The last write keeps its shared name when live at exit. Reaching definitions identify exactly the reads to rename. This needs neither phi nodes nor another IR. Starting again at the speed revision, splitting, applying subst until stable (seven changed applications each), and applying speed again produced the final images. Always-on splitting would add locals and pass work to unrelated pipelines. Program.apply accepts the exported splitLocalRanges pass directly, as shown in script 04. The standard workbench catalog retains its 15 built-ins.

The residual disassemblies still allocate and release the original 32-byte stack frame. Both use a jump to the shared epilogue. Fibonacci saves a return-value move by keeping its accumulator in a0, leaving two extra executed instructions compared with the hand loop. Checksum keeps the return move and pays three extra. The hot arithmetic loops each have the same executed instruction count per trip as their hand counterparts at the measured input. The instruction listings are in the [split experiment output](../various/04-split-results.txt).

## Checks and scope of evidence

- The ordinary meaning gate compares each changed revision with r0 on 40 generated calls under the host facts. Later optimizations use the same restricted domain. The benchmark requires 40/40 and rejects any rejected pipeline step.
- In a separate emulator comparison, each final image agreed with r0 for all 221 pairs of n in 0…12 and seed in −8…8 for its entry. The check compared signed results, trap/fault/limit status and caller-visible memory. IRWB-012's existing tests independently exercise the general VM against its oracle and the reference compiler.
- Focused regressions cover buffer aliases, dynamic and out-of-range reads, invalid cells, writes through an alias, internal calls, state-budget exhaustion, correspondence and checkout. Changing the checksum bytecode multiplier to 17 still leaves a checked loop without dispatch loads. An intentionally different buffer makes the unrestricted meaning check fail.
- The finiteness argument comes from the state budget and memoization. Equivalence beyond the enumerated corpus calls rests on the transfer rules and host promise. No timing, compile-memory bound, run-time promise scan or universal equivalence proof was measured.

## Framework and Typed changes

No changes under src/framework were needed. The existing pass definition, structural validation, generated meaning invariant, dataflow analyses and total correspondence support this transformation. Typed gained buffer-valued assumptions, a checked block specializer, an opt-in checked live-range splitter and a source link for fresh locals in its transaction correspondence. The latter lets a promoted frame word point back to its initializing zero statement and a split local to its original assignment. The backend, corpus and Tix were unchanged.

## Reproduction

From the worktree root after npm run build, run the following commands in a shell with glob expansion.

```sh
node ttmp/2026/11/27/IRWB-036-B--*/scripts/01-inspect.mjs
node ttmp/2026/11/27/IRWB-036-B--*/scripts/02-measure.mjs --split
bash ttmp/2026/11/27/IRWB-036-B--*/scripts/03-verify.sh
```

Script 02 constructs the public bindings artifact and invokes the public pass APIs. Omitting --split runs the exhaustive comparison against the first speed revision. Script 04 implements the split/substitution schedule for the benchmark.

## Later

- Removing unused frame reservations requires accounting for frame-allocation failures and the ABI epilogue.
- Hosts that cannot guarantee fixed contents need a guard and an ordinary-VM fallback.
- Specializing callees or dynamically indexed writable arrays needs call-site or alias information.

## Verification receipt

The TypeScript build succeeded. Node ran 415 tests across the requested Typed, framework and workbench files. There were 412 passes, zero failures and three existing opt-in Candela skips. The [verification log](../various/03-verification.txt) includes the individual checks. The final benchmark then reproduced both 77-instruction, 48-byte results with the explicitly imported split pass.
