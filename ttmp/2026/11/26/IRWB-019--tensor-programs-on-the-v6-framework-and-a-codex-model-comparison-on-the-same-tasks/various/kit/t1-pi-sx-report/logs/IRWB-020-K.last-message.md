[Stage 1 report](ttmp/2026/11/26/IRWB-020-K--tix-language-tensor-ir-evaluators-meaning-contract-and-passes/reference/02-report.md) · Commit `a4625d858653db15c95037d576cc87c592f12942`

Reproduced two of the five `split-sum` rejections. The evaluated code, tests, and corpus are unchanged.

- **31:** An empty `max` returned `-Infinity` in both versions; the tolerance gate rejects matching infinities (`src/tensor/meaning.ts:117`).
- **34:** An empty `max` and division by `C=0` produced `+Infinity` in both versions; the same gate rejected them (`src/tensor/meaning.ts:117`).
- **43:** Gate rejection reported; no source or counterexample was supplied to identify the cause.
- **51:** Gate rejection reported; no source or counterexample was supplied to identify the cause.
- **54:** Gate rejection reported; no source or counterexample was supplied to identify the cause.
