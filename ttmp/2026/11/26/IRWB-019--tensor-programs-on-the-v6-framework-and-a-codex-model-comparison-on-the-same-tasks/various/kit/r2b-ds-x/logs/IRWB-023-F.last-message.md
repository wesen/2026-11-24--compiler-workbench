Done. Final state is committed; no file outside `ttmp/` was touched.

**Design:** `ttmp/2026/11/26/IRWB-023-F--what-compiler-work-would-make-tix-best-in-class/design-doc/01-speed-under-exactness-a-research-agenda-for-tix.md` (8,056 words, 2 Mermaid diagrams, 5 ranked proposals, staged plan, failures), with `reference/01-research-diary.md` and raw results in `reference/experiment-0*`.

**Top three proposals**
1. **P1 — schedule equivalence as a checked object:** bit-identity is structural (same per-output tree, same rounding sites, same fold order), so a pass/lowering can emit an O(nodes) certificate the framework verifies in milliseconds instead of sampling; the legal class already contains tiling and fusion.
2. **P2 — an exhaustively verified transcendental layer:** f32 is finite, so `exp`/`log`/`tanh` can be proved against the meaning over all 2³² inputs in ~1 s, which both makes the guarantee portable across toolchains and licenses a Ziv-guarded fast path.
3. **P3 — a second, order-invariant meaning for `sum`:** `sum` is the only construct whose specified meaning forbids cross-thread execution, so an exact/reproducible mode removes the last barrier and turns reduction lowering into a theorem rather than a sample.

**Experiments (all run, results reported)**
- E1 schedule classes/fusion (GB10): 4×4 tile + shared k panel, matmul 512³ 0.2068 → 0.1027 ms (2.0×) with **0** of 262,144 words changed; the reassociated 4-accumulator control 0.0904 ms but **93.5%** of words changed (price of exactness ≤14%); fused thread-per-row softmax is bit-identical yet 1.7× *slower* (0.788 → 1.349 ms) because `exp` is a double call; block-parallel softmax 0.713 ms but 97.3% of words differ.
- E2 transcendental sweep (GB10): 2.147×10⁹ f32 words in 506 ms; `expf` wrong on 3.72%, `tanhf` on 0.92%; `expf` makes softmax 2.7× faster (0.504 ms); my naive Ziv guard was vacuous (100% fallback) and unsound in 1,262 words — full 2³² verification extrapolates to ≈1.01 s.
- E3 tolerance scale sweep (CPU): the honest f32 meaning consumes 0.27 → 1.62 → 3.65 of the `2e-6+2e-5|r|` budget as matmul K goes 64 → 256 → 1024, i.e. the relation would reject a *correct* lowering at corpus shapes while the gate only samples extents 1/3/4/7.
- E4 gate evasion (GB10): a lowering that drops the last k step for every extent ≥ 8 is `accepted: true`; at extent 16 the error is 4018× the budget.
- E5 reduction-limited probe (GB10): matvec warp-tree is 9.7× faster than the exact one-thread-per-row kernel, but the experiment is confounded (spilling accumulators, changed coalescing) — the "price of exactness when the fold is the only parallelism" is reported as an untested prediction, not a result.

**Commit:** `7df05f6`
