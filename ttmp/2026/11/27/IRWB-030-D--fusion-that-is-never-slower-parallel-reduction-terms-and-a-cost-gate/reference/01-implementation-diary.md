---
Title: Implementation diary
Ticket: IRWB-030-D
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
Summary: Chronological record of stage 3b (IRWB-030-D), with commands, measurements and decisions.
LastUpdated: 2026-11-27T01:27:19.419110676-05:00
WhatFor: Reviewing how term staging and the fusion gate were built and measured
WhenToUse: Resuming or reviewing IRWB-030-D
---

# Implementation diary

## Step 1: Orientation and design

The task, verbatim from the coordinator's brief, is in the IRWB-019 prompt `prompts/t3b/claude/IRWB-030-D.md` (not copied here; this agent read only that file in IRWB-019). In short: stage 3b of Tix's CUDA lowering, "fusion that is never slower": compute a row reduction's terms in parallel and fold them in order, add a measured gate that keeps a program unfused where fusing is slower, keep the exact relation and `fuse: false`.

I read stage 3's design and report (IRWB-029-D), stage 2's design (IRWB-022-I), and `src/tensor/` (`fusion.ts`, `cuda-source.ts`, `cuda-contract.ts`, `cuda-runtime.ts`, `index.ts`, `model.ts`, `passes.ts`). Findings that shaped the design:

- Binder ids are unique per binder (`i0`, `i1`, ...; probe in this step, a nested shadowed `sum(j)` resolved to `i1` and `i2`), so binding a reduction's axes in an earlier phase cannot capture another binder.
- `split-sum` puts the `tail` extent in a nested reduction, so an outermost reduction's axes are `dim` or `blocks` extents and its term space is a rectangle.
- `runCudaBatch` with `benchmark` times each case of a batch separately, so one GPU call can time a whole shape series.

The design (`design-doc/01-...`) was committed at `88f46dc` before any code.

## Step 2: Staged terms in the planner and the emitter

`planFusion(fn, { terms })` records, for each member of a block-mode group, each outermost reduction (`outerReductions`) and whether it is staged, with the reason. The emitter (`emitGroup`) emits, before a row scalar's thread-0 loop, a chunked loop per staged reduction: all threads decode `c0 + e` row-major into the reduction's axes and write the body's value to `rterms[e]`; barrier; thread 0 folds the chunk with `__fadd_rn` or `max_nan`; barrier. The walk then reads the accumulator in place of the reduction (`kernelWriter.replace`). The term buffer is one more row buffer of `min(chunk, largest term count)` floats, so the stage-3 shared/scratch decision covers it. `kernelWriter` gained `bound(extent)` (the three extent kinds, factored out of the reduction loop), `temporary` and `replace`; stage 2's kernels never call `replace`, so their bytes are unchanged (stage 3's digest test passes).

Commands: `npm run build`; `node --test tests/tensor/{fusion,cuda,corpus,passes,language}.test.mjs`: 7, 4, 6, 7, 5 pass, 0 fail.

Script 02 (`02-check-variants.mjs`) ran `checkLowering` on the six corpus programs, both "inside" variants, five feature programs (two staged reductions in one member, a two-axis reduction, a nested reduction in the term, a staged max, a row scalar as the last member) and two optimized programs (`split-sum`, `inline + split-sum`). **Failure on the first run:** with fifteen concurrent checks, five failed with `ssh copy: Connection closed by 100.117.186.55 port 22` and `kex_exchange_identification: read: Connection reset by peer`: the GPU machine's sshd drops simultaneous connection starts. The script now runs three at a time. Second run: all 15 accepted as `exact` (`02-check-variants.out.jsonl`). Commit `cc1a1d5`.

## Step 3: M1, which bodies to stage

Script 03 is the benchmark helper (one `runCudaBatch` call with `benchmark: true`, any number of shape cases, output digest per case). Script 04 compared staging off, for multi-instruction bodies only ('costly') and for every operation ('any'), three rounds:

| Program | none | costly | any |
| --- | ---: | ---: | ---: |
| layernorm (mean: load; variance: one multiply) | 0.204 | 0.203 (same source as none) | 0.223 |
| layernorm-inside (both bodies divide) | 0.615 | 0.225 | 0.196 (same source as costly) |
| softmax-inside (`sum(j) exp(...)`) | 12.412 | 0.749 | 0.752 (same source) |

Identical sources differed by up to 15% here (layernorm-inside costly against any), more than the brief's 2%: other agents' untimed runs share the GPU and do not take the `--timed` lock. So script 08 repeated the one open question, layernorm with variance staged or not, alternating, five rounds of three timed cases each: staging the one-multiply body was slower in every round (medians 0.196/0.219, 0.205/0.221, 0.171/0.186, 0.180/0.184, 0.180/0.207 ms). The 'costly' rule stays.

Output digests were equal across all configurations of a program. layernorm and layernorm-inside even give the same digest: at D = 1024 dividing by D is exact (a power of two), so the two placements are the same function there. attention's `sqrt(D) = 8` is exact too, so only its `out` statement differs between placements.

## Step 4: M1c and M3: two more bodies, and the row-count hypothesis is wrong

Script 09 (M1c) measured two bodies the M1 programs did not cover, four alternating rounds of three timed cases (N = 4096, C = 1024): a square root (`sum(j) sqrt(x*x)`) went from 0.266 to 0.157 ms when staged, in every round; five single-instruction operations (`((x*2+1)*x-3)*x`) went from 0.169 to 0.153 ms in the median, but two rounds were faster staged and two slower (0.148/0.154, 0.172/0.178). That is not a consistent win, so the rule keeps single-instruction chains on thread 0, and an operation-count threshold goes to Later.

Script 06 (M3) tested the design's hypothesis, that block mode loses with few long rows. **It does not.** Rows of 1,024 with N from 1 to 4,096: fused is faster at every N (softmax N = 1: 0.015 against 0.071 ms; layernorm-inside N = 1: 0.015 against 0.120; attention Q = 1: 0.075 against 0.126). At a fixed 2^22 elements, fused is faster from 1 row of 2^22 (203 against 392 ms: stage 2's row scalars also fold the whole row in one thread, from global memory) down to rows of 64 (0.372 against 0.701). It is **slower with short rows**: 2^18 rows of 16 elements, 0.737 against 0.795 ms in the median but 0.738 against 0.675 in round 0; 2^20 rows of 4, 2.935 against 0.620 (4.7 times slower). A 32-thread block per 4-element row leaves 28 lanes idle and pays a barrier per member for four elements. Every shape gave the same output digest fused and unfused (`06-m3-rows.summary.txt`).

So the gate's quantity is the row length, not the row count. The mechanism designed in step 1 (the call's shape values, choose between the two checked whole-program sources) stays; the rule becomes "every block-mode kernel's longest row has at least L* elements". Script 10 (M3b) locates L* with row lengths 4 to 128 at 2^22 and 2^18 elements (softmax), layernorm-inside, and attention with few keys.

## Step 5: The gate in code, and a lost wait

`fuseAt(fn, plan, shapes)` (fusion.ts) returns `{ fuse: false, reason }` when some block-mode kernel's longest row (over its members and staged tensors, trailing axes at the call's shape values) has fewer than `gate.shortestRow` elements. `runTixCuda` computes the shape values with `shapeValues(fn, inputs)` (cuda-runtime.ts, factored out of `encodeCudaCases`, same validation) and, when the gate says no, runs stage 2's source. `cudaSource` and `checkLowering` take no inputs and are unchanged. The threshold was set to 32 provisionally; M3b fixes it. A local test (`terms.test.mjs`) checks the gate on softmax, attention (whose `out` rows keep it fused when K is short) and matmul (thread mode, never gated).

**Failure (process):** I chained M3b behind `while pgrep -f 06-m3-rows.mjs; do sleep 3; done; ...` in a background shell. `pgrep -f` matched the waiting shell's own command line, so the loop never ended and M3b never started; about ten minutes passed before I noticed the missing output file. The four waiting shells were stopped and M3b and M2 started directly in one background command.

## Step 6: M3b fixes the gate at 24 elements, M2 the chunk at 256

Script 10 (M3b), medians of three rounds (`10-m3b-short-rows.summary.txt`, table by script 13). Unfused over fused:

| Row length | softmax, 2^22 elements | softmax, 2^18 | layernorm-inside, 2^22 |
| ---: | ---: | ---: | ---: |
| 4 | 0.21 | 0.21 | 0.29 |
| 8 | 0.41 | 0.42 | 0.41 |
| 16 | 0.91 | 0.84 | 1.12 |
| 24 | 1.33 | 1.16 | 1.67 |
| 32 | 1.77 | 1.75 | 2.55 |
| 64 | 1.81 | 2.02 | 2.78 |
| 128 | 1.83 | 2.46 | 2.39 |

Rows of 16 are slower fused in two series, rows of 24 faster in all three, so `gate.shortestRow = 24`. Attention with 4,096 queries and 4 to 128 keys was not slower fused at any K (1.02 to 1.28): its `out` rows have V = 64 elements, which is why the rule takes a kernel's *longest* row. All shapes gave equal digests fused and unfused.

Script 05 (M2), median of three rounds, chunk sizes 128 to 4096:

| Case | 128 | 256 | 512 | 1024 | 2048 | 4096 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| layernorm-inside, N = 4096, D = 1024 | **0.189** | 0.202 | 0.217 | 0.227 | 0.237 | 0.236 |
| layernorm-inside, N = 1024, D = 4096 | 0.644 | 0.615 | 0.599 | 0.591 | 0.591 | **0.587** |
| softmax-inside, N = 4096, C = 1024 | 0.749 | **0.745** | 0.746 | 0.747 | 0.749 | 0.750 |
| softmax-inside, N = 1024, C = 4096 | 0.845 | 0.833 | **0.808** | 0.837 | 0.923 | 0.962 |

The worst slowdown against each case's best chunk is 10% at 128, 7% at 256, 15% at 512 and 20% at 1024, so the chunk is 256. Short rows prefer a small buffer (more blocks fit in shared memory), long ones fewer barriers. Commit `fd3719f`.

Then, in one background command, in sequence so that nothing of mine overlaps the timings: the three GPU test files, script 02 again, script 11 (results, three rounds), script 11 with the interpreter, script 12 (contract cost).

## Step 7: Results, contract cost, report

The background sequence finished (exit 0). Results (script 11, three `benchmark` calls per program and lowering, through `runTixCuda`): every program is one kernel fused, and none is slower fused. softmax 0.390 against 0.797 ms, layernorm 0.189/0.485, attention 0.771/1.047, mlp 0.725/0.951, layernorm-inside 0.211/0.567, attention-inside 1.412/1.501, softmax-inside 0.751/1.630. matmul and conv2d use identical sources and are within 1%. Fused, unfused and the interpreter (`11-results-cpu.out.jsonl`, 4.7 s for softmax-inside up to 369 s for mlp) had the same digest for all nine programs. Script 02 ran again at the final constants: 15 of 15 exact. `terms-gpu` passed 4 of 4 and `fusion-gpu` 5 of 5. Contract cost (script 12): 28 to 40 cases, 2.2 to 3.0 s cold, under 5 ms repeated.

**Failure (process):** while script 11 was running, I started `timeout 60 node --test tests/tensor/cuda-gpu.test.mjs` in the foreground. The timeout killed it after 6 of its tests (`Promise resolution is still pending`), and for about a minute it shared the GPU with the timed rounds. The three rounds of each program agree within 4%, except layernorm fused (0.173 to 0.201), so I kept the data and say so in the report. `cuda-gpu` then ran alone to completion: 11 of 11 pass (`14-cuda-gpu-test.log`). `14-gpu-tests.log` has no `cuda-gpu` lines, from the first, interrupted sequence.

The report (`reference/02-report-fusion-that-is-never-slower.md`) and the design's "As built" section are written.
