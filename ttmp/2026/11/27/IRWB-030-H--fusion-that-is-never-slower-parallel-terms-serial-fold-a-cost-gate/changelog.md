# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Design committed: parallel terms in block-mode row reductions (whole block computes terms, one thread folds them in the meaning's order) and a launch-time fuse gate (longest row < one warp keeps stage 2's lowering); the row-length sweep behind the gate is in scripts/03.

## 2026-11-27

Stage 3b implemented and reported: staged reduction terms (parallel terms, serial fold, bit-identical), a warp-boundary fuse gate decided with the launch's shapes, artifact version 3 recording staged reductions, 7 local and 4 GPU tests; layernorm-inside 0.216 against 0.561 ms, corpus unchanged at one kernel each; no framework or tool change (finding: a profitability decision has no place in a semantic contract).
