Completed [IRWB-035-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-sm-irwb-035-a/ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/index.md). The [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-sm-irwb-035-a/ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/design-doc/01-edit-classification-design.md), [report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-sm-irwb-035-a/ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/analysis/01-corpus-edit-census-report.md), and [per-pass and per-project tables](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-sm-irwb-035-a/ttmp/2026/11/27/IRWB-035-A--local-value-rewrite-census-for-o2-and-speed/analysis/02-corpus-census-tables.md) cover all 50 projects.

| Pipeline | Unit | Local | Structural | Other |
|---|---|---:|---:|---:|
| O2 | Edit records | 10.0% | 69.9% | 20.0% |
| O2 | Affected Typed statements | 11.3% | 66.7% | 21.9% |
| `speed` | Edit records | 4.2% | 83.5% | 12.3% |
| `speed` | Affected Typed statements | 4.6% | 82.2% | 13.2% |

Neither pipeline emitted an explicit verified-rule citation. Replaying rules with verified evidence reproduced **183 of 203 O2 local edits (90.1%)** and **362 of 408 `speed` local edits (88.7%)**. Guarded power-of-two division and remainder account for all 66 remaining local edits.

Strictly local rewrites accounted for 40.2% of O2 value replacements and 35.9% of `speed` value replacements. Including substitutions that depend on other statements raised those shares to 82.6% and 90.4%. Proving that broader set requires checked dataflow facts.

The callable classifier required no framework changes. The build and requested test groups passed with 410 tests passing and three skipped by default. The census reproduced byte for byte. Last commit `b7cd2ae46d709c04650c9adf01c02036b260d25f`.