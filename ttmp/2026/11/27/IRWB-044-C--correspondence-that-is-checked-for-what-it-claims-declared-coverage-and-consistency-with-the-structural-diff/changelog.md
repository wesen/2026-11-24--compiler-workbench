# Changelog

## 2026-11-27

- 6995661 design of the coverage policy and the diff audit; ticket; probes 01 (what the structural diff
  says about the probe-04 program) and 02 (coverage of every existing correspondence, tensor corpus, fused
  and unfused).
- 9a78b34 implementation: `entityPresence` in `ir/diff.ts`, `CorrespondenceRequirement.coverage` with
  `bothTotal` as the default, coverage + deletion rule in the manager's requirement path, the lowering
  requirement declares `partial`; the F35 test loses its `todo`; new
  `tests/framework/correspondence-coverage.test.mjs`.
- 02ac33a contracts README states the two checks; prettier on `definitions.ts`.
- probe 03 (the two checks separated) and the report.
