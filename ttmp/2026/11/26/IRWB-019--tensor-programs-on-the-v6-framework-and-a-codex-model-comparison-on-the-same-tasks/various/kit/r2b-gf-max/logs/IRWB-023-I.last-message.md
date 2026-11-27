All deliverables are complete and committed; no product files touched. Final summary:

## The design's path

I defined **best in class for Tix as certified throughput**: kernel speed achieved while a machine-checked relation to Tix's exactly specified f32 meaning holds — with every relaxation of that certification explicit, priced, and itself checked. The argument: "fastest vs cuBLAS" is the wrong target because cuBLAS's FFMA contraction doesn't even compute Tix's meaning; Tix's unique asset is that "these output words are the meaning" is *stateable and checkable*, so the benchmark should measure performance *conditioned on* that guarantee. From there: an **exactness calculus** (six rewrite classes provably bit-exact — store/load, substitute, replicate, schedule-only, order-free `max`, invariant hoisting — and two priced classes: `sum-reassoc`, `contract-fma`), which turns schedule optimization into classified checked passes; then three ranked proposals built on it.

## Top three proposals

1. **Schedule tier in the IR with provably exact schedule passes** (tile-outputs, stage-through-shared, fuse-by-replication, warp-parallel-max) — measured 2.8× on matmul, 2.0×/2.8× on softmax/layernorm, all bit-identical to the meaning at production size.
2. **Numerical budgets as a first-class compilation target** — fast-math becomes checked passes with a price list: `expf` buys 3× at 0.17% of budget; FMA contraction *exceeds* the stage-2 budget on 0.12% of matmul outputs; tree-sum bought nothing.
3. **Static exactness certificates** — a structural rounding-site matcher (prototype built and passing) replaces sampled gates for exact-class rewrites: ≤0.54 ms vs seconds.

## Experiments run

- **E0** GPU smoke test — tool works, compile ~2.5 s, cached.
- **E1** exact-f32 references — 0 word mismatches vs the interpreter on all 4 programs; full-size refs built in ≤1.1 s each.
- **E2** matmul bench (median-of-20, GPU-locked) — baseline 0.2131 ms; register-tiled **exact 0.0763 ms (2.8×, 0/262,144 mismatches)**; FMA variant 0.0662 ms (exactness price 15%); naive FMA = naive rn (memory-bound).
- **E3** softmax/layernorm — fused **exact 0.3987/0.1733 ms (2.0×/2.8×, 0/4,194,304 mismatches each)**; tree-sum 0.3974 ms (no gain); `expf` 0.1334 ms (6×, ≤0.17% of budget).
- **E4** attention — fused exact 0.833 vs 1.049 ms (1.26×); bottleneck identified as unstaged k re-reads (~268 MB L2 traffic).
- **E5/E5b** check costs — sampled gates 2.3–10.8 ms (conv2d 629 ms, interpreter-bound), remote check ≈2.5 s; certificate prototype holds on all 6 inline candidates, rejects both mutants.
- **E6** double-exp price — 0.399 → 0.133 ms when relaxed to `expf` (the meaning's transcendental choice is softmax's dominant cost).
- **E7** sampling blind spot — **my hypothesis was refuted**: the budget holds to K=2²⁰ on the stream family; the real exposure is cancellation inputs at K=3 (validity rests on streams, not the size cap).
- **E8** max/min reassociation — **0 word mismatches in 2×100,000 random trees** (incl. NaN/±0/±∞); sum: 80 in 5,250 — the `max-reassoc` exact class is real.

## Commits

`d227f21` → `37a2f02` → `e428621` → **`87a0e83`** (final: design doc with results, diary, ticket bookkeeping) on `r2b-gf-max/irwb-023-i`, not pushed.
