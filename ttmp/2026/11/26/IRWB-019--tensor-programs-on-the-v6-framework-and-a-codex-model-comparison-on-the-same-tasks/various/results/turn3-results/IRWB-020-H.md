- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision `e0233f2`): 25/25 passed.
- **Differential cross-check:** 60 random programs in the fixed core, 3 inputs each, compared with an independent reference evaluation. f32 results bit-identical in 180/180 cases; `precision: 'f64'` results within 1e-9 (relative to max(1, |r|)) in 180/180.
- **`optimizeTix(p, ['inline'])`** on the same 60 programs: accepted on 60, and every accepted result is bit-identical to the original.
- **`optimizeTix(p, ['split-sum'])`:** accepted on 59/60, and every accepted result computes the same function (f64 run within 1e-9).
- **`split-sum` was rejected on 1 program(s):** 39. Every program is valid and the pass is correct on each, and plain f32 evaluation of these programs stays within 3.7e-7 of f64 (relative to max(1, |r|)) on the evaluation's inputs. So each rejection is a false rejection unless your contract found a real violation. Source:

```
fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[C] {
  t0[i0] = (sum(r1, r2) -(v[i0] / (v[i0] * v[i0] + 1)) * u[r1] - u[r2]);
  t1[i3, i4] = (sqrt(v[i4] * v[i4] + 0.5) - (sum(r5) v[i4] + v[r5])) / C - u[i3];
  t2[i6] = u[i6] - -u[i6];
  t3[i7] = (sum(r8) (sum(r9) C - v[r9]) + (t0[i7] - x[r8, i7]));
  return t3;
}
```
