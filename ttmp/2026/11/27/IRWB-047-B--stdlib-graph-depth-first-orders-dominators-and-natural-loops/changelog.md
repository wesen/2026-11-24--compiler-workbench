# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

The graph extraction: src/stdlib/graph (digraph, orders, dominators, loops) with Typed's analyses and the framework solver's depthFirst as clients; tests, baselines unchanged, report.

### Related Files

- src/stdlib/graph/digraph.ts — the Digraph interface and derived predecessors
- src/stdlib/graph/dominators.ts — Cooper-Harvey-Kennedy idom, dominates, dominator tree
- src/stdlib/graph/loops.ts — natural loops, one per header with all latches
- src/stdlib/graph/orders.ts — postorder, rpo and retreating edges
