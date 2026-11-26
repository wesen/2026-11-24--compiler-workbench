# Changelog

## 2026-11-25

- Initial workspace created

## 2026-11-25

Baseline of corpus revisions recorded at 420d8e1; intern guide written, revised after a second reading pass, uploaded to reMarkable (/ai/2026/11/25/IRWB-006)

## 2026-11-26

B1: simplify (27 rules) and fold (40 rules) are rule tables; identical revisions, edits and correspondences on the corpus (1232 comparisons, 5 pipelines) and Candela O2 (4 steps); passes.ts switched; gates green. B2: verifier with eight methods; unsound candidates rejected. A1: typed.ssa agrees with reaching definitions on all corpus revisions and Candela r0 (after fixing a duplicate-local-name collision found on Candela). A2: sccp superset of constprop; O2-sccp brings constants 70 -> 40 instructions.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a9651bdd56f613b24/src/typed/rules/compile.ts — the rule compiler
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a9651bdd56f613b24/src/typed/ssa.ts — the SSA view
