Stage 3 is complete. Every corpus program now lowers to one kernel, bit-identically, checked under the exact relation.

## Ticket and documents

Ticket: `ttmp/2026/11/26/IRWB-029-H--checked-fusion-of-tix-statements-into-fewer-cuda-kernels/`

- design + amendments: `design-doc/01-checked-fusion-of-tix-statements-into-fewer-cuda-kernels.md`
- report: `reference/01-fusion-report-fewer-kernels-the-same-bits.md`
- diary: `reference/02-implementation-diary.md`
- probes, all committed and re-runnable: `scripts/01-grouped-correspondence-probe.mjs`, `02-exactness-probe.mjs`, `03-bytes.mjs`, `04-benchmark.mjs`, `05-block-size.mjs`, `06-contract-cost.mjs`

## Where fusion lives, and why

**In the emitter, from a plan computed on the Tix IR** (`fusePlan` in `src/tensor/fusion.ts` → `emitCuda(fn, {fuse})`). Not a Tix pass (kernel boundaries, thread mappings and storage classes carry no meaning, so the meaning gate could not check one, and the Tix adapter would advertise non-language relations). Not a kernel IR: it is a projection of one revision whose only remaining use is a correspondence record, and the artifact that must be judged — the CUDA translation unit — already exists.

Four rules, all order-preserving: pointwise substitution, thread-local substitution, block-per-row kernels (every lane reduction stays one thread's serial fold), shared staging plus a cooperative row copy. Both lowerings share **one** scalar-expression emitter; `fuse: false` reproduces the committed stage 2 text (one extra `#include`, no kernel differs).

**Framework finding (probed):** grouped correspondence `{from:[m,s], to:[k0]}` works, but needs a target entity universe; with none it is rejected `Unknown target entity k0`, and an empty target list records a removal. The CUDA artifact has no adapter, so the grouping lives in the payload and is certified by the exact relation (a test pins plan kernel count == `__global__` count). The report proposes the smallest framework change if a later stage needs the record; none was made.

## Kernel counts and GPU time (GB10, median of 9 CUDA-event intervals)

| Program | Kernels f/u | Fused ms | Unfused ms | Speed-up | Bytes floor (fused) |
|---|---|---|---|---|---|
| matmul 512³ | 1 / 1 | 0.2143 | 0.2175 | 1.02x | 0.013 ms |
| softmax 4096×1024 | 1 / 4 | 0.4245 | 0.8111 | **1.91x** | 0.138 ms |
| layernorm 4096×1024 | 1 / 4 | 0.1541 | 0.4857 | **3.15x** | 0.138 ms |
| attention 1024/1024/64/64 | 1 / 6 | 0.7876 | 1.0478 | **1.33x** | 0.004 ms |
| mlp 1024/256/1024/256 | 1 / 3 | 1.0119 | 1.0559 | 1.04x | 0.017 ms |
| conv2d 8/16/64/64/32 | 1 / 1 | 0.1662 | 0.1650 | 0.99x | 0.025 ms |

matmul and conv2d emit the same translation unit either way, so their ratio measures the shared machine's noise (~2%). Issued vs distinct bytes, the 244 GB/s floors for both, the refusals, and the contract's cost (28–40 cases, 2.2–4.1 s cold, ~1 ms replay) are in the report, with measured and argued results kept apart. 58/58 exact-relation checks accepted; direct fused-vs-unfused and fused-vs-`runTix` bit-identity on the corpus and six edge programs; a dropped-lane fold mutant is rejected.

## Framework and tool changes

**None to `src/framework/` and none to `tools/cuda-remote.mjs`.** The heterogeneous transformation, the exact differential invariant with async `decide`, its memo and in-flight batch sharing, and the runner's runtime inputs, per-job isolation, compile lock and `--timed` lock were sufficient. Changes are confined to `src/tensor/` (`fusion.ts` new; `cuda-source.ts`, `cuda-contract.ts`, `index.ts`), `tests/tensor/` (`fusion.test.mjs` new, `cuda.test.mjs`, `cuda-gpu.test.mjs`) and the ticket.

Last commit: **cb51e44** (33 local tensor tests, 19 GB10 tensor tests, 227 framework tests passing; working tree clean).
