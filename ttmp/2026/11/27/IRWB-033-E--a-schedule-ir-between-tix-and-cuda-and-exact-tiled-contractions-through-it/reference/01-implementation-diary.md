---
Title: Implementation diary
Ticket: IRWB-033-E
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:09:17.552332324-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: reading, and the request

The task is the brief in the coordinator's prompt file `IRWB-033-E.md` (stage 6: a schedule IR between Tix and CUDA, and exact tiled contractions through it); I did not copy it here because it lives outside this ticket and I was told to read nothing else there. I read stage 3b's and stage 3's reports, stage 2's lowering code, `src/framework/contracts/README.md`, `ir/README.md`, `passes/define-pass.ts`, `strategy/README.md` and all of `src/tensor/`.

What I took from the reading: the emitter's kernel printer (`emitGroup`) is driven by `FusionGroup`, a record; shapes are unknown when the source is printed, so every shape-dependent choice has to be a launch-time choice among compiled forms, as 3b's gate is; `strategy.execute` is asynchronous and `cudaSource` is not.

The prior-art paper (arXiv 2609.11356) was summarised for me by a fetch agent from the abstract and the first third of the HTML: it describes a kernel's arithmetic by a descriptor of its reduction order (k step, split-K cuts, accumulation type) in which the tile sizes do not appear, and compares kernels by a canonical per-output reduction tree. In those terms every schedule here has one signature: a left-to-right chain with step 1, separate multiply and add.

## Step 2: probes 01 and 02, before the design

Hand-written exact matmul kernels on the GB10 (`scripts/01-tile-probe`, `02-tile-probe-round2`), each compared with the stage 2 kernel by `memcmp`. All variants were bit-identical. Results that shaped the design:

- 16 x 16 tiles with 1 x 1 patches and shared staging: 0.219 ms at 512^3 (stage 2: 0.213). 64 x 64 with 4 x 4 patches from global memory: 0.121. Both together: 0.076. So staging and register tiling are separate steps that only pay together.
- 64 x 64 / 4 x 4 / chunk 16 is the best or near it at 512^3, 1024 x 256 x 1024 and 4096^3 (6.3 TFLOP/s; 8 x 4 patches reach 7.2 there and lose at 512^3).
- With 16 tiles (200^3, 1024 x 1024 x 64) the 64 x 64 tile loses to stage 2; 32 x 32 / 2 x 2 / chunk 32 wins at 1024 x 1024 x 64 (0.072 against 0.096).

## Step 3: design (commit 6ca35e4)

Decisions and the alternatives are in the design document. The two I changed my mind on while writing it:

- I first sketched regions with nested alternatives (a whole fused group against its split form). A forced run of every alternative then needs a covering set of choice vectors, and the existing tests pin the `--gate` mechanism. I chose a flat kernel list in which a contraction is always its own kernel, with per-kernel launch-time choices, and accepted more launches for small shapes (measured in the report).
- Kernel count: I considered printing a group's kernels as one template definition to keep the count at one. It needs a dispatching wrapper whose launches and attribute calls cannot name their instantiation without the parameter types; I print one definition per schedule kernel and report the count as it is.

## Step 4: implementation (commits a1.. to 95d14c3)

Files: `src/tensor/schedule.ts` (IR, validator, adapter), `schedule-passes.ts` (passes, plan, `buildSchedule`), `schedule-eval.ts` (interpreter, `scheduleGate`), `cuda-source.ts` (`emitTile`, `emitSchedule`), `cuda-contract.ts` (sides, `tensor.schedule-tix`), `src/framework/strategy/sync.ts`, `src/framework/passes/bridge.ts`.

What failed, in order:

- **The artifact stores records with sorted keys.** The validator compared the statement's roles with the kernel's by `JSON.stringify` and rejected `mark-contractions`' own output (`Invalid schedule: k0: not the contraction it is marked as`). Roles are now compared field by field.
- **The first plan was illegal, and the IR said so.** `tile` with a 64 x 64 tile and one thread per element was refused by the legality check (`tile of k0 refused: more than 1,024 threads per block`). `register-tile` now grows the tile by the patch (unroll and jam), so the plan tiles 16 x 16 and patches 4 x 4.
- **`pkill -f 03-schedules.mjs` killed my own shell twice** (exit 144), because the pattern was in the shell's command line. I mistook it for a hang.
- **The checked build took 20 s for matmul and 51 s for attention.** A profile showed the plain evaluation of every statement repeated for every step and side. The interpreter now memoises a kernel's result by what the kernel does on the forced side and by the contents of the tensors it reads, and caches a factor's value per (row, term). Matmul is 3.3 s, most of it the reference evaluation the GPU check needs anyway.
- **The first generated kernel was 1.5 times slower than the probe** (0.119 against 0.076 ms at 512^3) and conv2d was slower than stage 2 (0.205 against 0.166). The decode of a linear index used 64-bit remainders on every staged element. The outermost axis needs none, and the kernel now indexes with 32 bits (the host keeps stage 2's mapping when a space reaches 2^31). Matmul: 0.079; conv2d: 0.128.

All GPU comparisons at non-multiple shapes were bit-identical on the first run (`scripts/04-run-forced.out.jsonl`).

## Step 5: measurements, and a rule that was wrong

Benchmarks (`scripts/05-benchmark*.out.jsonl`, 5 interleaved calls; 3 for 4096^3): matmul 512^3 0.080 ms (stage 2 0.211), 4096^3 20.4 ms (133.8), attention 0.222 (base 0.746), mlp 0.341 (0.624), conv2d 0.128 (0.166); softmax and layernorm at 1.00 and 1.02 of the base. All variants returned the same bits in every call.

- **The first full benchmark run died on `ssh fetch: kex_exchange_identification: read: Connection reset by peer`** while my GPU tests ran beside it. The scripts now retry a failed call; the table is in two parts (`part1`, `part2`).
- **Script 07 showed the tile-count rule choosing a slower kernel for short reductions:** 256 x 16 x 256 at 2.06 of stage 2, 512 x 16 x 512 at 1.13, 512 x 4 x 512 at 1.33. I added `minTerms` to the tile configuration (IR field, pass argument, host condition) and set it to 64, the smallest term count measured winning. The benchmark programs all have at least 64 terms. `schedule-gpu.test.mjs` asserts the new choice.
- Script 07's remaining rows and its part b (small shapes of attention and mlp) had not finished when I wrote the report; the report says which claims are argued.

Checks: 20 existing GPU tests pass (`various/existing-gpu-tests.log`, on the build before Prettier and `minTerms`); `schedule-gpu.test.mjs` passes (`various/schedule-gpu-test.log`); script 06: 19 `checkLowering` calls, all exact, 1.9 to 17.9 s each.

Not done, and why: epilogue fusion and the whole-group alternative (time); random programs through the new lowering (time; the 3b generator is in another ticket's scripts).

### What to review first

- `src/tensor/schedule.ts` `validate` and `contractionOf`: the legality rules.
- `src/tensor/cuda-source.ts` `emitTile`: the kernel, especially the edge conditions (`r0 + r < rows`, `kk < kn`) and the 32-bit guard on the host.
- `src/tensor/schedule-eval.ts` `tile`: it must mirror `emitTile`; they are the two implementations of a tile configuration's meaning.
