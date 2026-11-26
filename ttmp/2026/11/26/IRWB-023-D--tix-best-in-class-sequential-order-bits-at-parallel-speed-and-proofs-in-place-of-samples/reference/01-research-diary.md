---
Title: Research diary
Ticket: IRWB-023-D
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T18:29:23.229170427-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

Ticket IRWB-023-D. Research round: design and experiments, no product code changed. All work on branch `r2-fa/irwb-023-d`.

## Step 1: Reading the two stages and choosing the question

I read the brief, the final reports of IRWB-020-B and IRWB-022-I, and `src/tensor/` (`model.ts`, `evaluate.ts`, `passes.ts`, `contract.ts`, `cuda-contract.ts`, `index.ts`) plus the header of `tools/cuda-remote.mjs`. The outcome was a definition of best in class (the fastest compiler whose every output bit is specified, with passes accepted by proof) and three lines of experiment.

### Prompt Context
**User prompt (verbatim):** "You are a research agent in a comparison of agent configurations. Your working directory is the git worktree /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-fa-irwb-023-d (branch r2-fa/irwb-023-d). Run every command there, using absolute paths, and commit on that branch only. Your complete brief is the file /tmp/claude-1000/-home-manuel-code-wesen-2026-11-24--compiler-workbench/6d4ded76-01c1-42ed-bd4c-3f506f14dfc9/scratchpad/claude-briefs/r2-IRWB-023-D.md. Read it now and follow it exactly, including its standing instructions: work only from your worktree, the web and the GPU machine; do not read other worktrees, other branches, or the parent repository's working tree; do not read anything else in the scratchpad directory. Use your docmgr and diary skills for the ticket and the diary. Work through the whole brief before you stop: research, experiments, the design document, the diary, and the commits. Your final message is the one the brief specifies."
**Assistant interpretation:** Answer "what compiler work would make Tix best in class" with ranked proposals backed by theory, literature and experiments; deliver a design document, this diary and commits.
**Inferred user intent:** Compare agent configurations on ingenuity and scientific depth; claims must be tested, refutations included.

### What I did
- `docmgr ticket create-ticket --ticket IRWB-023-D …`, then `docmgr doc add` for the design document and this diary.
- `npm run build` (succeeded) so prototypes can import `dist/`.
- Started one background agent to verify fifteen citations on the web.

### Why
- The reports give two facts to build on: the meaning fixes fold order and rounding sites, and the GPU already reproduces it bit for bit. The coordinator's timings show a 6× gap to cuBLAS on matmul.
- I considered three candidate directions and kept all three because each had a cheap decisive experiment: schedules that keep the fold, proofs in place of samples, and a parallel algorithm for the sequential fold.

### What I learned
- The sampled gate's sizes are 1, 3, 4, 7 and one cyclic 3, 5, 7 assignment in sorted symbol order. With four or more symbols, some pairs are equal in every case.

### What warrants a second pair of eyes
- The choice of "class". A reader who wants raw speed against cuBLAS will find the definition convenient for Tix.

## Step 2: The binade transducer in Node (experiments 1 and 2)

I worked out that a rounded addition inside one binade is an integer addition that depends on the accumulator only through its parity, wrote the chunk summary, and tested it against the sequential fold. It was bit-exact on the first run. The single-level version gained little on zero-mean data, so I added a tree of summaries.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Commit (code):** first commit of the ticket — "IRWB-023-D: open ticket; binade-transducer experiments 1 and 2"

### What I did
- `scripts/01-binade-transducer.mjs`: `summarize`, `apply`, `chunkedFold`; eight streams.
- `scripts/02-hierarchical-transducer.mjs`: `treeFold`, plus a count of binade and sign changes of the true accumulator.

### What worked
- Experiment 1: 5,376 configurations and 199,573 directly applied summaries, 0 mismatches. Positive data: 4.0×, 23.3×, 78.8× fewer serial steps at n = 1,024, 65,536, 2²⁰.
- Experiment 2: 1,440 configurations, 0 mismatches. Positive data at 2²⁰: 769× (top chunk 1,024).

### What didn't work
- Zero-mean data in experiment 1: 1.3×, 2.5×, 3.0×. Hit rates 28.6% to 67.1%.
- Zero-mean data in experiment 2: 1.6× at n = 1,024 and 14.8× at 2²⁰. The accumulator changes binade or sign 13,837 times per 2²⁰ elements; that is the floor for a single-binade summary.

### What was tricky to build
- The lower edge of the binade. If the exact sum falls just below `2^e`, the finer grid applies and the coarse rounding is wrong, while the coarse result can still be `2^e`. I made the window conservative: every post-step value must be at least `2²³ + 1` and at most `2²⁴ − 1` in units of the grid. A conservative window costs fallbacks, never bits.

### What I learned
- The "oracle" guess (true binade) and the f64 guess gave identical hit rates at these sizes. That hid the problem found in Step 6.

## Step 3: The fold on the GB10 (experiment 3)

I ported the single-level scheme to CUDA with integer shifts on the f32 bit patterns and compared it with a one-thread-per-row fold and a reassociated two-pass sum, for nine shapes and three data streams.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Commit (code):** "IRWB-023-D: GPU experiments 3 (exact parallel fold) and 4 (exact tiled matmul vs cuBLAS)"

### What I did
- `scripts/03-gpu-exact-sum/main.cu`; `node tools/cuda-remote.mjs <dir> --timed`. Compile 0.98 s, run 26.9 s under the lock (longer than I intended; the 446 ms sequential kernel ran eight times per configuration).

### What worked
- 27 of 27 configurations bit-identical with the sequential kernel, and with a host fold on the first rows.
- 1 × 2²⁴ positive: 446.3 ms sequential, 13.36 ms exact, 0.61 ms free. Ties: 4.75 ms.

### What didn't work
- 4,096 × 1,024: exact 0.239 ms against sequential 0.113 ms. 16,384 × 1,024: 1.26 ms against 0.57 ms. The scheme loses wherever there are thousands of rows.
- Signed 16 × 2²⁰: 30.6 ms against 37.2 ms.

### What I learned
- One GPU thread folds at 26.6 ns per element. The sequential order is nearly free with thousands of chains and ruinous with one.

## Step 4: Exact matmul against cuBLAS (experiment 4)

I wrote a shared-memory tiled kernel that keeps each element's `k` order, the same kernel with `fmaf`, and loaded cuBLAS with `dlopen` because the remote tool passes no link flags.

### Prompt Context
**User prompt (verbatim):** see Step 1.

### What I did
- `scripts/04-gpu-exact-matmul/main.cu`, two timed runs (1.5 s each). The second added a direct cuBLAS-against-FMA word comparison.

### What worked
- Probe result: `dlopen("libcublas.so")` plus `cublasCreate_v2` and `cublasSgemm_v2` works on the GB10 without link flags.
- 512: naive 0.202 ms, tiled exact 0.0576 ms, tiled FMA 0.0434 ms, cuBLAS 0.0342 ms. Tiled exact differs from naive on 0 words at all three sizes.
- At 4096 cuBLAS equals the in-order FMA kernel on all 16,777,216 words; at 512 and 2048 it does not.

### What didn't work
- At 4096 my kernel is 2.5× slower than cuBLAS (18.0 ms against 7.27 ms), and FMA barely helps (17.1 ms), so the kernel is limited elsewhere. I did not tune it.

### What warrants a second pair of eyes
- I did not check `cublasSgemm`'s return status. The time and the plausible output differences say it ran.
- The 4096 coincidence is a single input.

## Step 5: Proofs against the sampled gate (experiment 5)

I wrote a normalizer for Tix functions, used it to prove `inline` on the corpus, built a mutant the real gate accepts, and added an inverse-rule check for `split-sum` and a theorem-based budget.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Commit (code):** "IRWB-023-D: experiment 5, normal-form proofs against the sampled gate"

### What I did
- `scripts/05-normal-form-proof.mjs`, importing `compileTix`, `optimizeTix`, `meaningGate`, `applyNativePassSync`, `definePass`, `adapter`, `TixIR` from `dist/`.

### What worked
- `inline` proved on six of six programs in 0.02 to 0.15 ms; sampled gate 6.5 and 8.3 ms where the IR changed.
- Mutant (`mlp`, contraction over `O` instead of `D`): sampled gate accepted, proof rejected, counterexample at D = 4, O = 2.
- Budget: 1,220 trials, 0 violations of `2·γ(n−1)·Σ|t|`, worst ratio 0.164. A correct split exceeded the fixed tolerance by up to 2.49×.

### What didn't work
- First run: `splitProof.genuine` was `false` on every program. Cause: the original extent is `{dim, kind}` and mine `{kind, dim}`, and I compared `JSON.stringify` output. Fixed with an explicit encoding of extents; then genuine `true`, floor mutant `false`, stride mutant `false`.

### What I learned
- Affine-only extent mutants are caught by two distinct sizes per symbol, so the gate's real weakness is symbols that never differ, not sizes that stay small.

## Step 6: Two levels on the GPU, and why they disappointed (experiments 6 and 7)

I added sub-chunk summaries to the GPU kernel, expecting the serial work for the 2²⁴ sum to drop from about 470,000 steps to about 20,000. It dropped to 431,744. A Node replay of the same data found the cause.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Commit (code):** "IRWB-023-D: experiments 6 (two-level GPU fold) and 7 (guess drift)"

### What I did
- `scripts/06-gpu-exact-sum-two-level/main.cu` (run 16.3 s under the lock); `scripts/07-guess-drift.mjs`.

### What worked
- 18 of 18 configurations bit-identical at both levels.
- Signed 1 × 2²⁴ with chunk 16,384: 53.6 ms against 130.4 ms for one level.

### What didn't work
- Positive 1 × 2²⁴: 12.2 ms against 13.7 ms. Short rows: two levels slower everywhere (0.521 ms against 0.251 ms at 4,096 × 1,024).
- Cause, measured: the sequential f32 sum is 10,905,589 and the f64 sum 10,486,622.7, a 4.0% drift; the f64 guess names the wrong binade for 419,255 elements (2.50%), while the accumulator changes binade 25 times.

### What I learned
- My assumption that an f64 prefix predicts the accumulator's binade was wrong for long growing sums. The sequential f32 sum is a different number, not a noisy copy of the true sum.

### What should be done in the future
- Derive sub-chunk guesses from the true accumulator at the enclosing chunk's start, or summarize two adjacent binades. Compose summaries as a tree.

## Step 7: Literature and the document

The citation agent returned fifteen checked items. One changed the document: Kapre and DeHon (ARITH 2007) already parallelize accumulation with results identical to the sequential order, on an FPGA by iterative correction. I cite it as prior art for the goal and claim only the parity-transducer summary as new. The agent could not confirm the exact form of Higham's bound from a fetched page or how Exo models floats; the document says so in both places.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Commit (code):** "IRWB-023-D: design document", then the diary commit.

### What I did
- Wrote `design-doc/01-bit-exact-tix-at-parallel-speed.md` (about 5,500 words, three Mermaid diagrams), then checked its numbers against the result files and corrected two (148 GB/s; the FMA speed range).

### What warrants a second pair of eyes
- Novelty of the transducer rests on about six searches.
- The ranking puts the least novel proposal first, on the grounds that the others depend on it.

### Code review instructions
- Start with `scripts/01-binade-transducer.mjs` (`summarize`, `apply`), then `scripts/03-gpu-exact-sum/main.cu` (`k_summary`, `k_apply`), then `scripts/05-normal-form-proof.mjs` (`normalForm`, `unsplit`).
- Replay: the table at the end of the design document.
