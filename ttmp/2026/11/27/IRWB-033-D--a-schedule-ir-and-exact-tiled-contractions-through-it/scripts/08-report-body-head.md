Stage 6 puts a schedule IR between Tix and CUDA and makes contractions fast without changing a result bit. Lowering now goes Tix → fusion plan → schedule IR → checked scheduling passes → CUDA source. The printer only prints the schedule. Each output still adds its terms one at a time, r = 0, 1, … in the meaning's order, with the product and the sum rounded separately.

At the brief's sizes, comparing fused against the base's fused lowering:

- matmul 512³ went from 0.218 ms to 0.046 ms (5.9 TFLOP/s, 1.39 times cuBLAS's time);
- attention from 0.750 to 0.184 ms;
- mlp from 0.626 to 0.219 ms;
- conv2d from 0.167 to 0.100 ms.

Every output was bit-identical across all sides and variants, and no corpus program got slower. One framework change: passes gained a legality check decided before they run.

The code is at the last commit of branch `t6-op/irwb-033-d`. Design: `design-doc/01-a-schedule-ir-between-tix-and-cuda-and-exact-tiled-contractions.md`. Diary: `reference/01-implementation-diary.md`.

## Results

GPU time is `runTixCuda(..., { benchmark: true })`: one warm-up launch, then the median of three CUDA-event intervals, under the runner's `--timed` lock. Each table entry is the **median of five such calls**, with the sides alternated (fused, unfused, base, fused, …), as the brief's protocol asks (scripts 03 and 06; raw values in `scripts/06-final-*.out.jsonl`). Inputs are seed 20, f32 in [−0.1, 0.1], eps = 1e-5. *Base* is the fused lowering of this branch's first commit (stage 3b), built by script 06. Kernel count is the number of `__global__` definitions in `cudaSource`.

The tables below were measured at commit 6198832. The last commit adds one line to the launch rule (variant 0 below one tiled block per SM, after the dot product below). No shape in these tables falls under it: attention's out, the smallest grid, has 64 blocks, so every choice and kernel is the same. I did not read the SM clock during 4096³. Its five fused calls spread by 0.6% (15.72 to 15.82 ms).

### Corpus programs

CORPUS_TABLE

- softmax and layernorm have no contraction. Their schedules have no pass applied, and their sources are those of the base. Layernorm's 0.86 against base is the session's noise: the five base calls spread from 0.15 to 0.19 ms on a GPU shared with about eleven agents.
- **Kernels:** attention now has 3 kernels (score; the row softmax `shift, e, z, weight`; out), mlp has 2 (`h` with `g` as its epilogue; `y`). Each is one `__global__` definition. Isolating the contractions is what gives attention and mlp their speed (below).

### Contractions, fused (tiled) and unfused (stage 2)

The contractions inside attention and mlp are timed as standalone Tix programs of the same statement and shapes (`attention-score`: `s[i,j] = (sum(d) q[i,d] * k[j,d]) / sqrt(D)`; `attention-out`: `o[i,c] = sum(j) w[i,j] * v[j,c]`; `mlp-h`: `h = x·w + bias`; `mlp-y`: `y = g·v + outBias`). TFLOP/s = 2 M N K / time.

CONTRACTION_TABLE

**The schedule chosen at these sizes** (the launch rule, below; all variants compiled into the same kernel):

| Contraction | Grid of v1 / v2 (blocks) | Terms | Variant | Tile, per thread, threads | Copies walk along |
| --- | --- | ---: | --- | --- | --- |
| matmul 512³ | 32 / 256 | 512 | 2 | 32×32×8, 4×4, 64 | a: r (k), b: n (j) |
| matmul 4096³ | 2,048 / 16,384 | 4,096 | 1 | 128×64×8, 8×4, 256 | a: r, b: n |
| attention score | 128 / 1,024 | 64 | 3 | 32×32×8, 2×2, 256 | q: r (d), k: r (d), the transposed operand |
| attention out | 16 / 64 | 1,024 | 3 | 32×32×8, 2×2, 256 | weight: r (j), v: n (c) |
| mlp h | 128 / 1,024 | 256 | 2 | 32×32×8, 4×4, 64 | x: r, w: n |
| mlp y | 32 / 256 | 1,024 | 2 | 32×32×8, 4×4, 64 | g: r, v: n |
| conv2d | 241 / 961 | 144 | 3 | 32×32×8, 2×2, 256 | x: m (xpos), kernel: r (dx) |

All of them stage both operands in shared memory as transposed tiles, with n tiles on `blockIdx.x`.

### Every variant forced (script 03 `--variants`, the basis of the launch rule)

VARIANT_TABLE

At 512³ the fastest variant (0.046) is the one the rule picks. 128 × 64 tiles give only 32 blocks for the GPU's 48 SMs. At attention's out (N = 64) every tiled variant has at most 64 blocks, and the one with the most threads per block wins. The run was stopped before 4096³ and the odd shapes, because each shape took about four minutes on the shared GPU. 4096³ in the contraction table is the rule's choice (variant 1). Probe 01, hand-written kernels in the same scheme, timed all four variants at 4096³ (15.7 ms for variant 1's tile, 19.3 and 33.8 for the others).

