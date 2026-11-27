Extended [IRWB-038-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/index.md) with [the proposed standard library](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/design-doc/01-composable-transformations-and-independent-evidence.md:194) and updated the [research diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/log/01-research-diary.md). Each primitive has an interface sketch, theoretical basis, replacement sites, and composition examples.

## Five findings

1. **Acceptance can split.** The contract manager exposed an accepted candidate fact before the enclosing pass rejected a false preservation claim. [Acceptance probe](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/design-doc/01-composable-transformations-and-independent-evidence.md:88)
2. **All ten T6 cells still consult `planFusion`.** The schedule IR exposes decisions, while the old planner continues to supply some of them. [T6 comparison](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/analysis/01-cell-evidence.md:30)
3. **A0 and D1 reconstruct information the producer could record.** Two classifiers assigned different categories to the same constant-propagation edit. [Cell policy probe](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/design-doc/01-composable-transformations-and-independent-evidence.md:87)
4. **B1 repeats residual-state exploration.** The cells share memoization and worklist machinery, while their budget policies can refuse a candidate or retain a checked fallback. [B1 comparison](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/analysis/01-cell-evidence.md:75)
5. **Reuse works when semantics are explicit.** The shared solver matched machine liveness on a four-block diamond, Typed and Tix differed on `max(NaN, 7)`, and synthetic affine cases exposed intermediate rounding despite safe final integers. [Library boundary probe](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r3-sm-irwb-038-a/ttmp/2026/11/27/IRWB-038-A--framework-structure-after-typed-and-tix/scripts/10-standard-library-boundaries.mjs)

## Framework concepts

- Typed transformations with eligibility, candidate preparation, and atomic publication.
- Translation-validation obligations with explicit assurance, coverage, and cache dependencies.
- Witnessed edits with versioned rule applications and explicit entry changes.
- Scoped cross-IR lineage and revision-addressed observations.
- Versioned analysis registration and checked fact transfer.
- Schedule transformations with independent dependence and order obligations.
- Strategy-controlled selection with explicit guards, fallbacks, and measurement evidence.

## Standard-library primitives

- Graph traversal and strongly connected components.
- Dominators, dominance frontiers, and natural loops.
- Lattice constructors and fixed-point solving.
- Use-def indexing, liveness, and reaching definitions.
- SSA construction and checking.
- Sparse conditional constant propagation.
- Local value numbering and common-subexpression candidates.
- Live intervals and interference graphs.
- Exact affine expressions.
- Affine dependence and schedule tests.
- Binding-time analysis.
- Polyvariant partial evaluation.
- Fixed-width bit-vector arithmetic.
- Bit-exact binary32 primitives with explicit operation semantics.
- Guarded rule verification and application checking.
- Reproducible case generation.
- Additive execution attribution.
- Edit classification and census.
- Static cost estimation.
- Benchmark design and paired measurement summaries.

**Fundamental recommendation.** Keep one transformation lifecycle and one strategy interpreter. The framework owns revision identity, obligations, and publication. The optional standard library owns reusable algorithms, including the pure dataflow solver. Domains own language semantics, target behavior, and policy. Start with graph analysis, liveness, and binary32 conversion and classification, where existing clients give concrete parity tests.

All seven CPU probes and docmgr validation passed. The affine probe exercised direct helpers on synthetic inputs. GPU findings still come from the supplied stage reports. The worktree is clean, and the commit is local.

**Last commit** `59c16e0e5e7c52c2a50ab51e27519ace302`