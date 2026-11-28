# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

The framework's dataflow lattices moved to src/stdlib/lattice/lattices.ts; framework/dataflow/lattices.ts is a re-export seam, so solver, analyses, typed and workbench callers keep their imports; the lattice laws checked on each lattice over generated pools (tests/stdlib/lattice.test.mjs); framework layering test admits the library below the framework; SCCP's lattice checked (probe 01) and left — it is the library flat lattice's dual (meet from TOP, typed constants), not the same lattice. Baselines: no differences.
