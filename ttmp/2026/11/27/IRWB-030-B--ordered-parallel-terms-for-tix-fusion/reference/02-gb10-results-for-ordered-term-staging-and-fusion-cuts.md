---
Title: GB10 results for ordered term staging and fusion cuts
Ticket: IRWB-030-B
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
Summary: Ordered shared terms accelerate inside layernorm, and separating the divided value contraction accelerates inside attention.
LastUpdated: 2026-11-27T01:30:59.123726146-05:00
WhatFor: ""
WhenToUse: ""
---

# GB10 results for ordered term staging and fusion cuts

## GB10 measurements

Each table entry is the median of three public `runTixCuda` calls with `benchmark: true`. Each call takes the timed lock, warms up once, and returns the median of three CUDA event intervals around all the function's kernel launches. Transfers, compilation and startup are outside the interval. Kernel counts count `__global__ void` definitions in the corresponding `cudaSource`. Inputs use stage 3's seed 20 recipe. Script 01 spells out both inside variants. It changes the IR before planning, including removing the separate weight statement in inside attention.

| Program | Shape values | Kernels fused / unfused | Fused ms | Unfused ms | Parallel terms by block kernel |
| --- | --- | ---: | ---: | ---: | --- |
| matmul | M=K=N=512 | 1 / 1 | 0.214 | 0.213 | thread mode |
| softmax | N=4096, C=1024 | 1 / 4 | 0.384 | 0.802 | k0 none |
| layernorm | N=4096, D=1024 | 1 / 4 | 0.187 | 0.478 | k0 none |
| attention | Q=K=1024, D=V=64 | 1 / 6 | 0.753 | 1.048 | k0 none |
| mlp | N=1024, D=256, H=1024, O=256 | 1 / 3 | 0.727 | 0.936 | k0 none |
| conv2d | N=8, C=16, H=W=64, O=32, 3×3 | 1 / 1 | 0.166 | 0.166 | thread mode |
| layernorm inside | N=4096, D=1024 | 1 / 4 | 0.239 | 0.566 | k0 mean and variance |
| attention inside | Q=K=1024, D=V=64 | 2 / 5 | 1.149 | 1.492 | k0 none, k1 thread mode |

All three rounds include both modes. Script 05 checks each full-size output digest across all six calls. The exact contract separately compares the fused GPU result with the current f32 interpreter on small sampled cases. Full-size equality to the interpreter follows from agreement with stage 2 provided stage 2 is correct. We did not rerun the interpreter on the full-size arrays. The power-of-two divisor in the layernorm benchmark can hide a change in division placement. The contract also tests non-power-of-two extents.

## What changed the decision

The planner still requires contiguous producer-consumer use, identical leading extents and identity leading indices on every in-group read. It declines a legal join when the incoming member has trailing output axes, a reduction contains a division in its body, and the body loads a matrix at [reduction index, trailing output index]. The new group starts with that member at its own rank. Liveness is computed after the cut. Inside attention materializes both e and z across the boundary. The preceding block computes score, shift, e and z, while the output contraction gets a grid of output elements. The outside-placement score has the division after its sum, and the final value contraction has no division. Its chain stays in one block-mode kernel.

At Q=K=1024 and D=V=64, three trials of the all-in-one inside-attention schedule had a median of 1.412 ms. Splitting score out instead took 1.620 ms. Splitting out the divided value contraction took 1.100 ms in the pilot. This rule uses operand indices and operator placement, with no fitted size threshold. Softmax retains its existing exp implementation. Matmul and conv2d generate identical sources in both modes.

A separate stress case uses one row, 1024 reduction terms and 1024 output columns. The same IR rule refuses the only fusion, producing byte-identical source to the unfused lowering. Forcing that row onto a single block took 2.695 ms versus 0.177 ms for the selected two-kernel schedule (medians of three). [Single-row probe](../scripts/07-single-row-cut.mjs) and [raw observations](../scripts/07-single-row-cut.jsonl).

## How the fold stays exact

In block mode a scalar at one block-domain point can use the other threads of the block. For a selected reduction, thread t computes indices t, t + blockDim.x, and so on, and writes each term into the shared slot bearing its original index. The existing scalar writer supplies the f32 rounding points. All threads reach a barrier. Thread zero runs the original sum or max loop and reads each term by index. The following statement barrier protects reuse of the term buffer. A zero bound executes neither loop body and keeps the original identity. Operations outside the reduction remain at their original positions.

A statement qualifies when it has exactly one reduction, the reduction has one ordinary dimension binder, the output is a row scalar, and its body contains division, square root, exp, log or tanh. Multiple row scalars reuse enough space for the largest of their extents. The host compares the combined bytes with the queried opt-in shared limit. When only the extra terms would overflow, it skips staging and keeps the original shared rows. When the original rows also overflow, it uses stage 3's global scratch and computes ordinary serial terms. Optional terms consume no global scratch.

Inside layernorm's serial schedule took 0.582 ms in script 02. The pilot staged mean and variance and took 0.211 ms. For outside layernorm, staging the variance's multiplication alone took 0.198 ms versus 0.199 ms serial. That difference is below the supplied 2% repeatability estimate. Plain loads, sign changes, multiplication, addition, subtraction and min/max alone keep the cheaper serial path. A row-vector member already assigns independent outputs to different threads. Its reduction does not enter the cooperative phase. Reductions with multiple/nested loops, multiple reductions in one expression, and generated split bounds retain the original loop tree. This avoids changing nesting, binding or the distinct rounding points of split sums.

Script 06 isolates each eligible function in a sum over rows of width 1024. One benchmark call per mode observed staged / serial times in ms of 0.081 / 0.269 for sqrt, 0.345 / 11.922 for exp, 0.678 / 21.240 for log, and 0.572 / 17.823 for tanh. Each returned row matched between modes. These runs evaluate the existing rounded operations. [Unary-operation probe](../scripts/06-row-costs.mjs) and [raw observations](../scripts/06-row-costs.jsonl).

## Contract and framework

The checked transformation accepts the current Tix artifact, function and fuse flag and emits the actual CUDA source artifact and a statement-to-kernel correspondence. Each eligible case checks shape, length and f32 words, including the sign of zero and infinity. Any NaN matches another NaN. Differential evidence is keyed by the baseline revision/function and subject revision/execution profile. Concurrent identical checks share pending GPU work. A replay can use completed verdicts. The check judges meaning. It does not measure speed.

The eight cold checks all accepted as exact, covering 280 sampled cases in total. Case counts in table order were 36, 32, 32, 40, 40, 28, 32 and 40. Each cold call sent one batch. Wall times were 2.51–4.70 s with the remote compile cache available. In-process replay took 0.65–4.73 ms. Cold here means an empty local differential memo. The recipe uses seed 20, distinct-size and empty-extent assignments, and signed, positive, half-ULP and signed-zero inputs. These timings include preparing reference values and collecting evidence. They are separate from kernel event times.

No framework source or remote tool changed. The heterogeneous transformation, correspondence, batched differential check, compilation cache, timed lock and event timer already express the stage's needs. The domain lowering transformation version advances to 3 to identify the new scheduler. The known correspondence entity-universe issue remains with its assigned ticket. No new linker option or runner protocol was needed.

## Evidence and limits

The exactness argument applies to checked Tix IR on stage 2's execution domain. Performance measurements apply to the reported shapes on the GB10. A structural rule cannot establish a wall-time inequality for every shape. In particular, a small block domain with very long rows can underfill the GPU. No run-time search is part of the lowering. Contraction tiling, reassociation, math substitutions and streaming attention are outside this stage.

The raw observations are in [full-size benchmarks](../scripts/01-final.jsonl), [first scheduling experiment](../scripts/01-pilot.jsonl), [serial and alternative cuts](../scripts/02-ablation.jsonl) and [contract checks](../scripts/03-contract.jsonl). Run scripts 01 and 03 from the worktree root after npm run build, or use script 04 to keep them in tmux. Script 05 checks the rows and prints the medians.

The tensor-only test run passed 47 of 48 tests on its first attempt. An SSH connection reset interrupted the softmax evidence upload. That test passed on retry, as did the targeted shared-capacity regression. All 48 tests therefore passed across the run and replay. The stage 2 digest regression checks the byte identity of the unfused emitter on both original and optimized corpus programs. [Tensor test run](../scripts/04-tests.log) and [retry](../scripts/04-retry.log).
