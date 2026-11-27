Stage 3b is complete. The working tree is clean and the last commit holds validated code.

## Ticket, design, report

- **Ticket:** `ttmp/2026/11/27/IRWB-030-J--fusion-that-is-never-slower-parallel-reduction-terms-and-a-fuse-or-not-decision/` (design, diary, scripts 01–07 with outputs)
- **Design:** `design-doc/01-parallel-reduction-terms-and-a-fuse-or-not-decision.md` (with an "As built" addendum)
- **Report:** `reference/02-report-fusion-that-is-never-slower.md`; diary in `reference/01-implementation-diary.md`

## How terms are staged

In a block-mode kernel, a row-scalar member's reduction whose body rounds a value per term is **staged**: the block's threads compute the terms grid-stride into a terms row buffer (one per group, in shared memory or scratch by the existing `Shared` template), then **thread 0 folds them in increasing linear index** — the meaning's lexicographic order, rounded per step — so every bit is unchanged. The plan stages a reduction iff its member has rank == depth, no other reduction encloses it, its extents are all `dim`, and its body has an op/call/nested reduce. Refused, with reasons recorded in the plan: bare-load bodies (removes no serial work; measured neutral when forced on softmax), nested reductions (computed per term by the term's thread — added after the random probe caught a real scope bug), split-sum's generated bounds, trailing-ax members (per-element barriers), and thread mode.

## The fuse-or-not rule

The measured sweep overturned the design's assumption: rows-only groups (softmax, layernorm) are **fused-favored at every rung down to 1 point × 128 threads** — stage 2's one-thread-per-row folds are latency-bound at few rows. The loss class is **trailing-member contractions streaming global operands** (mlp: 4.6× slower fused at 256 threads, 1.37× at 32,768, 0.77× at 65,536). So: decline a group iff such a contraction exists, the row exceeds the thread cap, and **points × threads < 65,536** — the least measured rung where the contraction family won, which keeps mlp and attention (1024 × 64) fused. `runTixCuda` decides with the launch's shapes; `cudaSource`/`checkLowering` emit the default all-fused plan (what kernel counts measure and the contract checks); a declined group is stage 2's bytes, and a fully declined plan is byte-identical to `fuse: false`.

## Kernel counts and benchmark medians (3 benchmark calls, GB10, all outputs bit-identical)

| Program | Kernels f/u | Fused ms | Unfused ms | Parallel terms in the fused kernel |
|---|---|---|---|---|
| matmul | 1/1 | 0.215 | 0.214 | — |
| softmax | 1/4 | 0.385 | 0.814 | none (m, s refused: bare loads) |
| layernorm | 1/4 | 0.209 | 0.481 | `variance` |
| attention | 1/6 | 0.753 | 1.048 | none |
| mlp | 1/3 | 0.725 | 0.960 | none |
| conv2d | 1/1 | 0.166 | 0.166 | — |
| **layernorm-inside** | 1/4 | **0.220** (was 0.569) | 0.555 | **`mean`, `variance`** |
| attention-inside | 1/5 | 1.413 | 1.515 | none (all four refused) |

Validation: 37 local + 23 GB10 tests pass (stage 3's files unchanged); `checkLowering` accepts everything as `exact`; 80/80 random lowerings exact over two seeds; the reversed-fold mutant is rejected with a coordinate; contract cost unchanged (cold 2.6–4.1 s, repeat 1 ms).

## Framework and tool changes

**None** — `git diff <base> -- src/framework tools` is empty. The stage's framework **finding**: the profitability decision needs the launch's shape values and the checked transformation has no port for them, so the decline lives in `runTixCuda`'s lowering while the transformation checks the shape-independent default plan; a later `launchShapes` port (version 4) would let the checker judge mixed sources as their own subjects. The CUDA artifact went to v3 (`parallel` per kernel), `tensor.lower-cuda` to v3; `fuse: false` bytes are unchanged (digest test).

**Last commit: `ed80a6f`**
