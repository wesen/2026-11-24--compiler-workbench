Report: [reference/02-report.md](ttmp/2026/11/26/IRWB-020-E--tix-language-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md)  
Commit: `4f34ce95fdf9b9552051a5d828f09fd1eb81fa55`

**Program 39 — `split-sum`:** Cancellation exposed existing f32 rounding error. On lane 0 at `C=4, N=5`, the original and rewritten programs returned the same f32 value, but its error against f64 was `1.20e-5`, above the `5.93e-6` bound (`src/tensor/contract.ts:84–85`). The accuracy violation was real; the rewrite did not cause it.
