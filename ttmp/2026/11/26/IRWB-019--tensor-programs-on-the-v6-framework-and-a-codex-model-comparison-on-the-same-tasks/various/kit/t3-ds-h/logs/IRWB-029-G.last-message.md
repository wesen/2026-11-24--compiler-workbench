Done. Everything is committed and the tree is clean (`npm run build`, tensor tests 35/35, framework tests 227/227, prettier clean).

## Ticket, design, report

- Ticket: `ttmp/2026/11/26/IRWB-029-G--checked-fusion-for-tix-on-the-gb10/` (closed)
- Design: `.../design-doc/01-checked-fusion-of-tix-statements-into-fewer-kernels.md`
- Report: `.../reference/02-report.md` (diary: `.../reference/01-implementation-diary.md`; probes/benchmarks: `.../scripts/01`–`07`)

## Where fusion lives, and why

`src/tensor/fusion.ts: planFusion(fn)` decides groups and thread mappings from the Tix IR; `emitCuda(fn, fuse)` consumes that plan.

- **Not a Tix pass:** fusion changes no meaning, so it would have to put a schedule into the meaning-carrying artifact — the evaluator, validator and meaning gate would all learn a field with no semantics.
- **Not a kernel-IR artifact:** its only new information (groups, block axes, staged values) is a pure function of the Tix revision, so it would be a cache with its own schema, validator and emitter input.
- **Emitter:** legality is a predicate over the plan, checked before a line of CUDA exists; a group that fails any rule is lowered exactly as stage 2 lowers it, so `fuse:false` still emits stage 2's text **byte for byte** (SHA-256 pinned in the tests; for `matmul`/`conv2d` the fused text is identical too).

Two policies: **flat** inlines a producer only when the load maps its free axes bijectively onto the consumer's free axes (so its tree is evaluated once per element, unchanged rounding sites); **row** gives a block a row, stages rows/values through shared memory, folds per-row scalars on one thread in the meaning's order and computes the rest strided over the block.

## Kernel counts and benchmark GPU time (median of 3, GB10)

| Program | Kernels unfused → fused | GPU ms unfused → fused | Issued global MB → fused | 244 GB/s floor, ms |
|---|---|---|---|---|
| matmul | 1 → 1 | 0.2142 → 0.2072 | 1074.8 → 1074.8 | 4.405 |
| softmax | 4 → 1 | 0.8019 → 0.4763 | 134.3 → 33.6 | 0.550 → 0.138 |
| layernorm | 4 → 1 | 0.5194 → 0.2099 | 201.4 → 83.9 | 0.825 → 0.344 |
| attention | 6 → 1 | 1.1912 → 0.8001 | 1111.8 → 537.4 | 4.556 → 2.202 |
| mlp | 3 → 1 | 1.0684 → 0.9845 | 4330.6 → 2154.8 | 17.748 → 8.831 |
| conv2d | 1 → 1 | 0.1754 → 0.1920 | 1137.6 → 1137.6 | 4.662 |

Byte counts are *counted from the plan* (issued loads/stores), and for matmul/conv2d/mlp/attention they are cached re-reads, so that floor doesn't bound the measurement — the report gives the compulsory-traffic column separately. At 4096×1024 the fused kernel is not memory-bound: exact double `exp` ≈ 0.27 ms and the two order-preserving folds ≈ 0.18 ms dominate (probe 02), so softmax's ceiling under the exact relation was ~0.46 ms, not 4×.

Evidence: fused output **word-identical** to stage 2 at full corpus sizes; 24/24 `checkLowering` verdicts `exact` (both revisions, both lowerings, 2.2–3.5 s each, 1 ms cached); 198/198 fuzz cases identical to the interpreter; unsampled shapes and empty/one-lane rows equal; refused fusions (rank-1 into rank-2, contraction input inside a reduction, cross-row read, transposed staged read) are enumerated with reasons.

## Framework and tool changes

- **`src/framework/`: none needed.** Finding: the IR layer *can* express many→one (`makeCorrespondence` accepts a grouped `fused-into` entry), but this lowering's output port is built with `createArtifact` over `defineIR<{fn,source}>`, so it has no entities to name — buying that correspondence costs the kernel-IR artifact this stage rejects. The lowering is judged on the GPU output of the whole translation unit instead.
- `src/tensor/`: new `fusion.ts`; `cuda-source.ts` rewritten around one tree walker serving both kernels; `index.ts` takes `{fuse}` (and forwards `benchmark`); `cuda-contract.ts` takes a `fuse` option and separate runner profiles (`:fused`, `:plain`) so evidence is per lowering.
- `tools/cuda-remote.mjs`: unchanged — `--timed`, `--runtime-input` and per-job directories already cover what the fused path needs.

Last commit: `c520562`.
