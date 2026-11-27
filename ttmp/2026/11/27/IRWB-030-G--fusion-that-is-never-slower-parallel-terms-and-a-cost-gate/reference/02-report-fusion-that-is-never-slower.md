---
Title: 'Report: fusion that is never slower'
Ticket: IRWB-030-G
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: planTerms (parallel terms) and blockWidth/applyGate (the cost gate)
    - Path: repo://src/tensor/cuda-source.ts
      Note: Term arrays in the block-mode emitter
    - Path: repo://src/tensor/index.ts
      Note: The lowering is planned with the launch's shape values
    - Path: repo://tests/tensor/terms-gpu.test.mjs
      Note: GB10 exactness of staged terms, the gated source, and four mutants
    - Path: repo://ttmp/2026/11/27/IRWB-030-G--fusion-that-is-never-slower-parallel-terms-and-a-cost-gate/scripts/12-table.mjs
      Note: The measurement tables below, from the JSONL the harness wrote
ExternalSources: []
Summary: Stage 3b. A row-scalar reduction's terms are computed by the whole block and folded by one thread in the meaning's order, so the fused value stays bit-identical; a block-mode group stays unfused when its block is under a warp. Fusion never loses to stage 2 on anything measured here, and the two placements that used to make it lose are 2.1x and 16.6x faster.
LastUpdated: 2026-11-27T03:10:00-05:00
WhatFor: Final report of stage 3b (IRWB-030-G)
WhenToUse: Reviewing what parallel terms and the cost gate do, what they cost, what was measured and what was only argued
---

# Report: fusion that is never slower

Stage 3 (IRWB-029-D) turned each Tix function into one CUDA kernel and kept every bit. It had a hole: a reduction
that belongs to a *row-scalar* member — `mu[i] = sum(d) x[i,d] / D` — has one element per row, so **thread 0 of the
row's block evaluated every term of it**, while stage 2 gave each row its own thread across the grid. When the body
is a load the loss is invisible; when it is a division or an `exp`, fusion buys nothing or costs a lot.

This stage removes that hole and adds a decision for the one loss it cannot remove:

- **Parallel terms.** The block computes a reduction's terms into a term array in the same row buffer that holds the
  rows; one thread then folds that array in the meaning's order. Every term is rounded by the same code as before and
  the fold keeps its order, so the value is bit-identical — not "within a tolerance".
- **A cost gate.** A block-mode group stays fused only when its block puts at least one warp of lanes to work,
  measured as the wider of its rows and its staged term arrays. Below that, the group becomes stage 2's kernels, one
  per statement.

Results at the brief's sizes (`scripts/09-*.jsonl`, `scripts/12-table.mjs`):

| Program (shape values) | Kernels fused / unfused | GPU ms fused | GPU ms unfused | unfused / fused |
| --- | ---: | ---: | ---: | ---: |
| matmul (M = K = N = 512) | 1 / 1 | 0.2136 | 0.2138 | 1.00 |
| softmax (N = 4096, C = 1024) | 1 / 4 | **0.3866** | 0.8200 | 2.12 |
| layernorm (N = 4096, D = 1024) | 1 / 4 | **0.1977** | 0.4777 | 2.42 |
| attention (Q = K = 1024, D = V = 64) | 1 / 6 | **0.7531** | 1.0500 | 1.39 |
| mlp (N = 1024, D = 256, H = 1024, O = 256) | 1 / 3 | **0.7256** | 0.9502 | 1.31 |
| conv2d (N = 8, C = 16, H = W = 64, O = 32) | 1 / 1 | 0.1659 | 0.1662 | 1.00 |
| **layernorm, division inside** (N = 4096, D = 1024) | 1 / 4 | **0.2623** | 0.5716 | 2.18 |
| **attention, division inside** (Q = K = 1024, D = V = 64) | 1 / 5 | **1.4123** | 1.4866 | 1.05 |
| `s[i] = sum(j) exp(x[i,j] - m[i])` (N = 4096, C = 1024) | 1 / 3 | **0.7479** | 1.6308 | 2.18 |

The corpus programs are unchanged in kernel count and in time, within this machine's noise (they stage nothing: their
reduction bodies are loads or products). The two placements the brief names are the ones that move: the "inside"
layernorm from 0.578 ms (stage 3) to **0.262 ms**, and an `exp` inside a reduction from 12.41 ms to **0.748 ms**. The
"inside" attention has no stageable reduction (its reductions are per row element), so it stays at 1.41 ms — and is
still 1.05 times faster than stage 2.
- `checkLowering` still accepts the fused lowering as `exact` for all eight programs, before and after `inline` and
  `split-sum`, and the fused outputs equal the unfused ones and the interpreter word for word at full size.

**Which reductions use parallel terms**, per block-mode kernel (`scripts/08-plans.mjs`, output in
`scripts/08-plans.out.txt`; matmul and conv2d are thread-mode single kernels, so they have no block-mode kernel):

| Program | Block-mode kernel | Parallel terms | Left as a serial fold |
| --- | --- | --- | --- |
| softmax | k0: m,e,s,y (block[1]) | none | `m: max(C)`, `s: sum(C)` |
| layernorm | k0: mean,centered,variance,y | none | `mean: sum(D)`, `variance: sum(D)` |
| attention | k0: score,shift,e,z,weight,out | none | `score: sum(D)`, `shift: max(K)`, `z: sum(K)`, `out: sum(K)` |
| mlp | k0: h,g,y | none | `h: sum(D)`, `y: sum(H)` |
| layernorm, division inside | k0: mean,centered,variance,y | `mean: sum(D)`, `variance: sum(D)` | none |
| attention, division inside | k0: score,shift,e,l,out | none | `score: sum(D)`, `shift: max(K)`, `l: sum(K)`, `out: sum(K)` |
| `s[i] = sum(j) exp(x - m[i])` | k0: m,s,y | `s: sum(C)` | `m: max(C)` |
| longterm (rows of 8, 1024 terms) | k0: s,e | `s: sum(D)` | none |

## How a reduction's terms are staged

`planFusion(fn, sizes?)` decides from the Tix IR which reductions stage their terms (`planTerms`), and the emitter
follows the plan (`termArrays`).

A block-mode group runs one block per block-domain point (one row). A member with no axes beyond the block domain has
one element per row, so before this stage one thread computed its whole value, reductions included. A term never
reads the accumulator — Tix has no name for it — so every term is a pure function of the reduction's indices and the
row, and any thread can compute it. So:

```
for (U q0 = threadIdx.x; q0 < na0; q0 += blockDim.x)   // the whole block, one term per thread
  a0[q0] = <body, with the reduction's axes taken from q0>;
__syncthreads();
for (U e = threadIdx.x; e < n2; e += blockDim.x) {     // thread 0 for a row-scalar member
  float acc = 0.0f; U f0 = 0;
  for (I i3 = 0; i3 < end_i3; ++i3) { acc = __fadd_rn(acc, a0[f0]); ++f0; }
  ...
}
```

The term arrays live in the group's row buffer: `a0 = r_last + n_last`, `a1 = a0 + na0`, … in shared memory, or in
the same per-block global scratch area when the row set does not fit under the opt-in limit (99 KiB on the GB10).

**Why the bits do not move** (argued, and sampled by the measurements): a staged term is computed by the same
`kernelWriter` tree walk stage 2 uses, with the same explicit round-to-nearest intrinsics, so it has the same value
whichever thread computes it. The fold visits the terms in increasing lexicographic order of the reduction's
indices — the counter `f0` counts the fold's own iterations, so this holds for one axis, for several, and for the
split-sum form — and adds with `__fadd_rn`, exactly as the meaning does. No operation was added, removed, reordered
or contracted.

**Which reductions** (decided from the IR, `FusionGroup.terms`):

| Staged | Why |
| --- | --- |
| the member has no axes beyond the block domain | else its reduction runs once per row element |
| the reduction is not inside another reduction | a nested one would need an array per outer iteration |
| one axis of any kind, or several plain dimensions | a term's flat position then follows from the extents |
| the body contains a division, `exp`/`log`/`tanh`/`sqrt`, or an inner reduction | those cost several times a shared-memory round trip |

**Refused, with the reason in `FusionGroup.serial`** (the three below are tested in `tests/tensor/terms.test.mjs`):

- **A reduction in a member with trailing axes** — attention's `score[i,j] = sum(d) q[i,d]*k[j,d] / sqrt(D)` and
  `out[i,c] = sum(j) e[i,j]*v[j,c] / l[i]`. Its terms are per row element, so the array would need one slot per
  (element, term) pair — 1024 × 64 floats for the corpus attention — and each element's fold would still have to run
  in its own order. The rows already spread those reductions over the block's lanes at one thread per element, which
  is the parallelism stage 2 had, so nothing is lost relative to stage 2 (measured: attention-inside 1.412 against
  1.533 ms).
- **A body with no costly operation** — softmax's `s` (a load), attention's `shift` and `z` (a load), the corpus
  layernorm's `mean` and `variance` (a load; a product). Measured counterfactual (`scripts/13-stage-everything.mjs`
  patches the cost rule in a copy of the built planner so that every addressable reduction is staged): the corpus
  layernorm takes 0.1977 ms with the rule and 0.2001 ms staging its `mean` and `variance` as well, 13% slower for two
  more 4 KiB arrays per block; softmax is unchanged (0.3874 against 0.3863 ms, within noise). So the rule refuses only
  what it cannot gain from.
- **A multi-axis reduction one of whose axes split-sum generated.** A single generated axis *is* staged:
  `sum(j) x[i,j] / D` becomes `sum(b) sum(i) x[4b+i] / D` after `split-sum`, whose terms are the blocks of the split
  and whose count is `ceil(D/4)`; each term is then the tail reduction of up to four elements. The split lowering is
  accepted exactly (`tests/tensor/terms-gpu.test.mjs`).

**Refused although legal, and why**: a tree reduction of any kind (reassociation is out of scope for this stage: tree
sums, split-K, partial sums combined by an operator); vectorizing the staging loop (`float4` loads of a row whose
address is affine — that is operand tiling, a later stage).

## The rule that decides whether to fuse

**Rule.** A block-mode group stays fused only when its block puts at least one warp — `warp = 32` lanes — to work.
The width is the wider of the group's rows and its staged term arrays, in elements (`blockWidth`). Otherwise the
group's statements become stage 2's kernels, one per statement, and `FusionPlan.gate` records the width and the
reason. Thread-mode groups are never gated: they are stage 2's mapping (one thread per element) with registers
instead of global round trips.

**Why that width.** Block mode replaces "one thread per element, 256 per block, 1,536 threads per SM" with "one
thread per element *of a row*, in a block of its own". While a row fills a warp that is a gain: the row never leaves
the block. Below a warp every block launches lanes that do nothing, and the device admits at most 24 blocks per SM
(IRWB-029-D probe 01), so the SM holds at most `24 × width` lanes of work where stage 2 fills 1,536 threads.

**The measurements behind the threshold.** 2^21 elements in rows of the given length; fused / stage 2 in ms; five
`benchmark` calls per lowering, medians (`scripts/09-round1.jsonl`), with stage 3's own numbers beside them
(`scripts/02-baseline-probe.jsonl`, two calls) to show the loss this stage removes:

| Row length | 4 | 8 | 16 | 32 | 64 |
| --- | ---: | ---: | ---: | ---: | ---: |
| stage 3 fused | 1.4686 | 0.7364 | 0.3719 | 0.1878 | 0.1888 |
| stage 2 | 0.2981 | 0.2821 | 0.3301 | 0.3291 | 0.2961 |
| **this stage, gated** | 0.2931 | 0.2739 | 0.3106 | 0.1876 | 0.1882 |

(the 32- and 64-element rows are not gated, so their rows are this stage's fused kernel; the shorter ones are gated,
so their rows are stage 2's kernel through `fuse: true`)

The crossover lies between 16 and 32 elements: a fused 16-element row is 13% slower than stage 2 (0.372 against
0.330) and a fused 32-element row is 75% faster (0.188 against 0.329). 32 is also the warp, the width at which a
block's lanes start to pay for themselves, so the rule sits at the measured crossover and is not a fitted constant.

**The rule is not too conservative**, which is the other way it could be wrong. With the gate removed
(`scripts/06-plans.mjs`'s `ungated`, the same planner without shape values):

| Program | Gated (this stage) | Ungated (fused, staged) | Stage 2 |
| --- | ---: | ---: | ---: |
| softmax, rows of 4 | 0.294 ms | 2.923 ms | 0.298 ms |
| softmax, rows of 16 | 0.284 ms | 0.734 ms | 0.328 ms |
| `s[i] = sum(j) exp(...)`, rows of 4 | 0.396 ms | 2.923 ms | 0.387 ms |
| `s[i] = sum(j) exp(...)`, rows of 16 | 0.392 ms | 0.734 ms | 0.392 ms |
| layernorm-inside, D = 8 | 0.140 ms | 0.358 ms | 0.139 ms |
| layernorm-inside, D = 16 | 0.164 ms | 0.152 ms | 0.149 ms |

Parallel terms do not rescue a short row: the terms of a 4- or 16-element reduction fill 4 or 16 of the warp's 32
lanes, so the block is still mostly idle, and the per-row barriers are paid per row.

**The width has to include the term arrays**, and that is measured too: a group whose rows are 8 elements but whose
staged reduction has 1024 terms is fused and wins 2.5× (0.047 against 0.117 ms, `scripts/06-long-term.tix`), because
the staging loop then fills the block's lanes. A row-only rule would have thrown that away.

**Where the shape values come from, and what happens without them.** The width is not expressible in the Tix IR,
which has symbols, not values. So the gate is decided:

- in `runTixCuda`, from the launch's input shapes — the path that runs and times a program;
- from an optional `sizes` of `cudaSource`;
- not at all when no values are given, which is `checkLowering`'s case: it checks one artifact against a recipe of
  many shape assignments, so its subject is the ungated lowering, and the plan keeps every group fused (stage 3's
  plan).

That is a weakening to state plainly: the artifact `checkLowering` checks is not always the artifact a benchmark runs.
Three things keep it small. A gated group is exactly stage 2's kernel for that statement, and every stage-2 lowering
is checked whenever `fuse: false` is checked (24 corpus checks before and after optimization, unchanged by this
stage). Both plans come from one emitter. And a GB10 test builds a gated source, verifies it through the contract's
supplied-candidate path (`checkCudaLowering` with the artifact the gated plan describes) and compares its full-size
output with the interpreter word for word.

The alternative — deciding at launch between two emitted kernels — would double the kernel count and make
`cudaSource` stop describing what runs. The alternative for short rows is several rows per block, which is a new
mapping, not a gate (Later).

## Guarantees kept

- **Exact relation.** `checkLowering` accepts the fused lowering as `exact` for the six corpus programs and the two
  "inside" variants, before and after `inline` and `split-sum`; the corpus GPU test alone makes 24 of those checks
  (6 programs x 2 revisions x fused and unfused), and `terms-gpu.test.mjs` adds 6 programs plus 9 split lowerings.
  Fused and unfused outputs are word-for-word equal at full size for every program and size measured
  (`scripts/09-round1.jsonl`: `equal: true` in all 28 cases), and `scripts/09-check-*.jsonl` compares them with the
  f32 interpreter as well.
- **Legality from the Tix IR before code.** Groups, staging and the gate are all decided in `planFusion`; the
  emitter follows the plan. `FusionGroup.terms`, `FusionGroup.serial` and `FusionPlan.gate` are the record.
- **`fuse: false` is stage 2, unchanged.** The digests of `02-stage2-source-digests.json` still match for all six
  corpus programs, original and inline + split (`tests/tensor/fusion.test.mjs`).
- **The check has teeth.** Two deterministic mutants of a staged fold are rejected with a coordinate: the term array
  written in reverse (`a0[na0 - 1 - q0]`, so the fold sums in reverse and rounds differently) and the fold started at
  1 (dropping the first term). Stage 3's two mutants still fail.

## What was refused, and why

Beyond the staging refusals above:

- **A parallel tree max or tree sum.** Tix's max is order-independent bit for bit, so a tree max would pass the exact
  check; but reassociation of any kind is out of scope for this stage, as the brief fixes.
- **Staging the terms of a row-member reduction** (attention's inner products) — see above: the array would be per
  element, and the lanes are already used by the rows.
- **Fusing the "inside" attention differently.** Its remaining time is 1024-element reductions per output element,
  each term a load, a multiply and a division; no schedule in this stage's vocabulary changes that. Splitting it into
  two kernels (score/shift/e/l, then out) was not tried: the plan already keeps one kernel and the loss is not a
  round-trip loss.
- **Several rows per block for short rows.** It would remove the need for the gate on short rows, but it needs a
  template over the rows per block, barriers shared by rows, and a tail rule — a new mapping. The gate covers the
  loss today.

## The contract: what it checks and what it costs

`checkLowering(program, fn)` runs `tensor.lower-cuda` (version 2) through `AnalysisManager.execute`. The body plans
the function, emits the source and returns the CUDA artifact plus the `statements-to-kernels` correspondence. The
`ensures` invariant is `tensor.cuda-meaning` (version 2, unchanged since stage 2): it compiles the source once and
compares every case's GPU output with the current revision's f32 meaning, word for word, with NaN compared as a
class. The case recipe is stage 2's `cudaCases`: shape assignments of all-1s, all-3s, all-4s, all-7s, a mixed
assignment that gives every symbol a distinct size, all-zeros and one-zero-at-a-time; four input streams per
assignment (signed, positive, half-ulp, signed zero); at most 4,096 elements per tensor.

Cost per program, fused (`scripts/10-contract-cost.jsonl`):

| Program | Cases (assignments × 4 streams) | Elements in and out | Build cases locally | Cold batch: nvcc / run / wall | `checkLowering` | Repeat (memo) |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| matmul | 36 (9) | 1,292 | 5 ms | 0.98 s / 0.30 s / 3.7 s | 2.8 s | 1 ms |
| softmax | 32 (8) | 720 | 3 ms | 0.99 s / 0.29 s / 4.0 s | 3.4 s | 1 ms |
| layernorm | 32 (8) | 920 | 6 ms | 0.96 s / 0.29 s / 4.9 s | 3.7 s | 1 ms |
| attention | 40 (10) | 1,728 | 9 ms | 1.01 s / 0.31 s / 3.8 s | 3.7 s | 1 ms |
| mlp | 40 (10) | 1,948 | 10 ms | 0.97 s / 0.30 s / 3.1 s | 2.8 s | 1 ms |
| conv2d | 28 (7) | 22,900 | 292 ms | 1.02 s / 0.30 s / 3.6 s | 5.0 s | 1 ms |
| layernorm-inside | 32 (8) | 920 | 2 ms | 1.04 s / 0.30 s / 3.3 s | 3.4 s | 1 ms |
| attention-inside | 40 (10) | 1,728 | 4 ms | 1.16 s / 0.30 s / 3.4 s | 3.5 s | 1 ms |

The run time is mostly process start and CUDA initialization, and the wall time is dominated by ssh and the compile.
Stage 2's lowering of the same eight programs, checked the same way, costs 2.3 to 3.5 s per program
(`scripts/10-contract-cost-unfused.jsonl`), so this stage's extra kernels and term arrays add no measurable cost to
the check: what varies between the two tables is the machine, not the subject.

The cases are small, so they exercise staged terms with short reductions, zero extents (an empty term array and an
empty fold) and empty grids, but not the scratch path; the GPU tests cover the scratch path separately with 16,384-term
reductions. A check costs about what stage 2's did: the fused source of `layernorm_inside` is a few hundred bytes
longer than the corpus layernorm's (9,558 against 8,819 bytes), and the case set is the same.

## Framework and tool changes

**None to `src/framework/` and none to `tools/cuda-remote.mjs`.** Everything this stage needed already existed:

- the `fuse` port and the `statements-to-kernels` correspondence (stage 3);
- a differential memo keyed by subject revision, so a different lowering of the same function gets its own evidence;
- `--timed`, `--runtime-input` and `--link` in the runner, and `benchmark` in `runCudaBatch`.

**One framework observation, not a change.** The gate makes a lowering depend on the launch's shape values, which are
not a port of `tensor.lower-cuda`, so the artifact the contract checks is not always the artifact that runs. The
contract machinery could express the stronger check — `subjectKey` may include the case, so a shape-dependent
lowering could be lowered and checked once per shape assignment — but the fixed API's `checkLowering(program, fn,
options?)` takes no shapes, and checking per assignment would multiply the contract's cost by the number of
assignments (8 to 10 per program). If a later stage makes the plan depend on shapes more deeply, the port and the
per-case subject are the shape of that change.

**Domain changes** (`src/tensor/`):

- `planFusion(fn, sizes?)` — an optional shape-value map; `FusionPlan.gate`; `FusionGroup.terms` and
  `FusionGroup.serial`; `planTerms`, `termArrays`, `blockWidth`, `warp`.
- `cuda-source.ts` — the scalar writer takes an optional staged-term hook, the block-mode emitter appends term arrays
  to the row layout and emits one staging loop per staged reduction. The index naming in the scalar writer now uses
  a counter instead of the binding map's size; without that, a staging loop and a fold bind the same axis twice and
  the second binding reuses the first's name. The outputs of every kernel that binds an axis once — every stage-2
  kernel, and every kernel this stage does not stage — are unchanged.
- `index.ts` — `LoweringOptions.sizes`; `runTixCuda` plans with the input shapes' symbol values.

## Measured, and only argued

**Measured on the GB10:**

- Kernel counts and benchmark times: five `benchmark` calls per lowering (each call is one warm-up launch and the
  median of three CUDA-event intervals under the runner's `--timed` lock), medians reported
  (`scripts/09-round1.jsonl`, the table above). A second round on an earlier build of this stage with three calls
  (`scripts/05-staged-r1.jsonl`) agrees within 2% on every case but attention (0.812 against 0.753 ms), which moved
  with contention from other agents. Every fused output equals its unfused output word for word, in all 28 cases.
- The gate's crossover (rows of 4, 8, 16, 32, 64), the gate removed (six programs, `scripts/06-plans.mjs`), and the
  width including term arrays (`scripts/06-long-term.tix`).
- Exact acceptance: the corpus GPU test's 24 checks (6 programs × 2 revisions × fused and unfused, unchanged), the
  staged-terms test's 6 programs plus 9 split lowerings, and the gated source as a supplied candidate.
- The contract's cost per program (`scripts/10-contract-cost.jsonl`, fused; unfused in
  `scripts/10-contract-cost-unfused.jsonl`).
- Full-size equality with the interpreter for the staged lowerings, including a scratch-path case (16,384-term
  reductions in 64 rows) and a split lowering.
- 48 random lowerings accepted exactly: 12 generated functions x (original, inline + split-sum) x (fused, unfused),
  of which 3 stage a reduction's terms (one a `max`, two a `sum`) and 7 gated groups at the short shape values
  (`scripts/14-random-programs.jsonl`).
- Four mutants rejected.
- `fuse: false` byte-identical to stage 2 for the corpus.

**Argued, not measured:**

- That staging keeps the bits for every program in the domain: the construction (same code, same rounding, fold order
  preserved) plus the samples above. There is no proof and no exhaustive test.
- That the width rule generalizes beyond the families measured (softmax-shaped rows, an `exp`-in-sum variant,
  layernorm-inside, and one short-row/long-term program). A program with a short block domain and a different shape
  of work gets the same rule by the same argument.
- The 13% loss at a 16-element row: it is above the 2% within-call noise of this machine but close to the 5%
  between-session spread the brief states, so the threshold does not rest on it — the 4- and 8-element rows, which
  lose 4.9× and 2.6×, do.

## Later

- Several rows per block for short rows, which would let the gate stop unfusing them.
- Chunked term arrays, so a very long reduction does not enlarge the row set (a 100k-term reduction adds 400 KiB per
  block and pushes the kernel to the global scratch path; correctness holds, the timing does not).
- `float4` staging loops for rows whose addresses are affine (operand vectorization).
- A shape-values port on `tensor.lower-cuda`, and per-case subjects, so the contract checks the lowering that runs.
- Entity universes on `defineIR`, so the manager can check correspondence IDs (IRWB-029-D's finding, another ticket).
- Softmax stays bound by the exactly rounded `exp`: a fused `y = exp(x)` kernel at the same size takes 0.37 ms, which
  is where softmax sits.
