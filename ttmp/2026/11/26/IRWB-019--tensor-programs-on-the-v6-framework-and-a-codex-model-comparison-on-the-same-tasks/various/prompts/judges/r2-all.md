You are judging eleven anonymous research design documents for a compiler project. The pack is the directory /tmp/claude-1000/-home-manuel-code-wesen-2026-11-24--compiler-workbench/6d4ded76-01c1-42ed-bd4c-3f506f14dfc9/scratchpad/judge-r2-all:
- `brief.md` is the task all eleven authors answered;
- `rubric.md` is how you score them;
- `doc-A` … `doc-K` each hold one author's whole ticket: the design document (usually under `design-doc/`), the diary, and the experiment scripts and results under `scripts/` (or `prototypes/`, `various/`). Binary data files were left out of the pack.

The repository the brief describes, at the revision the authors started from, is /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-base. Read it, without changing it, to check the documents' claims about the code. Read nothing else on this machine: not other directories under `.claude/worktrees`, and not the parent directory of the pack. Use the web to check citations and claims about CUDA, floating point and the literature. Do not run GPU jobs. You may run an author's local (non-GPU) script to check a result, from a copy outside the pack.

Follow `rubric.md` exactly: read the brief and all eleven documents before scoring any; quote for every score below 6 and every error; check at least five citations and three technical claims per document (fewer where a document cites fewer). The authors are anonymous; do not guess who wrote what. Length is not merit: judge what each document establishes.

Your final answer is the rubric's JSON array followed by the ranking, and nothing else.
