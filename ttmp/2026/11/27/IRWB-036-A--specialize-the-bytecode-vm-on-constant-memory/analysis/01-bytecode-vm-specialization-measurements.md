---
Title: Bytecode VM specialization measurements
Ticket: IRWB-036-A
Status: active
Topics: []
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/program.ts
      Note: Staged binding assumptions and revision publication
    - Path: repo://src/typed/promote-frame.ts
      Note: Audited private slot promotion
    - Path: repo://src/typed/specialize-memory.ts
      Note: Binding-time analysis and residual CFG
    - Path: repo://tests/typed/specialize-memory.test.mjs
      Note: Binding mismatch, refusals and provenance
    - Path: repo://ttmp/2026/11/27/IRWB-036-A--specialize-the-bytecode-vm-on-constant-memory/scripts/02-measure-vm.mjs
      Note: Benchmark and exhaustive replay
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:56:45.250781098-05:00
WhatFor: ""
WhenToUse: ""
---
# Bytecode VM specialization measurements

A checked specialization of the Typed bytecode VM removed the bytecode fetch and dispatch from both fixtures. With fixed frame slots promoted to scalar locals, seeded Fibonacci took **161 RV32 instructions and 64 bytes** and rolling checksum took **136 instructions and 52 bytes**. This closes **98.87%** and **99.09%** of the instruction gap between the general VM and the respective hand-written loops.

## Measurements

The 64-cell image, entry offsets, and hand-written Typed loops come from the existing corpus and IRWB-012 test. All instruction counts below are at `n = 12` and `seed = 8`, with `coalesce: true`. Bytes count emitted RV32 code for the named function. The general VM is one 840-byte image shared across both entries. The two automatic specializations are standalone one-function images. The original hand-written loops share one 76-byte image.

| Stage | Fibonacci instructions | Fibonacci bytes | Checksum instructions | Checksum bytes |
| --- | ---: | ---: | ---: | ---: |
| General VM at r0 | 7,678 | 840 | 6,874 | 840 |
| General VM after `speed` | 9,286 | 904 | 8,218 | 904 |
| Entry scalar binding and `speed` | 9,287 | 908 | 8,219 | 908 |
| Raw dispatch specialization | 2,154 | 932 | 1,914 | 852 |
| Dispatch specialization and `speed` | 548 | 452 | 468 | 396 |
| Dispatch specialization, promotion and `speed` | **161** | **64** | **136** | **52** |
| Hand-written Typed loops after `speed` | 75 | 40 | 74 | 36 |

Gap closed is `(general_r0 - automatic) / (general_r0 - hand_written)`. The dispatch-only variant after `speed` closes 93.78% and 94.21%. Promotion reduces that variant by a further 387 and 332 instructions. The final images are 92.38% and 93.81% smaller than the general image, with 24 and 16 more bytes than their respective hand-written functions.

The evaluator and RV32 emulator agreed with the general VM for both cleaned automatic variants over all 221 count/seed pairs at each entry. Both returned normally, produced the same signed value as the hand-written loops, and preserved caller memory. The two measured outputs at count 12 and seed 8 were 1,152 and 1,298,667,478.

## Binding time and residual control flow

`Program.specialize` accepts a `typed.bindings` artifact containing a u16 `cells` fact for the buffer and an integer `value` fact for the entry. It validates the artifact and uses its contents to build the check's argument specifications. The generated calls therefore pass the same promised length and cells to r0 and to the residual revision, independently of the original project generator. The pass, frame promotion, and each changed cleanup pass agreed on 40/40 sampled cases per checked function. Assumptions are published with the accepted revision and restored by checkout. The negative test with different cells disagreed under the unrestricted contract.

The block walker carries known integers, the identity of promised buffers, checked cell addresses and private frame offsets. A bound buffer's u32 length and its in-range checked u16 loads are static. Runtime values read from the private frame are dynamic. The pass folds an integer branch when its condition is known and follows both arms when it is dynamic. Every variant has a source block and the known bindings of the locals live on entry. Revisiting a variant closes a residual edge, including the backward jump in each guest loop. The runtime count still controls the guest loop. The pass uses the existing Typed transaction origins to identify copied entities and the host facts that justified each variant and folded load.

| Raw residual construction | Fibonacci | Checksum |
| --- | ---: | ---: |
| Block variants | 244 | 222 |
| Statements | 386 | 350 |
| Folded u16 buffer fetches | 34 | 30 |
| Conditional branches made static | 116 | 105 |
| Blocks after checked cleanup | 4 | 4 |

The default block budget is source blocks times promised cells, with one cell's worth allowed when the promise is empty. The bound covers one variant per block per cell. Other live static values may add variants. A measured one-block budget exhausted the worklist allowance and published no revision or assumptions. A dynamic or out-of-range checked address, a reached call, or a store whose address is outside the proven private frame aborts the draft. In the out-of-range case the original checked access remains available in the general revision. A test with a write through a buffer alias on one dynamic branch confirmed rejection even when the other branch only reads. Calls from another Typed function into a bound entry are refused because the entry's assumptions only constrain host calls.

## Why promotion ran early

On the residual IR, `dce, cfg` removes dead address temporaries and collapses branch chains. Promotion then audits the reachable function for direct, aligned, in-range i32 slot accesses. It requires entry zeroing to cover each slot, rejects escaping addresses and other memory accesses, replaces loads and stores with scalar locals, and removes the private frame. The benchmark imports the opt-in `promoteFrame` pass and invokes it through `Program.apply`. Running promotion after `speed` changed neither fixture. The listing showed LICM had already hoisted frame addresses into locals, so the direct-address audit could no longer admit those functions.

The final listings still contain assignments that move values between the former guest stack and guest locals. That is consistent with the remaining 86 and 62 instructions above the hand loops. One concrete difference is the extra copy in each loop header before its zero test. Typed's rotation pass expects a test-only header, so the residual loops kept a separate header and backedge. Eliminating the remaining VM copies or improving register allocation was outside this stage. The individual costs of those changes were not measured.

## Framework impact

No generic framework files changed. The existing liveness analysis supplied live-in local sets. The existing native pass interface validated the residual CFG and collected correspondence, and the existing meaning contract accepted or rejected candidates on generated cases.

Typed needed two additions at that boundary. Its program host now stages scalar and buffer assumptions with the pass so that the active revision and its check domain agree. Its transaction write kinds now include `frame` so promotion declares the change to the existing function entity when it drops `arrayBytes`. The existing Typed CFG, statement and value write declarations cover residualization. Promotion keeps CFG and dominators valid. It invalidates the loop analysis because that analysis records the locals written in each loop.

## Evidence and limits

The tables, sampled gate results, exhaustive fixture checks, unrestricted mismatch, and budget refusal are measurements. Within the supported calling convention, ownership of the private frame and rejection of unclassified writes or calls are the reason a folded bytecode read remains valid. This is a static argument, with the differential checks as corroboration. The host promise is not checked by the emitted image. This stage has no runtime guard, no generic fallback edge within a specialized image, and no proof for arbitrary interpreters or inputs outside the stated domain.

Build with `npm run build`. Run the measurement script with `--promote` to reproduce all rows. Add `--listing` to inspect the final CFG, or use it without `--promote` to inspect the address locals after `speed`.

- [Lifted VM probe](../scripts/01-lift-vm.mjs)
- [Measurement and exhaustive replay](../scripts/02-measure-vm.mjs)
- [Measured JSON rows](../various/01-vm-measurements.json)

## Final validation

`npm run build` passed on Node 24.18.0. Running the 56 Typed, framework, and workbench test files with `node --test --test-concurrency=2 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs` produced 411 passes, three opt-in skips, and zero failures. `node tools/build-site.mjs` built the browser bundle. The benchmark rerun reproduced the table and the 442-call replay.
