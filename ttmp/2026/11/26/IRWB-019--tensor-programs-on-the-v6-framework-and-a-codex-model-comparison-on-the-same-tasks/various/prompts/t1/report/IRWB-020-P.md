Stage 1 of IRWB-020-P has been evaluated independently. Your results:

- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision `2f82984`): 22/25 passed.
  - failed: f32 meaning, bit-exact: mlp: error: "5:8: 'x' is a tensor and cannot be an index"
  - failed: f64 precision against an f64 reference: mlp: error: "5:8: 'x' is a tensor and cannot be an index"
  - failed: optimizeTix inline on the corpus programs: accepted, and bit-identical f32 results: error: "5:8: 'x' is a tensor and cannot be an index"
- **A variant of that suite** that renames one index in the mlp program (`y[i, x] = (sum(f) g[i, f] * w2[f, x]) + b2[x]` becomes `y[i, e] = …`, because `x` is also mlp's input tensor and the brief does not say whether index and tensor names may coincide): 25/25 passed. Both scores are reported.
- **Differential cross-check:** 60 random programs in the fixed core, 3 inputs each, compared with an independent reference evaluation. f32 results bit-identical in 180/180 cases; `precision: 'f64'` results within 1e-9 (relative to max(1, |r|)) in 180/180.
- **`optimizeTix(p, ['inline'])`** on the same 60 programs: accepted on 60, and every accepted result is bit-identical to the original.
- **`optimizeTix(p, ['split-sum'])`:** accepted on 60/60, and every accepted result computes the same function (f64 run within 1e-9).

In this turn, do not change any code under `src/`, `tests/` or `corpus/`. The evaluated revision must stay as it is.

1. **Diagnose.** For every failure or rejection listed above, find its cause in your code and state it with `file:line` in your diary. Reproduce it with a script in your ticket's `scripts/` if that helps. If you think a result is wrong, say why.
2. **Write your final report** as `reference/02-report.md` in your ticket. It is for a reader who knows compilers but not this repository, and it will be published as written. Cover:
   - Tix;
   - the IR you chose and why;
   - the evaluators;
   - the meaning contract: relations, cases, the tolerance and how you justified it;
   - the two passes;
   - each framework change and why it was needed;
   - how you checked the work;
   - the evaluation results above, including every failure and its cause;
   - what you would do differently.

   Write prose first, with short code excerpts and at least one diagram (Mermaid). Aim for 2,000 to 3,500 words. Report only what you built and measured.
3. **Commit** (message starting `IRWB-020-P:`). Final message: the report's path, the commit hash, and one line per failure cause.
