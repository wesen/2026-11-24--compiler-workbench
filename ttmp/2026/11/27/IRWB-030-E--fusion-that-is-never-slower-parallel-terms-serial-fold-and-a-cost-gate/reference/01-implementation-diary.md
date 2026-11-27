---
Title: Implementation diary
Ticket: IRWB-030-E
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
Summary: Chronological record of stage 3b (term staging, the fusion gate, measurements).
LastUpdated: 2026-11-27T01:29:01.936455959-05:00
WhatFor: What was done, in order, with commands, failures and measurements
WhenToUse: Reviewing or continuing IRWB-030-E
---

# Implementation diary

## Step 1: Read stage 3, measure the base, write the design

I read stage 3's design and report (IRWB-029-D), stage 2's lowering code, `src/tensor/` and the differential check in `src/framework/contracts/differential.ts`. I wrote a benchmark harness (script 01) and timed the base before designing anything.

### Prompt Context
**User prompt (verbatim, opening excerpt):** "You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). ... Your ticket is IRWB-030-E. This is an **implementation stage**, in one session. Write a short design first and commit it. Then implement, test, measure, and write a final report in the ticket." The full brief (stage 3b: fusion that is never slower; parallel terms with a serial fold; a decision that keeps a group unfused where fusing is slower; fixed API) is `IRWB-030-E.md` in the coordinator's prompts.
**Assistant interpretation:** Make the fused lowering at least as fast as stage 2's everywhere, keep it bit-identical, and justify the fusing rule by measurement.
**Inferred user intent:** See whether an exact, checked fusion can also be made robustly profitable, and what the framework needs for a lowering with a launch-time choice.

### What I did
- `npm run build`; `docmgr ticket create-ticket --ticket IRWB-030-E ...`; three `docmgr doc add`.
- `node <ticket>/scripts/01-benchmark.mjs --calls=1` on the base (output `scripts/01-baseline-1call.out.jsonl`).
- A shape sweep of softmax and a row sum on the base, N·C = 4M (output `scripts/02-baseline-shape-sweep.out.jsonl`).
- Wrote and committed the design (`1992a03`).

### What worked
- The brief's table reproduced: layernorm inside 0.584 fused against 0.541 unfused, attention inside 1.412 against 1.491.
- A plainer case of the same problem: softmax with `exp` inside the sum (no `e` statement) takes **12.4 ms fused against 1.64 ms unfused**. Thread 0 computes 1,024 `exp` per row alone.

### What I learned
- **Few, long rows are not a loss.** At N = 4, C = 2^20 fused softmax takes 68.7 ms against 106.3 ms unfused: both are bound by one thread's serial sum per row, and the fused kernel reads the row from scratch memory it wrote itself. The design had expected a loss there.
- **Many short rows are.** At N = 2^20, C = 4 fused softmax takes 4.15 ms against 0.62 ms, and the row sum 1.05 against 0.20. At C = 64 fused wins again (0.37 against 0.68).
- **Tiny problems are faster fused** (3 x 7: 3.3 us against 9.3 us), because one launch replaces four.

### What was tricky
- A 120 s foreground limit and the shared `--timed` lock: a benchmark of a dozen programs does not finish in one foreground command. Benchmarks run in the background from here on.

## Step 2: Term staging

`planFusion` now decides, per block-mode group, which reductions have their terms staged, and the group emitter prints a term pass, a barrier and a fold over the term buffer.

### What I did
- `fusion.ts`: `outerReductions`, `FusionGroup.terms`, `FusionPlan.termRefusals`.
- `cuda-source.ts`: `kernelWriter` takes a `stagedTerms` hook; `emitGroup` declares term counts, a `terms` pointer after the row buffers, and per member the term passes. The host adds the term area to the row size and the term counts to the longest length.
- Script 03 compares the plan's staging with none (and a subset) on one program.

### What didn't work
- First build of a kernel with two staged members: `error: calling a constexpr __host__ function("max") from a __global__ function("k0") is not allowed`. I had printed the term area's length with `std::max<U>` in device code. It is a nested conditional now. (The same expression on the host may use either; it uses the same text.)

### What worked
- softmax with `exp` inside the sum: **0.750 ms staged, 12.4 to 14.3 ms serial** (unfused 1.64), same output digest.
- layernorm inside: **0.224 to 0.242 ms staged, 0.571 to 0.583 serial** (unfused 0.541).

### What I learned
- Staging is not free: with a body of one multiplication it is slower than the serial loop (layernorm as in the corpus 0.206 to 0.214 staged against 0.191 to 0.203; `rownorm` 0.151 to 0.157 against 0.123 to 0.142). The term buffer adds 4 KiB to each block's shared memory, so fewer blocks are resident per SM. The rule therefore needs a cost class; script 03 with graded bodies decides it (step 4).

### Code review instructions
- `src/tensor/fusion.ts`, the block starting "Term staging"; `src/tensor/cuda-source.ts`, `stagedTerms` in `kernelWriter` and "Term pass" in `emitGroup`.

## Step 3: The gate, as one templated kernel, and the check on both sides

### What I did
- `emitGroup`: a block-mode kernel is `template <int Mode>`. Modes 0 and 1 are stage 3's `Shared` false and true. Mode 2 + s is member s in stage 2's mapping, printed by the same `elementOfThread` that prints stage 2's kernels (factored out of `emitKernel`; the stage-2 digests still match).
- Host: `fused_k = gate_mode ? gate_mode == 1 : <rule>`; non-stored members get a buffer only when the gate says unfused; the per-statement instantiations are launched in order.
- A source with a gated kernel gets a `main` that parses `--benchmark`, `--gate=fused` and `--gate=unfused`. Stage 2's `main` ignores unknown arguments and tests `argc == 2`, so `--gate` is only passed to sources that take it (`takesGate(source)`).
- `cuda-contract.ts`: every sample is a case on each side (`gate` in the case description); `decide` runs one batch per side for a source with a gate, one batch otherwise.
- `runCudaBatch` gains `gate`.
- Script 04 runs `checkLowering` on the benchmark programs. First run: softmax-inside, layernorm-inside and `div1`, as written and after inline + split-sum, fused and unfused, all accepted as exact.

### Why
- Whether a group is gated is read from the source, not from the artifact's kernel list. The list is declared by the caller (the known correspondence gap), and a mutant test that passes a hand-written list must still be run on the side it mutates.

### What I learned
- The differential check needed no change for a subject with a launch-time choice: cases are opaque to it, so "sample x side" is just a longer case list, and `decide` may batch them as it likes. The evidence then counts each side as a case.

## Step 4: Which bodies to stage (script 03)

Staging every body slowed the cheap ones, so I measured row sums `s[i] = sum(j) <body>; y[i,j] = x[i,j] - s[i]` over [4096, 1024] with bodies of graded cost, staged against serial, five `benchmark` calls each.

### What I did
- `node <ticket>/scripts/03-staging-rule.mjs --calls=5 mul1 mul2 mul4 mul8 relu relu2 sqrt1 div1 weighted layernorm softmax-temperature` (output `03-staging-rule.out.jsonl`), later `--all mul3` (`03-staging-rule-mul3.out.jsonl`).
- Put the rule in `fusion.ts` (`work`, `staging.cheapOperations = 4`).

### What worked

| Body | Staged ms | Serial ms |
| --- | ---: | ---: |
| `x*x` (1 multiplication) | 0.154 | 0.136 |
| 2 multiplications | 0.137 | 0.127 |
| 3 multiplications | 0.157 | 0.154 |
| 4 multiplications | 0.135 | 0.152 |
| 8 multiplications | 0.151 | 0.189 |
| `max(x, 0)` | 0.142 | 0.226 |
| `max(x, 0) * min(x, 1)` | 0.160 | 0.331 |
| `sqrt(x*x)` | 0.163 | 0.292 |
| `x / 3` | 0.154 | 0.239 |
| `x * w[j]` (a load from global memory) | 0.176 | 0.170 |
| layernorm (corpus), variance `c*c` | 0.219 | 0.198 |
| softmax with `m[i] = max(j) x[i,j] / 0.7` | 0.392 | 0.434 |

### What didn't work
- My first `mul3` run was useless: I had already built the cost rule, so the plan staged nothing and "staged" and "serial" were the same source (0.159 and 0.152, both serial). I deleted those two lines from `06-thread-cap-2.out.jsonl`, added `--all` to script 03 (stage every outermost reduction of one-element members, whatever the rule says) and ran `mul3` again.

### What I learned
- Individual calls of the same source vary by up to 15% at these 0.15 ms times on the shared machine (0.133 to 0.163 for one source), more than the brief's 2%. Medians of five separate the classes; the 3-multiplication row is a tie.
- The rule: stage when the body has a division, `sqrt`, `exp`, `log`, `tanh`, `max`, `min` or an inner reduction, or at least four of `+ - *` and negation.

## Step 5: The gate's sweeps, and two things they showed (scripts 05 to 11)

### What I did
- Script 05 times one program at many shapes in one process per mode: block mode forced, the per-statement instantiations forced, and stage 2.
- Rows sweep, softmax and a row sum, N·C = 4M, 256K and 16K, C from 4 to 1024, and N of 1, 4 and 16 with long rows (`05-gate-sweep-rows.out.jsonl`); more points at C of 20, 24, 28 and small N (`10-short-rows-and-in-place.out.jsonl`).
- Script 06: thread caps on the "inside" variants. Scripts 07 and 08: hand-patched sources that reuse row buffers. Scripts 09 and 11: a program with a narrow, costly member (`narrow-div`: `e[i,j] = x[i,j] * 2; y[i,o] = sum(j) e[i,j] * w[j,o] / 3`).

### What worked
- **The per-statement side is stage 2.** Its time over stage 2's is 0.93 to 1.07 in 94 of 105 shape-program pairs. The other 11 are between 0.84 and 1.30, in both directions: nine at times of 5 to 180 microseconds, and the row sum at N of 4 and 16 with serial sums of 1,048,576 and 262,144 terms, where three calls of one side spread from 31 to 45 ms.
- **Short rows.** With rows of 32 or more, block mode was at most 0.97 of stage 2 in every measurement. With rows of 16 to 28 and 16,384 rows or more it lost in 10 of 16 measurements (up to 1.94); with rows of 4 and 8 and 32,768 rows or more it lost in all eight (2.4 to 6.5). With at most 2,048 rows it won whatever the row length (0.30 to 0.92, 18 measurements). At 4,096 rows of 4 it lost (1.02, 1.30).
- **Few long rows are a win** down to one row (softmax 0.53, row sum 0.73 at N = 1).

### What I learned
- **A block's rows decide how many blocks an SM holds.** Script 08 wrote `e` over `score` and `weight` over `e` by hand in attention: with the division inside, 1.41 to 1.15 ms; mlp with `g` over `h`, 0.727 to 0.628; attention as in the corpus unchanged (0.753, 0.756). I made it a plan decision (`inPlace`): B takes A's buffer when the rows have equal extents, every read of A in B is at B's own element, and no later member reads A.
- With that, the term buffer no longer costs occupancy in layernorm with the division inside (0.208 at 128 threads, 0.226 at 256; before, 0.240 and 0.194), so the cap for row kernels stays stage 3's 128.
- **The narrow member.** `narrow-div` in block mode was 1.3 to 2.7 times slower than stage 2 for every O from 1 to 128. Two causes, separated by the in-place change and the cap runs: (a) before in-place the block held the staged `x` and `e` (8 KiB), so 11 blocks of 64 threads were resident, under half the SM; (b) with O below the block width only O lanes work during `y`. After in-place: O = 64, 0.75; O = 32, 1.06; O = 16, 1.58; O = 128, 1.00 at 64 threads but 1.21 ms against 1.57 at 128 threads.
- The same program with a multiplication only (`narrow-mul`) is faster fused at every O (0.47 to 0.82 after in-place). So only costly, unstaged reductions need a rule.
- Each block's shared memory includes 1 KiB the device reserves (`cudaDevAttrReservedSharedMemoryPerBlock`): 4,096-byte rows give 20 resident blocks, not 24. With that, block mode's throughput on `narrow-div` (0.0122 ms per unit of O against stage 2's 0.0096) matches 20 x 64 = 1,280 of 1,536 threads.

### What didn't work
- I expected few long rows to lose (the design said so) and planned a `G_min`. The measurement says the opposite; the gate has no such term.
- A thread cap of 256 for kernels with staged terms looked right before in-place (layernorm inside 0.194 against 0.240) and wrong after (0.226 against 0.208). Not adopted.

## Step 6: The gate's rule, block width for heavy members

### What I did
- `fusion.ts`: `FusionGroup.heavy` (members with trailing axes and a reduction that the cost rule would stage), `gate = { fullRow: 32, smallGrid: 2048, heavyLanes: [19, 24] }`, `gateRule`.
- `cuda-source.ts`: the host reads the SM's block, thread and shared-memory limits and the reserved shared memory; `resident_k`; for a group with heavy members the block is `min(256, ceil32(narrowest heavy row))` threads wide.
- Script 05 gained `--auto` (the rule decides); `12-gate-validation.out.jsonl` runs it over shapes on both sides of each threshold.

### Why
- The lanes at work on a heavy member are `resident blocks x min(threads, row length)`. Fused won at 19/24 of the SM's threads (attention with the division inside, 1,216 lanes) and lost at 46% and below in three of four cases. The threshold is the lowest occupancy measured with no loss.

## Step 7: Evidence per side only for programs with a gate

### What I did
- First version: every sample was two cases (`gate: fused | unfused`) for every subject; a program without a gate ran once and the result served both cases. Script 14 then showed 72 cases for matmul, which has no gate and ran 36.
- Changed `cases` to double the samples only when the subject takes a gate, and `baselineKey` to include that flag (the case list now depends on it).

### What didn't work
- `CUDA evidence unavailable: IR data cannot contain undefined` in two tests of `cuda.test.mjs`: `describeCase` returned `gate: undefined` for programs without a gate. The key is now left out.

### What I learned
- The differential's `baselineKey` contract ("the cases are a function of the key alone") is easy to break silently: nothing checks that two subjects under one key produce the same case list. I changed the key because I read the comment, not because anything failed.

## Step 8: Validation runs, and the first-line thresholds corrected

I ran the rule on its own over shapes on both sides of each threshold, ran random programs, and measured the final table. The validation showed that the first line's thresholds (rows of 32, 2,048 rows) were wrong for two programs, and why.

### What I did
- `05-gate-sweep.mjs --auto` on narrow-div and on softmax, the row sum, `div1` and softmax with `exp` inside (`12-gate-validation.out.jsonl`).
- `15-random-programs.mjs 30 31`: 60 lowerings, all accepted as exact on both sides of the gate (26 with a block-mode kernel, 12 with staged terms, 7 with in-place rows, 4 with heavy members).
- `13-final-table.mjs --calls=5`, twice: once before and once after the last change to the lowering's source text (formatting only), the second with softmax with `exp` inside added. The report uses the second.
- `14-contract-cost.mjs`; probe 16 (`reservedSharedPerBlock: 1024, sharedPerSm: 102400, maxBlocksPerSm: 24, maxThreadsPerSm: 1536`).
- After the validation: `18-small-grids.out.jsonl` (256 to 2,048 rows of 4 to 48; 8,192 to 32,768 rows of 48 and 64) and `19-mid-size-rows.out.jsonl` (rows of 96 to 512 at 2,048 to 16,384 rows), five runs each, then `gate = { fullRow: 96, smallGrid: 1024, ... }` and `20-gate-validation-final.out.jsonl`.

### What worked
- narrow-div under the rule: unfused for O of 1 to 32 (0.91 to 1.13 of stage 2, the same kernels), fused for O of 64 to 1,024 (0.74 to 0.83); with C = 4096, O = 64 unfused (1.00) and O = 256 fused at 256 threads (0.85).
- The final table: fused over unfused 0.48 (softmax), 0.32 (layernorm), 0.37 (layernorm, division inside), 0.71 (attention), 0.79 (attention, division inside), 0.66 (mlp).

### What didn't work
- **The rule lost where it said fuse.** Under `--auto`, softmax with `exp` inside at 2,048 rows of 4 took 1.05 of stage 2 (15.3 against 14.6 µs, tight), and `div1` at 8,192 rows of 32 took 1.06, as it had in the forced sweep, where I had called it a tie.
- The follow-up (script 18) showed more: `div1` at 32,768 rows of 48 is 1.57, at 32,768 × 64 1.14, at 16,384 × 64 1.03; softmax with `exp` inside at 32,768 × 48 is 1.18. The first sweep had `div1` at 65,536 × 64 as 0.61.

### What I learned
- **The first sweep's sizes hid a regime.** It had 4M, 256K and 16K elements. Between them, stage 2's tensors fit the 24 MiB L2 and `benchmark` relaunches on the same buffers, so stage 2 is several times cheaper per element (`div1`: 0.052 ms for 2M elements, 0.239 for 4M). Block mode's fixed cost per block then decides. A threshold read from three sizes is not a threshold.
- A tie at the edge of a rule is a warning. The 1.06 I waved through was the first sign.
- With staged terms a block costs more (a term pass and a barrier): `div1` is at 0.91 to 0.97 with rows of 96 and 128 where the plain row sum is at 0.52 to 0.63.
- The final thresholds are the smallest row length (96) and the largest row count (1,024) with no measured loss. Rows of 32 to 64 now run unfused beyond 1,024 rows, which gives up wins on softmax (0.55 to 0.67) to keep the cheapest program from losing.

### What should be done in the future
- Replace the two constants with a cost per block and a cost per element estimated from the IR and the tensor sizes against L2; the data in scripts 05, 18 and 19 is a start.

### Code review instructions
- Start at `gate` and `gateRule` in `src/tensor/fusion.ts`, then the host lines `resident_k`, `fused_k` in `emitGroup` (`src/tensor/cuda-source.ts`).
- `node --test tests/tensor/fusion.test.mjs tests/tensor/cuda.test.mjs` (no GPU); `node --test tests/tensor/terms-gpu.test.mjs tests/tensor/fusion-gpu.test.mjs tests/tensor/cuda-gpu.test.mjs` (GB10).
