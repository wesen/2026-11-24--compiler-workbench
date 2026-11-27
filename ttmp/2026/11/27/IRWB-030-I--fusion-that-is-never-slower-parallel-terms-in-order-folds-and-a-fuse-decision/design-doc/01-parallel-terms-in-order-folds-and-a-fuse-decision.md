---
Title: Parallel terms, in-order folds, and a fuse decision
Ticket: IRWB-030-I
Status: active
Topics:
    - tensor
    - gpu
    - framework
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: planFusion decides groups and, new in this stage, which reductions stage their terms
    - Path: repo://src/tensor/cuda-source.ts
      Note: emitGroup gains the cooperative term phase and the in-order fold
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Lowering transformation; version bump for the staged lowering
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda derives shape values at launch and passes them to the planner
ExternalSources: []
Summary: Compute a reduction's terms in parallel and fold them in order; decide fusion from the IR, with shape values at launch where only they separate fused from unfused.
LastUpdated: 2026-11-27T09:00:00-05:00
WhatFor: Design of stage 3b before implementation
WhenToUse: Reviewing term staging, its exactness argument, and the fuse decision
---

# Parallel terms, in-order folds, and a fuse decision

## Problem

Stage 3's block mode computes a row-scalar member (rank = block depth, e.g. layernorm's
`mean[i] = sum(d) x[i,d] / D`) on thread 0 of the row's block, with the reduction's whole body
inlined into its serial fold. Every term — here a division — is computed by one thread. Stage 2 ran
the same reduction one thread per row across the grid, so its terms were spread over the machine.
The fused kernel loses exactly that concurrency. Measured on the merged stage 3: layernorm with the
division inside the reduction runs 0.569 ms fused against 0.577 ms unfused; attention inside 1.412
against 1.503 — wins by margins near the noise, where the outside placements win by 2–2.5×.

## Part 1: parallel terms, in-order fold (term staging)

**Scheme.** In a block-mode kernel, a staged reduction of a row-scalar member is emitted as two
phases. A *term phase* runs block-wide before the member's element loop: the reduction's index space
is flattened in the meaning's order (first listed axis outermost), thread `t` of the block computes
term `t`, `t += blockDim.x`, into a term buffer in shared memory (or the global scratch area when the
row set does not fit). After `__syncthreads()`, the member's element loop runs as before — for a
row-scalar member, thread 0 — and the reduce node *folds* the buffer in order:
`acc = init; for (t = 0; t < count; ++t) acc = op(acc, buf[t])`, with `__fadd_rn` for sum and
`max_nan` for max, exactly the operations and order of the inlined fold.

**Why the bits do not change.** A term is the scalar code the emitter already produces for the
reduction body, with the reduction's indices bound to the flattened position's axis values. Its value
depends only on tensor contents, shape values and its own indices — not on which thread computes it
and not on the accumulator (the accumulator appears only in the fold, by construction of Tix
expressions: a reduction body cannot name values computed outside it). The fold applies the same
instruction to the same values in the same order as the inlined loop, starting from the same init.
Empty extents give count 0, no terms, and the untouched init, as before. So staged and inline folds
are bit-identical, and the rest of the kernel is unchanged from stage 3, whose exactness argument
then carries over.

**Which reductions stage — decided from the IR**, recorded in the plan as decisions and refusals:

- **S0 (where).** Only reductions inside row-scalar members of block-mode groups. A reduction inside
  a row member (rank > depth) already has its terms spread one output element per thread, as stage 2
  spread them; staging would need cross-thread cooperation per output element for no measured gain
  (refused, reason recorded). Thread-mode groups keep stage 2's per-element mapping; never staged.
- **S1 (no pure addressing).** The body is not a single load. A term that is only an address adds no work to
  parallelize. Measured (script 03, fused kernel both sides): staging a copy of a row buffer ran 3% slower
  (softmax's `m`: the terms are loads of the staged `x`); staging single loads of a global tensor measured
  neutral; every body that computes anything staged 1.1–2.8 times faster — a division per term
  (layernorm-inside), a multiply of loads (1.12×), and a 20 000-term fold whose buffer pushed the row set into
  the global scratch fallback still ran 2.8× faster than the inline fold in shared memory. So the rule is:
  stage everything whose terms are computed; refuse only single-load bodies, with the residency stated.
- **S3 (no nesting).** The reduction is not inside another reduction's body. A nested reduction's
  terms would need a barrier per enclosing term to be computed cooperatively; it stays inline in
  whichever thread computes the enclosing term. (The enclosing reduction itself stages; its terms run
  the inner fold inline, serially, inside each term — measured exact.)
- **S4 (no split bounds).** Every axis extent has kind `dim`. The `blocks`/`tail` extents that
  split-sum generates make the term space ragged (the tail bound depends on the enclosing block
  index); flattening them is possible but unmeasured, so they keep the inline fold, with the reason
  recorded. Optimized programs stay exact; their checks just do not use staging.

**Buffers.** The term buffers join the row allocation: one buffer `q` sized as the maximum over the
group's members of the total staged term count of that member, placed after the row buffers, reused
by each member in turn (a member's staged values are dead after its fold, which completes before the
barrier that precedes the next member's term phase; per-reduce offsets inside `q` keep a member's
reductions apart). The shared-versus-scratch decision covers `q` like any row. When a reduction's
count is 0 the buffer is simply unused.

## Part 2: the fuse decision

Two levels, both justified by measurement (scripts; the thresholds in the report are measured
crossovers, not round numbers):

- **Lowering time, from the IR.** Thread-mode groups always fuse: the mapping is stage 2's, the
  members pass in registers, so fusion strictly removes global traffic and never removes
  parallelism. Block-mode groups fuse by default; the risk case is a group whose work is its row
  phase.
- **Launch time, from the shape values.** The block-domain extent's value is known only when the
  inputs are (`runTixCuda` receives them; `cudaSource` and `checkLowering` do not). So
  `planFusion(fn, shapeValues?)` takes the shape values when the caller has them: `runTixCuda`
  derives them from the inputs' param shapes and passes them; `cudaSource` and `checkLowering` plan
  without values and keep stage 3's behaviour. With values, a block-mode group stays unfused when
  both hold (measured, script 02):
  1. no member folds a serial chain as long as the row (a reduction's flattened count below the
     longest member row), and
  2. the row count is below the measured crossover of 64 rows.

  The first condition is the measured discriminator. When a member folds the whole row — softmax,
  layernorm, their inside variants — stage 2's row-scalar kernel runs the fold on one thread per row
  over uncoalesced global loads, and the fused kernel's fold wins at every row count measured
  (ratios 0.14–0.58 over N = 1…4096, C = 1024…1 048 576). When no member does — a heavy elementwise
  row phase (`tanh·exp` per element), with or without staged rows — one block per row confines the
  phase to `blockDim` threads: measured 9.6× slower at one row, parity at about 32 rows, ahead from
  64 rows (ratios 0.94 at 32, 0.77–0.94 at 64, 0.52–0.62 at 96 and above; C = 1024, 4096, 16384).
  The crossover 64 sits one measured grid point above the parity zone, with the run-to-run noise of
  2–5% in mind; below it the gate's cost is a missed win of at most about 1.3×, never a loss.

Both sides of the choice are exact lowerings, so the decision changes only time, never a bit; a
program where the rule fires reports the unfused plan's kernel count. The decision itself is a
performance heuristic outside the checked transformation, and the report says so.

## Measurements planned

1. Baseline: the brief's table reproduced on this machine (six corpus programs + the inside variants
   of layernorm and attention, fused and unfused; medians of three `benchmark` calls).
2. A shape grid (rows × row length) for softmax-like, layernorm-like and adversarial row-phase
   programs, fused against unfused: locates the losing region and gives the crossover for the rule.
3. Staging probes, fused kernel both sides: a multiply-of-loads fold staged against inline; a global
   single-load max; a pure copy of a staged row; a 20 000-term fold through the scratch fallback.
4. Final table: kernel counts and benchmark times for all eight programs, fused and unfused, plus
   which reductions staged per block-mode kernel; `checkLowering` cost per program.

## Implementation plan

1. `fusion.ts`: collect reduce nodes per statement in pre-order; decide staging (S0–S4); extend
   `FusionGroup` with staged terms and staging refusals; `planFusion(fn, shapeValues?)` with the
   launch-time rule; commit.
2. `cuda-source.ts`: term phase and fold emission in `emitGroup`, term buffer in the row allocation;
   `emitKernel` untouched so `fuse: false` stays byte-identical.
3. Tests: plan-level decisions and refusals (`fusion.test.mjs`); GPU: staged exactness including a
   reversed-fold mutant, empty extents, a split-sum program, a global-single-load max
   (`fusion-gpu.test.mjs`).
4. Benchmarks and the report.

## Alternatives

- **Staging terms for row members too** (cooperative per-element with `blockDim` above the row
  length): reduces serial divides per thread by `blockDim / rowLength`, but needs tiled term buffers
  and re-owned element mapping; the measured fused-vs-unfused margins for the row-member programs
  (attention, mlp) do not demand it. Revisit if the final table shows a loss.
- **Dual emission with a launch-time choice between the fused kernel and stage-2 singleton kernels**
  (both compiled, host picks): the strongest form of the decision, but it multiplies the kernel count
  of every block-mode program and so breaks the kernel-count comparison this stage is judged on.
  The chosen design refuses fusion only when the caller's shape values allow the decision.
- **A lowering-time-only rule** (IR alone): cannot see the row count, which is what separates the
  losing region; it would either never fire or need a value-free proxy that measurement does not
  support.
- **Parallel tree reductions, split-K, term reassociation**: out of scope by the brief.

## Framework expectations

No framework change is planned. The known gap — correspondence entity lists are not compared with
the artifacts' entities — is being fixed in `src/framework/ir/` by another ticket; this stage does
not touch the correspondence code. If the staged lowering needs anything the contracts layer does not
express, the change and its reason become a primary result.

## Open questions (resolved by measurement during the stage)

- Does staging a global single-load reduction pay? — No: neutral (script 03); refused.
- Does the contraction thread cap of 64 stay right once reductions stage? — The staged reductions
  are in row-scalar members, which the cap logic already treats as rows-only (128); the contraction
  cap governs row members, whose emissions this stage does not change. Not re-measured.
- Where exactly is the few-rows crossover, and is one threshold enough? — Parity at about 32 rows
  for C = 1024, 4096 and 16384 alike; threshold 64 (script 02).
