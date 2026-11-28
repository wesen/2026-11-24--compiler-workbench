# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Moved depth-first orders, CHK dominators (tree + dominates) and natural loops into src/stdlib/graph over one Digraph; typed analyses, ssa and the framework solver call the library and their old copies are deleted; baselines unchanged

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-graph-g-h/irwb-047-a/src/framework/dataflow/solver.ts — depthFirst is an adapter over the library walk (loop heads = retreating-edge targets)
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-graph-g-h/irwb-047-a/src/typed/analyses.ts — cfgOf/dominatorsOf/domView/loopsOf are now thin adapters over the library; digraphOf added
