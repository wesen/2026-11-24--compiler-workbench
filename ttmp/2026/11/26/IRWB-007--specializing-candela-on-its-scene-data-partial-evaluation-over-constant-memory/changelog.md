# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Intern guide (design-doc 01) and its measurements: scene table inventory (224-916 words, at most 24 objects, 15 BVH nodes per scene), r0 scan (U read at 174 constant positions; O, LI, BV each by one function at variable positions; cdlRenderSpan stores only into out, K scratch and frame arrays), binding-time profile of all 18 scenes in three specializer models (monovariant at most 1.68x; polyvariant 2.1-4.5x on 11 scenes, below 1.7x on the 7 ray-marched and volume scenes). Implementation phases 0-5 added as tasks.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a835ea9e40615941e/ttmp/2026/11/26/IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/design-doc/01-intern-guide-specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory.md — the guide
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a835ea9e40615941e/ttmp/2026/11/26/IRWB-007--specializing-candela-on-its-scene-data-partial-evaluation-over-constant-memory/various/04-profile-summary.txt — measurement 3 tables
