Report: [reference/02-report.md](ttmp/2026/11/26/IRWB-020-H--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md)  
Commit: `5ea4e6f4236b57780d4fff22fae5d73922cbff40`

**Program 39 — `split-sum`:** Cancellation caused the original f32 result to exceed the f64 tolerance on two sampled inputs (`src/tensor/contract.ts:126`). The split was bit-identical to the original at both failing elements: a real accuracy violation, not a rewrite regression.
