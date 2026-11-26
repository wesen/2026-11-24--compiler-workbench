## 1

I’ll use the docmgr and diary skills, then check the corpus conventions, Typed support, and pass budget before writing the design.

## 2

The front end keeps `Int32Array`s local to their declaring function, and the case generator supports `oneOf` for scalars only. The design will keep the NFA arrays in the matcher entry point and run several input profiles against the same source to cover both fixed and varying patterns.

## 3

A small compiler probe exposed an integration requirement. The default ingestion path fails on local frame arrays, while tape ingestion succeeds in both the evaluator and the stock RV32 reference image. I’m adding the existing workbench metadata setting and the required Node loader change to the design.

## 4

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-015/ttmp/2026/11/26/IRWB-015--thompson-nfa-regex-matcher/design-doc/01-design-for-a-thompson-nfa-regex-matcher.md)
- [IRWB-015 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-015/ttmp/2026/11/26/IRWB-015--thompson-nfa-regex-matcher/index.md)
- Commit `8ba5bbad4a0026cc81684990907383fb65223245`

The design specifies a whole-buffer Thompson NFA matcher with explicit state sets, a JavaScript `RegExp` oracle, generated input profiles, and a fixed-pattern specialization experiment measured in RV32 instructions. A compiler probe confirmed that local `Int32Array`s require tape ingestion, and the design identifies the Node corpus loaders that need to honor that setting. All 26 directed match and miss expectations agreed with JavaScript. The matcher and its measured step budget remain implementation work.
