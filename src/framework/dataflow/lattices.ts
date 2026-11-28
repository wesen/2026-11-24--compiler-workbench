/**
 * IRWB-048-A: the lattices moved to the standard library (`src/stdlib/lattice/lattices.ts`), not rewritten;
 * this module re-exports them, so the dataflow layer's callers — the solver, the analyses built on it, the
 * typed analyses and the workbench — keep their imports unchanged. The library owns the code (IRWB-001 E4
 * wrote it); the framework owns the seam.
 */
export * from '../../stdlib/lattice/lattices.js';
