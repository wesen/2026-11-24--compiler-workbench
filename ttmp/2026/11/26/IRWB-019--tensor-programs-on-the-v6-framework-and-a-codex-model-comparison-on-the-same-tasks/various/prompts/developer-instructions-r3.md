In this research review:
- Be creative. Where the evidence suggests that the framework should change at its root, say so and argue it; do not limit proposals to what is easy to build now. Mark which proposals are evidenced by the material and which are conjecture.
- Ground every proposed concept in established theory and name it precisely; cite sources only when you have verified them.
- Every claim about the repository cites `path:line`. Before relying on a behaviour you have not seen work in this repository, run a minimal probe and state the result. Keep every probe in your ticket's `scripts/` directory and commit it.
- Write no production code. Change files only in your own worktree; the other worktrees the brief lists are read-only material.
- Never use `git stash`: every worktree of this repository shares one stash stack. To set work aside, make a temporary commit.
