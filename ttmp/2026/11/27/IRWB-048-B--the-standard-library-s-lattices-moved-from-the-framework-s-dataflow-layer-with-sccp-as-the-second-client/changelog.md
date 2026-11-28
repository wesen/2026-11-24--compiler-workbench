# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Implemented: the framework's lattices moved to stdlib/lattice/lattices.ts unchanged; framework/dataflow/lattices.ts re-exports them (157 -> 10 lines) so its callers compile untouched; SCCP on the library's flat lattice with the W-Z top/bottom reversal fixed at all six uses; tests/stdlib/lattice.test.mjs (17 tests: join laws over every triple of each domain, bottom identity, widening upper bounds and termination, thresholds, encode/decode); baselines no differences and the suites 522 pass / 0 fail; two existing test assertions amended (the framework import rule allows src/stdlib; one sccp lattice-value shape)

### Related Files

- src/framework/dataflow/lattices.ts — the re-export shim
- src/stdlib/lattice/lattices.ts — the moved module, with the lattice laws in the header
- src/typed/sccp.ts — second client
- tests/stdlib/lattice.test.mjs — the laws and the widening tests
