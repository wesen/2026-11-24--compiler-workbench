---
Title: Checked fusion: kernel counts, timings and byte accounting
Ticket: IRWB-029-I
Status: active
Topics:
    - compiler
    - tensor
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: Kernel-plan analysis and legality rules
    - Path: repo://src/tensor/cuda-source.ts
      Note: Flat and row kernel emitters, host changes, branchless minmax
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Fuse port on the checked lowering transformation
    - Path: repo://ttmp/2026/11/26/IRWB-029-I--checked-fusion-for-the-tix-cuda-lowering/scripts/02-benchmark-fusion.mjs
      Note: Benchmark and byte-accounting method
    - Path: repo://ttmp/2026/11/26/IRWB-029-I--checked-fusion-for-the-tix-cuda-lowering/scripts/04-minmax-probe.mjs
      Note: Certification of the branchless minmax helper
ExternalSources: []
Summary: Fusion plans in the lowering; all six corpus functions bit-identical fused; 1.0–3.0× at the brief's sizes; no framework change needed.
LastUpdated: 2026-11-27T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion for the Tix CUDA lowering

Stage 2 launches one kernel per statement; every intermediate makes a round trip through global memory,
and a row reduction runs one thread per row over strided global reads. Stage 3 fuses statements into
fewer kernels without changing any result bit. The evaluated implementation is at commit `HEAD`
(IRWB-029-I branch). Everything numerical below is measured on the GB10 unless marked *argued*.

## Where fusion lives

**In the lowering.** A new analysis, `src/tensor/fusion.ts`, reads the selected function of the current
Tix revision and returns an ordered list of kernel plans; the emitter (`src/tensor/cuda-source.ts`)
prints one kernel per plan. `cudaSource`, `runTixCuda` and `checkLowering` take `options.fuse`
(default `true`); `fuse: false` bypasses the analysis and reproduces stage 2's emission **byte for
byte** — verified against snapshots taken before the first emitter edit
(`reference/stage2-sources/*.cu`).

A pass on the Tix IR could only express the elementwise subset: a Tix statement is one tensor assignment
whose per-element value is a scalar tree, so softmax's staged row (one block per row, thread-0 folds)
cannot be written as Tix. A second v6 artifact (kernel IR) would restate what the plan records; stage 2
already rejected a kernel IR for the same reason. Fusion therefore sits between them: a plan — grouping
plus thread mapping — computed from the IR before emission, with its legality decided there.

**Correspondence finding.** Because fusion lives in the lowering, no Tix revision is produced and no
entity correspondence is needed: many statements become one kernel inside the CUDA artifact. The
framework *could* express the merge (`makeCorrespondence` has merge entries), but a merged Tix revision
would still not carry the thread mapping, so the correspondence would say less than the fusion does.
The plan is instead recorded in the CUDA artifact payload (kind `tensor.cuda-source`, version 2):
each kernel's form, its statements, the tensors it reads from global memory and the members it writes.
The checked subject thus carries its own kernel structure, and the artifact validator checks it.

## The two kernel forms

**Flat** — all members share the driver's shape and every load of a member is identity-indexed (each
index component is exactly the consumer's own binder for that axis). One thread per element, stage 2's
mapping: each thread walks the members in definition order, computing each member once into a local, and
stores only the members that outside statements or the result consume. This fuses `mlp`'s contraction
`h` into its GELU epilogue `g` (h read four times by g's tree — computed once, not four times) and fuses
plain elementwise chains, e.g. `y2[i,j] = f(y1[i,j])` after any pointwise `y1`.

**Row** — one block per row (the driver's non-last axes), threads across the row axis. Row-element
members (driver's shape) are staged in dynamic shared memory; row-scalar members (the driver's shape
minus the row axis) are computed once per row by thread 0, whose reductions fold sequentially in the
reduction's own axis order with the meaning's initializer and one rounding per step — including the
split-sum block/tail bounds that stage 1's pass produces. Parameters and outside statements that scalar
phases read along the row are staged first, by one coalesced cooperative load per block. Phases run in
definition order separated by `__syncthreads()`; no thread returns early. Threads per block: 128
(measured better than 256 for the serial phases).

**Legality** is decided from the IR before emission; a run that cannot be shown order-preserving stays
at stage 2's per-statement kernels. Because stage 2 stores and reloads exact f32 words, and a fused
kernel computes every needed element with the producer's own tree and fold order, every accepted plan is
bit-identical; an illegal one is never formed. Formation is a left-to-right greedy scan: maximal runs of
statements whose shapes match the candidate driver's (or its prefix, for row-scalars), with load locality
checked per member. Closing a run early is always safe because outside consumers read written buffers.

## Kernel counts, times, bytes

Each value is the median of three in-process CUDA-event timings (one warm-up first), one `--timed`
remote invocation per mode; the table shows the middle of three such invocations (per-program spread
across the three runs was ≤ 2% fused, ≤ 1% unfused). "By my count" bytes assume perfect L2 reuse within
a kernel: each distinct tensor element read at most once, each output element written once — the
standard lower bound, computed from the plan (script `02-benchmark-fusion.mjs`). The floor is those
bytes at the measured 244 GB/s streaming bandwidth.

| Program | kernels u→f | unfused ms | fused ms | bytes u→f (MB) | floor fused (ms) | identical |
| --- | --- | ---: | ---: | ---: | ---: | :--: |
| matmul (M=K=N=512) | 1→1 | 0.216 | 0.214 | 3.1→3.1 | 0.013 | ✓ |
| softmax (N=4096, C=1024) | 4→1 | 0.793 | 0.388 | 100.7→33.6 | 0.138 | ✓ |
| layernorm (N=4096, D=1024) | 4→1 | 0.470 | 0.152 | 100.7→33.6 | 0.138 | ✓ |
| attention (Q=K=1024, D=V=64) | 6→2 | 1.050 | 0.782 | 34.6→9.4 | 0.039 | ✓ |
| mlp (N=1024, D=256, H=1024, O=256) | 3→2 | 0.989 | 0.862 | 21.0→12.6 | 0.052 | ✓ |
| conv2d (N=8, C=16, 64×64, O=32) | 1→1 | 0.164 | 0.165 | 6.1→6.1 | 0.025 | ✓ |

Per-kernel bytes (fused plans; unfused = each statement alone):

| Program, kernel | form | statements | read MB | write MB |
| --- | --- | --- | ---: | ---: |
| softmax k0 | row | m, e, s, y | 16.78 | 16.78 |
| layernorm k0 | row | mean, centered, variance, y | 16.79 | 16.78 |
| attention k0 | row | score, shift, e, z, weight | 0.52 | 4.19 |
| attention k1 | single | out | 4.46 | 0.26 |
| mlp k0 | flat | h, g | 2.10 | 4.19 |
| mlp k1 | single | y | 5.24 | 1.05 |

The unfused softmax moves 100.7 MB in 0.79 ms (127 GB/s effective); the fused one moves 33.6 MB — the
fused kernel is 0.39 ms, 2.8× its floor. Layernorm, with no transcendental, lands 1.1× over its floor
(0.152 ms against 0.138): the row kernel is bandwidth-bound there, which is the design working. The
fused softmax's remaining gap is measured, not mysterious: the meaning's `exp` is `Math.fround(Math.exp)`
and the lowering realizes it as CUDA's double-precision `exp` rounded once — the phase probe
(`03-softmax-phases.mjs`) put that at ~0.2–0.3 ms for 4.2·10⁶ exps (fused softmax with the exponential
replaced by identity: 0.34 ms; with it: 0.39 ms, against 0.34 ms for an `expf` variant that is *not*
bit-identical). The prototype's 4.25× softmax ratio is not reachable under this constraint: it did not
pay the double-precision exp.

Attention and mlp are dominated by the contractions' uncoalesced inner reads (`k[j,d]` and `w[d,j]`
with one thread per output element) — the same cost stage 2 pays; tiling of contractions is out of scope
and is the obvious next lever. matmul, conv2d are single-statement programs: fusion cannot apply and the
numbers are stage 2's, as expected.

## Which fusions applied, which were refused

Applied, exactly as the design targeted: softmax's four statements and layernorm's four into one row
kernel each; attention's `score`/`shift`/`e`/`z`/`weight` into one row kernel (`out` separate); mlp's
`h`+`g` into one flat kernel (`y` separate). All survive stage 1's `inline` and `split-sum` unchanged in
count: after split-sum the row-scalar sums carry block/tail bounds and still fold sequentially in the
kernel; after inline (attention's `weight` into `out`) the group simply ends one statement earlier and
`e` becomes a written intermediate.

Refused (legal-looking, deliberately not applied):

- **Contraction into a following contraction** (mlp's `g` into `y`; attention's `weight` into `out`):
  each `y[i,j]` element needs the whole row of `g`, so per-element inlining recomputes the producer
  per output element or needs row-level staging across two contractions — reassociation/tiling
  territory reserved for later stages.
- **Non-identity member loads in a flat group** (transposed or offset elementwise consumers, e.g.
  `z[i,j] = y[j,i] * 2`): correct fusion needs per-thread on-demand recompute or staging; refused rather
  than silently duplicating trees. Pinned by a test.
- **Cross-row loads of fused members** (e.g. `b[i,j] = sum(dy) a[i+dy,j] * …`): the member's staged row
  only covers the current row. Pinned by a test. (A constant cross-row offset such as `a[i+1,0]` is
  already statically rejected by the parser's bounds check; offset-varying ones need an enclosing
  reduction binder.)
- **Anything that reassociates a fold** — parallel tree reductions, split-K — out of scope by the brief;
  every fold in a fused kernel runs sequentially in the meaning's order, by one thread.

## Framework and tool changes

**No `src/framework/` change was needed.** The heterogeneous Tix→CUDA transformation accepted the new
`fuse` input port; the existing differential machinery generated the same case set for both fuse modes
and reused the baseline evidence across them. That the framework fits this stage unchanged is itself the
finding: the fusion is a *lowering* decision, and the framework's pass/correspondence layer is about IR
revisions, which fusion does not produce. The 227 framework tests pass untouched.

Changes, each with its reason:

| Change | Reason |
| --- | --- |
| `src/tensor/fusion.ts` (new) | Legality must be decided from the IR before emission, and the plan must be inspectable and testable on its own. |
| `src/tensor/cuda-source.ts`: flat/row emitters; host allocates only consumed outputs; dynamic shared memory with an opt-in attribute check; threads 128 for row kernels | The emitter consumes the plan. Skipping unconsumed intermediates is where the bandwidth win comes from; the attribute check keeps a row that exceeds shared memory a clear error instead of a launch failure. |
| `minmax` helper branchless (ordered-integer key + NaN select) | The sequential fold through the branchy helper could not pipeline its loads (~0.35 ms for softmax's max fold); the branchless form is equivalent on every input and certified by `04-minmax-probe.mjs` (160,256 pairs, zero mismatches). |
| `cuda-contract.ts`: `fuse` port, artifact payload v2 with the kernel plan | The checked subject must be the fused lowering, and the fusion decision must be recorded, validated and versioned rather than implicit in text. |
| `src/tensor/index.ts`: `fuse` and `benchmark` options through the fixed API | The brief's fixed surface; `benchmark` exposes the runner's existing warm-up + median-of-three under `--timed`. |
| `tools/cuda-remote.mjs`: none | The existing `--timed` lock, per-invocation directories and `--link` were sufficient. |

## What the contract checks, and what it costs

`checkLowering(program, fn, {fuse})` runs the checked transformation: the emitter produces the fused
plan's source; the `tensor.cuda-meaning` invariant compares it against the **current revision's f32
meaning** on the seeded case set — bit-identical words including signed zeros and infinities, NaN
compared as a class — over shape assignments 1, 3, 4, 7, mixed distinct sizes, all-zero and one-zero-at-
a-time assignments, with signed, positive, half-ULP and alternating-zero streams, tensors ≤ 4,096
elements and ≤ 10⁶ metered evaluator steps per case. There is no tolerance to justify: the base lowering
is bit-exact, so an order-preserving fusion must be too, and any disagreement is a real ordering or
rounding bug. Evidence memoization keys the baseline by revision+function, so fused and unfused checks
share the f32 reference cases and only the subject batches differ.

Cost: a corpus check is one remote compile (cached across fuse modes by source hash — the fused and
unfused sources compile separately) plus one batched GPU run of the case set. Measured on the GB10: the
six corpus functions, original and optimized revisions, fused — the 11 checks in
`tests/tensor/cuda-gpu.test.mjs` run in ~67 s wall including SSH and compile; individual fused checks
take ~2.5–5 s. The fused softmax check exercises 21 sampled cases; the fused row kernel's zero-extent
cases (N=0, C=0) are accepted, as designed.

**Argued, not measured:** the bit-exactness *argument* itself (same trees, same fold order, staged f32
copies are bitwise) is a proof obligation discharged by construction plus the sampled exact checks, not
by exhaustive execution; the full-size bit-identity column in the table is a fused-vs-unfused GPU
comparison at the brief's sizes (the unfused side is already checked against the meaning by the sampled
contract), not a full-size interpreter run — the stage-2 report showed the interpreter needs ~1–13
minutes per program at these sizes. The 244 GB/s floor is the brief's measured figure, reused. The byte
counts are computed from the plans, not traced in hardware.

## Verification

- `npm run build`; `node --test tests/tensor/{fusion,cuda,language,passes,corpus}.test.mjs` — 29/29.
- `node --test tests/tensor/cuda-gpu.test.mjs` — 11/11 (~67 s, includes the corpus exact checks fused).
- `node --test tests/tensor/cuda-gpu-fused.test.mjs` — 5/5 (~89 s): corpus fused-vs-unfused bit equality,
  empty rows/outputs, returned row scalar, `fuse: false` still exact, 12 random programs bit-identical.
- `node --test tests/framework/*.test.mjs` — 227/227.
- Scripts, all committed: `01-smoke-fused.mjs`, `02-benchmark-fusion.mjs` (three runs saved under
  `reference/benchmark-run-*.json`), `03-softmax-phases.mjs`, `04-minmax-probe.mjs`.

## What I would do next

- Stage the `k` rows (or a `k`-tile) in attention's fused kernel and tile `w[d,j]` in mlp's — the
  contractions are now the whole cost; that is the brief's tiling stage.
- Let the flat form use staged rows for offset loads (a vector stencil `y[i] = a[i-1] + a[i] + a[i+1]`
  currently stays unfused); the row form already has the machinery.
- Wider use of the plan: a scheduler could pick threads-per-row per device instead of the fixed 128.
