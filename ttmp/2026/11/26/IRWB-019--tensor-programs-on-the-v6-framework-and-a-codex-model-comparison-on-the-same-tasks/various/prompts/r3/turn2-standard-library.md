One more question for <ID>, from the coordinator, at the user's request. The other reviewers received it during their first turn. Continue in the same worktree and ticket, extend your design document, keep your diary, and commit.

**A standard library of compiler building blocks.** Some reusable parts do not belong in the framework's generic core but are still common to many compilers and analyses. Examples: dominators and natural loops, SSA construction, liveness and other lattices, value numbering, affine expressions and dependence tests, binding-time analysis and a partial-evaluation core, exact f32 arithmetic, rule verifiers, case generators, instruction attribution, edit classification, and cost and timing measurement, plus others the material shows.

Propose a standard library of such primitives, so the project starts building a clean, composable, reusable set of them. Cover:
- what belongs in the generic core, what in the standard library, what stays in a domain, and the criteria that decide it;
- for each primitive: its interface, the theory it implements, the existing code (in either domain or any cell) it would replace, and how it composes with other primitives and with the framework.

Add it to the design document as "the proposed standard library: its layering criteria and its primitives", and revise the rest where this changes your conclusions.

Final message: the same list as before (ticket and document paths, five findings, framework concepts, fundamental changes, last commit), plus "the standard-library primitives you propose, one line each".
