---
Title: 'Report: fusion that is never slower'
Ticket: IRWB-030-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Staged-term loops, term buffer, termChunk
    - Path: repo://src/tensor/fusion.ts
      Note: Term staging decisions (planFusion) and the gate (fuseAt)
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda applies the gate
    - Path: repo://tests/tensor/terms-gpu.test.mjs
      Note: GB10 checks of staged terms, chunks, scratch, mutant, gated call
    - Path: repo://ttmp/2026/11/27/IRWB-030-D--fusion-that-is-never-slower-parallel-reduction-terms-and-a-cost-gate/scripts/11-results.mjs
      Note: Results through the public API
ExternalSources: []
Summary: Staged reduction terms (all threads compute a row scalar's terms, thread 0 folds them in order) and a measured row-length gate; every corpus program and both inside variants are one kernel, exact, and not slower fused than unfused; layernorm-inside 2.7x, softmax-inside 2.2x; no framework change.
LastUpdated: 2026-11-27T03:30:00-05:00
WhatFor: Final report of stage 3b (IRWB-030-D)
WhenToUse: Reviewing term staging, the fusion gate, what was measured and what the framework could express
---

# Report: fusion that is never slower

Stage 3 fused every corpus program into one exact kernel, but a row scalar's reduction (`mean[i] = sum(j) x[i,j] / D`) ran its whole body on thread 0 of the row's block. When the body was costly, the fused kernel lost the concurrency stage 2 had. Stage 3b changes two things:

- **Staged terms.** All threads of the block compute a row scalar's reduction terms into a term buffer, and thread 0 folds them in the meaning's order. This is decided from the Tix IR, per reduction.
- **The gate.** `runTixCuda` runs stage 2's lowering when a block-mode kernel's longest row has fewer than 24 elements at the call's shapes. The threshold comes from a measurement.

At the brief's sizes, all six corpus programs and both "inside" variants are one kernel, exact, and not slower fused than unfused (fused faster for the six with several statements, within 1% for the two single-statement ones). layernorm-inside went from 0.569 ms (the brief's stage-3 figure) to 0.211 ms. A third variant, softmax-inside (`exp` inside the sum), went from 12.4 ms (stage 3's plan, measured here) to 0.751 ms. No framework source changed.

Code: branch `t3b-op/irwb-030-d`. The measurements used the commit `fd3719f` (term chunk 256, gate 24). Later commits changed comments, tests and documents only.

## Results

**Protocol.** Script 11 calls `runTixCuda(..., { benchmark: true })`, the public API with the gate in place. Each call runs one warm-up launch and reports the median of three timed launches under the `--timed` lock. The table gives the median of **three such calls** per program and lowering, made in three rounds that each cover every program. Inputs are seed 20 with values in [−0.1, 0.1] and eps = 1e-5 (script 01). The kernel count is the number of `__global__` definitions in `cudaSource`. Raw rows are in `scripts/11-results.out.jsonl`.

| Program, sizes | Kernels fused / unfused | Fused ms (3 calls) | Unfused ms (3 calls) | Unfused / fused | Reductions with parallel terms |
| --- | ---: | --- | --- | ---: | --- |
| matmul, M = K = N = 512 | 1 / 1 | 0.214 (0.213, 0.217, 0.214) | 0.212 (0.209, 0.212, 0.212) | 0.99 | none (thread mode, same source as unfused) |
| softmax, N = 4096, C = 1024 | 1 / 4 | 0.390 (0.390, 0.391, 0.387) | 0.797 (0.797, 0.808, 0.794) | 2.04 | k0: none (m and s are loads) |
| layernorm, N = 4096, D = 1024 | 1 / 4 | 0.189 (0.173, 0.201, 0.189) | 0.485 (0.485, 0.488, 0.483) | 2.57 | k0: none (mean is a load; variance is one multiply) |
| attention, Q = K = 1024, D = V = 64 | 1 / 6 | 0.771 (0.771, 0.783, 0.754) | 1.047 (1.044, 1.047, 1.049) | 1.36 | k0: none (shift and z are loads) |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 1 / 3 | 0.725 (0.725, 0.724, 0.725) | 0.951 (0.958, 0.951, 0.933) | 1.31 | k0: none (no row scalar) |
| conv2d, N = 8, C = 16, H = W = 64, O = 32 | 1 / 1 | 0.166 (0.166, 0.167, 0.165) | 0.164 (0.166, 0.164, 0.164) | 0.99 | none (thread mode, same source as unfused) |
| **layernorm-inside** | 1 / 4 | **0.211** (0.211, 0.207, 0.218) | 0.567 (0.555, 0.571, 0.567) | **2.69** | k0: mean, variance |
| **attention-inside** | 1 / 5 | **1.412** (1.412, 1.412, 1.412) | 1.501 (1.501, 1.470, 1.509) | **1.06** | k0: none (shift and z are loads) |
| softmax-inside (extra variant) | 1 / 3 | 0.751 (0.751, 0.753, 0.751) | 1.630 (1.636, 1.630, 1.629) | 2.17 | k0: s |

For matmul and conv2d the fused and unfused sources are the same bytes, so their differences (1%) are noise. In every call the fused and unfused outputs had the same SHA-256. INTERPRETER_SENTENCE

The variants (script 01):

- **layernorm-inside:** `mean[i] = sum(j) x[i,j] / D` and `variance[i] = sum(j) centered[i,j] * centered[i,j] / D`.
- **attention-inside:** `score[i,j] = sum(d) q[i,d] * k[j,d] / sqrt(D)` and `out[i,c] = sum(j) e[i,j] * v[j,c] / z[i]`, with no `weight` statement.
- **softmax-inside:** `s[i] = sum(j) exp(x[i,j] - m[i])` and `y[i,j] = exp(x[i,j] - m[i]) / s[i]`, with no `e` statement.

At D = 1024 the two layernorm placements give the same output digest. This is because dividing by 1024 is exact: it is a power of two. attention's `sqrt(64) = 8` is exact too, so of attention-inside only `out` computes different values.

**attention-inside gains only 6%.** None of its row scalars has a costly body: `shift` and `z` fold loads. Its divisions are inside `score` and `out`, which are members with trailing axes, so each element already has its own thread, in both lowerings. The remaining time is those per-element divisions (64 per score element, 1,024 per out element), which neither lowering can avoid without reassociating or moving the division, and both are outside this stage.

## How terms are staged

Take a reduction `R = sum/max(a1..an) body` of a *row scalar*, a block-mode member with no trailing axes, which thread 0 computes. When R is staged, the kernel runs this before thread 0 computes the member:

```
acc = 0.0f or -INFINITY
for c0 = 0, 256, 512, ... < T:                    T = product of R's extents; 256 = the term chunk (M2)
  for e = threadIdx.x; e < min(256, T - c0); e += blockDim.x:
    decode c0 + e row-major into a1..an           first axis outermost
    rterms[e] = body                              stage 2's scalar code (kernelWriter)
  __syncthreads()
  thread 0: for e in order: acc = __fadd_rn(acc, rterms[e])   (max: max_nan, as in stage 3's fused kernels)
  __syncthreads()
```

Thread 0's tree walk then reads `acc` in place of R. The term buffer is one more row buffer, and every staged reduction of the kernel reuses it in turn. So stage 3's choice between shared memory and global scratch covers it, and `fusion-gpu`'s scratch test path applies. `fuse: false` never stages anything, and its source is byte-identical to stage 2's (stage 3's digest test passes).

**Why the bits do not change (argued).** A Tix term cannot name the accumulator, so it does not depend on it. The thread that computes a term runs the same scalar code on the same values as thread 0 would. The value reaches thread 0 as a bit copy through shared memory or scratch, after a barrier. The fold sees the terms in increasing lexicographic order of `a1..an` and rounds once per step, as the meaning does. An empty extent gives T = 0: no chunk runs, and `acc` keeps its initial value.

**Which reductions, decided from the IR** (`planFusion`, recorded per reduction as `group.terms[] = { statement, reduction, staged, reason }`, and in the kernel comment):

| Reduction | Staged? | Why |
| --- | --- | --- |
| Outermost reduction of a row scalar whose body has `/`, `sqrt`, `exp`, `log`, `tanh` or a nested reduction | yes | Measured (M1): layernorm-inside 0.615 → 0.225 ms, softmax-inside 12.41 → 0.75 ms, a `sqrt` body 0.266 → 0.157 ms. |
| Body that is a load or a constant (softmax `m`, `s`; layernorm `mean`; attention `shift`, `z`) | no | Thread 0 would fold a copy of what it reads now, plus two barriers per chunk (argued, not measured). |
| Body of single-instruction operations only (`+ - * neg min max`): layernorm's `variance` | no | Measured (M1b): staging `centered * centered` was slower in all five alternating rounds (2 to 15%). Five chained operations (M1c) were mixed: faster in two rounds, slower in two. |
| Reduction of a member with trailing axes (attention's `score`, `out`; mlp's `h`, `y`) | no | Each element already has its own thread, as in stage 2. |
| Reduction inside another reduction's body | no (not separately) | It runs once per outer term. When the outer reduction is staged, the inner one runs inside the parallel terms. |
| Thread-mode kernels, singletons | — | There is no thread 0 that computes a whole row. |

An outermost reduction's axes always have `dim` or `blocks` extents. `split-sum` puts the `tail` extent in a nested reduction, so the term space is a rectangle, and a row-major decode covers it. No refusal is needed for that.

## The rule that decides whether to fuse

**Rule.** `fuseAt(fn, plan, shapes)` (`fusion.ts`): when some block-mode kernel's *longest row* has fewer than **24 elements**, the call runs stage 2's lowering. The longest row is taken over the kernel's members and staged tensors, at the call's shape values. `runTixCuda(..., { fuse: true })` computes the shape values from its inputs (`shapeValues`) and applies the rule. `cudaSource` and `checkLowering` take no inputs and always give and check the fused source. So the gate only ever chooses between two sources that are each checked. The reason string names the kernel and its row length.

**The measurements behind it.** The design assumed that few, long rows would be the slow case. M3 (script 06) disproved this, and M3b (script 10) located the real one. Each series below is one GPU call per lowering and round, three rounds, medians. Full tables are in `scripts/06-m3-rows.summary.md` and `scripts/10-m3b-short-rows.summary.md`.

| Series | Unfused / fused |
| --- | --- |
| softmax, rows of 1,024, N = 1 … 4,096 | 4.7 at N = 1, 2.1 at N = 4,096: faster fused at every N |
| layernorm-inside, rows of 1,024, N = 1 … 4,096 | 7.5 at N = 1, 2.3 at N = 4,096 |
| attention, K = 1,024, Q = 1 … 768 | 1.5 to 1.7 |
| softmax, 2^22 elements, 1 row of 2^22 … 2^16 rows of 64 | 1.9 to 2.6 (one row: 203 ms against 392 ms, because stage 2 also folds that row in one thread) |
| softmax, 2^22 elements, rows of 4 / 8 / 16 / 24 / 32 | **0.21 / 0.41 / 0.91** / 1.33 / 1.77 |
| softmax, 2^18 elements, rows of 4 / 8 / 16 / 24 / 32 | **0.21 / 0.42 / 0.84** / 1.16 / 1.75 |
| layernorm-inside, 2^22 elements, rows of 4 / 8 / 16 / 24 / 32 | **0.29 / 0.41** / 1.12 / 1.67 / 2.55 |
| attention, Q = 4,096, K = 4 … 128 (out rows: V = 64) | 1.02 to 1.28: never slower |

Rows of 16 are slower fused in two of the three short-row series, and rows of 24 are faster in all three, so the threshold is 24. The rule takes the *longest* row because attention with 4 keys is still faster fused: its `out` rows have 64 elements and keep the block busy. With very short rows, a block of 32 threads works on 4 elements and pays one barrier per member, while stage 2 runs one thread per element. Every shape in these series gave equal digests fused and unfused.

Rows between 17 and 23 elements were not measured. The rule sends them to stage 2, which is the conservative side.

## Refused, and why

**Fusions and gates:**

- **Stage 3's legality rule, unchanged.** It still refuses a read of a member at another row, different leading extents, and statements that read no member.
- **A gate per group.** It would split only the slow group into stage-2 kernels. The mixed plan would be a third source that `checkLowering` does not check, and no corpus program has several block groups. Later.
- **A choice at launch inside the CUDA host code.** It would put the unfused kernels into every fused translation unit (softmax would have five `__global__` definitions) and create a combined source that no check covers.
- **A row-count rule.** The design proposed it. M3 showed fused faster at every row count, so it was dropped.

**Term stagings:** load bodies, single-instruction bodies, members with trailing axes, inner reductions, and thread-mode kernels, as in the table above. Also refused:

- **One term buffer per reduction, sized to its full term count.** The scratch fallback would then allocate rows × terms, for example 16 GB for `sum(j,k)` over 10^6 terms in 4,096 rows. The chunk bounds the buffer at 256 floats.
- **Double buffering**, which would fold one chunk while the threads compute the next. It is not needed for the results above. Later.

**Chunk size (M2, script 05).** The candidates were 128 to 4096 terms. The case set was layernorm-inside and softmax-inside with rows of 1,024 and 4,096 (same element count). For each candidate I took the worst slowdown against each case's best chunk: 10% at 128, **7% at 256**, 15% at 512 and 20% at 1024. Short rows favour a small buffer, because more blocks fit per SM; long rows favour fewer barriers.

## Framework and tool changes

**None to `src/framework/` or `tools/cuda-remote.mjs`.** The stage needed no new framework facility:

- The plan's new `terms` decisions are data inside the tensor domain, like stage 3's plan.
- The checked transformation `tensor.lower-cuda` (version 2) and its correspondence are unchanged in kind, and the fused source it checks is the one that runs.
- The gate selects, at run time, between the two artifacts that the same transformation checks with `fuse: true` and `fuse: false`.

**Finding: the framework checks artifacts, not the choice between them.** The gate is a function from shape values to one of two checked lowerings, and it lives in `runTixCuda`, outside any contract. That is sound here: either choice is a checked source, and the rule affects only speed. But the framework has no way to record that a run used artifact B because of rule R at shapes S. A run-time choice among checked variants would need such a record if it ever affected anything but speed. I did not build it, because nothing here needs it.

Tensor-domain changes:

- `fusion.ts`: `FusionGroup.terms`, `TermStaging`, `outerReductions`, `planFusion(fn, { terms })` (rule `'costly'` by default; `'any'` and `'none'` exist for the measurements), `gate`, `fuseAt`.
- `cuda-source.ts`: `kernelWriter` gains `bound`, `temporary` and `replace`. `emitGroup` emits the staged loops and the term buffer, and exports `termChunk`.
- `cuda-runtime.ts`: `shapeValues(fn, inputs)`, factored out of `encodeCudaCases`, with the same validation.
- `index.ts`: `runTixCuda` applies the gate. `cudaSource` and `checkLowering` are unchanged.

## What the contract checks and what it costs

`checkLowering(program, fn)` is stage 3's check, unchanged. It runs `tensor.lower-cuda` through `AnalysisManager.execute` and compares every case's GPU output with the current revision's f32 meaning, word for word, NaN as a class. The cases are stage 2's recipe (`cudaCases`). Its shape assignments are 1, 3, 4, 7, a mixed assignment, all zeros and one zero at a time, each with four input streams, and every tensor has at most 4,096 elements. So the check covers staged terms with single chunks, empty reductions and zero rows. It does not cover several chunks or the scratch fallback: rows of at most 7 have at most 7 terms. `terms-gpu.test.mjs` covers those, with 3,000 terms (12 chunks) and 30,000 (scratch). The check never exercises the gate, because it takes no call shapes. The gate's stage-2 side is `checkLowering(..., { fuse: false })`.

Cost per program, fused (script 12: cold check, then a repeat in the same process):

CONTRACT_TABLE

## Measured, and only argued

**Measured** on the GB10 (CUDA events, `benchmark` under `--timed`) or locally:

- the results table: three calls each, with equal fused and unfused digests in every call;
- M1, M1b and M1c (which bodies to stage), M2 (the chunk), M3 and M3b (the gate), with equal fused and unfused digests at every shape of M3 and M3b;
- exact acceptance by `checkLowering`:
  - the six corpus programs and both inside variants;
  - five staged-term feature programs: two staged reductions in one member, a two-axis reduction, a nested reduction in the term, a staged max, and a row scalar as the last member;
  - two optimized programs (`split-sum`, `inline + split-sum`), all in script 02;
  - the `terms-gpu` test programs;
- full-size words equal to the interpreter for 3,000 and 30,000 terms (several chunks, scratch), and for gated calls with rows of 8 (stage 2) and 40 (fused);
- the rejection of a mutant that folds a chunk backwards, with a coordinate;
- the regression suites: `fusion-gpu` (5 pass), `terms-gpu` (4 pass), and the local tensor tests (`fusion`, `terms`, `cuda`, `corpus`, `passes`, `language`), all passing. `cuda-gpu` was rerun at the end (diary step 7).

**Argued, not measured:**

- that staging keeps every bit for every program in the domain (the construction above; the checks are samples);
- that a load-only body gains nothing from staging;
- that rows of 17 to 23 elements behave like their neighbours;
- that `log` and `tanh` bodies behave like `exp` and `sqrt`: they are the same class of multi-instruction routine, and I did not time them.

**Noise.** Identical sources differed by up to 15% in this session (M1: layernorm-inside 0.225 against 0.196 for the same bytes), against the brief's 2%. Other agents' untimed runs share the GPU and do not take the `--timed` lock. So I repeated each open question in alternating rounds, and the results table uses three calls per entry. One of my own test runs (`cuda-gpu.test.mjs`, about one minute) overlapped part of round 0 or 1 of script 11. The three rounds of every program agree within 4% except layernorm fused (0.173 to 0.201), which is also the shortest kernel.

## Later

- A per-group gate, with a check of the mixed plan.
- Several short rows per block (a block-mode variant for rows under 24 elements), instead of falling back to stage 2.
- Double-buffered term chunks.
- An operation-count threshold for single-instruction bodies, once M1c's mixed result is resolved.
- A framework record of a run-time choice among checked variants (finding above).
- Correspondence entity checks (another ticket).
