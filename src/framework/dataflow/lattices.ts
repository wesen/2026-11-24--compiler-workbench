/**
 * IRWB-001 E4: lattices for monotone dataflow problems.
 *
 * IRWB-048-B moved the lattices themselves into the standard library (`src/stdlib/lattice/lattices.ts`:
 * the interface, the set, flat, interval and map lattices, with the interval widening and its
 * thresholds) and this module re-exports them, so every caller of the dataflow layer keeps its import.
 * The library imports nothing outside `src/stdlib/`; the dependency runs one way, framework -> library.
 * The doc comment on each lattice is in the library.
 */
export * from '../../stdlib/lattice/lattices.js';
