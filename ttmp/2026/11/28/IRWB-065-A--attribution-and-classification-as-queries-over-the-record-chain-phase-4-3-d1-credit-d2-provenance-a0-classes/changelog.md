# Changelog

## 2026-11-28

- Initial workspace created

## 2026-11-28

Attribution, provenance and edit classification are queries over the record chain: new src/framework/ir/attribution.ts (creditLink, provenanceLabels), D1 and D2 as adapters, A0's class read off cited derivation steps with the settled 395, the matcher's template instantiation on stdlib/term, and the origin walks deleted. D1 tables, D2 outputs and the corpus differential (846 comparisons) all byte-identical; baselines: no differences.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-queries-g-h-irwb-065-a/src/framework/ir/attribution.ts — the domain-independent credit and provenance queries
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-queries-g-h-irwb-065-a/src/framework/ir/derivation.ts — inPlaceInput, the settled in-place policy next to locality
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-queries-g-h-irwb-065-a/src/typed/attribute.ts — D1 as an adapter over creditLink and the lowering correspondence
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-queries-g-h-irwb-065-a/src/typed/edit-classes.ts — A0's class as a query over cited steps; rederive kept as audit on stdlib/term
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-queries-g-h-irwb-065-a/src/typed/missed.ts — D2's provenance as provenanceLabels over the chain
