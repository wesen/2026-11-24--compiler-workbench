[IRWB-038-B ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/index.md) · [Design document and standard-library catalogue](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/design-doc/01-what-a-checked-compiler-transformation-should-return.md:198)

**Fundamental recommendation:** Give the generic core one responsibility for acceptance and publication. Put reusable compiler algorithms in an optional standard library. Let each domain supply its operator semantics, memory assumptions, target constraints and measurement policy. Fix candidate publication first. Shared machine liveness can proceed independently as the first library extraction.

### Five findings

1. A native Tix pass ran through the existing strategy interpreter with its required gate omitted. With a fresh output ID, a rejected candidate also remained visible as the caller’s store head. [Pass and publication probe](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/scripts/01-pass-boundary.mjs:17)
2. Correspondence needs both a named entity set and a coverage requirement. The manager rejected incompatible projections but accepted complete endpoint lists with zero mapping groups. [Correspondence probe](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/scripts/01-pass-boundary.mjs:45)
3. T6-D’s sampled order validator missed a permutation that changed an f32 sum from **1 to 0** at extent 17. Its reorder precondition correctly refused that permutation. [Reduction-order probe](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/scripts/05-reduction-order.mjs:12)
4. Allocation and coalescing are concrete clients for shared liveness. The machine analysis and entry-reachable solver agreed on reachable blocks but returned `{64,65}` and `∅` for one unreachable block. Traversal scope belongs in the interface. [Liveness comparison](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/scripts/08-library-boundaries.mjs:20)
5. Typed’s `fmax(NaN, 1)` returned `1`; Tix’s `max(NaN, 1)` returned NaN. Shared binary32 arithmetic needs explicit operation semantics and an independently specified equality relation. [Numeric comparison](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-am-irwb-038-b/ttmp/2026/11/27/IRWB-038-B--composing-compiler-transformations-and-their-evidence/scripts/08-library-boundaries.mjs:12)

### Framework concepts

- **Partial transformations** construct candidates privately and publish accepted outputs atomically.
- **Revision-scoped provenance** records entity relations, edit footprints, rule witnesses and premises.
- **Translation-validation judgments** identify the reference, assumptions, observation, method and quantified scope.
- **Demand-driven analysis queries** track dependencies at the granularity each result requires.
- **Polyvariant specialization** uses a library algorithm to construct and bound residual control points.
- **Affine schedule validation** uses a library algorithm to check coverage and required order independently of cost selection.

### Standard-library primitives

1. **Dominance, frontiers and natural loops** derive control structure from a CFG with an explicit entry.
2. **Monotone dataflow and lattices** provide scoped fixed points, liveness, reaching definitions and ranges.
3. **SSA construction** exposes definitions, uses and φ inputs as a revision-local view.
4. **Sparse conditional constant propagation** computes constant values and feasible edges together.
5. **Local value numbering** identifies reusable expressions under declared effects and invalidation rules.
6. **Dependence closure and slicing** find required callees or affected callers for reuse and testing.
7. **Affine expressions and dependence tests** compose index maps and identify illegal schedules.
8. **Binding-time analysis** determines which values follow from static inputs and memory assumptions.
9. **Polyvariant residualization** interns specialized states, closes backedges and bounds code growth.
10. **Binary32 arithmetic profiles** provide word-level operations and explicit comparison policies.
11. **Rule verification and contextual replay** check a rule instance and account for surrounding edits.
12. **Case generation and coverage** produce reproducible constrained inputs and report untested strata.
13. **Edit classification** derives policy-specific counts from footprints, premises and witnesses.
14. **Conserved instruction attribution** distributes additive observations across revision-qualified sites.
15. **Cost observations and paired benchmarks** retain units, workload, profile, censoring and uncertainty.

The follow-up probe and four selected CPU fixture files passed. `docmgr doctor` passed. GPU timing remains a proposed migration check. The worktree is clean, and both follow-up commits are local.

**Last commit** `aac9a7a27e473046936d1c5fd053279688631806`