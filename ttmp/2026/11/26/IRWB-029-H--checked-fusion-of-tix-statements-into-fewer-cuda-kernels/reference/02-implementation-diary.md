---
Title: Implementation diary
Ticket: IRWB-029-H
Status: active
Topics:
    - compiler
    - ir
    - verification
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: The plan, its rules and the staged-read predicate
    - Path: repo://src/tensor/cuda-source.ts
      Note: The shared scalar emitter and the block-per-row kernel
    - Path: repo://ttmp/2026/11/26/IRWB-029-H--checked-fusion-of-tix-statements-into-fewer-cuda-kernels/scripts/03-exactness-probe.mjs
      Note: 58 exact-relation checks over the corpus and 17 edge programs
    - Path: repo://ttmp/2026/11/26/IRWB-029-H--checked-fusion-of-tix-statements-into-fewer-cuda-kernels/scripts/05-benchmark.mjs
      Note: The fused/unfused timing table
ExternalSources: []
Summary: Design and its amendments, the fusion implementation, the failures that changed it, and the measurements taken.
LastUpdated: 2026-11-27T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Reading the two stage tickets, and the design

I read IRWB-020-B's design and report and IRWB-022-I's design and report, then the framework's `contracts` and `ir`
READMEs, `define-pass.ts`, and all of `src/tensor/`, `corpus/tensor/` and `tools/cuda-remote.mjs`. The worktree at
entry was `f706115` on `t3-ds-x/irwb-029-h`.

What the base already had, from the changes that landed after stage 2: the exact relation (`cuda-contract.ts`'s
`compare` on raw words with NaN as a class), the meaning gate's distinct shape sizes and empty extents, `changed`
and `reason` on `optimizeTix` steps, in-flight batch sharing (`differential.ts`'s `IN_FLIGHT`), and `--link` in the
tool. I noted that `cudaSource`, `runTixCuda` and `checkLowering` had no `fuse` and `runTixCuda` had no `benchmark`,
so the fixed API of this stage is new surface on all three.

Design: [01](../design-doc/01-checked-fusion-of-tix-statements-into-fewer-cuda-kernels.md). The decision I spent the
most thought on was *where* fusion lives. The stage 2 argument against a kernel IR — "it restates what the Tix IR
already determines" — stops being true for fusion, because kernel boundaries, thread mappings and storage classes are
not in the Tix IR. But the artifact that has to be judged is the CUDA translation unit, which already exists, so a
kernel IR would be a projection with a revision identity whose only consumer is itself. I chose a plan computed on
the Tix IR and printed by the emitter.

### Probe 01: can a v6 correspondence express several statements becoming one kernel?

The brief said to test this. `scripts/01-grouped-correspondence-probe.mjs`:

- `{from: [m, s], to: [k0]}` with both universes declared: accepted, one entry.
- With an empty target universe and `to: ['k0']`: rejected, `Unknown target entity k0`.
- With `to: []`: accepted, and it means *removal*, not grouping.
- `makeCorrespondence` completes an unaccounted target entity with an addition rather than failing, so the error
  comes from naming a target that was never declared.

So the framework can express the grouping, but only against a target entity universe. The CUDA artifact has none.
This became the report's framework finding and its proposal, and it confirmed the emitter choice: the statement→kernel
grouping is recorded in the artifact payload (the emitted source) and certified by the exact GPU relation, with a
local test asserting the plan's kernel count equals the number of `__global__` definitions.

Committed as `7649d29`: ticket, design, probe 01.

## Step 2. The plan, and the first wrong rule

`src/tensor/fusion.ts` first, because it can be tested without the GPU. Two substitution rules, then grouping, then
storage, then prefetch.

The first version made every pointwise statement substitutable at *every* read. Dropping that plan onto the corpus
showed the problem immediately: softmax's `e` was substituted into both the sum and the divide, so the sum became
"one thread computes 1024 double `exp`s serially per row". Exact, and much slower. I added the condition that a
pointwise statement is only substituted where no reduction encloses the read, which is a cost rule, not a legality
rule — recomputation is always exact. The same reasoning decided P2's single-read condition: `mlp`'s `h` appears
*five* times in the GELU expression, so substituting it would recompute a 256-term contraction five times, and it is
staged in shared memory instead.

Two things I had to get right in the plan rather than the emitter, because they must agree:

- **`stagedIndex`**: whether a load of a staged value reads the staged row's own element. Shared by the planner (to
  decide `shared` versus `global`) and by the emitter (to decide the address). If the two ever disagree the emitted
  kernel reads the wrong words or leaves out a kernel argument.
- **`covers`**: which index forms walk exactly `[0, dim)`. A plain binder covers its own `dim`; the stage 1
  `split-sum` address `4 * block + lane` also covers it exactly, because its tail extent is `min(4, dim - 4 * block)`.
  Without the second case every *optimized* corpus program silently lost its staging, which is what the first plan
  dump showed for `layernorm` and `mlp`.

## Step 3. The emitter, and the failures that shaped it

`emitCuda(fn, { fuse })` prints either stage 2's one-kernel-per-statement lowering or the plan. I refactored the
scalar-expression emission into one `scalarEmitter` used by both: two copies of the arithmetic would be two chances
to round differently, and the whole stage rests on there being one.

Failures, in order:

1. **`smem` leaked into the host code.** The shared footprint was accumulated as a *pointer* expression
   (`smem + dim …`) and then printed into the launch configuration. Split the pointer offsets from the size.
2. **A kernel that reads a global tensor it also writes.** `permuted-staged` (`t[i,j] = s[j,i] + 1`) put `t1` in the
   parameter list twice, once as `const float*` and once as `float*`. Now the parameter list is
   `reads \ writes` plus `writes`.
3. **Prefetched tensors were not kernel parameters**, because their loads were counted as redirected and the copy
   loop that needs the global pointer was not counted at all.
4. **Two row kernels in one translation unit redeclared `shared_limit`.** Named per kernel.

Then the check that the plan and the text agree: `fuse: false` must be stage 2's lowering unchanged. I extracted the
committed `cuda-source.ts` and `model.ts` from `HEAD`, bundled them with esbuild, and compared the two emitters'
output for the six corpus programs (original and after `inline` + `split-sum`) and three extra programs: identical,
character for character. Re-running that comparison after the last changes shows exactly one difference — the
`#include <string>` that the fused launch's error message needs — and nothing else, so the flat kernel path is
untouched code. That comparison is why I could add a lowering without touching stage 2's.

Committed as `f8c71f1`, after updating one existing test in `tests/tensor/cuda.test.mjs` that asserted stage 2's
kernel count on a program that now fuses to one kernel; it now asserts both counts, `fuse: false` being the old one.

## Step 4. Exactness on the GB10

`scripts/03-exactness-probe.mjs` runs the contract on the corpus before and after optimization and on 17 small
programs chosen for the plan's edges: two rows of different extents, a permuted read of a reduction result, a nested
reduction, a rank three statement, empty extents, signed zeros, NaN and domain edges, a dead statement, a chain of
three reductions. 58 checks, all accepted as `exact`, median 2.6 s each.

The four compilation failures this probe found are the same four fixes as Step 3; the probe is what found them.
Two of my probe programs were also not valid Tix (`min(j)` parses as the two-argument call; a shape symbol cannot be
inferred from an unused axis), and fixing them was faster than arguing with the grammar.

`tests/tensor/cuda-gpu.test.mjs` then gained the direct evidence the report leans on: fused against unfused and
against `runTix` word for word on the corpus at small sizes and on six edge programs, and one mutant that drops the
last lane of the sum fold, which the contract rejects with a counterexample at a named coordinate.

## Step 5. Bytes

`scripts/04-bytes.mjs` counts what each kernel reads and writes. The first version counted every issued load and got
1.07 GB for matmul against the brief's 0.14 ms for a 32 MB stream: an *issued* count is not DRAM traffic when the
same address is read by thousands of threads. It also forgot the per-block factor for row kernels, and looked up
`p.lane` on a plan entry whose field is `slots`.

The final script counts both: issued (every load × 4 bytes over the threads that run it, an upper bound on DRAM
traffic) and distinct (per kernel and tensor, `min(issued, tensor size)`, the compulsory traffic and a lower bound).
The fused softmax and layernorm figures then came out at 33.55 MB and a 0.138 ms floor, which agrees with the
brief's independent 0.14 ms estimate — a check on the counting.

## Step 6. Timing, and a block size I had not planned to change

`scripts/05-benchmark.mjs` uses the public `runTixCuda(..., { benchmark: true })`. The first runs disagreed with
themselves by up to 26% because the GPU is shared, so each cell now takes three calls (nine CUDA-event intervals
each) and reports the median with all three values. `matmul` and `conv2d` emit the same translation unit either way,
so their ratio measures the noise: about 2%.

With 256 threads the fused softmax was 0.605 ms against a 0.138 ms floor, which was further from the floor than the
analysis of its traffic suggested. `scripts/06-block-size.mjs` patched only the launch configuration and measured
32/64/128/256: 0.414 ms at 128 against 0.609 at 256 for softmax, 0.152 against 0.180 for layernorm, reproducible to
under 1% over two runs. That is the expected shape — a fold is one thread's serial work, so resident *blocks*, not
threads, set how many rows are folded at once — so the row kernel now launches 128 threads and the flat kernel keeps
256. The design said the block size would stay at 256 to isolate fusion; this measurement is the amendment.

## Step 7. The contract's cost

`scripts/07-contract-cost.mjs`: 28 to 40 cases per corpus function, 360 to 5900 compared elements, 2.2 to 4.1 s for a
cold check (dominated by `nvcc`), about 1 ms to replay a verdict for the same candidate revision. `matmul` and
`conv2d` show a 1 ms `fuse: false` check because their unfused source *is* the fused source, so the artifact
revision and its verdict are the same evidence.

## Step 8. Finishing

Amendments to the design, this diary and the report; the ticket's tasks and changelog. Final state: `npm run build`
clean, 33 local tensor tests and 19 GB10 tensor tests passing, 227 framework tests passing (no framework source
changed), and every probe in `scripts/` re-runnable from the committed tree.
