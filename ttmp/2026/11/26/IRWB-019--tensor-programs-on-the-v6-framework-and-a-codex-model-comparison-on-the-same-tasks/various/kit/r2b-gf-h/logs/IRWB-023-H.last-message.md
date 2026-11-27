Done. Everything lives in ticket `IRWB-023-H` (`ttmp/2026/11/26/IRWB-023-H--…`), with no changes to `src/`, `tests/`, `corpus/` or `tools/`.

## The design's path

I defined **best in class as "trustworthy speed"**: performance near vendor libraries where every transformation is checked against Tix's exactly specified f32 meaning, and the checking runs at deployment shapes. Three measured gaps motivated three ranked proposals: the current kernels leave 4–8× on the table without touching the meaning; the sampled tolerance gate's evidence doesn't transfer beyond toy shapes; and the CPU oracle is too slow to ever check deployment scale. Plan: make the checker able to see the truth first, then give it fast exact programs, then let it reason statically.

## Top three proposals

1. **Meaning-preserving parallelization** — `tile`/`fuse` as checked passes gated *exactly* (bit-identical to the f32 meaning), with exactness derived statically from the IR's free-vs-fold binder distinction.
2. **Certified error budgets for reduction rewrites** — static, input-magnitude-aware certificates (from the IR's explicit trees) replace sampled tolerance; block width and accumulator precision chosen by certificate × measured GPU cost.
3. **Deployment-scale f64 oracle** — the oracle is the same emitter run in f64 on the same GPU, making full-size checks cost ~0.3 s of GPU compute instead of ~13 CPU-minutes.

## Experiments (all results in the diary/design doc)

- **E0** API probe: pipeline works end-to-end, split structure visible in emitted CUDA. ✓
- **E1** exact-real summation study (BigInt oracle): blocked-4 error 2.7e-5 → Kahan 1.8e-6 at n=1024; sampling gap **4.8e-7 at n=7 vs 1.1e-4 at n=1024** (over budget in 49/50 adversarial trials).
- **E3** tiled matmul on GB10: **0 mismatched words at 512³/1024³/2048³**, 4.4–7.9× over naive (5.4–8.2 TFLOP/s; cuBLAS 8.15 at 512³); the FMA (meaning-violating) variant buys only 14–21%.
- **E4** fused softmax on GB10: first exact-fusion attempt **refuted** (12.2 ms, 16× slower — serial double-exp in the fold chain); fixed variant **bit-exact, 0/4,194,304 mismatches, 2.3× faster** than naive; order-changing tree variant slower *and* inexact.
- **E5** f64 oracle: bit-identical to CPU f64 on all arithmetic-only programs, ≤2.15 ulp on transcendentals; **3 of 6 corpus programs violate the Stage-2 budget at deployment shapes** (up to 36×) — invisible to the sampled gate.
- **E6** split-sum-optimized matmul at deployment scale: **46% slower on GPU** (0.312 vs 0.214 ms) and still 1.3× over budget — neither cost nor error visible to its own gate.

## Commit

`7dbf9c5` — `IRWB-023-H: diary checkpoint on design document completion` (branch `r2b-gf-h/irwb-023-h`; full doc already complete at `e21dfd0`; not pushed).
