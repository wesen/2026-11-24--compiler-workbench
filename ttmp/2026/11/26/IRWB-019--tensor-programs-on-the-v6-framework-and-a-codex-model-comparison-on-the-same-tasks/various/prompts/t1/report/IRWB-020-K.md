Stage 1 of IRWB-020-K has been evaluated independently. Your results:

- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision `24f830a`): 25/25 passed.
- **Differential cross-check:** 60 random programs in the fixed core, 3 inputs each, compared with an independent reference evaluation. f32 results bit-identical in 180/180 cases; `precision: 'f64'` results within 1e-9 (relative to max(1, |r|)) in 180/180.
- **`optimizeTix(p, ['inline'])`** on the same 60 programs: accepted on 60, and every accepted result is bit-identical to the original.
- **`optimizeTix(p, ['split-sum'])`:** accepted on 55/60, and every accepted result computes the same function (f64 run within 1e-9).
- **`split-sum` was rejected on 5 program(s):** 31, 34, 43, 51, 54. Every program is valid and the pass is correct on each, and plain f32 evaluation of these programs stays within 1.6e-7 of f64 (relative to max(1, |r|)) on the evaluation's inputs. So each rejection is a false rejection unless your contract found a real violation. The first two:

```
fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[C] {
  t0[i0, i1] = (sum(r2) x[i0, i1] + u[r2]);
  t1[i3] = min(1.25, v[i3]) + (max(r4) u[r4]) / (v[i3] * v[i3] + 1);
  return t1;
}
```

```
fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[N] {
  t0[i0] = (max(r1) 0.5 * v[r1]) / (u[i0] * u[i0] + 1) / (u[i0] * u[i0] + 1);
  t1[i2] = -min(t0[i2], u[i2]) * ((sum(r3) 1.25 - u[r3]) / C);
  return t1;
}
```

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
3. **Commit** (message starting `IRWB-020-K:`). Final message: the report's path, the commit hash, and one line per failure cause.
