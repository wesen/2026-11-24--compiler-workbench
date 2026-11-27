# IRWB-029-I implementation diary

## Step 1: Orientation and design

Read both stage tickets' designs and reports, the contracts/IR READMEs, `define-pass.ts` and the tensor
sources; verified the base builds (`npm run build`) and the stage-2 numbers came from
`checkLowering`/`runTixCuda` over a cached remote binary. Created the ticket with docmgr and wrote the
design: fusion lives in the lowering as a kernel-plan analysis (`src/tensor/fusion.ts`) consumed by the
emitter, with two forms — flat (elementwise chains and epilogues, stage-2 thread mapping) and row (block
per row, shared staging, thread-0 sequential folds) — and IR-decided legality rules.

### Prompt Context
**User prompt (verbatim):** see the stage-3 brief (ticket IRWB-029-I; fusion without changing any result
bit, legality from the IR, checked under the exact relation, `fuse` option with stage-2 fallback).
**Assistant interpretation:** an order-preserving fusion stage for the Tix CUDA lowering.
**Inferred user intent:** fewer kernels and less global-memory traffic at unchanged bits, with the check
story intact and honest measurement.
**Commit (code):** a2ebdbc — "IRWB-029-I: design — fusion as kernel plans in the lowering (flat and row
forms, IR legality)"

### What I did
- Snapshot stage-2's emitted sources for all six corpus functions into
  `reference/stage2-sources/` before touching the emitter, to verify byte-identity later.

### Why
- The `fuse: false` path must remain stage 2 exactly; a snapshot turns that claim into a diff.

## Step 2: Fusion analysis and emitter

`src/tensor/fusion.ts` classifies members by shape against a driver (element = driver's shape, scalar =
its prefix), checks load locality per member (member loads: non-row components must be exactly the
consumer's own binder; row component free; staged-input loads re-checked per site at emission), and forms
maximal runs greedily, trying row groups first. `src/tensor/cuda-source.ts` grew flat and row emitters
beside the untouched stage-2 `emitKernel`; the host allocates buffers only for consumed outputs.

### What worked
- `fuse: false` output byte-identical to the stage-2 snapshots for all six corpus programs.
- Fused kernel counts: matmul 1→1, softmax 4→1, layernorm 4→1, attention 6→2, mlp 3→2, conv2d 1→1,
  unchanged after `inline`/`split-sum`.

### What didn't work
- First version of the row launch computed the shared-memory size from the kernel's `span` variable in
  *host* code — would not compile. Fixed by computing `rowLenHost` on the host from the driver's shape
  array.
- A refactor race left the walker's `resolve` signature as `(name: string, …)` while the row emitter
  passed a node-consuming closure; member reads then resolved to global buffers that were never allocated.
  Caught by reading the emitted softmax source (loads of `t1`/`t2`/`t3`), fixed by making every `resolve`
  take the load node.

### What warrants a second pair of eyes
- The load-locality rules in `rowLoadsLegal`/`flatLoadsLegal` and the staging-load bounds: they are the
  soundness core. The plan for softmax/layernorm/attention/mlp and the refusal cases are pinned by
  `tests/tensor/fusion.test.mjs`.

## Step 3: First GPU round — correct but slow on softmax

Smoke script `01-smoke-fused.mjs`: all six corpus functions fused and unfused bit-identical to the f32
meaning and to each other on the GB10. Benchmark script `02-benchmark-fusion.mjs` at the brief's sizes:
fused layernorm 0.45→0.17 ms, but fused softmax was 1.32 ms against stage 2's 0.80 ms.

### What I learned
- Thread 0's sequential fold read its row straight from global memory: one thread per block has almost no
  memory-level parallelism, while stage 2's one-thread-per-row max kernel has 4,096 concurrent row
  readers. The prototype's "rows staged through shared memory" is not cosmetic — it is what makes the
  single-thread fold viable. Added `stagedInputs` to the plan (coalesced cooperative staging of row-shaped
  tensors that scalar phases read along the row).

## Step 4: The branchless minmax

With staged inputs, softmax was still 0.59 ms; phase probes (script `03-softmax-phases.mjs`, timing-only
source surgery) showed the thread-0 max fold cost ~0.35 ms while the sum fold cost ~0.03 ms: the branchy
`minmax` helper (two branches + compare per fold step) defeated load pipelining. Replaced it with a
totally-ordered-integer max/min plus a final NaN select, argued equivalent on every input, and certified
the helper the lowering ships with script `04-minmax-probe.mjs`: 160,256 pairs on the GB10 (boundary words
crossed with each other and random words), zero word mismatches, zero NaN-class mismatches against
`Math.fround(Math.max/min)`. Softmax fused dropped to 0.39 ms; blockDim 128 (from 256) helped the serial
phases further (0.59→0.39 at 128, unchanged at 64).

### Commit (code)
4dcec00 — staged inputs, branchless minmax, plan payload with reads/writes.

## Step 5: Verification and measurement

- `tests/tensor/cuda-gpu.test.mjs` (11 checks, corpus `checkLowering` exact on original and optimized
  revisions under the fused default) and `tests/tensor/cuda-gpu-fused.test.mjs` (corpus fused-vs-unfused
  bit equality at moderate sizes; empty rows and empty outputs; a returned row scalar; stage-2 path still
  exact with `fuse: false`; 12 generated random programs bit-identical) all pass.
- `tests/framework/` 227/227 — no framework source change was needed (a finding, not an omission).
- Benchmarks: three full passes saved as `reference/benchmark-run-{1,2,3}.json`; results stable across runs.
