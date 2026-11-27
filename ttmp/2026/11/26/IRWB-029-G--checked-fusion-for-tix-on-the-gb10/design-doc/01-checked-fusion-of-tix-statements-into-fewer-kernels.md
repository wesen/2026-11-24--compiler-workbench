---
Title: Checked fusion of Tix statements into fewer kernels
Ticket: IRWB-029-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: Decides the fusion groups and the thread mapping from the Tix IR
    - Path: repo://src/tensor/cuda-source.ts
      Note: Emits the fused kernels; unchanged output for fuse false
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Exact relation, profile per lowering
ExternalSources: []
Summary: Deciding order-preserving fusion from the Tix IR in a planner that the emitter consumes, and why it is not a pass or a second artifact.
LastUpdated: 2026-11-26T23:20:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion of Tix statements into fewer kernels

Stage 2 emits one CUDA kernel per Tix statement: every intermediate goes through global memory and every row
reduction is a whole-thread-block-times-one-thread-per-row. Stage 3 fuses statements into fewer kernels and changes
the thread mapping where ordering allows, under one condition: the fused lowering must produce the *same f32 bits*
as the current revision's meaning. Nothing here reassociates a reduction, so the existing exact relation
(`checkLowering`, bit equality with NaN compared as a class) remains the acceptance test; no tolerance is involved.

## Supported input domain

Everything stage 1 and 2 accept, unchanged: the fixed Tix core, `compileTix`/`optimizeTix` revisions, and the
calling domain of stage 2 (finite f32 inputs, consistent concrete shapes, in-bounds row-major reads). Two limits are
new and come from the fused lowering only:

- a fused *row kernel* stages the rows it needs in shared memory; the staged rows must fit the device's dynamic
  shared-memory limit (227 KB on the GB10). The corpus, and every shape the contract samples (each tensor at most
  4096 elements), are far inside that.
- fusion is decided per group of statements; a group that fails any legality rule below is simply not formed, and the
  statements in it are lowered exactly as stage 2 lowers them. Fusion is never a precondition for correctness.

`fuse: false` keeps stage 2's lowering bit for bit, including its emitted text; `fuse` defaults to `true`.

## Where fusion lives

Three candidates, and the choice.

| Candidate | What it would need | Why chosen or rejected |
| --- | --- | --- |
| A pass on the Tix IR | New schema: statements annotated with a group id and a thread mapping, plus evaluator, validator and meaning-gate understanding of the new fields, because the artifact is what those components read | **Rejected.** Fusion does not change the program's meaning: it changes which kernel evaluates which statement and on which thread. Encoding a schedule in the meaning-carrying artifact would make the meaning gate compare two programs that must be *identical* in meaning, and would put scheduling into the language's validator. |
| A second v6 artifact (a kernel IR) between Tix and CUDA | Its own schema, validator and emitter input; it would restate the expression trees that the Tix IR already holds | **Rejected for this stage, with a recorded consequence.** Everything a kernel plan contains (group, mapping, stages) is a pure function of the Tix revision, so as an artifact it would be a cache of a computation, not a checked program. What a kernel IR *would* buy is an entity universe for the output side of the lowering; see the correspondence finding below. |
| The emitter | Nothing new in the framework | **Chosen.** `src/tensor/fusion.ts: planFusion(fn)` decides the groups and mappings from the Tix IR and returns them; `emitCuda(fn, fuse)` consumes the plan. Legality is a predicate over the plan, evaluated before a single line of CUDA is produced. |

**The correspondence finding (probe `scripts/01-correspondence-probe.mjs`).** The framework's `makeCorrespondence`
accepts a grouped entry naming several source entities and one target entity, so the IR layer *can* express many
statements becoming one kernel:

```
grouped many-to-one entries: [{"from":["e","m","s"],"relation":"fused-into","to":["k0"]}]
```

What it cannot express is this lowering's mapping, because the output port is a `tensor.cuda-source` artifact created
with `createArtifact`: its value is `{fn, source}` and the kind declares no entities at all, so there is nothing on
the target side to correspond *to*. Naming kernels in a correspondence is exactly the kernel-IR artifact rejected
above. The lowering therefore claims no correspondence, and the acceptance evidence for it is not a correspondence
claim but the exact differential relation over the GPU's output of the whole translation unit. That is
sufficient for this stage and is the framework finding: correspondence is available, and buying it costs a second
artifact with an adapter over the emitted text.

## What may be fused, and the legality rules

A **group** is a consecutive run of statements lowered into one kernel. Two policies form groups; each is a set of
rules stated over the Tix IR alone, checked before emission.

### Flat policy: elementwise chains and epilogues

A statement `A` earlier in the group may be **inlined** into a later statement `B` when, at every load of `A` inside
the group, the address tuple of the load is a plain binder of `B` and the map from `A`'s free axes onto `B`'s free
axes is a bijection. Then:

- `A`'s element is a function of exactly one element of `B`, so `A`'s tree is evaluated once per output element:
  the *number* of evaluations of every rounding site is unchanged from `A`'s own kernel;
- each output element is computed by the same scalar tree with the same operations in the same order, so every
  intermediate rounds to the same f32 word that `A`'s kernel would have stored.

`A` is not stored at all: its rounding sites and its stores coincide, so dropping the store/load pair removes no
rounding. `A` may contain reductions; the reduction loops then sit inside `B`'s per-element body, still sequential
in the meaning's order. This is what fuses `mlp`'s two-layer contraction with its bias and GELU epilogue
(`h`, `g` into one kernel).

**Refused by this rule, deliberately:**

| Program shape | Why refused |
| --- | --- |
| `m[i] = max(j) x[i,j]; e[i,j] = exp(x[i,j] - m[i]);` | `m` has rank 1, `e` rank 2, so the map is not a bijection: inlining would re-evaluate `m`'s whole row for every element, `C` times the work. It is *legal* (bit-identical) but not a fusion anybody wants; the row policy handles this shape instead. |
| `y[i,j] = sum(k) g[i,k] * v[k,j]` with `g` a stored intermediate (mlp's second layer) | the load of `g` sits inside a reduction of `y`, and its second index is the reduction binder, not a free axis of `y`: inlining re-evaluates a `D`-term reduction `H` times per output element. Refused; `g` is materialised or staged instead. |
| a producer read at a transposed or offset address (`p[j,i]`, `p[i+1,j]`) | the map is not the identity-and-bijection onto `B`'s free axes, or the address is outside the tile; the intermediate stays in global memory. |
| a producer read more than once inside the group | accepted by the legality rule but refused by the planner: it would duplicate an arbitrary amount of work, and the stage-1 `inline` pass already declines it. |

### Row policy: reductions with their producers and consumers

A row kernel is a block per row: the group's **row axes** are the leading free axes common to every member (the
block index), and each member has *at most one further* free axis (its "extra" axis). Then:

- a member with no extra axis is a per-row scalar. One thread (thread 0) computes it with the same sequential loops
  the meaning prescribes, stores it in a shared scalar, and the block is synchronised. Order is untouched: the fold
  still visits its index tuples in increasing lexicographic order, first binder outermost, rounding after each step.
- a member with an extra axis is computed by the block's threads, strided over the extra axis. Every load of a
  *staged* tensor inside any of these bodies reads shared memory at the affine index the load already carries, so a
  value read back is the f32 word that was written.
- parameters and intermediates whose addresses are the row's own coordinates are **staged**: the row is copied from
  global memory to shared memory by the whole block in a coalesced pass, then read as many times as the bodies need.
  A tensor is staged exactly when its address tuple is `(row coordinates…, one free affine)` at every load site; when
  it is not (a column of `w`, a transposed read, a constant index), the load stays a global load, unchanged from
  stage 2.

Legality is exactly "staging copies bits, folds keep their order, and no value moves between threads". No arithmetic
is added, removed or reordered by the mapping change.

This is what fuses `softmax`'s max/exp/sum/divide and `layernorm`'s mean/variance/normalisation into one kernel each,
and `attention`'s score, shift, exp, sum, divide and value contraction into one.

**Refused by this rule:** a group whose members do not share a common leading row axis; a member with two or more
free axes beyond the rows (its staged value would be a plane, not a row — `conv2d`'s and `matmul`'s single
statements are therefore left as stage 2 emits them); a load of a member that does not map its leading axes onto the
row's own coordinates (a transposed staging read).

### What decides between the two policies

Both policies are tried on the statement that starts the group; the one that covers more statements wins, and a tie
goes to the flat policy, because it needs no barrier and leaves one thread per output element. `merge` of a group is
bounded by one more rule: a member that is read outside the group, or that is the function's result, must be the
group's last statement, so a group is truncated at such a member.

## Emission

`emitCuda(fn, fuse)` walks the plan. A flat kernel is stage 2's kernel with the inlined trees expanded at their load
sites (fresh binder names per expansion, since one producer can be expanded at several sites). A row kernel is:

```cpp
__global__ void k1(I d0, I d1, const float* t0, float* t2) {
  extern __shared__ float smem[];
  const I so0 = 0;                 // shared slot offsets, computed from the shape bindings
  const I so1 = so0 + (d1);
  U block = (U)blockIdx.x;         // the row index, decoded from blockIdx
  const I i0 = block % (d0);
  for (U lane = threadIdx.x; (I)lane < (d1); lane += blockDim.x) smem[so0 + lane] = t0[i0 * (d1) + lane];
  __syncthreads();
  if (threadIdx.x == 0) { float acc = -INFINITY; for (I i2 = 0; i2 < (d1); ++i2) acc = minmax(acc, smem[so0 + i2], true); smem[so1] = acc; }
  __syncthreads();
  ...
}
```

Shared memory is `extern __shared__` and sized at launch from the same expressions, because row extents are runtime
values; the host calls `cudaFuncSetAttribute(..., cudaFuncAttributeMaxDynamicSharedMemorySize, bytes)` once per
kernel, and `cudaFuncGetAttributes` before the timed region, as stage 2 already does for lazy module loading.

The scalar (thread 0) body is emitted with the *same* reduction code as stage 2: sequential loops, `__fadd_rn` or
`minmax`, one accumulator. Nothing about the arithmetic changes with the mapping.

**Block size.** Row kernels use 128 threads per block. Probe `scripts/02-shared-row-probe.mjs` measured the full
fused-softmax shape at 4096 × 1024 with 32, 64, 128 and 256 threads: 0.611, 0.552, 0.458 and 0.558 ms. The serial
folds, not the parallel phases, set the time, and 128 threads keeps more blocks resident per SM.

**What the probe says about the cost of exactness.** Same probe, one row kernel, one part disabled at a time:
memory only 0.110 ms, plus the two folds 0.294 ms, plus the exponential 0.379 ms, everything 0.458 ms; a `y = 2x`
stream kernel over the same 16 MB moves 32 MB in 0.108 ms (311 GB/s measured here, against the brief's 244 GB/s
figure). So at these sizes the fused softmax is not memory-bound: the exact `exp` (CUDA double `exp` rounded once,
which the exact relation requires) costs about 0.27 ms and the two order-preserving folds about 0.18 ms.

## API and contract

```ts
cudaSource(program, fn, options?: { fuse?: boolean }): string
runTixCuda(program, fn, inputs, options?: { host?: string; fuse?: boolean; benchmark?: boolean })
checkLowering(program, fn, options?: { fuse?: boolean }): Promise<{ accepted; relation: 'exact'|'tolerance'; reason? }>
```

- `cudaSource` and `runTixCuda` pass `fuse` to the emitter; `runTixCuda` forwards `benchmark` to the existing
  `runCudaBatch`, which runs one warm-up and reports the median of three timed launches under the tool's `--timed`
  lock.
- `checkLowering` runs the same checked lowering pass as stage 2, whose body now emits the fused source when `fuse`
  is true, and whose invariant is unchanged: exact equality with the *current* revision's f32 meaning on the
  contract's cases, NaN compared as a class. The runner profile string carries the lowering kind, so fused and
  unfused evidence are cached separately.
- The kernel count of a lowering is the number of `__global__` definitions in `cudaSource`.

What the contract checks and what it costs: it evaluates the current revision's f32 meaning on every eligible case
(shapes 1, 3, 4, 7, a mixed assignment where every shape symbol differs, and zero-extent cases; four value streams;
at most 4096 elements and 10^6 metered steps per case), sends the cases in one GPU batch, and compares every output
word. It costs one interpreter pass per case plus one remote compile and run per (revision, lowering) pair, and it
replays cached verdicts on a repeat check. It does **not** check the emitted source's shape: `cudaSource` alone is
never accepted, only a lowering whose GPU output matches.

## Verification plan

- `tests/tensor/fusion.test.mjs`: kernel counts per corpus program and per policy; the refusal cases above
  (`mlp`'s second-layer contraction not inlined, `m[i]` not inlined into `e[i,j]`); `fuse: false` reproduces stage 2's
  source exactly; the plan of every corpus program is stable.
- `tests/tensor/cuda-gpu.test.mjs`: `checkLowering` exact on the fused lowering for all six programs, before and
  after `optimizeTix`, plus random programs; `runTixCuda` word-equal to `runTix` at the full corpus sizes.
- `scripts/03-…`: kernel counts, benchmark times, global traffic and the 244 GB/s comparison per corpus program.

## Measurements to report

Per corpus program, fused and unfused: kernel count, benchmark GPU time, the bytes each kernel reads and writes in
global memory (counted from the plan: every global load site times the number of times it executes, plus one store
per global output element), and the time those bytes would take at 244 GB/s. Recorded together with which fusions
applied, which legal-looking fusions were refused, and every framework and tool change with its reason.

## Later

- Reassociating a reduction (parallel tree folds, split-K), which stage 1's `split-sum` already covers under a
  tolerance and which the exact relation cannot.
- Tiling contractions for data reuse, tensor cores, FMA contraction, streaming attention, autotuning.
- A kernel-IR artifact, if the correspondence of statements to kernels becomes a required output rather than a
  recorded gap.
