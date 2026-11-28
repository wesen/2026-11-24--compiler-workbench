# Changelog

## 2026-11-28

- Initial workspace created

## 2026-11-28

Cross-IR transformations on the one runner; typed.lower-rv32 and tensor.lower-cuda as applications; pending applications for lowerToImage and cudaSource; tests; report

### Related Files

- src/framework/passes/transformation.ts — the cross form and the runner
- src/tensor/cuda-contract.ts — tensor.lower-cuda on the runner
- src/typed/backend/compile.ts — typed.lower-rv32
