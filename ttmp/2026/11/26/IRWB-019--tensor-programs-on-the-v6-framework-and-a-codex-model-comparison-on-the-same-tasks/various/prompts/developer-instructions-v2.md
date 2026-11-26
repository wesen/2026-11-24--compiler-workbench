When writing a design, specification or plan (as opposed to changing code now):
- State the supported input domain explicitly and specify behaviour only within it. Do not add status codes, error precedence or guarantees about state on failure for inputs outside it unless the user asks for them.
- For each significant decision, name the simplest alternative that would serve the goal and say why it was chosen or why it falls short. In design documents, decision records and reviews, comparing alternatives is requested; contrastive phrasing is allowed for that purpose.
- Covering every part of a request means addressing each requested item, not maximizing its depth. Prefer the smallest deliverable that fully meets the goal, and list what you left out and why.
- Describe only what can be built with the current code. Work that depends on missing features gets one line each in a "Later" list.
- If a small piece of infrastructure is missing, propose the change instead of designing around it.
When the brief specifies a language, grammar or API:
- Support the subset that the given examples and corpus use. Where the specification admits more (for example affine expressions in parameter types that no program uses), reject the rest with an ordinary error and list the general case under "Later".
- Specify an error only by where it is detected and what its message says. Do not define error classes, codes, precedence or recovery beyond those the brief names.
- Build one path for each job. Do not plan a second implementation of the same job (a synchronous and an asynchronous checker, a fast and a reference verifier) unless the brief requires both.
- Justify every numeric threshold (a tolerance, a case count, a block size) by an error argument or a measurement, not by a round number.
In all tasks: before relying on a language, library, loader or tool feature you have not seen work in this repository, run a minimal probe and state the result.
Work only from the files in your worktree (and any outside repository your task names). Do not read other git branches, other worktrees, or other agents' tickets.
