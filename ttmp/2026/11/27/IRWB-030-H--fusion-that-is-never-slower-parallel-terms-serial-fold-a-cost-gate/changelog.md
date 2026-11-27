# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Design committed: parallel terms in block-mode row reductions (whole block computes terms, one thread folds them in the meaning's order) and a launch-time fuse gate (longest row < one warp keeps stage 2's lowering); the row-length sweep behind the gate is in scripts/03.
